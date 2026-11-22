"""Panel dostawcy: raporty jakości danych AED i podgląd własnych rekordów w agregacie.

Wszystko jest tylko do odczytu dla redaktorów i pełnomocników, zawężone do instytucji użytkownika.
"""
import csv
import os
import tempfile

import requests
from django.conf import settings
from django.http import FileResponse

from django.contrib import admin, messages
from django.core.exceptions import PermissionDenied
from django.http import HttpResponse, HttpResponseRedirect
from django.shortcuts import get_object_or_404
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils.html import format_html
from django.utils.safestring import mark_safe

from mcod.aed import schema
from mcod.aed.models import AedImportRun, AedRecord
from mcod.aed.precheck import load as load_precheck, run_precheck, store as store_precheck

SEVERITY_LABELS = {"critical": "błąd krytyczny", "warning": "ostrzeżenie", "info": "informacja"}


def _user_org_ids(request):
    return list(request.user.organizations.values_list("id", flat=True))


class ScopedReadOnlyAdmin(admin.ModelAdmin):
    def get_queryset(self, request):
        qs = super().get_queryset(request)
        if request.user.is_superuser:
            return qs
        return qs.filter(organization_id__in=_user_org_ids(request))

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return request.user.is_superuser

    def has_view_permission(self, request, obj=None):
        if request.user.is_superuser:
            return True
        if not request.user.is_authenticated or not request.user.organizations.exists():
            return False
        return obj is None or obj.organization_id in _user_org_ids(request)

    def has_module_permission(self, request):
        return self.has_view_permission(request)


