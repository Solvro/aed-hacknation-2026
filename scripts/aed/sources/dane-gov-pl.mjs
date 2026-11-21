// dane.gov.pl — zbiory gmin wykrywane dynamicznie przez API wyszukiwania.
// Nowa gmina, która opublikuje AED, zostanie złapana automatycznie.

import { fetchJson, politeFetch } from '../lib/http.mjs';
import { bufferToPoints, pick } from '../lib/parse.mjs';

export const name = 'dane.gov.pl';
export const meta = {
  title: 'Portal otwartych danych dane.gov.pl — zbiory gmin',
  url: 'https://api.dane.gov.pl/1.4/search?q=<fraza>',
  format: 'CSV / GeoJSON / JSON (wybierany najlepszy dostępny format zbioru)',
  coords: 'natywne (naprawiane zamienione lat/lon)',
  license: 'zgodnie z warunkami każdego zbioru (zwykle bez ograniczeń)',
  attribution: 'dane.gov.pl + nazwa gminy',
  refresh: 'zależnie od gminy; wykrywanie nowych zbiorów przy każdym uruchomieniu',
};
const API = 'https://api.dane.gov.pl/1.4';
const QUERIES = ['defibrylator', 'defibrylatory', 'defibrylatorów', 'AED', 'automatyczny defibrylator'];
const PREF = ['geojson', 'csv', 'json'];
// Zasoby, które linkują do źródeł obsługiwanych osobno (np. API Warszawy)
const SKIP_HOSTS = ['dane.um.warszawa.pl'];

const clean = (s) => String(s ?? '').replace(/<[^>]+>/g, '').trim();
const toRes = (r) => ({
  id: r.id,
  format: (r.attributes.format ?? '').toLowerCase(),
  url: r.attributes.file_url || r.attributes.link,
  modified: r.attributes.modified,
});

export async function run() {
  const datasets = new Map();
  const loose = new Map();
  const searches = await Promise.all(QUERIES.map((q) => fetchJson(`${API}/search?q=${encodeURIComponent(q)}&per_page=100`)));
  for (const res of searches)
    for (const d of res.data ?? []) {
      const title = clean(d.attributes?.title);
      if (!/defibryl|\bAED\b/i.test(title)) continue;
      if (d.attributes?.model === 'dataset') datasets.set(d.id, title);
      else if (d.attributes?.model === 'resource') loose.set(d.id, { datasetId: d.relationships?.dataset?.data?.id, title });
    }

  const jobs = await Promise.all([
    ...[...datasets].map(async ([datasetId, title]) => {
      const { data = [] } = await fetchJson(`${API}/datasets/${datasetId}/resources`);
      return { key: datasetId, title, candidates: data.map(toRes) };
    }),
    ...[...loose]
      .filter(([, { datasetId }]) => !datasets.has(datasetId))
      .map(async ([resourceId, { datasetId, title }]) => {
        const { data } = await fetchJson(`${API}/resources/${resourceId}`);
        return { key: `${datasetId}/${resourceId}`, title, candidates: [toRes(data)] };
      }),
  ]);

  const subSources = [];
  const perJob = await Promise.all(jobs.map(async ({ key, title, candidates }) => {
    const best = candidates
      .filter((r) => r.url && PREF.includes(r.format) && !SKIP_HOSTS.includes(new URL(r.url).host))
      .sort((a, b) => PREF.indexOf(a.format) - PREF.indexOf(b.format) || String(b.modified).localeCompare(String(a.modified)))[0];
    if (!best) {
      console.log(`  - [dane.gov.pl] pomijam "${title}" (brak CSV/GeoJSON/JSON albo źródło obsługiwane osobno)`);
      subSources.push({ title, id: key, skipped: 'brak CSV/GeoJSON/JSON albo źródło obsługiwane osobno' });
      return [];
    }
    try {
      const pts = bufferToPoints(await politeFetch(best.url), best.format);
      console.log(`  + [dane.gov.pl] ${String(pts.length).padStart(3)} pkt — ${title}`);
      subSources.push({ title, id: key, page: `https://dane.gov.pl/pl/dataset/${String(key).split('/')[0]}`, url: best.url, format: best.format, modified: best.modified, count: pts.length });
      return pts.map((p, i) => {
        const location = pick(p.props, /opis|description|lokalizacja/i);
        let objName = pick(p.props, /^nazwa$|^name$|obiekt/i);
        // Część gmin wpisuje w "Nazwa" po prostu "Defibrylator" — prawdziwa nazwa jest w "Lokalizacja"
        if (!objName || /^(defibrylator|aed)(\s+aed)?$/i.test(objName)) objName = pick(p.props, /lokalizacja/i) || objName;
        return {
        source: name,
        sourceId: `${key}:${i}`,
        dataset: title,
        lat: p.lat,
        lon: p.lon,
        name: objName,
        location: location === objName ? '' : location,
        address: pick(p.props, /adres|address/i) ||
          [pick(p.props, /nazwa_ulicy|^ulica|street/i), pick(p.props, /nr_budynku|building/i)].filter(Boolean).join(' '),
        city: pick(p.props, /miejscowo|city|miasto/i),
        license: `dane.gov.pl — ${title}`,
        raw: p.props,
      };
      });
    } catch (err) {
      console.warn(`  ! [dane.gov.pl] "${title}": ${err.message}`);
      return [];
    }
  }));
  return { records: perJob.flat(), subSources: subSources.sort((a, b) => a.title.localeCompare(b.title, 'pl')) };
}
