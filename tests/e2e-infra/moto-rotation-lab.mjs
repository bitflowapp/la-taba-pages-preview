// Laboratorio físico (SOLO LECTURA sobre el producto): Moto G15 por CDP, rotación por adb,
// chequeo de PÍXELES sobre captura del compositor. No modifica código de la tienda.
// node tests/e2e-infra/moto-rotation-lab.mjs <tab-candidate|tab-prod|pwa-prod> [ciclos] [flujo: plain|full]
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { PNG } = createRequire(import.meta.url)('playwright-core/lib/utilsBundle');

const [target = 'tab-candidate', cyclesArg = '20', flow = 'full'] = process.argv.slice(2);
const cycles = Number(cyclesArg);
const OUT = path.join(process.env.TABA_EVIDENCE_DIR || path.join(os.tmpdir(), 'taba-rotation-evidence'), `${target}-${Date.now()}`);
fs.mkdirSync(OUT, { recursive: true });
const adb = (...a) => execFileSync('adb', a, { encoding: 'utf8' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rotate = (n) => adb('shell', 'settings', 'put', 'system', 'user_rotation', String(n));
const log = (...a) => { const s = a.join(' '); console.log(s); fs.appendFileSync(`${OUT}/log.txt`, s + '\n'); };
const PWA = process.env.TABA_PWA_ACTIVITY || 'org.chromium.webapk.acb2416ec341b9b44_v2/org.chromium.webapk.shell_apk.h2o.H2OOpaqueMainActivity';

adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0');
rotate(0);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const context = browser.contexts()[0];
let page;
if (target === 'pwa-prod') {
  adb('shell', 'am', 'force-stop', PWA.split('/')[0]);
  adb('shell', 'am', 'start', '-n', PWA); await sleep(8000);
  page = context.pages().find((p) => p.url().includes('la-taba.pages.dev'));
  if (!page) throw new Error('PWA no visible por CDP: ' + context.pages().map((p) => p.url()).join(','));
} else {
  page = await context.newPage();
  if (target === 'tab-candidate') {
    const og = page.goto.bind(page);
    const cfg = { mode: 'production', repository: { provider: 'supabase', deploymentEnvironment: 'production',
      supabaseUrl: 'https://wwcpogltfgzgkrlilbcd.supabase.co', publishableKey: 'sb_publishable_Du5GdM2KXGhTGVB-rNXbzw_s_b-S8SK',
      businessId: '00000000-0000-4000-8000-000000000001', pollMs: 5000 } };
    await og('http://127.0.0.1:8080/robots.txt');
    await page.evaluate(async () => { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); for (const k of await caches.keys()) await caches.delete(k); });
    await page.addInitScript((c) => { globalThis.__LA_TABA_RUNTIME_CONFIG__ = c; localStorage.setItem('TABA_INSTALL_PROMPT_V1', JSON.stringify({ v: 1, decision: 'declined', at: '2026-01-01', platform: 'e2e' })); }, cfg);
    await og('http://127.0.0.1:8080/#catalog');
  } else {
    await page.goto('https://la-taba.pages.dev/#catalog');
  }
  await sleep(8000);
}
log('TARGET', target, page.url(), 'ua', await page.evaluate(() => navigator.userAgent.slice(0, 80)),
  'display-mode-standalone', await page.evaluate(() => matchMedia('(display-mode: standalone)').matches),
  'sw', await page.evaluate(() => !!navigator.serviceWorker?.controller));
const version = await page.evaluate(() => fetch('/version.json').then((r) => r.json()).catch(() => null));
log('VERSION', JSON.stringify(version));

// ---------- píxeles ----------
async function shot(name) {
  const buf = await page.screenshot({ type: 'png' });
  if (name) fs.writeFileSync(`${OUT}/${name}.png`, buf);
  return PNG.sync.read(buf);
}
function stats(png, rect, ratio) {
  const x0 = Math.max(0, Math.round(rect.x * ratio)), y0 = Math.max(0, Math.round(rect.y * ratio));
  const x1 = Math.min(png.width, Math.round((rect.x + rect.w) * ratio)), y1 = Math.min(png.height, Math.round((rect.y + rect.h) * ratio));
  let n = 0, sum = 0, sum2 = 0, alpha = 0;
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
    const i = (png.width * y + x) * 4; const l = 0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2];
    n++; sum += l; sum2 += l * l; alpha += png.data[i + 3];
  }
  if (!n) return { n: 0, mean: 0, sd: 0 };
  const mean = sum / n; return { n, mean: +mean.toFixed(1), sd: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(1) };
}
const visibleImgs = () => page.evaluate(() => [...document.images].map((i) => {
  const r = i.getBoundingClientRect(); const cs = getComputedStyle(i);
  return { key: (i.currentSrc || i.src).replace(/^.*\//, '').slice(0, 60), src: i.getAttribute('src')?.slice(-60), nw: i.naturalWidth, nh: i.naturalHeight, complete: i.complete,
    x: r.x, y: r.y, w: r.width, h: r.height, vis: cs.visibility, op: cs.opacity, disp: cs.display,
    inView: r.width > 60 && r.height > 60 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && cs.visibility !== 'hidden' && cs.display !== 'none' };
}).filter((i) => i.inView));
const env = () => page.evaluate(() => ({ iw: innerWidth, ih: innerHeight, dpr: devicePixelRatio, orient: screen.orientation?.type, sy: Math.round(scrollY),
  imgs: document.images.length, complete: [...document.images].filter((i) => i.complete).length, zero: [...document.images].filter((i) => i.complete && !i.naturalWidth && (i.currentSrc || i.src)).length,
  mem: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null, sw: !!navigator.serviceWorker?.controller, url: location.hash }));

const baseline = new Map(); // key -> sd medido con la imagen sana
async function sweep(record) {
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < total; y += 450) {
    await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), y); await sleep(220);
    if (record) await checkPixels('sweep', true);
  }
}
async function checkPixels(tag, learn = false) {
  const png = await shot(null); const e = await env(); const ratio = png.width / e.iw;
  const imgs = await visibleImgs(); const bads = [];
  for (const im of imgs) {
    const s = stats(png, { x: im.x, y: im.y, w: im.w, h: im.h }, ratio);
    if (learn) { if (s.sd > 6 && (!baseline.has(im.key) || baseline.get(im.key) < s.sd)) baseline.set(im.key, s.sd); continue; }
    const base = baseline.get(im.key);
    const blank = s.n > 0 && s.sd < 2.5 && (base === undefined || base > 6);
    if (blank || !im.nw || im.op === '0') bads.push({ ...im, px: s, base });
  }
  return { env: e, visible: imgs.length, bads };
}

