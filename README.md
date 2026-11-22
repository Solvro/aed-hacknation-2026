# Ogólnopolski zbiór AED w portalu dane.gov.pl

**HackNation 2026 · Misja AED „Dane na ratunek”**

Dane o defibrylatorach AED są rozproszone, niepełne i często niezweryfikowane. Gminy, szkoły, straż, szpitale i firmy publikują je osobno, każdy w innym formacie i z innymi kolumnami. Nie wiadomo też, kto odpowiada za konkretne urządzenie.

Na bazie otwartego kodu portalu **dane.gov.pl** stworzyliśmy:
1. **Moduł „Ogólnopolski zbiór AED”** w portalu. Łączy zbiory AED publikowane przez instytucje w jeden ogólnopolski zbiór. Każdy wiersz wskazuje dostawcę, który za niego odpowiada.
2. **Wzorcowy zbiór danych o AED**, czyli jeden wzór dla wszystkich dysponentów danych (XLSX, szablon CSV, schemat JSON).
3. **Kampanię „Zdefibryluj Dane”** z hasłem *„Daj impuls. Udostępnij dane o AED.”*, logo i księgą znaku. Kampania zachęca dysponentów do udostępniania danych.

Instrukcja uruchomienia jest w pliku **[URUCHOMIENIE.md](URUCHOMIENIE.md)**.

---

## Spełnienie wymagań zadania

### Wyzwanie
| Wymaganie z treści zadania | Jak je realizujemy |
|---|---|
| Zebranie w dane.gov.pl danych z wielu rozproszonych źródeł | Moduł przetwarza każdy zbiór oznaczony przez dostawcę flagą „zbiór danych o defibrylatorach AED”. Obsługuje pliki CSV, XLSX, XLS, ODS, GeoJSON, JSON oraz zasób typu API. Kolumny o różnych nazwach są rozpoznawane przez słownik synonimów. |
| Integracja informacji od wszystkich dysponentów w jednym zbiorze | Agregat to zwykły zbiór portalu z zasobami CSV i GeoJSON o stałych ID. Ma tabelę, mapę i API portalu. Demo łączy prawdziwe zbiory z dane.gov.pl (Krosno, Przemyśl, Marki, Legionowo) oraz dane InPost. |
| Wskazanie referencyjnego zakresu danych | Każdy plik jest mapowany na wzorcowy zakres i walidowany. Dostawca dostaje raport: rozpoznane kolumny, problemy z numerami wierszy i instrukcję poprawy. |
| Wzorcowy zakres danych, żeby wszyscy udostępniali dane jednolicie | `wzorcowy-zakres-danych/aed_wzorcowy_zakres_danych.xlsx` (opis 24 pól z typem, przykładem i obowiązkowością oraz 1006 prawdziwych AED zapisanych według wzorca), do tego szablon i przykład CSV oraz `aed_schema.json` (Frictionless Table Schema). Szczegóły są niżej, w części „Wzorcowy zbiór danych”. |
| Nazwa akcji, logotyp, księga znaku (kolorystyka, pole ochronne, minimalna wielkość, niedozwolone użycia, opis koncepcji w 3–5 zdaniach) | Akcja „Zdefibryluj Dane”. Pliki są w `akcja-promocyjna/`. Szczegóły są niżej, w części „Kampania”. |

### Wymagania formalne
| Element | Gdzie jest |
|---|---|
| Szczegółowy opis i tytuł projektu | ten plik, opis modułu w [`backend/mcod/aed/README.md`](backend/mcod/aed/README.md) |
| Prezentacja (min. 5 slajdów ze zrzutami ekranu, opis funkcji i kroków użytkownika, ograniczenia) | `prezentacja/prezentacja-ogolnopolski-zbior-aed.pdf` |
| Prototyp rozwiązania | fork portalu: `backend/` (Django) i `frontend/` (Angular), uruchomienie opisuje [URUCHOMIENIE.md](URUCHOMIENIE.md) |
| Plik z wzorcowym zakresem danych (xlsx) | **[`wzorcowy-zakres-danych/aed_wzorcowy_zakres_danych.xlsx`](wzorcowy-zakres-danych/aed_wzorcowy_zakres_danych.xlsx)** |
| Kod źródłowy | to repozytorium |
| Logotyp w .jpg, .png, .pdf i formacie otwartym | [`akcja-promocyjna/logo/`](akcja-promocyjna/logo/): `.jpg`, `.png`, `.pdf` oraz `.svg` (format otwarty) |
| Księga znaku | [`akcja-promocyjna/ksiega-znaku/ksiega-znaku-zdefibryluj-dane.pdf`](akcja-promocyjna/ksiega-znaku/ksiega-znaku-zdefibryluj-dane.pdf) (PDF) |

