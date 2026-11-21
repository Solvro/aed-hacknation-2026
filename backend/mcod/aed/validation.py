"""Walidacja i normalizacja wierszy względem wzorcowego zakresu danych AED.

Błędy krytyczne (CRITICAL) blokują włączenie wiersza do agregatu. Ostrzeżenia (WARNING) obniżają ocenę
jakości. Informacje (INFO) opisują automatyczne poprawki wykonane przez portal.
"""
import datetime
import hashlib
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from mcod.aed import schema
from mcod.aed.mapping import ColumnMapping

CRITICAL = "critical"
WARNING = "warning"
INFO = "info"

# Obszar Polski (z zapasem) w WGS84
LAT_MIN, LAT_MAX = 49.0, 54.9
LON_MIN, LON_MAX = 14.1, 24.2

TRUE_VALUES = {"tak", "t", "true", "1", "yes", "y", "prawda", "x"}
FALSE_VALUES = {"nie", "n", "false", "0", "no", "falsz", "fałsz"}
DATE_FORMATS = ("%Y-%m-%d", "%d.%m.%Y", "%d-%m-%Y", "%Y/%m/%d", "%d/%m/%Y", "%Y.%m.%d", "%Y-%m")
STREET_PREFIX_RE = re.compile(
    r"^\s*(ul\.?|ulica|al\.*|aleja|aleje|pl\.?|plac|os\.?|osiedle|rondo|skwer|bulw\.?|bulwar)\s+", re.IGNORECASE
)
POSTCODE_RE = re.compile(r"\b(\d{2})\s*-\s*(\d{3})\b")
NUMBER_RE = re.compile(r"\s(\d+[A-Za-z]?(?:\s*/\s*\d+[A-Za-z]?)?)\s*$")
ALWAYS_OPEN_RE = re.compile(r"24\s*/\s*7|24h|całodob|calodob|00:00\s*-\s*24:00|0-24", re.IGNORECASE)

ISSUE_MESSAGES = {
    "NO_LOCATION": "Brak lokalizacji: podaj współrzędne (szerokość i długość geograficzną) albo pełny adres "
    "(miejscowość i numer budynku).",
    "INVALID_COORDS": "Współrzędne nie są liczbami – użyj stopni dziesiętnych z kropką, np. 50.0619.",
    "OUT_OF_POLAND": "Współrzędne wskazują punkt poza Polską – sprawdź układ (wymagany WGS84) i kolejność wartości.",
    "DUPLICATE_ID": "Identyfikator AED powtarza się w pliku – każdy wiersz musi mieć unikalny identyfikator.",
    "COORDS_SWAPPED": "Szerokość i długość geograficzna były zamienione miejscami – poprawiono automatycznie.",
    "NO_ID": "Brak identyfikatora AED – portal wyliczył go z lokalizacji. Zmiana adresu lub współrzędnych "
    "spowoduje potraktowanie urządzenia jako nowego. Dodaj stały identyfikator (kolumna id_aed).",
    "ADDRESS_INCOMPLETE": "Niepełny adres (brak miejscowości lub numeru budynku).",
    "ADDRESS_PARSED": "Adres rozdzielono automatycznie na pola wzorcowe z kolumny łącznej.",
    "INVALID_VALUE": "Nieprawidłowa wartość pola.",
    "INVALID_POSTCODE": "Kod pocztowy powinien mieć format NN-NNN.",
    "STALE_VERIFICATION": "Ostatnia weryfikacja urządzenia była ponad 12 miesięcy temu.",
    "EXPIRED_ELECTRODES": "Upłynęła data ważności elektrod.",
    "EXPIRED_BATTERY": "Upłynęła data ważności baterii.",
    "ADDRESS_MISMATCH": "Adres i współrzędne wskazują różne miejsca.",
    "ADDRESS_MISMATCH_CRITICAL": "Adres i współrzędne różnią się o ponad 5 km – wiersz wstrzymany do wyjaśnienia.",
    "GEOCODED_COORDS": "Współrzędne uzupełniono na podstawie adresu (geokodowanie GUGiK).",
    "GEOCODED_ADDRESS": "Adres uzupełniono na podstawie współrzędnych (geokodowanie odwrotne GUGiK).",
    "GEOCODE_FAILED": "Nie udało się zweryfikować adresu w usłudze GUGiK.",
}


@dataclass
class Issue:
    row: Optional[int]
    field: str
    severity: str
    code: str
    message: str
    value: str = ""

    def as_dict(self) -> dict:
        return {
            "row": self.row,
            "field": self.field,
            "severity": self.severity,
            "code": self.code,
            "message": self.message,
            "value": self.value[:200] if self.value else "",
        }


