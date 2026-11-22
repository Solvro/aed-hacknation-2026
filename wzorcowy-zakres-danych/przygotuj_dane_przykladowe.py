"""Przekształca prawdziwe, publicznie dostępne wykazy AED do wzorcowego zakresu danych.

Źródła: zbiory gmin w dane.gov.pl, strony i mapy urzędów miast, InPost, Uniwersytet Śląski
(surowe dane zebrane 2026-11-21, gałąź legacy-nextjs, katalog data/raw). Bez OpenStreetMap / OpenAEDMap:
współrzędne wyznaczone geokoderem opartym na OSM (Nominatim, ręczne poprawki z OSM) są pomijane –
taki wiersz zostaje z samym adresem, a współrzędne wyliczy portal (GUGiK).

Użycie:
  python przygotuj_dane_przykladowe.py <katalog_data_raw> [arkusz.xlsx]
Wynik: aed_dane_przykladowe.csv obok skryptu, a gdy podano arkusz – nowa zawartość arkusza „Przykładowe dane”
i arkusz „Źródła danych”.
"""
import csv
from copy import copy
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
COLS = ["id_aed", "szerokosc_geogr", "dlugosc_geogr", "miejscowosc", "ulica", "nr_budynku", "kod_pocztowy", "nazwa_obiektu",
        "opis_lokalizacji", "dostep", "dysponent", "data_weryfikacji", "wewnatrz_budynku", "pietro", "sposob_dostepu",
        "telefon_kontaktowy", "teryt_terc", "teryt_simc", "producent", "model", "data_przegladu", "waznosc_elektrod",
        "waznosc_baterii", "zdjecie_url"]

SOURCES = [  # klucz, prefiks id, wydawca, adres źródła, licencja
    ("dane.gov.pl", None, "Urzędy miast: Krosno, Marki, Przemyśl, Legionowo (zbiory w dane.gov.pl)",
     "https://dane.gov.pl/pl/dataset/3624 · /4955 · /4581 · /40593", "zgodnie z warunkami zbiorów w dane.gov.pl"),
    ("krakow.pl", "KRK-UMK", "Urząd Miasta Krakowa – „Krakowski IMPULS ŻYCIA AED”", "https://krakow.pl/3992,artykul,gdzie-znalezc-defibrylator-.html", "informacja publiczna"),
    ("arcgis-krakow-2022", "KRK-ARC", "Warstwa ArcGIS Online „AED_zestawy” (Kraków, 2022)", "services6.arcgis.com/w8Sm3ehkmwzR6bQc – AED_zestawy", "brak deklaracji"),
    ("inpost-aed", "INPOST", "InPost – AED w paczkomatach Helpbox 365", "https://inpost.pl/aed", "brak deklaracji"),
    ("lodz", "LDZ", "Urząd Miasta Łodzi – mapa defibrylatorów AED", "https://uml.lodz.pl/dla-mieszkancow/zdrowie/mapa-defibrylatorow-aed/", "brak deklaracji"),
    ("gdansk", "GDA", "Urząd Miasta Gdańska – wykaz defibrylatorów (2022)", "https://www.gdansk.pl/wiadomosci/Defibrylatory,a,216952", "informacja publiczna"),
    ("gliwice-gama", "GLI", "Miasto Gliwice – aplikacja GAMA", "https://gama.gliwice.eu", "brak deklaracji"),
    ("lublin", "LUB", "Urząd Miasta Lublin – wykaz AED", "https://lublin.eu/mieszkancy/zdrowie/aktualnosci/aed-w-lublinie,748,1345,1.html", "informacja publiczna"),
    ("torun", "TOR", "Urząd Miasta Torunia – wykaz miejskich AED", "https://torun.pl/pl/zdrowie/defibrylatory-aed-wykaz-lokalizacji", "informacja publiczna"),
    ("olsztyn", "OLS", "Miasto Olsztyn – mapa AED", "https://olsztyn.eu", "brak deklaracji"),
    ("koszalin", "KOS", "Miasto Koszalin – „Punkty Życia”", "https://koszalin.pl", "brak deklaracji"),
    ("us-edu", "US", "Uniwersytet Śląski w Katowicach – AED w budynkach uczelni", "https://us.edu.pl/bezpieczenstwo/defibrylatory-aed/", "informacja publiczna"),
    ("umap-jelenia-gora", "JGO", "Lokalizacja AED w Jeleniej Górze (uMap)", "umap.openstreetmap.fr/pl/map/lokalizacja-aed-w-jeleniej-gorze_1253792", "WTFPL"),
    ("arcgis-mikolow", "MIK", "Defibrylatory AED – Mikołów i okolice (ArcGIS Online)", "services9.arcgis.com/E1ZsJFZqsk2tR9yK – Defibrylatory_AED", "brak deklaracji"),
    ("umap-wejherowo", "WEJ", "Interaktywna mapa AED Wejherowo (uMap)", "umap.openstreetmap.fr/pl/map/interaktywna-mapa-aed-wejherowo_1469464", "brak deklaracji"),
    ("chelm", "CHE", "Urząd Miasta Chełm – AED w przestrzeni publicznej", "https://samorzad.gov.pl/web/miasto-chelm/defibrylatory-aed-w-miejskiej-przestrzeni-publicznej", "informacja publiczna"),
]
DGP_PREFIX = {"3624": "KROSNO", "4955": "MARKI", "4581": "PRZEMYSL", "40593": "LEGIONOWO"}
DGP_DYSP = {"3624": "", "4955": "", "4581": "", "40593": ""}
POSTCODE = re.compile(r"\b(\d{2}-\d{3})\b\s*([^\d,][^,]*)?")
STREET_IN_TEXT = re.compile(r"(?:ul\.|ulica|al\.|aleja|pl\.|plac|os\.|osiedle)\s*([A-ZŁŚŻŹĆŃÓ0-9][\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ .\-]*?)\s+(\d+[A-Za-z]?(?:/\d+)?)\b")
NUM = re.compile(r"^(.*?)[\s,]+(\d+[A-Za-z]?(?:[/-]\d+[A-Za-z]?)?)$")


