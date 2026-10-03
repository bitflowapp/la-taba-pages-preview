// Captura el estado ACTUAL de TABA y mide defectos objetivos.
// Sólo lee la app servida en 127.0.0.1:8791; escribe únicamente en artifacts/.
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(
  'file:///C:/Users/marco/dev/la-taba-pages-preview/node_modules/playwright/index.mjs'
);

const BASE = 'http://127.0.0.1:8791';
const OUT = 'C:/1212/artifacts/taba-opus-design-review/screenshots/current';

const VIEWPORTS = [
  { name: '320x568', width: 320, height: 568 },
  { name: '390x844', width: 390, height: 844 },
  { name: '430x932', width: 430, height: 932 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1280x900', width: 1280, height: 900 },
  { name: '1440x1000', width: 1440, height: 1000 },
];

// Auditoría ejecutada dentro de la página. Devuelve hechos medibles, no juicios.
const AUDIT = () => {
  const vw = window.innerWidth;
  const docW = document.documentElement.scrollWidth;

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
      && Number(s.opacity) > 0.05;
  };

  const label = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' && el.className
      ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}` : '';
    const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${el.tagName.toLowerCase()}${id}${cls}${txt ? ` "${txt}"` : ''}`;
  };

  // 1. Overflow horizontal: qué elemento se sale del viewport.
  const overflowing = [];
  if (docW > vw + 1) {
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 || r.left < -1) {
        const s = getComputedStyle(el);
        if (s.position === 'fixed') continue;
        overflowing.push({ el: label(el), left: Math.round(r.left), right: Math.round(r.right) });
      }
    }
  }

  // 2. Objetivos táctiles por debajo de 44px.
  const SMALL = [];
  const interactive = document.querySelectorAll(
    'button, a[href], input:not([type=hidden]), select, textarea, [role=button], summary',
  );
  for (const el of interactive) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 44 || r.height < 44) {
      SMALL.push({ el: label(el), w: Math.round(r.width), h: Math.round(r.height) });
    }
  }

  // 3. Texto truncado por overflow horizontal del propio nodo.
  const CLIPPED = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || el.children.length > 0) continue;
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
      const s = getComputedStyle(el);
      if (s.overflowX === 'auto' || s.overflowX === 'scroll') continue;
      CLIPPED.push({ el: label(el), scroll: el.scrollWidth, client: el.clientWidth });
    }
  }

  // 4. Superficies fijas/sticky y qué contenido tapan.
  const STICKY = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    if (s.position !== 'fixed' && s.position !== 'sticky') continue;
    const r = el.getBoundingClientRect();
    if (r.height <= 0) continue;
    const covered = [];
    // Punto medio de la superficie fija: qué hay realmente debajo.
    const probes = [
      [r.left + r.width * 0.25, r.top + r.height / 2],
      [r.left + r.width * 0.75, r.top + r.height / 2],
    ];
    for (const [x, y] of probes) {
      if (x < 0 || y < 0 || x > vw || y > window.innerHeight) continue;
      const stack = document.elementsFromPoint(x, y);
      const idx = stack.indexOf(el);
      const below = idx >= 0 ? stack.slice(idx + 1) : stack;
      const hit = below.find((n) => n !== document.body
        && n !== document.documentElement
        && (n.textContent || '').trim().length > 0
        && !el.contains(n));
      if (hit) covered.push(label(hit));
    }
    STICKY.push({
      el: label(el),
      position: s.position,
      rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) },
      zIndex: s.zIndex,
      covers: [...new Set(covered)],
    });
  }

  // 5. Tamaños de fuente por debajo de 11px (piso de legibilidad).
  const TINY = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || el.children.length > 0) continue;
    if (!(el.textContent || '').trim()) continue;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px < 11) TINY.push({ el: label(el), fontSize: px });
  }

  return {
    viewportWidth: vw,
    documentScrollWidth: docW,
    horizontalOverflowPx: Math.max(0, docW - vw),
    overflowing: overflowing.slice(0, 12),
    smallTargets: SMALL.slice(0, 20),
    smallTargetCount: SMALL.length,
    clippedText: CLIPPED.slice(0, 12),
    stickySurfaces: STICKY,
    tinyText: TINY.slice(0, 12),
  };
};

async function settle(page) {
  await page.waitForLoadState('load');
  await page.waitForTimeout(700);
  // Neutraliza animaciones para capturas estables.
  await page.addStyleTag({
    content: '*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important}',
  }).catch(() => {});
  await page.waitForTimeout(150);
}

async function shoot(page, name, report) {
  await settle(page);
  const audit = await page.evaluate(AUDIT);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  await page.screenshot({ path: `${OUT}/${name}-full.png`, fullPage: true });
  report[name] = audit;
  const flags = [];
  if (audit.horizontalOverflowPx > 0) flags.push(`OVERFLOW +${audit.horizontalOverflowPx}px`);
  if (audit.smallTargetCount) flags.push(`${audit.smallTargetCount} targets <44px`);
  if (audit.clippedText.length) flags.push(`${audit.clippedText.length} clipped`);
  if (audit.tinyText.length) flags.push(`${audit.tinyText.length} tiny text`);
  console.log(`  ${name}: ${flags.length ? flags.join(' | ') : 'clean'}`);
}

