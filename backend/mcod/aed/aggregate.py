"""Budowa i publikacja Ogólnopolskiego zbioru AED (agregatu).

Agregat jest zwykłym zbiorem portalu należącym do instytucji z `AED_AGGREGATE_OWNER_ORGANIZATION_PK`
(Ministerstwo Cyfryzacji). W odróżnieniu od agregatu DGA zasoby mają stałe identyfikatory: plik główny jest
podmieniany w miejscu, a następnie uruchamiany jest standardowy pipeline walidacji portalu
(`Resource.revalidate()`), dzięki czemu agregat ma podgląd tabeli, mapę, API i konwersje jak każdy zasób.
"""
import csv
import io
import json
import logging

from django.apps import apps
from django.conf import settings
from django.core.cache import cache
from django.core.files.base import ContentFile
from django.utils import timezone

from mcod.aed import schema
from mcod.aed.models import STATUS_ACTIVE, AedAggregateInfo, AedRecord

logger = logging.getLogger("mcod")

REBUILD_LOCK_KEY = "aed:aggregate:rebuild-scheduled"
CSV_FILENAME = "aed_ogolnopolski.csv"
GEOJSON_FILENAME = "aed_ogolnopolski.geojson"


def output_columns() -> list:
    return ["aed_uid"] + schema.field_names() + [c for c in schema.aggregate_columns() if c != "aed_uid"]


def _base_url() -> str:
    return getattr(settings, "BASE_URL", "").rstrip("/")


def record_row(record: AedRecord) -> dict:
    row = {name: record.attributes.get(name) for name in schema.field_names()}
    row["szerokosc_geogr"] = record.lat
    row["dlugosc_geogr"] = record.lon
    org = record.organization
    dataset = record.dataset
    resource = record.resource
    row.update(
        {
            "aed_uid": record.uid,
            "dostawca": org.title,
            "dostawca_regon": org.regon or "",
            "zbior_zrodlowy": f"{_base_url()}/dataset/{dataset.id}" if dataset else "",
            "zasob_zrodlowy": f"{_base_url()}/dataset/{dataset.id}/resource/{resource.id}" if dataset and resource else "",
            "data_aktualizacji": (record.updated_at or record.first_seen).date().isoformat(),
            "wspolrzedne_zrodlo": record.coords_source,
            "adres_zrodlo": record.address_source,
            "teryt_gminy": record.teryt_gminy,
            "gmina": record.gmina,
            "powiat": record.powiat,
            "wojewodztwo": record.wojewodztwo,
            "jakosc_danych": record.quality_score,
        }
    )
    return row


def active_records():
    return (
        AedRecord.objects.filter(status=STATUS_ACTIVE)
        .select_related("organization", "dataset", "resource")
        .order_by("organization__title", "local_id")
    )


def _fmt(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return "tak" if value else "nie"
    return value


def build_csv(records) -> bytes:
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=output_columns(), extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    for record in records:
        writer.writerow({k: _fmt(v) for k, v in record_row(record).items()})
    return out.getvalue().encode("utf-8")


def build_geojson(records) -> bytes:
    features = []
    for record in records:
        if record.lat is None or record.lon is None:
            continue
        props = record_row(record)
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [round(record.lon, 7), round(record.lat, 7)]},
                "properties": {k: v for k, v in props.items() if k not in ("szerokosc_geogr", "dlugosc_geogr")},
            }
        )
    payload = {"type": "FeatureCollection", "name": "aed_ogolnopolski", "features": features}
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def ensure_geo_mapping(resource) -> bool:
    """Ustawia w schemacie zasobu CSV mapowanie mapy portalu: szerokość (b), długość (l), etykieta."""
    Resource = apps.get_model("resources", "Resource")
    tds = resource.tabular_data_schema
    if not tds or not tds.get("fields"):
        return False
    names = [f.get("name") for f in tds["fields"]]
    wanted = {"b": "szerokosc_geogr", "l": "dlugosc_geogr", "label": "nazwa_obiektu"}
    if "nazwa_obiektu" not in names:
        wanted["label"] = "aed_uid"
    if all(col in names for col in wanted.values()) and tds.get("geo", {}).keys() >= set(wanted):
        return False
    if not all(col in names for col in wanted.values()):
        return False
    tds.setdefault("geo", {})
    for geo_key, col in wanted.items():
        idx = names.index(col)
        tds["fields"][idx]["geo"] = geo_key
        if geo_key in ("b", "l"):
            tds["fields"][idx]["type"] = "number"
        tds["geo"][geo_key] = {"col_name": col, "col_index": idx}
    Resource.raw.filter(pk=resource.pk).update(tabular_data_schema=tds)
    resource.tabular_data_schema = tds
    return True


def replace_main_file(resource, filename: str, content: bytes) -> None:
    ResourceFile = apps.get_model("resources", "ResourceFile")
    rf = ResourceFile.objects.filter(resource=resource, is_main=True).first()
    if rf is None:
        rf = ResourceFile(resource=resource, is_main=True)
        rf.file.save(filename, ContentFile(content), save=True)  # post_save uruchomi pipeline portalu
        return
    old_name = rf.file.name
    storage = rf.file.storage
    rf.file.save(filename, ContentFile(content), save=False)
    rf.save()
    if old_name and old_name != rf.file.name:
        try:
            storage.delete(old_name)
        except Exception:  # noqa: BLE001
            logger.warning("AED: could not delete old aggregate file %s", old_name)
    resource._cached_file = None
    resource.revalidate(update_verification_date=True)


def rebuild(publish: bool = True) -> AedAggregateInfo:
    cache.delete(REBUILD_LOCK_KEY)
    records = list(active_records())
    info = AedAggregateInfo.get()
    if info is None:
        info = AedAggregateInfo.objects.create()
    info.records_count = len(records)
    info.providers_count = len({r.organization_id for r in records})
    if publish:
        Resource = apps.get_model("resources", "Resource")
        Resource.raw.filter(pk__in=[pk for pk in (info.csv_resource_id, info.geojson_resource_id) if pk]).update(
            data_date=timezone.localdate()
        )
        if info.csv_resource_id:
            ensure_geo_mapping(info.csv_resource)
            replace_main_file(info.csv_resource, CSV_FILENAME, build_csv(records))
        if info.geojson_resource_id:
            replace_main_file(info.geojson_resource, GEOJSON_FILENAME, build_geojson(records))
        if info.dataset_id:
            Dataset = apps.get_model("datasets", "Dataset")
            Dataset.raw.filter(pk=info.dataset_id).update(modified=timezone.now(), verified=timezone.now())
    info.last_built = timezone.now()
    info.save()
    logger.info("AED aggregate rebuilt: %s records, %s providers", info.records_count, info.providers_count)
    return info


def schedule_rebuild(countdown: int = 5) -> bool:
    """Debounce: kilka zmian w krótkim czasie = jedna przebudowa agregatu."""
    from mcod.aed.tasks import aed_rebuild_aggregate_task

    if cache.add(REBUILD_LOCK_KEY, "1", timeout=120):
        aed_rebuild_aggregate_task.apply_async(countdown=countdown)
        return True
    return False
