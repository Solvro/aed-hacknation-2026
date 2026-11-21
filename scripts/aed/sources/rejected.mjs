// Źródła sprawdzone i świadomie NIE używane — trafiają do AED_SOURCES.md, żeby nikt ich nie sprawdzał drugi raz.

export const REJECTED = [
  {
    title: 'Ratuj z Sercem',
    url: 'https://ratujzsercem.pl',
    reason: 'zamknięta baza; licencja nie pozwala kopiować danych (wg dyskusji społeczności OSM) — ryzyko prawne',
  },
  {
    title: 'Staying Alive / Ogólnopolska Mapa AED',
    url: 'aplikacja mobilna Staying Alive',
    reason: 'zamknięta baza aplikacji, brak publicznego API i licencji na ponowne użycie',
  },
  {
    title: 'Geoportal — warstwa „Defibrylatory” (GUGiK)',
    url: 'https://www.geoportal.gov.pl',
    reason: 'warstwa powstaje z danych OSM (porozumienie GUGiK–OSM Polska) — duplikat OpenAEDMap',
  },
  {
    title: 'aedmapa.pl / aplikacja „Mapa AED”',
    url: 'https://aedmapa.pl',
    reason: 'korzysta z danych OSM — duplikat OpenAEDMap',
  },
  {
    title: 'Overpass API jako źródło główne',
    url: 'https://overpass-api.de',
    reason: 'te same dane co OpenAEDMap, a serwery bywają przeciążone (502/504 przy teście 2026-11-21); zostaje jako fallback',
  },
  {
    title: 'Geofabrik poland-latest.osm.pbf',
    url: 'https://download.geofabrik.de/europe/poland.html',
    reason: 'te same dane co OpenAEDMap, plik 2,1 GB — niepotrzebny przy działającym OpenAEDMap',
  },
  {
    title: 'Gdynia — artykuł o AED',
    url: 'https://www.gdynia.pl/co-nowego,2774/male-urzadzenie-ratujace-zycie-poznaj-aed,540318',
    reason: 'brak listy lokalizacji — tylko opis („16 gminnych AED”) i odesłanie do Map Google',
  },
  {
    title: 'Wrocław, Poznań, Szczecin, Bydgoszcz, Rzeszów, Katowice, Opole, Gorzów, Białystok, Kielce, Zielona Góra',
    url: 'portale i BIP-y miast (sprawdzone 2026-11-21)',
    reason: 'brak opublikowanej listy/warstwy AED (Wrocław: open-data 403, geoportal bez warstwy; Poznań: brak klasy AED w API; Białystok/Kielce: tylko opis; Zielona Góra: obrazek z 2017) — pokrycie z OSM',
  },
];

// Znalezione i zweryfikowane, ale jeszcze NIE podpięte (kandydaci na kolejne źródła).
export const PENDING = [
  { title: 'Gliwice — tabela HTML (07.07.2026)', url: 'http://gliwice.eu/aktualnosci/bezpieczne-gliwice/aed-w-gliwicach-gdzie-sprawdzic-lokalizacje-i-jak-skorzystac-z', note: '95 wierszy z adresem, umiejscowieniem i godzinami — do złączenia po nazwie z gliwice-gama (wzbogacenie atrybutów, nie nowe punkty)' },
];
