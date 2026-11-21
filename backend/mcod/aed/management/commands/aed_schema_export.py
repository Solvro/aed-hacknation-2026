"""Generuje pliki wzorcowego zakresu danych AED z definicji maszynowej (data/aed/aed_schema.json):

- aed_wzorcowy_zakres.xlsx – opis pól dla ludzi (wymagany plik konkursowy),
- aed_szablon.csv – pusty szablon do wypełnienia przez dostawcę,
- aed_przyklad.csv – przykładowy, poprawny plik,
- aed_schema.json – kopia definicji maszynowej (Frictionless Table Schema).
"""
import csv
import json
import os
import shutil

from django.conf import settings
from django.core.management.base import BaseCommand
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from mcod.aed import schema
from mcod.aed.validation import ISSUE_MESSAGES

REQUIRED_LABELS = {
    "always": "obowiązkowe",
    "alt-location": "obowiązkowe (współrzędne LUB adres)",
    "recommended": "zalecane",
    "optional": "opcjonalne",
    "computed": "wyliczane ze współrzędnych przez portal",
}
TYPE_LABELS = {"string": "tekst", "number": "liczba dziesiętna", "boolean": "tak/nie", "date": "data RRRR-MM-DD"}
HEADER_FILL = PatternFill("solid", fgColor="C8102E")
HEADER_FONT = Font(bold=True, color="FFFFFF")

EXAMPLE_ROWS = [
    {
        "id_aed": "AED-0001", "szerokosc_geogr": "50.061947", "dlugosc_geogr": "19.936856", "miejscowosc": "Kraków",
        "ulica": "Rynek Główny", "nr_budynku": "1", "kod_pocztowy": "31-042", "nazwa_obiektu": "Sukiennice",
        "opis_lokalizacji": "Wejście od strony ul. Szewskiej, przy punkcie informacji", "dostep": "publiczny",
        "wewnatrz_budynku": "nie", "pietro": "0", "sposob_dostepu": "Szafka otwarta, bez klucza", "dysponent": "Urząd Miasta Krakowa",
        "telefon_kontaktowy": "+48 12 616 12 00", "data_weryfikacji": "2026-10-01", "teryt_terc": "",
        "producent": "Philips", "model": "HeartStart FRx", "data_przegladu": "2026-03-15",
        "waznosc_elektrod": "2028-05-31", "waznosc_baterii": "2029-12-31", "zdjecie_url": "",
    },
    {
        "id_aed": "AED-0002", "szerokosc_geogr": "", "dlugosc_geogr": "", "miejscowosc": "Kraków",
        "ulica": "Floriańska", "nr_budynku": "3", "kod_pocztowy": "31-019", "nazwa_obiektu": "Biblioteka miejska",
        "opis_lokalizacji": "Hol główny przy recepcji", "dostep": "klienci",
        "wewnatrz_budynku": "tak", "pietro": "0", "sposob_dostepu": "Klucz w recepcji", "dysponent": "", "telefon_kontaktowy": "", "data_weryfikacji": "2026-09-12", "teryt_terc": "", "teryt_simc": "",
        "producent": "", "model": "", "data_przegladu": "", "waznosc_elektrod": "", "waznosc_baterii": "", "zdjecie_url": "",
    },
]


