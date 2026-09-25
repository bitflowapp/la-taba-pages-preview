// Service worker and cache behaviour of the LIVE CONTROLLED_PRODUCTION web
// across a deploy, from a real browser profile (Chromium, Pixel 7):
//
//   --phase seed     fresh persistent profile on the version live today; stores a
//                    Panel session (QA identity, not a member of the real
//                    business) exactly where the web keeps it.
//   --phase upgrade  the SAME profile after the next deploy: it must run the new
//                    commit (network-first), keep the SW in control, keep the
//                    session, and survive reload, a forced update check and a
//                    cache-bypassing reload.
//   --phase fresh    a brand-new profile on the live version.
//
//   node scripts/controlled-production/sw-live-check.mjs --phase seed --profile <dir> [--expect-commit <sha>] [--out f]
//
// Read-only for the backend: the only request with a credential is the web's own
// session refresh. Nothing is printed except the report (no tokens).
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, devices } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loadTargetKeys } from './target-keys.mjs';
import { readQaCredential } from './qa-credentials.mjs';

const ORIGIN = 'https://la-taba-commercial-pilot.pages.dev/';
const CP_REF = 'tkanbadcglszlcyfjvpv';
const REAL_BUSINESS = 'e7850ad2-a447-402c-8375-3fd74e9466ba';
const args = process.argv.slice(2);
const opt = (name, fallback = '') => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const phase = opt('--phase');
assert.ok(['seed', 'upgrade', 'fresh'].includes(phase), 'PHASE_REQUIRED');
const profile = opt('--profile');
assert.ok(profile, 'PROFILE_DIR_REQUIRED');
const expectCommit = opt('--expect-commit');
const OUT = opt('--out', `artifacts/controlled-production/sw-live-${phase}-${Date.now()}.json`);
const { defaultBrowserType, ...pixel } = devices['Pixel 7']; // eslint-disable-line no-unused-vars

const context = await chromium.launchPersistentContext(profile, { ...pixel, headless: true });
const errors = [];
const report = { at: new Date().toISOString(), phase, origin: ORIGIN, checks: {}, observed: {} };
const check = (name, ok, detail) => { report.checks[name] = ok ? 'PASS' : 'FAIL'; if (detail !== undefined) report.observed[name] = detail; };

async function state(page) {
  return page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const version = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
    const config = globalThis.__LA_TABA_RUNTIME_CONFIG__ || null;
    return {
      controller: navigator.serviceWorker.controller?.scriptURL || null,
      active: reg?.active?.scriptURL || null,
      waiting: Boolean(reg?.waiting),
      caches: await caches.keys(),
      version,
      supabaseUrl: config?.repository?.supabaseUrl || null,
      businessId: config?.repository?.businessId || null,
      environment: config?.repository?.deploymentEnvironment || null,
      authKeys: Object.keys(localStorage).filter((k) => /^sb-.*-auth-token$/.test(k)),
    };
  });
}
async function open(page, hash = '') {
  let response = await page.goto(`${ORIGIN}${hash}`, { waitUntil: 'load', timeout: 90_000 });
  // A hash-only navigation keeps the document (and the Supabase client it
  // already created): reload so the page starts from what is stored.
  if (hash) response = await page.reload({ waitUntil: 'load', timeout: 90_000 });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 60_000 }).catch(() => {});
  return response?.status() ?? 0;
}
// The Panel paints the sign-in step first and switches once identity_current_context
// and the access request answer: poll until it settles on another step (or 30 s).
const panelStep = async (page) => {
  await page.waitForSelector('[data-panel-access-step]', { timeout: 60_000 }).catch(() => {});
  const read = () => page.locator('[data-panel-access-step]').first().getAttribute('data-panel-access-step').catch(() => null);
  const until = Date.now() + 30_000;
  let step = await read();
  while (step === 'sign_in' && Date.now() < until) { await page.waitForTimeout(1_000); step = await read(); }
  return step;
};

try {
  const page = context.pages()[0] || await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror:${e.message.slice(0, 120)}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console:${m.text().slice(0, 120)}`); });

  const status = await open(page);
  const s1 = await state(page);
  report.observed.first = { status, ...s1, authKeys: s1.authKeys.length };
  check('PAGE_LOADS', status === 200, status);
  check('BACKEND_IS_CP', (s1.supabaseUrl || '').includes(CP_REF) && s1.businessId === REAL_BUSINESS && s1.environment === 'pilot');
  check('SW_CONTROLLING', Boolean(s1.controller) && s1.controller === s1.active, s1.controller);
  check('RUNTIME_CACHE_PRESENT', s1.caches.some((k) => k.startsWith('la-taba-runtime-')), s1.caches);
  if (expectCommit) check('SERVES_EXPECTED_COMMIT', s1.version?.commit === expectCommit, s1.version?.commit);

  if (phase === 'seed') {
    // A signed-in Panel user of the previous version (QA identity, no membership in the real business).
    const keys = await loadTargetKeys('controlled-production', { requireSecret: false });
    assert.equal(keys.ref, CP_REF, 'NOT_CONTROLLED_PRODUCTION');
    const stored = readQaCredential('CP QA STAFF');
    const c = createClient(keys.url, keys.publishable, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await c.auth.signInWithPassword({ email: stored.usuario, password: stored.secreto });
    assert.ok(!error && data.session, 'QA_LOGIN_FAILED');
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: `sb-${CP_REF}-auth-token`, value: JSON.stringify(data.session) });
    await open(page, '#business');
    const step = await panelStep(page);
    check('PANEL_SESSION_RECOGNISED', step === 'request', step);
    report.observed.seedCommit = s1.version?.commit;
  } else {
    if (phase === 'upgrade') {
      await open(page, '#business');
      const step = await panelStep(page);
      check('EXISTING_SESSION_KEPT', step === 'request' && s1.authKeys.length === 1, step);
    }
    await page.reload({ waitUntil: 'load' });
    const s2 = await state(page);
    check('RELOAD_KEEPS_SW_AND_VERSION', Boolean(s2.controller) && s2.version?.commit === s1.version?.commit, s2.version?.commit);
    const update = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      try { await reg.update(); return { ok: true, installing: Boolean(reg.installing), waiting: Boolean(reg.waiting) }; }
      catch (e) { return { ok: false, error: String(e).slice(0, 120) }; }
    });
    check('UPDATE_CHECK_OK', update.ok, update);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await page.reload({ waitUntil: 'load' });
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
    const s3 = await state(page);
    check('HARD_RELOAD_OK', Boolean(s3.controller) && s3.version?.commit === s1.version?.commit, s3.version?.commit);
    report.observed.final = { ...s3, authKeys: s3.authKeys.length };
  }
  check('NO_JS_ERRORS', errors.length === 0, errors.slice(0, 10));
} finally {
  await context.close();
}
report.verdict = Object.values(report.checks).every((v) => v === 'PASS') ? 'PASS' : 'FAIL';
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ out: OUT, phase, verdict: report.verdict, checks: report.checks }));
process.exit(report.verdict === 'PASS' ? 0 : 1);
