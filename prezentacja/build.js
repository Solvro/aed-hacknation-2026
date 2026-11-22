// Buduje prezentację: slides.html -> prezentacja-ogolnopolski-zbior-aed.pdf (+ podglądy PNG w preview/).
// Wymaga Playwright i Chrome:  npm i playwright && node build.js
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const src = 'file://' + path.join(__dirname, 'slides.html');
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(src, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({
    path: path.join(__dirname, 'prezentacja-ogolnopolski-zbior-aed.pdf'),
    width: '1920px', height: '1080px', printBackground: true, preferCSSPageSize: true,
  });
  if (process.argv.includes('--png')) {
    const out = path.join(__dirname, 'preview');
    fs.mkdirSync(out, { recursive: true });
    const n = await page.locator('section.slide').count();
    for (let i = 0; i < n; i++) {
      await page.locator('section.slide').nth(i).screenshot({ path: path.join(out, `slajd-${String(i + 1).padStart(2, '0')}.png`) });
    }
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