### Wymagania techniczne
| Wymaganie | Jak je realizujemy |
|---|---|
| Format odczytywalny maszynowo | Agregat jest publikowany jako CSV (UTF-8) i GeoJSON, a do tego jest dostępny przez API JSON. Wzorcowy zakres ma postać XLSX, CSV i JSON Schema. Żadne dane nie są udostępniane w PDF ani DOC. |
| Zgodność z zasadami działania dane.gov.pl | Opisana niżej, w części „Zgodność z zasadami portalu”. |
| WCAG i responsywność | Nowe elementy frontendu używają komponentów i stylów portalu. Rozwijane grupy dostawców to przyciski z `aria-expanded` i `aria-controls`, a komunikaty mają `role="status"` lub `role="alert"`. Kolory kampanii mają sprawdzony kontrast WCAG 2.2 AA (opis jest w księdze znaku). |
| Wykorzystanie AI | Przy pracy korzystaliśmy z narzędzi AI. Wybór rozwiązań, poprawki i ostateczna wersja są decyzjami zespołu. |

---

## Część 1. Rozwiązanie w portalu

### Zgodność z zasadami portalu
Ta część to 30% oceny, dlatego moduł nie zmienia zasad działania portalu:
- **Publikują tylko instytucje, tak jak dziś.** Zbiory źródłowe dodają redaktorzy i pełnomocnicy instytucji w panelu dostawcy. Nie ma publicznego uploadu ani API zapisu.
- **Zbiór źródłowy zostaje własnością instytucji**, która go dodała. Dostawca włącza go do agregatu jedną flagą.
- **Agregat to zwykły zbiór portalu, którego właścicielem jest Ministerstwo Cyfryzacji.** Tak samo działa w portalu agregat danych DGA. Ministerstwo odpowiada za agregat, a dostawca za swoje wiersze (kolumny `dostawca`, `zbior_zrodlowy`, `data_aktualizacji`).
- **Licencje.** Do agregatu trafiają tylko źródła na licencjach z rodziny CC0 i CC BY, takich jak w portalu.
- **Uwagi do danych trafiają do dostawcy, a nie do właściciela agregatu.** Zgłoszenie korzysta ze standardowego formularza portalu, ale z adresem zasobu źródłowego tej instytucji.

### Funkcje
| Funkcja | Opis |
|---|---|
| Flaga „zbiór danych o AED” | Nowe pole zbioru `is_aed_dataset` w formularzu panelu, API i wyszukiwarce. |
| Automatyczne przetwarzanie | Hook w potoku zasobów portalu. Każda nowa wersja zasobu AED przechodzi kolejno: odczyt → mapowanie kolumn → walidację → weryfikację w GUGiK → synchronizację → raport. |
| Walidacja | **Blokuje wiersz:** brak lokalizacji, punkt poza Polską, powtórzony `id_aed`, adres niezgodny ze współrzędnymi o ponad 5 km. **Ostrzega:** rozbieżność ponad 150 m, brak stałego `id_aed`, weryfikacja starsza niż 12 miesięcy, przeterminowane elektrody. |
| Uzupełnianie automatyczne | Mechanizm zamienia odwrócone szerokość i długość geograficzną. Wylicza współrzędne z adresu i adres ze współrzędnych (GUGiK UUG). Kod TERYT gminy wylicza z ULDK. |
| Sprawdzenie pliku przed publikacją | W panelu, w menu „Ogólnopolski zbiór AED”, jest pozycja „Sprawdź plik przed publikacją”. Pokazuje jasny status, numery wierszy, instrukcję „jak poprawić” i plik z poprawkami do pobrania. Nic nie jest przy tym publikowane. |
| Raport AED dla dostawcy | Zakładka w formularzu zbioru pokazuje, co zmieniła ostatnia wersja (dodane, zmienione i wycofane wiersze), problemy w wierszach, raport CSV i przycisk „Przetwórz ponownie”. |
| Aktualizacja tylko swoich wierszy | Nowa wersja pliku zmienia wyłącznie rekordy tej instytucji. Urządzenie usunięte z pliku znika z mapy, ale zostaje w historii zmian. |
| Agregat w portalu | Na stronie zbioru jest sekcja „Dane według dostawców”: rozwijane grupy instytucji z przyciskiem „Zgłoś uwagi do dostawcy”. Agregat ma też tabelę, mapę, pliki CSV i GeoJSON oraz API. |
| API tylko do odczytu | `/1.4/aed/stats`, `/aed/records` (filtry bbox, TERYT, dostawca, status), `/aed/records/{uid}` z historią zmian, `/aed/records.geojson`, `/aed/providers`, `/aed/aggregate`. |

