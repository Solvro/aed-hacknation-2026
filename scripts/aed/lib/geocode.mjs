// Geokodowanie adresów przez GUGiK UUG (państwowy rejestr adresów PRG, darmowy, bez klucza).
// Wyniki są cache'owane na 30 dni, więc kolejne uruchomienia nie wysyłają zapytań.
// Próbujemy kilku wariantów adresu, od najdokładniejszego; wynik niesie `accuracy` i `variant`,
// żeby etap scalania mógł ocenić wiarygodność.

import { readFileSync } from 'node:fs';
import { fetchJson } from './http.mjs';

const TTL = 30 * 24 * 3600 * 1000;

export const GEOCODERS = [
  {
    title: 'GUGiK UUG — Usługa Lokalizacji Adresów (PRG)',
    url: 'https://services.gugik.gov.pl/uug/',
    license: 'dane publiczne GUGiK (państwowy rejestr granic i adresów)',
    limit: 'brak opublikowanego; używamy 2 zapytań naraz co 150 ms + cache 30 dni',
  },
  {
    title: 'Nominatim (OpenStreetMap) — fallback',
    url: 'https://nominatim.openstreetmap.org/',
    license: 'ODbL — © OpenStreetMap contributors',
    limit: 'max 1 zapytanie/s wg polityki; używamy 1 co 1,1 s + cache 30 dni',
  },
];
const PREFIX = /^(ul\.?|ulica|al\.?|aleja|aleje|os\.?|osiedle)\s+/i;
const HONORIFIC = /^(ks\.?|księdza|gen\.?|generała|św\.?|świętego|świętej|prof\.?|profesora|kard\.?|kardynała|abp\.?|marsz\.?|marszałka)\s+/i;

/** "ul. Totus Tuus 34, 30-610 Kraków" -> { city: "Kraków", street: "Totus Tuus", number: "34" } */
export function splitAddress(address, cityHint = '') {
  let a = address
    .replace(/\b(ul|al|pl|os)\.(?=\S)/gi, '$1. ') // "ul.3-go Maja" -> "ul. 3-go Maja"
    .replace(/(\p{Ll})(\d)/gu, '$1 $2') // "Wyszyńskiego1/5" -> "Wyszyńskiego 1/5"
    .replace(/\s+/g, ' ')
    .replace(/\s+Opis$/i, '')
    .trim();
  let city = cityHint;
  const postcode = a.match(/\b\d{2}-\d{3}\b/)?.[0] ?? '';
  if (postcode) {
    const after = a.slice(a.indexOf(postcode) + postcode.length).replace(/^[\s,]+/, '').trim();
    if (after) city = after;
    a = a.slice(0, a.indexOf(postcode));
  } else if (cityHint && a.toLowerCase().endsWith(cityHint.toLowerCase())) {
    a = a.slice(0, -cityHint.length);
  }
  a = a.replace(/[\s,;]+$/, '').trim();
  const m = a.match(/^(.*?)[\s,]+(\d+[a-zA-Z]?(?:\s*[-/]\s*\d+[a-zA-Z]?)?)$/);
  return { city, street: (m ? m[1] : a).trim(), number: m ? m[2].replace(/\s/g, '') : '', postcode };
}

function variants({ city, street, number }) {
  const s0 = street.replace(PREFIX, '');
  const s1 = s0.replace(HONORIFIC, '');
  const lastWord = s1.split(' ').at(-1);
  const n0 = number;
  const n1 = number.split(/[-/]/)[0]; // "3-4" -> "3", "12/14" -> "12"
  const out = [];
  for (const s of [s0, s1, lastWord]) for (const n of [n0, n1]) if (s && n) out.push(`${city}, ${s} ${n}`);
  return [...new Set(out)];
}

async function uug(q) {
  const url = `https://services.gugik.gov.pl/uug/?request=GetAddress&srid=4326&address=${encodeURIComponent(q)}`;
  const res = await fetchJson(url, {}, { ttlMs: TTL, quiet: true }).catch(() => null);
  const r = res?.results?.['1'];
  if (!r?.x || !r?.y) return null;
  return {
    lat: Number(r.y),
    lon: Number(r.x),
    accuracy: Number(r.accuracy),
    teryt: r.teryt,
    matched: [r.city, r.street, r.number].filter(Boolean).join(' '),
  };
}

/** Ostatnia deska ratunku: Nominatim (OSM). Polityka: max 1 zapytanie/s, UA, cache — pilnuje tego limiter. */
async function nominatim(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=pl&limit=1&q=${encodeURIComponent(q)}`;
  const res = await fetchJson(url, { headers: { 'Accept-Language': 'pl' } }, { ttlMs: TTL, quiet: true }).catch(() => null);
  const r = res?.[0];
  if (!r) return null;
  // Nominatim nie daje "accuracy" w skali UUG; adres budynku ~0.8, ulica/plac ~0.5
  const accuracy = ['house', 'building'].includes(r.addresstype) || r.category === 'building' ? 0.8 : 0.5;
  return { lat: Number(r.lat), lon: Number(r.lon), accuracy, matched: r.display_name, provider: 'nominatim' };
}

// Ręczne poprawki: scripts/aed/geocode-overrides.json
const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const OVERRIDES = new Map(
  JSON.parse(readFileSync(new URL('../geocode-overrides.json', import.meta.url), 'utf8'))
    .overrides.map((o) => [`${norm(o.city)}|${norm(o.address)}`, o]),
);

/**
 * @returns {Promise<{lat, lon, accuracy, matched, variant, provider} | {skip: string} | null>}
 *   `skip` — ręcznie oznaczone do pominięcia (np. AED w pojeździe).
 */
export async function geocode(address, cityHint = '') {
  const o = OVERRIDES.get(`${norm(cityHint)}|${norm(address)}`);
  if (o?.skip) return { skip: o.skip };
  if (o) return { lat: o.lat, lon: o.lon, accuracy: o.accuracy ?? 1, matched: o.note ?? '', variant: address, provider: 'override' };

  const parts = splitAddress(address, cityHint);
  for (const q of variants(parts)) {
    const hit = await uug(q);
    if (hit) return { ...hit, variant: q, provider: 'gugik-uug' };
  }
  // Nominatim: pełny tekst, potem sama ulica (np. "Pływalnia Kryta ul. Chałubińskiego" -> "Chałubińskiego"),
  // potem pierwsza ulica skrzyżowania ("Kołobrzeska/ Chłopska" -> "Kołobrzeska").
  const street = parts.street.replace(PREFIX, '');
  const afterUl = street.match(/\b(?:ul\.|al\.|ulica|aleja)\s*(.+)$/i)?.[1];
  const firstOfCrossing = street.split('/')[0].replace(/^skrzyżowanie\s+/i, '').trim();
  const qs = [
    [street, parts.number, parts.postcode, parts.city],
    [afterUl, parts.number, parts.city],
    [firstOfCrossing !== street ? firstOfCrossing : null, parts.city],
  ].filter((q) => q[0]).map((q) => q.filter(Boolean).join(' '));
  for (const q of [...new Set(qs)]) {
    const hit = await nominatim(q);
    // fallback do ulicy / skrzyżowania = niska dokładność, niezależnie od typu obiektu
    if (hit) return { ...hit, accuracy: q === qs[0] ? hit.accuracy : 0.4, variant: q };
  }
  return null;
}
