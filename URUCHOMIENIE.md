# Uruchomienie projektu lokalnie

Ta instrukcja stawia lokalną kopię portalu dane.gov.pl z modułem „Ogólnopolski zbiór AED”. Opis projektu i spełnienie wymagań są w [README.md](README.md).

## 1. Wymagania
- macOS lub Linux, **Docker Desktop** z co najmniej 8 GB RAM dla Dockera,
- **Node.js 18 lub nowszy** i npm (frontend),
- `curl` i `jq` (test smoke),
- około 20 GB wolnego miejsca.

Na Macach z Apple Silicon pierwsza budowa obrazu aplikacji trwa około 15 minut, bo Python dla amd64 działa w emulacji.

## 2. Konfiguracja (jednorazowo)
```bash
cd backend
cp env.sample .env
cp mcod/settings/local.py.sample mcod/settings/local.py
cp docker-compose.override.yml.example docker-compose.override.yml   # szybkie mirrory, host.docker.internal
```
W pliku `.env` ustaw `DISCOURSE_FORUM_ENABLED=false`, bo forum nie jest potrzebne.

Dopisz lokalne domeny do `/etc/hosts`:
```bash
echo "127.0.0.1 mcod.local api.mcod.local admin.mcod.local cms.mcod.local mail.mcod.local" | sudo tee -a /etc/hosts
```

## 3. Backend (Docker)
Wszystkie polecenia wykonuj w katalogu `backend/`.
```bash
C="docker compose -f docker-compose.local.yml -f docker-compose.override.yml"

# budowa obrazów
$C build mcod-db mcod-redis mcod-rabbitmq mcod-elasticsearch mcod-rdfdb mcod-nginx mcod-local-admin

# usługi bazowe i inicjalizacja bazy portalu
$C up -d mcod-db mcod-redis mcod-rabbitmq mcod-elasticsearch mcod-rdfdb mcod-smtp
$C run --rm --no-deps mcod-local-admin python manage.py init_mcod_db

# aplikacje portalu (celery jest konieczna: bez niej zasoby nie są przetwarzane)
$C up -d mcod-local-admin mcod-local-api mcod-local-cms mcod-local-celery mcod-nginx
docker exec mcod-admin python manage.py search_index --rebuild -f
```

### Moduł AED: agregat, dane demo i wzorcowy zakres
```bash
docker exec mcod-admin python manage.py aed_init_aggregate   # zbiór „Ogólnopolski zbiór AED” (Ministerstwo Cyfryzacji)
docker exec mcod-admin python manage.py aed_seed_demo        # 4 instytucje z prawdziwymi plikami z dane.gov.pl + konta
docker exec mcod-admin python manage.py aed_schema_export    # data/aed/export: xlsx, szablon CSV, przykład CSV, schemat JSON
```
Po `aed_seed_demo` celery przetwarza zasoby w tle. Zwykle trwa to 1–2 minuty, bo usługi GUGiK weryfikują adresy. Postęp widać w panelu w menu „Ogólnopolski zbiór AED” → „Raporty AED” albo pod adresem `https://api.mcod.local/1.4/aed/stats`.

Piąty dostawca (dane InPost) jest opcjonalny. Aby go dodać, w panelu utwórz zbiór z flagą „Zbiór danych o defibrylatorach AED” i dodaj zasób z pliku `backend/data/aed/demo/inpost_wzorcowy_zakres.csv`.

## 4. Frontend (Angular)
```bash
cd frontend
npm ci
npx ng serve --configuration local --port 4200   # http://localhost:4200
```
Konfiguracja `local` kieruje zapytania do lokalnego API (`proxy.local.conf.json`, cel `https://api.mcod.local`).

## 5. Adresy i konta
| Adres | Co tam jest |
|---|---|
| http://localhost:4200/pl | portal (frontend) |
| http://localhost:4200/pl/dataset?q=defibrylatory | zbiory AED dostawców i agregat |
| https://admin.mcod.local | panel dostawcy: zakładka „Raport AED” w zbiorze, menu „Ogólnopolski zbiór AED” |
| https://admin.mcod.local/aed/aedimportrun/precheck/ | sprawdzenie pliku przed publikacją |
| https://api.mcod.local/1.4/aed/stats | API modułu (`/aed/records`, `/aed/records.geojson`, `/aed/providers`, `/aed/aggregate`) |

Lokalne domeny mają certyfikat self-signed, więc przy pierwszym wejściu przeglądarka poprosi o akceptację wyjątku.

| Konto | Hasło | Rola |
|---|---|---|
| `admin@mcod.local` | `testadmin123!` | administrator |
| `krosno@mcod.local`, `przemysl@mcod.local`, `marki@mcod.local`, `legionowo@mcod.local` | `Aed2026!demo` | pełnomocnicy instytucji (dostawcy) |

## 6. Scenariusz demo
1. **Agregat.** We frontendzie otwórz „Ogólnopolski zbiór AED”. W sekcji „Dane według dostawców” rozwiń instytucję i kliknij „Zgłoś uwagi do dostawcy”. Formularz ma adres zasobu tej instytucji, a nie agregatu.
2. **Sprawdzenie pliku.** Zaloguj się jako `krosno@mcod.local`, otwórz „Sprawdź plik przed publikacją” i wgraj `backend/data/aed/demo/variants/krosno_nowa_wersja_z_bledami.csv`. Zobaczysz status, problemy z numerami wierszy i poprawki automatyczne.
3. **Aktualizacja tylko wierszy jednego dostawcy:**
   ```bash
   docker exec mcod-admin python manage.py aed_demo_update krosno             # nowa wersja: −1 wiersz, 1 zmieniony
   docker exec mcod-admin python manage.py aed_demo_update krosno --original  # przywrócenie
   ```
   Następnie w panelu otwórz zbiór Krosna → zakładka „Raport AED”. Lista zmian pokazuje wiersz zmieniony i wycofany. Liczniki innych dostawców zostają bez zmian.

## 7. Testy
```bash
cd backend
# testy jednostkowe modułu
docker compose -f docker-compose.local.yml -f docker-compose.override.yml --profile tests run --rm --no-deps \
  --entrypoint pytest mcod-local-tests mcod/aed -n0 --nomigrations

# test end-to-end (curl + jq) na działającym środowisku po aed_seed_demo
./scripts/aed_smoke.sh
```
Test smoke sprawdza tylko elementy modułu AED:
- flagę zbioru,
- endpointy `/aed/*` i agregat,
- synchronizację jednego dostawcy,
- brak publicznego zapisu,
- izolację raportów między instytucjami.

## 8. Typowe problemy
| Objaw | Rozwiązanie |
|---|---|
| Zasoby nie są przetwarzane, raporty AED są puste | Sprawdź, czy działa `mcod-local-celery` (`docker ps`). Jeśli nie, uruchom go i ponów `aed_seed_demo` lub kliknij „Przetwórz ponownie” w raporcie. |
| Błąd 500 przy logowaniu do panelu | Upewnij się, że używasz kodu z tego repozytorium (poprawka `LoggingMethod.FORM`). |
| Frontend długo ładuje stronę bez sieci | Frontend pobiera flagi funkcji z `dane.gov.pl/flags`. Bez internetu zapytanie czeka na timeout. Włącz sieć albo poczekaj na zakończenie zapytania. |
| Mapa bez kafelków | Kafelki OSM wymagają dostępu do internetu. |
| Adresy nie są weryfikowane | Usługi GUGiK wymagają internetu. Można je wyłączyć ustawieniem `AED_GEOCODER_ENABLED=false` w `.env`, a wiersze dostaną wtedy ostrzeżenie. |