### Kroki użytkownika
**Dostawca danych** (pełnomocnik lub redaktor instytucji):
1. Loguje się do panelu dostawcy dane.gov.pl.
2. Opcjonalnie sprawdza plik w „Sprawdź plik przed publikacją” i poprawia wskazane wiersze.
3. W swoim zbiorze zaznacza „Zbiór danych o defibrylatorach AED” i dodaje zasób (plik albo link).
4. Po przetworzeniu ogląda w zakładce „Raport AED”, ile wierszy trafiło do agregatu i co poprawić.
5. Przy aktualizacji dodaje nową wersję pliku. Zmieniają się tylko jego wiersze.

**Odbiorca danych** (służby ratunkowe, twórcy aplikacji, obywatele):
1. Otwiera zbiór „Ogólnopolski zbiór AED” w portalu: tabelę, mapę albo pliki do pobrania.
2. Przy każdym urządzeniu widzi dostawcę i datę aktualizacji.
3. Błąd zgłasza przyciskiem „Zgłoś uwagi do dostawcy”. Uwaga trafia do instytucji odpowiedzialnej za dane.
4. Aplikacje pobierają dane przez API portalu albo pliki CSV i GeoJSON.

---

## Część 2. Wzorcowy zbiór danych
Plik: **[`wzorcowy-zakres-danych/aed_wzorcowy_zakres_danych.xlsx`](wzorcowy-zakres-danych/aed_wzorcowy_zakres_danych.xlsx)**. Ma 24 pola w wersji 1.1, a źródłem jest [`backend/data/aed/aed_schema.json`](backend/data/aed/aed_schema.json). Arkusze:
- **Przykładowe dane:** 1006 prawdziwych AED w kolumnach wzorca. Pochodzą z 16 publicznych wykazów: zbiory gmin w dane.gov.pl, strony i mapy urzędów miast (m.in. Kraków, Łódź, Gdańsk, Gliwice, Lublin, Toruń), InPost i Uniwersytet Śląski. Nie ma tu danych z OpenStreetMap ani OpenAEDMap. Te same dane, z kolumną źródła przy każdym wierszu, są w pliku [`aed_dane_przykladowe.csv`](wzorcowy-zakres-danych/aed_dane_przykladowe.csv).
- **Zakres danych:** opis każdego z 24 pól (typ, format, przykład, obowiązkowość, rozpoznawane nazwy kolumn).

Pierwszą wersję arkusza wygenerował skrypt `wzorcowy-zakres-danych/generuj_arkusz.py`. Dane przykładowe przygotowuje skrypt `przygotuj_dane_przykladowe.py`.

| Grupa | Pola | Status |
|---|---|---|
| Lokalizacja | `szerokosc_geogr`, `dlugosc_geogr` **LUB** `miejscowosc`, `ulica`, `nr_budynku`, `kod_pocztowy` | **wymagane** (jedno z dwóch, drugie portal uzupełnia sam) |
| Identyfikacja, miejsce i dostępność | `id_aed` (zalecane), `nazwa_obiektu`, `opis_lokalizacji`, `dostep`, `sposob_dostepu`, `wewnatrz_budynku`, `pietro`, `dysponent`, `data_weryfikacji`, `telefon_kontaktowy`, `zdjecie_url` | opcjonalne |
| Urządzenie | `producent`, `model`, `data_przegladu`, `waznosc_elektrod`, `waznosc_baterii` | opcjonalne |
| Wyliczane | `teryt_terc`, `teryt_simc` | wylicza portal |

**Dlaczego tak.** Idealnie byłoby mieć wszystkie pola. Najważniejsze są jednak podstawowe, więc wymagana jest tylko lokalizacja. Pozostałe pola są opcjonalne, żeby nie ograniczać importu i nie zniechęcać instytucji, które mają tylko część danych. Kolumny o urządzeniu (przegląd, elektrody, bateria) byłyby bardzo przydatne, bo pokazują, czy defibrylator działa. Wypełnią je jednak raczej dopiero sprzedawcy i serwisanci AED, gdy zaczną udostępniać dane w dane.gov.pl.

Uzupełnieniem jest szablon [`aed_szablon.csv`](backend/data/aed/export/aed_szablon.csv) oraz przykład [`aed_przyklad.csv`](backend/data/aed/export/aed_przyklad.csv). Pliki generuje komenda `python manage.py aed_schema_export`.

---

## Część 3. Kampania „Zdefibryluj Dane”
**Hasło:** *Daj impuls. Udostępnij dane o AED.*

