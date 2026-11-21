"""Mapowanie kolumn pliku dostawcy na pola wzorcowego zakresu danych AED."""
from dataclasses import dataclass, field
from typing import Dict, List

from mcod.aed import schema
from mcod.aed.readers import GEOM_LAT, GEOM_LON

# Pola tekstowe, w których kolumna o stałej wartości (np. „Defibrylator” w każdym wierszu) nie niesie informacji
CONSTANT_SENSITIVE = {"nazwa_obiektu", "opis_lokalizacji", "dysponent"}


@dataclass
class ColumnMapping:
    fields: Dict[str, str] = field(default_factory=dict)  # pole wzorcowe -> kolumna źródłowa
    aux: Dict[str, str] = field(default_factory=dict)  # kolumna pomocnicza (adres, cecha_ulicy) -> kolumna źródłowa
    unmapped: List[str] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)

    def as_report(self) -> dict:
        report = {name: col for name, col in self.fields.items()}
        for name, col in self.aux.items():
            report[f"({name})"] = col
        return report


def _is_constant(rows: List[dict], column: str) -> bool:
    values = {str(r.get(column, "")).strip().lower() for r in rows if str(r.get(column, "")).strip()}
    return len(rows) >= 3 and len(values) == 1


def map_columns(headers: List[str], rows: List[dict]) -> ColumnMapping:
    mapping = ColumnMapping()
    used = set()
    normalized = {}
    for h in headers:
        if h in (GEOM_LON, GEOM_LAT):
            continue
        normalized.setdefault(schema.normalize_header(h), h)

    if GEOM_LON in headers and GEOM_LAT in headers:
        mapping.fields["dlugosc_geogr"] = GEOM_LON
        mapping.fields["szerokosc_geogr"] = GEOM_LAT
        used.update({GEOM_LON, GEOM_LAT})
        mapping.notes.append("Współrzędne odczytano z geometrii obiektów (GeoJSON).")

    def try_assign(field_name: str, column: str) -> bool:
        if column in used:
            return False
        if field_name in CONSTANT_SENSITIVE and _is_constant(rows, column):
            mapping.notes.append(
                f"Kolumna „{column}” ma tę samą wartość we wszystkich wierszach – pominięto ją jako „{field_name}”."
            )
            used.add(column)
            return False
        mapping.fields[field_name] = column
        used.add(column)
        return True

    # Przebieg 1: dokładne dopasowanie synonimów (w kolejności priorytetu)
    for f in schema.fields():
        if f["name"] in mapping.fields:
            continue
        for syn in f.get("x-synonyms", [f["name"]]):
            col = normalized.get(syn)
            if col and try_assign(f["name"], col):
                break

    aux_defs = schema.aux_columns()
    for aux_name, synonyms in aux_defs.items():
        for syn in synonyms:
            col = normalized.get(syn)
            if col and col not in used:
                mapping.aux[aux_name] = col
                used.add(col)
                break

    # Przebieg 2: dopasowanie częściowe (np. „szerokosc_geograficzna_wgs84”)
    for f in schema.fields():
        if f["name"] in mapping.fields:
            continue
        for syn in f.get("x-synonyms", []):
            if len(syn) < 4:
                continue
            for norm, col in normalized.items():
                if col in used:
                    continue
                tokens = norm.split("_")
                if norm.startswith(syn + "_") or (syn in tokens and len(tokens) <= 3):
                    if try_assign(f["name"], col):
                        mapping.notes.append(f"Kolumnę „{col}” dopasowano częściowo jako „{f['name']}”.")
                        break
            if f["name"] in mapping.fields:
                break

    mapping.unmapped = [h for h in headers if h not in used and h not in (GEOM_LON, GEOM_LAT)]
    return mapping
