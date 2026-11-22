"""Wpisuje do arkusza „Przykładowe dane” to, co portal uzupełnia sam (wynik mcod.aed.geocoding.enrich).

Uzupełnienia: kody TERYT (teryt_terc z ULDK, teryt_simc z UUG), współrzędne z adresu, adres i kod pocztowy
ze współrzędnych, poprawione zamienione współrzędne. Komórki uzupełnione przez portal mają zielone tło
(kolor „zieleń wypełnienia” z księgi znaku).

Użycie:
  1) w kontenerze portalu: wynik enrich dla aed_dane_przykladowe.csv -> aed_enriched.json
  2) python wpisz_uzupelnienia_portalu.py aed_enriched.json arkusz.xlsx
"""
import csv
import json
import os
import sys

from openpyxl import load_workbook
from openpyxl.styles import PatternFill

HERE = os.path.dirname(os.path.abspath(__file__))
GREEN = PatternFill("solid", fgColor="EDF5EF")


def same(a, b):
    try:
        return abs(float(a) - float(b)) < 1e-6
    except (TypeError, ValueError):
        return str(a or "").strip() == str(b or "").strip()


def main(enriched_path, xlsx_path):
    enriched = json.load(open(enriched_path, encoding="utf-8"))
    src = list(csv.DictReader(open(os.path.join(HERE, "aed_dane_przykladowe.csv"), encoding="utf-8")))
    enriched = enriched + [None] * (len(src) - len(enriched))  # wynik może być częściowy
    wb = load_workbook(xlsx_path)
    ws = wb["Przykładowe dane"]
    header = [c.value for c in ws[1]]
    by_id = {ws.cell(row=r, column=1).value: r for r in range(2, ws.max_row + 1)}
    stats = {}
    out_rows = []
    for orig, item in zip(src, enriched):
        if item is None:
            out_rows.append(orig)
            continue
        vals = item["values"]
        r = by_id.get(orig["id_aed"])
        if r is None:
            out_rows.append(orig)
            continue
        for j, col in enumerate(header, 1):
            if col not in vals:
                continue
            new, old = vals[col], orig.get(col, "")
            if new in ("", None) or same(new, old):
                continue
            # podane przez dostawcę teksty zostają (normalizacja zapisu to nie uzupełnienie);
            # zmieniamy puste pola, kody TERYT i współrzędne (zamiana szer./dł.)
            if old not in ("", None) and col not in ("teryt_terc", "teryt_simc", "szerokosc_geogr", "dlugosc_geogr"):
                continue
            cell = ws.cell(row=r, column=j)
            if col in ("szerokosc_geogr", "dlugosc_geogr"):
                new = round(float(new), 6)
                cell.number_format = "0.000000"
            cell.value = new
            cell.fill = GREEN
            stats[col] = stats.get(col, 0) + 1
        out_rows.append(dict(orig, **{k: v for k, v in vals.items() if v not in ("", None)}))
    wb.save(xlsx_path)
    with open(os.path.join(HERE, "aed_dane_przykladowe.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, list(src[0].keys()))
        w.writeheader()
        w.writerows(out_rows)
    print("uzupełnione komórki:", stats, "razem:", sum(stats.values()))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
