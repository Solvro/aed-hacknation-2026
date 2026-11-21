"""Modele modułu „Ogólnopolski zbiór AED”.

Źródłem prawdy dla agregatu są rekordy `AedRecord` – po jednym na urządzenie zgłoszone przez dostawcę
(instytucję). Rekord zawsze wskazuje instytucję, zbiór i zasób, z którego pochodzi. Aktualizacja zasobu
dostawcy zmienia wyłącznie rekordy tej instytucji i tego zbioru (patrz `mcod.aed.sync`).
"""
from django.contrib.postgres.fields import JSONField
from django.core.exceptions import ValidationError
from django.db import models

STATUS_ACTIVE = "active"
STATUS_WITHDRAWN = "withdrawn"
RECORD_STATUS_CHOICES = (
    (STATUS_ACTIVE, "aktywny"),
    (STATUS_WITHDRAWN, "wycofany"),
)

SOURCE_PROVIDER = "dostawca"
SOURCE_GEOCODER = "geokodowanie"
SOURCE_NONE = "brak"
VALUE_SOURCE_CHOICES = (
    (SOURCE_PROVIDER, "dostawca"),
    (SOURCE_GEOCODER, "geokodowanie (GUGiK)"),
    (SOURCE_NONE, "brak"),
)

CHANGE_ADDED = "added"
CHANGE_UPDATED = "updated"
CHANGE_WITHDRAWN = "withdrawn"
CHANGE_RESTORED = "restored"
CHANGE_TYPE_CHOICES = (
    (CHANGE_ADDED, "dodany"),
    (CHANGE_UPDATED, "zmieniony"),
    (CHANGE_WITHDRAWN, "wycofany"),
    (CHANGE_RESTORED, "przywrócony"),
)

RUN_OK = "ok"
RUN_PARTIAL = "partial"
RUN_ERROR = "error"
RUN_SKIPPED = "skipped"
RUN_RUNNING = "running"
RUN_STATUS_CHOICES = (
    (RUN_RUNNING, "w toku"),
    (RUN_OK, "OK"),
    (RUN_PARTIAL, "OK – część wierszy odrzucona"),
    (RUN_ERROR, "błąd – dane nie zostały włączone"),
    (RUN_SKIPPED, "pominięto – plik bez zmian"),
)


class AedRecord(models.Model):
    uid = models.CharField(max_length=128, unique=True, verbose_name="identyfikator w agregacie")
    organization = models.ForeignKey(
        "organizations.Organization",
        on_delete=models.CASCADE,
        related_name="aed_records",
        verbose_name="dostawca (instytucja)",
    )
    dataset = models.ForeignKey(
        "datasets.Dataset",
        on_delete=models.SET_NULL,
        null=True,
        related_name="aed_records",
        verbose_name="zbiór źródłowy",
    )
    resource = models.ForeignKey(
        "resources.Resource",
        on_delete=models.SET_NULL,
        null=True,
        related_name="aed_records",
        verbose_name="zasób źródłowy",
    )
    local_id = models.CharField(max_length=200, verbose_name="identyfikator u dostawcy")
    local_id_generated = models.BooleanField(default=False, verbose_name="identyfikator wyliczony")
    status = models.CharField(max_length=20, choices=RECORD_STATUS_CHOICES, default=STATUS_ACTIVE, db_index=True)
    lat = models.FloatField(null=True, verbose_name="szerokość geograficzna")
    lon = models.FloatField(null=True, verbose_name="długość geograficzna")
    coords_source = models.CharField(max_length=20, choices=VALUE_SOURCE_CHOICES, default=SOURCE_PROVIDER)
    address_source = models.CharField(max_length=20, choices=VALUE_SOURCE_CHOICES, default=SOURCE_PROVIDER)
    teryt_gminy = models.CharField(max_length=10, blank=True, default="", db_index=True, verbose_name="TERC gminy")
    gmina = models.CharField(max_length=200, blank=True, default="")
    powiat = models.CharField(max_length=200, blank=True, default="")
    wojewodztwo = models.CharField(max_length=100, blank=True, default="")
    attributes = JSONField(default=dict, blank=True, verbose_name="pola wzorcowego zakresu")
    quality_score = models.PositiveSmallIntegerField(default=0, verbose_name="ocena jakości")
    row_hash = models.CharField(max_length=64, blank=True, default="")
    first_seen = models.DateTimeField(auto_now_add=True, verbose_name="pierwsze pojawienie się")
    updated_at = models.DateTimeField(null=True, verbose_name="ostatnia zmiana danych")
    last_seen = models.DateTimeField(null=True, verbose_name="ostatnio potwierdzony w pliku dostawcy")
    withdrawn_at = models.DateTimeField(null=True, blank=True, verbose_name="wycofany")

    class Meta:
        verbose_name = "urządzenie AED"
        verbose_name_plural = "urządzenia AED"
        ordering = ("organization_id", "local_id")
        indexes = [models.Index(fields=["organization", "dataset", "status"])]

    def __str__(self):
        return self.uid

    @property
    def is_active(self):
        return self.status == STATUS_ACTIVE