**Koncepcja.** Znak pokazuje Polskę złożoną z punktów. Każdy punkt to dostawca danych: gmina, szkoła, straż albo firma. Linie z każdego punktu prowadzą do jednego serca ze znakiem AED. Wspólne dane z całego kraju pobudzają w ten sposób serce Polski. Nazwa prosi dysponentów, żeby przywrócili dane do życia i opublikowali je w portalu, a hasło mówi wprost, do czego ich zachęcamy.

**Księga znaku** (`akcja-promocyjna/ksiega-znaku/`) zawiera:
- **Kolorystykę:** czerwień akcji `#E0144A` i czerwień ciemną `#BE113F` (serce, pośpiech), cztery zielenie od `#70967D` do `#EDF5EF` (kolor oznaczenia AED, tło), tło `#F8FBF9` i grafit `#1A1D1B`. Podane są wartości HEX, RGB i CMYK oraz kontrast WCAG 2.2.
- **Typografię:** Inter (ExtraBold, SemiBold, Bold) na otwartej licencji, z pełnymi polskimi znakami.
- **Pole ochronne:** ½x z każdej strony, gdzie x to wysokość serca AED.
- **Minimalną wielkość:** logo poziome 210 px lub 45 mm, sam znak 40 px lub 12 mm, sygnet 16 px lub 5 mm.
- **Niedozwolone użycia:** zmiana kolorów, rozciąganie, obracanie, cienie, niespokojne tło, zmiana układu, logo na ciemnym lub czerwonym tle.
- **Wersje znaku:** logo poziome, sam znak i sygnet.

Logo jest w [`akcja-promocyjna/logo/`](akcja-promocyjna/logo/) w formatach SVG, PNG (przezroczyste tło), JPG i PDF.

---

## Struktura repozytorium
| Katalog | Zawartość |
|---|---|
| `backend/` | fork backendu dane.gov.pl (`mcod`, Django, Python 3.8) z modułem [`mcod/aed/`](backend/mcod/aed/README.md) |
| `backend/data/aed/` | schemat wzorcowego zakresu, pliki eksportu i dane demo (prawdziwe zbiory z dane.gov.pl) |
| `backend/scripts/aed_smoke.sh` | test end-to-end modułu (curl i jq) |
| `frontend/` | fork frontendu dane.gov.pl (Angular 18) z sekcją „Dane według dostawców” |
| `wzorcowy-zakres-danych/` | arkusz Excel z wzorcowym zakresem danych i skrypt, który go generuje |
| `akcja-promocyjna/` | logo i księga znaku kampanii |
| `prezentacja/` | prezentacja projektu (PDF) |

## Ograniczenia
- Prototyp działa lokalnie, na kopii portalu w Dockerze, a nie na produkcyjnym dane.gov.pl. Wdrożenie wymaga decyzji operatora portalu, w tym wyznaczenia właściciela agregatu.
- Weryfikacja adresów korzysta z publicznych usług GUGiK (UUG, ULDK). Gdy usługa nie odpowiada, wiersz przechodzi z ostrzeżeniem „nie zweryfikowano adresu”. Sprawdzenie pliku przed publikacją geokoduje najwyżej 500 wierszy.
- Do agregatu nie mogą trafić dane z OpenStreetMap (licencja ODbL nie należy do licencji portalu). Dlatego agregat obejmuje tylko zbiory opublikowane przez instytucje.
- Pola o stanie urządzenia będą puste, dopóki dane nie zaczną publikować sprzedawcy i serwisanci AED.
- Zasób typu XML/GML (np. drugi plik Przemyśla) jest pomijany. Raport dostawcy informuje o tym.
- Na Macach z Apple Silicon pierwsza budowa obrazu backendu trwa około 15 minut (emulacja amd64).

## Pochodzenie kodu
Kod bazowy pochodzi z otwartego repozytorium portalu dane.gov.pl (https://dane.gov.pl/source-code/, mirror `olekstomek/mcod-backend-dane.gov.pl` i `olekstomek/mcod-frontend-dane.gov.pl`). Zmiany zespołu obejmują:
- moduł `backend/mcod/aed/` i podpięcia w backendzie (flaga zbioru, hook w potoku zasobów, ustawienia, menu panelu),
- sekcję „Dane według dostawców” we frontendzie,
- poprawki błędów portalu wykrytych podczas pracy: tłumaczona wartość `LoggingMethod.FORM` (błąd 500 przy logowaniu), ładowanie Leafleta w dev-serverze, kafelki OSM przez HTTPS.

Poprzednia wersja projektu (aplikacja Next.js z mapą AED) jest na gałęzi [`legacy-nextjs`](../../tree/legacy-nextjs).
