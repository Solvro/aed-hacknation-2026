// Źródła z gotowymi współrzędnymi: KML (Google My Maps), GeoJSON (uMap, ArcGIS, InPost), JSON (Gliwice GAMA).
// Każde źródło to krótki config: URL + parser + mapowanie pól na wspólny rekord.
// Znalezione i zweryfikowane 2026-11-21.

import { fetchText } from '../lib/http.mjs';
import { fixCoords, geojsonToPoints, num, pick, stripHtml } from '../lib/parse.mjs';

const NO_LICENSE = 'brak deklaracji licencji — informacja publiczna wydawcy (do potwierdzenia przed publikacją)';

export function parseKml(text) {
  return [...text.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)].flatMap(([, pm]) => {
    const c = pm.match(/<coordinates>\s*([-\d.]+),([-\d.]+)/);
    if (!c) return [];
    const ll = fixCoords(num(c[2]), num(c[1]));
    if (!ll) return [];
    const val = (tag) => stripHtml((pm.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] ?? '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<br\s*\/?>/gi, '\n'));
    const rawDesc = (pm.match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
    return [{ lat: ll[0], lon: ll[1], props: { name: val('name'), description: val('description'), descriptionLines: rawDesc.split(/<br\s*\/?>/i).map(stripHtml).filter(Boolean) } }];
  });
}

const indoorOf = (s) => (/wewn/i.test(s) ? 'yes' : /zewn/i.test(s) ? 'no' : '');
/** "Urząd Miasta Olsztyna, Plac Jana Pawła II 1" -> [nazwa, adres] — adres to ostatni człon z numerem */
function splitNameAddress(s) {
  const parts = s.split(/,\s*/);
  const i = parts.findLastIndex((p) => /\d/.test(p) && /^(ul\.|al\.|pl\.|plac|aleja|os\.)?\s*[\p{Lu}\d]/u.test(p));
  if (i <= 0) return [s, ''];
  return [parts.slice(0, i).join(', '), parts.slice(i).join(', ')];
}

const FEEDS = [
  {
    name: 'inpost-aed',
    meta: { title: 'InPost — AED w paczkomatach „Helpbox 365” (cała Polska)', docs: 'https://inpost.pl/aed', url: 'https://inpost.pl/aed-points', format: 'GeoJSON' },
    kind: 'geojson',
    map: (p) => ({
      name: `InPost Helpbox ${p.name ?? ''}`.trim(),
      address: p.address_1 ?? '',
      city: String(p.address_2 ?? '').replace(/^\d{2}-\d{3}\s*/, ''),
      location: p.location_description ?? '',
      operator: 'InPost',
      skip: p.status && p.status !== 'active',
    }),
  },
  {
    name: 'lodz',
    meta: { title: 'Łódź — mapa defibrylatorów AED (UMŁ, Google My Maps)', docs: 'https://uml.lodz.pl/dla-mieszkancow/zdrowie/mapa-defibrylatorow-aed/', url: 'https://www.google.com/maps/d/kml?mid=1FMKFbebKJPYqD4C87pXWPqNjEHuEswE&forcekml=1', format: 'KML' },
    kind: 'kml',
    map: (p) => ({
      name: p.descriptionLines[0] ?? '',
      address: p.name.replace(/^defibrylator\s*-\s*/i, ''),
      city: 'Łódź',
      location: p.descriptionLines.slice(1).join(', '),
      indoor: indoorOf(p.description),
    }),
  },
  {
    name: 'olsztyn',
    meta: { title: 'Olsztyn — mapa AED (olsztyn.eu, Google My Maps)', docs: 'https://olsztyn.eu', url: 'https://www.google.com/maps/d/kml?mid=1J5zJj9kL49uq8799g5qNgfl21NoztwzK&forcekml=1', format: 'KML' },
    kind: 'kml',
    map: (p) => {
      const [name, address] = splitNameAddress(p.name);
      return { name, address, city: 'Olsztyn', location: p.description };
    },
  },
  {
    name: 'koszalin',
    meta: { title: 'Koszalin — „Punkty Życia” (koszalin.pl, Google My Maps)', docs: 'https://koszalin.pl', url: 'https://www.google.com/maps/d/kml?mid=1AQwJAfeZsGGB7fhz0-yBSxab83DwyIw&forcekml=1', format: 'KML' },
    kind: 'kml',
    map: (p) => ({ name: p.description || p.name, location: p.name, city: 'Koszalin', indoor: indoorOf(p.description) }),
  },
  {
    name: 'gliwice-gama',
    meta: { title: 'Gliwice — aplikacja miejska GAMA (kategoria 90 = AED)', docs: 'https://gliwice.eu/aktualnosci/bezpieczne-gliwice/aed-w-gliwicach-gdzie-sprawdzic-lokalizacje-i-jak-skorzystac-z', url: 'https://gama.gliwice.eu/map/json', format: 'JSON (filtr cat == 90)' },
    kind: 'gama',
    map: (p) => ({ name: p.name ?? '', city: 'Gliwice' }),
  },
  {
    name: 'arcgis-krakow-2022',
    meta: { title: 'Kraków — warstwa ArcGIS Online „AED_zestawy” (konto prywatne, 2022)', url: 'https://services6.arcgis.com/w8Sm3ehkmwzR6bQc/arcgis/rest/services/AED_zestawy/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson', format: 'GeoJSON (ArcGIS FeatureServer)' },
    kind: 'geojson',
    // pola: objectid, miasto, ulica, lokalizacj (= nazwa obiektu), uwagi
    map: (p) => ({ name: p.lokalizacj ?? '', address: p.ulica ?? '', location: p.uwagi ?? '', city: p.miasto || 'Kraków' }),
  },
  {
    name: 'arcgis-mikolow',
    meta: { title: 'Mikołów i okolice — warstwa ArcGIS Online „Defibrylatory_AED”', url: 'https://services9.arcgis.com/E1ZsJFZqsk2tR9yK/arcgis/rest/services/Defibrylatory_AED/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson', format: 'GeoJSON (ArcGIS FeatureServer)' },
    kind: 'geojson',
    // pola: OBJECTID, Lokalizacja (= nazwa obiektu), adres ("Mikołów, Rynek 2"), Pietro, Położenie
    map: (p) => {
      const [city, ...rest] = String(p.adres ?? '').split(/,\s*/);
      return {
        name: p.Lokalizacja ?? '',
        address: rest.length ? rest.join(', ') : city,
        city: rest.length ? city : '',
        location: [p['Położenie'], p.Pietro && `piętro: ${p.Pietro}`].filter(Boolean).join(', '),
      };
    },
  },
  {
    name: 'umap-jelenia-gora',
    meta: { title: 'Jelenia Góra — uMap „Lokalizacja AED w Jeleniej Górze”', docs: 'https://umap.openstreetmap.fr/pl/map/lokalizacja-aed-w-jeleniej-gorze_1253792', url: 'https://umap.openstreetmap.fr/pl/datalayer/1253792/1a6f3fba-bb95-4dfd-8be3-8d01b5b9f22c/', format: 'GeoJSON (uMap)', license: 'WTFPL' },
    kind: 'geojson',
    map: (p) => {
      const [name, address] = splitNameAddress(String(p.name ?? '').replace(/^AED\s+/i, ''));
      return { name, address, city: 'Jelenia Góra', location: p.description ?? '' };
    },
  },
  {
    name: 'umap-wejherowo',
    meta: { title: 'Wejherowo — uMap „Interaktywna mapa AED Wejherowo”', docs: 'https://umap.openstreetmap.fr/pl/map/interaktywna-mapa-aed-wejherowo_1469464', url: 'https://umap.openstreetmap.fr/pl/datalayer/1469464/fd5ec717-3b9c-4931-b44f-3c1e98dfb0ec/', format: 'GeoJSON (uMap)' },
    kind: 'geojson',
    map: (p) => ({ name: p.name ?? '', location: p.description ?? '', city: 'Wejherowo' }),
  },
];

function parse(kind, text) {
  if (kind === 'kml') return parseKml(text);
  const json = JSON.parse(text);
  if (kind === 'gama')
    return json.filter((x) => String(x.cat) === '90').flatMap((x) => {
      const ll = fixCoords(num(x.lat), num(x.lon));
      return ll ? [{ lat: ll[0], lon: ll[1], props: x }] : [];
    });
  return geojsonToPoints(json);
}

export const feeds = FEEDS.map((f) => ({
  name: f.name,
  meta: { coords: 'natywne WGS84', license: f.meta.license ?? NO_LICENSE, attribution: f.meta.title.split(' — ')[0], refresh: 'zależnie od wydawcy', ...f.meta },
  async run() {
    const pts = parse(f.kind, await fetchText(f.meta.url, {}, { ttlMs: 6 * 3600 * 1000 }));
    return pts.flatMap((p, i) => {
      const m = f.map(p.props);
      if (m.skip) return [];
      delete m.skip;
      return [{
        source: f.name,
        sourceId: String(p.props.id ?? p.props.OBJECTID ?? p.props.objectid ?? p.props.FID ?? p.props.name ?? i),
        lat: p.lat,
        lon: p.lon,
        ...m,
        license: f.meta.license ?? NO_LICENSE,
        raw: p.props,
      }];
    });
  },
}));
