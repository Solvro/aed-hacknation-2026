"""Uwagi do danych w Ogólnopolskim zbiorze AED kierujemy do dostawców, nie do właściciela agregatu.

Właściciel agregatu (Ministerstwo Cyfryzacji) nie odpowiada za treść rekordów – odpowiada instytucja wskazana
w kolumnie `dostawca`. Dlatego zgłoszenia wysyłane wprost na zbiór lub zasób agregatu są odrzucane z informacją,
aby zgłosić uwagę do dostawcy (frontend pokazuje przycisk „Zgłoś uwagi do dostawcy” przy każdej instytucji;
zgłoszenie trafia na zasób źródłowy dostawcy standardowym mechanizmem portalu).
"""
import falcon

MESSAGE = (
    "Ogólnopolski zbiór AED łączy dane wielu dostawców. Uwagi zgłoś bezpośrednio do instytucji odpowiedzialnej "
    "za dane (kolumna „dostawca”) – przyciskiem „Zgłoś uwagi do dostawcy” przy wybranej instytucji."
)


def _info():
    from mcod.aed.models import AedAggregateInfo

    return AedAggregateInfo.get()


def is_aggregate_resource(resource_id) -> bool:
    info = _info()
    return bool(info) and int(resource_id) in {info.csv_resource_id, info.geojson_resource_id}


def is_aggregate_dataset(dataset_id) -> bool:
    info = _info()
    return bool(info) and info.dataset_id == int(dataset_id)


def reject_if_aggregate(resource_id=None, dataset_id=None):
    if (resource_id is not None and is_aggregate_resource(resource_id)) or (
        dataset_id is not None and is_aggregate_dataset(dataset_id)
    ):
        raise falcon.HTTPForbidden(title="Zgłoś uwagi do dostawcy danych", description=MESSAGE)
