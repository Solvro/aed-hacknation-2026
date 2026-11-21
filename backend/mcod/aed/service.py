"""Przetwarzanie zbioru AED dostawcy: wybór zasobu -> odczyt -> mapowanie -> walidacja -> geokodowanie ->
synchronizacja rekordów -> raport dla dostawcy -> zaplanowanie przebudowy agregatu."""
import logging
from typing import Optional

import requests

from django.apps import apps
from django.conf import settings
from django.utils import timezone

from mcod.aed import geocoding
from mcod.aed.aggregate import schedule_rebuild
from mcod.aed.mapping import map_columns
from mcod.aed.models import RUN_ERROR, RUN_OK, RUN_PARTIAL, RUN_RUNNING, AedAggregateInfo, AedImportRun
from mcod.aed.readers import FORMAT_PRIORITY, SUPPORTED_FORMATS, ReaderError, file_sha256, read_file
from mcod.aed.sync import sync_rows, withdraw_all
from mcod.aed.validation import (
    CRITICAL,
    INFO,
    WARNING,
    Issue,
    mark_duplicates,
    missing_recommended_summary,
    normalize_row,
)

logger = logging.getLogger("mcod")

MAX_ISSUES = 5000
MAX_API_BYTES = 50 * 1024 * 1024
ALLOWED_LICENSES = ("CC0 1.0", "CC BY 4.0")


def _is_aggregate_dataset(dataset_id) -> bool:
    info = AedAggregateInfo.get()
    return bool(info and info.dataset_id == dataset_id)


def _finish(run: AedImportRun, status: str, message: str = "", issues=None) -> AedImportRun:
    run.status = status
    if message:
        run.message = message
    if issues is not None:
        run.issues = issues[:MAX_ISSUES]
        run.critical_count = sum(1 for i in issues if i.get("severity") == CRITICAL)
        run.warning_count = sum(1 for i in issues if i.get("severity") == WARNING)
    run.finished_at = timezone.now()
    run.save()
    return run


def _error_issue(code: str, message: str) -> dict:
    return Issue(row=None, field="", severity=CRITICAL, code=code, message=message).as_dict()


def select_source_resource(dataset):
    """Najnowszy opublikowany zasób w obsługiwanym formacie (CSV/XLSX > GeoJSON > JSON)."""
    Resource = apps.get_model("resources", "Resource")
    candidates, skipped = [], []
    for res in Resource.objects.filter(dataset=dataset, status="published").order_by("-modified"):
        rf = res._main_file
        fmt = ((rf.format if rf else "") or res.format or "").lower()
        if (not rf or not rf.file) and res.link and res.type == "api" and fmt in SUPPORTED_FORMATS:
            # zasób typu API (np. endpoint JSON/GeoJSON dostawcy) – dane pobierze moduł AED
            candidates.append((FORMAT_PRIORITY.get(fmt, 9), -res.modified.timestamp(), res, None, fmt))
            continue
        if not rf or not rf.file:
            skipped.append({"id": res.id, "title": res.title, "format": fmt, "powod": "zasób nie ma pliku (strona www)"})
            continue
        if fmt not in SUPPORTED_FORMATS:
            skipped.append({"id": res.id, "title": res.title, "format": fmt, "powod": f"format {fmt.upper()} nie jest obsługiwany"})
            continue
        candidates.append((FORMAT_PRIORITY.get(fmt, 9), -res.modified.timestamp(), res, rf, fmt))
    candidates.sort(key=lambda c: (c[0], c[1]))
    if not candidates:
        return None, None, None, skipped
    _, _, res, rf, fmt = candidates[0]
    for _, _, other, _, other_fmt in candidates[1:]:
        skipped.append(
            {"id": other.id, "title": other.title, "format": other_fmt, "powod": f"wybrano zasób #{res.id} ({fmt.upper()})"}
        )
    return res, rf, fmt, skipped


