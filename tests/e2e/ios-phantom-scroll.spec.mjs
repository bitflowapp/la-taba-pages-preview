import { expect, test } from '@playwright/test';
import { gotoDemoReset, installBrowserStubs, installPageGuards } from './helpers.mjs';

// Reproduce el "scroll fantasma" reportado en iPhone físico: al llegar al
// final de la página quedaba una superficie blanca desplazable debajo de la
// navegación. La causa no era de diseño: `<pre class="print-ticket">` sumaba
// su margen UA de 1em al alto del documento en TODAS las vistas, y
// `body[data-active-view="tracking"] main` se forzaba a `100vh` sin restar
// el topbar. Esta suite fija el contrato para que no vuelva a filtrarse.
//
// Métrica autoritativa: `document.documentElement.scrollHeight` no debe
// exceder el borde inferior real de `.app-shell` (que ya incluye la reserva
// del carrito/nav). Cualquier exceso ahí es scroll fantasma genuino — no se
// usa una heurística de "último elemento visible", que un `overflow`/
// `transform` interno puede falsear.

const IPHONE_13 = { width: 390, height: 844 };
const IPHONE_SE_1 = { width: 320, height: 568 };
const TOLERANCE_PX = 2; // redondeo de sub-píxel entre navegadores

async function measurePhantomScroll(page) {
  return page.evaluate(() => {
    const banner = document.querySelector('[data-app-update-banner]');
    if (banner) banner.hidden = true;
    const root = document.scrollingElement ?? document.documentElement;
    window.scrollTo({ top: root.scrollHeight, behavior: 'instant' });
    const appShell = document.querySelector('.app-shell');
    const shellRect = appShell ? appShell.getBoundingClientRect() : null;
    const shellBottom = shellRect ? Math.round(shellRect.bottom + window.scrollY) : null;
    const documentScrollHeight = document.documentElement.scrollHeight;
    const scrollReach = window.scrollY + window.innerHeight;
    window.scrollTo({ top: 0, behavior: 'instant' });
    return {
      documentScrollHeight,
      shellBottom,
      gap: shellBottom === null ? null : documentScrollHeight - shellBottom,
      scrollReach,
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
}

// El contenido no puede terminar detrás de una superficie fija/adherida al
// fondo (nav inferior, carrito sticky, barra de acción del checkout).
async function assertNoContentCoveredByBottomSurfaces(page) {
  const covered = await page.evaluate(() => {
    const isVisible = (node) => {
      const r = node.getBoundingClientRect();
      const cs = getComputedStyle(node);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const root = document.scrollingElement ?? document.documentElement;
    window.scrollTo({ top: root.scrollHeight, behavior: 'instant' });
    const view = document.querySelector('.app-view:not([hidden])');
    if (!view) return [];
    // Guarda el NODO (no sólo el rect): una barra de acción puede vivir
    // dentro de la propia vista (el negocio renderiza su `.b-bottomnav` como
    // descendiente) y su propio rótulo no cuenta como "tapado por sí mismo".
    const bottomSurfaces = [...document.querySelectorAll('.mobile-nav, .floating-cart:not(.hidden), .b-bottomnav, .checkout-form .button-row')]
      .filter(isVisible)
      .map((n) => ({ node: n, rect: n.getBoundingClientRect() }));
    const offenders = [];
    const walker = document.createTreeWalker(view, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent.trim();
      const owner = node.parentElement;
      // Chromium asigna el contenido de un `<details>` a un slot de su Shadow
      // DOM: con el details cerrado, `getBoundingClientRect`/`offsetParent`
      // del nodo en el DOM claro puede seguir reportando una caja "como si"
      // fuera visible aunque el slot esté oculto (confirmado visualmente: la
      // sección queda colapsada en pantalla). Se excluye explícitamente.
      const insideClosedDetails = owner?.closest('details:not([open]) > *:not(summary)');
      if (text && owner && !insideClosedDetails && owner.offsetParent !== null) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const r = range.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          for (const s of bottomSurfaces) {
            if (s.node.contains(owner)) continue;
            const overlap = r.bottom > s.rect.top + 1 && r.top < s.rect.bottom - 1
              && r.right > s.rect.left + 1 && r.left < s.rect.right - 1;
            if (overlap) offenders.push(text.slice(0, 30));
          }
        }
      }
      node = walker.nextNode();
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
    return [...new Set(offenders)];
  });
  expect(covered, `Contenido tapado por una superficie inferior: ${JSON.stringify(covered)}`).toEqual([]);
}

async function assertNoPhantomScroll(page, label) {
  const m = await measurePhantomScroll(page);
  expect(m.horizontalOverflow, `${label}: overflow horizontal`).toBeLessThanOrEqual(1);
  expect(
    Math.abs(m.gap ?? 0),
    `${label}: el documento (${m.documentScrollHeight}px) excede el borde real de .app-shell (${m.shellBottom}px) por scroll fantasma`,
  ).toBeLessThanOrEqual(TOLERANCE_PX);
  // Al hacer scroll al máximo, el viewport debe alcanzar el contenido real
  // (o quedarse corto por redondeo), nunca "seguir" más allá de él.
  expect(
    m.scrollReach,
    `${label}: tras hacer scroll al máximo, el viewport (${m.scrollReach}px) no alcanza el contenido real (${m.shellBottom}px)`,
  ).toBeGreaterThanOrEqual((m.shellBottom ?? 0) - TOLERANCE_PX);
  await assertNoContentCoveredByBottomSurfaces(page);
}

function seedTrackingState(status) {
  const now = Date.now();
  const at = (min) => new Date(now - min * 60000).toISOString();
  return {
    schemaVersion: 4,
    dataVersion: 'la-taba-runtime-v2',
    appMode: 'demo',
    orders: [{
      id: 'LT-8050',
      customerName: 'Cliente Demo',
      customerPhone: '2990000008',
      address: 'Mendoza 851, Centro',
      addressDetails: { streetLine: 'Mendoza 851', neighborhood: 'Centro', label: 'Mendoza 851, Centro' },
      deliveryMode: 'delivery',
      paymentMethod: 'Efectivo al recibir',
      paymentMethodCode: 'cash',
      notes: '',
      createdAt: at(20),
      status,
      items: [{ productId: 'red-bull-original-lata-250ml', name: 'Red Bull', quantity: 2, unitPrice: 3576, unit: 'unidad' }],
      subtotal: 7152,
      deliveryFee: 0,
      total: 7152,
      statusHistory: [
        { status: 'received', at: at(20) },
        { status: 'preparing', at: at(16) },
        { status: 'ready', at: at(10) },
        { status: 'on_the_way', at: at(6) },
      ],
      delivery: { driverName: 'Juli Reparto', driverPhone: '2991112233' },
    }],
    lastOrderId: 'LT-8050',
    cart: [],
  };
}

function seedBusinessState(count) {
  const now = Date.now();
  const at = (min) => new Date(now - min * 60000).toISOString();
  const statuses = ['received', 'preparing', 'ready', 'on_the_way'];
  const orders = Array.from({ length: count }, (_, i) => ({
    id: `LT-80${i}`,
    customerName: `Cliente ${i + 1}`,
    customerPhone: '2990000008',
    address: 'Mendoza 851, Centro',
    addressDetails: { streetLine: 'Mendoza 851', neighborhood: 'Centro', label: 'Mendoza 851, Centro' },
    deliveryMode: i % 2 === 0 ? 'delivery' : 'pickup',
    paymentMethod: 'Efectivo al recibir',
    paymentMethodCode: 'cash',
    notes: '',
    createdAt: at(10 + i),
    status: statuses[i % statuses.length],
    items: [{ productId: 'red-bull-original-lata-250ml', name: 'Red Bull', quantity: 1, unitPrice: 3576, unit: 'unidad' }],
    subtotal: 3576,
    deliveryFee: 0,
    total: 3576,
    statusHistory: [{ status: 'received', at: at(10 + i) }],
  }));
  return {
    schemaVersion: 4,
    dataVersion: 'la-taba-runtime-v2',
    appMode: 'demo',
    orders,
    lastOrderId: orders.length ? orders[0].id : null,
    cart: [],
  };
}

async function seedAndUnlock(page, state) {
  await page.addInitScript((payload) => {
    try {
      localStorage.setItem('la_taba_mvp_v4_state', JSON.stringify(payload));
      sessionStorage.setItem('la_taba_mvp_v4_admin_unlocked', 'true');
    } catch (_) { /* ignore */ }
  }, state);
}

for (const viewport of [IPHONE_13, IPHONE_SE_1]) {
  test.describe(`Scroll fantasma · ${viewport.width}x${viewport.height}`, () => {
    test('Home', async ({ browser }) => {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const guards = installPageGuards(page);
      await installBrowserStubs(page);
      await gotoDemoReset(page, '/?reset=1&demo=1');
      await page.waitForSelector('[data-view="home"] .home-catalog-card');
      await assertNoPhantomScroll(page, 'Home');
      await guards.assertClean();
      await context.close();
    });

    test('Catálogo: contenido largo y filtrado corto', async ({ browser }) => {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const guards = installPageGuards(page);
      await installBrowserStubs(page);
      await gotoDemoReset(page, '/?reset=1&demo=1#catalog');
      await page.waitForSelector('[data-product-grid] .product-card');
      await assertNoPhantomScroll(page, 'Catálogo (largo)');

      await page.locator('[data-view="catalog"] [data-search-input]').fill('imperial golden');
      await page.waitForTimeout(300);
      await assertNoPhantomScroll(page, 'Catálogo (filtrado corto)');

      await guards.assertClean();
      await context.close();
    });

    test('Carrito vacío y con productos', async ({ browser }) => {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const guards = installPageGuards(page);
      await installBrowserStubs(page);
      await gotoDemoReset(page, '/?reset=1&demo=1#cart');
      await expect(page.locator('[data-view="cart"]')).toBeVisible();
      await assertNoPhantomScroll(page, 'Carrito vacío');

      await page.evaluate(() => { window.location.hash = '#catalog'; });
      await page.waitForSelector('[data-product-grid] .product-card');
      await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
      await page.evaluate(() => { window.location.hash = '#cart'; });
      await expect(page.locator('[data-checkout-form]')).toBeVisible();
      await assertNoPhantomScroll(page, 'Carrito con productos');

      await guards.assertClean();
      await context.close();
    });

    test('Checkout con teclado simulado', async ({ browser }) => {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const guards = installPageGuards(page);
      await installBrowserStubs(page);
      await gotoDemoReset(page, '/?reset=1&demo=1#catalog');
      await page.waitForSelector('[data-product-grid] .product-card');
      await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
      await page.locator('[data-floating-cart]').click();
      await expect(page.locator('[data-checkout-form]')).toBeVisible();
      await page.waitForTimeout(3200); // el aviso efímero de "agregado" se retira solo
      await assertNoPhantomScroll(page, 'Checkout');

      // El teclado en iOS reduce el viewport visual sin cambiar `100vh`: se
      // simula achicando la ventana, el caso que expone justamente el bug.
      await page.locator('.checkout-instructions summary').click();
      await page.locator('[name="customerNotes"]').focus();
      await page.setViewportSize({ width: viewport.width, height: Math.round(viewport.height * 0.55) });
      await page.waitForTimeout(200);
      await assertNoPhantomScroll(page, 'Checkout con teclado simulado');
      await page.setViewportSize(viewport);

      await guards.assertClean();
      await context.close();
    });

    test('Perfil', async ({ browser }) => {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const guards = installPageGuards(page);
      await installBrowserStubs(page);
      await gotoDemoReset(page, '/?reset=1&demo=1#profile');
      await page.waitForSelector('[data-customer-profile]');
      await assertNoPhantomScroll(page, 'Perfil');
      await guards.assertClean();
      await context.close();
    });

    test('Seguimiento: sin pedido y pedido en camino', async ({ browser }) => {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const guards = installPageGuards(page);
      await installBrowserStubs(page);
      await gotoDemoReset(page, '/?reset=1&demo=1#tracking');
      await expect(page.locator('[data-tracking-panel]')).toBeVisible();
      await assertNoPhantomScroll(page, 'Seguimiento (sin pedido)');
      await context.close();

      const context2 = await browser.newContext({ viewport });
      const page2 = await context2.newPage();
      const guards2 = installPageGuards(page2);
      await installBrowserStubs(page2);
      await seedAndUnlock(page2, seedTrackingState('on_the_way'));
      await gotoDemoReset(page2, '/?reset=1&demo=1#tracking');
      await page2.waitForSelector('[data-tracking-panel] .track-layout');
      await assertNoPhantomScroll(page2, 'Seguimiento (en camino)');
      await guards2.assertClean();
      await context2.close();
    });

    test('Negocio: cola vacía y con pedidos', async ({ browser }) => {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const guards = installPageGuards(page);
      await installBrowserStubs(page);
      await seedAndUnlock(page, seedBusinessState(0));
      await gotoDemoReset(page, '/?reset=1&demo=1#business');
      await page.waitForSelector('[data-order-inbox]');
      await assertNoPhantomScroll(page, 'Negocio (cola vacía)');
      await context.close();

      const context2 = await browser.newContext({ viewport });
      const page2 = await context2.newPage();
      const guards2 = installPageGuards(page2);
      await installBrowserStubs(page2);
      await seedAndUnlock(page2, seedBusinessState(6));
      await gotoDemoReset(page2, '/?reset=1&demo=1#business');
      await page2.waitForSelector('[data-order-inbox]');
      await assertNoPhantomScroll(page2, 'Negocio (con pedidos)');
      await guards2.assertClean();
      await context2.close();
    });

    test('Rider', async ({ browser }) => {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const guards = installPageGuards(page);
      await installBrowserStubs(page);
      await seedAndUnlock(page, seedBusinessState(0));
      await gotoDemoReset(page, '/?reset=1&demo=1#rider');
      await page.waitForSelector('[data-delivery-panel]');
      await assertNoPhantomScroll(page, 'Rider');
      await guards.assertClean();
      await context.close();
    });
  });
}
