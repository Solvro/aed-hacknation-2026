"""Publiczne, tylko-do-odczytu API Ogólnopolskiego zbioru AED (falcon).

Brak metod zapisu – POST/PUT/DELETE zwracają 405. Dane trafiają do agregatu wyłącznie przez zbiory
publikowane przez instytucje w panelu dostawcy.
"""
import datetime
import json

import falcon
from django.db.models import Avg, Count, Q

from mcod.aed.aggregate import build_geojson, record_row
from mcod.aed.models import STATUS_ACTIVE, STATUS_WITHDRAWN, AedAggregateInfo, AedRecord
from mcod.aed.validation import is_always_open

MAX_PER_PAGE = 500


def _int(value, default, minimum=1, maximum=None):
    try:
        v = int(value)
    except (TypeError, ValueError):
        return default
    v = max(minimum, v)
    return min(v, maximum) if maximum else v


def _filtered(req):
    status = (req.get_param("status") or STATUS_ACTIVE).lower()
    qs = AedRecord.objects.select_related("organization", "dataset", "resource")
    if status in (STATUS_ACTIVE, STATUS_WITHDRAWN):
        qs = qs.filter(status=status)
    dostawca = req.get_param("dostawca")
    if dostawca:
        qs = qs.filter(organization_id=int(dostawca)) if dostawca.isdigit() else qs.filter(
            organization__title__icontains=dostawca
        )
    teryt = req.get_param("teryt")
    if teryt:
        qs = qs.filter(teryt_gminy__startswith=teryt.replace("_", ""))
    q = req.get_param("q")
    if q:
        qs = qs.filter(
            Q(attributes__nazwa_obiektu__icontains=q) | Q(attributes__miejscowosc__icontains=q) | Q(gmina__icontains=q)
        )
    bbox = req.get_param("bbox")
    if bbox:
        try:
            min_lon, min_lat, max_lon, max_lat = [float(x) for x in bbox.split(",")]
            qs = qs.filter(lon__gte=min_lon, lon__lte=max_lon, lat__gte=min_lat, lat__lte=max_lat)
        except ValueError:
            raise falcon.HTTPBadRequest(title="Nieprawidłowy bbox", description="bbox=minLon,minLat,maxLon,maxLat")
    return qs.order_by("organization__title", "local_id")


class AedRecordsView:
    def on_get(self, req, resp, **kwargs):
        qs = _filtered(req)
        page = _int(req.get_param("page"), 1)
        per_page = _int(req.get_param("per_page"), 50, maximum=MAX_PER_PAGE)
        count = qs.count()
        items = qs[(page - 1) * per_page: page * per_page]
        data = []
        for rec in items:
            attrs = record_row(rec)
            attrs["status"] = rec.status
            data.append({"id": rec.uid, "type": "aed", "attributes": attrs})
        resp.media = {
            "data": data,
            "meta": {"count": count, "page": page, "per_page": per_page},
            "links": {"self": req.relative_uri},
        }


class AedRecordDetailView:
    def on_get(self, req, resp, uid, **kwargs):
        rec = AedRecord.objects.select_related("organization", "dataset", "resource").filter(uid=uid).first()
        if rec is None:
            raise falcon.HTTPNotFound()
        attrs = record_row(rec)
        attrs["status"] = rec.status
        attrs["historia"] = [
            {"zmiana": h.change_type, "data": h.created.isoformat(), "roznice": h.diff} for h in rec.history.all()[:50]
        ]
        resp.media = {"data": {"id": rec.uid, "type": "aed", "attributes": attrs}}


class AedRecordsGeoJSONView:
    def on_get(self, req, resp, **kwargs):
        resp.content_type = "application/geo+json"
        resp.text = build_geojson(_filtered(req)).decode("utf-8")


