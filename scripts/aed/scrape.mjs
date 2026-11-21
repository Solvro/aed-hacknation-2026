#!/usr/bin/env node
// Etap 1: pobierz WSZYSTKIE źródła równolegle -> data/raw/<źródło>.json
//
//   node scripts/aed/scrape.mjs                 # wszystkie źródła
//   node scripts/aed/scrape.mjs krakow.pl       # tylko wybrane
//
// Różne hosty lecą równolegle; ten sam host jest ograniczany przez limiter w lib/http.mjs,
// więc szybkość nie odbywa się kosztem 429.
// Po każdym uruchomieniu odświeżany jest spis źródeł: AED_SOURCES.md (w katalogu głównym repo).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, ROOT, stats } from './lib/http.mjs';
import { GEOCODERS } from './lib/geocode.mjs';
import { PENDING, REJECTED } from './sources/rejected.mjs';
import * as openaedmap from './sources/openaedmap.mjs';
import * as daneGovPl from './sources/dane-gov-pl.mjs';
import * as warszawa from './sources/warszawa.mjs';
import * as krakow from './sources/krakow.mjs';
import { feeds } from './sources/feeds.mjs';
import { addressLists } from './sources/address-lists.mjs';

const SOURCES = [openaedmap, daneGovPl, warszawa, krakow, ...feeds, ...addressLists];
const RAW_DIR = path.join(DATA_DIR, 'raw');
const MANIFEST = path.join(RAW_DIR, '_manifest.json');
const SOURCES_MD = path.join(ROOT, 'AED_SOURCES.md');
await mkdir(RAW_DIR, { recursive: true });

const only = process.argv.slice(2);
const selected = only.length ? SOURCES.filter((s) => only.includes(s.name)) : SOURCES;
const t0 = Date.now();
console.log(`Pobieram równolegle: ${selected.map((s) => s.name).join(', ')}\n`);

const results = await Promise.allSettled(selected.map(async (src) => {
  const start = Date.now();
  const out = await src.run();
  const records = Array.isArray(out) ? out : out.records;
  await writeFile(path.join(RAW_DIR, `${src.name}.json`), JSON.stringify({ source: src.name, fetchedAt: new Date().toISOString(), count: records.length, records }));
  return {
    source: src.name, count: records.length, seconds: (Date.now() - start) / 1000,
    fetchedAt: new Date().toISOString(), skipped: out.skipped, subSources: out.subSources,
  };
}));

// Manifest: aktualizujemy tylko uruchomione źródła, resztę zostawiamy z poprzedniego przebiegu
const prev = await readFile(MANIFEST, 'utf8').then(JSON.parse).catch(() => ({ sources: [] }));
const bySource = new Map(prev.sources.map((s) => [s.source, s]));
results.forEach((r, i) => {
  const src = selected[i];
  bySource.set(src.name, {
    ...(r.status === 'fulfilled' ? r.value : { ...bySource.get(src.name), source: src.name, error: String(r.reason?.message ?? r.reason), errorAt: new Date().toISOString() }),
    meta: src.meta,
  });
});
const manifest = { at: new Date().toISOString(), http: stats, sources: SOURCES.map((s) => bySource.get(s.name)).filter(Boolean) };
await writeFile(MANIFEST, JSON.stringify(manifest, null, 2));
await writeFile(SOURCES_MD, renderSourcesMd(manifest));

console.log('\nŹródło                 rekordów    czas');
for (const r of results.map((r, i) => bySource.get(selected[i].name)))
  console.log(`${r.source.padEnd(22)} ${String(r.count ?? '—').padStart(8)} ${r.seconds ? `${r.seconds.toFixed(1)} s` : ''} ${r.error ? `BŁĄD: ${r.error}` : r.skipped ? `(pominięte: ${r.skipped})` : ''}`);
console.log(`\nRazem ${((Date.now() - t0) / 1000).toFixed(1)} s | HTTP: ${stats.requests} zapytań, ${stats.notModified}×304, ${stats.cacheHits}× cache, ${stats.retries} ponowień, ${(stats.bytes / 1e6).toFixed(1)} MB`);
console.log(`Spis źródeł → ${path.relative(ROOT, SOURCES_MD)}`);
if (results.some((r) => r.status === 'rejected')) process.exitCode = 1;

// ---------------------------------------------------------------- AED_SOURCES.md
function renderSourcesMd(m) {
  const day = (s) => (s ? s.slice(0, 10) : '—');
  const L = [];
  L.push('# Źródła danych AED', '');
  L.push('> Plik generowany automatycznie przez `pnpm aed:scrape` (scripts/aed/scrape.mjs) — nie edytuj ręcznie.');
  L.push('> Opisy źródeł: `meta` w `scripts/aed/sources/*.mjs`, odrzucone: `scripts/aed/sources/rejected.mjs`.', '');
  L.push(`Ostatnia aktualizacja: ${day(m.at)}`, '');

  L.push('## Używane źródła', '');
  m.sources.forEach((s, i) => {
    const meta = s.meta ?? {};
    const status = s.error ? `❌ błąd przy ostatnim pobraniu: ${s.error}` : s.skipped ? `⏸ pominięte: ${s.skipped}` : `✅ ${s.count} rekordów (pobrano ${day(s.fetchedAt)})`;
    L.push(`${i + 1}. **${meta.title ?? s.source}** — \`${s.source}\``);
    L.push(`   - Status: ${status}`);
    L.push(`   - Endpoint: ${meta.url ?? '—'}`);
    if (meta.fallbackUrl) L.push(`   - Fallback: ${meta.fallbackUrl}`);
    if (meta.docs) L.push(`   - Dokumentacja / strona: ${meta.docs}`);
    L.push(`   - Format: ${meta.format ?? '—'}`);
    L.push(`   - Współrzędne: ${meta.coords ?? '—'}`);
    L.push(`   - Licencja: ${meta.license ?? '—'}${meta.licenseUrl ? ` (${meta.licenseUrl})` : ''}`);
    L.push(`   - Atrybucja: ${meta.attribution ?? '—'}`);
    L.push(`   - Odświeżanie: ${meta.refresh ?? '—'}`);
    if (meta.requires) L.push(`   - Wymaga: ${meta.requires}`);
    for (const sub of s.subSources ?? []) {
      L.push(sub.skipped
        ? `   - ⏸ ${sub.title} — pominięte: ${sub.skipped}`
        : `   - ${sub.title} — ${sub.count} pkt, ${sub.format}, zmiana ${day(sub.modified)}: ${sub.url} (zbiór: ${sub.page})`);
    }
    L.push('');
  });

  L.push('## Geokodery (dla źródeł bez współrzędnych)', '');
  GEOCODERS.forEach((g, i) => {
    L.push(`${i + 1}. **${g.title}** — ${g.url}`);
    L.push(`   - Licencja: ${g.license}`);
    L.push(`   - Limit: ${g.limit}`);
    L.push('');
  });

  L.push('## Znalezione, jeszcze niepodpięte', '');
  PENDING.forEach((p, i) => L.push(`${i + 1}. **${p.title}** (${p.url}) — ${p.note}`));
  L.push('');

  L.push('## Sprawdzone i odrzucone', '');
  REJECTED.forEach((r, i) => L.push(`${i + 1}. **${r.title}** (${r.url}) — ${r.reason}`));
  L.push('');

  const attributions = [...new Set(m.sources.filter((s) => s.count).map((s) => s.meta?.attribution).filter(Boolean))];
  L.push('## Wymagana atrybucja w aplikacji', '');
  attributions.forEach((a) => L.push(`- ${a}`));
  L.push('');
  return L.join('\n');
}
