#!/usr/bin/env node
// Etap 2: uwspólnienie data/raw/*.json -> data/aed-pl.geojson (+ raport).
// Nie wysyła żadnych zapytań — można iterować do woli.
//
// Zasady (wersja bazowa, do dopracowania):
//  - OSM (OpenAEDMap) jest bazą: ma stabilne ID i najwięcej atrybutów.
//  - Pozostałe źródła dopasowujemy w kolejności zaufania; promień zależy od jakości współrzędnych
//    (natywne vs geokodowane, dokładność geokodera).
//  - Jeden punkt bazowy przyjmuje najwyżej JEDEN rekord z danego źródła (2 AED w jednym budynku
//    w danych miasta przy 1 w OSM => drugi zostaje osobnym punktem).
//  - Wewnątrz jednego źródła nie deduplikujemy (to mogą być różne urządzenia).
//  - Puste pola uzupełniamy z kolejnych źródeł; nic nie nadpisujemy.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const RAW_DIR = path.join(ROOT, 'data', 'raw');
const OUT = path.join(ROOT, 'data', 'aed-pl.geojson');
const REPORT = path.join(ROOT, 'data', 'aed-pl.report.json');
const OUT_MOBILE = path.join(ROOT, 'data', 'aed-pl-mobile.geojson');

const BASE_SOURCE = 'openaedmap';
// Kolejność zaufania: oficjalne API/portale -> oficjalne listy i mapy miast -> operatorzy -> mapy społecznościowe/prywatne.
// Źródła spoza listy idą na koniec, alfabetycznie.
const TRUST_ORDER = [
  'um.warszawa.pl', 'dane.gov.pl',
  'krakow.pl', 'lodz', 'gdansk', 'torun', 'lublin', 'olsztyn', 'koszalin', 'gliwice-gama', 'sopot', 'chelm', 'us-edu',
  'inpost-aed',
  'umap-jelenia-gora', 'umap-wejherowo', 'arcgis-mikolow', 'arcgis-krakow-2022',
];
const FIELDS = ['name', 'operator', 'location', 'address', 'city', 'access', 'indoor', 'opening_hours', 'phone', 'level', 'image'];

// ---------------------------------------------------------------- dopasowanie
// Para (rekord, punkt bazowy) jest dopasowana, gdy:
//   a) d <= promień "na ślepo" (zależny od jakości współrzędnych), albo
//   b) d <= SEARCH_RADIUS i score >= MIN_SCORE, gdzie score łączy podobieństwo tekstu,
//      zgodność adresu (ulica + numer) i karę za odległość.
const SEARCH_RADIUS = 300;
const MIN_SCORE = 0.45;

function blindRadius(rec) {
  if (!rec.geocode) return 40; // natywne współrzędne
  const a = rec.geocode.accuracy ?? 0;
  if (a >= 0.95) return 50; // punkt adresowy budynku
  return 0; // mniej precyzyjny geokod — wymagamy potwierdzenia tekstem
}

const STOP = new Set(`ul al pl os ulica aleja plac osiedle nr im imienia i w we na przy obok do od z ze oraz lub a o
  defibrylator defibrylatora defibrylatory aed automatyczny zewnetrzny budynek budynku wejscie wejsciu wejscia glowne glownym
  glowny parter hol holu korytarz scianie sciana zewnatrz wewnatrz srodku obiektu obiekt lewej prawej stronie strona
  krakow krakowa krakowie warszawa warszawy warszawie polska pomieszczenie pomieszczeniu sp zoo s a`.split(/\s+/));

const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
/** Rdzenie słów (5 znaków) — tani "stemming" pod polską odmianę: szkolno/szkolnej, legionow/legionów. */
const stems = (s) => new Set(fold(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)).map((w) => w.slice(0, 5)));
const numbers = (s) => new Set((fold(s).match(/\b\d+[a-z]?\b/g) ?? []).filter((n) => !/^\d{2}$|^\d{5}$/.test(n)));

const textOf = (p) => [p.name, p.operator, p.location, p.address, p.raw?.description, p.raw?.['defibrillator:location'], p.raw?.note].filter(Boolean).join(' ');

function textSim(a, b) {
  if (!a.size || !b.size) return { ratio: 0, common: 0 };
  let common = 0;
  for (const t of a) if (b.has(t)) common++;
  return { ratio: common / Math.min(a.size, b.size), common }; // containment: krótka nazwa zawarta w długim opisie OSM
}

