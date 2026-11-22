"""Generuje arkusz „Wzorcowy zakres danych o defibrylatorach AED” (xlsx) z backend/data/aed/aed_schema.json.

Użycie:  pip install openpyxl && python wzorcowy-zakres-danych/generuj_arkusz.py
Wynik:   wzorcowy-zakres-danych/aed_wzorcowy_zakres_danych.xlsx
"""
import json
import os

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCHEMA = json.load(open(os.path.join(ROOT, "backend", "data", "aed", "aed_schema.json"), encoding="utf-8"))
OUT = os.path.join(HERE, "aed_wzorcowy_zakres_danych.xlsx")

# kolory z księgi znaku „Zdefibryluj Dane”
RED, RED_SOFT, GREEN, GREEN_FILL, LINE, INK, AMBER_SOFT, GREY = "E0144A", "FCE7ED", "3F6B4F", "EDF5EF", "D7E8DC", "1A1D1B", "FFF4DC", "F2F2F2"
F = "Arial"
thin = Side(style="thin", color=LINE)
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)
WRAP = Alignment(wrap_text=True, vertical="top")
HEAD_FONT = Font(name=F, bold=True, color="FFFFFF", size=11)
HEAD_FILL = PatternFill("solid", fgColor=GREEN)

REQ = {  # x-required -> (etykieta, kolor wiersza)
    "alt-location": ("WYMAGANE: współrzędne LUB pełny adres", RED_SOFT),
    "recommended": ("zalecane", AMBER_SOFT),
    "optional": ("opcjonalne", "FFFFFF"),
    "computed": ("wylicza portal (nie trzeba podawać)", GREEN_FILL),
}
TYPE = {"string": "tekst", "number": "liczba dziesiętna", "date": "data RRRR-MM-DD", "boolean": "tak / nie", "integer": "liczba całkowita"}
GROUP = {"identyfikacja": "Identyfikacja", "lokalizacja": "Lokalizacja", "dostępność": "Dostępność",
         "odpowiedzialność": "Odpowiedzialność", "urządzenie": "Urządzenie"}

RULES = [
    ("NO_LOCATION", "blokuje wiersz", "Brak lokalizacji: podaj współrzędne albo pełny adres (miejscowość i numer budynku)."),
    ("INVALID_COORDS", "blokuje wiersz", "Współrzędne nie są liczbami – użyj stopni dziesiętnych z kropką, np. 50.0619."),
    ("OUT_OF_POLAND", "blokuje wiersz", "Współrzędne wskazują punkt poza Polską – sprawdź układ (wymagany WGS84) i kolejność wartości."),
    ("DUPLICATE_ID", "blokuje wiersz", "Identyfikator AED powtarza się w pliku – każdy wiersz musi mieć unikalny identyfikator."),
    ("ADDRESS_MISMATCH_CRITICAL", "blokuje wiersz", "Adres i współrzędne różnią się o ponad 5 km – wiersz wstrzymany do wyjaśnienia."),
    ("ADDRESS_MISMATCH", "ostrzeżenie", "Adres i współrzędne różnią się o ponad 150 m."),
    ("NO_ID", "ostrzeżenie", "Brak stałego identyfikatora AED – portal wylicza go z lokalizacji. Dodaj kolumnę id_aed."),
    ("ADDRESS_INCOMPLETE", "ostrzeżenie", "Niepełny adres (brak miejscowości lub numeru budynku)."),
    ("INVALID_POSTCODE", "ostrzeżenie", "Kod pocztowy powinien mieć format NN-NNN."),
    ("INVALID_VALUE", "ostrzeżenie", "Nieprawidłowa wartość pola (np. spoza słownika)."),
    ("STALE_VERIFICATION", "ostrzeżenie", "Ostatnia weryfikacja urządzenia była ponad 12 miesięcy temu."),
    ("EXPIRED_ELECTRODES", "ostrzeżenie", "Upłynęła data ważności elektrod."),
    ("EXPIRED_BATTERY", "ostrzeżenie", "Upłynęła data ważności baterii."),
    ("GEOCODE_FAILED", "ostrzeżenie", "Nie udało się zweryfikować adresu w usłudze GUGiK."),
    ("TERYT_RECOMPUTED", "informacja", "Kod TERYT podany przez dostawcę różni się od wyliczonego – w agregacie użyto kodu wyliczonego."),
    ("COORDS_SWAPPED", "poprawka automatyczna", "Szerokość i długość geograficzna były zamienione miejscami – poprawiono."),
    ("GEOCODED_COORDS", "poprawka automatyczna", "Współrzędne uzupełniono na podstawie adresu (GUGiK)."),
    ("GEOCODED_ADDRESS", "poprawka automatyczna", "Adres uzupełniono na podstawie współrzędnych (GUGiK)."),
    ("ADDRESS_PARSED", "poprawka automatyczna", "Adres z jednej kolumny rozdzielono na pola wzorcowe."),
]
RULE_FILL = {"blokuje wiersz": RED_SOFT, "ostrzeżenie": AMBER_SOFT, "informacja": "FFFFFF", "poprawka automatyczna": GREEN_FILL}