// ---------- flujo de calentamiento ----------
async function warmup() {
  await page.evaluate(() => { location.hash = '#catalog'; }); await sleep(1500);
  await sweep(true);
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await sleep(500);
  if (flow === 'full') {
    for (let i = 0; i < 5; i++) {
      const opened = await page.evaluate((i) => { const b = [...document.querySelectorAll('[data-product-detail]')].filter((n) => n.getBoundingClientRect().width > 0)[i * 3]; if (!b) return false; b.click(); return true; }, i);
      await sleep(900); if (opened) await page.keyboard.press('Escape'); await sleep(400);
      await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    }
    for (let k = 0; k < 3; k++) { await page.evaluate(() => scrollTo({ top: 99999, behavior: 'instant' })); await sleep(250); await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await sleep(250); }
  }
  await page.evaluate(() => scrollTo({ top: 2200, behavior: 'instant' })); await sleep(1200);
  await checkPixels('learn', true);
}
await warmup();
log('BASELINE imágenes con contenido:', baseline.size, 'env', JSON.stringify(await env()));
const first = await checkPixels('base'); log('BASE bad', first.bads.length, 'visible', first.visible);
await shot('base');

async function recoverySteps() {
  const steps = [
    ['A scroll mínimo', async () => { await page.evaluate(() => scrollBy({ top: 40, behavior: 'instant' })); await sleep(1200); }],
    ['B cambiar de tab y volver', async () => { adb('shell', 'input', 'keyevent', 'KEYCODE_APP_SWITCH'); await sleep(1500); adb('shell', 'input', 'keyevent', 'KEYCODE_APP_SWITCH'); await sleep(1500); }],
    ['C ir a home y volver', async () => { await page.evaluate(() => { location.hash = '#home'; }); await sleep(1500); await page.evaluate(() => { location.hash = '#catalog'; }); await sleep(1500); }],
    ['D rotar otra vez', async () => { rotate(1); await sleep(2500); rotate(0); await sleep(2500); }],
    ['E reload', async () => { await page.reload(); await sleep(6000); }],
  ];
  for (const [name, fn] of steps) {
    await fn(); const r = await checkPixels('rec'); log('RECOVERY', name, '-> bads', r.bads.length);
    await shot('rec-' + name[0]);
    if (!r.bads.length) { log('RECOVERED_BY', name); return name; }
  }
  return null;
}

let reproduced = false, totalBad = 0;
for (let i = 1; i <= cycles && !reproduced; i++) {
  rotate(1); await sleep(2500);
  const land = await checkPixels('land');
  await page.evaluate(() => scrollBy({ top: 250, behavior: 'instant' })); await sleep(500);
  if (flow === 'full' && i % 4 === 0) { adb('shell', 'input', 'keyevent', 'KEYCODE_HOME'); await sleep(2500);
    if (target === 'pwa-prod') adb('shell', 'am', 'start', '-n', PWA); else adb('shell', 'am', 'start', '-n', 'com.android.chrome/com.google.android.apps.chrome.Main'); await sleep(2500); }
  if (flow === 'full' && i % 5 === 0) { await page.evaluate(() => { location.hash = '#home'; }); await sleep(1500); await page.evaluate(() => { location.hash = '#catalog'; }); await sleep(1500); }
  rotate(0); await sleep(2500);
  await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), 2200); await sleep(1500);
  const back = await checkPixels('back');
  adb('shell', 'screencap', '-p', `/sdcard/lab_${i}.png`); adb('pull', `/sdcard/lab_${i}.png`, `${OUT}/device_${i}.png`);
  totalBad += back.bads.length + land.bads.length;
  log(`CICLO ${i}: land bad=${land.bads.length}/${land.visible} | portrait ${JSON.stringify(back.env)} visible=${back.visible} bad=${back.bads.length}`);
  if (back.bads.length || land.bads.length) {
    reproduced = true;
    log('BUG_REPRODUCED en ciclo', i, JSON.stringify((back.bads.length ? back : land).bads.slice(0, 5)));
    await shot('bug'); fs.writeFileSync(`${OUT}/bug.json`, JSON.stringify({ land, back }, null, 1));
    await recoverySteps();
  }
}
log('RESULT', target, 'BUG_REPRODUCED', reproduced, 'totalBad', totalBad, 'ciclos', cycles, 'evidencia', OUT);
rotate(0); adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '1');
await browser.close().catch(() => {});