function addressMatch(rec, p) {
  const streetA = stems(rec.address), streetB = stems(`${p.address} ${textOf(p)}`);
  const numA = numbers(rec.address), numB = numbers(`${p.address} ${textOf(p)}`);
  const streetHit = [...streetA].some((s) => streetB.has(s));
  const numHit = [...numA].some((n) => numB.has(n));
  return streetHit && numHit ? 1 : 0;
}

function score(rec, p, d) {
  // Punkt bazowy bez żadnego opisu (częste w OSM) — nie ma czego porównać; bardzo blisko = ten sam AED.
  if (!p._stems.size && d <= 15) return { t: 0, a: 0, s: MIN_SCORE };
  const { ratio: t, common } = textSim(rec._stems, p._stems);
  const a = addressMatch(rec, p);
  // Daleko (>150 m) ogólne nazwy ("Urząd Miasta – ochrona") nie wystarczą: wymagamy adresu albo ≥4 wspólnych rdzeni.
  if (d > 150 && !a && common < 4) return { t, a, s: 0 };
  return { t, a, s: t + 0.5 * a - d / SEARCH_RADIUS * 0.5 };
}

function haversine(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

class Grid {
  constructor(cellDeg = 0.002) { this.c = cellDeg; this.m = new Map(); }
  key(lat, lon) { return `${Math.floor(lat / this.c)}:${Math.floor(lon / (this.c * 1.5))}`; }
  add(p) {
    const k = this.key(p.lat, p.lon);
    (this.m.get(k) ?? this.m.set(k, []).get(k)).push(p);
  }
  near(p, r) {
    const [y, x] = this.key(p.lat, p.lon).split(':').map(Number);
    const out = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        for (const q of this.m.get(`${y + dy}:${x + dx}`) ?? []) {
          const d = haversine(p, q);
          if (d <= r) out.push({ q, d });
        }
    return out.sort((a, b) => a.d - b.d);
  }
}

// ---------------------------------------------------------------- load
const files = (await readdir(RAW_DIR)).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
const raw = Object.fromEntries(await Promise.all(files.map(async (f) => {
  const j = JSON.parse(await readFile(path.join(RAW_DIR, f), 'utf8'));
  return [j.source, j];
})));
if (!raw[BASE_SOURCE]) throw new Error(`Brak data/raw/${BASE_SOURCE}.json — uruchom najpierw scrape.mjs`);

const order = Object.keys(raw)
  .filter((s) => s !== BASE_SOURCE)
  .sort((a, b) => (TRUST_ORDER.indexOf(a) + 1 || 99) - (TRUST_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));

// ---------------------------------------------------------------- merge
const toPoint = (rec, distance = 0) => ({
  lat: rec.lat,
  lon: rec.lon,
  ...Object.fromEntries(FIELDS.map((f) => [f, rec[f] ?? ''])),
  coordsFrom: rec.source,
  coordsQuality: rec.geocode ? `geocoded:${rec.geocode.provider}:${rec.geocode.accuracy}` : 'native',
  sources: [{ source: rec.source, id: rec.sourceId, distance_m: Math.round(distance), license: rec.license }],
  raw: rec.raw,
  _stems: stems(textOf(rec)),
});

// AED mobilne (radiowozy, tramwaje, karetki) nie są stałymi punktami — nie trafiają na mapę.
// Uwaga: "przystanek autobusowy" / "dworzec autobusowy" to punkty stałe — nie łapiemy samego "autobus".
// "na wyposażeniu ratowników wodnych / hali sportowej" to AED stacjonarny w obiekcie — zostaje.
// Wzorce sprawdzone na danych OSM (2026-11-21): łapią "samochód ratowniczo-gaśniczy", "w/na pojeździe",
// "wóz bojowy", "urządzenie mobilne", ale NIE "salon samochodowy", "parking samochodowy", "bramy wjazdowe pojazdów".
const MOBILE = new RegExp([
  'radiow[oó]z', '(w|na) pojeździe', '(w|na) pojazdach', 'wyposażeniu pojazdu', 'pojazdu (strażackiego|pożarniczego|bojowego)',
  'samoch[óo]d(zie|ach|em|u)?\\b', 'wóz bojowy', 'w tramwaj', 'w autobus', 'karetk', 'mobiln',
  'jednostki pływającej', 'na wyposażeniu jednostki', 'dla celów ratowniczych',
].join('|'), 'i');
const mobileText = (r) => [r.name, r.location, r.raw?.description, r.raw?.['defibrillator:location'], r.raw?.['defibrillator:location:pl']].filter(Boolean).join(' ');

// ---- baza (OSM): odfiltruj mobilne, usuń wewnętrzne duplikaty
// Duplikat OSM = (a) <=5 m i identyczne tagi merytoryczne albo (b) <=1 m i tagi jednego zawierają się w tagach drugiego.
// Ostrożnie: różne tagi w tym samym miejscu to zwykle różne urządzenia (np. inne piętra).
const IGNORE_TAGS = new Set(['check_date', 'source', 'image', 'image:license', 'fixme', 'note', 'survey:date', 'source:date']);
const tagSig = (raw) => Object.entries(raw ?? {}).filter(([k]) => !IGNORE_TAGS.has(k)).map(([k, v]) => `${k}=${v}`);
const isSubset = (a, b) => a.every((x) => b.includes(x));

const baseAll = raw[BASE_SOURCE].records;
const baseMobile = baseAll.filter((r) => MOBILE.test(mobileText(r)));
const grid = new Grid();
const points = [];
const osmDuplicates = [];
for (const r of baseAll) {
  if (baseMobile.includes(r)) continue;
  const p = toPoint(r);
  p._sig = tagSig(r.raw);
  const dup = grid.near(p, 5).find(({ q, d }) => {
    if (q.sources[0].source !== BASE_SOURCE) return false;
    const same = q._sig.length === p._sig.length && isSubset(p._sig, q._sig);
    return same || (d <= 1 && (isSubset(p._sig, q._sig) || isSubset(q._sig, p._sig)));
  });
  if (dup) {
    const q = dup.q;
    // zostaw bogatszy wpis jako główny; drugi ID dopisz jako duplikat
    if (p._sig.length > q._sig.length) for (const f of FIELDS) if (p[f]) q[f] = p[f];
    q.sources.push({ source: BASE_SOURCE, id: r.sourceId, distance_m: Math.round(dup.d), match: 'osm-duplicate', license: r.license });
    osmDuplicates.push({ keep: q.sources[0].id, drop: r.sourceId, d: Math.round(dup.d), text: textOf(p).slice(0, 60) });
    continue;
  }
  points.push(p);
  grid.add(p);
}

const report = {
  generatedAt: new Date().toISOString(),
  base: {
    source: BASE_SOURCE,
    records: baseAll.length,
    mobileExcluded: baseMobile.length,
    mobileSample: baseMobile.slice(0, 15).map((r) => `${r.sourceId}: ${mobileText(r).slice(0, 70)}`),
    osmDuplicatesMerged: osmDuplicates.length,
    osmDuplicatesSample: osmDuplicates.slice(0, 15),
    count: points.length,
  },
  sources: {},
};

for (const src of order) {
  const all = raw[src].records;
  const mobile = all.filter((r) => MOBILE.test(mobileText(r)));
  const recs = all.filter((r) => !mobile.includes(r)).map((r) => ({ ...r, _stems: stems(textOf(r)) }));

  // Kandydaci (rekord, punkt) w promieniu SEARCH_RADIUS, przydział zachłanny od najlepszych par:
  // każdy punkt przyjmuje max 1 rekord z tego źródła, każdy rekord trafia max do 1 punktu.
  const pairs = [];
  recs.forEach((rec, i) => {
    const blind = blindRadius(rec);
    for (const { q, d } of grid.near(rec, SEARCH_RADIUS)) {
      if (q.sources.some((s) => s.source === src)) continue; // punkt z tego samego źródła
      const sc = score(rec, q, d);
      if (d <= blind || sc.s >= MIN_SCORE) pairs.push({ i, q, d, ...sc, why: d <= blind ? 'distance' : 'text' });
    }
  });
  // najpierw pewne (blisko + zgodny tekst), potem reszta
  pairs.sort((a, b) => b.s - a.s || a.d - b.d);
  const usedRec = new Set(), usedPt = new Set();
  const matched = [];
  for (const pr of pairs) {
    const { i, q, d } = pr;
    if (usedRec.has(i) || usedPt.has(q)) continue;
    usedRec.add(i); usedPt.add(q);
    const rec = recs[i];
    q.sources.push({ source: src, id: rec.sourceId, distance_m: Math.round(d), match: pr.why, score: Number(pr.s.toFixed(2)), license: rec.license });
    for (const f of FIELDS) if (!q[f] && rec[f]) q[f] = rec[f];
    matched.push({ d, why: pr.why, name: rec.name, osm: textOf(q).slice(0, 80), t: pr.t, a: pr.a });
  }
  const added = [];
  recs.forEach((rec, i) => {
    if (usedRec.has(i)) return;
    const p = toPoint(rec);
    points.push(p);
    grid.add(p);
    added.push({ id: rec.sourceId, name: rec.name, address: rec.address, quality: p.coordsQuality });
  });
  const matchedDist = matched.map((m) => m.d).sort((a, b) => a - b);
  report.sources[src] = {
    records: all.length,
    mobileExcluded: mobile.map((r) => r.name),
    matched: matched.length,
    matchedByText: matched.filter((m) => m.why === 'text').length,
    added: added.length,
    textMatches: matched.filter((m) => m.why === 'text').map((m) => ({ d: Math.round(m.d), text: Number(m.t.toFixed(2)), addr: m.a, name: m.name, osm: m.osm })),
    matchDistance_m: matchedDist.length
      ? { median: Math.round(matchedDist[matchedDist.length >> 1]), p90: Math.round(matchedDist[Math.floor(matchedDist.length * 0.9)]), max: Math.round(matchedDist.at(-1)) }
      : null,
    addedSample: added.slice(0, 15),
  };
}

// ---------------------------------------------------------------- output
points.forEach((p, i) => {
  p.id = p.sources[0].source === BASE_SOURCE ? `osm:${p.sources[0].id}` : `${p.sources[0].source}:${p.sources[0].id}`;
  p.confirmedBy = new Set(p.sources.map((s) => s.source)).size;
  p._i = i;
});
report.total = points.length;
report.multiSource = points.filter((p) => p.confirmedBy > 1).length;

const fc = {
  type: 'FeatureCollection',
  attribution: [...new Set(points.flatMap((p) => p.sources.map((s) => s.license)).filter(Boolean))].slice(0, 20),
  features: points.map(({ lat, lon, _i, _stems, _sig, raw: _raw, ...props }) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [Number(lon.toFixed(7)), Number(lat.toFixed(7))] },
    properties: props,
  })),
};
await writeFile(OUT, JSON.stringify(fc));