class Command(BaseCommand):
    help = "Eksportuje wzorcowy zakres danych AED do XLSX i CSV"

    def add_arguments(self, parser):
        parser.add_argument("--out", default=os.path.join(str(settings.DATA_DIR), "aed", "export"))

    def handle(self, *args, **options):
        out = options["out"]
        os.makedirs(out, exist_ok=True)
        meta = schema.load_schema()
        names = schema.field_names()

        wb = Workbook()
        ws = wb.active
        ws.title = "Wzorcowy zakres"
        ws.append([meta["title"]])
        ws["A1"].font = Font(bold=True, size=14)
        ws.append([meta["description"]])
        ws.append([meta.get("x-location-rule", "")])
        ws.append([])
        header = ["Lp.", "Nazwa kolumny", "Opis pola", "Grupa", "Obowiązkowość", "Podnosi ocenę jakości", "Typ",
                  "Format / dozwolone wartości", "Przykład", "Opis szczegółowy", "Nazwy kolumn rozpoznawane automatycznie"]
        ws.append(header)
        header_row = ws.max_row
        for idx, f in enumerate(schema.fields(), start=1):
            constraints = f.get("constraints", {})
            allowed = ""
            if constraints.get("enum"):
                labels = f.get("x-enum-labels", {})
                allowed = "; ".join(f"{v} – {labels.get(v, '')}".strip(" –") for v in constraints["enum"])
            elif constraints.get("pattern"):
                allowed = "NN-NNN" if f["name"] == "kod_pocztowy" else constraints["pattern"]
            elif "minimum" in constraints:
                allowed = f"WGS84, zakres {constraints['minimum']}–{constraints['maximum']}"
            elif f.get("type") == "date":
                allowed = "RRRR-MM-DD"
            elif f.get("type") == "boolean":
                allowed = "tak / nie"
            ws.append([
                idx, f["name"], f.get("title", ""), f.get("x-group", ""), REQUIRED_LABELS.get(f.get("x-required"), ""),
                "tak" if (f.get("x-quality") or f.get("x-required") == "recommended") else "",
                TYPE_LABELS.get(f.get("type"), f.get("type")), allowed, f.get("example", ""), f.get("description", ""),
                ", ".join(f.get("x-synonyms", [])),
            ])
        for cell in ws[header_row]:
            cell.fill, cell.font = HEADER_FILL, HEADER_FONT
            cell.alignment = Alignment(wrap_text=True, vertical="center")
        widths = [5, 30, 34, 16, 26, 12, 16, 34, 22, 70, 50]
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[get_column_letter(i)].width = w
        for row in ws.iter_rows(min_row=header_row + 1):
            for cell in row:
                cell.alignment = Alignment(wrap_text=True, vertical="top")
        ws.freeze_panes = ws.cell(row=header_row + 1, column=3)

        rules = wb.create_sheet("Reguły walidacji")
        rules.append(["Kod", "Waga", "Komunikat dla dostawcy"])
        critical = {"NO_LOCATION", "INVALID_COORDS", "OUT_OF_POLAND", "DUPLICATE_ID", "ADDRESS_MISMATCH_CRITICAL"}
        info = {"ADDRESS_PARSED", "GEOCODED_COORDS", "GEOCODED_ADDRESS"}
        for code, msg in ISSUE_MESSAGES.items():
            level = "błąd krytyczny – wiersz nie trafia do agregatu" if code in critical else (
                "informacja – poprawka automatyczna" if code in info else "ostrzeżenie – obniża ocenę jakości")
            rules.append([code, level, msg])
        for cell in rules[1]:
            cell.fill, cell.font = HEADER_FILL, HEADER_FONT
        rules.column_dimensions["A"].width = 22
        rules.column_dimensions["B"].width = 44
        rules.column_dimensions["C"].width = 110

        agg = wb.create_sheet("Kolumny agregatu")
        agg.append(["Kolumna", "Opis", "Uwagi"])
        for c in meta.get("x-aggregate-columns", []):
            agg.append([c["name"], c.get("title", ""), c.get("description", "")])
        for cell in agg[1]:
            cell.fill, cell.font = HEADER_FILL, HEADER_FONT
        agg.column_dimensions["A"].width = 22
        agg.column_dimensions["B"].width = 40
        agg.column_dimensions["C"].width = 80

        example = wb.create_sheet("Przykład")
        example.append(names)
        for row in EXAMPLE_ROWS:
            example.append([row.get(n, "") for n in names])
        for cell in example[1]:
            cell.fill, cell.font = HEADER_FILL, HEADER_FONT

        xlsx_path = os.path.join(out, "aed_wzorcowy_zakres.xlsx")
        wb.save(xlsx_path)

        with open(os.path.join(out, "aed_szablon.csv"), "w", encoding="utf-8", newline="") as f:
            csv.writer(f).writerow(names)
        with open(os.path.join(out, "aed_przyklad.csv"), "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=names)
            writer.writeheader()
            writer.writerows(EXAMPLE_ROWS)
        shutil.copyfile(schema.schema_path(), os.path.join(out, "aed_schema.json"))
        json.loads(open(os.path.join(out, "aed_schema.json"), encoding="utf-8").read())
        self.stdout.write(self.style.SUCCESS(f"Zapisano: {xlsx_path}, aed_szablon.csv, aed_przyklad.csv, aed_schema.json w {out}"))
