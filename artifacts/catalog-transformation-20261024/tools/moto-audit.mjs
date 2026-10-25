// Recorrido de compra en el Moto G15 físico. Uso:
//   node artifacts/catalog-transformation-20261024/tools/moto-audit.mjs antes|despues
// Saca capturas reales (adb screencap) y mide la geometría de cada paso.
import path from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { connect, metrics, screencap, sleep, adb, personaTocando, tap, tapXY, BASE } from './moto.mjs';

const etapa = process.argv[2] || 'antes';
const out = path.resolve('artifacts/catalog-transformation-20261024/capturas', etapa, 'moto-real');
mkdirSync(out, { recursive: true });
const URL_VITRINA = `${BASE}/?reset=1&demo=1&vitrina=neuquen20261024`;

if (personaTocando(4)) {
  console.error('Hay una persona tocando el Moto: no se mide ahora.');
  process.exit(3);
}

const { browser, page } = await connect();
const report = { etapa, fecha: new Date().toISOString(), pasos: [] };

// La hoja de instalación (modal) aparece cuando la persona queda quieta: se declina y se sigue.
async function despejar() {
  for (let i = 0; i < 3; i += 1) {
    const abierta = await page.evaluate(() => !!document.querySelector('[data-install-sheet][open]'));
    if (!abierta) return;
    await tap(page, page.locator('[data-install-sheet] [data-install-decline]:visible').first());
    await sleep(600);
  }
}

async function paso(nombre, fn) {
  const entry = { nombre };
  try {
    await despejar();
    await fn(entry);
  } catch (error) {
    entry.error = String(error.message || error).split('\n')[0];
  }
  await despejar().catch(() => {});
  report.pasos.push(entry);
  console.log(entry.nombre, entry.error ? `ERROR ${entry.error}` : 'ok', JSON.stringify(entry.m || {}));
}

const shot = async (name) => { await sleep(500); screencap(path.join(out, `${name}.png`)); };

// Cuántas tarjetas de producto aparecen completas sin desplazarse y qué se ve de cada una.
const tarjetasVisibles = (selector) => page.evaluate((sel) => {
  const nav = document.querySelector('.mobile-nav')?.getBoundingClientRect();
  const top = document.querySelector('.topbar')?.getBoundingClientRect();
  const limit = nav ? nav.top : window.innerHeight;
  const floor = top ? top.bottom : 0;
  const cards = [...document.querySelectorAll(sel)].filter((card) => card.offsetParent !== null);
  const rows = cards.slice(0, 12).map((card) => {
    const r = card.getBoundingClientRect();
    const price = card.querySelector('.price strong, .price-amounts strong, [data-price], .home-best-copy > span:last-child')?.getBoundingClientRect();
    const add = card.querySelector('[data-add-product], .add-button')?.getBoundingClientRect();
    return {
      y: Math.round(r.y), h: Math.round(r.height), w: Math.round(r.width),
      enteraVisible: r.top >= floor - 1 && r.bottom <= limit + 1,
      precioVisible: !!price && price.top >= floor && price.bottom <= limit,
      agregarVisible: !!add && add.top >= floor && add.bottom <= limit,
      agregarH: add ? Math.round(add.height) : null,
    };
  });
  return {
    viewportUtil: Math.round(limit - floor),
    completas: rows.filter((r) => r.enteraVisible).length,
    conPrecio: rows.filter((r) => r.precioVisible).length,
    conAgregar: rows.filter((r) => r.agregarVisible).length,
    primeras: rows.slice(0, 4),
  };
}, selector);

