# Źródła danych AED

> Plik generowany automatycznie przez `pnpm aed:scrape` (scripts/aed/scrape.mjs) — nie edytuj ręcznie.
> Opisy źródeł: `meta` w `scripts/aed/sources/*.mjs`, odrzucone: `scripts/aed/sources/rejected.mjs`.

Ostatnia aktualizacja: 2026-11-21

## Używane źródła

1. **OpenAEDMap (OpenStreetMap Polska)** — `openaedmap`
   - Status: ✅ 18297 rekordów (pobrano 2026-11-21)
   - Endpoint: https://openaedmap.org/api/v1/countries/PL.geojson
   - Fallback: https://overpass-api.de/api/interpreter
   - Format: GeoJSON
   - Współrzędne: natywne WGS84
   - Licencja: ODbL — © OpenStreetMap contributors (https://www.openstreetmap.org/copyright)
   - Atrybucja: © OpenStreetMap contributors
   - Odświeżanie: co godzinę (cache Cloudflare); OSM aktualizowany na bieżąco

2. **Portal otwartych danych dane.gov.pl — zbiory gmin** — `dane.gov.pl`
   - Status: ✅ 74 rekordów (pobrano 2026-11-21)
   - Endpoint: https://api.dane.gov.pl/1.4/search?q=<fraza>
   - Format: CSV / GeoJSON / JSON (wybierany najlepszy dostępny format zbioru)
   - Współrzędne: natywne (naprawiane zamienione lat/lon)
   - Licencja: zgodnie z warunkami każdego zbioru (zwykle bez ograniczeń)
   - Atrybucja: dane.gov.pl + nazwa gminy
   - Odświeżanie: zależnie od gminy; wykrywanie nowych zbiorów przy każdym uruchomieniu
   - Defibrylatory zlokalizowane na terenie Miasta Marki — 8 pkt, csv, zmiana 2025-07-10: https://api.dane.gov.pl/media/resources/20250710/Defibrylator_GminaMiastoMarki_1.csv (zbiór: https://dane.gov.pl/pl/dataset/4955)
   - Defibrylatory zlokalizowane w Mieście Krosno — 21 pkt, csv, zmiana 2024-02-19: https://api.dane.gov.pl/media/resources/20240219/Defibrylator_jAmxQcp.csv (zbiór: https://dane.gov.pl/pl/dataset/3624)
   - ⏸ Lokalizacja defibrylatorów (AED) — pominięte: brak CSV/GeoJSON/JSON albo źródło obsługiwane osobno
   - Lokalizacje AED – Automatycznych Defibrylatorów Zewnętrznych w Przemyślu — 21 pkt, geojson, zmiana 2024-11-06: https://api.dane.gov.pl/media/resources/20241106/1730818801_b50R6UVxPgoVdBbq.geojson (zbiór: https://dane.gov.pl/pl/dataset/4581)
   - Wykaz defibrylatorów AED wraz z ich lokalizacją w Legionowie. — 24 pkt, csv, zmiana 2026-09-14: https://api.dane.gov.pl/media/resources/20260914/aed.csv (zbiór: https://dane.gov.pl/pl/dataset/40593)

3. **API m.st. Warszawy — Lokalizacja defibrylatorów (AED)** — `um.warszawa.pl`
   - Status: ⏸ pominięte: brak WARSAW_API_TOKEN
   - Endpoint: https://dane.um.warszawa.pl/api/action/get_scb_lokalizacja_defibrylatorow
   - Dokumentacja / strona: https://dane.um.warszawa.pl/pl/catalogue/7bc32ffc-c2ac-4d32-83c9-b6f7a0b38de8
   - Format: JSON (POST, nagłówek Authorization: <token>)
   - Współrzędne: natywne WGS84 ([[lon, lat]])
   - Licencja: CC BY — Stołeczne Centrum Bezpieczeństwa m.st. Warszawy
   - Atrybucja: Urząd m.st. Warszawy / Stołeczne Centrum Bezpieczeństwa
   - Odświeżanie: codziennie
   - Wymaga: WARSAW_API_TOKEN (darmowy: https://dane.um.warszawa.pl/key-api)

4. **Kraków — program „Krakowski IMPULS ŻYCIA AED”** — `krakow.pl`
   - Status: ✅ 78 rekordów (pobrano 2026-11-21)
   - Endpoint: https://krakow.pl/instcbi/3992/2432/{0..N}
   - Dokumentacja / strona: https://krakow.pl/3992,artykul,gdzie-znalezc-defibrylator-.html
   - Format: HTML (tabela paginowana od 0 + strony szczegółów)
   - Współrzędne: BRAK — geokodowane z adresu (GUGiK UUG, fallback Nominatim)
   - Licencja: informacja publiczna (Urząd Miasta Krakowa)
   - Atrybucja: Urząd Miasta Krakowa
   - Odświeżanie: ręcznie przez UMK (stan podawany na stronie)

5. **InPost — AED w paczkomatach „Helpbox 365” (cała Polska)** — `inpost-aed`
   - Status: ✅ 137 rekordów (pobrano 2026-11-21)
   - Endpoint: https://inpost.pl/aed-points
   - Dokumentacja / strona: https://inpost.pl/aed
   - Format: GeoJSON
   - Współrzędne: natywne WGS84
   - Licencja: brak deklaracji licencji — informacja publiczna wydawcy (do potwierdzenia przed publikacją)
   - Atrybucja: InPost
   - Odświeżanie: zależnie od wydawcy

6. **Łódź — mapa defibrylatorów AED (UMŁ, Google My Maps)** — `lodz`
   - Status: ✅ 136 rekordów (pobrano 2026-11-21)
   - Endpoint: https://www.google.com/maps/d/kml?mid=1FMKFbebKJPYqD4C87pXWPqNjEHuEswE&forcekml=1
   - Dokumentacja / strona: https://uml.lodz.pl/dla-mieszkancow/zdrowie/mapa-defibrylatorow-aed/
   - Format: KML
   - Współrzędne: natywne WGS84
   - Licencja: brak deklaracji licencji — informacja publiczna wydawcy (do potwierdzenia przed publikacją)
   - Atrybucja: Łódź
   - Odświeżanie: zależnie od wydawcy

7. **Olsztyn — mapa AED (olsztyn.eu, Google My Maps)** — `olsztyn`
   - Status: ✅ 43 rekordów (pobrano 2026-11-21)
   - Endpoint: https://www.google.com/maps/d/kml?mid=1J5zJj9kL49uq8799g5qNgfl21NoztwzK&forcekml=1
   - Dokumentacja / strona: https://olsztyn.eu
   - Format: KML
   - Współrzędne: natywne WGS84
   - Licencja: brak deklaracji licencji — informacja publiczna wydawcy (do potwierdzenia przed publikacją)
   - Atrybucja: Olsztyn
   - Odświeżanie: zależnie od wydawcy

8. **Koszalin — „Punkty Życia” (koszalin.pl, Google My Maps)** — `koszalin`
   - Status: ✅ 35 rekordów (pobrano 2026-11-21)
   - Endpoint: https://www.google.com/maps/d/kml?mid=1AQwJAfeZsGGB7fhz0-yBSxab83DwyIw&forcekml=1
   - Dokumentacja / strona: https://koszalin.pl
   - Format: KML
   - Współrzędne: natywne WGS84
   - Licencja: brak deklaracji licencji — informacja publiczna wydawcy (do potwierdzenia przed publikacją)
   - Atrybucja: Koszalin
   - Odświeżanie: zależnie od wydawcy

9. **Gliwice — aplikacja miejska GAMA (kategoria 90 = AED)** — `gliwice-gama`
   - Status: ✅ 95 rekordów (pobrano 2026-11-21)
   - Endpoint: https://gama.gliwice.eu/map/json
   - Dokumentacja / strona: https://gliwice.eu/aktualnosci/bezpieczne-gliwice/aed-w-gliwicach-gdzie-sprawdzic-lokalizacje-i-jak-skorzystac-z
   - Format: JSON (filtr cat == 90)
   - Współrzędne: natywne WGS84
   - Licencja: brak deklaracji licencji — informacja publiczna wydawcy (do potwierdzenia przed publikacją)
   - Atrybucja: Gliwice
   - Odświeżanie: zależnie od wydawcy

10. **Kraków — warstwa ArcGIS Online „AED_zestawy” (konto prywatne, 2022)** — `arcgis-krakow-2022`
   - Status: ✅ 150 rekordów (pobrano 2026-11-21)
   - Endpoint: https://services6.arcgis.com/w8Sm3ehkmwzR6bQc/arcgis/rest/services/AED_zestawy/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson
   - Format: GeoJSON (ArcGIS FeatureServer)
   - Współrzędne: natywne WGS84
   - Licencja: brak deklaracji licencji — informacja publiczna wydawcy (do potwierdzenia przed publikacją)
   - Atrybucja: Kraków
   - Odświeżanie: zależnie od wydawcy

11. **Mikołów i okolice — warstwa ArcGIS Online „Defibrylatory_AED”** — `arcgis-mikolow`
   - Status: ✅ 20 rekordów (pobrano 2026-11-21)
   - Endpoint: https://services9.arcgis.com/E1ZsJFZqsk2tR9yK/arcgis/rest/services/Defibrylatory_AED/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson
   - Format: GeoJSON (ArcGIS FeatureServer)
   - Współrzędne: natywne WGS84
   - Licencja: brak deklaracji licencji — informacja publiczna wydawcy (do potwierdzenia przed publikacją)
   - Atrybucja: Mikołów i okolice
   - Odświeżanie: zależnie od wydawcy

12. **Jelenia Góra — uMap „Lokalizacja AED w Jeleniej Górze”** — `umap-jelenia-gora`
   - Status: ✅ 21 rekordów (pobrano 2026-11-21)
   - Endpoint: https://umap.openstreetmap.fr/pl/datalayer/1253792/1a6f3fba-bb95-4dfd-8be3-8d01b5b9f22c/
   - Dokumentacja / strona: https://umap.openstreetmap.fr/pl/map/lokalizacja-aed-w-jeleniej-gorze_1253792
   - Format: GeoJSON (uMap)
   - Współrzędne: natywne WGS84
   - Licencja: WTFPL
   - Atrybucja: Jelenia Góra
   - Odświeżanie: zależnie od wydawcy

13. **Wejherowo — uMap „Interaktywna mapa AED Wejherowo”** — `umap-wejherowo`
   - Status: ✅ 18 rekordów (pobrano 2026-11-21)
   - Endpoint: https://umap.openstreetmap.fr/pl/datalayer/1469464/fd5ec717-3b9c-4931-b44f-3c1e98dfb0ec/
   - Dokumentacja / strona: https://umap.openstreetmap.fr/pl/map/interaktywna-mapa-aed-wejherowo_1469464
   - Format: GeoJSON (uMap)
   - Współrzędne: natywne WGS84
   - Licencja: brak deklaracji licencji — informacja publiczna wydawcy (do potwierdzenia przed publikacją)
   - Atrybucja: Wejherowo
   - Odświeżanie: zależnie od wydawcy

14. **Gdańsk — wykaz defibrylatorów (gdansk.pl, stan 25.02.2022)** — `gdansk`
   - Status: ✅ 108 rekordów (pobrano 2026-11-21)
   - Endpoint: https://www.gdansk.pl/wiadomosci/Defibrylatory,a,216952
   - Format: HTML (tabela)
   - Współrzędne: BRAK — geokodowane z adresu (GUGiK UUG, fallback Nominatim)
   - Licencja: brak deklaracji licencji — informacja publiczna urzędu (do potwierdzenia przed publikacją)
   - Atrybucja: Urząd Miasta Gdańsk
   - Odświeżanie: ręcznie przez urząd

15. **Toruń — wykaz miejskich defibrylatorów AED (torun.pl)** — `torun`
   - Status: ✅ 46 rekordów (pobrano 2026-11-21)
   - Endpoint: https://torun.pl/pl/zdrowie/defibrylatory-aed-wykaz-lokalizacji
   - Format: HTML (lista <ol>)
   - Współrzędne: BRAK — geokodowane z adresu (GUGiK UUG, fallback Nominatim)
   - Licencja: brak deklaracji licencji — informacja publiczna urzędu (do potwierdzenia przed publikacją)
   - Atrybucja: Urząd Miasta Toruń
   - Odświeżanie: ręcznie przez urząd

16. **Lublin — wykaz defibrylatorów AED (lublin.eu, PDF)** — `lublin`
   - Status: ✅ 47 rekordów (pobrano 2026-11-21)
   - Endpoint: https://lublin.eu/mieszkancy/zdrowie/aktualnosci/aed-w-lublinie,748,1345,1.html
   - Format: PDF (link pobierany ze strony artykułu — nazwa pliku zawiera datę stanu)
   - Współrzędne: BRAK — geokodowane z adresu (GUGiK UUG, fallback Nominatim)
   - Licencja: brak deklaracji licencji — informacja publiczna urzędu (do potwierdzenia przed publikacją)
   - Atrybucja: Urząd Miasta Lublin
   - Odświeżanie: ręcznie przez urząd

17. **Sopot — defibrylatory stacjonarne (sopot.pl, stan X.2021)** — `sopot`
   - Status: ❌ błąd przy ostatnim pobraniu: 0 pozycji — strona zwróciła błąd albo zmieniła strukturę (poprzednie dane w data/raw zostają)
   - Endpoint: https://www.sopot.pl/aktualnosc/9383/gdzie-w-sopocie-znajdziesz-defibrylator-aed
   - Format: HTML (akapity „• nazwa, adres / N szt., godziny, miejsce”)
   - Współrzędne: BRAK — geokodowane z adresu (GUGiK UUG, fallback Nominatim)
   - Licencja: brak deklaracji licencji — informacja publiczna urzędu (do potwierdzenia przed publikacją)
   - Atrybucja: Urząd Miasta Sopotu
   - Odświeżanie: ręcznie przez urząd

18. **Chełm — defibrylatory AED w miejskiej przestrzeni publicznej (Budżet Obywatelski)** — `chelm`
   - Status: ✅ 10 rekordów (pobrano 2026-11-21)
   - Endpoint: https://samorzad.gov.pl/web/miasto-chelm/defibrylatory-aed-w-miejskiej-przestrzeni-publicznej
   - Format: HTML (lista „osiedle – nazwa, adres”)
   - Współrzędne: BRAK — geokodowane z adresu (GUGiK UUG, fallback Nominatim)
   - Licencja: brak deklaracji licencji — informacja publiczna urzędu (do potwierdzenia przed publikacją)
   - Atrybucja: Urząd Miasta Chełm
   - Odświeżanie: ręcznie przez urząd

19. **Uniwersytet Śląski — defibrylatory AED w budynkach uczelni** — `us-edu`
   - Status: ✅ 29 rekordów (pobrano 2026-11-21)
   - Endpoint: https://us.edu.pl/bezpieczenstwo/defibrylatory-aed/
   - Format: HTML (akordeon miast, lista <li>)
   - Współrzędne: BRAK — geokodowane z adresu (GUGiK UUG, fallback Nominatim)
   - Licencja: brak deklaracji licencji — informacja publiczna urzędu (do potwierdzenia przed publikacją)
   - Atrybucja: Uniwersytet Śląski w Katowicach
   - Odświeżanie: ręcznie przez urząd

## Geokodery (dla źródeł bez współrzędnych)

1. **GUGiK UUG — Usługa Lokalizacji Adresów (PRG)** — https://services.gugik.gov.pl/uug/
   - Licencja: dane publiczne GUGiK (państwowy rejestr granic i adresów)
   - Limit: brak opublikowanego; używamy 2 zapytań naraz co 150 ms + cache 30 dni

2. **Nominatim (OpenStreetMap) — fallback** — https://nominatim.openstreetmap.org/
   - Licencja: ODbL — © OpenStreetMap contributors
   - Limit: max 1 zapytanie/s wg polityki; używamy 1 co 1,1 s + cache 30 dni

## Znalezione, jeszcze niepodpięte

1. **Gliwice — tabela HTML (07.07.2026)** (http://gliwice.eu/aktualnosci/bezpieczne-gliwice/aed-w-gliwicach-gdzie-sprawdzic-lokalizacje-i-jak-skorzystac-z) — 95 wierszy z adresem, umiejscowieniem i godzinami — do złączenia po nazwie z gliwice-gama (wzbogacenie atrybutów, nie nowe punkty)

## Sprawdzone i odrzucone

1. **Ratuj z Sercem** (https://ratujzsercem.pl) — zamknięta baza; licencja nie pozwala kopiować danych (wg dyskusji społeczności OSM) — ryzyko prawne
2. **Staying Alive / Ogólnopolska Mapa AED** (aplikacja mobilna Staying Alive) — zamknięta baza aplikacji, brak publicznego API i licencji na ponowne użycie
3. **Geoportal — warstwa „Defibrylatory” (GUGiK)** (https://www.geoportal.gov.pl) — warstwa powstaje z danych OSM (porozumienie GUGiK–OSM Polska) — duplikat OpenAEDMap
4. **aedmapa.pl / aplikacja „Mapa AED”** (https://aedmapa.pl) — korzysta z danych OSM — duplikat OpenAEDMap
5. **Overpass API jako źródło główne** (https://overpass-api.de) — te same dane co OpenAEDMap, a serwery bywają przeciążone (502/504 przy teście 2026-11-21); zostaje jako fallback
6. **Geofabrik poland-latest.osm.pbf** (https://download.geofabrik.de/europe/poland.html) — te same dane co OpenAEDMap, plik 2,1 GB — niepotrzebny przy działającym OpenAEDMap
7. **Gdynia — artykuł o AED** (https://www.gdynia.pl/co-nowego,2774/male-urzadzenie-ratujace-zycie-poznaj-aed,540318) — brak listy lokalizacji — tylko opis („16 gminnych AED”) i odesłanie do Map Google
8. **Wrocław, Poznań, Szczecin, Bydgoszcz, Rzeszów, Katowice, Opole, Gorzów, Białystok, Kielce, Zielona Góra** (portale i BIP-y miast (sprawdzone 2026-11-21)) — brak opublikowanej listy/warstwy AED (Wrocław: open-data 403, geoportal bez warstwy; Poznań: brak klasy AED w API; Białystok/Kielce: tylko opis; Zielona Góra: obrazek z 2017) — pokrycie z OSM

## Wymagana atrybucja w aplikacji

- © OpenStreetMap contributors
- dane.gov.pl + nazwa gminy
- Urząd Miasta Krakowa
- InPost
- Łódź
- Olsztyn
- Koszalin
- Gliwice
- Kraków
- Mikołów i okolice
- Jelenia Góra
- Wejherowo
- Urząd Miasta Gdańsk
- Urząd Miasta Toruń
- Urząd Miasta Lublin
- Urząd Miasta Chełm
- Uniwersytet Śląski w Katowicach
