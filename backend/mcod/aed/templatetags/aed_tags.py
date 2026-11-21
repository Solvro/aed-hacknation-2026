from django import template

register = template.Library()


@register.inclusion_tag("admin/aed/_dataset_summary.html")
def aed_dataset_summary(dataset):
    from mcod.aed.models import STATUS_ACTIVE, STATUS_WITHDRAWN, AedAggregateInfo

    if dataset is None or not getattr(dataset, "pk", None):
        return {"dataset": None}
    info = AedAggregateInfo.get()
    is_aggregate = bool(info and info.dataset_id == dataset.pk)
    last_run = dataset.aed_import_runs.first()
    return {
        "dataset": dataset,
        "is_aggregate": is_aggregate,
        "info": info,
        "last_run": last_run,
        "active": dataset.aed_records.filter(status=STATUS_ACTIVE).count(),
        "withdrawn": dataset.aed_records.filter(status=STATUS_WITHDRAWN).count(),
        "runs": dataset.aed_import_runs.all()[:5],
    }