await paso('00-carga', async (e) => {
  const t0 = Date.now();
  await page.goto(URL_VITRINA, { waitUntil: 'load' });
  // ?reset=1 limpia el almacenamiento y recarga sin el parámetro: se espera a la segunda carga.
  for (let i = 0; i < 40; i += 1) {
    const listo = await page.evaluate(() => !location.search.includes('reset') && !!document.querySelector('[data-view="home"] .home-best-card')).catch(() => false);
    if (listo) break;
    await sleep(500);
  }
  await sleep(1500);
  // Chrome restaura el valor del buscador al recargar y la app lo toma como búsqueda nueva:
  // se parte de un almacenamiento vacío y de una navegación nueva (sin ?reset).
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); indexedDB.deleteDatabase('taba-sandbox'); });
  await page.goto(`${BASE}/?demo=1&vitrina=neuquen20261024&n=${Date.now()}`, { waitUntil: 'load' });
  await page.waitForSelector('[data-view="home"] .home-best-card', { timeout: 30000 });
  await sleep(1200);
  e.m = { cargaMs: Date.now() - t0, ...(await metrics(page)) };
  delete e.m.ua;
});

await paso('01-home-arriba', async (e) => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('01-home-arriba');
  e.m = await tarjetasVisibles('[data-view="home"] .home-best-card');
});

for (const [i, y] of [[2, 780], [3, 1560], [4, 2340], [5, 3120]]) {
  await paso(`0${i}-home-scroll-${y}`, async (e) => {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await shot(`0${i}-home-scroll-${y}`);
    e.m = { scrollY: await page.evaluate(() => Math.round(window.scrollY)) };
  });
}

await paso('06-historias', async (e) => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await tap(page, '.brand-hero .brand-logo-action');
  await page.waitForSelector('[data-stories-modal][open]', { timeout: 8000 });
  await sleep(900);
  await shot('06-historias');
  e.m = await page.evaluate(() => {
    const b = document.querySelector('[data-stories-modal]').getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  await tap(page, '[data-close-stories]');
});

await paso('07-catalogo', async (e) => {
  await page.evaluate(() => { window.location.hash = '#catalog'; });
  await page.waitForSelector('[data-view="catalog"] [data-product-grid] article[data-card-product]');
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(600);
  await shot('07-catalogo-arriba');
  e.m = await tarjetasVisibles('[data-view="catalog"] [data-product-grid] article[data-card-product]');
});

await paso('08-catalogo-scroll', async (e) => {
  await page.evaluate(() => window.scrollTo(0, 900));
  await shot('08-catalogo-scroll-900');
  await page.evaluate(() => window.scrollTo(0, 2400));
  await shot('09-catalogo-scroll-2400');
  e.m = { total: await page.locator('[data-view="catalog"] [data-product-grid] article[data-card-product]').count() };
});

await paso('10-categoria-cervezas', async (e) => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await tap(page, page.locator('[data-view="catalog"] [data-category-id="cervezas"], [data-view="catalog"] [data-category="cervezas"]').first());
  await sleep(700);
  await shot('10-categoria-cervezas');
  e.m = { titulo: await page.locator('[data-catalog-title]').textContent(), ...(await tarjetasVisibles('[data-view="catalog"] [data-product-grid] article[data-card-product]')) };
});

await paso('11-busqueda-teclado', async (e) => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await tap(page, page.locator('[data-view="catalog"] input[type="search"]:visible, [data-view="catalog"] [data-search-input]:visible').first());
  await sleep(1200);
  adb('shell', 'input', 'text', 'coca');
  await sleep(1500);
  await shot('11-busqueda-coca-teclado');
  e.m = await page.evaluate(() => {
    const vv = window.visualViewport;
    const el = document.activeElement;
    const r = el.getBoundingClientRect();
    return {
      activo: el.tagName + (el.type ? `[${el.type}]` : ''),
      visualH: Math.round(vv.height), layoutH: window.innerHeight,
      inputY: Math.round(r.y), inputBottom: Math.round(r.bottom),
      inputVisible: r.bottom <= vv.height && r.top >= 0,
      valor: el.value,
    };
  });
  adb('shell', 'input', 'keyevent', 'KEYCODE_ENTER');
  await sleep(800);
  await shot('12-busqueda-resultado');
  e.m.alcanceCategoria = await page.locator('[data-search-everywhere]:visible').count();
  if (e.m.alcanceCategoria) { await page.evaluate(() => document.activeElement?.blur()); await sleep(500); await tap(page, '[data-search-everywhere]'); await sleep(900); await shot('12b-busqueda-en-todo'); }
});

