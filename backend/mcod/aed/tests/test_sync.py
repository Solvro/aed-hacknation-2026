"""Synchronizacja per dostawca: zmienia wyłącznie rekordy (instytucja, zbiór) przebiegu."""
import pytest

from mcod.aed.mapping import map_columns
from mcod.aed.models import STATUS_ACTIVE, STATUS_WITHDRAWN, AedImportRun, AedRecord
from mcod.aed.sync import make_uid, sync_rows, withdraw_all
from mcod.aed.validation import normalize_row
from mcod.datasets.factories import DatasetFactory
from mcod.organizations.factories import OrganizationFactory


def rows_from(raw_rows):
    mapping = map_columns(list(raw_rows[0].keys()), raw_rows)
    return [normalize_row(i, r, mapping) for i, r in enumerate(raw_rows)]


def provider(title):
    org = OrganizationFactory.create(title=title, regon="")
    dataset = DatasetFactory.create(organization=org, is_aed_dataset=True)
    return org, dataset


def run_for(org, dataset):
    return AedImportRun.objects.create(organization=org, dataset=dataset)


KROSNO_V1 = [
    {"id_aed": "1", "lat": "49.7188", "lon": "21.7203", "nazwa_obiektu": "Pływalnia"},
    {"id_aed": "2", "lat": "49.7190", "lon": "21.7113", "nazwa_obiektu": "Kampus"},
    {"id_aed": "3", "lat": "49.6839", "lon": "21.7711", "nazwa_obiektu": "Urząd Miasta"},
]


@pytest.mark.django_db
def test_incremental_sync_touches_only_own_rows():
    krosno, krosno_ds = provider("Urząd Miasta Krosna")
    marki, marki_ds = provider("Urząd Miasta Marki")

    counts = sync_rows(run_for(krosno, krosno_ds), krosno, krosno_ds, None, rows_from(KROSNO_V1))
    assert counts["added"] == 3
    sync_rows(run_for(marki, marki_ds), marki, marki_ds, None,
              rows_from([{"id_aed": "1", "lat": "52.3267", "lon": "21.1075"}]))
    marki_snapshot = list(AedRecord.objects.filter(organization=marki).values("uid", "status", "row_hash", "updated_at"))

    v2 = [dict(KROSNO_V1[0]), dict(KROSNO_V1[1], nazwa_obiektu="Kampus – portiernia")]  # wiersz 3 usunięty
    run = run_for(krosno, krosno_ds)
    counts = sync_rows(run, krosno, krosno_ds, None, rows_from(v2))
    assert counts == {"added": 0, "updated": 1, "unchanged": 1, "withdrawn": 1, "restored": 0}

    changed = AedRecord.objects.get(uid=make_uid(krosno, "2"))
    assert changed.attributes["nazwa_obiektu"] == "Kampus – portiernia"
    assert changed.history.filter(change_type="updated").first().diff["nazwa_obiektu"] == ["Kampus", "Kampus – portiernia"]
    withdrawn = AedRecord.objects.get(uid=make_uid(krosno, "3"))
    assert withdrawn.status == STATUS_WITHDRAWN and withdrawn.withdrawn_at is not None

    # rekordy innego dostawcy nietknięte
    assert list(AedRecord.objects.filter(organization=marki).values("uid", "status", "row_hash", "updated_at")) == marki_snapshot

    # wiersz wraca w kolejnej wersji -> przywrócony z historią
    counts = sync_rows(run_for(krosno, krosno_ds), krosno, krosno_ds, None, rows_from(KROSNO_V1))
    assert counts["restored"] == 1
    assert AedRecord.objects.get(uid=make_uid(krosno, "3")).status == STATUS_ACTIVE


@pytest.mark.django_db
def test_critical_rows_are_not_synced_and_uid_includes_provider():
    org, ds = provider("Gmina Testowa")
    rows = rows_from([
        {"id_aed": "A", "lat": "50.06", "lon": "19.93"},
        {"id_aed": "B", "lat": "48.85", "lon": "2.35"},  # poza Polską -> krytyczny
    ])
    sync_rows(run_for(org, ds), org, ds, None, rows)
    uids = set(AedRecord.objects.filter(organization=org).values_list("uid", flat=True))
    assert uids == {make_uid(org, "A")}
    assert make_uid(org, "A").startswith(f"PL-AED-ORG{org.pk}-")


@pytest.mark.django_db
def test_withdraw_all_when_dataset_leaves_aggregate():
    org, ds = provider("Powiat Testowy")
    sync_rows(run_for(org, ds), org, ds, None, rows_from(KROSNO_V1))
    assert withdraw_all(org, ds, reason="zdjęto flagę AED") == 3
    assert not AedRecord.objects.filter(organization=org, status=STATUS_ACTIVE).exists()