// AED mobilne (OSP, PSP, straż leśna, radiowozy...) — osobny plik, żeby aplikacja mogła pokazać je jako osobną warstwę
const mobileAll = [
  ...baseMobile.map((r) => ({ ...r, source: BASE_SOURCE })),
  ...order.flatMap((src) => raw[src].records.filter((r) => MOBILE.test(mobileText(r)))),
];
await writeFile(OUT_MOBILE, JSON.stringify({
  type: 'FeatureCollection',
  features: mobileAll.map((r) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [Number(r.lon.toFixed(7)), Number(r.lat.toFixed(7))] },
    properties: { id: `${r.source}:${r.sourceId}`, mobile: true, name: r.name ?? '', operator: r.operator ?? '', location: r.location ?? '', city: r.city ?? '', source: r.source, license: r.license },
  })),
}));
report.mobileTotal = mobileAll.length;
await writeFile(REPORT, JSON.stringify(report, null, 2));

console.log(`Baza ${BASE_SOURCE}: ${report.base.records} rek. → mobilnych pominięto ${report.base.mobileExcluded}, duplikatów OSM scalono ${report.base.osmDuplicatesMerged} → ${report.base.count}`);
for (const [s, r] of Object.entries(report.sources))
  console.log(`  ${s.padEnd(16)} ${String(r.records).padStart(5)} rek. → dopasowano ${String(r.matched).padStart(4)} (w tym po tekście ${r.matchedByText}), nowych ${String(r.added).padStart(4)}, mobilnych pominięto ${r.mobileExcluded.length}` +
    (r.matchDistance_m ? `  (odległość: mediana ${r.matchDistance_m.median} m, p90 ${r.matchDistance_m.p90} m)` : ''));
console.log(`Razem: ${report.total} punktów, ${report.multiSource} potwierdzonych przez >1 źródło`);
console.log(`AED mobilne (osobny plik): ${report.mobileTotal}`);
console.log(`→ ${path.relative(ROOT, OUT)}, ${path.relative(ROOT, OUT_MOBILE)}, ${path.relative(ROOT, REPORT)}`);
