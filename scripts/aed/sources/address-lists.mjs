// Miejskie listy HTML z samymi adresami -> geokodowanie (GUGiK UUG, fallback Nominatim).

import { fetchText, invalidate, mapLimit, politeFetch } from '../lib/http.mjs';
import { geocode } from '../lib/geocode.mjs';
import { stripHtml } from '../lib/parse.mjs';
import { pdfToLines } from '../lib/pdf.mjs';

const NO_LICENSE = 'brak deklaracji licencji — informacja publiczna urzędu (do potwierdzenia przed publikacją)';
const DAY = 24 * 3600 * 1000;

/** "Nazwa obiektu, ul. Ulica 12" -> { name, address } (adres = od pierwszego członu z ul./al./pl.) */
function splitNameAddr(s) {
  const t = s.replace(/[\s,.;]+$/, '').trim();
  const m = t.match(/^(.*?)(?:,\s*|\s+przy\s+|:\s*|\s+)\(?((?:ul\.|al\.|pl\.|plac|aleja|aleje|os\.|osiedle|ulica)\s.*)$/i);
  if (m) {
    const addrFull = m[2];
    const cut = addrFull.search(/\)|:|\s[-–]\s|\s\(/);
    const address = (cut >= 0 ? addrFull.slice(0, cut) : addrFull).replace(/[\s,.;]+$/, '').trim();
    const extra = cut >= 0 ? addrFull.slice(cut).replace(/^[)\s:–-]+/, '').replace(/[()]/g, '').trim() : '';
    const paren = m[1].match(/\(([^)]*)\)/)?.[1] ?? '';
    return { name: m[1].replace(/\s*\([^)]*\)?\s*/g, ' ').trim(), address, extra: [paren, extra].filter(Boolean).join(', ') };
  }
  const comma = t.lastIndexOf(',');
  return comma > 0 && /\d/.test(t.slice(comma)) ? { name: t.slice(0, comma).trim(), address: t.slice(comma + 1).trim(), extra: '' } : { name: t, address: '', extra: '' };
}

