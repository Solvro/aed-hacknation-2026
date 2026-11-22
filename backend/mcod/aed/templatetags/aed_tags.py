from django import template

register = template.Library()


@register.inclusion_tag("admin/aed/_dataset_summary.html")
def aed_dataset_summary(dataset):
    from mcod.aed.models import STATUS_ACTIVE, STATUS_WITHDRAWN, AedAggregateInfo

    if dataset is None or not getattr(dataset, "pk", None):
        return {"dataset": None}
    info = AedAggregateInfo.get()
    is_aggregate = bool(info and info.dataset_id == dataset.pk)
    last_run = dataset.aed_import_runs.exclude(status="running").first()
    changes = []
    if last_run:
        from mcod.aed import schema

        titles = {f["name"]: f.get("title", f["name"]) for f in schema.fields()}
        labels = {"added": "dodany", "updated": "zmieniony", "withdrawn": "wycofany", "restored": "przywrócony"}
        for h in last_run.changes.select_related("record").order_by("change_type", "record__local_id")[:20]:
            rec = h.record
            diff = []
            for key, val in (h.diff or {}).items():
                if isinstance(val, list) and len(val) == 2:
                    diff.append({"field": titles.get(key, key), "old": val[0], "new": val[1]})
            changes.append({
                "type": h.change_type,
                "label": labels.get(h.change_type, h.change_type),
                "uid": rec.uid,
                "name": (rec.attributes or {}).get("nazwa_obiektu") or rec.local_id,
                "diff": diff[:4],
                "reason": (h.diff or {}).get("powod", ""),
            })
    return {
        "changes": changes,
        "dataset": dataset,
        "is_aggregate": is_aggregate,
        "info": info,
        "last_run": last_run,
        "active": dataset.aed_records.filter(status=STATUS_ACTIVE).count(),
        "withdrawn": dataset.aed_records.filter(status=STATUS_WITHDRAWN).count(),
        "runs": dataset.aed_import_runs.all()[:5],
    }