# dane przykładowe (fikcyjne urządzenia, prawdziwe miejscowości)
EXAMPLES = [
    ["AED-0001", 50.061947, 19.936856, "Kraków", "Rynek Główny", "1", "31-042", "Sukiennice", "Wejście od ul. Szewskiej, przy punkcie informacji",
     "publiczny", "Urząd Miasta Krakowa", "2026-10-01", "nie", "0", "Szafka otwarta, bez klucza", "+48 12 616 12 00", "", "",
     "Philips", "HeartStart FRx", "2026-03-15", "2028-05-31", "2029-12-31", ""],
    ["AED-0002", "", "", "Kraków", "Floriańska", "3", "31-019", "Biblioteka miejska", "Hol główny przy recepcji",
     "klienci", "Biblioteka Kraków", "2026-09-12", "tak", "0", "Klucz w recepcji", "", "", "", "", "", "", "", "", ""],
    ["KR-017", 49.68390, 21.77110, "", "", "", "", "Hala sportowa MOSiR", "Szafka na elewacji, po prawej od wejścia",
     "publiczny", "MOSiR Krosno", "2026-06-30", "nie", "", "Szafka z alarmem, otwarta całodobowo", "", "", "", "", "", "", "", "", ""],
    ["WAW-PKIN-2", 52.231800, 21.006000, "Warszawa", "plac Defilad", "1", "00-901", "Pałac Kultury i Nauki", "Hol główny, przy szatni",
     "publiczny", "Zarząd PKiN", "2026-08-20", "tak", "0", "W godzinach otwarcia obiektu", "+48 22 656 76 00", "", "",
     "ZOLL", "AED Plus", "2026-02-10", "2027-11-30", "2030-01-31", ""],
    ["GD-ZAKL-01", "", "", "Gdańsk", "Marynarki Polskiej", "130", "80-557", "Zakład produkcyjny, budynek B", "Portiernia przy bramie nr 2",
     "pracownicy", "Przykładowa Spółka S.A.", "2025-09-01", "tak", "0", "Klucz u ochrony", "", "", "", "", "", "", "", "", ""],
]


def head(ws, row, values, widths=None):
    for c, v in enumerate(values, 1):
        cell = ws.cell(row=row, column=c, value=v)
        cell.font, cell.fill, cell.border = HEAD_FONT, HEAD_FILL, BORDER
        cell.alignment = Alignment(wrap_text=True, vertical="center")
    ws.row_dimensions[row].height = 32
    if widths:
        for c, w in enumerate(widths, 1):
            ws.column_dimensions[get_column_letter(c)].width = w


def body(ws, row, values, fill="FFFFFF", bold_first=False):
    for c, v in enumerate(values, 1):
        cell = ws.cell(row=row, column=c, value=v)
        cell.font = Font(name=F, size=10, bold=bold_first and c == 2)
        cell.fill, cell.border, cell.alignment = PatternFill("solid", fgColor=fill), BORDER, WRAP