def clean(s):
    s = re.sub(r"\s+", " ", str(s or "")).strip(" ,;–-")
    return s


def street_number(part):
    part = clean(re.sub(r"^(ul\.|ulica)\s*", "", clean(part), flags=re.I))
    part = re.sub(r"^(al|pl|os)\.\.?\s*", r"\1. ", part, flags=re.I)
    m = NUM.match(part)
    return (clean(m.group(1)), m.group(2)) if m else (part, "")


def parse_address(addr, city=""):
    """„ul. Floriańska 41, 30-001 Kraków” -> (miejscowość, ulica, nr, kod)."""
    addr = clean(addr)
    kod = ""
    m = POSTCODE.search(addr)
    if m:
        kod = m.group(1)
        if m.group(2) and not city:
            city = clean(m.group(2))
        addr = clean(addr[:m.start()] + addr[m.end():])
    elif city and addr.endswith(" " + city):
        addr = clean(addr[: -len(city)])
    first = addr.split(",")[0] if addr else ""
    ul, nr = street_number(first)
    if city and ul.lower() == city.lower():
        ul = ""
    return city, ul, nr, kod


def coords(r):
    g = (r.get("geocode") or {}).get("provider")
    if g in ("nominatim", "override"):  # wyznaczone na podstawie OSM – pomijamy
        return "", ""
    return round(float(r["lat"]), 6), round(float(r["lon"]), 6)


def indoor(v):
    return {"yes": "tak", "no": "nie"}.get((v or "").lower(), "")


