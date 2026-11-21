// OpenAEDMap — cała Polska z OSM jednym zapytaniem (cache Cloudflare, odświeżany co godzinę).
// Fallback: Overpass API (bywa przeciążony — limiter + backoff to obsługują).

import { fetchJson } from '../lib/http.mjs';

export const name = 'openaedmap';
export const license = 'ODbL — © OpenStreetMap contributors';
export const meta = {
  title: 'OpenAEDMap (OpenStreetMap Polska)',
  url: 'https://openaedmap.org/api/v1/countries/PL.geojson',
  fallbackUrl: 'https://overpass-api.de/api/interpreter',
  format: 'GeoJSON',
  coords: 'natywne WGS84',
  license,
  attribution: '© OpenStreetMap contributors',
  licenseUrl: 'https://www.openstreetmap.org/copyright',
  refresh: 'co godzinę (cache Cloudflare); OSM aktualizowany na bieżąco',
};

const fromTags = (id, lat, lon, t) => ({
  source: name,
  sourceId: id,
  lat,
  lon,
  name: t.name ?? t.description ?? '',
  operator: t.operator ?? '',
  location: t['defibrillator:location:pl'] ?? t['defibrillator:location'] ?? t['defibrillator:location:en'] ?? '',
  address: [t['addr:street'] ?? t['addr:place'], t['addr:housenumber']].filter(Boolean).join(' '),
  city: t['addr:city'] ?? '',
  access: t.access ?? '',
  indoor: t.indoor ?? '',
  opening_hours: t.opening_hours ?? '',
  phone: t.phone ?? t['emergency:phone'] ?? '',
  level: t.level ?? '',
  image: t.image ?? '',
  checkDate: t.check_date ?? '',
  license,
  raw: t,
});

export async function run() {
  try {
    const gj = await fetchJson('https://openaedmap.org/api/v1/countries/PL.geojson');
    return gj.features.map((f) => {
      const { '@osm_type': type, '@osm_id': id, '@osm_version': _v, ...tags } = f.properties;
      return fromTags(`${type}/${id}`, f.geometry.coordinates[1], f.geometry.coordinates[0], tags);
    });
  } catch (err) {
    console.warn(`  ! OpenAEDMap niedostępny (${err.message}) — fallback na Overpass`);
    const q = '[out:json][timeout:180];area["ISO3166-1"="PL"][admin_level=2]->.pl;nwr["emergency"="defibrillator"](area.pl);out center tags;';
    const res = await fetchJson('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(q)}`,
    });
    return res.elements.map((e) => fromTags(`${e.type}/${e.id}`, e.lat ?? e.center.lat, e.lon ?? e.center.lon, e.tags ?? {}));
  }
}
