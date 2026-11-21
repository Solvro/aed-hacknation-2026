"""Testy czytników, mapowania kolumn i walidacji modułu AED (bez bazy danych).

Przypadki odwzorowują prawdziwe zbiory AED opublikowane w dane.gov.pl (Krosno, Marki, Legionowo, Przemyśl),
skopiowane do data/aed/demo/.
"""
import json
import os

import pytest
from django.conf import settings

from mcod.aed.mapping import map_columns
from mcod.aed.readers import GEOM_LAT, GEOM_LON, ReaderError, read_bytes, read_file
from mcod.aed.validation import (
    CRITICAL,
    WARNING,
    mark_duplicates,
    normalize_row,
    parse_bool,
    parse_date,
    parse_dostep,
    split_address,
)

DEMO = os.path.join(str(settings.DATA_DIR), "aed", "demo")


def _process(path, fmt):
    result = read_file(path, fmt)
    mapping = map_columns(result.headers, result.rows)
    rows = [normalize_row(i, raw, mapping) for i, raw in enumerate(result.rows)]
    mark_duplicates(rows)
    return result, mapping, rows


def codes(nr):
    return {i.code for i in nr.issues}


class TestReaders:
    def test_whole_row_quoted_csv_is_repaired(self):
        result = read_file(os.path.join(DEMO, "marki.csv"), "csv")
        assert len(result.rows) == 8
        assert "Szerokość geograficzna" in result.headers
        assert any("cudzysłów" in n for n in result.notes)

    def test_cp1250_semicolon_csv(self):
        content = "id_aed;miejscowość;szerokość;długość\n1;Łódź;51,7592;19,4560\n".encode("cp1250")
        result = read_bytes(content, "csv")
        assert result.rows[0]["miejscowość"] == "Łódź"
        assert result.rows[0]["szerokość"] == "51,7592"

    def test_geojson_geometry_becomes_coordinates(self):
        result = read_file(os.path.join(DEMO, "przemysl.geojson"), "geojson")
        assert result.file_format == "geojson"
        assert len(result.rows) == 21
        assert {GEOM_LON, GEOM_LAT} <= set(result.headers)
        # lista obiektów (galeria) spłaszczona do pierwszego URL
        assert result.rows[0]["gallery"].startswith("https://")

    def test_json_with_nested_coordinates(self):
        payload = {"result": {"featureMemberList": [
            {"opis": "Ratusz", "coordinates": [[21.0122, 52.2297]]},
            {"opis": "Dworzec", "coordinates": [[21.0034, 52.2286]]},
        ]}}
        result = read_bytes(json.dumps(payload).encode(), "json")
        assert result.rows[0][GEOM_LAT] == pytest.approx(52.2297)
        assert result.rows[1][GEOM_LON] == pytest.approx(21.0034)

    def test_geojson_declared_as_json_is_detected(self):
        payload = {"type": "FeatureCollection", "features": [
            {"type": "Feature", "geometry": {"type": "Point", "coordinates": [19.9, 50.06]}, "properties": {"id": 1}}]}
        assert read_bytes(json.dumps(payload).encode(), "json").file_format == "geojson"

    def test_empty_file_raises(self):
        with pytest.raises(ReaderError):
            read_bytes(b"", "csv")


class TestMapping:
    def test_krosno_combined_address_and_constant_name_column(self):
        result, mapping, rows = _process(os.path.join(DEMO, "krosno.csv"), "csv")
        assert mapping.fields["szerokosc_geogr"] == "Szerokość geograficzna"
        assert mapping.fields["id_aed"] == "Numer Id"
        # kolumna „Nazwa” = „Defibrylator” w każdym wierszu -> pominięta, nazwa obiektu z „Lokalizacja”
        assert mapping.fields["nazwa_obiektu"] == "Lokalizacja"
        assert mapping.aux["adres"] == "Adres"
        second = rows[1].values
        assert second["ulica"] == "Stanisława Wyspiańskiego"
        assert second["nr_budynku"] == "20"
        assert second["kod_pocztowy"] == "38-400"
        assert second["miejscowosc"] == "Krosno"

    def test_legionowo_standard_like_headers(self):
        _, mapping, rows = _process(os.path.join(DEMO, "legionowo.csv"), "csv")
        assert mapping.fields["ulica"] == "nazwa_ulicy"
        assert mapping.fields["teryt_terc"] == "kod_terc"
        assert mapping.aux["cecha_ulicy"] == "cecha_ulicy"
        assert not any(r.is_critical for r in rows)
        # brak kolumny identyfikatora -> identyfikator wyliczony i ostrzeżenie
        assert all(r.local_id_generated for r in rows)
        assert "NO_ID" in codes(rows[0])

    def test_przemysl_geojson_english_properties(self):
        _, mapping, rows = _process(os.path.join(DEMO, "przemysl.geojson"), "geojson")
        assert mapping.fields["dlugosc_geogr"] == GEOM_LON
        assert mapping.fields["miejscowosc"] == "city"
        assert mapping.fields["nr_budynku"] == "home_number"
        assert mapping.fields["zdjecie_url"] == "gallery"
        assert rows[0].values["kod_pocztowy"] == "37-700"


