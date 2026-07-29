import { expect, test } from '@playwright/test';
import { fillCheckout, installBrowserStubs, installPageGuards, waitForToast } from './helpers.mjs';

// Central de pedidos v1: el pedido del cliente entra al negocio, se ve completo
// y el negocio lo gestiona. Mobile-first 390x844, sin geografía falsa.
test('Central de pedidos: el pedido entra, se ve completo y el negocio lo gestiona', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await installBrowserStubs(page);

  await page.goto('/?reset=1&demo=1#business');

  // 1. Negocio sin pedidos: empty state claro.
  await page.locator('[data-open-pin][data-admin-target="business"]').click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await expect(page.locator('[data-view="business"]')).toBeVisible();
  await expect(page.locator('.mobile-nav')).toBeHidden();
  await expect(page.locator('.desktop-nav')).toBeHidden();
  await expect(
    page.locator('[data-view="business"] [data-admin-unlocked] .section-head h1'),
  ).toHaveText('Central de pedidos');
  await expect(page.locator('.topbar .brand-word')).toHaveText('TABA');
  await expect(page.locator('.inbox-tabs')).toContainText('Nuevos');
  await expect(page.locator('.inbox-tabs')).toContainText('En preparación');
  await expect(page.locator('.inbox-tabs')).toContainText('Listos');
  await expect(page.locator('.inbox-tabs')).toContainText('En reparto');
  await expect(page.locator('.inbox-tabs')).toContainText('Finalizados');
  const soundToggle = page.locator('[data-sound-toggle]');
  await expect(soundToggle).toHaveAttribute('aria-pressed', 'false');
  await soundToggle.click();
  await waitForToast(page, 'Sonido de pedidos activado.');
  await expect(soundToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-order-inbox]')).toContainText('Sin pedidos en la cola');

  // 2. El cliente confirma un pedido con dirección real.
  await page.evaluate(() => { window.location.hash = '#catalog'; });
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('[data-floating-cart]').click();
  await fillCheckout(page, {
    name: 'Walter Cliente',
    phone: '2995551234',
    street: 'Mendoza 851',
    neighborhood: 'Centro',
    reference: 'Portón gris',
    notes: 'Sin sal',
    payment: 'cash',
    deliveryMode: 'delivery',
  });
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, 'Pedido confirmado. Seguilo en Seguimiento.');

  // 3. El negocio ve el pedido en la Central de pedidos, completo.
  // (La nav inferior se oculta en Seguimiento: volvemos al inicio por el logo.)
  await page.locator('.topbar .brand').click();
  await expect(page.locator('[data-view="home"]')).toBeVisible();
  await page.goto('/?demo=1#business');
  await expect(page.locator('[data-view="business"]')).toBeVisible();
  await expect(page.locator('[data-order-inbox]')).toContainText('Pedidos nuevos');
  await expect(page.locator('[data-business-dashboard]')).toContainText('Listos');

  const card = page.locator('.inbox-order.is-priority[data-inbox-order="LT-0002"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('LT-0002');
  await expect(card).toContainText('Pedido nuevo');
  await expect(card).toContainText('Nuevo / pendiente');
  await expect(card).toContainText('Walter Cliente');
  await expect(card).toContainText('2995551234');
  await expect(card).toContainText('Delivery');
  await expect(card).toContainText('Mendoza 851, Centro');
  await expect(card).toContainText('Portón gris');
  await expect(card).toContainText('Sin sal');
  await expect(card).toContainText('Total a cobrar');
  await expect(card).toContainText('Aceptar pedido');
  await expect(card.getByLabel('Tiempo estimado de preparación')).toBeVisible();
  await expect(card.locator('details.inbox-card-details')).not.toHaveAttribute('open', '');

  await page.getByLabel('Buscar pedido').fill('Walter');
  await expect(page.locator('[data-inbox-order="LT-0002"]')).toBeVisible();
  await page.locator('[data-order-filter="new"]').click();
  await expect(page.locator('[data-inbox-order="LT-0002"]')).toBeVisible();
  await page.getByLabel('Buscar pedido').fill('No existe');
  await expect(page.locator('[data-order-inbox]')).toContainText('No hay pedidos que coincidan');
  await page.getByLabel('Buscar pedido').fill('');
  await page.locator('[data-order-filter="all"]').click();

  // 4. El negocio gestiona el estado: Aceptar -> listo -> reparto, siempre honesto sin GPS.
  await page.locator('[data-inbox-order="LT-0002"] [data-prep-minutes]').selectOption('20');
  await page.locator('[data-order-advance="LT-0002"]').click();
  await waitForToast(page, 'Estado del pedido actualizado.');
  await expect(page.locator('[data-inbox-order="LT-0002"]')).toContainText('Preparando');
  await expect(page.locator('[data-inbox-order="LT-0002"]')).toContainText('Preparación estimada:');
  await expect(page.locator('[data-inbox-order="LT-0002"]')).toContainText('Listo para entregar');
  await expect(page.locator('[data-inbox-group="preparando"]')).toBeVisible();

  await page.evaluate(() => { window.location.hash = '#tracking'; });
  await expect(page.locator('[data-tracking-panel]')).toContainText('Tiempo estimado de preparación: 20 min.');
  await page.goto('/?demo=1#business');
  await expect(page.locator('[data-view="business"]')).toBeVisible();

  const managedCard = page.locator('[data-inbox-order="LT-0002"]');
  await page.locator('[data-order-advance="LT-0002"]').click();
  await waitForToast(page, 'Estado del pedido actualizado.');
  await expect(managedCard).toContainText('Pedido listo para reparto');
  await expect(managedCard).toContainText('Seguimiento por estados');
  await expect(managedCard.locator('[data-business-tracking="LT-0002"] [data-real-map]')).toHaveCount(0);

  await managedCard.getByRole('button', { name: 'Abrir reparto' }).click();
  await expect(page.locator('[data-view="rider"]')).toBeVisible();
  await expect(page.locator('.mobile-nav')).toBeHidden();
  await expect(page.locator('.desktop-nav')).toBeHidden();
  const riderPanel = page.locator('[data-delivery-panel]');
  await expect(riderPanel.locator('[data-rider-assignment-preview="LT-0002"]')).toBeVisible();
  await expect(riderPanel).not.toContainText('Walter Cliente');
  await expect(riderPanel).not.toContainText('Mendoza 851');
  await riderPanel.locator('[data-rider-accept="LT-0002"]').click();
  await waitForToast(page, 'Entrega aceptada. Ya podés ver los datos del pedido.');
  await expect(riderPanel).toContainText('Walter Cliente');
  await expect(riderPanel.locator('.rider-avatar')).toHaveCount(0);
  await expect(riderPanel.locator('.round-action')).toHaveCount(2);
  for (const action of await riderPanel.locator('.round-action').all()) {
    const box = await action.boundingBox();
    expect(box?.width || 0).toBeGreaterThanOrEqual(44);
    expect(box?.height || 0).toBeGreaterThanOrEqual(44);
  }
  await expect(riderPanel.locator('.rider-progress .track-step')).toHaveCount(5);
  await expect(riderPanel.locator('.rider-progress [aria-current="step"]')).toHaveCount(1);
  await riderPanel.locator('[data-delivery-leave="LT-0002"]').click();
  await waitForToast(page, 'Pedido marcado como en camino.');
  await riderPanel.locator('[data-open-admin-view="business"]').click();
  await expect(page.locator('[data-view="business"]')).toBeVisible();
  await expect(managedCard).toContainText('Pedido en reparto');
  await expect(managedCard).toContainText('Seguimiento por estados');
  await expect(managedCard).toContainText('Seguir reparto');
  await expect(managedCard.locator('[data-business-tracking="LT-0002"] [data-real-map]')).toHaveCount(0);

  await managedCard.getByText('Ver datos y productos').click();
  await managedCard.getByRole('button', { name: /Cancelar pedido/i }).click();
  await expect(page.locator('[data-cancel-modal]')).toBeVisible();
  await page.getByRole('button', { name: 'Cliente no responde' }).click();
  await page.locator('[data-cancel-confirm]').click();
  await waitForToast(page, 'Pedido LT-0002 cancelado. Motivo: Cliente no responde.');
  await page.locator('[data-order-filter="cancelled"]').click();
  await expect(page.locator('[data-order-inbox]')).toContainText('Cliente no responde');
  await expect(page.locator('[data-order-inbox]')).toContainText('Cancelado');

  // 5. Mobile 390x844 sin overflow horizontal.
  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(noOverflow).toBeTruthy();

  await guards.assertClean();
  await context.close();
});

