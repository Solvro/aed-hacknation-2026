from django.apps import AppConfig


class AedConfig(AppConfig):
    name = "mcod.aed"
    verbose_name = "Ogólnopolski zbiór AED"

    def ready(self):
        from mcod.aed import signals  # noqa: F401
