import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const base = arg('url', 'http://localhost:5173');
const out = path.resolve(arg('out', 'tmp/construction-appearance'));
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  headless: !process.argv.includes('--headed'),
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=default'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__construction-appearance__', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Construction appearance QA</title>',
  }));
  await page.goto(`${base}/__construction-appearance__`);
  await page.evaluate(async (options) => {
    const { createConstructionAppearanceFixture } = await import('/scripts/fixtures/ConstructionAppearanceFixture.js');
    window.fixture = await createConstructionAppearanceFixture(options);
  }, { styleKey: arg('style', 'glade-sandstone'), lodBand: arg('lod', 'near'),
    growth: arg('growth', 'auto'), view: arg('view', 'front'), closeup: process.argv.includes('--closeup'),
    zoom: Number(arg('zoom', NaN)) });
  const results = [];
  for (const id of arg('scenes', 'straight,curve,tower,arches,arch-profiles,curved-arch,low,growth,standard').split(',')) {
    for (const light of ['neutral', 'warm']) {
      const result = await page.evaluate(async ({ id, light }) => {
        window.capture = await window.fixture.capture(id, light);
        const { dispose, ...result } = window.capture;
        return result;
      }, { id, light });
      if (result.backend !== 'WebGPUBackend') throw new Error('Appearance QA requires WebGPU.');
      await page.screenshot({ path: path.join(out, `${id}-${light}.png`) });
      await page.evaluate(() => window.capture.dispose());
      results.push(result);
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  fs.writeFileSync(path.join(out, 'report.json'), `${JSON.stringify({ results, errors }, null, 2)}\n`);
  console.log(JSON.stringify({ out, results, errors }, null, 2));
} finally {
  await browser.close();
}
