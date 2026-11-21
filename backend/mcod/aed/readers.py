"""Czytanie wierszy z zasobów dostawców w formatach dopuszczanych przez portal.

CSV/TSV, XLSX/XLS/ODS, GeoJSON i JSON. Portal wykrywa format i kodowanie zasobu (`ResourceFile.format`,
`ResourceFile.encoding`), ale GeoJSON/JSON tylko rozpoznaje – parsujemy je tutaj. Czytnik jest odporny na
typowe problemy plików publikowanych przez gminy (BOM, cp1250, średnik jako separator, cały wiersz ujęty
w cudzysłów).
"""
import csv
import hashlib
import io
import json
import logging
import os
from dataclasses import dataclass, field
from typing import List, Optional

logger = logging.getLogger("mcod")

TABULAR_FORMATS = ("csv", "tsv", "xlsx", "xls", "ods")
JSON_FORMATS = ("geojson", "json")
SUPPORTED_FORMATS = TABULAR_FORMATS + JSON_FORMATS
# Kolejność wyboru zasobu źródłowego w zbiorze AED (niższa = lepsza)
FORMAT_PRIORITY = {"csv": 0, "xlsx": 0, "xls": 1, "ods": 1, "tsv": 1, "geojson": 2, "json": 3}

GEOM_LON = "__geom_lon"
GEOM_LAT = "__geom_lat"

ENCODINGS = ("utf-8-sig", "cp1250", "iso-8859-2", "utf-16")


class ReaderError(Exception):
    pass


@dataclass
class ReadResult:
    headers: List[str]
    rows: List[dict]
    file_format: str
    encoding: str = ""
    notes: List[str] = field(default_factory=list)


def file_sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def detect_format(path: str, declared: Optional[str] = None) -> str:
    declared = (declared or "").lower().strip(".")
    if declared in SUPPORTED_FORMATS:
        if declared == "json":
            # GeoJSON bywa deklarowany jako json
            try:
                with open(path, "rb") as f:
                    head = f.read(2048).decode("utf-8", "ignore")
                if '"FeatureCollection"' in head or '"Feature"' in head:
                    return "geojson"
            except OSError:
                pass
        return declared
    ext = os.path.splitext(path)[1].lower().strip(".")
    if ext in SUPPORTED_FORMATS:
        return ext
    raise ReaderError(f"Nieobsługiwany format pliku: {declared or ext or 'nieznany'}")


def _decode(raw: bytes, declared_encoding: Optional[str]) -> (str, str):
    candidates = []
    if declared_encoding:
        candidates.append(declared_encoding)
    candidates.extend(e for e in ENCODINGS if e not in candidates)
    for enc in candidates:
        try:
            text = raw.decode(enc)
            if enc.lower().replace("-", "") in ("utf8", "utf8sig") or enc == "utf-8-sig":
                text = text.lstrip("﻿")
            return text.lstrip("﻿"), enc
        except (UnicodeDecodeError, LookupError):
            continue
    raise ReaderError("Nie udało się rozpoznać kodowania pliku (zalecane UTF-8)")


def _sniff_delimiter(sample: str, default: str = ",") -> str:
    try:
        return csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
    except csv.Error:
        counts = {d: sample.count(d) for d in (";", ",", "\t", "|")}
        best = max(counts, key=counts.get)
        return best if counts[best] else default


def read_csv_text(text: str, delimiter: Optional[str] = None) -> ReadResult:
    notes = []
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [ln for ln in text.split("\n") if ln.strip()]
    if not lines:
        raise ReaderError("Plik jest pusty")
    delimiter = delimiter or _sniff_delimiter("\n".join(lines[:20]))
    rows = list(csv.reader(lines, delimiter=delimiter))
    # Naprawa plików, w których cały wiersz jest ujęty w cudzysłów (np. "a,b,c")
    if rows and all(len(r) == 1 for r in rows[: min(len(rows), 10)]) and "," in rows[0][0] + ";":
        inner_delim = _sniff_delimiter("\n".join(r[0] for r in rows[:20]))
        if any(inner_delim in r[0] for r in rows[:5]):
            rows = [next(csv.reader([r[0]], delimiter=inner_delim, skipinitialspace=True)) for r in rows]
            notes.append("Każdy wiersz pliku był ujęty w cudzysłów – plik naprawiono automatycznie.")
    header = [h.strip() for h in rows[0]]
    data = []
    for r in rows[1:]:
        if not any(c.strip() for c in r):
            continue
        r = [c.strip() for c in r] + [""] * max(0, len(header) - len(r))
        data.append({header[i] if i < len(header) else f"kolumna_{i + 1}": r[i] for i in range(max(len(header), len(r)))})
    return ReadResult(headers=header, rows=data, file_format="csv", notes=notes)


def read_csv(path: str, encoding: Optional[str] = None, delimiter: Optional[str] = None) -> ReadResult:
    with open(path, "rb") as f:
        raw = f.read()
    text, enc = _decode(raw, encoding)
    result = read_csv_text(text, delimiter=delimiter)
    result.encoding = enc
    return result


