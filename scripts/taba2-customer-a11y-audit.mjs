/*
 * Accesibilidad del cliente, la parte que no es color.
 *
 * `taba2-commercial-audit.mjs` ya mide contraste y objetivos táctiles sobre el
 * color realmente pintado. Éste mira lo otro, que es lo que decide si alguien
 * que no ve la pantalla —o que navega con teclado— puede comprar:
 *
 *   · controles SIN NOMBRE accesible: el caso típico es el botón de sólo icono,
 *     que para un lector de pantalla es «botón» y nada más;
 *   · campos de formulario sin etiqueta asociada;
 *   · imágenes de contenido sin alternativa textual;
 *   · elementos enfocables escondidos con `aria-hidden`, que meten paradas
 *     invisibles en el recorrido del tabulador;
 *   · `tabindex` positivo, que reordena el foco de formas que nadie previó;
 *   · foco INVISIBLE: se enfoca cada control y se mira si el navegador dibuja
 *     algo —contorno, sombra o borde—;
 *   · errores y estados de carga que no se anuncian: sin `aria-live` o sin
 *     `role=alert`, el aviso aparece y nadie se entera;
 *   · movimiento que no respeta `prefers-reduced-motion`.
 *
 * Uso:
 *   node scripts/realtime-relay.mjs 8231 &
 *   BASE=http://127.0.0.1:8231 node scripts/taba2-customer-a11y-audit.mjs
 *
 * Variables: BASE, OUT, ENGINE (chromium|webkit).
 */
import { chromium, webkit } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8231';
const OUT = path.resolve(process.env.OUT || 'artifacts/taba2-customer-overnight-rc/a11y');
const ENGINE = process.env.ENGINE === 'webkit' ? webkit : chromium;
const ENGINE_NAME = process.env.ENGINE === 'webkit' ? 'webkit' : 'chromium';

const PROBE = () => {
  const capa = [...document.querySelectorAll('[data-view]')].find((v) => !v.hidden && v.offsetParent !== null)
    || document.body;
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const nombreDe = (el) => {
    const aria = (el.getAttribute('aria-label') || '').trim();
    if (aria) return aria;
    const etiquetadoPor = (el.getAttribute('aria-labelledby') || '')
      .split(/\s+/).filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent?.trim() || '')
      .join(' ').trim();
    if (etiquetadoPor) return etiquetadoPor;
    const titulo = (el.getAttribute('title') || '').trim();
    if (titulo) return titulo;
    const propio = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (propio) return propio;
    const alt = [...el.querySelectorAll('img[alt]')].map((i) => i.alt.trim()).filter(Boolean).join(' ');
    if (alt) return alt;
    const svgTitulo = [...el.querySelectorAll('svg > title')].map((t) => t.textContent.trim()).filter(Boolean).join(' ');
    return svgTitulo;
  };
  const etiqueta = (el) => {
    const clase = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    const datos = [...el.attributes].filter((a) => a.name.startsWith('data-')).slice(0, 1).map((a) => `[${a.name}]`).join('');
    return `${el.tagName.toLowerCase()}${clase ? `.${clase}` : ''}${datos}`;
  };

  const sinNombre = [];
  capa.querySelectorAll('button, a[href], [role="button"], summary').forEach((el) => {
    if (!visible(el) || el.disabled) return;
    if (!nombreDe(el)) sinNombre.push(etiqueta(el));
  });

  const sinEtiqueta = [];
  capa.querySelectorAll('input:not([type="hidden"]), select, textarea').forEach((el) => {
    if (!visible(el)) return;
    const porFor = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    const envolvente = el.closest('label');
    const tieneTexto = (nodo) => !!(nodo && (nodo.textContent || '').replace(/\s+/g, ' ').trim());
    if (nombreDe(el) || tieneTexto(porFor) || tieneTexto(envolvente)) return;
    sinEtiqueta.push(`${etiqueta(el)} name=${el.name || '—'}`);
  });

  const imagenesSinAlt = [];
  capa.querySelectorAll('img').forEach((el) => {
    if (!visible(el)) return;
    if (el.getAttribute('alt') === null) imagenesSinAlt.push(`${etiqueta(el)} src=${String(el.currentSrc || el.src).split('/').pop()}`);
  });

  const enfocablesOcultos = [];
  document.querySelectorAll('[aria-hidden="true"]').forEach((oculto) => {
    oculto.querySelectorAll('a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')
      .forEach((el) => { if (visible(el)) enfocablesOcultos.push(etiqueta(el)); });
  });

  const tabindexPositivo = [...document.querySelectorAll('[tabindex]')]
    .filter((el) => Number(el.getAttribute('tabindex')) > 0)
    .map((el) => `${etiqueta(el)} tabindex=${el.getAttribute('tabindex')}`);

  /*
   * El foco NO se mide con `el.focus()`.
   *
   * `:focus-visible` es una decisión del navegador, y un foco programático sobre
   * un botón no la activa: medir así reporta «foco invisible» en toda la tienda
   * y no es cierto. Acá sólo se preparan las líneas base; quien recorre con
   * TABULADOR de verdad es el proceso de la prueba.
   */
  const enfocables = [...capa.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [tabindex="0"]')]
    .filter((el) => visible(el) && !el.disabled);
  enfocables.forEach((el, i) => {
    el.dataset.a11yIndice = String(i);
    const cs = getComputedStyle(el);
    el.dataset.a11yBase = `${cs.outlineStyle}|${cs.outlineWidth}|${cs.outlineColor}|${cs.boxShadow}|${cs.borderColor}|${cs.backgroundColor}|${cs.color}`;
  });

  const anuncios = {
    regionesVivas: document.querySelectorAll('[aria-live], [role="alert"], [role="status"]').length,
    toastConAnuncio: !!document.querySelector('[data-toast][aria-live], [data-toast][role="alert"], [data-toast][role="status"]'),
    erroresDeCheckoutConAnuncio: [...document.querySelectorAll('[data-checkout-warning], [data-checkout-inline-error], [data-checkout-error]')]
      .every((n) => n.hasAttribute('aria-live') || n.getAttribute('role') === 'alert' || n.getAttribute('role') === 'status'),
    cargaConAviso: !!document.querySelector('[aria-busy="true"], [data-loading][aria-live]'),
  };

  return {
    sinNombre: [...new Set(sinNombre)],
    sinEtiqueta: [...new Set(sinEtiqueta)],
    imagenesSinAlt: [...new Set(imagenesSinAlt)],
    enfocablesOcultos: [...new Set(enfocablesOcultos)],
    tabindexPositivo: [...new Set(tabindexPositivo)],
    enfocablesPreparados: enfocables.length,
    anuncios,
  };
};