@dataclass
class NormalizedRow:
    row: int
    values: Dict[str, object] = field(default_factory=dict)
    issues: List[Issue] = field(default_factory=list)
    local_id: str = ""
    local_id_generated: bool = False
    coords_source: str = "dostawca"
    address_source: str = "dostawca"
    geo: Dict[str, str] = field(default_factory=dict)  # teryt_gminy, gmina, powiat, wojewodztwo

    @property
    def is_critical(self) -> bool:
        return any(i.severity == CRITICAL for i in self.issues)

    def add(self, code: str, severity: str, field_name: str = "", value="", message: Optional[str] = None):
        self.issues.append(
            Issue(
                row=self.row,
                field=field_name,
                severity=severity,
                code=code,
                message=message or ISSUE_MESSAGES.get(code, code),
                value="" if value is None else str(value),
            )
        )

    @property
    def has_coords(self) -> bool:
        return self.values.get("szerokosc_geogr") is not None and self.values.get("dlugosc_geogr") is not None

    @property
    def has_full_address(self) -> bool:
        return bool(self.values.get("miejscowosc")) and bool(self.values.get("nr_budynku"))

    def address_query(self) -> str:
        v = self.values
        street = f"{v.get('ulica') or ''} {v.get('nr_budynku') or ''}".strip()
        city = v.get("miejscowosc") or ""
        if v.get("kod_pocztowy"):
            city = f"{v['kod_pocztowy']} {city}"
        return ", ".join(p for p in (city.strip(), street) if p)

    def quality_score(self) -> int:
        recommended = schema.recommended_fields()
        filled = 0
        for name in recommended:
            if name == "id_aed":
                filled += 0 if self.local_id_generated else 1
            elif self.values.get(name) not in (None, ""):
                filled += 1
        score = round(100 * filled / max(1, len(recommended)))
        warnings = sum(1 for i in self.issues if i.severity == WARNING)
        return max(0, min(100, score - 5 * warnings))


def parse_float(value) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(" ", "").replace(" ", "")
    if not text:
        return None
    if text.count(",") == 1 and "." not in text:
        text = text.replace(",", ".")
    return float(text)  # ValueError obsługiwany wyżej


def parse_bool(value) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    text = str(value or "").strip().lower()
    if not text:
        return None
    if text in TRUE_VALUES:
        return True
    if text in FALSE_VALUES:
        return False
    raise ValueError(text)


def parse_date(value) -> Optional[str]:
    text = str(value or "").strip()
    if not text:
        return None
    text = text[:10] if re.match(r"^\d{4}-\d{2}-\d{2}T", text) else text
    for fmt in DATE_FORMATS:
        try:
            return datetime.datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    raise ValueError(text)


def parse_dostep(value) -> Optional[str]:
    text = str(value or "").strip().lower()
    if not text:
        return None
    if text in ("publiczny", "klienci", "pracownicy"):
        return text
    if any(k in text for k in ("publ", "ogóln", "ogoln", "każd", "kazd", "całodob", "calodob", "public")):
        return "publiczny"
    if any(k in text for k in ("klient", "gość", "gosc", "odwiedz", "customer")):
        return "klienci"
    if any(k in text for k in ("pracown", "personel", "staff", "wewn", "private", "prywat")):
        return "pracownicy"
    raise ValueError(text)


