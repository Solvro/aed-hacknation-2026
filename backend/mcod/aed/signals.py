"""Reakcja na zmiany zbiorów i zasobów: zdjęcie flagi AED, wycofanie z publikacji, usunięcie, przywrócenie.

Samo przetwarzanie nowej wersji pliku uruchamia hook w pipeline zasobów (`mcod.aed.hooks`). Tutaj obsługujemy
zmiany metadanych, po których rekordy dostawcy muszą zostać wycofane lub ponownie przeliczone.
"""
import logging

from django.db.models.signals import post_save
from django.dispatch import receiver

logger = logging.getLogger("mcod")


def _changed(instance, *fields) -> bool:
    tracker = getattr(instance, "tracker", None)
    if tracker is None:
        return False
    try:
        return any(tracker.has_changed(f) for f in fields)
    except Exception:  # noqa: BLE001 – pole nie jest śledzone
        return False


def _schedule(dataset_id):
    from mcod.aed.tasks import aed_process_dataset_task

    aed_process_dataset_task.apply_async_on_commit(args=(dataset_id,), kwargs={"force": True}, countdown=2)


@receiver(post_save, sender="datasets.Dataset")
def aed_dataset_saved(sender, instance, created, **kwargs):
    try:
        from mcod.aed.models import AedRecord

        flag_changed = _changed(instance, "is_aed_dataset") or (created and instance.is_aed_dataset)
        state_changed = _changed(instance, "status", "is_removed", "license_condition_default_cc40", "license_chosen")
        if not (flag_changed or state_changed):
            return
        if instance.is_aed_dataset or AedRecord.objects.filter(dataset_id=instance.pk).exists():
            _schedule(instance.pk)
    except Exception:  # noqa: BLE001
        logger.exception("AED dataset signal failed")


@receiver(post_save, sender="resources.Resource")
def aed_resource_saved(sender, instance, created, **kwargs):
    try:
        if created or not _changed(instance, "status", "is_removed"):
            return
        dataset = getattr(instance, "dataset", None)
        if dataset is not None and dataset.is_aed_dataset:
            _schedule(dataset.pk)
    except Exception:  # noqa: BLE001
        logger.exception("AED resource signal failed")
