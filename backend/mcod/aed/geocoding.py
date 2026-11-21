"""Uzupełnianie i weryfikacja lokalizacji z użyciem publicznych usług GUGiK.

- UUG GetAddress: adres -> współrzędne, TERYT, SIMC, kod pocztowy,
- UUG GetAddressReverse: współrzędne -> najbliższy adres (promień 100 m),
- ULDK GetCommuneByXY: współrzędne -> gmina (TERC z rodzajem), powiat, województwo.

Wyniki są cache'owane w `AedGeocodeCache`. Awaria usługi nigdy nie blokuje importu – wiersz dostaje
ostrzeżenie „nie zweryfikowano”.
"""
import hashlib
import logging
import math
import time
from typing import Optional

import requests
from django.conf import settings

from mcod.aed.validation import CRITICAL, INFO, WARNING, NormalizedRow

logger = logging.getLogger("mcod")

UUG_URL = "https://services.gugik.gov.pl/uug/"
ULDK_URL = "https://uldk.gugik.gov.pl/"
_last_call = [0.0]


def enabled() -> bool:
    return getattr(settings, "AED_GEOCODER_ENABLED", True)


def mismatch_threshold_m() -> int:
    return int(getattr(settings, "AED_ADDRESS_MISMATCH_M", 150))


def critical_mismatch_m() -> int:
    return int(getattr(settings, "AED_ADDRESS_CRITICAL_M", 5000))


def haversine_m(lat1, lon1, lat2, lon2) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _throttle():
    gap = 0.2 - (time.monotonic() - _last_call[0])
    if gap > 0:
        time.sleep(gap)
    _last_call[0] = time.monotonic()


def _cached(kind: str, query: str, fetch):
    from mcod.aed.models import AedGeocodeCache

    key = hashlib.sha256(f"{kind}|{query}".encode("utf-8")).hexdigest()
    hit = AedGeocodeCache.objects.filter(key=key).first()
    if hit is not None:
        return hit.result
    try:
        _throttle()
        result = fetch()
    except Exception as exc:  # noqa: BLE001 – usługa zewnętrzna
        logger.warning("AED geocoder %s failed for %s: %s", kind, query, exc)
        raise
    AedGeocodeCache.objects.update_or_create(key=key, defaults={"kind": kind, "query": query, "result": result})
    return result


def _first_result(payload: dict) -> Optional[dict]:
    results = (payload or {}).get("results") or {}
    if isinstance(results, dict) and results:
        return results[sorted(results.keys(), key=lambda k: int(k) if str(k).isdigit() else 999)[0]]
    if isinstance(results, list) and results:
        return results[0]
    return None


def forward(query: str) -> Optional[dict]:
    def fetch():
        resp = requests.get(
            UUG_URL, params={"request": "GetAddress", "srid": "4326", "address": query}, timeout=8
        )
        resp.raise_for_status()
        hit = _first_result(resp.json())
        if not hit or not hit.get("x"):
            return None
        return {
            "lat": float(hit["y"]),
            "lon": float(hit["x"]),
            "teryt": hit.get("teryt") or "",
            "simc": hit.get("simc") or "",
            "kod_pocztowy": hit.get("code") or "",
            "miejscowosc": hit.get("city") or "",
            "ulica": hit.get("street") or "",
            "nr_budynku": hit.get("number") or "",
            "accuracy": hit.get("accuracy"),
        }

    return _cached("forward", query.strip().lower(), fetch)


def reverse(lat: float, lon: float) -> Optional[dict]:
    query = f"{lat:.6f},{lon:.6f}"

    def fetch():
        resp = requests.get(
            UUG_URL,
            params={"request": "GetAddressReverse", "location": f"POINT({lon} {lat})", "srid": "4326"},
            timeout=8,
        )
        resp.raise_for_status()
        hit = _first_result(resp.json())
        if not hit:
            return None
        return {
            "miejscowosc": hit.get("city") or "",
            "ulica": hit.get("street") or "",
            "nr_budynku": hit.get("number") or "",
            "kod_pocztowy": hit.get("code") or "",
            "simc": hit.get("simc") or "",
            "distance": float(hit.get("distance") or 0),
        }

    return _cached("reverse", query, fetch)