def split_address(address: str) -> Dict[str, str]:
    """„ul. Stanisława Wyspiańskiego 20, 38-400 Krosno” -> ulica, nr_budynku, kod_pocztowy, miejscowosc."""
    result = {}
    text = re.sub(r"\s+", " ", str(address or "")).strip().strip(",")
    if not text:
        return result
    m = POSTCODE_RE.search(text)
    rest = text
    if m:
        result["kod_pocztowy"] = f"{m.group(1)}-{m.group(2)}"
        after = text[m.end():].strip(" ,")
        before = text[: m.start()].strip(" ,")
        if after:
            after_parts = [p.strip() for p in after.split(",") if p.strip()]
            result["miejscowosc"] = after_parts[0]
            rest = before or ", ".join(after_parts[1:])
        else:
            parts = [p.strip() for p in before.split(",") if p.strip()]
            if len(parts) > 1:
                result["miejscowosc"] = parts[-1]
                rest = ", ".join(parts[:-1])
            else:
                rest = before
    else:
        parts = [p.strip() for p in text.split(",") if p.strip()]
        if len(parts) > 1:
            # „Krosno, ul. Lwowska 28” lub „ul. Lwowska 28, Krosno”
            if STREET_PREFIX_RE.match(parts[0]) or NUMBER_RE.search(" " + parts[0]):
                result["miejscowosc"] = parts[-1]
                rest = parts[0]
            else:
                result["miejscowosc"] = parts[0]
                rest = ", ".join(parts[1:])
    street_part = rest.split(",")[0].strip()
    street_part = STREET_PREFIX_RE.sub("", street_part).strip(" .")
    street_part = re.sub(r"^\.+\s*", "", street_part)
    nm = NUMBER_RE.search(" " + street_part)
    if nm:
        result["nr_budynku"] = nm.group(1).replace(" ", "")
        street_part = street_part[: len(street_part) - len(nm.group(0)) + 1].strip()
    elif re.fullmatch(r"\d+[A-Za-z]?", street_part):
        result["nr_budynku"] = street_part
        street_part = ""
    if street_part:
        result["ulica"] = street_part
    return result


def clean_street(value: str) -> str:
    return STREET_PREFIX_RE.sub("", str(value or "")).strip(" .")


def normalize_postcode(value: str) -> str:
    text = str(value or "").strip()
    m = POSTCODE_RE.search(text)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    if re.fullmatch(r"\d{5}", text):
        return f"{text[:2]}-{text[2:]}"
    return text


def in_poland(lat: float, lon: float) -> bool:
    return LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX


def location_fingerprint(values: dict) -> str:
    if values.get("szerokosc_geogr") is not None and values.get("dlugosc_geogr") is not None:
        basis = f"{values['szerokosc_geogr']:.5f},{values['dlugosc_geogr']:.5f}"
    else:
        basis = "|".join(
            str(values.get(k) or "").strip().lower() for k in ("miejscowosc", "ulica", "nr_budynku", "nazwa_obiektu")
        )
    return "h" + hashlib.sha1(basis.encode("utf-8")).hexdigest()[:12]


def is_always_open(value) -> bool:
    return bool(value) and bool(ALWAYS_OPEN_RE.search(str(value)))


