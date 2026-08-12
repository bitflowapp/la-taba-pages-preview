/**
 * Medidas de los controles del catálogo del cliente a 390x844 (WebKit).
 * No reemplaza a la captura: dice los números que una foto no muestra
 * (altos reales, radios, alineación de bordes, contraste efectivo).
 *
 * Uso: node scripts/visual-polish-measure.mjs [--port 8195]
 */
import { webkit } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';

const args = process.argv.slice(2);
const port = Number(readArg('--port', '8195'));
const width = Number(readArg('--width', '390'));
const height = Number(readArg('--height', '844'));
const BASE = `http://127.0.0.1:${port}`;
const ROOT = path.resolve('.');

let server = null;
let browser = null;

try {
  server = await startServer();
  browser = await webkit.launch();
  await measure();
} finally {
  if (browser) await browser.close();
  await stopServer();
}

async function measure() {
  const context = await browser.newContext({
    viewport: { width, height },
    /* Sin esto la medida miente: las secciones entran con `translate3d(0,16px)`
       y una tarjeta que todavía no fue revelada devuelve su rect DESPLAZADO 16px
       hacia abajo. El pliegue se mide sobre la posición final, no sobre la de
       la animación. */
    reducedMotion: 'reduce',
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'es-AR',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/?reset=1&demo=1`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('[data-view="home"] .taba-home-search', { timeout: 20_000 });
  await page.waitForTimeout(400);

  console.log('\n== HOME · pliegue útil ==');
  console.log('  ', JSON.stringify(await foldProbe(page, '.home-best-card')));

  console.log('\n== HOME · presupuesto vertical hasta el primer Agregar ==');
  const stack = await page.evaluate(() => {
    const targets = {
      'barra superior': '.topbar',
      'encabezado de marca': '.brand-hero',
      'historias': '.brand-stories-strip',
      'hero': '.home-hero-promo',
      'buscador': '.taba-home-search',
      'chips': '.home-category-strip',
      'rotulo Destacados': '.home-section-head',
      'tarjeta 1': '.home-best-card',
      'Agregar 1': '.home-best-card .home-add-button',
    };
    const out = [];
    for (const [name, selector] of Object.entries(targets)) {
      const node = document.querySelector(selector);
      if (!node) { out.push([name, 'AUSENTE']); continue; }
      const r = node.getBoundingClientRect();
      out.push([name, `y ${Math.round(r.top)} -> ${Math.round(r.bottom)}  (alto ${Math.round(r.height)})`]);
    }
    return out;
  });
  const spad = Math.max(...stack.map(([n]) => n.length));
  stack.forEach(([n, v]) => console.log(`  ${n.padEnd(spad)}  ${v}`));

  console.log('\n== HOME ==');
  await dump(page, {
    'buscador home': '.taba-home-search',
    'chip activo home': '.home-category-card.active',
    'chip inactivo home': '.home-category-card:not(.active)',
    'hero': '.home-hero-promo',
    'tarjeta destacado': '.home-best-card',
    'plato destacado': '.home-best-card .home-best-media',
    '+18 destacado': '.home-best-card .product-age-tag',
    'CTA destacado': '.home-best-card .home-add-button',
    'combo': '.combo-card',
    'sello ahorro': '.combo-save-badge',
    'plato combo': '.combo-media-plate',
  });

  await page.evaluate(() => { window.location.hash = '#catalog'; });
  await page.waitForSelector('[data-view="catalog"]:not([hidden]) [data-product-grid] .product-card', { timeout: 15_000 });
  await page.waitForTimeout(400);

  console.log('\n== CATÁLOGO ==');
  await dump(page, {
    'buscador catálogo': '[data-view="catalog"] .catalog-search',
    'chip activo': '[data-view="catalog"] .category-button.active',
    'chip inactivo': '[data-view="catalog"] .category-button:not(.active)',
    'Filtros (details)': '.catalog-filters',
    'Filtros (summary)': '.catalog-filters summary',
    'Ordenar': '.sort-field',
    'Ordenar etiqueta': '.sort-field-label',
    'Ordenar select': '.sort-field select',
    'tarjeta': '.product-card',
    'plato': '.product-card .product-media',
    'título': '.product-card .product-body h3',
    'precio': '.product-card .price strong',
    'CTA': '.product-card .add-button',
    'favorito': '.product-favorite',
  });

  const sortText = await page.evaluate(() => {
    const field = document.querySelector('.sort-field');
    const wrap = document.querySelector('.sort-select-wrap');
    const select = document.querySelector('.sort-field select');
    const label = document.querySelector('.sort-field-label');
    const box = (node) => {
      if (!node) return 'AUSENTE';
      const r = node.getBoundingClientRect();
      return `${Math.round(r.left)}..${Math.round(r.right)} (${Math.round(r.width)})`;
    };
    const mid = select?.getBoundingClientRect();
    return {
      field: box(field),
      label: box(label),
      wrap: box(wrap),
      select: box(select),
      valor: select?.options[select.selectedIndex]?.text,
      // Quién recibe el toque en el centro del rótulo "Ordenar".
      sobreElRotulo: label
        ? document.elementFromPoint(
          label.getBoundingClientRect().left + 10,
          label.getBoundingClientRect().top + 8,
        )?.className || '(sin clase)'
        : null,
      selectVisible: mid ? getComputedStyle(select).backgroundColor : null,
    };
  });
  console.log('\n  control de orden:', JSON.stringify(sortText, null, 2));

  /* El criterio que fijó la candidata del catálogo premium: se mide el borde
     INFERIOR del primer "Agregar" contra el pliegue ÚTIL (ventana menos la
     barra inferior, que es opaca). Un botón que termina un píxel debajo de esa
     línea no se puede tocar. */
  console.log('\n== CATÁLOGO · pliegue útil ==');
  console.log('  ', JSON.stringify(await foldProbe(page, '[data-product-grid] .product-card')));

  console.log('\n== ALINEACIÓN DE BLOQUES (borde izquierdo real) ==');
  await page.evaluate(() => { window.location.hash = '#home'; });
  await page.waitForTimeout(600);
  const edges = await page.evaluate(() => {
    const targets = {
      'encabezado de marca': '.brand-hero',
      'pedido en curso': '.active-order-banner',
      'hero': '.home-hero-promo',
      'buscador': '.taba-home-search',
      'chips': '.home-category-card',
      'rótulo de sección': '.home-section-head h2',
      'tarjeta destacado': '.home-best-card',
      'banner editorial': '.home-brand-banner',
      'combo': '.combo-card',
    };
    const out = [];
    for (const [name, selector] of Object.entries(targets)) {
      const node = document.querySelector(selector);
      if (!node) { out.push([name, 'AUSENTE']); continue; }
      const rect = node.getBoundingClientRect();
      out.push([name, `${Math.round(rect.left)} … ${Math.round(rect.right)}`]);
    }
    return out;
  });
  const pad = Math.max(...edges.map(([name]) => name.length));
  edges.forEach(([name, value]) => console.log(`  ${name.padEnd(pad)}  ${value}`));

  await context.close();
}

/* El criterio que fijó la candidata del catálogo premium: se mide el borde
   INFERIOR del primer control de compra contra el pliegue ÚTIL (ventana menos
   la barra inferior, que es opaca). Un botón que termina un píxel debajo de esa
   línea no se puede tocar, aunque se vea. */
async function foldProbe(page, cardSelector) {
  return page.evaluate((selector) => {
    const nav = document.querySelector('.mobile-nav');
    const usable = window.innerHeight - (nav ? nav.getBoundingClientRect().height : 0);
    const card = document.querySelector(selector);
    const control = card?.querySelector('.add-button, .home-add-button, .qty-stepper');
    const rect = control?.getBoundingClientRect();
    return {
      ventana: window.innerHeight,
      pliegue: Math.round(usable),
      altoTarjeta: card ? Math.round(card.getBoundingClientRect().height) : null,
      controlTermina: rect ? Math.round(rect.bottom) : null,
      entra: rect ? rect.bottom <= usable : null,
    };
  }, cardSelector);
}

async function dump(page, targets) {
  const rows = await page.evaluate((map) => {
    const out = [];
    for (const [name, selector] of Object.entries(map)) {
      const node = document.querySelector(selector);
      if (!node) { out.push([name, 'AUSENTE']); continue; }
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      out.push([
        name,
        `${Math.round(rect.width)}x${Math.round(rect.height)} @x${Math.round(rect.left)}`
        + ` r=${style.borderRadius.split(' ')[0]}`
        + ` fs=${style.fontSize} fw=${style.fontWeight}`
        + ` bg=${style.backgroundColor} ink=${style.color}`,
      ]);
    }
    return out;
  }, targets);
  const pad = Math.max(...rows.map(([name]) => name.length));
  rows.forEach(([name, value]) => console.log(`  ${name.padEnd(pad)}  ${value}`));
}

async function startServer() {
  const child = spawn(process.execPath, ['scripts/realtime-relay.mjs', String(port)], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true,
  });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/`);
      if (response.ok) return child;
    } catch (_) { /* sigue arrancando */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill();
  throw new Error(`No arrancó el servidor local en ${BASE}.`);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill();
  await new Promise((resolve) => server.once('exit', resolve));
}

function readArg(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1 || index === args.length - 1) return fallback;
  return args[index + 1];
}
