"""Dane demonstracyjne: 4 instytucje z prawdziwymi zbiorami AED opublikowanymi w dane.gov.pl
(Krosno – CSV z adresem w jednej kolumnie, Przemyśl – GeoJSON, Marki – uszkodzony CSV z zamienionymi
współrzędnymi, Legionowo – CSV prawie zgodny ze wzorcem). Każda instytucja dostaje konto pełnomocnika
<klucz>@mcod.local i publikuje swój zbiór tak jak w panelu dostawcy, oznaczając go jako zbiór AED."""
from django.core.management.base import BaseCommand, CommandError

from mcod.aed import demo


class Command(BaseCommand):
    help = "Tworzy instytucje, konta pełnomocników i zbiory AED z prawdziwymi plikami z dane.gov.pl"

    def handle(self, *args, **options):
        admin = demo.admin_user()
        if admin is None:
            raise CommandError("Brak superużytkownika – uruchom najpierw init_mcod_db")
        for p in demo.PROVIDERS:
            org, created_org = demo.get_or_create_org(
                p["title"], institution_type="local", city=p["city"], postal_code=p["postal_code"], created_by=admin
            )
            user = demo.get_or_create_agent(f"{p['key']}@mcod.local", org, f"Pełnomocnik – {p['title']}")
            notes = (
                f"<p>Lokalizacje defibrylatorów AED udostępniane przez {p['title']}. "
                f"Dane demonstracyjne skopiowane ze zbioru opublikowanego w portalu dane.gov.pl: {p['source']}</p>"
            )
            dataset, created_ds = demo.get_or_create_dataset(
                org, p["dataset"], notes, user, cc_by=p["license"] == "CC BY", is_aed=True,
                tags=("AED", "defibrylatory"),
            )
            if created_ds or not dataset.resources.exists():
                demo.create_file_resource(
                    dataset,
                    p["dataset"],
                    f"<p>{p['dataset']} – plik źródłowy ({p['format'].upper()}).</p>",
                    p["file"],
                    demo.read_demo_file(p["file"]),
                    p["format"],
                    user,
                )
            self.stdout.write(
                f"{'+' if created_ds else '='} {org.title} (#{org.pk}) – zbiór #{dataset.pk}, konto {user.email}"
            )
        self.stdout.write(self.style.SUCCESS(
            f"Gotowe. Hasło kont pełnomocników: {demo.DEMO_PASSWORD}. Zasoby przetwarza celery – raporty AED pojawią się "
            "w panelu po walidacji plików."
        ))
