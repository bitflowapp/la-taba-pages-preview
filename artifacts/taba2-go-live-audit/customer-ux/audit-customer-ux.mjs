/*
 * Auditoría READ-ONLY de la experiencia CUSTOMER de La Taba en producción.
 * https://la-taba.pages.dev — cliente anónimo, viewport móvil 390x844.
 *
 * REGLAS: navegación y lectura. Se agrega al carrito (memoria del navegador),
 * se ABRE el checkout para leer medios de pago, y JAMÁS se envía el formulario:
 * este script no toca [data-checkout-submit] ni llama requestSubmit().
 * Además registra todo request mutante (POST/PUT/PATCH/DELETE) como prueba
 * de que el recorrido no escribió nada.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HOST = process.env.TABA_HOST || 'https://la-taba.pages.dev';
const OUT = dirname(fileURLToPath(import.meta.url));
const FOLD = 844;

const R = {
  meta: { host: HOST, fecha: new Date().toISOString(), viewport: '390x844', reducedMotion: 'reduce' },
  problemas: [],
  consola: { errores: [], pageerrors: [], requestsFallidos: [], respuestas4xxPlus: [], requestsMutantes: [] },
};
const fase = async (nombre, fn) => {
  try { await fn(); console.log(`OK   ${nombre}`); }
  catch (e) { R.problemas.push(`${nombre}: ${e.message}`); console.log(`FALLO ${nombre}: ${e.message}`); }
};

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  reducedMotion: 'reduce',
  locale: 'es-AR',
});
page.setDefaultTimeout(25000);
page.on('console', (m) => { if (m.type() === 'error') R.consola.errores.push(m.text().slice(0, 400)); });
page.on('pageerror', (e) => R.consola.pageerrors.push(String(e.message).slice(0, 400)));
page.on('requestfailed', (r) => R.consola.requestsFallidos.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText}`));
page.on('response', (r) => { if (r.status() >= 400) R.consola.respuestas4xxPlus.push(`${r.status()} ${r.url()}`); });
page.on('request', (r) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method())) {
    R.consola.requestsMutantes.push(`${r.method()} ${r.url()}`);
  }
});

const shot = (name) => page.screenshot({ path: join(OUT, name), fullPage: false });
const despertar = async () => page.evaluate(async () => {
  const paso = window.innerHeight;
  for (let y = 0; y < document.body.scrollHeight; y += paso) {
    window.scrollTo(0, y);
    await new Promise((listo) => setTimeout(listo, 120));
  }
  window.scrollTo(0, 0);
  await new Promise((listo) => setTimeout(listo, 300));
});

// ── 0 · llegar y esperar el catálogo ─────────────────────────────────────────
await page.goto(`${HOST}/#home`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(async () => {
  const { getState } = await import('/js/state.js');
  return getState().products.length > 0;
}, null, { timeout: 30000 });
await page.waitForTimeout(1800);

// ── 1 · estado del cliente: catálogo completo tal como llega ────────────────
await fase('estado del cliente (getState)', async () => {
  R.catalogo = await page.evaluate(async () => {
    const { getState } = await import('/js/state.js');
    const s = getState();
    return {
      productos: s.products.map((p) => ({
        id: p.id, sku: p.sku, name: p.name,
        presentation: p.presentation || p.variant || p.unitLabel || p.packageType || '',
        categoryId: p.categoryId, categoryName: p.categoryName,
        price: p.price, pricePending: p.pricePending === true,
        available: p.available, stock: p.stock,
        alcoholic: p.alcoholic, featured: p.featured === true, popular: p.popular === true,
        unitsPerPack: p.unitsPerPack,
        image: p.image || null, imageThumbnail: p.imageThumbnail || null,
      })),
      categorias: (s.categories || []).map((c) => ({ id: c.id, name: c.name, sortOrder: c.sortOrder })),
    };
  });
});

// ── 2 · HOME: el pliegue (390x844) ──────────────────────────────────────────
await fase('home: pliegue', async () => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await shot('01-home-pliegue.png');
  R.homePliegue = await page.evaluate((FOLD) => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 1 && r.height > 1 && r.top < FOLD && r.bottom > 0
        && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const bloques = [...document.querySelectorAll('[data-view="home"] > *, [data-view="home"] > * > section')]
      .filter(vis)
      .map((el) => ({
        clase: (el.className || '').toString().split(' ').slice(0, 3).join(' '),
        titulo: (el.querySelector('h1,h2,h3')?.textContent || '').trim().slice(0, 80),
        top: Math.round(el.getBoundingClientRect().top),
      }))
      .sort((a, b) => a.top - b.top).slice(0, 14);
    const tarjetas = [...document.querySelectorAll('.home-best-card, .product-card, .home-promo-card, .offer-card, .home-combo-card')];
    const tarjetasVisibles = tarjetas.filter(vis);
    const tarjetasCompletas = tarjetasVisibles.filter((el) => {
      const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= FOLD;
    });
    const precios = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const t = walker.currentNode.textContent;
      if (/\$\s?\d/.test(t)) {
        const el = walker.currentNode.parentElement;
        if (el && vis(el)) precios.push(t.trim().replace(/\s+/g, ' ').slice(0, 40));
      }
    }
    const categoriasVisibles = [...document.querySelectorAll('[data-view="home"] [data-category-id]')]
      .filter(vis).map((el) => el.textContent.trim());
    const nav = [...document.querySelectorAll('nav a, nav button, .tabbar a, .tabbar button, [data-nav-view]')]
      .filter(vis).map((el) => el.textContent.trim().replace(/\s+/g, ' ')).filter(Boolean);
    const header = (document.querySelector('header')?.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 200);
    return {
      titulo: document.title,
      header,
      bloquesVisibles: bloques,
      tarjetasProductoVisibles: tarjetasVisibles.length,
      tarjetasProductoCompletas: tarjetasCompletas.length,
      preciosVisibles: precios,
      categoriasVisibles,
      navegacionVisible: [...new Set(nav)].slice(0, 12),
    };
  }, FOLD);
});

// ── 3 · HOME: orden real de productos (primeros 10 en orden DOM) ────────────
await fase('home: orden de productos', async () => {
  R.homeOrden = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-view="home"] .home-best-card, [data-view="home"] .offer-card, [data-view="home"] .home-promo-card')];
    return cards.map((c) => {
      const seccion = c.closest('section')?.querySelector('h2, h3')?.textContent?.trim() || '';
      const nombre = c.querySelector('strong')?.textContent?.trim() || '';
      const unidad = c.querySelector('small')?.textContent?.trim() || '';
      const precio = (c.textContent.match(/\$\s?[\d.,]+/) || [''])[0];
      return { seccion, nombre, unidad, precio };
    }).filter((c) => c.nombre);
  });
  R.homeSecciones = await page.evaluate(() => [...document.querySelectorAll('[data-home-sections] .home-category-section')]
    .map((s) => ({ titulo: s.querySelector('h2')?.textContent?.trim() || '', tarjetas: s.querySelectorAll('.home-best-sellers > *').length })));
  await despertar();
  await page.screenshot({ path: join(OUT, '02-home-completa.png'), fullPage: true });
});

// ── 4 · CATÁLOGO: grilla completa, fotos vs fallback ────────────────────────
await page.goto(`${HOST}/#catalog`, { waitUntil: 'networkidle' });
await page.locator('[data-product-grid] .product-card').first().waitFor({ timeout: 30000 });
await page.waitForTimeout(600);

await fase('catalogo: grilla y fotos', async () => {
  R.grilla = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-product-grid] .product-card')];
    return {
      total: cards.length,
      conFoto: document.querySelectorAll('[data-product-grid] .product-card .thumb.has-photo').length,
      placeholder: document.querySelectorAll('[data-product-grid] .product-card .thumb.uses-placeholder').length,
      primeras3: cards.slice(0, 3).map((c) => c.innerText.trim().replace(/\n+/g, ' | ').slice(0, 160)),
      ordenTodos: cards.map((c) => ({
        nombre: c.querySelector('.product-body h3')?.textContent?.trim() || '',
        presentacion: c.querySelector('.product-body p')?.textContent?.trim() || '',
        precio: (c.querySelector('.price')?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
        foto: Boolean(c.querySelector('.thumb.has-photo')),
      })),
    };
  });
  R.ordenador = await page.evaluate(() => {
    const sel = document.querySelector('[data-view="catalog"] select');
    return sel ? { opciones: [...sel.options].map((o) => o.textContent.trim()), activa: sel.selectedOptions[0]?.textContent?.trim() } : null;
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await shot('03-catalogo-todos.png');
  await despertar();
  await page.screenshot({ path: join(OUT, '04-catalogo-completo.png'), fullPage: true });
  await page.evaluate(() => window.scrollTo(0, 0));
});

// ── 5 · CATEGORÍAS: chips y conteo por categoría en la grilla ───────────────
await fase('categorias: conteos', async () => {
  const chips = await page.evaluate(() => [...document.querySelectorAll('[data-view="catalog"] [data-category-id]')]
    .map((el) => ({ id: el.getAttribute('data-category-id'), label: el.textContent.trim() })));
  R.categoriasChips = chips;
  R.categoriasConteo = [];
  for (const chip of chips.filter((c) => c.id && c.id !== 'all' && c.id !== 'favorites')) {
    await page.locator(`[data-view="catalog"] [data-category-id="${chip.id}"]`).first().click();
    await page.waitForTimeout(450);
    const n = await page.locator('[data-product-grid] .product-card').count();
    R.categoriasConteo.push({ ...chip, tarjetas: n });
    if (chip.id === 'gaseosas') {
      R.gaseosasOrden = await page.evaluate(() => [...document.querySelectorAll('[data-product-grid] .product-card')]
        .map((c) => ({
          nombre: c.querySelector('.product-body h3')?.textContent?.trim() || '',
          presentacion: c.querySelector('.product-body p')?.textContent?.trim() || '',
          precio: (c.querySelector('.price')?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
        })));
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(250);
      await shot('05-categoria-gaseosas.png');
    }
  }
  await page.locator('[data-view="catalog"] [data-category-id="all"]').first().click();
  await page.waitForTimeout(400);
});

// ── 6 · BÚSQUEDA: coca / cerveza / agua ─────────────────────────────────────
await fase('busqueda', async () => {
  const buscador = page.locator('[data-view="catalog"] [data-search-input]');
  R.busquedas = {};
  const consultas = [['coca', '06-busqueda-coca.png'], ['cerveza', '07-busqueda-cerveza.png'], ['agua', '08-busqueda-agua.png']];
  for (const [q, png] of consultas) {
    await buscador.fill(q);
    await page.waitForTimeout(500);
    R.busquedas[q] = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('[data-product-grid] .product-card')];
      return {
        resultados: cards.length,
        nombres: cards.map((c) => `${c.querySelector('.product-body h3')?.textContent?.trim()} · ${c.querySelector('.product-body p')?.textContent?.trim()}`).slice(0, 12),
        vacio: cards.length === 0 ? (document.querySelector('[data-product-grid]')?.innerText || document.querySelector('[data-view="catalog"]')?.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 300) : null,
      };
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
    await shot(png);
  }
  await buscador.fill('');
  await page.waitForTimeout(400);
});

// ── 7 · FICHA DE PRODUCTO: una con foto y una con fallback ──────────────────
await fase('ficha de producto', async () => {
  R.fichas = {};
  const abrirFicha = async (cardSelector, clave, png) => {
    const card = page.locator(cardSelector).first();
    if (!(await card.count())) { R.fichas[clave] = { error: 'no hay tarjeta que matchee' }; return; }
    await card.locator('[data-product-detail]').first().click();
    await page.locator('[data-product-modal]').waitFor({ state: 'visible' });
    await page.waitForTimeout(400);
    R.fichas[clave] = await page.evaluate(() => {
      const m = document.querySelector('[data-product-modal]');
      const thumb = m.querySelector('.thumb');
      return {
        texto: m.innerText.trim().replace(/\n{2,}/g, '\n').slice(0, 900),
        tieneFoto: Boolean(m.querySelector('.thumb.has-photo')),
        placeholderAnunciado: thumb?.classList.contains('uses-placeholder') ? (thumb.getAttribute('aria-label') || '(sin aria-label)') : null,
        imagenesRotas: [...m.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth === 0).length,
      };
    });
    await shot(png);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  };
  await abrirFicha('[data-product-grid] .product-card:has(.thumb.has-photo)', 'conFoto', '09-ficha-con-foto.png');
  await abrirFicha('[data-product-grid] .product-card:has(.thumb.uses-placeholder)', 'fallback', '10-ficha-fallback.png');
});

// ── 8 · CARRITO: 2 productos, subtotal, mínimo, fee, medios de pago ─────────
await fase('carrito y checkout (sin confirmar)', async () => {
  // Dos productos distintos: el primero y otro de otra tarjeta habilitada.
  const botones = page.locator('[data-product-grid] [data-add-product]:not([disabled])');
  const total = await botones.count();
  if (total < 2) throw new Error(`solo ${total} botones de agregar habilitados`);
  const agregados = [];
  for (const idx of [0, Math.min(5, total - 1)]) {
    const b = botones.nth(idx);
    await b.scrollIntoViewIfNeeded();
    agregados.push(await b.getAttribute('data-add-product'));
    await b.click();
    await page.waitForTimeout(350);
  }
  R.carrito = { agregados };
  R.carrito.estadoCart = await page.evaluate(async () => {
    const { getState } = await import('/js/state.js');
    return getState().cart.map((i) => ({ productId: i.productId, quantity: i.quantity }));
  });

  await page.locator('[data-open-cart] >> visible=true').first().click();
  await page.waitForTimeout(1000);
  R.carrito.vista = await page.evaluate(() => {
    const txt = (sel) => (document.querySelector(sel)?.innerText || '').trim().replace(/\s+\n/g, '\n').replace(/\n{2,}/g, '\n');
    return {
      lineas: document.querySelectorAll('[data-cart-list] .cart-item').length,
      listaTexto: txt('[data-cart-list]').slice(0, 700),
      minimoTexto: txt('[data-cart-minimum-progress]').slice(0, 400),
      avisoTexto: txt('[data-cart-notice]').slice(0, 300),
      resumenTexto: txt('[data-order-summary]').slice(0, 600),
      medioPagoOpciones: [...document.querySelectorAll('select[name="paymentMethod"] option')].map((o) => o.textContent.trim()),
      medioPagoActivo: document.querySelector('select[name="paymentMethod"]')?.selectedOptions[0]?.textContent?.trim(),
      notaModo: txt('[data-checkout-mode-note]'),
      botonEnviarTexto: (document.querySelector('[data-checkout-submit]')?.textContent || '').trim(),
      botonEnviarDeshabilitado: document.querySelector('[data-checkout-submit]')?.disabled === true,
      tituloDatos: txt('[data-checkout-details-title]'),
      modoEntrega: document.querySelector('input[name="deliveryMode"]:checked')?.value,
    };
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await shot('11-carrito.png');
  await page.locator('[data-checkout-form]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot('12-checkout-medios-pago.png');
  const resumen = page.locator('[data-order-summary]');
  if (await resumen.count()) {
    await resumen.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await shot('13-checkout-resumen.png');
  }

  // Fee de retiro vs delivery: cambiar el radio es estado local del formulario.
  try {
    await page.locator('[data-fulfillment-option="pickup"] input').check();
    await page.waitForTimeout(500);
    R.carrito.resumenPickup = await page.evaluate(() => (document.querySelector('[data-order-summary]')?.innerText || '').trim().replace(/\n{2,}/g, '\n').slice(0, 600));
    await shot('14-checkout-retiro.png');
    await page.locator('[data-fulfillment-option="delivery"] input').check();
    await page.waitForTimeout(400);
  } catch (e) { R.carrito.resumenPickup = `no medido: ${e.message}`; }
});

// ── 9 · portada: la persiana ────────────────────────────────────────────────
await fase('portada: estado del negocio', async () => {
  await page.goto(`${HOST}/#home`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const body = await page.locator('body').innerText();
  R.negocio = {
    pedidosHabilitados: body.includes('Pedidos online habilitados'),
    diceNoDisponibles: body.includes('no disponibles'),
    direccionPublicada: body.includes('Mendoza 827'),
  };
});

// ── 10 · higiene final ──────────────────────────────────────────────────────
await fase('higiene: imagenes rotas', async () => {
  R.imagenesRotas = await page.evaluate(() => [...document.querySelectorAll('img')]
    .filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.currentSrc || i.src).slice(0, 10));
});

writeFileSync(join(OUT, 'audit-results.json'), JSON.stringify(R, null, 2), 'utf8');
console.log(`\nresultados en ${join(OUT, 'audit-results.json')}`);
console.log(`problemas de ejecución: ${R.problemas.length}`);
await browser.close();