/* Lee el elemento que tiene el foco AHORA y si su estilo cambió al recibirlo. */
const FOCO_ACTUAL = () => {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  const cs = getComputedStyle(el);
  const ahora = `${cs.outlineStyle}|${cs.outlineWidth}|${cs.outlineColor}|${cs.boxShadow}|${cs.borderColor}|${cs.backgroundColor}|${cs.color}`;
  const clase = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
  const datos = [...el.attributes].filter((a) => a.name.startsWith('data-') && !a.name.startsWith('data-a11y')).slice(0, 1).map((a) => `[${a.name}]`).join('');
  return {
    etiqueta: `${el.tagName.toLowerCase()}${clase ? `.${clase}` : ''}${datos}`,
    visibleAlFoco: el.dataset.a11yBase ? el.dataset.a11yBase !== ahora : null,
    indice: el.dataset.a11yIndice ?? null,
  };
};

const MOVIMIENTO = () => [...document.getAnimations()]
  .filter((a) => a.playState === 'running')
  .map((a) => {
    const t = a.effect?.getTiming?.() || {};
    const objetivo = a.effect?.target;
    const clase = typeof objetivo?.className === 'string' ? objetivo.className.trim().split(/\s+/)[0] : '';
    return `${objetivo?.tagName?.toLowerCase() || '?'}${clase ? `.${clase}` : ''} iteraciones=${t.iterations}`;
  })
  .filter((linea) => linea.includes('iteraciones=Infinity'));

const lineas = [];
const browser = await ENGINE.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: 'es-AR',
  serviceWorkers: 'block',
});
const page = await context.newPage();
await page.goto(`${BASE}/?reset=1&demo=1`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-view="home"] .home-best-card', { timeout: 25_000 });
await page.waitForTimeout(900);

