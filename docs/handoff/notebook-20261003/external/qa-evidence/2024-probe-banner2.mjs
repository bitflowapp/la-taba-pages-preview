import { webkit, chromium, devices } from 'playwright';
const U = 'https://taba2-staging.pages.dev/';
async function medir(tipo, motor, dev) {
  const b = await motor.launch({ headless: true });
  const p = await (await b.newContext({ ...dev })).newPage();
  await p.goto(U, { waitUntil: 'load', timeout: 60000 });
  await p.waitForTimeout(9000);
  const r = await p.evaluate(() => {
    const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const banner = document.querySelector('[data-app-update-banner]');
    const navs = [...document.querySelectorAll('[data-nav-view="catalog"]')].filter(vis);
    const out = navs.map((nav) => {
      const rc = nav.getBoundingClientRect();
      const el = document.elementFromPoint(rc.left + rc.width / 2, rc.top + rc.height / 2);
      return {
        texto: (nav.innerText || nav.className).replace(/\s+/g, ' ').slice(0, 30),
        rect: { top: Math.round(rc.top), bottom: Math.round(rc.bottom), h: Math.round(rc.height) },
        recibe: !el ? 'nada'
          : el.closest('[data-app-update-banner]') ? '>>> EL BANNER LO TAPA <<<'
          : (el === nav || nav.contains(el)) ? 'ok: lo recibe la navegacion'
          : `otro: ${el.tagName}.${String(el.className).slice(0, 30)}`,
      };
    });
    const bs = banner ? getComputedStyle(banner) : null;
    return {
      viewport: { w: innerWidth, h: innerHeight },
      bannerVisible: vis(banner),
      bannerPos: bs ? { position: bs.position, zIndex: bs.zIndex, bottom: bs.bottom } : null,
      bannerRect: banner && vis(banner) ? (({ top, bottom, height }) => ({ top: Math.round(top), bottom: Math.round(bottom), h: Math.round(height) }))(banner.getBoundingClientRect()) : null,
      navsVisibles: out,
    };
  });
  console.log(`\n--- ${tipo} ---\n` + JSON.stringify(r, null, 2));
  await b.close();
}
await medir('mobile WebKit (iPhone 13)', webkit, devices['iPhone 13']);
await medir('Chromium (Pixel 7)', chromium, devices['Pixel 7']);