def normalize_row(index: int, raw: dict, mapping: ColumnMapping, row_offset: int = 2) -> NormalizedRow:
    nr = NormalizedRow(row=index + row_offset)
    today = datetime.date.today()

    def raw_value(name):
        col = mapping.fields.get(name)
        if col is None:
            return None
        val = raw.get(col)
        if isinstance(val, str):
            val = val.strip()
        return val if val not in ("", None) else None

    # Łączna kolumna adresu -> pola wzorcowe (tylko brakujące)
    if mapping.aux.get("adres"):
        address = raw.get(mapping.aux["adres"])
        if mapping.aux.get("adres_2") and raw.get(mapping.aux["adres_2"]):
            # adres w dwóch kolumnach, np. „Gałowska 8D” + „54-530 Wrocław”
            address = f"{address or ''}, {raw.get(mapping.aux['adres_2'])}".strip(" ,")
        parsed = split_address(address) if address else {}
        filled = []
        for key, val in parsed.items():
            if raw_value(key) is None and val:
                nr.values[key] = val
                filled.append(key)
        if filled:
            nr.add("ADDRESS_PARSED", INFO, "adres", address)

    for f in schema.fields():
        name = f["name"]
        if name in nr.values:
            continue
        value = raw_value(name)
        if value is None:
            nr.values[name] = None
            continue
        ftype = f.get("type", "string")
        try:
            if name in ("szerokosc_geogr", "dlugosc_geogr"):
                nr.values[name] = parse_float(value)
            elif ftype == "boolean":
                nr.values[name] = parse_bool(value)
            elif ftype == "date":
                nr.values[name] = parse_date(value)
            elif name == "dostep":
                nr.values[name] = parse_dostep(value)
            elif name == "kod_pocztowy":
                nr.values[name] = normalize_postcode(value)
                if not POSTCODE_RE.fullmatch(nr.values[name] or ""):
                    nr.add("INVALID_POSTCODE", WARNING, name, value)
            elif name == "ulica":
                nr.values[name] = clean_street(value)
            elif name == "id_aed":
                nr.values[name] = str(value).strip()
            else:
                nr.values[name] = str(value).strip() if not isinstance(value, (int, float, bool)) else value
        except (ValueError, TypeError):
            nr.values[name] = None
            if name in ("szerokosc_geogr", "dlugosc_geogr"):
                nr.add("INVALID_COORDS", CRITICAL, name, value)
            else:
                expected = {
                    "boolean": "tak/nie",
                    "date": "data RRRR-MM-DD",
                }.get(ftype, "publiczny / klienci / pracownicy" if name == "dostep" else "poprawna wartość")
                nr.add("INVALID_VALUE", WARNING, name, value, f"Nieprawidłowa wartość pola „{name}” (oczekiwano: {expected}).")

    if mapping.aux.get("cecha_ulicy") and nr.values.get("ulica"):
        pass  # cecha (ulica/aleja/plac) nie jest częścią nazwy ulicy we wzorcowym zakresie

    # Współrzędne: zamiana kolejności i zakres
    lat, lon = nr.values.get("szerokosc_geogr"), nr.values.get("dlugosc_geogr")
    if lat is not None and lon is not None:
        if not in_poland(lat, lon) and in_poland(lon, lat):
            nr.values["szerokosc_geogr"], nr.values["dlugosc_geogr"] = lon, lat
            nr.add("COORDS_SWAPPED", WARNING, "szerokosc_geogr", f"{lat}, {lon}")
        elif not in_poland(lat, lon):
            nr.add("OUT_OF_POLAND", CRITICAL, "szerokosc_geogr", f"{lat}, {lon}")
            nr.values["szerokosc_geogr"] = nr.values["dlugosc_geogr"] = None
    elif (lat is None) != (lon is None):
        nr.values["szerokosc_geogr"] = nr.values["dlugosc_geogr"] = None

    # Reguła lokalizacji: współrzędne LUB pełny adres
    if not nr.has_coords and not nr.has_full_address:
        if not any(i.code in ("INVALID_COORDS", "OUT_OF_POLAND") for i in nr.issues):
            nr.add("NO_LOCATION", CRITICAL, "szerokosc_geogr")
    elif nr.has_coords and not nr.has_full_address and (nr.values.get("miejscowosc") or nr.values.get("ulica")):
        nr.add("ADDRESS_INCOMPLETE", WARNING, "nr_budynku")

    # Identyfikator
    if nr.values.get("id_aed"):
        nr.local_id = str(nr.values["id_aed"])
    else:
        nr.local_id = location_fingerprint(nr.values)
        nr.local_id_generated = True
        nr.add("NO_ID", WARNING, "id_aed")

    # Aktualność
    verified = nr.values.get("data_weryfikacji")
    if verified and verified < (today - datetime.timedelta(days=365)).isoformat():
        nr.add("STALE_VERIFICATION", WARNING, "data_weryfikacji", verified)
    if nr.values.get("waznosc_elektrod") and nr.values["waznosc_elektrod"] < today.isoformat():
        nr.add("EXPIRED_ELECTRODES", WARNING, "waznosc_elektrod", nr.values["waznosc_elektrod"])
    if nr.values.get("waznosc_baterii") and nr.values["waznosc_baterii"] < today.isoformat():
        nr.add("EXPIRED_BATTERY", WARNING, "waznosc_baterii", nr.values["waznosc_baterii"])
    return nr


def mark_duplicates(rows: List[NormalizedRow]) -> None:
    seen = {}
    for nr in rows:
        if nr.is_critical:
            continue
        if nr.local_id in seen:
            nr.add(
                "DUPLICATE_ID",
                CRITICAL if not nr.local_id_generated else WARNING,
                "id_aed",
                nr.local_id,
                f"Identyfikator „{nr.local_id}” powtarza się (pierwsze wystąpienie: wiersz {seen[nr.local_id]}).",
            )
            if nr.local_id_generated:
                nr.local_id = f"{nr.local_id}-{nr.row}"
        else:
            seen[nr.local_id] = nr.row


def missing_recommended_summary(rows: List[NormalizedRow]) -> List[Issue]:
    """Jedno zalecenie na pole zalecane, którego brakuje w wierszach (zamiast setek ostrzeżeń)."""
    issues = []
    total = len(rows)
    if not total:
        return issues
    for name in schema.recommended_fields():
        if name == "id_aed":
            missing = sum(1 for r in rows if r.local_id_generated)
        else:
            missing = sum(1 for r in rows if r.values.get(name) in (None, ""))
        if missing:
            title = schema.field(name).get("title", name)
            issues.append(
                Issue(
                    row=None,
                    field=name,
                    severity=INFO,
                    code="MISSING_RECOMMENDED",
                    message=f"Pole zalecane „{name}” ({title}) jest puste w {missing} z {total} wierszy.",
                )
            )
    return issues
