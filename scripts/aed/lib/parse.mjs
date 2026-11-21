// Parsowanie "dziwnych" plików gmin: kodowanie, CSV z różnym cytowaniem, zamienione współrzędne.

export const PL_BBOX = { latMin: 48.9, latMax: 55.0, lonMin: 14.0, lonMax: 24.3 };

export function decodeText(buf) {
  const utf8 = new TextDecoder('utf-8').decode(buf);
  const text = utf8.includes('�') ? new TextDecoder('windows-1250').decode(buf) : utf8;
  return text.replace(/^﻿/, '');
}

export function parseCsv(text) {
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
  // Niektóre gminy cytują całą linię ("a,b,""c""") -> 1 pole z separatorami: parsujemy ponownie
  return rows
    .filter((r) => r.some((f) => f.trim()))
    .map((r) => (r.length === 1 && r[0].includes(delim) ? parseCsv(r[0])[0] : r))
    .map((r) => r.map((f) => f.trim()));
}

export const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

export const inPoland = (lat, lon) =>
  lat >= PL_BBOX.latMin && lat <= PL_BBOX.latMax && lon >= PL_BBOX.lonMin && lon <= PL_BBOX.lonMax;

/** Zwraca [lat, lon] albo null; naprawia zamienione kolumny (częsty błąd w danych gmin). */
export function fixCoords(lat, lon) {
  if (lat == null || lon == null) return null;
  if (inPoland(lat, lon)) return [lat, lon];
  if (inPoland(lon, lat)) return [lon, lat];
  return null;
}

export const pick = (obj, re) => {
  const k = Object.keys(obj).find((key) => re.test(key));
  return k ? String(obj[k] ?? '').trim() : '';
};

export function rowsToPoints(rows) {
  const [header, ...data] = rows;
  if (!header) return [];
  const h = header.map((x) => x.toLowerCase());
  const latI = h.findIndex((x) => /szer|^lat|latitude|^y$/.test(x));
  const lonI = h.findIndex((x) => /d(ł|l)ug|^lon|^lng|longitude|^x$/.test(x));
  if (latI < 0 || lonI < 0) return [];
  return data.flatMap((r) => {
    const c = fixCoords(num(r[latI]), num(r[lonI]));
    if (!c) return [];
    return [{ lat: c[0], lon: c[1], props: Object.fromEntries(header.map((k, i) => [k, r[i] ?? ''])) }];
  });
}

export function geojsonToPoints(gj) {
  const feats = Array.isArray(gj) ? gj : gj.features ?? [];
  return feats.flatMap((f) => {
    let coords = f.geometry?.coordinates;
    if (Array.isArray(coords?.[0])) coords = coords[0]; // API Warszawy: [[lon, lat]]
    const c = fixCoords(num(coords?.[1]), num(coords?.[0]));
    return c ? [{ lat: c[0], lon: c[1], props: f.properties ?? {} }] : [];
  });
}

export function bufferToPoints(buf, format) {
  const text = decodeText(buf);
  const t = text.trimStart();
  if (t.startsWith('{') || t.startsWith('[')) return geojsonToPoints(JSON.parse(t));
  if (t.startsWith('<')) return []; // HTML/XML/GML — te same zbiory są zwykle też jako CSV/GeoJSON
  return rowsToPoints(parseCsv(text));
}

const ENTITIES = {
  nbsp: ' ', quot: '"', amp: '&', apos: "'", lt: '<', gt: '>', bull: '•', hellip: '…',
  ndash: '–', mdash: '—', bdquo: '„', rdquo: '”', ldquo: '“', laquo: '«', raquo: '»',
  oacute: 'ó', Oacute: 'Ó', aacute: 'á', eacute: 'é', uuml: 'ü', ouml: 'ö', auml: 'ä',
};

export const decodeEntities = (s) =>
  String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => ENTITIES[name] ?? m);

export const stripHtml = (s) =>
  decodeEntities(String(s).replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