class AedStatsView:
    def on_get(self, req, resp, **kwargs):
        active = AedRecord.objects.filter(status=STATUS_ACTIVE)
        total = active.count()
        year_ago = (datetime.date.today() - datetime.timedelta(days=365)).isoformat()
        always_open = locked_known = locked = verified = 0
        for attrs in active.values_list("attributes", flat=True):
            if is_always_open(attrs.get("godziny_dostepnosci")):
                always_open += 1
            if attrs.get("zamkniety_w_szafce") is not None:
                locked_known += 1
                locked += 1 if attrs.get("zamkniety_w_szafce") else 0
            if attrs.get("data_weryfikacji") and attrs["data_weryfikacji"] >= year_ago:
                verified += 1

        def pct(part, whole):
            return round(100.0 * part / whole, 1) if whole else 0.0

        info = AedAggregateInfo.get()
        by_voivodeship = list(
            active.exclude(wojewodztwo="").values("wojewodztwo").annotate(liczba=Count("id")).order_by("-liczba")
        )
        resp.media = {
            "data": {
                "total": total,
                "providers": active.values("organization").distinct().count(),
                "gminy": active.exclude(teryt_gminy="").values("teryt_gminy").distinct().count(),
                "withdrawn": AedRecord.objects.filter(status=STATUS_WITHDRAWN).count(),
                "with_coordinates": active.exclude(lat=None).count(),
                "geocoded_coordinates": active.filter(coords_source="geokodowanie").count(),
                "always_open_pct": pct(always_open, total),
                "locked_pct": pct(locked, locked_known),
                "verified_12m_pct": pct(verified, total),
                "avg_quality": round(active.aggregate(v=Avg("quality_score"))["v"] or 0, 1),
                "by_voivodeship": by_voivodeship,
                "last_built": info.last_built.isoformat() if info and info.last_built else None,
            }
        }


class AedProvidersView:
    def on_get(self, req, resp, **kwargs):
        from mcod.aed.models import AedImportRun

        rows = (
            AedRecord.objects.values("organization_id", "organization__title", "organization__regon")
            .annotate(
                active=Count("id", filter=Q(status=STATUS_ACTIVE)),
                withdrawn=Count("id", filter=Q(status=STATUS_WITHDRAWN)),
                avg_quality=Avg("quality_score", filter=Q(status=STATUS_ACTIVE)),
            )
            .order_by("organization__title")
        )
        data = []
        for row in rows:
            last_run = (
                AedImportRun.objects.filter(organization_id=row["organization_id"], status__in=("ok", "partial"))
                .select_related("dataset", "resource")
                .first()
            )
            # Zgłoszenia uwag kierujemy do zasobu źródłowego dostawcy (standardowy mechanizm portalu
            # POST /resources/{id}/comments -> instytucja odpowiedzialna za dane).
            source = (
                AedRecord.objects.filter(organization_id=row["organization_id"], status=STATUS_ACTIVE)
                .exclude(resource=None)
                .values("dataset_id", "dataset__title", "resource_id", "resource__title")
                .annotate(n=Count("id"))
                .order_by("-n")
                .first()
            ) or {}
            data.append(
                {
                    "id": row["organization_id"],
                    "type": "aed_provider",
                    "attributes": {
                        "dostawca": row["organization__title"],
                        "regon": row["organization__regon"] or "",
                        "aktywne": row["active"],
                        "wycofane": row["withdrawn"],
                        "srednia_jakosc": round(row["avg_quality"] or 0, 1),
                        "ostatnia_aktualizacja": last_run.finished_at.isoformat()
                        if last_run and last_run.finished_at
                        else None,
                        "zbior_zrodlowy_id": source.get("dataset_id") or (last_run.dataset_id if last_run else None),
                        "zbior_zrodlowy_tytul": source.get("dataset__title") or "",
                        "zasob_zrodlowy_id": source.get("resource_id") or (last_run.resource_id if last_run else None),
                        "zasob_zrodlowy_tytul": source.get("resource__title") or "",
                        "jakosc_ostatniego_raportu": last_run.quality_score if last_run else None,
                    },
                }
            )
        resp.media = {"data": data, "meta": {"count": len(data)}}


class AedAggregateView:
    def on_get(self, req, resp, **kwargs):
        info = AedAggregateInfo.get()
        if info is None or info.dataset_id is None:
            raise falcon.HTTPNotFound(title="Agregat AED nie został jeszcze utworzony")
        resp.media = {
            "data": {
                "type": "aed_aggregate",
                "id": info.dataset_id,
                "attributes": {
                    "dataset_id": info.dataset_id,
                    "dataset_slug": info.dataset.slug if info.dataset else None,
                    "owner": info.dataset.organization.title if info.dataset else None,
                    "csv_resource_id": info.csv_resource_id,
                    "geojson_resource_id": info.geojson_resource_id,
                    "records_count": info.records_count,
                    "providers_count": info.providers_count,
                    "last_built": info.last_built.isoformat() if info.last_built else None,
                },
            }
        }


def dumps(obj) -> str:
    return json.dumps(obj, ensure_ascii=False)