def commune(lat: float, lon: float) -> Optional[dict]:
    query = f"{lat:.5f},{lon:.5f}"

    def fetch():
        resp = requests.get(
            ULDK_URL,
            params={
                "request": "GetCommuneByXY",
                "xy": f"{lon},{lat},4326",
                "result": "teryt,commune,county,voivodeship",
            },
            timeout=8,
        )
        resp.raise_for_status()
        lines = [ln.strip() for ln in resp.text.strip().splitlines() if ln.strip()]
        if len(lines) < 2 or lines[0] != "0":
            return None
        parts = lines[1].split("|")
        teryt = parts[0].replace("_", "") if parts else ""
        return {
            "teryt_gminy": teryt,
            "gmina": parts[1] if len(parts) > 1 else "",
            "powiat": (parts[2] if len(parts) > 2 else "").replace("powiat ", ""),
            "wojewodztwo": parts[3] if len(parts) > 3 else "",
        }

    return _cached("commune", query, fetch)


def enrich(nr: NormalizedRow) -> None:
    """Uzupełnia brakującą część lokalizacji i sprawdza zgodność adresu ze współrzędnymi."""
    if not enabled() or nr.is_critical:
        return
    v = nr.values
    try:
        if nr.has_coords:
            lat, lon = v["szerokosc_geogr"], v["dlugosc_geogr"]
            if nr.has_full_address:
                hit = forward(nr.address_query())
                if hit:
                    dist = haversine_m(lat, lon, hit["lat"], hit["lon"])
                    if dist > critical_mismatch_m():
                        nr.add(
                            "ADDRESS_MISMATCH_CRITICAL",
                            CRITICAL,
                            "szerokosc_geogr",
                            f"{lat}, {lon}",
                            f"Adres „{nr.address_query()}” i współrzędne różnią się o {dist / 1000:.1f} km – "
                            "wiersz wstrzymano, bo wskazywałby ratownikom niewłaściwe miejsce. Według GUGiK adres leży "
                            f"w punkcie {hit['lat']:.6f}, {hit['lon']:.6f}. Popraw współrzędne lub adres.",
                        )
                        return
                    if dist > mismatch_threshold_m():
                        nr.add(
                            "ADDRESS_MISMATCH",
                            WARNING,
                            "szerokosc_geogr",
                            f"{lat}, {lon}",
                            f"Adres „{nr.address_query()}” i współrzędne różnią się o {round(dist)} m. "
                            f"Według GUGiK adres leży w punkcie {hit['lat']:.6f}, {hit['lon']:.6f} – "
                            "sprawdź, które dane są poprawne.",
                        )
                    for key, src in (("kod_pocztowy", "kod_pocztowy"), ("teryt_simc", "simc")):
                        if not v.get(key) and hit.get(src):
                            v[key] = hit[src]
            else:
                hit = reverse(lat, lon)
                if hit and hit.get("miejscowosc"):
                    filled = False
                    for key in ("miejscowosc", "ulica", "nr_budynku", "kod_pocztowy"):
                        if not v.get(key) and hit.get(key):
                            v[key] = hit[key]
                            filled = True
                    if not v.get("teryt_simc") and hit.get("simc"):
                        v["teryt_simc"] = hit["simc"]
                    if filled:
                        nr.address_source = "geokodowanie"
                        nr.add("GEOCODED_ADDRESS", INFO, "miejscowosc", f"{lat}, {lon}")
        elif nr.has_full_address:
            hit = forward(nr.address_query())
            if hit:
                v["szerokosc_geogr"], v["dlugosc_geogr"] = hit["lat"], hit["lon"]
                nr.coords_source = "geokodowanie"
                nr.add("GEOCODED_COORDS", INFO, "szerokosc_geogr", nr.address_query())
                for key, src in (("kod_pocztowy", "kod_pocztowy"), ("teryt_simc", "simc")):
                    if not v.get(key) and hit.get(src):
                        v[key] = hit[src]
            else:
                nr.add("GEOCODE_FAILED", WARNING, "miejscowosc", nr.address_query(),
                       "Nie znaleziono adresu w rejestrze GUGiK – urządzenie nie pojawi się na mapie. Sprawdź adres "
                       "lub dodaj współrzędne.")
        if nr.has_coords:
            geo = commune(v["szerokosc_geogr"], v["dlugosc_geogr"])
            if geo:
                nr.geo = geo
                if not v.get("teryt_terc"):
                    v["teryt_terc"] = geo["teryt_gminy"]
    except Exception:  # noqa: BLE001
        nr.add("GEOCODE_FAILED", INFO, "", "", "Usługa GUGiK była niedostępna – lokalizacji nie zweryfikowano.")
