#!/usr/bin/env node
// Agregator lokalizacji AED w Polsce.
//
//   node scripts/fetch-aed.mjs            # pobierz + scal -> data/aed-pl.geojson
//   WARSAW_API_TOKEN=xxx node scripts/fetch-aed.mjs   # + oficjalne API Warszawy
//
// Źródła (wszystkie darmowe, legalne do ponownego użycia):
//   1. OpenAEDMap  /api/v1/countries/PL.geojson  — cała Polska z OSM, 1 zapytanie, cache Cloudflare (ODbL)
//   2. dane.gov.pl — zbiory gmin z AED, wykrywane dynamicznie przez API wyszukiwania
//   3. dane.um.warszawa.pl — API Stołecznego Centrum Bezpieczeństwa (wymaga darmowego tokenu, CC BY)
//
// Ochrona przed 429: 1 zapytanie naraz na host, odstęp między zapytaniami,
// retry z wykładniczym backoffem + jitter, respektowanie Retry-After,
// cache na dysku z ETag/If-None-Match (kolejne uruchomienia zwykle dostają 304).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'data');
const CACHE_DIR = path.join(OUT_DIR, '.cache');
const UA = 'aed-hacknation-2026/0.1 (+https://github.com/tomasz-trela/aed-hacknation-2026)';
const MIN_GAP_MS = 1500; // minimalny odstęp między zapytaniami do tego samego hosta
const MAX_RETRIES = 5;
const DEDUPE_RADIUS_M = 50;
const PL_BBOX = { latMin: 48.9, latMax: 55.0, lonMin: 14.0, lonMax: 24.3 };

// ---------------------------------------------------------------- polite fetch
const lastHit = new Map(); // host -> timestamp
const hostQueue = new Map(); // host -> promise (serializacja per host)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function politeFetch(url, init = {}, { cache = true } = {}) {
  const host = new URL(url).host;
  const prev = hostQueue.get(host) ?? Promise.resolve();
  const run = prev.then(() => doFetch(url, init, cache));
  hostQueue.set(host, run.catch(() => {}));
  return run;
}

