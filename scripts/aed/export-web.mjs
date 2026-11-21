#!/usr/bin/env node
// Etap 3: kompaktowy eksport dla strony z mapą -> public/data/aed.json (+ aed-mobile.json)
// Pełny GeoJSON (~11 MB) jest za ciężki dla przeglądarki; tu zostają tylko pola potrzebne mapie,
// zapisane jako tablice (bez powtarzania nazw kluczy).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT_DIR = path.join(ROOT, 'public', 'data');
await mkdir(OUT_DIR, { recursive: true });

const SOURCE_LABELS = {
  openaedmap: 'OpenStreetMap',
  'dane.gov.pl': 'dane.gov.pl',
  'um.warszawa.pl': 'UM Warszawa',
  'krakow.pl': 'UM Kraków',
  lodz: 'UM Łódź',
  gdansk: 'UM Gdańsk',
  torun: 'UM Toruń',
  lublin: 'UM Lublin',
  olsztyn: 'UM Olsztyn',
  koszalin: 'UM Koszalin',
  'gliwice-gama': 'UM Gliwice',
  sopot: 'UM Sopot',
  chelm: 'UM Chełm',
  'us-edu': 'Uniwersytet Śląski',
  'inpost-aed': 'InPost',
  'umap-jelenia-gora': 'uMap Jelenia Góra',
  'umap-wejherowo': 'uMap Wejherowo',
  'arcgis-mikolow': 'ArcGIS Mikołów',
  'arcgis-krakow-2022': 'ArcGIS Kraków (2022)',
};

/**
 * Dostępność w sytuacji nagłej:
 *  0 = całą dobę (24/7, dostęp nie jest prywatny)
 *  1 = publiczny / dla klientów, w godzinach otwarcia albo godziny nieznane
 *  2 = ograniczony (prywatny, na zezwolenie, brak dostępu)
 */
function availability(p) {
  if (['private', 'permit', 'no'].includes(p.access)) return 2;
  if (/^24\/7$/.test(p.opening_hours?.trim() ?? '')) return 0;
  return 1;
}

/** 0 = współrzędne natywne, 1 = geokod do budynku, 2 = przybliżone (ulica/plac/ręczne) */
function quality(q) {
  if (q === 'native') return 0;
  const acc = Number(q.split(':').at(-1));
  return acc >= 0.9 ? 1 : 2;
}

const round = (n) => Math.round(n * 1e6) / 1e6;

const fc = JSON.parse(await readFile(path.join(ROOT, 'data', 'aed-pl.geojson'), 'utf8'));
const FIELDS = ['lon', 'lat', 'id', 'name', 'location', 'address', 'city', 'hours', 'indoor', 'avail', 'quality', 'sources', 'level', 'phone'];
const items = fc.features.map(({ geometry: { coordinates: [lon, lat] }, properties: p }) => [
  round(lon),
  round(lat),
  p.id,
  p.name || p.operator || '',
  p.location || '',
  p.address || '',
  p.city || '',
  p.opening_hours || '',
  p.indoor === 'yes' ? 1 : p.indoor === 'no' ? 0 : -1,
  availability(p),
  quality(p.coordsQuality),
  [...new Set(p.sources.map((s) => SOURCE_LABELS[s.source] ?? s.source))].join('|'),
  p.level || '',
  p.phone || '',
]);

const out = { generatedAt: new Date().toISOString(), count: items.length, fields: FIELDS, items };
await writeFile(path.join(OUT_DIR, 'aed.json'), JSON.stringify(out));

const mob = JSON.parse(await readFile(path.join(ROOT, 'data', 'aed-pl-mobile.geojson'), 'utf8'));
const mobItems = mob.features.map(({ geometry: { coordinates: [lon, lat] }, properties: p }) => [
  round(lon), round(lat), p.id, p.name || p.operator || '', p.location || '', p.city || '',
]);
await writeFile(path.join(OUT_DIR, 'aed-mobile.json'), JSON.stringify({
  generatedAt: out.generatedAt, count: mobItems.length, fields: ['lon', 'lat', 'id', 'name', 'location', 'city'], items: mobItems,
}));

const kb = (s) => `${(Buffer.byteLength(JSON.stringify(s)) / 1024).toFixed(0)} KB`;
console.log(`public/data/aed.json: ${items.length} AED (${kb(out)})`);
console.log(`public/data/aed-mobile.json: ${mobItems.length} AED mobilnych (${kb(mobItems)})`);