def convert(raw_dir):
    rows, counts = [], {}
    for key, prefix, *_ in SOURCES:
        p = os.path.join(raw_dir, key + ".json")
        if not os.path.exists(p):
            continue
        recs = json.load(open(p, encoding="utf-8")).get("records") or []
        n = 0
        for i, r in enumerate(recs, 1):
            lat, lon = coords(r)
            raw = r.get("raw") or {}
            name, loc = clean(r.get("name")), clean(r.get("location"))
            city, ul, nr, kod = parse_address(r.get("address") or "", clean(r.get("city")))
            row = dict.fromkeys(COLS, "")
            row.update(szerokosc_geogr=lat, dlugosc_geogr=lon, miejscowosc=city, ulica=ul, nr_budynku=nr, kod_pocztowy=kod,
                       nazwa_obiektu=name, opis_lokalizacji=loc if len(loc) <= 160 else "", wewnatrz_budynku=indoor(r.get("indoor")),
                       sposob_dostepu=clean(r.get("opening_hours")))
            if not row["nr_budynku"]:  # ulica w nazwie lub opisie, np. „Szkoła…, ul. Przyszkole 42, 93-552 Łódź”
                for text in (name, loc, r.get("address") or ""):
                    mm = STREET_IN_TEXT.search(text or "")
                    if mm:
                        row.update(ulica=clean(mm.group(1)), nr_budynku=mm.group(2))
                        if text is name and mm.start() > 3:  # adres usuwamy z nazwy obiektu
                            row["nazwa_obiektu"] = clean(re.sub(r"[\s,(]+$", "", name[:mm.start()]))
                        pk = POSTCODE.search(text)
                        if pk and not row["kod_pocztowy"]:
                            row["kod_pocztowy"] = pk.group(1)
                        break
            if key == "dane.gov.pl":
                ds = r["sourceId"].split("/")[0].split(":")[0]
                row["id_aed"] = f"{DGP_PREFIX.get(ds, 'DGP')}-{raw.get('Numer Id') or i}"
                if ds == "40593":  # Legionowo: zbiór już w strukturze zbliżonej do wzorca
                    row.update(ulica=raw.get("nazwa_ulicy", ""), nr_budynku=raw.get("nr_budynku", ""), kod_pocztowy=raw.get("kod_pocztowy", ""),
                               miejscowosc=raw.get("miejscowosc", ""), teryt_terc=raw.get("kod_terc", ""), teryt_simc=raw.get("kod_simc", ""))
                    row["id_aed"] = f"LEGIONOWO-{i:03d}"
                if ds == "4581":
                    row["miejscowosc"] = row["miejscowosc"] or "Przemyśl"
                    mm = re.search(r"AED\s*(\d+)", name)
                    if mm:
                        row["id_aed"] = f"PRZEMYSL-AED{mm.group(1)}"
            elif key == "inpost-aed":
                c2, ul2, nr2, kod2 = parse_address(f"{raw.get('address_1', '')}, {raw.get('address_2', '')}", "")
                row.update(id_aed=f"INPOST-{r['sourceId']}", miejscowosc=c2 or city, ulica=ul2, nr_budynku=nr2, kod_pocztowy=kod2,
                           nazwa_obiektu=f"Paczkomat InPost {r['sourceId']} (Helpbox 365)", dostep="publiczny", dysponent="InPost sp. z o.o.",
                           wewnatrz_budynku="nie", sposob_dostepu="AED w skrytce paczkomatu, dostępny całodobowo")
            elif key == "koszalin":  # nazwa to „Punkt Życia #n”, opis w polu name
                desc = name
                parts = re.split(r"\s+[–-]\s+(?=ul\.|al\.|pl\.)", desc)
                row.update(nazwa_obiektu=clean(re.sub(r"\(.*?\)", "", parts[0])), opis_lokalizacji=desc if len(desc) <= 160 else "",
                           id_aed=f"KOS-{i:03d}")
                if len(parts) > 1:
                    _, ul, nr, _ = parse_address(parts[1], "Koszalin")
                    row.update(ulica=ul, nr_budynku=nr)
            elif key == "arcgis-mikolow":
                pi = clean(raw.get("Pietro"))
                row.update(pietro=pi, opis_lokalizacji=clean(raw.get("Położenie")),
                           wewnatrz_budynku="nie" if "zewn" in loc.lower() else ("tak" if "wewn" in loc.lower() else ""))
            elif key == "us-edu":
                row["dysponent"] = "Uniwersytet Śląski w Katowicach"
            elif key == "lodz" and loc.lower() in ("wewnątrz", "na zewnątrz"):
                row.update(opis_lokalizacji="", wewnatrz_budynku="tak" if loc.lower() == "wewnątrz" else "nie")
            if not row["id_aed"]:
                row["id_aed"] = f"{prefix}-{i:03d}"
            if not (row["szerokosc_geogr"] or (row["miejscowosc"] and row["nr_budynku"])):
                continue  # bez lokalizacji – taki wiersz walidator i tak by zablokował
            row["_zrodlo"] = key
            rows.append(row)
            n += 1
        counts[key] = n
    # unikalne id
    seen = {}
    for row in rows:
        k = row["id_aed"]
        if k in seen:
            seen[k] += 1
            row["id_aed"] = f"{k}-{seen[k]}"
        else:
            seen[k] = 1
    return rows, counts


def write_csv(rows):
    out = os.path.join(HERE, "aed_dane_przykladowe.csv")
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, COLS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    return out