async function unlockBusiness(page) {
  const opener = page.locator('[data-open-pin][data-admin-target="business"]').first();
  if (await opener.count()) {
    await opener.click({ timeout: 5000 }).catch(() => {});
    const input = page.locator('[data-pin-form] input[name="pin"]');
    if (await input.count()) {
      await input.fill('1234').catch(() => {});
      await page.locator('[data-pin-form]').press('Enter').catch(() => {});
    }
  }
  await page.waitForTimeout(600);
}

async function placeOrder(page) {
  // Usa el flujo real del cliente para que el panel del negocio tenga un pedido.
  await page.goto(`${BASE}/?demo=1#catalog`);
  await settle(page);
  const add = page.locator('[data-product-grid] [data-add-product]:not([disabled])').first();
  await add.click({ timeout: 6000 });
  await page.waitForTimeout(250);
  await page.locator('[data-floating-cart]').click({ timeout: 6000 });
  await page.waitForTimeout(600);

  await page.evaluate(async () => {
    localStorage.setItem('la-taba-sandbox-profile:demo', JSON.stringify({
      profile: { id: 'demo-customer', name: 'Cliente Demo', phone: '2990000001', updatedAt: '' },
      addresses: [{
        id: 'demo-address-01', label: 'Casa', street: 'Avenida Argentina', streetNumber: '450',
        city: 'Neuquén Capital', floor: '', apartment: '', reference: 'Portón negro',
        province: '', postalCode: '', source: 'manual', isDefault: true,
      }],
    }));
    try {
      const mod = await import(new URL('js/customer-delivery.js', location.href).href);
      await mod.refreshCustomerDeliveryCheckout?.();
    } catch (_) { /* el checkout hidrata al abrirse */ }
  });
  await page.waitForTimeout(500);

  await page.getByLabel('Delivery').check({ timeout: 4000 }).catch(() => {});
  const radio = page.locator('[data-profile-checkout] .profile-address-card input[type=radio]').first();
  if (await radio.count()) await radio.check().catch(() => {});
  const pay = page.getByLabel('Forma de pago');
  if (await pay.count()) await pay.selectOption('cash').catch(() => {});
  await page.getByRole('button', { name: /Confirmar pedido/i }).click({ timeout: 6000 });
  await page.waitForTimeout(1200);
}

const report = {};
const browser = await chromium.launch();
await mkdir(OUT, { recursive: true });

for (const vp of VIEWPORTS) {
  console.log(`\n== ${vp.name} ==`);
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    isMobile: vp.width <= 430,
    hasTouch: vp.width <= 768,
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));

  try {
    await page.goto(`${BASE}/?reset=1&demo=1#home`);
    await shoot(page, `home-${vp.name}`, report);

    await page.goto(`${BASE}/?demo=1#catalog`);
    await shoot(page, `catalog-${vp.name}`, report);

    // Catálogo con carrito activo: mide el apilado sticky real.
    try {
      await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first()
        .click({ timeout: 5000 });
      await page.waitForTimeout(400);
      await shoot(page, `catalog-cart-${vp.name}`, report);
    } catch (e) { console.log(`  (sin carrito sticky: ${e.message.slice(0, 60)})`); }

    // Estado vacío real: búsqueda sin resultados.
    try {
      await page.locator('[data-view="catalog"] [data-search-input]').first()
        .fill('zzzzqqq', { timeout: 4000 });
      await page.waitForTimeout(600);
      await shoot(page, `catalog-empty-${vp.name}`, report);
    } catch (e) { console.log(`  (sin empty state: ${e.message.slice(0, 60)})`); }

    try { await placeOrder(page); } catch (e) { console.log(`  (sin pedido: ${e.message.slice(0, 80)})`); }

    await page.goto(`${BASE}/?demo=1#business`);
    await settle(page);
    await unlockBusiness(page);
    await shoot(page, `business-${vp.name}`, report);

    // Otra sección del panel: reportes (tablas densas).
    try {
      await page.locator('[data-business-view="reports"]').first().click({ timeout: 4000 });
      await page.waitForTimeout(500);
      await shoot(page, `business-reports-${vp.name}`, report);
    } catch (e) { console.log(`  (sin reportes: ${e.message.slice(0, 60)})`); }
  } catch (error) {
    console.log(`  ERROR ${vp.name}: ${error.message}`);
  }
  await context.close();
}

await browser.close();
await writeFile(
  'C:/1212/artifacts/taba-opus-design-review/screenshots/current/audit-metrics.json',
  JSON.stringify(report, null, 2),
);
console.log('\nlisto');
