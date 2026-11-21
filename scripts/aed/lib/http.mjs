// Grzeczny fetch: limiter per host (współbieżność + minimalny odstęp między startami),
// retry z wykładniczym backoffem + jitter, Retry-After, cache na dysku (ETag / TTL).
//
// Różne hosty idą w pełni równolegle; ten sam host nigdy nie dostaje więcej niż
// `concurrency` zapytań naraz ani częściej niż co `gapMs`.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '../../..');
export const DATA_DIR = path.join(ROOT, 'data');
const CACHE_DIR = path.join(DATA_DIR, '.cache');
await mkdir(CACHE_DIR, { recursive: true });

export const UA = 'aed-hacknation-2026/0.1 (+https://github.com/tomasz-trela/aed-hacknation-2026)';
const MAX_RETRIES = 5;

const HOST_LIMITS = {
  default: { concurrency: 1, gapMs: 1000 },
  'openaedmap.org': { concurrency: 1, gapMs: 1000 },
  'overpass-api.de': { concurrency: 1, gapMs: 5000 },
  'api.dane.gov.pl': { concurrency: 2, gapMs: 300 },
  'krakow.pl': { concurrency: 2, gapMs: 400 },
  'services.gugik.gov.pl': { concurrency: 2, gapMs: 150 },
  'nominatim.openstreetmap.org': { concurrency: 1, gapMs: 1100 }, // polityka: max 1 req/s
  'www.google.com': { concurrency: 1, gapMs: 1500 },
  'umap.openstreetmap.fr': { concurrency: 1, gapMs: 1500 },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class HostLimiter {
  constructor({ concurrency, gapMs }) {
    this.concurrency = concurrency;
    this.gapMs = gapMs;
    this.active = 0;
    this.nextStart = 0;
    this.queue = [];
    this.pausedUntil = 0;
  }
  async acquire() {
    if (this.active >= this.concurrency) await new Promise((r) => this.queue.push(r));
    this.active++;
    // rezerwujemy slot czasowy synchronicznie, żeby równoległe wywołania się nie nakładały
    const start = Math.max(Date.now(), this.nextStart, this.pausedUntil);
    this.nextStart = start + this.gapMs;
    const wait = start - Date.now();
    if (wait > 0) await sleep(wait);
  }
  release() {
    this.active--;
    this.queue.shift()?.();
  }
  /** Po 429 wstrzymujemy CAŁY host, nie tylko jedno zapytanie. */
  pause(ms) {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms);
  }
}

const limiters = new Map();
const limiterFor = (host) => {
  if (!limiters.has(host)) limiters.set(host, new HostLimiter(HOST_LIMITS[host] ?? HOST_LIMITS.default));
  return limiters.get(host);
};

export const stats = { requests: 0, cacheHits: 0, notModified: 0, retries: 0, bytes: 0 };

/**
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {{ ttlMs?: number, quiet?: boolean }} [opts]
 *   ttlMs — jeśli cache jest młodszy, nie wysyłamy zapytania wcale (geokodowanie, strony szczegółów).
 */
export async function politeFetch(url, init = {}, { ttlMs = 0, quiet = false } = {}) {
  const key = createHash('sha1').update(`${init.method ?? 'GET'} ${url} ${init.body ?? ''}`).digest('hex').slice(0, 20);
  const metaPath = path.join(CACHE_DIR, `${key}.meta.json`);
  const bodyPath = path.join(CACHE_DIR, `${key}.body`);
  const meta = await readFile(metaPath, 'utf8').then(JSON.parse).catch(() => null);

  if (meta && ttlMs && Date.now() - Date.parse(meta.fetchedAt) < ttlMs) {
    const body = await readFile(bodyPath).catch(() => null);
    if (body) {
      stats.cacheHits++;
      return body;
    }
  }

  const limiter = limiterFor(new URL(url).host);
  for (let attempt = 0; ; attempt++) {
    await limiter.acquire();
    let res, err;
    try {
      const headers = { 'User-Agent': UA, ...init.headers };
      if (meta?.etag) headers['If-None-Match'] = meta.etag;
      if (meta?.lastModified) headers['If-Modified-Since'] = meta.lastModified;
      stats.requests++;
      res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(180_000) });
      if (res.status === 304 && meta) {
        stats.notModified++;
        if (!quiet) console.log(`  304 ${url}`);
        return await readFile(bodyPath);
      }
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        stats.bytes += buf.length;
        await writeFile(bodyPath, buf);
        await writeFile(metaPath, JSON.stringify({
          url, etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified'), fetchedAt: new Date().toISOString(),
        }));
        if (!quiet) console.log(`  ${res.status} ${(buf.length / 1024).toFixed(0).padStart(5)} KB ${url}`);
        return buf;
      }
      await res.body?.cancel();
    } catch (e) {
      err = e;
    } finally {
      limiter.release();
    }

    const retryable = err || res.status === 429 || res.status >= 500;
    if (!retryable) throw new Error(`HTTP ${res.status} ${url}`);
    if (attempt >= MAX_RETRIES) throw new Error(`${err?.message ?? `HTTP ${res.status}`} po ${attempt + 1} próbach: ${url}`);

    let ms = Math.min(2 ** attempt * 2000, 60_000) + Math.random() * 1000;
    const ra = res?.headers.get('retry-after');
    if (ra) ms = Number.isFinite(Number(ra)) ? Number(ra) * 1000 : Math.max(1000, Date.parse(ra) - Date.now());
    if (res?.status === 429) limiter.pause(ms);
    stats.retries++;
    console.warn(`  ! ${err?.message ?? res.status} ${url} — ponawiam za ${(ms / 1000).toFixed(1)} s`);
    await sleep(ms);
  }
}

/** Usuwa wpis z cache (np. gdy serwer zwrócił 200 ze stroną błędu). */
export async function invalidate(url, init = {}) {
  const key = createHash('sha1').update(`${init.method ?? 'GET'} ${url} ${init.body ?? ''}`).digest('hex').slice(0, 20);
  await Promise.all(['meta.json', 'body'].map((ext) => rm(path.join(CACHE_DIR, `${key}.${ext}`), { force: true })));
}

export const fetchText = async (url, init, opts) => (await politeFetch(url, init, opts)).toString('utf8');
export const fetchJson = async (url, init, opts) => JSON.parse(await fetchText(url, init, opts));

/** Promise.all z limitem współbieżności (limiter per host i tak pilnuje hosta). */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }));
  return out;
}
