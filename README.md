# Misja AED – Ogólnopolski zbiór AED w portalu dane.gov.pl (HackNation 2026)

Fork otwartego kodu portalu **dane.gov.pl** (backend `mcod` 2.62.3 i frontend 3.5.2) z nowym modułem
**„Ogólnopolski zbiór AED”**. Moduł zbiera zbiory o defibrylatorach AED publikowane przez różnych dostawców
(gminy, powiaty, firmy) i łączy je w jeden ogólnopolski zbiór. Każdy rekord wskazuje instytucję, która za
niego odpowiada.

> Poprzednia wersja projektu (aplikacja Next.js: mapa AED, trener, scrapery, logo „Minuta Życia”) jest na
> gałęzi [`legacy-nextjs`](../../tree/legacy-nextjs).

## Jak to działa (zgodnie z zasadami portalu)
- **Publikują tylko dostawcy.** Zbiory źródłowe publikują redaktorzy i pełnomocnicy instytucji w panelu dostawcy, tak jak dziś. Nie ma publicznego uploadu.
- **Dostawca oznacza swój zbiór flagą** „zbiór danych o defibrylatorach AED”.
- **Moduł przetwarza każdą nową wersję zasobu:**
  - przyjmuje pliki CSV, XLSX, XLS, ODS, GeoJSON i JSON, a także zasób typu API,
  - mapuje kolumny na wzorcowy zakres danych,
  - waliduje dane, w tym regułę „współrzędne LUB pełny adres”,
  - weryfikuje lokalizacje w usługach GUGiK (UUG, ULDK).
- **Dostawca dostaje raport jakości** w panelu.
- **Aktualizacja zmienia tylko wiersze danego dostawcy.** Rekordy znikające z jego pliku są wycofywane z zachowaniem historii.
- **Agregat to zwykły zbiór portalu** należący do Ministerstwa Cyfryzacji:
  - zasoby CSV i GeoJSON o stałych ID,
  - tabela, mapa i API portalu,
  - kolumny `dostawca`, `zbior_zrodlowy` i `data_aktualizacji` w każdym wierszu.
- **Uwagi do danych trafiają do dostawców.** Na stronie agregatu jest sekcja „Dane według dostawców” z przyciskiem „Zgłoś uwagi do dostawcy”.

## Struktura
| Katalog | Zawartość |
|---|---|
| `backend/` | Django (Python 3.8) z modułem `mcod/aed/` ([README modułu](backend/mcod/aed/README.md)) |
| `backend/data/aed/aed_schema.json` | maszynowa definicja wzorcowego zakresu danych AED |
| `backend/data/aed/export/` | wzorcowy zakres: `aed_wzorcowy_zakres.xlsx`, szablon i przykład CSV |
| `backend/data/aed/demo/` | prawdziwe zbiory AED z dane.gov.pl (Krosno, Przemyśl, Marki, Legionowo) i dane InPost |
| `backend/scripts/aed_smoke.sh` | test end-to-end modułu (curl + jq) |
| `frontend/` | Angular 18: tabela „Dane według dostawców”, poprawki mapy |

## Uruchomienie lokalne (macOS, Docker Desktop)
```bash
cd backend
cp env.sample .env                        # ustaw DISCOURSE_FORUM_ENABLED=false
cp mcod/settings/local.py.sample mcod/settings/local.py
cp docker-compose.override.yml.example docker-compose.override.yml   # szybkie mirrory, host.docker.internal
echo "127.0.0.1 mcod.local api.mcod.local admin.mcod.local cms.mcod.local mail.mcod.local" | sudo tee -a /etc/hosts

C="docker compose -f docker-compose.local.yml -f docker-compose.override.yml"
$C build mcod-db mcod-redis mcod-rabbitmq mcod-elasticsearch mcod-rdfdb mcod-nginx mcod-local-admin
$C up -d mcod-db mcod-redis mcod-rabbitmq mcod-elasticsearch mcod-rdfdb mcod-smtp
$C run --rm --no-deps mcod-local-admin python manage.py init_mcod_db
$C up -d mcod-local-admin mcod-local-api mcod-local-cms mcod-local-celery mcod-nginx
docker exec mcod-admin python manage.py search_index --rebuild -f
docker exec mcod-admin python manage.py aed_init_aggregate     # agregat (Ministerstwo Cyfryzacji)
docker exec mcod-admin python manage.py aed_seed_demo          # 4 dostawców z prawdziwymi danymi
docker exec mcod-admin python manage.py aed_schema_export      # pliki wzorcowego zakresu

cd ../frontend && npm ci && npx ng serve --configuration local   # http://localhost:4200
```
Na Macu z Apple Silicon budowa obrazu aplikacji trwa około 15 minut (Python dla amd64 w emulacji).

## Adresy i konta demo
| Adres | Co |
|---|---|
| https://admin.mcod.local | panel dostawcy (zakładka „Raport AED”, menu „Ogólnopolski zbiór AED”) |
| https://api.mcod.local/1.4/aed/stats | API: `/aed/stats`, `/aed/records`, `/aed/records.geojson`, `/aed/providers`, `/aed/aggregate` |
| http://localhost:4200/pl/dataset/{id agregatu} | agregat we frontendzie portalu |

Konta:
- `admin@mcod.local` / `testadmin123!` (administrator),
- `krosno|przemysl|marki|legionowo@mcod.local` / `Aed2026!demo` (pełnomocnicy instytucji).

## Testy
```bash
cd backend
docker compose -f docker-compose.local.yml -f docker-compose.override.yml --profile tests run --rm --no-deps \
  --entrypoint pytest mcod-local-tests mcod/aed -n0 --nomigrations      # testy jednostkowe modułu
./scripts/aed_smoke.sh                                                   # test end-to-end (34 sprawdzenia)
```

## Pochodzenie kodu
Kod bazowy pochodzi z otwartego repozytorium portalu dane.gov.pl (https://dane.gov.pl/source-code/,
mirror `olekstomek/mcod-backend-dane.gov.pl` i `olekstomek/mcod-frontend-dane.gov.pl`). Zmiany zespołu to:
- moduł `backend/mcod/aed/` i podpięcia w backendzie (flaga zbioru, hook w pipeline zasobów, ustawienia),
- komponent tabeli dostawców we frontendzie,
- poprawki błędów portalu wykrytych podczas pracy:
  - tłumaczona wartość `LoggingMethod.FORM` (błąd 500 przy logowaniu),
  - ładowanie Leafleta w dev-serverze,
  - kafelki OSM przez HTTPS.