def fmt(f):
    c = f.get("constraints", {})
    if "enum" in c:
        labels = f.get("x-enum-labels", {})
        return "; ".join(f"{v} – {labels.get(v, '')}".rstrip(" –") for v in c["enum"])
    if f["type"] == "number" and "minimum" in c:
        return f"WGS84, zakres {c['minimum']}–{c['maximum']}"
    if f["name"] == "kod_pocztowy":
        return "NN-NNN"
    if f["type"] == "date":
        return "RRRR-MM-DD (ISO 8601)"
    if f["type"] == "boolean":
        return "tak / nie (także 1/0, true/false)"
    if f.get("format") == "uri":
        return "adres URL (https://…)"
    if f["name"].startswith("teryt"):
        return "7 cyfr (TERC) / 7 cyfr (SIMC)"
    return ""


wb = Workbook()

# --- 1. Informacje ---------------------------------------------------------------------------
ws = wb.active
ws.title = "Informacje"
ws.sheet_view.showGridLines = False
ws.column_dimensions["A"].width = 3
ws.column_dimensions["B"].width = 34
ws.column_dimensions["C"].width = 100
ws["B2"] = SCHEMA["title"]
ws["B2"].font = Font(name=F, size=20, bold=True, color=INK)
ws["B3"] = "do udostępniania w portalu dane.gov.pl · akcja „Zdefibryluj Dane” · Daj impuls. Udostępnij dane o AED."
ws["B3"].font = Font(name=F, size=11, bold=True, color=GREEN)
info = [
    ("Wersja", f"{SCHEMA['version']} (2026-11-22)"),
    ("Cel", "Jeden wzór dla wszystkich dysponentów danych o defibrylatorach AED (gminy, szkoły, straż, szpitale, firmy), "
            "żeby dane z wielu źródeł można było połączyć w Ogólnopolski zbiór AED w portalu dane.gov.pl."),
    ("Co jest wymagane", "Tylko lokalizacja: współrzędne geograficzne WGS84 (szerokosc_geogr i dlugosc_geogr) LUB pełny adres "
            "(miejscowosc, ulica, nr_budynku, kod_pocztowy). Brakującą część portal uzupełnia sam (usługi GUGiK), "
            "a gdy podano obie, sprawdza ich zgodność."),
    ("Dlaczego reszta jest opcjonalna", "Idealnie byłoby mieć wszystkie pola, ale najważniejsze są podstawowe. Pozostałe pola są opcjonalne, "
            "żeby nie ograniczać importu i nie zniechęcać instytucji, które mają tylko część danych. Kolumny o urządzeniu "
            "(przegląd, elektrody, bateria) są bardzo przydatne, ale wypełnią je raczej sprzedawcy i serwisanci AED, "
            "gdy zaczną udostępniać dane w portalu."),
    ("Zalecane", "Stały identyfikator id_aed – dzięki niemu portal rozpoznaje to samo urządzenie w kolejnych wersjach pliku."),
    ("Wyliczane przez portal", "Kody TERYT (teryt_terc, teryt_simc) portal wylicza ze współrzędnych – nie trzeba ich podawać."),
    ("Format pliku", "CSV (UTF-8, separator przecinek), XLSX, XLS, ODS, GeoJSON lub JSON. Separator dziesiętny: kropka "
            "(przecinek też jest akceptowany). Daty: RRRR-MM-DD. Nazwy kolumn jak w arkuszu „Zakres danych” – inne popularne "
            "nazwy (np. lat, lon, adres) portal rozpozna automatycznie."),
    ("Licencja", "Zbiór powinien mieć licencję CC0 lub CC BY 4.0 (licencje portalu dane.gov.pl), żeby mógł trafić do agregatu."),
    ("Jak opublikować", "1) Zaloguj się do panelu dostawcy dane.gov.pl.  2) Opcjonalnie sprawdź plik: menu „Ogólnopolski zbiór AED” → "
            "„Sprawdź plik przed publikacją”.  3) W zbiorze zaznacz „Zbiór danych o defibrylatorach AED” i dodaj zasób.  "
            "4) Sprawdź zakładkę „Raport AED”.  5) Przy zmianach dodaj nową wersję pliku – zmienią się tylko Twoje wiersze."),
    ("Arkusze", "Zakres danych – opis 24 pól · Szablon – pusty arkusz do wypełnienia · Przykładowe dane · Słowniki · "
            "Reguły walidacji · Kolumny agregatu (dodawane przez portal)."),
]
r = 5
for k, v in info:
    ws.cell(row=r, column=2, value=k).font = Font(name=F, size=11, bold=True, color=INK)
    c = ws.cell(row=r, column=3, value=v)
    c.font, c.alignment = Font(name=F, size=11), WRAP
    ws.cell(row=r, column=2).alignment = WRAP
    ws.row_dimensions[r].height = max(18, 16 * (len(v) // 95 + 1))
    r += 1
r += 1
ws.cell(row=r, column=2, value="Legenda kolorów").font = Font(name=F, size=11, bold=True, color=INK)
for key in ("alt-location", "recommended", "optional", "computed"):
    lab, col = REQ[key]
    c = ws.cell(row=r, column=3, value=lab)
    c.fill, c.border, c.font = PatternFill("solid", fgColor=col), BORDER, Font(name=F, size=10)
    r += 1

# --- 2. Zakres danych ------------------------------------------------------------------------
ws = wb.create_sheet("Zakres danych")
head(ws, 1, ["Lp.", "Kolumna", "Nazwa pola", "Grupa", "Obowiązkowość", "Typ", "Format / dozwolone wartości", "Przykład", "Opis",
             "Inne rozpoznawane nazwy kolumn"], [5, 22, 30, 16, 26, 16, 34, 20, 60, 44])
for i, f in enumerate(SCHEMA["fields"], 1):
    lab, col = REQ.get(f.get("x-required"), ("opcjonalne", "FFFFFF"))
    body(ws, i + 1, [i, f["name"], f["title"], GROUP.get(f.get("x-group"), f.get("x-group")), lab, TYPE.get(f["type"], f["type"]),
                     fmt(f), f.get("example", ""), f.get("description", ""),
                     ", ".join(s for s in f.get("x-synonyms", []) if s != f["name"])], col, bold_first=True)
ws.freeze_panes = "C2"
ws.auto_filter.ref = f"A1:J{len(SCHEMA['fields']) + 1}"

# --- 3. Szablon ------------------------------------------------------------------------------
ws = wb.create_sheet("Szablon")
names = [f["name"] for f in SCHEMA["fields"]]
head(ws, 1, names, [max(14, len(n) + 4) for n in names])
for c, f in enumerate(SCHEMA["fields"], 1):
    cell = ws.cell(row=1, column=c)
    lab, col = REQ.get(f.get("x-required"), ("opcjonalne", "FFFFFF"))
    if f.get("x-required") == "alt-location":
        cell.fill = PatternFill("solid", fgColor=RED)
    elif f.get("x-required") == "computed":
        cell.fill = PatternFill("solid", fgColor="9DB3A4")
    note = f"{f['title']}\n{lab}\n{fmt(f) or TYPE.get(f['type'], '')}\nnp. {f.get('example', '')}".strip()
    cell.comment = Comment(note, "Zdefibryluj Dane", width=260, height=120)
    letter = get_column_letter(c)
    for rr in range(2, 502):  # kolumny tekstowe jako tekst, żeby Excel nie zmieniał dat i kodów
        if f["type"] != "number":
            ws[f"{letter}{rr}"].number_format = "@"
ws.freeze_panes = "B2"
col = {n: get_column_letter(i) for i, n in enumerate(names, 1)}
dv = DataValidation(type="list", formula1='"publiczny,klienci,pracownicy"', allow_blank=True)
dv.error, dv.errorTitle = "Wybierz: publiczny, klienci albo pracownicy", "Dostęp"
dv.add(f"{col['dostep']}2:{col['dostep']}501")
dv2 = DataValidation(type="list", formula1='"tak,nie"', allow_blank=True)
dv2.add(f"{col['wewnatrz_budynku']}2:{col['wewnatrz_budynku']}501")
lat = DataValidation(type="decimal", operator="between", formula1="49", formula2="54.9", allow_blank=True)
lat.error, lat.errorTitle = "Szerokość geograficzna w Polsce: 49.0–54.9 (WGS84)", "Współrzędne"
lat.add(f"{col['szerokosc_geogr']}2:{col['szerokosc_geogr']}501")
lon = DataValidation(type="decimal", operator="between", formula1="14.1", formula2="24.2", allow_blank=True)
lon.error, lon.errorTitle = "Długość geograficzna w Polsce: 14.1–24.2 (WGS84)", "Współrzędne"
lon.add(f"{col['dlugosc_geogr']}2:{col['dlugosc_geogr']}501")
for d in (dv, dv2, lat, lon):
    d.showErrorMessage = True
    ws.add_data_validation(d)

# --- 4. Przykładowe dane ---------------------------------------------------------------------
ws = wb.create_sheet("Przykładowe dane")
head(ws, 1, names, [max(14, len(n) + 4) for n in names])
for i, row in enumerate(EXAMPLES, 2):
    body(ws, i, row)
    for c in range(1, len(names) + 1):
        ws.cell(row=i, column=c).alignment = Alignment(vertical="top")
n = len(EXAMPLES) + 3
ws.cell(row=n, column=1, value="Dane fikcyjne. Wiersz 2: komplet pól. Wiersz 3: tylko adres – współrzędne uzupełni portal. "
        "Wiersz 4: tylko współrzędne – adres uzupełni portal. Wiersz 6: dostęp tylko dla pracowników.").font = Font(name=F, size=10, italic=True, color=GREEN)
ws.freeze_panes = "B2"

# --- 5. Słowniki -----------------------------------------------------------------------------
ws = wb.create_sheet("Słowniki")
head(ws, 1, ["Kolumna", "Wartość", "Znaczenie"], [22, 16, 60])
rows, r = [], 2
for f in SCHEMA["fields"]:
    for v in f.get("constraints", {}).get("enum", []):
        rows.append((f["name"], v, f.get("x-enum-labels", {}).get(v, "")))
    if f["type"] == "boolean":
        rows += [(f["name"], "tak", "prawda (akceptowane też: 1, true, t, yes)"), (f["name"], "nie", "fałsz (akceptowane też: 0, false, n)")]
for row in rows:
    body(ws, r, list(row))
    r += 1

# --- 6. Reguły walidacji ---------------------------------------------------------------------
ws = wb.create_sheet("Reguły walidacji")
head(ws, 1, ["Kod", "Skutek", "Komunikat dla dostawcy"], [28, 22, 100])
for i, (k, w, m) in enumerate(RULES, 2):
    body(ws, i, [k, w, m], RULE_FILL[w])

# --- 7. Kolumny agregatu ---------------------------------------------------------------------
ws = wb.create_sheet("Kolumny agregatu")
head(ws, 1, ["Kolumna", "Nazwa", "Opis"], [28, 40, 90])
for i, c in enumerate(SCHEMA["x-aggregate-columns"], 2):
    body(ws, i, [c["name"], c["title"], c.get("description", "")], GREEN_FILL)
ws.cell(row=len(SCHEMA["x-aggregate-columns"]) + 3, column=1,
        value="Te kolumny dodaje portal w Ogólnopolskim zbiorze AED – dostawca ich nie wypełnia.").font = Font(name=F, size=10, italic=True, color=GREEN)

for s in wb.worksheets:
    s.sheet_properties.tabColor = RED if s.title in ("Zakres danych", "Szablon") else GREEN
wb.properties.title = SCHEMA["title"]
wb.properties.creator = "Zdefibryluj Dane – HackNation 2026"
wb.save(OUT)
print("zapisano", OUT)
