"""Synchronizacja rekordów agregatu z nową wersją zasobu dostawcy.

Zasada: przebieg dotyczy WYŁĄCZNIE pary (instytucja, zbiór). Rekordy innych dostawców i innych zbiorów nie
są czytane ani modyfikowane. Rekordy znikające z pliku dostawcy nie są usuwane, tylko oznaczane jako
wycofane – historia zmian zostaje w `AedRecordHistory`.
"""
import hashlib
import json
import re
from typing import Dict, List

from django.db import transaction
from django.utils import timezone

from mcod.aed import schema
from mcod.aed.models import (
    CHANGE_ADDED,
    CHANGE_RESTORED,
    CHANGE_UPDATED,
    CHANGE_WITHDRAWN,
    STATUS_ACTIVE,
    STATUS_WITHDRAWN,
    AedRecord,
    AedRecordHistory,
)
from mcod.aed.validation import NormalizedRow

TRACKED_EXTRA = ("lat", "lon", "teryt_gminy", "gmina", "powiat", "wojewodztwo", "coords_source", "address_source")


def provider_ident(organization) -> str:
    regon = re.sub(r"\D", "", organization.regon or "")
    return regon or f"ORG{organization.pk}"


def make_uid(organization, local_id: str) -> str:
    local = re.sub(r"[^0-9A-Za-z._-]+", "-", str(local_id).strip()).strip("-")[:80] or "x"
    return f"PL-AED-{provider_ident(organization)}-{local}"


def _payload(nr: NormalizedRow) -> Dict[str, object]:
    attributes = {name: nr.values.get(name) for name in schema.field_names()}
    return {
        "attributes": attributes,
        "lat": nr.values.get("szerokosc_geogr"),
        "lon": nr.values.get("dlugosc_geogr"),
        "teryt_gminy": nr.geo.get("teryt_gminy", ""),
        "gmina": nr.geo.get("gmina", ""),
        "powiat": nr.geo.get("powiat", ""),
        "wojewodztwo": nr.geo.get("wojewodztwo", ""),
        "coords_source": nr.coords_source,
        "address_source": nr.address_source,
    }


def _hash(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def _diff(record: AedRecord, payload: dict) -> dict:
    diff = {}
    old_attrs = record.attributes or {}
    for key, new in payload["attributes"].items():
        old = old_attrs.get(key)
        if old != new:
            diff[key] = [old, new]
    for key in TRACKED_EXTRA:
        old = getattr(record, key)
        if old != payload[key] and not (old in (None, "") and payload[key] in (None, "")):
            diff[key] = [old, payload[key]]
    return diff


def _apply(record: AedRecord, payload: dict, row_hash: str, nr: NormalizedRow, dataset, resource, now):
    record.attributes = payload["attributes"]
    for key in TRACKED_EXTRA:
        setattr(record, key, payload[key])
    record.row_hash = row_hash
    record.local_id = nr.local_id
    record.local_id_generated = nr.local_id_generated
    record.quality_score = nr.quality_score()
    record.dataset = dataset
    record.resource = resource
    record.last_seen = now


@transaction.atomic
def sync_rows(run, organization, dataset, resource, rows: List[NormalizedRow]) -> Dict[str, int]:
    now = timezone.now()
    counts = {"added": 0, "updated": 0, "unchanged": 0, "withdrawn": 0, "restored": 0}
    scope = {r.uid: r for r in AedRecord.objects.select_for_update().filter(organization=organization, dataset=dataset)}
    seen = set()

    for nr in rows:
        if nr.is_critical:
            continue
        uid = make_uid(organization, nr.local_id)
        if uid in seen:
            continue
        seen.add(uid)
        payload = _payload(nr)
        row_hash = _hash(payload)
        record = scope.get(uid) or AedRecord.objects.filter(uid=uid, organization=organization).first()

        if record is None:
            record = AedRecord(uid=uid, organization=organization, status=STATUS_ACTIVE, updated_at=now)
            _apply(record, payload, row_hash, nr, dataset, resource, now)
            record.save()
            AedRecordHistory.objects.create(record=record, run=run, change_type=CHANGE_ADDED, diff={})
            counts["added"] += 1
            continue

        if record.status == STATUS_WITHDRAWN:
            diff = _diff(record, payload)
            _apply(record, payload, row_hash, nr, dataset, resource, now)
            record.status = STATUS_ACTIVE
            record.withdrawn_at = None
            record.updated_at = now
            record.save()
            AedRecordHistory.objects.create(record=record, run=run, change_type=CHANGE_RESTORED, diff=diff)
            counts["restored"] += 1
        elif record.row_hash != row_hash:
            diff = _diff(record, payload)
            _apply(record, payload, row_hash, nr, dataset, resource, now)
            record.updated_at = now
            record.save()
            AedRecordHistory.objects.create(record=record, run=run, change_type=CHANGE_UPDATED, diff=diff)
            counts["updated"] += 1
        else:
            record.last_seen = now
            record.resource = resource
            record.quality_score = nr.quality_score()
            record.save(update_fields=["last_seen", "resource", "quality_score"])
            counts["unchanged"] += 1

    for uid, record in scope.items():
        if uid not in seen and record.status == STATUS_ACTIVE:
            record.status = STATUS_WITHDRAWN
            record.withdrawn_at = now
            record.save(update_fields=["status", "withdrawn_at"])
            AedRecordHistory.objects.create(
                record=record, run=run, change_type=CHANGE_WITHDRAWN, diff={"powod": "brak w nowej wersji zasobu"}
            )
            counts["withdrawn"] += 1
    return counts


@transaction.atomic
def withdraw_all(organization, dataset, run=None, reason: str = "") -> int:
    now = timezone.now()
    count = 0
    for record in AedRecord.objects.select_for_update().filter(
        organization=organization, dataset=dataset, status=STATUS_ACTIVE
    ):
        record.status = STATUS_WITHDRAWN
        record.withdrawn_at = now
        record.save(update_fields=["status", "withdrawn_at"])
        AedRecordHistory.objects.create(record=record, run=run, change_type=CHANGE_WITHDRAWN, diff={"powod": reason})
        count += 1
    return count
