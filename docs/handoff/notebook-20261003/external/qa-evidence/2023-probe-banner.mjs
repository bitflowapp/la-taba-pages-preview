import { webkit, chromium, devices } from 'playwright';
const U = 'https://taba2-staging.pages.dev/';
async function medir(tipo, motor, dev) {
  const b = await motor.launch({ headless: true });
  const p = await (await b.newContext({ ...dev })).newPage();
  await p.goto(U, { waitUntil: 'load', timeout: 60000 });
  await p.waitForTimeout(8000);
  const r = await p.evaluate(() => {
    const banner = document.querySelector('[data-app-update-banner]');
    const nav = document.querySelector('[data-nav-view="catalog"]');
    const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    let tapa = 'sin nav';
    if (nav) {
      const rc = nav.getBoundingClientRect();
      const el = document.elementFromPoint(rc.left + rc.width / 2, rc.top + rc.height / 2);
      tapa = !el ? 'nada'
        : el.closest('[data-app-update-banner]') ? 'EL BANNER TAPA LA NAVEGACION'
        : (el === nav || nav.contains(el)) ? 'la navegacion recibe el toque'
        : `la tapa: ${el.tagName}.${String(el.className).slice(0, 40)}`;
    }
    return {
      bannerVisible: vis(banner),
      bannerTexto: banner ? (banner.innerText || '').replace(/\s+/g, ' ').slice(0, 80) : null,
      bannerRect: banner ? banner.getBoundingClientRect().toJSON() : null,
      navRect: nav ? nav.getBoundingClientRect().toJSON() : null,
      quienRecibeElToque: tapa,
    };
  });
  console.log(`\n--- ${tipo} ---\n` + JSON.stringify(r, null, 2));
  await b.close();
}
await medir('mobile WebKit (iPhone 13)', webkit, devices['iPhone 13']);
await medir('Chromium (Pixel 7)', chromium, devices['Pixel 7']);
