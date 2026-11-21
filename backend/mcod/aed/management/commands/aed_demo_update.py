"""Symuluje publikację nowej wersji danych przez dostawcę: podmienia plik zasobu zbioru AED instytucji na
wariant z data/aed/demo/variants/<klucz>.<rozszerzenie> i uruchamia standardowy pipeline walidacji portalu."""
import os

from django.core.management.base import BaseCommand, CommandError

from mcod.aed import demo
from mcod.aed.aggregate import replace_main_file


class Command(BaseCommand):
    help = "Podmienia plik zbioru AED dostawcy na wariant testowy (np. aed_demo_update krosno)"

    def add_arguments(self, parser):
        parser.add_argument("provider", choices=[p["key"] for p in demo.PROVIDERS])
        parser.add_argument("--original", action="store_true", help="przywróć oryginalny plik")

    def handle(self, *args, **options):
        from django.apps import apps

        Dataset = apps.get_model("datasets", "Dataset")
        p = next(x for x in demo.PROVIDERS if x["key"] == options["provider"])
        dataset = Dataset.objects.filter(title=p["dataset"], is_aed_dataset=True).first()
        if dataset is None:
            raise CommandError("Brak zbioru demo – uruchom aed_seed_demo")
        resource = dataset.resources.filter(status="published").order_by("-modified").first()
        if resource is None:
            raise CommandError("Zbiór nie ma zasobu")
        name = p["file"] if options["original"] else os.path.join("variants", p["file"])
        path = os.path.join(demo.DEMO_DIR, name)
        if not os.path.exists(path):
            raise CommandError(f"Brak pliku wariantu: {path}")
        replace_main_file(resource, p["file"], demo.read_demo_file(name))
        self.stdout.write(self.style.SUCCESS(
            f"Podmieniono plik zasobu #{resource.pk} ({p['title']}) na {name} – pipeline portalu i moduł AED przetworzą go w tle."
        ))
