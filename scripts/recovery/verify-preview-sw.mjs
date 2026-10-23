// The PWA behind the QA preview gate, in a real Chromium WITHOUT HTTP Basic credentials (only the gate's own login
// form, as a reviewer does). READ ONLY: no order, no payment, nothing written.
//   1. after the gate login the service worker installs and activates, and its precache is complete;
//   2. a reload is served under the worker's control;
//   3. when the session is gone, a reload shows the gate's login form, NOT a stale shell from the cache (a worker
//      cannot show the Basic dialog; this is what kept reviewers on an old build).
//   node scripts/recovery/verify-preview-sw.mjs [--origin https://…] [--expect-runtime <CACHE_NAME>] [--evidence file.json]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from '@playwright/test';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { passPreviewGate } from './preview-gate-login.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const origin = new URL(arg('--origin', 'https://recovery-20261020.taba2-staging.pages.dev')).origin;
assert.match(origin, /^https:\/\/[a-z0-9-]+\.taba2-staging\.pages\.dev$/, 'QA previews only');
const gate = leerSecreto('RECOVERY PREVIEW ACCESS');
assert.ok(gate?.usuario && gate?.secreto, 'QA preview access credential unavailable');
const manifest = JSON.parse(fs.readFileSync(new URL('../../release-identity.json', import.meta.url), 'utf8'));
const expectRuntime = arg('--expect-runtime', manifest.cacheName);

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: Boolean(ok), detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail); };
const browser = await chromium.launch({ channel: 'chromium', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-AR', isMobile: true });
try {
  check('the gate opens a session through its form', await passPreviewGate(context, origin, gate));
  const page = await context.newPage();
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const installed = await page.evaluate(async (runtime) => {
    const registration = await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 90000))]);
    // `ready` resolves with the worker already active but possibly still `activating`.
    const worker = registration?.active;
    if (worker && worker.state !== 'activated') {
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 30000);
        worker.addEventListener('statechange', () => { if (worker.state === 'activated') { clearTimeout(timer); resolve(); } });
      });
    }
    const keys = await caches.keys();
    const cache = keys.includes(runtime) ? await caches.open(runtime) : null;
    return { state: registration?.active?.state ?? null, keys, entries: cache ? (await cache.keys()).length : 0 };
  }, expectRuntime);
  check('the service worker is active', installed.state === 'activated', String(installed.state));
  check('its cache is the expected runtime', installed.keys.includes(expectRuntime), installed.keys.join(','));
  check('the precache is complete behind the gate', installed.entries >= manifest.assetCount,
    `${installed.entries} entries / ${manifest.assetCount} precached files`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  check('a reload is served under the worker', controlled);
  await context.clearCookies();
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1500);
  const after = new URL(page.url());
  const form = await page.locator('form[action="/__acceso"]').count();
  check('without a session the reload shows the gate form, not a cached shell', after.pathname === '/__acceso' && form === 1,
    `${after.pathname}${after.search}`);
} catch (error) {
  check('verification ran to the end', false, String(error.message).slice(0, 200));
} finally {
  await browser.close();
}
const evidence = { origin, at: new Date().toISOString(), expectRuntime, checks, passed: checks.every(item => item.ok) };
if (arg('--evidence')) fs.writeFileSync(arg('--evidence'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ passed: evidence.passed, checks: checks.length, failed: checks.filter(item => !item.ok).map(item => item.name) }));
if (!evidence.passed) process.exitCode = 1;
