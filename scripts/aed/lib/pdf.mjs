// Minimalny ekstraktor tekstu z PDF (bez zależności): strumienie Flate + mapy ToUnicode czcionek.
// Wystarcza dla prostych PDF-ów z edytorów biurowych (LibreOffice/Word). Zwraca linie posortowane
// od góry strony.

import { inflateSync } from 'node:zlib';

function objects(pdf) {
  const map = new Map();
  for (const m of pdf.matchAll(/(\d+)\s+0\s+obj\b([\s\S]*?)endobj/g)) map.set(Number(m[1]), m[2]);
  return map;
}

function streamOf(objText, raw, offset) {
  const i = objText.indexOf('stream');
  if (i < 0) return null;
  let start = offset + i + 6;
  if (raw[start] === 0x0d) start++;
  if (raw[start] === 0x0a) start++;
  const end = raw.indexOf('endstream', start);
  const data = raw.subarray(start, end);
  try {
    return /FlateDecode/.test(objText.slice(0, i)) ? inflateSync(data).toString('latin1') : data.toString('latin1');
  } catch {
    return null;
  }
}

const hexToStr = (h) => {
  let s = '';
  for (let i = 0; i < h.length; i += 4) s += String.fromCodePoint(parseInt(h.slice(i, i + 4).padEnd(4, '0'), 16));
  return s;
};

function parseCMap(cmap) {
  const map = new Map();
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const [, src, dst] of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(parseInt(src, 16), hexToStr(dst));
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
    for (const [, a, b, dst] of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const base = parseInt(dst, 16);
      for (let c = parseInt(a, 16); c <= parseInt(b, 16); c++) map.set(c, String.fromCodePoint(base + c - parseInt(a, 16)));
    }
  const width = /begincodespacerange\s*<([0-9a-fA-F]+)>/.exec(cmap)?.[1].length ?? 2;
  return { map, hexWidth: width };
}

/** @returns {string[][]} strony -> linie tekstu */
export function pdfToLines(buf) {
  const pdf = buf.toString('latin1');
  const objs = objects(pdf);
  const offsets = new Map([...pdf.matchAll(/(\d+)\s+0\s+obj\b/g)].map((m) => [Number(m[1]), m.index + m[0].length]));
  const stream = (n) => streamOf(objs.get(n) ?? '', buf, offsets.get(n));

  // nazwa zasobu czcionki (/F1) -> cmap
  const fonts = new Map();
  const fontDicts = [
    ...[...pdf.matchAll(/\/Font\s*<<([\s\S]*?)>>/g)].map((m) => m[1]),
    ...[...pdf.matchAll(/\/Font\s+(\d+)\s+0\s+R/g)].map((m) => objs.get(Number(m[1])) ?? ''), // słownik pośredni
  ];
  for (const dict of fontDicts)
    for (const [, name, ref] of dict.matchAll(/\/(\w+)\s+(\d+)\s+0\s+R/g)) {
      const tu = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(objs.get(Number(ref)) ?? '')?.[1];
      const cm = tu && stream(Number(tu));
      if (cm && !fonts.has(name)) fonts.set(name, parseCMap(cm));
    }

  const decode = (hex, font) => {
    const f = fonts.get(font);
    if (!f) return '';
    let s = '';
    for (let i = 0; i < hex.length; i += f.hexWidth) s += f.map.get(parseInt(hex.slice(i, i + f.hexWidth), 16)) ?? '';
    return s;
  };

  const pages = [];
  for (const [n, obj] of objs) {
    if (!/\/Type\s*\/Page\b/.test(obj)) continue;
    const refs = /\/Contents\s*(?:\[([^\]]*)\]|(\d+)\s+0\s+R)/.exec(obj);
    if (!refs) continue;
    const ids = refs[1] ? [...refs[1].matchAll(/(\d+)\s+0\s+R/g)].map((m) => Number(m[1])) : [Number(refs[2])];
    const content = ids.map(stream).filter(Boolean).join('\n');
    const rows = new Map(); // y -> [{x, text}]
    let font = '', x = 0, y = 0;
    for (const bt of content.matchAll(/BT([\s\S]*?)ET/g)) {
      for (const op of bt[1].matchAll(/([-\d.]+)\s+([-\d.]+)\s+Td|\/(\w+)\s+[-\d.]+\s+Tf|\[((?:[^\]\\]|\\.)*)\]\s*TJ|<([0-9a-fA-F]+)>\s*Tj/g)) {
        if (op[1] !== undefined) { x = Number(op[1]); y = Number(op[2]); continue; }
        if (op[3]) { font = op[3]; continue; }
        const text = op[4] !== undefined
          ? [...op[4].matchAll(/<([0-9a-fA-F]+)>|(-?[\d.]+)/g)].map((m) => (m[1] ? decode(m[1], font) : Number(m[2]) < -200 ? ' ' : '')).join('')
          : decode(op[5], font);
        const key = Math.round(y);
        (rows.get(key) ?? rows.set(key, []).get(key)).push({ x, text });
      }
    }
    pages.push({
      n,
      lines: [...rows].sort((a, b) => b[0] - a[0]).map(([, parts]) => parts.sort((a, b) => a.x - b.x).map((p) => p.text).join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean),
    });
  }
  return pages.sort((a, b) => a.n - b.n).map((p) => p.lines);
}