@admin.register(AedImportRun)
class AedImportRunAdmin(ScopedReadOnlyAdmin):
    list_display = (
        "started_at",
        "organization",
        "dataset_link",
        "status_badge",
        "rows_total",
        "rows_accepted",
        "rows_rejected",
        "added",
        "updated",
        "withdrawn",
        "quality_score",
    )
    list_display_links = ("started_at",)
    list_filter = ("status",)
    search_fields = ("organization__title", "dataset__title")
    list_select_related = ("organization", "dataset", "resource")

    def get_list_filter(self, request):
        return ("status", "organization") if request.user.is_superuser else ("status",)

    def dataset_link(self, obj):
        if not obj.dataset_id:
            return "-"
        url = reverse("admin:datasets_dataset_change", args=[obj.dataset_id])
        return format_html('<a href="{}">{}</a>', url, obj.dataset.title)

    dataset_link.short_description = "zbiór"

    def status_badge(self, obj):
        colors = {"ok": "#1a7f37", "partial": "#9a6700", "error": "#cf222e", "skipped": "#57606a"}
        return format_html(
            '<span style="color:{};font-weight:bold">{}</span>', colors.get(obj.status, "#000"), obj.get_status_display()
        )

    status_badge.short_description = "status"

    def get_urls(self):
        custom = [
            path("precheck/", self.admin_site.admin_view(self.precheck_view), name="aed_precheck"),
            path("precheck/wzorcowy-zakres.xlsx", self.admin_site.admin_view(self.precheck_schema_xlsx), name="aed_precheck_schema"),
            path("precheck/<str:token>/", self.admin_site.admin_view(self.precheck_result), name="aed_precheck_result"),
            path("precheck/<str:token>/<str:kind>.csv", self.admin_site.admin_view(self.precheck_download), name="aed_precheck_download"),
            path("<int:run_id>/issues.csv", self.admin_site.admin_view(self.issues_csv), name="aed_aedimportrun_issues_csv"),
            path("<int:run_id>/reprocess/", self.admin_site.admin_view(self.reprocess), name="aed_aedimportrun_reprocess"),
        ]
        return custom + super().get_urls()

    def _get_run(self, request, run_id):
        run = get_object_or_404(self.get_queryset(request), pk=run_id)
        if not self.has_view_permission(request, run):
            raise PermissionDenied
        return run

    def change_view(self, request, object_id, form_url="", extra_context=None):
        run = self._get_run(request, object_id)
        issues = run.issues or []
        context = dict(
            self.admin_site.each_context(request),
            opts=self.model._meta,
            title=str(run),
            run=run,
            general_issues=[i for i in issues if i.get("row") is None],
            row_issues=[i for i in issues if i.get("row") is not None][:1000],
            row_issues_total=sum(1 for i in issues if i.get("row") is not None),
            severity_labels=SEVERITY_LABELS,
            mapping=sorted((run.column_mapping or {}).items()),
            missing_fields=[f for f in schema.field_names() if f not in (run.column_mapping or {})],
            can_reprocess=request.user.is_superuser or run.organization_id in _user_org_ids(request),
            has_view_permission=True,
        )
        return TemplateResponse(request, "admin/aed/run_report.html", context)

    def issues_csv(self, request, run_id):
        run = self._get_run(request, run_id)
        response = HttpResponse(content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="raport_aed_{run.pk}.csv"'
        response.write("﻿")
        writer = csv.writer(response)
        writer.writerow(["wiersz", "pole", "waga", "kod", "komunikat", "wartosc"])
        for issue in run.issues or []:
            writer.writerow(
                [
                    issue.get("row") or "",
                    issue.get("field", ""),
                    SEVERITY_LABELS.get(issue.get("severity"), issue.get("severity")),
                    issue.get("code", ""),
                    issue.get("message", ""),
                    issue.get("value", ""),
                ]
            )
        return response

    # --- Sprawdzenie pliku przed publikacją -------------------------------------------------------------
    def _precheck_context(self, request, **extra):
        return dict(self.admin_site.each_context(request), opts=self.model._meta, title="Sprawdź plik AED przed publikacją",
                    has_view_permission=True, **extra)

    def precheck_view(self, request):
        if not self.has_view_permission(request):
            raise PermissionDenied
        error = None
        if request.method == "POST":
            upload = request.FILES.get("file")
            link = (request.POST.get("link") or "").strip()
            try:
                if upload:
                    filename = upload.name
                    suffix = os.path.splitext(filename)[1].lower() or ".csv"
                    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                        for chunk in upload.chunks():
                            tmp.write(chunk)
                        path_ = tmp.name
                elif link:
                    filename = link
                    resp = requests.get(link, timeout=30, headers={"User-Agent": "dane.gov.pl AED precheck"})
                    resp.raise_for_status()
                    suffix = os.path.splitext(link.split("?")[0])[1].lower()
                    if suffix not in (".csv", ".tsv", ".xlsx", ".xls", ".ods", ".json", ".geojson"):
                        ctype = resp.headers.get("content-type", "")
                        suffix = ".json" if "json" in ctype else ".csv"
                    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                        tmp.write(resp.content)
                        path_ = tmp.name
                else:
                    raise ValueError("Wybierz plik albo wklej link do danych.")
                fmt = suffix.strip(".")
                result = run_precheck(path_, fmt, filename)
                os.unlink(path_)
                token = store_precheck(result, request.user.id)
                return HttpResponseRedirect(reverse("admin:aed_precheck_result", args=[token]))
            except (ValueError, requests.RequestException) as exc:
                error = str(exc)
        return TemplateResponse(request, "admin/aed/precheck.html", self._precheck_context(request, error=error))

    def precheck_result(self, request, token):
        if not self.has_view_permission(request):
            raise PermissionDenied
        result = load_precheck(token, request.user.id)
        if result is None:
            messages.warning(request, "Wynik sprawdzenia wygasł lub należy do innego użytkownika – sprawdź plik ponownie.")
            return HttpResponseRedirect(reverse("admin:aed_precheck"))
        return TemplateResponse(request, "admin/aed/precheck.html", self._precheck_context(request, result=result, token=token))

    def precheck_download(self, request, token, kind):
        result = load_precheck(token, request.user.id) if self.has_view_permission(request) else None
        if result is None or kind not in ("poprawiony", "uwagi"):
            raise PermissionDenied
        response = HttpResponse(content_type="text/csv; charset=utf-8")
        name = "aed_plik_z_poprawkami.csv" if kind == "poprawiony" else "aed_lista_uwag.csv"
        response["Content-Disposition"] = f'attachment; filename="{name}"'
        response.write("\ufeff" + (result["corrected_csv"] if kind == "poprawiony" else result["issues_csv"]))
        return response

    def precheck_schema_xlsx(self, request):
        if not self.has_view_permission(request):
            raise PermissionDenied
        path_ = os.path.join(str(settings.DATA_DIR), "aed", "export", "aed_wzorcowy_zakres.xlsx")
        response = FileResponse(open(path_, "rb"), as_attachment=True, filename="aed_wzorcowy_zakres.xlsx")
        return response

    def reprocess(self, request, run_id):
        run = self._get_run(request, run_id)
        if not (request.user.is_superuser or run.organization_id in _user_org_ids(request)):
            raise PermissionDenied
        from mcod.aed.tasks import aed_process_dataset_task

        if run.dataset_id:
            aed_process_dataset_task.apply_async(args=(run.dataset_id,), kwargs={"force": True})
            messages.info(request, "Zlecono ponowne przetworzenie zbioru AED. Odśwież listę raportów za chwilę.")
        return HttpResponseRedirect(reverse("admin:aed_aedimportrun_changelist"))


@admin.register(AedRecord)
class AedRecordAdmin(ScopedReadOnlyAdmin):
    list_display = ("uid", "organization", "status", "nazwa", "miejscowosc", "gmina", "coords_source", "quality_score", "updated_at")
    list_filter = ("status", "coords_source")
    search_fields = ("uid", "local_id", "gmina", "organization__title")
    list_select_related = ("organization",)
    readonly_fields = (
        "uid",
        "organization",
        "dataset",
        "resource",
        "local_id",
        "local_id_generated",
        "status",
        "lat",
        "lon",
        "coords_source",
        "address_source",
        "teryt_gminy",
        "gmina",
        "powiat",
        "wojewodztwo",
        "attributes_table",
        "quality_score",
        "first_seen",
        "updated_at",
        "last_seen",
        "withdrawn_at",
        "history_table",
    )
    exclude = ("attributes", "row_hash")

    def get_list_filter(self, request):
        base = ("status", "coords_source")
        return base + ("organization",) if request.user.is_superuser else base

    def nazwa(self, obj):
        return obj.attributes.get("nazwa_obiektu") or "-"

    nazwa.short_description = "obiekt"

    def miejscowosc(self, obj):
        return obj.attributes.get("miejscowosc") or "-"

    miejscowosc.short_description = "miejscowość"

    def attributes_table(self, obj):
        rows = "".join(
            format_html("<tr><th style='text-align:left;padding-right:12px'>{}</th><td>{}</td></tr>", name, obj.attributes.get(name))
            for name in schema.field_names()
            if obj.attributes.get(name) not in (None, "")
        )
        return format_html("<table>{}</table>", mark_safe(rows)) if rows else "-"

    attributes_table.short_description = "dane wzorcowe"

    def history_table(self, obj):
        rows = "".join(
            format_html("<tr><td>{}</td><td>{}</td><td><code>{}</code></td></tr>", h.created.strftime("%Y-%m-%d %H:%M"), h.get_change_type_display(), h.diff)
            for h in obj.history.all()[:30]
        )
        return format_html("<table>{}</table>", mark_safe(rows)) if rows else "-"

    history_table.short_description = "historia zmian"

    def change_view(self, request, object_id, form_url="", extra_context=None):
        extra_context = extra_context or {}
        extra_context.update({"show_save": False, "show_save_and_continue": False, "show_save_and_add_another": False})
        return super().change_view(request, object_id, form_url, extra_context)
