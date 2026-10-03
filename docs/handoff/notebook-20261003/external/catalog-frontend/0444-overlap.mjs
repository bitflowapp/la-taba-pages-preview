import { webkit } from '@playwright/test';
import fs from 'node:fs';
const BASE = 'https://la-taba.pages.dev';
const OUT = '.local/mobile-audit';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const scan = () => {
  const path = (el) => {
    const bits = []; let n = el, d = 0;
    while (n && n.nodeType === 1 && d < 4) {
      let s = n.tagName.toLowerCase();
      if (typeof n.className === 'string' && n.className.trim()) s += '.' + n.className.trim().split(/\s+/).slice(0, 3).join('.');
      const da = [...n.attributes].map(a => a.name).find(a => a.startsWith('data-'));
      if (da) s += '[' + da + ']';
      bits.unshift(s); n = n.parentElement; d++;
    }
    return bits.join(' > ');
  };
  const shown = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0' && r.width > 0 && r.height > 0; };
  const head = document.querySelector('header.topbar, header');
  const out = { header: null, overlaps: [], attribution: [], mapOverflow: [] };
  if (head) {
    const hr = head.getBoundingClientRect();
    out.header = { h: +hr.height.toFixed(1), sel: path(head) };
    // leaf elements inside the header
    const leaves = [...head.querySelectorAll('*')].filter(e => shown(e) && (e.children.length === 0 || [...e.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim())));
    for (let i = 0; i < leaves.length; i++) {
      for (let j = i + 1; j < leaves.length; j++) {
        const a = leaves[i], b = leaves[j];
        if (a.contains(b) || b.contains(a)) continue;
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (ox > 1 && oy > 1) {
          out.overlaps.push({ a: path(a), aText: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30), b: path(b), bText: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30), overlapX: +ox.toFixed(1), overlapY: +oy.toFixed(1), aRect: [+ra.left.toFixed(0), +ra.right.toFixed(0)], bRect: [+rb.left.toFixed(0), +rb.right.toFixed(0)] });
        }
      }
    }
    // header content overflowing the header box
    for (const e of head.querySelectorAll('*')) {
      if (!shown(e)) continue;
      const r = e.getBoundingClientRect();
      if (r.right > document.documentElement.clientWidth + 1) out.overlaps.push({ note: 'sale del viewport', a: path(e), aText: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30), right: +r.right.toFixed(1), vw: document.documentElement.clientWidth });
    }
  }
  for (const e of document.querySelectorAll('.maplibregl-ctrl-attrib, .maplibregl-ctrl-logo, .mapboxgl-ctrl-attrib, [class*="attrib"], [class*="ctrl-logo"]')) {
    if (!shown(e)) continue;
    const r = e.getBoundingClientRect();
    out.attribution.push({ sel: path(e), left: +r.left.toFixed(1), right: +r.right.toFixed(1), top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), vw: document.documentElement.clientWidth, vh: window.innerHeight, text: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60), cutLeft: r.left < 0, cutRight: r.right > document.documentElement.clientWidth });
  }
  return out;
};

const b = await webkit.launch();
const out = {};
for (const w of [320, 390, 430]) {
  const h = w === 320 ? 568 : (w === 390 ? 844 : 932);
  const ctx = await b.newContext({ viewport: { width: w, height: h }, userAgent: UA, hasTouch: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: 'networkidle', timeout: 90000 });
  await p.waitForTimeout(5000);
  await p.evaluate(() => { for (const d of document.querySelectorAll('dialog[open]')) d.close(); });
  const rec = {};
  rec.home = await p.evaluate(scan);
  await p.evaluate(() => { const x = [...document.querySelectorAll('[data-nav-view]')].find(y => y.getAttribute('data-nav-view') === 'tracking'); if (x) x.click(); });
  await p.waitForTimeout(3500);
  rec.tracking = await p.evaluate(scan);
  await p.screenshot({ path: `${OUT}/shots5/${w}-tracking-head.png`, clip: { x: 0, y: 0, width: w, height: 90 } });
  out[w] = rec;
  await ctx.close();
}
await b.close();
fs.writeFileSync(OUT + '/overlap.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