async function doFetch(url, init, useCache) {
  const host = new URL(url).host;
  const key = createHash('sha1').update(url + (init.body ?? '')).digest('hex').slice(0, 16);
  const metaPath = path.join(CACHE_DIR, `${key}.meta.json`);
  const bodyPath = path.join(CACHE_DIR, `${key}.body`);
  const meta = useCache ? await readFile(metaPath, 'utf8').then(JSON.parse).catch(() => null) : null;

  for (let attempt = 0; ; attempt++) {
    const wait = (lastHit.get(host) ?? 0) + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastHit.set(host, Date.now());

    const headers = { 'User-Agent': UA, 'Accept-Encoding': 'gzip, br', ...init.headers };
    if (meta?.etag) headers['If-None-Match'] = meta.etag;
    if (meta?.lastModified) headers['If-Modified-Since'] = meta.lastModified;

    let res;
    try {
      res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(120_000) });
    } catch (err) {
      if (attempt >= MAX_RETRIES) throw err;
      await backoff(attempt, null, `${url} -> ${err.message}`);
      continue;
    }

    if (res.status === 304 && meta) {
      console.log(`  304 (cache) ${url}`);
      return readFile(bodyPath);
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= MAX_RETRIES) throw new Error(`${res.status} po ${attempt} próbach: ${url}`);
      await backoff(attempt, res.headers.get('retry-after'), `${url} -> ${res.status}`);
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${url}`);

    const buf = Buffer.from(await res.arrayBuffer());
    if (useCache) {
      await writeFile(bodyPath, buf);
      await writeFile(metaPath, JSON.stringify({
        url, etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified'), fetchedAt: new Date().toISOString(),
      }));
    }
    console.log(`  ${res.status} ${(buf.length / 1024).toFixed(0)} KB ${url}`);
    return buf;
  }
}

async function backoff(attempt, retryAfter, why) {
  let ms = Math.min(2 ** attempt * 2000, 60_000) + Math.random() * 1000;
  if (retryAfter) {
    const s = Number(retryAfter);
    ms = Number.isFinite(s) ? s * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now());
  }
  console.warn(`  ! ${why}; ponawiam za ${(ms / 1000).toFixed(1)} s`);
  await sleep(ms);
}

const getJson = async (url, init) => JSON.parse((await politeFetch(url, init)).toString('utf8'));

// ---------------------------------------------------------------- parsing utils
function decodeText(buf) {
  const utf8 = new TextDecoder('utf-8').decode(buf);
  const text = utf8.includes('�') ? new TextDecoder('windows-1250').decode(buf) : utf8;
  return text.replace(/^﻿/, '');
}

function parseCsv(text) {
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  // Niektóre gminy cytują całą linię ("a,b,""c""") -> 1 pole z przecinkami: parsujemy ponownie
  return rows
    .filter((r) => r.some((f) => f.trim()))
    .map((r) => (r.length === 1 && r[0].includes(delim) ? parseCsv(r[0])[0] : r))
    .map((r) => r.map((f) => f.trim()));
}

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const inPoland = (lat, lon) =>
  lat >= PL_BBOX.latMin && lat <= PL_BBOX.latMax && lon >= PL_BBOX.lonMin && lon <= PL_BBOX.lonMax;

/** Zwraca [lat, lon] albo null; naprawia zamienione kolumny (częsty błąd w danych gmin). */
function fixCoords(lat, lon) {
  if (lat == null || lon == null) return null;
  if (inPoland(lat, lon)) return [lat, lon];
  if (inPoland(lon, lat)) return [lon, lat];
  return null;
}

const pick = (obj, re) => {
  const k = Object.keys(obj).find((key) => re.test(key));
  return k ? String(obj[k] ?? '').trim() : '';
};

function rowsToPoints(rows) {
  const [header, ...data] = rows;
  const h = header.map((x) => x.toLowerCase());
  const latI = h.findIndex((x) => /szer|^lat|latitude|^y$/.test(x));
  const lonI = h.findIndex((x) => /d(ł|l)ug|^lon|^lng|longitude|^x$/.test(x));
  if (latI < 0 || lonI < 0) return [];
  return data.flatMap((r) => {
    const c = fixCoords(num(r[latI]), num(r[lonI]));
    if (!c) return [];
    const props = Object.fromEntries(header.map((k, i) => [k, r[i] ?? '']));
    return [{ lat: c[0], lon: c[1], props }];
  });
}

function geojsonToPoints(gj) {
  const feats = Array.isArray(gj) ? gj : gj.features ?? [];
  return feats.flatMap((f) => {
    let coords = f.geometry?.coordinates;
    if (Array.isArray(coords?.[0])) coords = coords[0]; // API Warszawy: [[lon, lat]]
    const c = fixCoords(num(coords?.[1]), num(coords?.[0]));
    return c ? [{ lat: c[0], lon: c[1], props: f.properties ?? {} }] : [];
  });
}

function bufferToPoints(buf, format) {
  const text = decodeText(buf);
  const t = text.trimStart();
  if (t.startsWith('{') || t.startsWith('[')) return geojsonToPoints(JSON.parse(t));
  if (format === 'csv' || !t.startsWith('<')) return rowsToPoints(parseCsv(text));
  return []; // XML/GML pomijamy — te same zbiory są zwykle dostępne też jako CSV/GeoJSON
}

// ---------------------------------------------------------------- sources
async function fetchOpenAEDMap() {
  console.log('\n[1] OpenAEDMap (OSM)');
  const gj = await getJson('https://openaedmap.org/api/v1/countries/PL.geojson');
  return gj.features.map((f) => {
    const p = f.properties;
    return {
      id: `osm:${p['@osm_type']}/${p['@osm_id']}`,
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
      name: p.name ?? p.description ?? p.operator ?? '',
      location: p['defibrillator:location:pl'] ?? p['defibrillator:location'] ?? '',
      access: p.access ?? '',
      indoor: p.indoor ?? '',
      opening_hours: p.opening_hours ?? '',
      phone: p.phone ?? '',
      address: [p['addr:street'], p['addr:housenumber'], p['addr:city']].filter(Boolean).join(' '),
      sources: ['openaedmap'],
      license: 'ODbL (c) OpenStreetMap contributors',
      raw: p,
    };
  });
}

async function fetchDaneGovPl() {
  console.log('\n[2] dane.gov.pl');
  const datasets = new Map(); // datasetId -> tytuł
  const looseResources = new Map(); // resourceId -> { datasetId, title } (zasoby w zbiorczych datasetach, np. "Zdrowie")
  for (const q of ['defibrylator', 'defibrylatory', 'AED']) {
    const res = await getJson(`https://api.dane.gov.pl/1.4/search?q=${encodeURIComponent(q)}&per_page=100`);
    for (const d of res.data ?? []) {
      const title = d.attributes?.title?.replace(/<[^>]+>/g, '') ?? '';
      if (!/defibryl|AED/i.test(title)) continue;
      if (d.attributes?.model === 'dataset') datasets.set(d.id, title);
      else if (d.attributes?.model === 'resource')
        looseResources.set(d.id, { datasetId: d.relationships?.dataset?.data?.id, title });
    }
  }
  const out = [];
  const pref = ['geojson', 'csv', 'json', 'xlsx'];
  const toRes = (r) => ({ format: (r.attributes.format ?? '').toLowerCase(), url: r.attributes.file_url || r.attributes.link, modified: r.attributes.modified });
  const jobs = [];
  for (const [datasetId, title] of datasets) {
    const { data: resources = [] } = await getJson(`https://api.dane.gov.pl/1.4/datasets/${datasetId}/resources`);
    jobs.push({ datasetId, title, candidates: resources.map(toRes) });
  }
  for (const [resourceId, { datasetId, title }] of looseResources) {
    if (datasets.has(datasetId)) continue;
    const { data } = await getJson(`https://api.dane.gov.pl/1.4/resources/${resourceId}`);
    jobs.push({ datasetId: `${datasetId}/${resourceId}`, title, candidates: [toRes(data)] });
  }
  for (const { datasetId, title, candidates } of jobs) {
    const best = candidates
      .filter((r) => r.url && pref.includes(r.format))
      .sort((a, b) => pref.indexOf(a.format) - pref.indexOf(b.format) || String(b.modified).localeCompare(String(a.modified)))[0];
    if (!best || best.format === 'xlsx') {
      console.log(`  - pomijam "${title}" (brak CSV/GeoJSON/JSON)`);
      continue;
    }
    try {
      const pts = bufferToPoints(await politeFetch(best.url), best.format);
      console.log(`  + ${pts.length} pkt — ${title}`);
      pts.forEach((p, i) => out.push({
        id: `danegov:${datasetId}:${i}`,
        lat: p.lat, lon: p.lon,
        name: pick(p.props, /nazwa|name|obiekt/i),
        location: pick(p.props, /lokalizacja|location|opis|description/i),
        address: pick(p.props, /adres|address/i) ||
          [pick(p.props, /nazwa_ulicy|ulica|street/i), pick(p.props, /nr_budynku|numer|building/i), pick(p.props, /miejscowo|city/i)].filter(Boolean).join(' '),
        sources: [`dane.gov.pl:${datasetId}`],
        license: 'dane publiczne (dane.gov.pl) — sprawdź warunki zbioru',
        raw: p.props,
      }));
    } catch (err) {
      console.warn(`  ! "${title}": ${err.message}`);
    }
  }
  return out;
}

