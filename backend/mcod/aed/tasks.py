import logging

from mcod.core.tasks import extended_shared_task

logger = logging.getLogger("mcod")


@extended_shared_task(ignore_result=True, name="mcod.aed.tasks.aed_process_dataset_task")
def aed_process_dataset_task(dataset_id: int, force: bool = False):
    """Jeden przebieg na zbiór naraz – kolejne zlecenia w trakcie przetwarzania są odkładane."""
    from django.core.cache import cache

    from mcod.aed.service import process_dataset

    lock = f"aed:dataset:{dataset_id}:lock"
    if not cache.add(lock, "1", timeout=600):
        aed_process_dataset_task.apply_async(args=(dataset_id,), kwargs={"force": force}, countdown=15)
        logger.info("AED: dataset %s is being processed – rescheduled", dataset_id)
        return None
    try:
        run = process_dataset(dataset_id, force=force)
    finally:
        cache.delete(lock)
    logger.info("AED: dataset %s processed -> %s", dataset_id, getattr(run, "status", None))
    return getattr(run, "pk", None)


@extended_shared_task(ignore_result=True, name="mcod.aed.tasks.aed_rebuild_aggregate_task")
def aed_rebuild_aggregate_task():
    from mcod.aed.aggregate import rebuild

    info = rebuild()
    return info.records_count


@extended_shared_task(ignore_result=True, name="mcod.aed.tasks.aed_nightly_resync_task")
def aed_nightly_resync_task():
    """Siatka bezpieczeństwa: pełna resynchronizacja wszystkich zbiorów AED (pomija pliki bez zmian)."""
    from mcod.aed.aggregate import rebuild
    from mcod.aed.service import process_all

    process_all(force=False)
    rebuild()