def download_api_resource(resource, fmt: str) -> str:
    """Pobiera dane zasobu typu API (link) do pliku tymczasowego – jak pobranie pliku przez portal."""
    import tempfile

    resp = requests.get(resource.link, timeout=30, headers={"User-Agent": "dane.gov.pl AED aggregator"}, stream=True)
    resp.raise_for_status()
    content = b""
    for chunk in resp.iter_content(65536):
        content += chunk
        if len(content) > MAX_API_BYTES:
            raise ValueError("odpowiedź API jest zbyt duża (limit 50 MB)")
    tmp = tempfile.NamedTemporaryFile(prefix=f"aed_res{resource.id}_", suffix=f".{fmt}", delete=False)
    tmp.write(content)
    tmp.close()
    return tmp.name


def process_dataset(dataset_id: int, force: bool = False) -> Optional[AedImportRun]:
    Dataset = apps.get_model("datasets", "Dataset")
    dataset = Dataset.raw.filter(pk=dataset_id).select_related("organization").first()
    if dataset is None or _is_aggregate_dataset(dataset.id):
        return None
    organization = dataset.organization

    if not dataset.is_aed_dataset or dataset.status != "published" or dataset.is_removed:
        withdrawn = withdraw_all(organization, dataset, reason="zbiór nie jest opublikowanym zbiorem AED")
        if not withdrawn:
            return None
        run = AedImportRun.objects.create(organization=organization, dataset=dataset, withdrawn=withdrawn)
        schedule_rebuild()
        return _finish(
            run,
            RUN_OK,
            f"Zbiór nie jest już opublikowanym zbiorem AED – wycofano {withdrawn} rekordów z agregatu (historia zachowana).",
            [],
        )

    run = AedImportRun(organization=organization, dataset=dataset)

    if dataset.license_name not in ALLOWED_LICENSES:
        run.save()
        withdrawn = withdraw_all(organization, dataset, run=run, reason="niekompatybilna licencja")
        run.withdrawn = withdrawn
        schedule_rebuild()
        return _finish(
            run,
            RUN_ERROR,
            f"Licencja zbioru ({dataset.license_name}) nie pozwala na włączenie danych do agregatu. "
            "Wymagana licencja CC0 1.0 lub CC BY 4.0.",
            [_error_issue("LICENSE", "Niekompatybilna licencja zbioru – wymagana CC0 1.0 lub CC BY 4.0.")],
        )

    resource, rf, fmt, skipped = select_source_resource(dataset)
    run.skipped_resources = skipped
    if resource is None:
        run.save()
        withdrawn = withdraw_all(organization, dataset, run=run, reason="brak zasobu w obsługiwanym formacie")
        run.withdrawn = withdrawn
        schedule_rebuild()
        return _finish(
            run,
            RUN_ERROR,
            "Zbiór nie zawiera opublikowanego zasobu w obsługiwanym formacie (CSV, XLSX, XLS, ODS, GeoJSON, JSON).",
            [_error_issue("NO_RESOURCE", "Brak zasobu w formacie CSV, XLSX, XLS, ODS, GeoJSON lub JSON.")],
        )

    run.resource = resource
    run.file_format = fmt
    try:
        path = resource.file_data_path if rf is not None else download_api_resource(resource, fmt)
        run.file_hash = file_sha256(path)
    except (OSError, ValueError, requests.RequestException) as exc:
        run.save()
        return _finish(
            run,
            RUN_ERROR,
            f"Nie można odczytać danych zasobu: {exc}. Dane z poprzedniej wersji pozostają w agregacie.",
            [_error_issue("FILE", str(exc))],
        )

    last = (
        AedImportRun.objects.filter(dataset=dataset, resource=resource, status__in=(RUN_OK, RUN_PARTIAL))
        .exclude(file_hash="")
        .first()
    )
    if not force and last and last.file_hash == run.file_hash:
        logger.info("AED: dataset %s resource %s unchanged – skipping", dataset.id, resource.id)
        return last

    run.status = RUN_RUNNING
    run.save()
    try:
        result = read_file(path, fmt, (rf.encoding if rf else None) or None)
    except ReaderError as exc:
        return _finish(
            run,
            RUN_ERROR,
            f"Nie udało się odczytać pliku: {exc}. Dane z poprzedniej wersji pozostają w agregacie.",
            [_error_issue("READ_ERROR", str(exc))],
        )

    run.file_format = result.file_format
    mapping = map_columns(result.headers, result.rows)
    run.column_mapping = mapping.as_report()
    run.unmapped_columns = mapping.unmapped
    run.rows_total = len(result.rows)

    has_location_columns = ("szerokosc_geogr" in mapping.fields and "dlugosc_geogr" in mapping.fields) or (
        "miejscowosc" in mapping.fields or "adres" in mapping.aux
    )
    if not has_location_columns:
        return _finish(
            run,
            RUN_ERROR,
            "Nie rozpoznano kolumn lokalizacji (współrzędnych ani adresu). Użyj nazw kolumn ze wzorcowego zakresu "
            "danych AED. Dane z poprzedniej wersji pozostają w agregacie.",
            [_error_issue("NO_LOCATION_COLUMNS", "Brak kolumn szerokosc_geogr/dlugosc_geogr ani miejscowosc/nr_budynku.")],
        )

    row_offset = 2 if result.file_format in ("csv", "tsv", "xlsx", "xls", "ods") else 1
    rows = [normalize_row(i, raw, mapping, row_offset=row_offset) for i, raw in enumerate(result.rows)]
    mark_duplicates(rows)
    for nr in rows:
        geocoding.enrich(nr)

    accepted = [nr for nr in rows if not nr.is_critical]
    run.rows_accepted = len(accepted)
    run.rows_rejected = len(rows) - len(accepted)

    general = [Issue(None, "", INFO, "READER", note).as_dict() for note in result.notes + mapping.notes]
    general += [i.as_dict() for i in missing_recommended_summary(accepted)]
    row_issues = [i.as_dict() for nr in rows for i in nr.issues]
    severity_order = {CRITICAL: 0, WARNING: 1, INFO: 2}
    row_issues.sort(key=lambda i: (severity_order.get(i["severity"], 3), i["row"] or 0))
    issues = general + row_issues

    if not accepted:
        return _finish(
            run,
            RUN_ERROR,
            "Żaden wiersz nie spełnia wymagań wzorcowego zakresu – dane z poprzedniej wersji pozostają w agregacie.",
            issues,
        )

    counts = sync_rows(run, organization, dataset, resource, rows)
    for key, value in counts.items():
        setattr(run, key, value)
    run.quality_score = round(sum(nr.quality_score() for nr in accepted) / len(accepted))
    schedule_rebuild()
    status = RUN_OK if not run.rows_rejected else RUN_PARTIAL
    message = (
        f"Przyjęto {run.rows_accepted} z {run.rows_total} wierszy. W agregacie: dodano {run.added}, zmieniono "
        f"{run.updated}, wycofano {run.withdrawn}, przywrócono {run.restored}, bez zmian {run.unchanged}."
    )
    return _finish(run, status, message, issues)


def process_all(force: bool = False) -> int:
    Dataset = apps.get_model("datasets", "Dataset")
    count = 0
    ids = set(Dataset.raw.filter(is_aed_dataset=True).values_list("id", flat=True))
    from mcod.aed.models import AedRecord

    ids |= set(AedRecord.objects.exclude(dataset=None).values_list("dataset_id", flat=True).distinct())
    for dataset_id in sorted(ids):
        try:
            process_dataset(dataset_id, force=force)
            count += 1
        except Exception:  # noqa: BLE001
            logger.exception("AED: processing dataset %s failed", dataset_id)
    return count


def aggregate_owner_pk():
    return getattr(settings, "AED_AGGREGATE_OWNER_ORGANIZATION_PK", None)
