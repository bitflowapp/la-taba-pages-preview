import { createClient } from '@supabase/supabase-js';
import { chromium, webkit } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const origin = 'https://la-taba.pages.dev';
const ref = 'wwcpogltfgzgkrlilbcd';
const runtime = await fetch(`${origin}/runtime-config.js`, { signal: AbortSignal.timeout(10_000) });
if (!runtime.ok) throw Error('PRODUCTION_RUNTIME_UNAVAILABLE');
const source = await runtime.text();
if (!source.includes(`${ref}.supabase.co`)) throw Error('PRODUCTION_REF_MISMATCH');
const key = source.match(/publishableKey:\s*['"](sb_publishable_[A-Za-z0-9_-]+)['"]/)?.[1];
if (!key) throw Error('PUBLIC_KEY_UNAVAILABLE');
const client = createClient(`https://${ref}.supabase.co`, key,
  { auth: { persistSession: false, autoRefreshToken: false } });
const listed = await client.from('products').select('image_url,image_thumbnail_url')
  .eq('is_active', true).eq('available', true).eq('is_verified', true);
if (listed.error || !listed.data?.length) throw Error('PUBLIC_CATALOG_UNAVAILABLE');
const assets = [...new Set(listed.data.flatMap((row) => [row.image_url, row.image_thumbnail_url]))];
if (assets.some((asset) => typeof asset !== 'string'
  || !/^assets\/[A-Za-z0-9._/-]+$/.test(asset) || asset.split('/').includes('..'))) {
  throw Error('CATALOG_ASSET_PATH_INVALID');
}

const report = { timestamp: new Date().toISOString(), origin, project: ref, readOnly: true,
  products: listed.data.length, assets: assets.length, browsers: {} };
for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await engine.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const failures = await page.evaluate(async (paths) => {
      const failed = [];
      for (let i = 0; i < paths.length; i += 8) {
        await Promise.all(paths.slice(i, i + 8).map(async (path) => {
          const image = new Image();
          image.src = `/${path}`;
          try {
            await Promise.race([
              image.decode(),
              new Promise((_, reject) => setTimeout(() => reject(Error('TIMEOUT')), 20_000)),
            ]);
            if (!image.naturalWidth) throw Error('EMPTY_IMAGE');
          } catch (error) {
            failed.push({ path, code: error?.message === 'TIMEOUT' ? 'TIMEOUT' : 'DECODE_OR_NETWORK' });
          }
        }));
      }
      return failed;
    }, assets);
    report.browsers[name] = { passed: assets.length - failures.length, failed: failures };
    await context.close();
  } finally {
    await browser.close();
  }
}
writeFileSync('artifacts/pilot-catalog-browser-smoke.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (Object.values(report.browsers).some((browser) => browser.failed.length)) process.exitCode = 1;