class TestValidation:
    def test_marki_swapped_coordinates_are_fixed(self):
        _, _, rows = _process(os.path.join(DEMO, "marki.csv"), "csv")
        assert sum("COORDS_SWAPPED" in codes(r) for r in rows) == 7
        in_marki = [r for r in rows if 52 < r.values["szerokosc_geogr"] < 53 and 20.5 < r.values["dlugosc_geogr"] < 21.5]
        assert len(in_marki) == 7
        # wiersz „SP nr 5” ma w źródle współrzędne z Krosna – formalnie poprawne, wyłapuje go dopiero geokoder
        outlier = next(r for r in rows if r not in in_marki)
        assert outlier.values["miejscowosc"] == "Marki" and outlier.values["szerokosc_geogr"] < 50
        assert not any(r.is_critical for r in rows)

    def _row(self, raw):
        mapping = map_columns(list(raw.keys()), [raw])
        nr = normalize_row(0, raw, mapping)
        mark_duplicates([nr])
        return nr

    def test_coordinates_or_full_address_required(self):
        nr = self._row({"id_aed": "1", "nazwa_obiektu": "Szkoła"})
        assert nr.is_critical and "NO_LOCATION" in codes(nr)
        assert not self._row({"id_aed": "1", "miejscowosc": "Gdańsk", "nr_budynku": "5"}).is_critical
        assert not self._row({"id_aed": "1", "lat": "54.35", "lon": "18.65"}).is_critical

    def test_point_outside_poland_is_critical(self):
        nr = self._row({"id_aed": "1", "lat": "48.85", "lon": "2.35"})
        assert nr.is_critical and "OUT_OF_POLAND" in codes(nr)

    def test_non_numeric_coordinates_are_critical(self):
        nr = self._row({"id_aed": "1", "lat": "pięćdziesiąt", "lon": "19"})
        assert any(i.code == "INVALID_COORDS" and i.severity == CRITICAL for i in nr.issues)

    def test_comma_decimal_and_types(self):
        nr = self._row({
            "id_aed": "A1", "szerokosc_geogr": "50,0619", "dlugosc_geogr": "19,9368", "wewnatrz_budynku": "TAK",
            "zamkniety_w_szafce": "nie", "data_weryfikacji": "01.10.2026", "dostep": "ogólnodostępny",
            "kod_pocztowy": "31042",
        })
        v = nr.values
        assert v["szerokosc_geogr"] == pytest.approx(50.0619)
        assert v["wewnatrz_budynku"] is True and v["zamkniety_w_szafce"] is False
        assert v["data_weryfikacji"] == "2026-10-01"
        assert v["dostep"] == "publiczny"
        assert v["kod_pocztowy"] == "31-042"

    def test_invalid_values_are_warnings_not_blockers(self):
        nr = self._row({"id_aed": "1", "lat": "50.06", "lon": "19.93", "wewnatrz_budynku": "może", "dostep": "???"})
        assert not nr.is_critical
        assert [i.severity for i in nr.issues if i.code == "INVALID_VALUE"] == [WARNING, WARNING]

    def test_duplicate_provider_ids_are_critical(self):
        raw = [{"id_aed": "7", "lat": "50.06", "lon": "19.93"}, {"id_aed": "7", "lat": "50.07", "lon": "19.94"}]
        mapping = map_columns(list(raw[0].keys()), raw)
        rows = [normalize_row(i, r, mapping) for i, r in enumerate(raw)]
        mark_duplicates(rows)
        assert not rows[0].is_critical
        assert rows[1].is_critical and "DUPLICATE_ID" in codes(rows[1])

    def test_quality_score_rewards_recommended_fields(self):
        poor = self._row({"lat": "50.06", "lon": "19.93"})
        rich = self._row({
            "id_aed": "1", "lat": "50.06", "lon": "19.93", "miejscowosc": "Kraków", "nr_budynku": "1",
            "kod_pocztowy": "31-042", "nazwa_obiektu": "Sukiennice", "opis_lokalizacji": "hol", "dostep": "publiczny",
            "godziny_dostepnosci": "24/7", "wewnatrz_budynku": "tak", "dysponent": "UMK", "telefon": "123",
            "data_weryfikacji": "2099-01-01",
        })
        assert rich.quality_score() > poor.quality_score()