const LISTS = [
  {
    name: 'gdansk',
    city: 'Gdańsk',
    meta: { title: 'Gdańsk — wykaz defibrylatorów (gdansk.pl, stan 25.02.2022)', url: 'https://www.gdansk.pl/wiadomosci/Defibrylatory,a,216952', format: 'HTML (tabela)' },
    parse(html) {
      return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].flatMap(([, tr]) => {
        const td = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripHtml(m[1]));
        if (td.length < 3 || !/^\d+$/.test(td[0])) return [];
        // "Osowa, ul. Balcerskiego 35 ( IX komisariat policji)" -> dzielnica, adres, nazwa
        let a = td[1];
        const paren = a.match(/\(\s*([^)]*?)\s*\)/)?.[1] ?? '';
        a = a.replace(/\([^)]*\)/g, '').trim();
        const m = a.match(/^([^,]+),\s*(.+)$/);
        const district = m && !/\d/.test(m[1]) ? m[1].trim() : '';
        const address = district ? m[2].trim() : a;
        return [{
          id: td[0],
          name: paren || [district, address].filter(Boolean).join(', '),
          address,
          district,
          location: td[2] ?? '',
          indoor: /na zewn/i.test(td[3] ?? '') ? 'no' : /wewn/i.test(td[3] ?? '') ? 'yes' : '',
          opening_hours: td[4] ?? '',
        }];
      });
    },
  },
  {
    name: 'torun',
    city: 'Toruń',
    meta: { title: 'Toruń — wykaz miejskich defibrylatorów AED (torun.pl)', url: 'https://torun.pl/pl/zdrowie/defibrylatory-aed-wykaz-lokalizacji', format: 'HTML (lista <ol>)' },
    parse(html) {
      const body = html.slice(html.indexOf('Wykaz lokalizacji miejskich defibrylatorów'));
      const ol = body.match(/<ol>([\s\S]*?)<\/ol>/)?.[1] ?? '';
      return [...ol.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(([, li], i) => {
        const [name, ...rest] = li.split(/<br\s*\/?>/i).map(stripHtml);
        return { id: String(i + 1), name, address: rest.join(' ') };
      });
    },
  },
  {
    name: 'lublin',
    city: 'Lublin',
    meta: {
      title: 'Lublin — wykaz defibrylatorów AED (lublin.eu, PDF)',
      url: 'https://lublin.eu/mieszkancy/zdrowie/aktualnosci/aed-w-lublinie,748,1345,1.html',
      format: 'PDF (link pobierany ze strony artykułu — nazwa pliku zawiera datę stanu)',
      attribution: 'Urząd Miasta Lublin',
    },
    async load() {
      const page = await fetchText(this.meta.url, {}, { ttlMs: DAY });
      const href = page.match(/href="([^"]*aed[^"]*\.pdf)"/i)?.[1];
      if (!href) throw new Error('nie znaleziono linku do PDF na stronie artykułu');
      const pdfUrl = new URL(href, this.meta.url).href;
      const lines = pdfToLines(await politeFetch(pdfUrl, {}, { ttlMs: DAY })).flat();
      const seen = new Set();
      return lines.flatMap((l) => {
        const m = l.match(/^(\d+)\.\s*(.+)$/);
        if (!m) return [];
        const hoursM = m[2].match(/\((w godz[^)]*|czynn[^)]*|dostępn[^)]*)\)\s*$/i);
        const { name, address, extra } = splitNameAddr(hoursM ? m[2].slice(0, hoursM.index) : m[2]);
        const hours = hoursM?.[1] ?? '';
        const key = `${name}|${address}`.toLowerCase().replace(/\W+/g, '');
        if (seen.has(key)) return []; // PDF zawiera powtórzone pozycje
        seen.add(key);
        return [{ id: m[1], name, address, location: extra, opening_hours: hours, pdf: pdfUrl }];
      });
    },
  },
  {
    name: 'sopot',
    city: 'Sopot',
    meta: {
      title: 'Sopot — defibrylatory stacjonarne (sopot.pl, stan X.2021)',
      url: 'https://www.sopot.pl/aktualnosc/9383/gdzie-w-sopocie-znajdziesz-defibrylator-aed',
      format: 'HTML (akapity „• nazwa, adres / N szt., godziny, miejsce”)',
      attribution: 'Urząd Miasta Sopotu',
    },
    parse(html) {
      return [...html.matchAll(/<p>\s*<strong>\s*(?:&bull;|•)([\s\S]*?)<\/p>/g)].map(([, p], i) => {
        const [head, tail = ''] = p.split(/<br\s*\/?>/i);
        const { name, address } = splitNameAddr(stripHtml(head).replace(/^[•\s]+/, '').replace(/\s+,/g, ','));
        const t = stripHtml(tail);
        const count = Number(t.match(/(\d+)\s*szt/)?.[1] ?? 1);
        const parts = t.replace(/^\d+\s*szt\.,?\s*/, '').split(/,\s*/);
        const hours = parts[0]?.replace(/^dostępn[ey]\s*/, '') ?? '';
        return { id: String(i + 1), name, address, count, opening_hours: hours, location: parts.slice(1).join(', ') };
      });
    },
  },
  {
    name: 'chelm',
    city: 'Chełm',
    meta: {
      title: 'Chełm — defibrylatory AED w miejskiej przestrzeni publicznej (Budżet Obywatelski)',
      url: 'https://samorzad.gov.pl/web/miasto-chelm/defibrylatory-aed-w-miejskiej-przestrzeni-publicznej',
      format: 'HTML (lista „osiedle – nazwa, adres”)',
      attribution: 'Urząd Miasta Chełm',
    },
    parse(html) {
      const body = html.slice(html.indexOf('lista lokalizacji'));
      const ul = body.match(/<ul>([\s\S]*?)<\/ul>/)?.[1] ?? '';
      return [...ul.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(([, li], i) => {
        const t = stripHtml(li).replace(/[\s,.]+$/, '');
        const dash = t.lastIndexOf(' - ');
        const district = dash > 0 ? t.slice(0, dash).trim() : '';
        const { name, address } = splitNameAddr(dash > 0 ? t.slice(dash + 3) : t);
        return { id: String(i + 1), name, address, district };
      });
    },
  },
  {
    name: 'us-edu',
    city: '',
    meta: {
      title: 'Uniwersytet Śląski — defibrylatory AED w budynkach uczelni',
      url: 'https://us.edu.pl/bezpieczenstwo/defibrylatory-aed/',
      format: 'HTML (akordeon miast, lista <li>)',
      attribution: 'Uniwersytet Śląski w Katowicach',
    },
    parse(html) {
      return html.split('vc_tta-title-text">').slice(1).flatMap((seg) => {
        const city = seg.slice(0, seg.indexOf('<')).trim();
        return [...seg.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(([, li]) => {
          const name = stripHtml(li.match(/<strong>([\s\S]*?)<\/strong>/)?.[1] ?? '').replace(/,\s*$/, '');
          const rest = stripHtml(li.replace(/<strong>[\s\S]*?<\/strong>/, ''));
          const address = (rest.match(/((?:ul\.|al\.|pl\.)\s*.*?\d+[a-zA-Z]?)(?=[\s,.;]|$)/i)?.[1] ?? '').trim();
          const location = rest.match(/Lokalizacja AED:\s*(.*)$/i)?.[1]?.replace(/^[–-]\s*/, '').trim() ?? '';
          return { city, name, address, location };
        });
      }).map((x, i) => ({ id: String(i + 1), ...x }));
    },
  },
];

export const addressLists = LISTS.map((l) => ({
  name: l.name,
  meta: {
    coords: 'BRAK — geokodowane z adresu (GUGiK UUG, fallback Nominatim)',
    license: NO_LICENSE,
    attribution: l.meta.attribution ?? `Urząd Miasta ${l.city}`,
    refresh: 'ręcznie przez urząd',
    ...l.meta,
  },
  async run() {
    const items = l.load ? await l.load() : l.parse(await fetchText(l.meta.url, {}, { ttlMs: DAY }));
    if (!items.length) {
      await invalidate(l.meta.url);
      throw new Error('0 pozycji — strona zwróciła błąd albo zmieniła strukturę (poprzednie dane w data/raw zostają)');
    }
    console.log(`  + [${l.name}] ${items.length} pozycji — geokoduję`);
    const out = await mapLimit(items, 6, async (it) => {
      const city = it.city || l.city;
      const geo = await geocode(it.address, city);
      if (geo?.skip) {
        console.log(`  - [${l.name}] pominięto (override): "${it.address}" — ${geo.skip}`);
        return null;
      }
      if (!geo) {
        console.warn(`  ! [${l.name}] nie zgeokodowano: "${it.address}" (${it.name})`);
        return null;
      }
      return {
        source: l.name,
        sourceId: it.id,
        lat: geo.lat,
        lon: geo.lon,
        name: it.name,
        address: it.address,
        city,
        location: it.location ?? '',
        count: it.count,
        indoor: it.indoor ?? '',
        opening_hours: it.opening_hours ?? '',
        geocode: { provider: geo.provider, accuracy: geo.accuracy, matched: geo.matched, query: geo.variant },
        license: NO_LICENSE,
        raw: it,
      };
    });
    return out.filter(Boolean);
  },
}));