class AedImportRun(models.Model):
    organization = models.ForeignKey(
        "organizations.Organization",
        on_delete=models.CASCADE,
        related_name="aed_import_runs",
        verbose_name="dostawca (instytucja)",
    )
    dataset = models.ForeignKey(
        "datasets.Dataset", on_delete=models.SET_NULL, null=True, related_name="aed_import_runs", verbose_name="zbiór"
    )
    resource = models.ForeignKey(
        "resources.Resource",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="aed_import_runs",
        verbose_name="zasób źródłowy",
    )
    status = models.CharField(max_length=20, choices=RUN_STATUS_CHOICES, default=RUN_OK, db_index=True)
    message = models.TextField(blank=True, default="", verbose_name="komunikat")
    file_hash = models.CharField(max_length=64, blank=True, default="")
    file_format = models.CharField(max_length=20, blank=True, default="")
    rows_total = models.PositiveIntegerField(default=0, verbose_name="wiersze w pliku")
    rows_accepted = models.PositiveIntegerField(default=0, verbose_name="przyjęte")
    rows_rejected = models.PositiveIntegerField(default=0, verbose_name="odrzucone")
    added = models.PositiveIntegerField(default=0, verbose_name="dodane")
    updated = models.PositiveIntegerField(default=0, verbose_name="zmienione")
    unchanged = models.PositiveIntegerField(default=0, verbose_name="bez zmian")
    withdrawn = models.PositiveIntegerField(default=0, verbose_name="wycofane")
    restored = models.PositiveIntegerField(default=0, verbose_name="przywrócone")
    quality_score = models.PositiveSmallIntegerField(default=0, verbose_name="ocena jakości")
    critical_count = models.PositiveIntegerField(default=0, verbose_name="błędy krytyczne")
    warning_count = models.PositiveIntegerField(default=0, verbose_name="ostrzeżenia")
    column_mapping = JSONField(default=dict, blank=True, verbose_name="mapowanie kolumn")
    unmapped_columns = JSONField(default=list, blank=True, verbose_name="kolumny niezmapowane")
    skipped_resources = JSONField(default=list, blank=True, verbose_name="zasoby pominięte")
    issues = JSONField(default=list, blank=True, verbose_name="problemy")
    started_at = models.DateTimeField(auto_now_add=True, verbose_name="rozpoczęto")
    finished_at = models.DateTimeField(null=True, verbose_name="zakończono")

    class Meta:
        verbose_name = "raport AED"
        verbose_name_plural = "raporty AED"
        ordering = ("-started_at",)

    def __str__(self):
        return f"Raport AED #{self.pk} – {self.organization} ({self.get_status_display()})"


class AedRecordHistory(models.Model):
    record = models.ForeignKey(AedRecord, on_delete=models.CASCADE, related_name="history")
    run = models.ForeignKey(AedImportRun, on_delete=models.SET_NULL, null=True, related_name="changes")
    change_type = models.CharField(max_length=20, choices=CHANGE_TYPE_CHOICES)
    diff = JSONField(default=dict, blank=True)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "zmiana rekordu AED"
        verbose_name_plural = "historia zmian AED"
        ordering = ("-created",)


class AedAggregateInfo(models.Model):
    """Singleton wskazujący zbiór agregatu i jego zasoby (wzór: `resources.AggregatedDGAInfo`)."""

    dataset = models.ForeignKey("datasets.Dataset", on_delete=models.SET_NULL, null=True, related_name="+")
    csv_resource = models.ForeignKey("resources.Resource", on_delete=models.SET_NULL, null=True, related_name="+")
    geojson_resource = models.ForeignKey("resources.Resource", on_delete=models.SET_NULL, null=True, related_name="+")
    last_built = models.DateTimeField(null=True)
    records_count = models.PositiveIntegerField(default=0)
    providers_count = models.PositiveIntegerField(default=0)

    class Meta:
        verbose_name = "agregat AED"
        verbose_name_plural = "agregat AED"

    def save(self, *args, **kwargs):
        if not self.pk and AedAggregateInfo.objects.exists():
            raise ValidationError("Może istnieć tylko jeden agregat AED")
        return super().save(*args, **kwargs)

    @classmethod
    def get(cls):
        return cls.objects.select_related("dataset", "csv_resource", "geojson_resource").first()


class AedGeocodeCache(models.Model):
    key = models.CharField(max_length=64, unique=True)
    kind = models.CharField(max_length=20)
    query = models.TextField()
    result = JSONField(null=True, blank=True)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "cache geokodera AED"