test('Central de pedidos: ignora GPS heredado y muestra sólo estados', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  const now = Date.now();
  await page.addInitScript((savedState) => {
    window.__openedUrls = [];
    window.open = (...args) => {
      window.__openedUrls.push(String(args[0] || ''));
      return null;
    };
    try {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('la_taba_mvp_v4_state', JSON.stringify(savedState));
      sessionStorage.setItem('la_taba_mvp_v4_admin_unlocked', 'true');
    } catch (_) { /* ignore */ }
  }, liveBusinessState(now));

  await page.goto('/?demo=1#business');
  await expect(page.locator('[data-view="business"]')).toBeVisible();

  const card = page.locator('[data-inbox-order="LT-LIVE-1"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Pedido en reparto');
  await expect(card).toContainText('Seguimiento por estados');
  await expect(card).toContainText('No se usa GPS, ETA ni ubicación en vivo.');
  await expect(card).toContainText('Juli Reparto');
  await expect(card.locator('[data-business-tracking="LT-LIVE-1"] [data-real-map]')).toHaveCount(0);
  await expect(card.locator('[data-business-tracking="LT-LIVE-1"] .lt-rider-marker')).toHaveCount(0);
  await expect(card.locator('[data-business-tracking="LT-LIVE-1"] .lt-map-marker')).toHaveCount(0);
  await expect(card.locator('[data-business-tracking="LT-LIVE-1"]')).not.toContainText(/\b\d+(?:[.,]\d+)?\s*km\b/i);

  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(noOverflow).toBeTruthy();

  await guards.assertClean();
  await context.close();
});

