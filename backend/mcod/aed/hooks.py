"""Punkt zaczepienia w pipeline zasobów portalu.

Wywoływany na końcu `entrypoint_process_resource_file_validation_task` i
`entrypoint_process_resource_validation_task`, gdy walidacja pliku się powiodła. Nigdy nie przerywa pipeline'u
portalu – wszystkie błędy są logowane.
"""
import logging

from django.apps import apps

logger = logging.getLogger("mcod")


def on_resource_processed(resource) -> None:
    try:
        from mcod.aed.aggregate import ensure_tabular_schema
        from mcod.aed.models import AedAggregateInfo
        from mcod.aed.tasks import aed_process_dataset_task

        Resource = apps.get_model("resources", "Resource")
        resource_id = getattr(resource, "pk", resource)
        resource = Resource.raw.select_related("dataset").filter(pk=resource_id).first()
        if resource is None or resource.dataset is None:
            return
        info = AedAggregateInfo.get()
        if info and resource.pk == info.csv_resource_id:
            # Pierwsze przetworzenie zasobu agregatu: włącz natywną mapę portalu (kolumny lat/lon + etykieta)
            if ensure_tabular_schema(resource):
                resource.revalidate(update_verification_date=False)
            return
        if info and resource.dataset_id == info.dataset_id:
            return
        if resource.dataset.is_aed_dataset:
            aed_process_dataset_task.apply_async(args=(resource.dataset_id,), countdown=2)
    except Exception:  # noqa: BLE001
        logger.exception("AED hook failed for resource %s", getattr(resource, "pk", resource))
