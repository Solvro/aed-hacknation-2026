"""Tworzy zbiór „Ogólnopolski zbiór AED” należący do Ministerstwa Cyfryzacji (lub instytucji wskazanej w
AED_AGGREGATE_OWNER_ORGANIZATION_PK) z dwoma zasobami o stałych identyfikatorach: CSV i GeoJSON."""
from django.apps import apps
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from mcod.aed import aggregate, demo
from mcod.aed.models import AedAggregateInfo

NOTES = (
    "<p>Ogólnopolski, zagregowany zbiór danych o lokalizacji automatycznych defibrylatorów zewnętrznych (AED), "
    "budowany automatycznie ze zbiorów publikowanych w portalu dane.gov.pl przez instytucje (dostawców danych) "
    "i oznaczonych jako „zbiór danych o defibrylatorach AED”.</p>"
    "<p>Każdy wiersz wskazuje dostawcę odpowiedzialnego za rekord (kolumny <code>dostawca</code>, "
    "<code>zbior_zrodlowy</code>, <code>data_aktualizacji</code>) – zmiany należy zgłaszać do dostawcy. Dane są "
    "walidowane względem wzorcowego zakresu danych AED; lokalizacje weryfikowane w usługach GUGiK. Zbiór "
    "aktualizuje się przy każdej publikacji nowej wersji danych przez dostawcę.</p>"
)


class Command(BaseCommand):
    help = "Tworzy (idempotentnie) zbiór Ogólnopolskiego zbioru AED i jego zasoby CSV/GeoJSON"

    def handle(self, *args, **options):
        Organization = apps.get_model("organizations", "Organization")
        user = demo.admin_user()
        if user is None:
            raise CommandError("Brak superużytkownika – uruchom najpierw init_mcod_db")

        owner_pk = getattr(settings, "AED_AGGREGATE_OWNER_ORGANIZATION_PK", None)
        if owner_pk:
            owner = Organization.objects.filter(pk=owner_pk).first()
            if owner is None:
                raise CommandError(f"Instytucja AED_AGGREGATE_OWNER_ORGANIZATION_PK={owner_pk} nie istnieje")
        else:
            owner, _ = demo.get_or_create_org(
                "Ministerstwo Cyfryzacji", institution_type="state", city="Warszawa", postal_code="00-583",
                slug="ministerstwo-cyfryzacji", created_by=user,
            )

        info = AedAggregateInfo.get() or AedAggregateInfo.objects.create()
        if info.dataset_id and info.csv_resource_id and info.geojson_resource_id:
            self.stdout.write(f"Agregat już istnieje: zbiór #{info.dataset_id}, CSV #{info.csv_resource_id}, "
                              f"GeoJSON #{info.geojson_resource_id}")
            return

        dataset, _ = demo.get_or_create_dataset(
            owner,
            "Ogólnopolski zbiór AED – lokalizacje defibrylatorów",
            NOTES,
            user,
            cc_by=True,
            is_aed=False,
            frequency="monthly",
            tags=("AED", "defibrylatory", "ratownictwo", "zdrowie"),
        )
        records = list(aggregate.active_records())
        info.dataset = dataset
        if not info.csv_resource_id:
            info.csv_resource = demo.create_file_resource(
                dataset,
                "Ogólnopolski zbiór AED (CSV)",
                "<p>Zagregowane dane o defibrylatorach AED w formacie CSV (UTF-8), zgodne ze wzorcowym zakresem danych AED.</p>",
                aggregate.CSV_FILENAME,
                aggregate.build_csv(records),
                "csv",
                user,
            )
        if not info.geojson_resource_id:
            info.geojson_resource = demo.create_file_resource(
                dataset,
                "Ogólnopolski zbiór AED (GeoJSON)",
                "<p>Zagregowane dane o defibrylatorach AED w formacie GeoJSON (WGS84) – do map i aplikacji.</p>",
                aggregate.GEOJSON_FILENAME,
                aggregate.build_geojson(records),
                "geojson",
                user,
            )
        info.records_count = len(records)
        info.save()
        self.stdout.write(self.style.SUCCESS(
            f"Utworzono agregat: instytucja „{owner.title}” (#{owner.pk}), zbiór #{dataset.pk}, "
            f"CSV #{info.csv_resource_id}, GeoJSON #{info.geojson_resource_id}"
        ))
