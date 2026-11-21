"""Ładowanie maszynowej definicji wzorcowego zakresu danych AED (`data/aed/aed_schema.json`)."""
import json
import os
import re
import unicodedata
from functools import lru_cache

from django.conf import settings

POLISH_MAP = str.maketrans("ąćęłńóśźżĄĆĘŁŃÓŚŹŻ", "acelnoszzACELNOSZZ")


def schema_path() -> str:
    return getattr(settings, "AED_SCHEMA_PATH", os.path.join(str(settings.DATA_DIR), "aed", "aed_schema.json"))


@lru_cache(maxsize=1)
def load_schema() -> dict:
    with open(schema_path(), encoding="utf-8") as f:
        return json.load(f)


def fields() -> list:
    return load_schema()["fields"]


def field_names() -> list:
    return [f["name"] for f in fields()]


def field(name: str) -> dict:
    for f in fields():
        if f["name"] == name:
            return f
    raise KeyError(name)


def recommended_fields() -> list:
    """Pola liczone do oceny jakości: identyfikator + pola oznaczone w zakresie jako podnoszące jakość."""
    return [f["name"] for f in fields() if f.get("x-required") == "recommended" or f.get("x-quality")]


def computed_fields() -> list:
    """Pola wyliczane przez portal ze współrzędnych (TERYT) – dostawca nie musi ich podawać."""
    return [f["name"] for f in fields() if f.get("x-required") == "computed"]


def aux_columns() -> dict:
    return load_schema().get("x-aux-columns", {})


def aggregate_columns() -> list:
    return [c["name"] for c in load_schema().get("x-aggregate-columns", [])]


def normalize_header(value) -> str:
    """„ Szerokość geograficzna” -> „szerokosc_geograficzna”."""
    text = str(value or "").replace("﻿", "").strip()
    text = text.translate(POLISH_MAP)
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^0-9a-zA-Z]+", "_", text).strip("_").lower()
    return text
