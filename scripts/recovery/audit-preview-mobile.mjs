// Read-only mobile audit of the QA preview with the installed Chrome (headless). Opens the QA window for
// the duration of the run and always closes it. Submits no order and touches no payment provider.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createClient } from '@supabase/supabase-js';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { RECOVERY_QA } from './provision-qa-ids.mjs';

const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const origin = arg('--origin');
const outDir = path.resolve(arg('--out'));
fs.mkdirSync(outDir, { recursive: true });
const ref = 'ixewllzzuzpqrkxzmfzx';
const O = { auth: { persistSession: false, autoRefreshToken: false } };
const stored = leerSecreto('RECOVERY QA OWNER A');
const owner = createClient(`https://${ref}.supabase.co`, leerSecreto('RECOVERY SUPABASE ANON KEY').secreto, O);
assert.ifError((await owner.auth.signInWithPassword({ email: stored.usuario, password: stored.secreto })).error);
assert.ok((await owner.rpc('identity_register_session', { p_business_id: RECOVERY_QA.a, p_client: 'panel_web',
  p_device_label: 'mobile audit', p_device_key_hash: null, p_app_version: 'audit' })).data?.ok);

const report = { at: new Date().toISOString(), origin, pages: [] };
let browser;
try {
  assert.equal((await owner.rpc('open_qa_window', { p_business_id: RECOVERY_QA.a, p_minutes: 15 })).data?.ok, true);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    locale: 'es-AR', userAgent: 'Mozilla/5.0 (Linux; Android 14; Moto G15) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36' });
  const page = await context.newPage();
  const consoleErrors = []; const failed = []; const bytes = { total: 0, requests: 0 };
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) consoleErrors.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message.slice(0, 200)));
  page.on('requestfailed', r => failed.push(`${r.method()} ${r.url().slice(0, 120)} ${r.failure()?.errorText}`));
  page.on('response', async r => { bytes.requests++; const len = Number(r.headers()['content-length'] || 0); bytes.total += len;
    if (r.status() >= 400) failed.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`); });
  const t0 = Date.now();
  await page.goto(origin + '/', { waitUntil: 'networkidle', timeout: 60000 });
  const loadMs = Date.now() - t0;
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(outDir, '01-home.png'), fullPage: false });
  const perf = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; const p = performance.getEntriesByType('paint');
    return { domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd),
      fcp: Math.round(p.find(x => x.name === 'first-contentful-paint')?.startTime || 0) }; });
  const dom = await page.evaluate(() => {
    const visible = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const buttons = [...document.querySelectorAll('button, a[href], [role=button]')].filter(visible);
    const small = buttons.filter(b => { const r = b.getBoundingClientRect(); return r.width < 44 || r.height < 44; });
    const noName = buttons.filter(b => !(b.getAttribute('aria-label') || b.textContent || b.getAttribute('title') || '').trim());
    const imgs = [...document.images].filter(visible);
    return { title: document.title, lang: document.documentElement.lang, h1: [...document.querySelectorAll('h1')].map(h => h.textContent.trim().slice(0, 80)),
      viewportMeta: document.querySelector('meta[name=viewport]')?.content, hScroll: document.documentElement.scrollWidth > innerWidth + 1,
      interactive: buttons.length, smallTargets: small.length, smallSample: small.slice(0, 6).map(b => (b.getAttribute('aria-label') || b.textContent || b.tagName).trim().slice(0, 40)),
      unnamedControls: noName.length, images: imgs.length, imagesWithoutAlt: imgs.filter(i => !i.hasAttribute('alt')).length,
      brokenImages: imgs.filter(i => i.complete && i.naturalWidth === 0).length,
      bodyText: document.body.innerText.replace(/\s+/g, ' ').slice(0, 600) };
  });
  // Cart and checkout walk-through (no order is submitted).
  const steps = [];
  const shot = async name => page.screenshot({ path: path.join(outDir, name), fullPage: false });
  const step = async (name, fn) => {
    try { await fn(); steps.push({ name, ok: true }); }
    catch (e) { steps.push({ name, ok: false, error: e.message.split('\n')[0].slice(0, 160) }); }
  };
  const bodyText = n => page.evaluate(max => document.body.innerText.replace(/\s+/g, ' ').slice(0, max), n);
  await step('add first product', async () => {
    await page.getByRole('button', { name: /^Agregar/ }).first().click({ timeout: 8000 });
    await page.waitForTimeout(1200); await shot('02-after-add.png');
  });
  await step('open cart', async () => {
    await page.getByRole('button', { name: /Carrito/ }).last().click({ timeout: 8000 });
    await page.waitForTimeout(1500); await shot('03-cart.png');
  });
  const cartText = await bodyText(900);
  await step('go to checkout', async () => {
    await page.getByRole('button', { name: /Continuar|Pedir|Finalizar|Confirmar|Pagar|Siguiente|Ir a/i }).first().click({ timeout: 8000 });
    await page.waitForTimeout(1500); await shot('04-checkout.png');
  });
  const checkoutText = await bodyText(1200);
  const dom2 = await page.evaluate(() => ({ hScroll: document.documentElement.scrollWidth > innerWidth + 1,
    paymentMentions: [...document.body.innerText.matchAll(/Mercado Pago|efectivo|transferencia|tarjeta/gi)].map(m => m[0].toLowerCase()) }));
  report.flow = { steps, cartText, checkoutText, dom2 };
  report.pages.push({ url: '/', loadMs, perf, dom, requests: bytes.requests, declaredBytes: bytes.total, consoleErrors, failed });
} finally {
  if (browser) await browser.close();
  const closed = await owner.rpc('close_qa_window', { p_business_id: RECOVERY_QA.a });
  report.qaWindowClosed = closed.data?.ok === true && closed.data.status === 'closed';
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 1));
  setTimeout(() => process.exit(), 300);
}