await paso('13-ficha-producto', async (e) => {
  // Cierra el teclado con un toque neutro en el título del catálogo (no «Atrás»).
  await page.evaluate(() => document.activeElement?.blur());
  await sleep(600);
  await tap(page, page.locator('[data-view="catalog"] [data-product-grid] article[data-card-product] .product-media').first());
  await page.waitForSelector('[data-modal-product-id]', { state: 'visible', timeout: 8000 });
  await sleep(700);
  await shot('13-ficha');
  e.m = await page.evaluate(() => {
    const m = document.querySelector('[data-modal-product-id]').getBoundingClientRect();
    const add = document.querySelector('[data-modal-product-id] [data-add-product]')?.getBoundingClientRect();
    return { modalH: Math.round(m.height), agregarY: add ? Math.round(add.y) : null, agregarH: add ? Math.round(add.height) : null, vh: window.innerHeight };
  });
});

await paso('14-agregar-y-carrito', async (e) => {
  await tap(page, '[data-modal-product-id] [data-add-product]');
  await sleep(700);
  await shot('14-agregado');
  const close = page.locator('[data-modal-product-id] [data-close-modal]:visible').first();
  if (await close.count()) await tap(page, close);
  await sleep(500);
  const grid = '[data-view="catalog"] [data-product-grid] article[data-card-product]';
  await tap(page, page.locator(`${grid} [data-add-product]`).nth(1));
  await tap(page, page.locator(`${grid} [data-add-product]`).nth(2)).catch(() => {});
  await sleep(500);
  await shot('15-catalogo-con-carrito-flotante');
  e.m = await page.evaluate(() => {
    const fab = document.querySelector('[data-floating-cart]');
    const r = fab?.getBoundingClientRect();
    return { fab: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null, count: document.querySelector('[data-cart-count]')?.textContent };
  });
});

await paso('16-carrito', async (e) => {
  await tap(page, '[data-floating-cart]');
  await page.waitForSelector('[data-view="cart"]', { state: 'visible' });
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(700);
  await shot('16-carrito-arriba');
  e.m = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[data-view="cart"] .cart-item')].map((i) => Math.round(i.getBoundingClientRect().height));
    return { lineas: items, alto: document.documentElement.scrollHeight };
  });
});

await paso('17-checkout-formulario', async (e) => {
  await page.evaluate(() => document.querySelector('[data-view="cart"] .checkout-form')?.scrollIntoView({ block: 'start' }));
  await sleep(700);
  await shot('17-checkout-formulario');
  await page.evaluate(() => window.scrollBy(0, 700));
  await sleep(500);
  await shot('18-checkout-medio');
  e.m = await page.evaluate(() => {
    const bar = document.querySelector('[data-view="cart"] .checkout-form .button-row');
    const nav = document.querySelector('.mobile-nav').getBoundingClientRect();
    const b = bar?.getBoundingClientRect();
    return { barraY: b && Math.round(b.y), barraH: b && Math.round(b.height), navY: Math.round(nav.y), total: bar?.dataset.checkoutTotal };
  });
});

await paso('19-confirmar-demo', async (e) => {
  await tap(page, '[data-view="cart"] [data-checkout-submit]');
  await sleep(1500);
  await shot('19-pedido-confirmado');
  e.m = { toast: await page.locator('.toast:visible').first().textContent().catch(() => null) };
});

writeFileSync(path.join(out, 'informe.json'), JSON.stringify(report, null, 2));
await browser.close();
console.log('listo →', out);
