// Campañas animadas bajo rotación física en el Moto: backend E2E en memoria + campañas aprobadas.
// Chequea packshot (píxeles), precio, marca, texto y CTA después de cada vuelta a vertical.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { openRuntimeCatalog } from '../e2e/catalog-runtime-fixture.mjs';
import { useQaCampaigns } from '../e2e/campaigns-fixture.mjs';
const { PNG } = createRequire(import.meta.url)('playwright-core/lib/utilsBundle');

const cycles = Number(process.argv[2] || 10);
const OUT = path.join(process.env.TABA_EVIDENCE_DIR || path.join(os.tmpdir(), 'taba-rotation-evidence'), `campaign-rot-${Date.now()}`); fs.mkdirSync(OUT, { recursive: true });
const adb = (...a) => execFileSync('adb', a, { encoding: 'utf8' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rotate = (n) => adb('shell', 'settings', 'put', 'system', 'user_rotation', String(n));
const log = (...a) => { const s = a.join(' '); console.log(s); fs.appendFileSync(`${OUT}/log.txt`, s + '\n'); };
adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0'); rotate(0);

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = await browser.contexts()[0].newPage();
const og = page.goto.bind(page);
page.goto = (u, o) => og(u.startsWith('/') ? `http://127.0.0.1:8080${u}` : u, o);
await og('http://127.0.0.1:8080/robots.txt');
await page.evaluate(async () => { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); for (const k of await caches.keys()) await caches.delete(k); });
await useQaCampaigns(page);
await openRuntimeCatalog(page, { view: 'home', waitForCatalog: false });
await sleep(7000);

const pieces = () => page.evaluate(() => [...document.querySelectorAll('[data-campaign]')].map((root) => {
  const r = root.getBoundingClientRect(); const pk = root.querySelector('.cmp-packshot'); const pr = pk?.getBoundingClientRect();
  const cta = root.querySelector('a,button'); const cr = cta?.getBoundingClientRect();
  return { id: root.dataset.campaign, state: root.dataset.motionCampaign, live: root.dataset.motionCampaignLive,
    x: r.x, y: r.y, w: r.width, h: r.height, inView: r.width > 0 && r.bottom > 0 && r.top < innerHeight,
    pack: pk ? { nw: pk.naturalWidth, complete: pk.complete, x: pr.x, y: pr.y, w: pr.width, h: pr.height, src: (pk.currentSrc || '').slice(-40) } : null,
    price: /\$\s?[\d.]+/.test(root.innerText), text: root.innerText.replace(/\s+/g, ' ').slice(0, 120),
    cta: cta ? { w: cr.width, h: cr.height, txt: cta.innerText.trim().slice(0, 30) } : null };
}));
function sd(png, x, y, w, h, ratio) {
  const x0 = Math.max(0, Math.round(x * ratio)), y0 = Math.max(0, Math.round(y * ratio)), x1 = Math.min(png.width, Math.round((x + w) * ratio)), y1 = Math.min(png.height, Math.round((y + h) * ratio));
  let n = 0, s = 0, s2 = 0;
  for (let j = y0; j < y1; j += 2) for (let i = x0; i < x1; i += 2) { const k = (png.width * j + i) * 4; const l = 0.299 * png.data[k] + 0.587 * png.data[k + 1] + 0.114 * png.data[k + 2]; n++; s += l; s2 += l * l; }
  const m = s / (n || 1); return n ? +Math.sqrt(Math.max(0, s2 / n - m * m)).toFixed(1) : 0;
}
async function check(tag) {
  const ps = await pieces(); const buf = await page.screenshot({ type: 'png' }); const png = PNG.sync.read(buf);
  const iw = await page.evaluate(() => innerWidth); const ratio = png.width / iw; const out = [];
  for (const p of ps.filter((q) => q.inView)) {
    const packSd = p.pack && p.pack.w > 0 ? sd(png, p.pack.x, p.pack.y, p.pack.w, p.pack.h, ratio) : null;
    out.push({ id: p.id, state: p.state, packNw: p.pack?.nw, packSd, price: p.price, cta: !!p.cta?.w, ctaTxt: p.cta?.txt, brandText: p.text.slice(0, 60) });
  }
  return { tag, found: ps.length, inView: out };
}
log('CAMPAÑAS en DOM:', JSON.stringify((await pieces()).map((p) => `${p.id}:${p.state}/${p.live}:inView=${p.inView}`)));
const base = await check('base'); log('BASE', JSON.stringify(base));
fs.writeFileSync(`${OUT}/base.png`, await page.screenshot());
let bad = 0;
for (let i = 1; i <= cycles; i++) {
  rotate(1); await sleep(2500); const land = await check('land');
  rotate(0); await sleep(1500); const early = await check('back+1.5s'); await sleep(2500); const back = await check('back+4s');
  for (const c of [land, early, back]) for (const p of c.inView) {
    const faulty = !p.price || !p.cta || (p.packNw !== undefined && (!p.packNw || (p.packSd !== null && p.packSd < 2)));
    if (faulty) { bad++; log(`  FALLA ciclo ${i} ${c.tag}`, JSON.stringify(p)); }
  }
  log(`CICLO ${i}: land=${land.inView.length} early=${early.inView.length} back=${back.inView.length} ${JSON.stringify(back.inView.map((p) => `${p.id}:pk${p.packNw}/sd${p.packSd}/$${p.price}/cta${p.cta}`))}`);
  if (i === cycles || i === 1) fs.writeFileSync(`${OUT}/back_${i}.png`, await page.screenshot());
}
log('RESULT campañas bad=', bad, 'evidencia', OUT);
rotate(0); adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '1');
await page.close(); await browser.close();