function liveBusinessState(now) {
  const createdAt = new Date(now - 90_000).toISOString();
  const fixAt = new Date(now - 3_000).toISOString();
  const location = {
    lat: -38.9462,
    lng: -68.0418,
    accuracy: 14,
    heading: 95,
    timestamp: now - 3_000,
    lastFixAt: fixAt,
    source: 'gps',
    gpsStatus: 'active',
  };
  return {
    schemaVersion: 4,
    dataVersion: 'la-taba-runtime-v2',
    appMode: 'demo',
    orders: [{
      id: 'LT-LIVE-1',
      customerName: 'Walter Cliente',
      customerPhone: '2995551234',
      address: 'Mendoza 851, Centro',
      addressDetails: { streetLine: 'Mendoza 851', neighborhood: 'Centro', reference: 'Portón gris', label: 'Mendoza 851, Centro' },
      deliveryMode: 'delivery',
      paymentMethod: 'Pago a coordinar con el local',
      paymentMethodCode: 'coordinate',
      notes: 'Sin sal',
      createdAt,
      status: 'on_the_way',
      items: [{ productId: 'red-bull-original-lata-250ml', name: 'Red Bull Energy Drink', icon: '', quantity: 1, unitPrice: 3576, unit: 'unidad' }],
      subtotal: 1000,
      deliveryFee: 0,
      total: 1000,
      statusHistory: [
        { status: 'received', at: createdAt },
        { status: 'preparing', at: createdAt },
        { status: 'ready', at: createdAt },
        { status: 'on_the_way', at: createdAt },
      ],
      delivery: { driverName: 'Juli Reparto', driverPhone: '2991112233', currentLocationLabel: 'El repartidor salió del local' },
      tracking: { lastLocation: location, updatedAt: fixAt },
    }],
    lastOrderId: 'LT-LIVE-1',
    cart: [],
    simulation: {
      orderId: 'LT-LIVE-1',
      running: false,
      mode: 'gps',
      source: 'gps',
      routeId: 'neuquen-centro',
      progress: 0,
      baseEta: 0,
      etaMinutes: 0,
      timestamp: now - 3_000,
      lastFixAt: fixAt,
      lastGpsFixAt: fixAt,
      lastPublishedAt: fixAt,
      gpsStatus: 'active',
      lat: location.lat,
      lng: location.lng,
      accuracy: location.accuracy,
      heading: location.heading,
    },
  };
}
