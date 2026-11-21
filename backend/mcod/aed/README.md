# Moduł „Ogólnopolski zbiór AED” (`mcod.aed`)

Zbiera zbiory AED publikowane przez instytucje (dostawców) w portalu, mapuje je na wzorcowy zakres danych,
waliduje, weryfikuje lokalizacje w usługach GUGiK i łączy w jeden zbiór ogólnopolski. Każdy wiersz agregatu
wskazuje dostawcę odpowiedzialnego za rekord.

**Zasady zgodności z portalem**
- Nie zmienia, kto publikuje dane. Zbiory źródłowe publikują wyłącznie redaktorzy i pełnomocnicy instytucji, tak jak dziś. Nie ma publicznego uploadu ani API zapisu.
- Dostawca oznacza swój zbiór flagą `Dataset.is_aed_dataset` („zbiór danych o defibrylatorach AED”).
- Agregat jest zwykłym zbiorem portalu, należącym do Ministerstwa Cyfryzacji. Ma zasoby CSV i GeoJSON o stałych ID, a do tego tabelę, mapę i API portalu.
- Aktualizacja zasobu dostawcy zmienia wyłącznie rekordy tej instytucji i tego zbioru. Rekordy usunięte z pliku są oznaczane jako wycofane, z zachowaniem historii.

**Przepływ:** pipeline zasobów portalu (`entrypoint_*`) → `hooks.on_resource_processed` → `tasks.aed_process_dataset_task` → `service.process_dataset`:
1. `readers`: CSV/XLSX/XLS/ODS/GeoJSON/JSON.
2. `mapping`: synonimy kolumn z `data/aed/aed_schema.json`.
3. `validation`: reguła „współrzędne LUB pełny adres”, zamiana lat/lon, typy.
4. `geocoding`: GUGiK UUG/ULDK, zgodność adresu ze współrzędnymi, gmina.
5. `sync`: tylko rekordy danego dostawcy.
6. `AedImportRun`: raport dla dostawcy.
7. `aggregate.rebuild`: publikacja agregatu.

## Wzorcowy zakres (wersja 1.1)
- **Obowiązkowe:** współrzędne (`szerokosc_geogr`, `dlugosc_geogr`) LUB pełny adres (`miejscowosc`, `ulica`, `nr_budynku`, `kod_pocztowy`).
- **Uzupełnianie brakującej części** przez geokodowanie GUGiK:
  - adres na współrzędne: UUG GetAddress,
  - współrzędne na adres: UUG GetAddressReverse.
- **Gdy podano oba**, moduł sprawdza ich zgodność. Powyżej 150 m dostawca dostaje ostrzeżenie, powyżej 5 km wiersz jest wstrzymany.
- **`teryt_terc` i `teryt_simc`** są zawsze wyliczane ze współrzędnych (ULDK i UUG). Wartość podana przez dostawcę jest nadpisywana z informacją w raporcie.
- **Pola podnoszące ocenę jakości:** `nazwa_obiektu`, `opis_lokalizacji`, `dostep`, `dysponent`, `data_weryfikacji`, `wewnatrz_budynku`.
- **Kolumna agregatu `instrukcja_dla_dyspozytora`** jest składana automatycznie z danych w wierszu.

## Komendy
```bash
python manage.py aed_schema_export        # data/aed/export: aed_wzorcowy_zakres.xlsx, aed_szablon.csv, aed_przyklad.csv, aed_schema.json
python manage.py aed_init_aggregate       # zbiór „Ogólnopolski zbiór AED” (MC) + zasoby CSV/GeoJSON
python manage.py aed_seed_demo            # 4 instytucje z prawdziwymi plikami AED z dane.gov.pl + konta <klucz>@mcod.local
python manage.py aed_demo_update krosno   # nowa wersja pliku Krosna (−1 wiersz, 1 zmieniony); --original przywraca
```
Konta demo: `krosno|przemysl|marki|legionowo@mcod.local`, hasło `Aed2026!demo`.

## API (tylko odczyt, `https://api.mcod.local/1.4`)
- `/aed/stats`: liczba AED, dostawców i gmin, % dostępnych całodobowo (szacunek: dostęp publiczny i na zewnątrz budynku), % z ograniczonym dostępem (z pola `sposob_dostepu` lub dostęp dla personelu), % zweryfikowanych ≤ 12 mies., średnia jakość.
- `/aed/records?bbox=&teryt=&dostawca=&status=&q=&page=&per_page=` i `/aed/records/{uid}` (z historią zmian).
- `/aed/records.geojson`, `/aed/providers`, `/aed/aggregate`.
- Filtr zbiorów: `/datasets?is_aed_dataset=true`.

## Uwagi do danych trafiają do dostawców
- Agregat łączy dane wielu instytucji, więc uwagi do danych nie trafiają do właściciela agregatu (MC).
- Frontend pokazuje sekcję **„Dane według dostawców”**: rozwijane grupy z przyciskiem „Zgłoś uwagi do dostawcy” w nagłówku każdej instytucji.
- Przycisk otwiera standardowy formularz portalu z adresem **zasobu źródłowego dostawcy** (`zasob_zrodlowy_id` z `/aed/providers`). Zgłoszenie (`ResourceComment` i powiadomienie e-mail) trafia do instytucji odpowiedzialnej za dane.
- `POST /resources/{id_agregatu}/comments` i `/datasets/{id_agregatu}/comments` zwracają 403 z prośbą o zgłoszenie uwagi do dostawcy (`mcod/aed/comments.py`).

## Panel dostawcy
- Zakładka **„Raport AED”** w formularzu zbioru.
- Menu **„Ogólnopolski zbiór AED”**:
  - raporty: mapowanie kolumn, problemy w wierszach, CSV, „Przetwórz ponownie”,
  - urządzenia w agregacie.
- Widok jest zawężony do instytucji użytkownika i dostępny tylko do odczytu.

## Testy
```bash
# jednostkowe (bez surowych migracji SQL portalu)
docker compose -f docker-compose.local.yml -f docker-compose.override.yml --profile tests run --rm --no-deps \
  --entrypoint pytest mcod-local-tests mcod/aed -n0 --nomigrations
# smoke end-to-end (curl + jq) – tylko elementy modułu AED
scripts/aed_smoke.sh
```

## Ustawienia
| Ustawienie | Opis |
|---|---|
| `AED_AGGREGATE_OWNER_ORGANIZATION_PK` | Właściciel agregatu. Domyślnie tworzona i używana jest instytucja „Ministerstwo Cyfryzacji”. |
| `AED_GEOCODER_ENABLED` | Włącza geokodowanie w GUGiK. |
| `AED_ADDRESS_MISMATCH_M` | Próg ostrzeżenia o rozbieżności adresu i współrzędnych (domyślnie 150 m). |
| `AED_ADDRESS_CRITICAL_M` | Próg wstrzymania wiersza (domyślnie 5000 m). |
