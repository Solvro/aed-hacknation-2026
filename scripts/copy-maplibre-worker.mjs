#!/usr/bin/env node
// MapLibre GL 6 ładuje Web Workera z osobnego pliku obok modułu (import.meta.url).
// Bundler Next (Turbopack) tego pliku nie kopiuje, więc robimy to sami: public/vendor/.
// Uruchamiane automatycznie po `pnpm install` (postinstall) i przed dev/build.

import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const pkgDir = path.dirname(require.resolve('maplibre-gl/package.json'));
const out = path.resolve(import.meta.dirname, '..', 'public', 'vendor');
await mkdir(out, { recursive: true });
await copyFile(path.join(pkgDir, 'dist', 'maplibre-gl-worker.mjs'), path.join(out, 'maplibre-gl-worker.mjs'));
console.log('maplibre-gl-worker.mjs → public/vendor/');
