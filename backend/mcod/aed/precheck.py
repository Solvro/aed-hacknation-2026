"""Sprawdzenie pliku AED PRZED publikacją – bez zapisywania czegokolwiek w portalu.

Dostawca wgrywa plik (lub podaje link) i od razu dostaje: co blokuje włączenie wierszy do Ogólnopolskiego
zbioru AED, co warto uzupełnić, co portal poprawi sam, jak rozpoznano kolumny – z instrukcją „jak poprawić”
dla każdego problemu i plikiem z poprawkami automatycznymi do pobrania. Bez oceny punktowej.
"""
import csv
import io
import re
import uuid
from collections import OrderedDict

from django.core.cache import cache

from mcod.aed import geocoding, schema
from mcod.aed.mapping import map_columns
from mcod.aed.readers import ReaderError, read_file
from mcod.aed.validation import CRITICAL, INFO, WARNING, mark_duplicates, missing_recommended_summary, normalize_row

CACHE_PREFIX = "aed:precheck:"
CACHE_TTL = 24 * 3600
MAX_GEOCODED_ROWS = 500

# Instrukcje „jak poprawić” – język prosty, z przykładem
HOW_TO_FIX = {
    "NO_LOCATION": "Dodaj współrzędne (kolumny szerokosc_geogr i dlugosc_geogr, np. 49.6839 i 21.7711) albo pełny adres: "
    "miejscowosc, ulica, nr_budynku i kod_pocztowy. Wystarczy jedno z dwóch – drugie portal uzupełni sam.",
    "INVALID_COORDS": "Wpisz współrzędne jako liczby dziesiętne (np. 49.6839), bez stopni i minut (nie 49°41'02\"). "
    "Przecinek dziesiętny też jest akceptowany.",
    "OUT_OF_POLAND": "Współrzędne muszą być w układzie WGS84 (jak w Google Maps lub GPS). Jeżeli eksportujesz z systemu "
    "GIS, wybierz EPSG:4326 zamiast PL-1992 (EPSG:2180).",
    "DUPLICATE_ID": "Nadaj każdemu urządzeniu inny id_aed (np. kolejny numer lub numer seryjny AED). Identyfikator musi "
    "być stały – po nim portal rozpoznaje to samo urządzenie w kolejnych wersjach pliku.",
    "ADDRESS_MISMATCH_CRITICAL": "Adres i współrzędne wskazują miejsca odległe o kilka kilometrów. Sprawdź na mapie, które "
    "dane są prawdziwe, i popraw drugie (najczęściej to współrzędne skopiowane z innego wiersza).",
    "NO_ID": "Dodaj kolumnę id_aed ze stałym identyfikatorem urządzenia. Bez niego zmiana adresu w kolejnej wersji pliku "
    "zostanie potraktowana jako nowe urządzenie, a stare zniknie z mapy.",
    "COORDS_SWAPPED": "Szerokość geograficzna (w Polsce 49–55) powinna być w kolumnie szerokosc_geogr, a długość (14–24) "
    "w dlugosc_geogr. W pliku z poprawkami zostały zamienione automatycznie.",
    "ADDRESS_INCOMPLETE": "Uzupełnij brakujące elementy adresu (numer budynku, kod pocztowy) – ratownik szybciej trafi "
    "pod właściwy budynek.",
    "INVALID_POSTCODE": "Kod pocztowy wpisz w formacie NN-NNN, np. 38-400.",
    "INVALID_VALUE": "Użyj dozwolonych wartości: dostep = publiczny / klienci / pracownicy; wewnatrz_budynku = tak / nie; "
    "daty w formacie RRRR-MM-DD.",
    "STALE_VERIFICATION": "Sprawdź urządzenie na miejscu (czy jest, czy działa, czy jest dostępne) i wpisz datę tej "
    "weryfikacji w kolumnie data_weryfikacji.",
    "EXPIRED_ELECTRODES": "Elektrody są przeterminowane – wymień je i wpisz nową datę ważności.",
    "EXPIRED_BATTERY": "Bateria jest przeterminowana – wymień ją i wpisz nową datę ważności.",
    "ADDRESS_MISMATCH": "Adres i współrzędne różnią się o kilkaset metrów. Sprawdź punkt na mapie – przy dużych obiektach "
    "(szpital, kampus) wpisz współrzędne wejścia, przy którym jest AED.",
    "GEOCODE_FAILED": "Adresu nie ma w rejestrze GUGiK. Sprawdź pisownię ulicy i miejscowości albo dodaj "
    "współrzędne.",
    "MISSING_RECOMMENDED": "Uzupełnij tę kolumnę – dane o miejscu i dostępie pomagają dyspozytorowi 112 poprowadzić "
    "świadka zdarzenia prosto do urządzenia.",
}