@pytest.mark.parametrize(
    "text, expected",
    [
        ("ul. Stanisława Wyspiańskiego 20, 38-400 Krosno",
         {"ulica": "Stanisława Wyspiańskiego", "nr_budynku": "20", "kod_pocztowy": "38-400", "miejscowosc": "Krosno"}),
        ("Al.. Piłsudskiego 95, 05-270 Marki",
         {"ulica": "Piłsudskiego", "nr_budynku": "95", "kod_pocztowy": "05-270", "miejscowosc": "Marki"}),
        ("ul. Jasna, 38-400 Krosno", {"ulica": "Jasna", "kod_pocztowy": "38-400", "miejscowosc": "Krosno"}),
        ("Kraków, ul. Floriańska 3a", {"miejscowosc": "Kraków", "ulica": "Floriańska", "nr_budynku": "3a"}),
        ("31-019 Kraków, Floriańska 3", {"kod_pocztowy": "31-019", "miejscowosc": "Kraków", "ulica": "Floriańska", "nr_budynku": "3"}),
    ],
)
def test_split_address(text, expected):
    assert split_address(text) == expected


@pytest.mark.parametrize("value, expected", [("tak", True), ("NIE", False), ("1", True), ("", None)])
def test_parse_bool(value, expected):
    assert parse_bool(value) is expected


def test_parse_date_and_dostep_reject_garbage():
    with pytest.raises(ValueError):
        parse_date("wczoraj")
    with pytest.raises(ValueError):
        parse_dostep("nie wiem")


class TestGeocoding:
    def _row(self, raw):
        mapping = map_columns(list(raw.keys()), [raw])
        return normalize_row(0, raw, mapping)

    def test_far_address_mismatch_blocks_row(self, monkeypatch):
        from mcod.aed import geocoding

        # prawdziwy przypadek z Marek: adres w Markach, współrzędne w Krośnie (~296 km)
        monkeypatch.setattr(geocoding, "forward", lambda q: {"lat": 52.358077, "lon": 21.136341, "simc": "", "kod_pocztowy": ""})
        monkeypatch.setattr(geocoding, "commune", lambda lat, lon: None)
        nr = self._row({"id_aed": "7", "lat": "49.7188", "lon": "21.7203", "miejscowosc": "Marki",
                        "ulica": "Wczasowa", "nr_budynku": "5"})
        geocoding.enrich(nr)
        assert nr.is_critical and "ADDRESS_MISMATCH_CRITICAL" in codes(nr)

    def test_small_mismatch_is_warning_and_address_only_gets_coordinates(self, monkeypatch):
        from mcod.aed import geocoding

        monkeypatch.setattr(geocoding, "forward", lambda q: {"lat": 50.0630, "lon": 19.9370, "simc": "0950463", "kod_pocztowy": "31-042"})
        monkeypatch.setattr(geocoding, "commune", lambda lat, lon: {"teryt_gminy": "1261011", "gmina": "Kraków",
                                                                     "powiat": "Kraków", "wojewodztwo": "małopolskie"})
        near = self._row({"id_aed": "1", "lat": "50.0610", "lon": "19.9370", "miejscowosc": "Kraków", "nr_budynku": "1"})
        geocoding.enrich(near)
        assert not near.is_critical and "ADDRESS_MISMATCH" in codes(near)
        assert near.geo["teryt_gminy"] == "1261011" and near.values["teryt_terc"] == "1261011"

        address_only = self._row({"id_aed": "2", "miejscowosc": "Kraków", "ulica": "Rynek Główny", "nr_budynku": "1"})
        geocoding.enrich(address_only)
        assert address_only.coords_source == "geokodowanie"
        assert address_only.values["szerokosc_geogr"] == pytest.approx(50.0630)
        assert "GEOCODED_COORDS" in codes(address_only)


def test_exported_example_passes_validation(tmp_path):
    from django.core.management import call_command

    call_command("aed_schema_export", out=str(tmp_path))
    assert (tmp_path / "aed_wzorcowy_zakres.xlsx").exists()
    _, mapping, rows = _process(str(tmp_path / "aed_przyklad.csv"), "csv")
    assert set(mapping.fields) == set(__import__("mcod.aed.schema", fromlist=["x"]).field_names())
    assert rows and not any(r.is_critical for r in rows)
    assert all(not r.local_id_generated for r in rows)