def _cell(value) -> str:
    if value is None:
        return ""
    if hasattr(value, "isoformat"):
        return value.isoformat()[:10] if getattr(value, "hour", 0) == 0 else value.isoformat()
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def read_excel(path: str, file_format: str) -> ReadResult:
    if file_format == "xlsx":
        import openpyxl

        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        ws = wb.worksheets[0]
        values = [[_cell(c) for c in row] for row in ws.iter_rows(values_only=True)]
    else:
        import pandas as pd

        engine = "odf" if file_format == "ods" else None
        df = pd.read_excel(path, sheet_name=0, header=None, dtype=str, engine=engine)
        values = [[_cell(v) if str(v) != "nan" else "" for v in row] for row in df.values.tolist()]
    values = [r for r in values if any(c for c in r)]
    if not values:
        raise ReaderError("Arkusz jest pusty")
    header = [h.strip() for h in values[0]]
    rows = []
    for r in values[1:]:
        rows.append({header[i] or f"kolumna_{i + 1}": (r[i] if i < len(r) else "") for i in range(len(header))})
    return ReadResult(headers=header, rows=rows, file_format=file_format)


def _flatten_value(value):
    if value is None:
        return ""
    if isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, list):
        if value and isinstance(value[0], dict):
            for key in ("url", "href", "thumbUrl", "src"):
                if value[0].get(key):
                    return value[0][key]
        if all(isinstance(v, (str, int, float)) for v in value):
            return ", ".join(str(v) for v in value)
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def _point_from_geometry(geometry) -> Optional[tuple]:
    if not isinstance(geometry, dict):
        return None
    coords = geometry.get("coordinates")
    gtype = geometry.get("type")
    try:
        if gtype == "Point":
            return float(coords[0]), float(coords[1])
        if gtype == "MultiPoint" and coords:
            return float(coords[0][0]), float(coords[0][1])
    except (TypeError, ValueError, IndexError):
        return None
    return None


def _rows_from_features(features) -> List[dict]:
    rows = []
    for feat in features:
        if not isinstance(feat, dict):
            continue
        props = feat.get("properties") or {}
        row = {k: _flatten_value(v) for k, v in props.items()}
        point = _point_from_geometry(feat.get("geometry"))
        if point:
            row[GEOM_LON], row[GEOM_LAT] = point
        rows.append(row)
    return rows


def _find_records(data):
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("data", "results", "result", "records", "items", "features", "aed", "defibrylatory"):
            val = data.get(key)
            if isinstance(val, list):
                return val
            if isinstance(val, dict):
                found = _find_records(val)
                if found:
                    return found
        for val in data.values():
            if isinstance(val, list) and val and isinstance(val[0], dict):
                return val
    return []


def read_json(path: str, encoding: Optional[str] = None) -> ReadResult:
    with open(path, "rb") as f:
        raw = f.read()
    text, enc = _decode(raw, encoding)
    try:
        data = json.loads(text)
    except ValueError as exc:
        raise ReaderError(f"Niepoprawny JSON: {exc}")
    if isinstance(data, dict) and data.get("type") == "FeatureCollection":
        rows = _rows_from_features(data.get("features") or [])
        fmt = "geojson"
    else:
        records = _find_records(data)
        if records and isinstance(records[0], dict) and records[0].get("type") == "Feature":
            rows = _rows_from_features(records)
            fmt = "geojson"
        else:
            rows = []
            for rec in records:
                if not isinstance(rec, dict):
                    continue
                row = {}
                for k, v in rec.items():
                    if k in ("geometry", "geometria") and isinstance(v, dict):
                        point = _point_from_geometry(v)
                        if point:
                            row[GEOM_LON], row[GEOM_LAT] = point
                        continue
                    if k in ("coordinates", "wspolrzedne") and isinstance(v, list):
                        # np. API m.st. Warszawy: [[lon, lat]]
                        try:
                            pair = v[0] if isinstance(v[0], list) else v
                            row[GEOM_LON], row[GEOM_LAT] = float(pair[0]), float(pair[1])
                            continue
                        except (TypeError, ValueError, IndexError):
                            pass
                    row[k] = _flatten_value(v)
                rows.append(row)
            fmt = "json"
    if not rows:
        raise ReaderError("Nie znaleziono rekordów w pliku JSON (oczekiwano listy obiektów lub FeatureCollection)")
    headers = []
    for r in rows:
        for k in r:
            if k not in headers:
                headers.append(k)
    return ReadResult(headers=headers, rows=rows, file_format=fmt, encoding=enc)


def read_file(path: str, declared_format: Optional[str] = None, encoding: Optional[str] = None) -> ReadResult:
    fmt = detect_format(path, declared_format)
    if fmt in ("csv", "tsv"):
        result = read_csv(path, encoding=encoding, delimiter="\t" if fmt == "tsv" else None)
    elif fmt in ("xlsx", "xls", "ods"):
        result = read_excel(path, fmt)
    else:
        result = read_json(path, encoding=encoding)
    if not result.rows:
        raise ReaderError("Plik nie zawiera wierszy z danymi")
    return result


def read_bytes(content: bytes, file_format: str, encoding: Optional[str] = None) -> ReadResult:
    """Pomocnicze – czytanie z pamięci (testy, podgląd)."""
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=f".{file_format}", delete=False) as tmp:
        tmp.write(content)
        name = tmp.name
    try:
        return read_file(name, file_format, encoding)
    finally:
        os.unlink(name)


def as_text_stream(rows: List[dict], headers: List[str]) -> io.StringIO:
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=headers, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    out.seek(0)
    return out