AUTO_FIX_LABELS = {
    "ADDRESS_PARSED": "Adres z jednej kolumny rozdzielono na ulicę, numer, kod i miejscowość.",
    "GEOCODED_COORDS": "Współrzędne uzupełniono na podstawie adresu (GUGiK).",
    "GEOCODED_ADDRESS": "Adres uzupełniono na podstawie współrzędnych (GUGiK).",
    "COORDS_SWAPPED": "Zamieniono miejscami szerokość i długość geograficzną.",
    "TERYT_RECOMPUTED": "Kody TERYT wyliczono ze współrzędnych.",
}

FIELD_TITLES = {f["name"]: f.get("title", f["name"]) for f in schema.fields()}


def _issue_groups(rows, general):
    groups = OrderedDict()
    for nr in rows:
        for issue in nr.issues:
            key = (issue.severity, issue.code, issue.field if issue.code == "INVALID_VALUE" else "")
            g = groups.setdefault(
                key,
                {
                    "severity": issue.severity,
                    "code": issue.code,
                    "field": issue.field,
                    "field_title": FIELD_TITLES.get(issue.field, issue.field),
                    "message": issue.message,
                    "how_to_fix": HOW_TO_FIX.get(issue.code, ""),
                    "rows": [],
                    "examples": [],
                },
            )
            if issue.row not in g["rows"]:
                g["rows"].append(issue.row)
            if len(g["examples"]) < 3:
                g["examples"].append({"row": issue.row, "value": issue.value, "message": issue.message})
    for issue in general:
        # brak id_aed jest już opisany kartą NO_ID (z numerami wierszy)
        if issue.code == "MISSING_RECOMMENDED" and issue.field != "id_aed":
            m = re.search(r"w (\d+) z (\d+)", issue.message)
            groups[(WARNING, issue.code, issue.field)] = {
                "rows_label": f"puste w {m.group(1)} z {m.group(2)} wierszy" if m else "",
                "severity": WARNING,
                "code": issue.code,
                "field": issue.field,
                "field_title": FIELD_TITLES.get(issue.field, issue.field),
                "message": issue.message,
                "how_to_fix": HOW_TO_FIX["MISSING_RECOMMENDED"],
                "rows": [],
                "examples": [],
            }
    return list(groups.values())


def _corrected_csv(rows) -> str:
    names = schema.field_names()
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(names + ["uwagi_portalu"])
    for nr in rows:
        values = []
        for n in names:
            v = nr.values.get(n)
            values.append("tak" if v is True else "nie" if v is False else "" if v is None else v)
        notes = "; ".join(sorted({i.message for i in nr.issues if i.severity in (CRITICAL, WARNING)}))
        writer.writerow(values + [notes])
    return out.getvalue()


def _issues_csv(rows) -> str:
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(["wiersz", "pole", "waga", "problem", "jak_poprawic", "wartosc"])
    labels = {CRITICAL: "do poprawy (wiersz nie trafi do zbioru)", WARNING: "warto poprawić", INFO: "poprawione automatycznie"}
    for nr in rows:
        for i in nr.issues:
            writer.writerow([i.row, i.field, labels.get(i.severity, i.severity), i.message, HOW_TO_FIX.get(i.code, ""), i.value])
    return out.getvalue()


