// Campañas REALES en el Moto G15 con el catálogo VIVO de producción (sólo lectura).
//   node tests/e2e-infra/moto-live-campaigns.mjs [ciclos=10] [origen=http://127.0.0.1:8080]
// Requiere: servidor del sitio (scripts/realtime-relay.mjs 8080), `adb reverse tcp:8080 tcp:8080`
// y `adb forward tcp:9222 localabstract:chrome_devtools_remote`.
//
// 1. Piezas en pantalla: marca, presentación, precio vivo y foto real.
// 2. CTA -> ficha del MISMO producto -> el precio de la ficha y del carrito es el de la pieza.
// 3. Rotación vertical -> horizontal -> vertical con chequeo de PÍXELES (captura del compositor).
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { PNG } = createRequire(import.meta.url)('playwright-core/lib/utilsBundle');

const cycles = Number(process.argv[2] || 10);
const ORIGIN = process.argv[3] || 'http://127.0.0.1:8080';
const OUT = path.join(process.env.TABA_EVIDENCE_DIR || path.join(os.tmpdir(), 'taba-rotation-evidence'), `live-campaigns-${Date.now()}`);
fs.mkdirSync(OUT, { recursive: true });
const adb = (...a) => execFileSync('adb', a, { encoding: 'utf8' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rotate = (n) => adb('shell', 'settings', 'put', 'system', 'user_rotation', String(n));
const log = (...a) => { const s = a.join(' '); console.log(s); fs.appendFileSync(`${OUT}/log.txt`, `${s}\n`); };

adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0'); rotate(0);
const configText = await (await fetch('https://la-taba.pages.dev/runtime-config.js')).text();
const grab = (key) => configText.match(new RegExp(`${key}:\\s*'([^']+)'`))?.[1];
const CONFIG = { mode: 'production', repository: { provider: 'supabase', deploymentEnvironment: 'production',
  supabaseUrl: grab('supabaseUrl'), publishableKey: grab('publishableKey'), businessId: grab('businessId'), pollMs: 5000 } };

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = await browser.contexts()[0].newPage();
await page.goto(`${ORIGIN}/robots.txt`).catch(() => undefined);
await page.evaluate(async () => { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); for (const k of await caches.keys()) await caches.delete(k); localStorage.clear(); }).catch(() => undefined);
await page.addInitScript((c) => {
  globalThis.__LA_TABA_RUNTIME_CONFIG__ = c;
  try { localStorage.setItem('TABA_INSTALL_PROMPT_V1', JSON.stringify({ v: 1, decision: 'declined', at: '2026-01-01', platform: 'e2e' })); } catch { /* sin storage */ }
}, CONFIG);
await page.goto(`${ORIGIN}/#home`);
await page.waitForSelector('[data-home-hero-promo] [data-campaign]', { timeout: 60000 });
await sleep(7000);

const pieces = () => page.evaluate(() => [...document.querySelectorAll('[data-home-hero-promo] [data-campaign], [data-home-campaign] [data-campaign]')].filter((r) => r.getBoundingClientRect().width > 0).map((root) => {
  const pk = root.querySelector('img.cmp-packshot'); const r = root.getBoundingClientRect(); const pr = pk?.getBoundingClientRect();
  return { id: root.dataset.campaign, placement: root.dataset.campaignPlacement, productId: root.querySelector('[data-campaign-cta]')?.dataset.productDetail,
    brand: root.querySelector('.cmp-eyebrow')?.textContent.trim(), sub: root.querySelector('.cmp-sub')?.textContent.replace(/\s+/g, ' ').trim(),
    price: root.querySelector('.cmp-price-now')?.textContent.trim(), cta: root.querySelector('.cmp-cta')?.textContent.trim(),
    text: root.innerText.replace(/\s+/g, ' ').slice(0, 140),
    pack: pk ? { nw: pk.naturalWidth, complete: pk.complete, src: (pk.currentSrc || '').replace(/^.*\//, ''), x: pr.x, y: pr.y, w: pr.width, h: pr.height } : null,
    box: { x: r.x, y: r.y, w: r.width, h: r.height } };
}));
const stdDev = (png, x, y, w, h, ratio) => {
  const x0 = Math.max(0, Math.round(x * ratio)), y0 = Math.max(0, Math.round(y * ratio)), x1 = Math.min(png.width, Math.round((x + w) * ratio)), y1 = Math.min(png.height, Math.round((y + h) * ratio));
  let n = 0, s = 0, s2 = 0;
  for (let j = y0; j < y1; j += 2) for (let i = x0; i < x1; i += 2) { const k = (png.width * j + i) * 4; const l = 0.299 * png.data[k] + 0.587 * png.data[k + 1] + 0.114 * png.data[k + 2]; n++; s += l; s2 += l * l; }
  const m = s / (n || 1); return n ? +Math.sqrt(Math.max(0, s2 / n - m * m)).toFixed(1) : 0;
};
async function measure(tag) {
  const ps = (await pieces()).filter((p) => p.box.y + p.box.h > 0 && p.box.y < 4000);
  const inView = await page.evaluate(() => innerHeight);
  const png = PNG.sync.read(await page.screenshot({ type: 'png' }));
  const ratio = png.width / (await page.evaluate(() => innerWidth));
  return { tag, inView, pieces: ps.filter((p) => p.box.y < inView && p.box.y + p.box.h > 0).map((p) => ({
    ...p, packSd: p.pack && p.pack.w > 0 ? stdDev(png, p.pack.x, p.pack.y, p.pack.w, p.pack.h, ratio) : null })) };
}

// ---------- video ----------
adb('shell', 'rm', '-f', '/sdcard/taba-live.mp4');
import('node:child_process').then(({ spawn }) => { globalThis.__rec = spawn('adb', ['shell', 'screenrecord', '--time-limit', '170', '--bit-rate', '4000000', '/sdcard/taba-live.mp4'], { stdio: 'ignore' }); });
await sleep(1500);

// ---------- 1. piezas ----------
await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
const all = await pieces();
log('PIEZAS EN LA HOME:', JSON.stringify(all.map((p) => ({ id: p.id, placement: p.placement, brand: p.brand, sub: p.sub, price: p.price, cta: p.cta, foto: p.pack?.src, nw: p.pack?.nw }))));
adb('shell', 'screencap', '-p', '/sdcard/live_home.png'); adb('pull', '/sdcard/live_home.png', `${OUT}/home.png`);
log('CAMPAIGNS_VISIBLE_WITH_LIVE_BACKEND:', all.length);

// ---------- 2. CTA -> ficha -> carrito ----------
const money = (n) => page.evaluate((v) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(v), n);
for (const piece of all) {
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await page.locator(`[data-campaign="${piece.id}"][data-campaign-placement="${piece.placement}"] [data-campaign-cta]`).scrollIntoViewIfNeeded();
  await page.locator(`[data-campaign="${piece.id}"][data-campaign-placement="${piece.placement}"] [data-campaign-cta]`).click();
  await page.waitForSelector('[data-product-modal][open], [data-product-modal]:not([hidden])', { timeout: 10000 });
  await sleep(700);
  const modal = await page.evaluate(() => ({ price: document.querySelector('[data-product-modal] .modal-price strong')?.textContent.trim(), title: document.querySelector('[data-product-modal] h2, [data-product-modal] h3')?.textContent.trim(), text: document.querySelector('[data-product-modal]')?.innerText.replace(/\s+/g, ' ').slice(0, 160) }));
  adb('shell', 'screencap', '-p', '/sdcard/live_modal.png'); adb('pull', '/sdcard/live_modal.png', `${OUT}/ficha-${piece.id}.png`);
  await page.locator('[data-product-modal] .modal-cart-control[data-add-product]').click();
  await sleep(900);
  await page.locator('[data-nav-view="cart"] >> visible=true').first().click();
  await sleep(900);
  const line = await page.evaluate(() => [...document.querySelectorAll('.cart-item')].map((i) => ({ name: i.querySelector('.cart-item-name, h3, strong')?.textContent.trim(), line: i.querySelector('.cart-line')?.textContent.trim() })));
  adb('shell', 'screencap', '-p', '/sdcard/live_cart.png'); adb('pull', '/sdcard/live_cart.png', `${OUT}/carrito-${piece.id}.png`);
  const okFicha = modal.price === piece.price; const okCarrito = line.some((l) => l.line === piece.price);
  log(`CTA ${piece.id}: pieza=${piece.price} ficha=${modal.price} (${okFicha ? 'IGUAL' : 'DISTINTO'}) carrito=${JSON.stringify(line)} (${okCarrito ? 'IGUAL' : 'DISTINTO'}) ficha-texto="${modal.text?.slice(0, 80)}"`);
  await page.locator('.mobile-nav [data-nav-view="home"]:visible').first().click(); await sleep(1200);
}

// ---------- 3. rotación ----------
await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await sleep(800);
const base = await measure('base');
log('BASE píxeles:', JSON.stringify(base.pieces.map((p) => ({ id: p.id, sd: p.packSd, nw: p.pack?.nw, price: p.price }))));
let bad = 0;
for (let i = 1; i <= cycles; i++) {
  rotate(1); await sleep(2500); const land = await measure('land');
  rotate(0); await sleep(1200); const early = await measure('back+1s'); await sleep(2500); const back = await measure('back+4s');
  for (const m of [land, early, back]) for (const p of m.pieces) {
    const faulty = !p.price || !p.cta || !p.pack || !p.pack.nw || (p.packSd !== null && p.packSd < 2);
    if (faulty) { bad++; log(`  FALLA ciclo ${i} ${m.tag} ${p.id}`, JSON.stringify({ sd: p.packSd, nw: p.pack?.nw, price: p.price })); }
  }
  log(`CICLO ${i}: land=${land.pieces.length} back=${back.pieces.length} ${JSON.stringify(back.pieces.map((p) => `${p.id}:sd${p.packSd}:${p.price}`))}`);
}
adb('shell', 'screencap', '-p', '/sdcard/live_end.png'); adb('pull', '/sdcard/live_end.png', `${OUT}/final.png`);
log(`RESULT campañas reales rotación: fallas=${bad} ciclos=${cycles} evidencia=${OUT}`);
rotate(0); adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '1');
await sleep(2000);
try { globalThis.__rec?.kill(); } catch { /* ya terminó */ }
await sleep(3000);
try { adb('pull', '/sdcard/taba-live.mp4', `${OUT}/video.mp4`); } catch { log('(no se pudo bajar el video)'); }
await page.close(); await browser.close();