async function fetchWarsaw() {
  const token = process.env.WARSAW_API_TOKEN;
  console.log('\n[3] API m.st. Warszawy');
  if (!token) {
    console.log('  - pomijam: ustaw WARSAW_API_TOKEN (darmowy klucz: https://dane.um.warszawa.pl/key-api)');
    return [];
  }
  const buf = await politeFetch(
    'https://dane.um.warszawa.pl/api/action/get_scb_lokalizacja_defibrylatorow',
    { method: 'POST', headers: { Authorization: token, 'Content-Type': 'application/json' }, body: '{}' },
  );
  const json = JSON.parse(decodeText(buf));
  const pts = geojsonToPoints(json.result ?? json);
  console.log(`  + ${pts.length} pkt`);
  return pts.map((p) => ({
    id: `waw:${p.props.defibrillator_id}`,
    lat: p.lat, lon: p.lon,
    name: p.props.location_object_name ?? '',
    location: [p.props.device_location, p.props.location_description].filter(Boolean).join(' — '),
    access: p.props.device_public_access ?? '',
    opening_hours: p.props.device_access_description ?? '',
    address: [p.props.location_street, p.props.location_building, p.props.location_postcode, p.props.location_city].filter(Boolean).join(' '),
    sources: ['um.warszawa.pl'],
    license: 'CC BY — Stołeczne Centrum Bezpieczeństwa',
    raw: p.props,
  }));
}

