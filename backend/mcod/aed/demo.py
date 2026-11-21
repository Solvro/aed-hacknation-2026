"""Pomocnicze funkcje tworzenia obiektów portalu (instytucje, konta, zbiory, zasoby) – dla komend
`aed_init_aggregate`, `aed_seed_demo`, `aed_demo_update`. Używają wyłącznie standardowych modeli portalu,
tak jak zrobiłby to redaktor instytucji w panelu."""
import os

from django.apps import apps
from django.conf import settings
from django.core.files.base import ContentFile
from django.utils import timezone
from django.utils.text import slugify

DEMO_DIR = os.path.join(str(settings.DATA_DIR), "aed", "demo")
DEMO_PASSWORD = "Aed2026!demo"

PROVIDERS = [
    {
        "key": "krosno",
        "title": "Urząd Miasta Krosna",
        "city": "Krosno",
        "postal_code": "38-400",
        "dataset": "Defibrylatory zlokalizowane w Mieście Krosno",
        "file": "krosno.csv",
        "format": "csv",
        "license": "CC0",
        "source": "https://dane.gov.pl/pl/dataset/3624",
    },
    {
        "key": "przemysl",
        "title": "Urząd Miejski w Przemyślu",
        "city": "Przemyśl",
        "postal_code": "37-700",
        "dataset": "Lokalizacje AED – Automatycznych Defibrylatorów Zewnętrznych w Przemyślu",
        "file": "przemysl.geojson",
        "format": "geojson",
        "license": "CC0",
        "source": "https://dane.gov.pl/pl/dataset/4581",
    },
    {
        "key": "marki",
        "title": "Urząd Miasta Marki",
        "city": "Marki",
        "postal_code": "05-270",
        "dataset": "Defibrylatory zlokalizowane na terenie Miasta Marki",
        "file": "marki.csv",
        "format": "csv",
        "license": "CC BY",
        "source": "https://dane.gov.pl/pl/dataset/4955",
    },
    {
        "key": "legionowo",
        "title": "Urząd Miasta Legionowo",
        "city": "Legionowo",
        "postal_code": "05-120",
        "dataset": "Wykaz defibrylatorów AED wraz z ich lokalizacją w Legionowie",
        "file": "legionowo.csv",
        "format": "csv",
        "license": "CC0",
        "source": "https://dane.gov.pl/pl/dataset/40593",
    },
]


def admin_user():
    User = apps.get_model("users", "User")
    return User.objects.filter(is_superuser=True).order_by("id").first()


def get_or_create_org(title, institution_type="local", city="", postal_code="", slug=None, created_by=None):
    Organization = apps.get_model("organizations", "Organization")
    slug = slug or slugify(title)
    org = Organization.raw.filter(slug=slug).first() if hasattr(Organization, "raw") else None
    org = org or Organization.objects.filter(slug=slug).first()
    if org:
        return org, False
    org = Organization.objects.create(
        title=title,
        slug=slug,
        institution_type=institution_type,
        status="published",
        city=city,
        postal_code=postal_code,
        street_type="ul.",
        street="—",
        street_number="1",
        email=f"kontakt@{slug}.example.gov.pl",
        tel="0048123456789",
        website=f"https://{slug}.example.gov.pl",
        description=f"<p>{title} – instytucja demonstracyjna modułu AED.</p>",
        created_by=created_by,
        modified_by=created_by,
    )
    return org, True


def get_or_create_agent(email, organization, fullname):
    User = apps.get_model("users", "User")
    user = User.objects.filter(email=email).first()
    if user is None:
        user = User.objects.create_user(email, DEMO_PASSWORD, fullname=fullname)
    user.fullname = fullname
    user.phone = "0048123456789"
    user.is_staff = True
    user.is_agent = True
    user.is_official = True
    user.state = "active"
    user.is_active = True
    user.agent_organization_main = organization
    user.save()
    user.organizations.add(organization)
    user.agent_organizations.add(organization)
    return user


def category(code):
    Category = apps.get_model("categories", "Category")
    return Category.objects.filter(code=code).order_by("id").first()


def tag(name, user=None):
    Tag = apps.get_model("tags", "Tag")
    obj = Tag.objects.filter(name=name, language="pl").first()
    return obj or Tag.objects.create(name=name, language="pl", created_by=user, modified_by=user)


def get_or_create_dataset(organization, title, notes, user, cc_by=False, is_aed=False, frequency="irregular", tags=()):
    Dataset = apps.get_model("datasets", "Dataset")
    slug = slugify(title)[:100]
    ds = Dataset.raw.filter(slug=slug, organization=organization).first()
    if ds:
        return ds, False
    ds = Dataset.objects.create(
        title=title,
        slug=slug,
        notes=notes,
        organization=organization,
        status="published",
        update_frequency=frequency,
        license_condition_default_cc40=bool(cc_by),
        is_aed_dataset=is_aed,
        has_dynamic_data=False,
        has_high_value_data=False,
        has_high_value_data_from_ec_list=False,
        has_research_data=False,
        update_notification_recipient_email=getattr(user, "email", "") or "",
        created_by=user,
        modified_by=user,
    )
    heal = category("HEAL")
    if heal:
        ds.categories.add(heal)
    for name in tags:
        ds.tags.add(tag(name, user))
    return ds, True


def create_file_resource(dataset, title, description, filename, content: bytes, fmt, user):
    """Zasób plikowy – jak upload w panelu: Resource + ResourceFile(is_main) => pipeline portalu (celery)."""
    Resource = apps.get_model("resources", "Resource")
    ResourceFile = apps.get_model("resources", "ResourceFile")
    resource = Resource.objects.create(
        dataset=dataset,
        title=title,
        description=description,
        type="file",
        format=fmt,
        status="published",
        data_date=timezone.localdate(),
        has_dynamic_data=False,
        has_high_value_data=False,
        has_high_value_data_from_ec_list=False,
        has_research_data=False,
        created_by=user,
        modified_by=user,
    )
    rf = ResourceFile(resource=resource, is_main=True)
    rf.file.save(filename, ContentFile(content), save=True)
    return resource


def read_demo_file(name) -> bytes:
    with open(os.path.join(DEMO_DIR, name), "rb") as f:
        return f.read()
