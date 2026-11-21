// Kraków — program "Krakowski IMPULS ŻYCIA AED": tabela HTML (paginowana od 0) + strony szczegółów.
// Brak współrzędnych -> geokodowanie adresów przez GUGiK UUG.

import { fetchText, mapLimit } from '../lib/http.mjs';
import { geocode } from '../lib/geocode.mjs';
import { stripHtml } from '../lib/parse.mjs';

export const name = 'krakow.pl';
export const meta = {
  title: 'Kraków — program „Krakowski IMPULS ŻYCIA AED”',
  url: 'https://krakow.pl/instcbi/3992/2432/{0..N}',
  docs: 'https://krakow.pl/3992,artykul,gdzie-znalezc-defibrylator-.html',
  format: 'HTML (tabela paginowana od 0 + strony szczegółów)',
  coords: 'BRAK — geokodowane z adresu (GUGiK UUG, fallback Nominatim)',
  license: 'informacja publiczna (Urząd Miasta Krakowa)',
  attribution: 'Urząd Miasta Krakowa',
  refresh: 'ręcznie przez UMK (stan podawany na stronie)',
};
const BASE = 'https://krakow.pl';
const DAY = 24 * 3600 * 1000;

function parseList(html) {
  return [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].flatMap(([, row]) => {
    const link = row.match(/<a href="(\/instcbi\/3992\/inst\/(\d+)\/[^"]+)">([\s\S]*?)<\/a>/);
    if (!link) return [];
    return [{
      id: link[2],
      url: BASE + link[1],
      name: stripHtml(link[3]),
      address: stripHtml(row.match(/<p>([\s\S]*?)<\/p>/)?.[1] ?? ''),
      category: stripHtml(row.match(/__category">([\s\S]*?)<\/td>/)?.[1] ?? ''),
    }];
  });
}

function parseDetail(html) {
  const t = stripHtml(html);
  const count = t.match(/Liczba AED:\s*(\d+)/)?.[1];
  const description = t.match(/Liczba AED:\s*\d+\s*(.*?)\s*pokaż metkę/)?.[1] ?? '';
  const address = t.match(/Adres:\s*(.*?)\s*(?:Opis\b|Liczba AED)/)?.[1] ?? '';
  return { count: count ? Number(count) : null, description, address };
}

export async function run() {
  // 1. Wszystkie strony listy — najpierw pierwsza, żeby poznać liczbę stron, potem reszta równolegle
  const first = await fetchText(`${BASE}/instcbi/3992/2432/0`, {}, { ttlMs: DAY });
  const lastPage = Math.max(0, ...[...first.matchAll(/instcbi\/3992\/2432\/(\d+)\//g)].map((m) => Number(m[1])));
  const pages = [first, ...(await mapLimit(
    Array.from({ length: lastPage }, (_, i) => i + 1),
    4,
    (p) => fetchText(`${BASE}/instcbi/3992/2432/${p}`, {}, { ttlMs: DAY }),
  ))];
  const items = [...new Map(pages.flatMap(parseList).map((x) => [x.id, x])).values()]
    .filter((x) => /AED|defibryl/i.test(x.category || 'AED'));
  console.log(`  + [krakow] ${items.length} pozycji na ${pages.length} stronach — pobieram szczegóły i geokoduję`);

  // 2. Szczegóły + geokodowanie równolegle (limiter per host pilnuje tempa)
  const records = await mapLimit(items, 8, async (it) => {
    const detail = parseDetail(await fetchText(it.url, {}, { ttlMs: DAY, quiet: true }).catch(() => ''));
    const address = detail.address || it.address;
    const geo = await geocode(address, 'Kraków');
    if (geo?.skip) {
      console.log(`  - [krakow] pominięto (override): "${address}" — ${geo.skip}`);
      return null;
    }
    if (!geo) {
      console.warn(`  ! [krakow] nie zgeokodowano: "${address}" (${it.name})`);
      return null;
    }
    return {
      source: name,
      sourceId: it.id,
      lat: geo.lat,
      lon: geo.lon,
      name: it.name,
      location: detail.description,
      address,
      city: 'Kraków',
      count: detail.count,
      url: it.url,
      geocode: { provider: geo.provider, accuracy: geo.accuracy, matched: geo.matched, query: geo.variant },
      license: 'Urząd Miasta Krakowa — informacja publiczna',
      raw: { ...it, ...detail },
    };
  });
  return records.filter(Boolean);
}