// ---------------------------------------------------------------- merge
function haversine(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function merge(base, extra) {
  const cell = (p) => `${Math.floor(p.lat / 0.001)}:${Math.floor(p.lon / 0.0015)}`; // ~110 m siatka
  const grid = new Map();
  const add = (p) => {
    const k = cell(p);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  };
  const all = [...base];
  all.forEach(add);
  let added = 0, matched = 0;
  for (const p of extra) {
    const [cy, cx] = cell(p).split(':').map(Number);
    let hit = null;
    for (let dy = -1; dy <= 1 && !hit; dy++)
      for (let dx = -1; dx <= 1 && !hit; dx++)
        hit = (grid.get(`${cy + dy}:${cx + dx}`) ?? []).find((q) => haversine(p, q) < DEDUPE_RADIUS_M);
    if (hit) {
      matched++;
      hit.sources = [...new Set([...hit.sources, ...p.sources])];
      for (const k of ['name', 'location', 'address', 'opening_hours', 'access']) if (!hit[k] && p[k]) hit[k] = p[k];
    } else {
      added++;
      all.push(p);
      add(p);
    }
  }
  return { all, added, matched };
}

// ---------------------------------------------------------------- main
await mkdir(CACHE_DIR, { recursive: true });

const osm = await fetchOpenAEDMap();
let { all } = { all: osm };
const stats = { generatedAt: new Date().toISOString(), openaedmap: osm.length, sources: {} };

for (const [name, fn] of [['dane.gov.pl', fetchDaneGovPl], ['um.warszawa.pl', fetchWarsaw]]) {
  try {
    const pts = await fn();
    const r = merge(all, pts);
    all = r.all;
    stats.sources[name] = { fetched: pts.length, matchedExisting: r.matched, addedNew: r.added };
  } catch (err) {
    console.warn(`  ! źródło ${name} nie powiodło się: ${err.message}`);
    stats.sources[name] = { error: err.message };
  }
}
stats.total = all.length;

const fc = {
  type: 'FeatureCollection',
  attribution: 'Dane OSM: (c) OpenStreetMap contributors, ODbL. Dane gmin: dane.gov.pl. Warszawa: Stołeczne Centrum Bezpieczeństwa (CC BY).',
  features: all.map(({ lat, lon, raw, ...props }) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { ...props, raw },
  })),
};
await writeFile(path.join(OUT_DIR, 'aed-pl.geojson'), JSON.stringify(fc));
await writeFile(path.join(OUT_DIR, 'aed-pl.stats.json'), JSON.stringify(stats, null, 2));
console.log('\nGotowe:', JSON.stringify(stats, null, 2));