const pasos = [
  ['home', async () => {}],
  ['catalogo', async () => { await ir(page, 'catalog'); }],
  ['producto', async () => {
    await page.locator('[data-product-grid] [data-product-detail]').first().click().catch(() => {});
    await page.waitForTimeout(700);
  }],
  ['producto-cerrar', async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }],
  ['carrito', async () => {
    await ir(page, 'catalog');
    const adds = page.locator('[data-product-grid] [data-add-product]:not([disabled])');
    const total = Math.min(await adds.count(), 2);
    for (let i = 0; i < total; i += 1) { await adds.nth(i).click().catch(() => {}); await page.waitForTimeout(220); }
    await ir(page, 'cart');
  }],
  ['checkout', async () => {
    await page.locator('[data-checkout-form]').first().scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);
  }],
  ['perfil', async () => { await ir(page, 'profile'); }],
  ['seguimiento', async () => { await ir(page, 'tracking'); await page.waitForTimeout(800); }],
];

let totalHallazgos = 0;
for (const [nombre, correr] of pasos) {
  await correr().catch(() => {});
  if (nombre.endsWith('-cerrar')) continue;
  const r = await page.evaluate(PROBE);

  // El recorrido con TABULADOR de verdad: es la única forma de que el navegador
  // decida que el foco tiene que verse.
  const sinFoco = [];
  const ordenDelFoco = [];
  await page.evaluate(() => { document.body.focus?.(); });
  for (let i = 0; i < Math.min(r.enfocablesPreparados + 4, 45); i += 1) {
    await page.keyboard.press('Tab');
    const foco = await page.evaluate(FOCO_ACTUAL);
    if (!foco) continue;
    ordenDelFoco.push(foco.indice === null ? `(fuera) ${foco.etiqueta}` : foco.indice);
    if (foco.visibleAlFoco === false) sinFoco.push(foco.etiqueta);
  }
  r.sinFoco = [...new Set(sinFoco)];

  const total = r.sinNombre.length + r.sinEtiqueta.length + r.imagenesSinAlt.length
    + r.enfocablesOcultos.length + r.tabindexPositivo.length + r.sinFoco.length;
  totalHallazgos += total;
  lineas.push(`\n### ${nombre} — ${total} hallazgos`);
  r.sinNombre.forEach((x) => lineas.push(`  [SIN-NOMBRE] ${x}`));
  r.sinEtiqueta.forEach((x) => lineas.push(`  [SIN-ETIQUETA] ${x}`));
  r.imagenesSinAlt.forEach((x) => lineas.push(`  [IMG-SIN-ALT] ${x}`));
  r.enfocablesOcultos.forEach((x) => lineas.push(`  [ENFOCABLE-OCULTO] ${x}`));
  r.tabindexPositivo.forEach((x) => lineas.push(`  [TABINDEX+] ${x}`));
  r.sinFoco.forEach((x) => lineas.push(`  [FOCO-INVISIBLE] ${x}`));
  lineas.push(`  anuncios: ${JSON.stringify(r.anuncios)}`);
  lineas.push(`  recorrido del tabulador: ${ordenDelFoco.slice(0, 24).join(' → ') || 'sin paradas'}`);
}

// Movimiento reducido: con la preferencia puesta no puede quedar nada animándose
// para siempre.
await context.close();
const contextoQuieto = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: 'es-AR',
  serviceWorkers: 'block',
  reducedMotion: 'reduce',
});
const quieta = await contextoQuieto.newPage();
await quieta.goto(`${BASE}/?reset=1&demo=1`, { waitUntil: 'domcontentloaded' });
await quieta.waitForSelector('[data-view="home"] .home-best-card', { timeout: 25_000 });
await quieta.waitForTimeout(1_500);
const infinitas = await quieta.evaluate(MOVIMIENTO);
lineas.push(`\n### movimiento reducido — ${infinitas.length} animaciones infinitas vivas`);
infinitas.forEach((x) => lineas.push(`  [MOVIMIENTO] ${x}`));
totalHallazgos += infinitas.length;
await contextoQuieto.close();
await browser.close();

mkdirSync(OUT, { recursive: true });
const informe = `# Accesibilidad del cliente · ${ENGINE_NAME} · ${totalHallazgos} hallazgos\n${lineas.join('\n')}\n`;
writeFileSync(path.join(OUT, `a11y-${ENGINE_NAME}.md`), informe, 'utf8');
console.log(informe);

async function ir(page_, vista) {
  await page_.evaluate((v) => { window.location.hash = `#${v}`; }, vista);
  await page_.waitForTimeout(700);
}