def update_workbook(path, rows, counts):
    from openpyxl import load_workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

    wb = load_workbook(path)
    ws = wb["Przykładowe dane"]
    head_font = copy(ws.cell(row=1, column=1).font)
    head_fill = copy(ws.cell(row=1, column=1).fill)
    ws.delete_rows(2, ws.max_row)
    thin = Side(style="thin", color="D7E8DC")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    f = Font(name="Arial", size=10)
    src_name = {k: pub for k, _, pub, *_ in SOURCES}
    c = ws.cell(row=1, column=len(COLS) + 1, value="źródło (kolumna poza wzorcem)")
    c.font, c.fill, c.border = head_font, PatternFill("solid", fgColor="9DB3A4"), border
    c.alignment = Alignment(wrap_text=True, vertical="center")
    ws.column_dimensions[c.column_letter].width = 46
    for i, row in enumerate(rows, 2):
        for j, col in enumerate(COLS, 1):
            v = row[col]
            cell = ws.cell(row=i, column=j, value=v if v != "" else None)
            cell.font, cell.border = f, border
            if col in ("szerokosc_geogr", "dlugosc_geogr") and v != "":
                cell.number_format = "0.000000"
        cell = ws.cell(row=i, column=len(COLS) + 1, value=src_name[row["_zrodlo"]])
        cell.font, cell.border = Font(name="Arial", size=9, color="4A524D"), border
    ws.auto_filter.ref = f"A1:{ws.cell(row=1, column=len(COLS) + 1).column_letter}{len(rows) + 1}"
    ws.freeze_panes = "B2"

    if "Źródła danych" in wb.sheetnames:
        del wb["Źródła danych"]
    ws2 = wb.create_sheet("Źródła danych", wb.sheetnames.index("Przykładowe dane") + 1)
    ws2.sheet_properties.tabColor = "3F6B4F"
    hdr = ["Źródło", "Adres", "Licencja / status", "Wierszy w arkuszu"]
    for j, (h, w) in enumerate(zip(hdr, [58, 70, 34, 18]), 1):
        cell = ws2.cell(row=1, column=j, value=h)
        cell.font, cell.fill, cell.border = head_font, head_fill, border
        ws2.column_dimensions[cell.column_letter].width = w
    r = 2
    for key, _, pub, url, lic in SOURCES:
        if not counts.get(key):
            continue
        for j, v in enumerate([pub, url, lic, counts[key]], 1):
            cell = ws2.cell(row=r, column=j, value=v)
            cell.font, cell.border, cell.alignment = f, border, Alignment(wrap_text=True, vertical="top")
        r += 1
    ws2.cell(row=r, column=3, value="Razem").font = Font(name="Arial", size=10, bold=True)
    ws2.cell(row=r, column=4, value=len(rows)).font = Font(name="Arial", size=10, bold=True)
    notes = [
        "Prawdziwe, publicznie dostępne wykazy AED (stan pobrania: 2026-11-21) przekształcone do wzorcowego zakresu danych.",
        "Pokazują, jak różne dziś są dane: część źródeł podaje współrzędne, część tylko adres, prawie żadne nie podaje dostępności ani stanu urządzenia.",
        "Bez danych z OpenStreetMap / OpenAEDMap. Współrzędne wyznaczone geokoderem opartym na OSM pominięto – takie wiersze mają sam adres.",
        "Puste pola to braki w źródłach, nie w przekształceniu. Dane służą jako przykład wypełnienia wzorca, a nie jako zbiór do publikacji.",
    ]
    for k, t in enumerate(notes, r + 2):
        ws2.cell(row=k, column=1, value=t).font = Font(name="Arial", size=10, italic=True, color="3F6B4F")

    info = wb["Informacje"]
    for row in info.iter_rows():
        for cell in row:
            if isinstance(cell.value, str) and cell.value.startswith("Zakres danych – opis"):
                if "Źródła danych" not in cell.value:
                    cell.value = cell.value.replace("Przykładowe dane", f"Przykładowe dane ({len(rows)} prawdziwych AED) · Źródła danych")
    wb.save(path)


if __name__ == "__main__":
    rows, counts = convert(sys.argv[1])
    print("CSV:", write_csv(rows), "wierszy:", len(rows), counts)
    if len(sys.argv) > 2:
        update_workbook(sys.argv[2], rows, counts)
        print("arkusz:", sys.argv[2])
