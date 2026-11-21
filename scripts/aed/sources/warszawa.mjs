// Oficjalne API m.st. Warszawy (Stołeczne Centrum Bezpieczeństwa), aktualizacja codzienna.
// Wymaga darmowego tokenu: https://dane.um.warszawa.pl/key-api -> WARSAW_API_TOKEN

import { politeFetch } from '../lib/http.mjs';
import { decodeText, geojsonToPoints } from '../lib/parse.mjs';

export const name = 'um.warszawa.pl';
export const license = 'CC BY — Stołeczne Centrum Bezpieczeństwa m.st. Warszawy';
export const meta = {
  title: 'API m.st. Warszawy — Lokalizacja defibrylatorów (AED)',
  url: 'https://dane.um.warszawa.pl/api/action/get_scb_lokalizacja_defibrylatorow',
  docs: 'https://dane.um.warszawa.pl/pl/catalogue/7bc32ffc-c2ac-4d32-83c9-b6f7a0b38de8',
  format: 'JSON (POST, nagłówek Authorization: <token>)',
  coords: 'natywne WGS84 ([[lon, lat]])',
  license,
  attribution: 'Urząd m.st. Warszawy / Stołeczne Centrum Bezpieczeństwa',
  refresh: 'codziennie',
  requires: 'WARSAW_API_TOKEN (darmowy: https://dane.um.warszawa.pl/key-api)',
};

export async function run() {
  const token = process.env.WARSAW_API_TOKEN;
  if (!token) {
    console.log('  - [warszawa] pomijam: brak WARSAW_API_TOKEN (darmowy klucz: https://dane.um.warszawa.pl/key-api)');
    return { skipped: 'brak WARSAW_API_TOKEN', records: [] };
  }
  const buf = await politeFetch('https://dane.um.warszawa.pl/api/action/get_scb_lokalizacja_defibrylatorow', {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const json = JSON.parse(decodeText(buf));
  return geojsonToPoints(json.result ?? json).map((p) => ({
    source: name,
    sourceId: String(p.props.defibrillator_id),
    lat: p.lat,
    lon: p.lon,
    name: p.props.location_object_name ?? '',
    location: [p.props.device_location, p.props.location_description].filter(Boolean).join(' — '),
    address: [p.props.location_street, p.props.location_building].filter(Boolean).join(' '),
    postcode: p.props.location_postcode ?? '',
    city: p.props.location_city ?? 'Warszawa',
    access: p.props.device_public_access ?? '',
    availability: p.props.device_availability ?? '',
    opening_hours: p.props.device_access_description ?? '',
    manufacturer: p.props.device_manufacturer ?? '',
    license,
    raw: p.props,
  }));
}