def run_precheck(path: str, declared_format: str, filename: str, geocode: bool = True) -> dict:
    try:
        result = read_file(path, declared_format)
    except ReaderError as exc:
        return {"ok": False, "fatal": str(exc), "filename": filename}

    mapping = map_columns(result.headers, result.rows)
    has_location_columns = ("szerokosc_geogr" in mapping.fields and "dlugosc_geogr" in mapping.fields) or (
        "miejscowosc" in mapping.fields or "adres" in mapping.aux
    )
    if not has_location_columns:
        return {
            "ok": False,
            "filename": filename,
            "fatal": "Nie rozpoznano kolumn z lokalizacją. Nazwij kolumny jak we wzorcowym zakresie: "
            "szerokosc_geogr i dlugosc_geogr albo miejscowosc, ulica, nr_budynku, kod_pocztowy.",
            "headers": result.headers,
        }

    row_offset = 2 if result.file_format in ("csv", "tsv", "xlsx", "xls", "ods") else 1
    rows = [normalize_row(i, raw, mapping, row_offset=row_offset) for i, raw in enumerate(result.rows)]
    mark_duplicates(rows)
    geocoded = 0
    if geocode:
        for nr in rows[:MAX_GEOCODED_ROWS]:
            geocoding.enrich(nr)
            geocoded += 1

    ready = [nr for nr in rows if not nr.is_critical]
    blocked = [nr for nr in rows if nr.is_critical]
    general = missing_recommended_summary(ready or rows)
    groups = _issue_groups(rows, general)

    mapped = []
    for field_name, column in mapping.fields.items():
        if column.startswith("__geom"):
            column = "geometria (GeoJSON)"
        mapped.append({"column": column, "field": field_name, "title": FIELD_TITLES.get(field_name, field_name),
                       "exact": schema.normalize_header(column) == field_name})
    for aux, column in mapping.aux.items():
        mapped.append({"column": column, "field": aux, "title": "adres w jednej kolumnie – rozdzielimy automatycznie"
                       if aux.startswith("adres") else "pomocnicza (pomijana)", "exact": False})
    missing_quality = [
        {"field": n, "title": FIELD_TITLES.get(n, n)}
        for n in schema.recommended_fields()
        if n not in mapping.fields and not (n == "id_aed" and False)
    ]

    auto_fixes = OrderedDict()
    for note in result.notes + [n for n in mapping.notes if "pominięto" in n or "geometrii" in n]:
        auto_fixes[note] = None
    for nr in rows:
        for i in nr.issues:
            if i.code in AUTO_FIX_LABELS:
                auto_fixes.setdefault(AUTO_FIX_LABELS[i.code], 0)
                auto_fixes[AUTO_FIX_LABELS[i.code]] = (auto_fixes[AUTO_FIX_LABELS[i.code]] or 0) + 1

    problem_rows = []
    for nr in rows:
        serious = [i for i in nr.issues if i.severity in (CRITICAL, WARNING)]
        if not serious:
            continue
        merged = OrderedDict()
        for i in serious:  # np. błędna szerokość i długość = jeden komunikat z dwiema wartościami
            item = merged.setdefault(i.message, {"severity": i.severity, "message": i.message, "field": i.field,
                                                 "how_to_fix": HOW_TO_FIX.get(i.code, ""), "values": []})
            if i.value and i.value not in item["values"]:
                item["values"].append(i.value)
        for item in merged.values():
            item["value"] = " / ".join(item.pop("values"))
        problem_rows.append({
            "row": nr.row,
            "name": nr.values.get("nazwa_obiektu") or nr.values.get("id_aed") or f"wiersz {nr.row}",
            "blocked": nr.is_critical,
            "issues": list(merged.values()),
        })

    return {
        "ok": True,
        "filename": filename,
        "file_format": result.file_format,
        "rows_total": len(rows),
        "rows_ready": len(ready),
        "rows_blocked": len(blocked),
        "rows_with_warnings": sum(1 for nr in ready if any(i.severity == WARNING for i in nr.issues)),
        "critical_groups": [g for g in groups if g["severity"] == CRITICAL],
        "warning_groups": [g for g in groups if g["severity"] == WARNING],
        "auto_fixes": [{"label": k, "count": v} for k, v in auto_fixes.items()],
        "mapping": mapped,
        "unmapped": [h for h in mapping.unmapped],
        "missing_quality": missing_quality,
        "problem_rows": problem_rows[:300],
        "geocoded_rows": geocoded,
        "corrected_csv": _corrected_csv(rows),
        "issues_csv": _issues_csv(rows),
    }


def store(result: dict, user_id: int) -> str:
    token = uuid.uuid4().hex
    cache.set(CACHE_PREFIX + token, {"user_id": user_id, "result": result}, CACHE_TTL)
    return token


def load(token: str, user_id: int):
    item = cache.get(CACHE_PREFIX + token)
    if not item or item.get("user_id") != user_id:
        return None
    return item["result"]
