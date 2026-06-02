import { expect, test } from '@playwright/test';
import { fillCheckout, installPageGuards } from './helpers.mjs';

// Relay realtime servido por scripts/realtime-relay.mjs (ver playwright.config.mjs).
const RELAY = 'http://127.0.0.1:18787';

async function stub(page) {
  await page.addInitScript(() => {
    window.open = () => null;
    try { localStorage.clear(); sessionStorage.clear(); } catch (_) { /* ignore */ }
  });
}

async function stubWithRiderState(page, state) {
  await page.addInitScript((savedState) => {
    window.open = () => null;
    try {
      sessionStorage.clear();
      localStorage.setItem('la_taba_mvp_v4_state', JSON.stringify(savedState));
    } catch (_) { /* ignore */ }
  }, state);
}

function staleRiderState() {
  const createdAt = new Date(Date.now() - 60_000).toISOString();
  return {
    orders: [{
      id: 'LT-9999',
      customerName: 'Pedido Viejo',
      customerPhone: '2990000000',
      address: 'Vieja 999',
      deliveryMode: 'delivery',
      paymentMethod: 'Efectivo',
      notes: 'stale',
      createdAt,
      status: 'on_the_way',
      items: [{ productId: 'p-vacio', name: 'Vacío especial', icon: '', quantity: 1, unitPrice: 1000, unit: 'kg' }],
      subtotal: 1000,
      deliveryFee: 0,
      total: 1000,
      statusHistory: [{ status: 'received', at: createdAt }, { status: 'on_the_way', at: createdAt }],
      delivery: { driverName: 'Sin asignar', driverPhone: '', estimatedMinutes: 10, currentLocationLabel: 'El repartidor salió del local' },
    }],
    lastOrderId: 'LT-9999',
    cart: [],
    simulation: null,
  };
}

function staleRelayMessage(room) {
  const now = Date.now();
  const createdAt = new Date(now - 90_000).toISOString();
  const lastFixAt = new Date(now - 10_000).toISOString();
  return {
    kind: 'state',
    sender: 'seed-reset-test',
    room,
    ts: now - 10_000,
    orders: [{
      id: 'LT-ROOM-OLD',
      customerName: 'Pedido Relay Viejo',
      customerPhone: '2990000000',
      address: 'Vieja 999',
      deliveryMode: 'delivery',
      paymentMethod: 'Efectivo',
      notes: 'stale relay',
      createdAt,
      status: 'on_the_way',
      items: [{ productId: 'p-vacio', name: 'Vacío especial', icon: '', quantity: 1, unitPrice: 1000, unit: 'kg' }],
      subtotal: 1000,
      deliveryFee: 0,
      total: 1000,
      statusHistory: [{ status: 'received', at: createdAt }, { status: 'on_the_way', at: createdAt }],
      delivery: { driverName: 'Sin asignar', driverPhone: '', estimatedMinutes: 0, currentLocationLabel: 'En camino' },
      tracking: {
        lastLocation: {
          lat: -38.9512,
          lng: -68.0598,
          accuracy: 12,
          heading: 90,
          source: 'gps',
          gpsStatus: 'active',
          timestamp: now - 10_000,
          lastFixAt,
        },
      },
    }],
    lastOrderId: 'LT-ROOM-OLD',
    simulation: {
      orderId: 'LT-ROOM-OLD',
      lat: -38.9512,
      lng: -68.0598,
      accuracy: 12,
      heading: 90,
      source: 'gps',
      mode: 'gps',
      gpsStatus: 'active',
      timestamp: now - 10_000,
      lastFixAt,
      lastGpsFixAt: lastFixAt,
    },
  };
}

async function seedRelayRoom(room, message) {
  const response = await fetch(`${RELAY}/publish?room=${encodeURIComponent(room)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  });
  expect(response.ok).toBeTruthy();
}

test('reset=1 con relay limpia el snapshot viejo de la room antes de reconectar', async ({ browser }) => {
  const room = `reset-relay-e2e-${Date.now()}`;
  await seedRelayRoom(room, staleRelayMessage(room));

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await stub(page);
  const guards = installPageGuards(page);

  await page.goto(`${RELAY}/?reset=1&relay=${encodeURIComponent(RELAY)}&room=${room}#tracking`);
  const tracking = page.locator('[data-tracking-panel]');
  await expect(tracking).toContainText('No hay un pedido activo', { timeout: 10_000 });
  await page.waitForTimeout(500);
  await expect(tracking).not.toContainText('LT-ROOM-OLD');
  await expect(tracking.locator('[data-map-role="tracking"] .lt-rider-marker')).toHaveCount(0);

  await guards.assertClean();
  await context.close();
});

test('cliente y rider en dos equipos: pedido interno, realtime y entrega (sin GPS falso)', async ({ browser }) => {
  const room = `e2e-${Date.now()}`;
  const url = (suffix = '') => `${RELAY}/?relay=${encodeURIComponent(RELAY)}&room=${room}${suffix}`;

  // Dos contextos aislados = dos "celulares" distintos (localStorage separado).
  const clientCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const riderCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const client = await clientCtx.newPage();
  const rider = await riderCtx.newPage();
  await stub(client);
  await stub(rider);
  const clientGuards = installPageGuards(client);
  const riderGuards = installPageGuards(rider);

  await client.goto(url());
  await rider.goto(url('#rider'));

  // El rider entra con PIN demo (botón dentro de la vista rider).
  await rider.locator('[data-view="rider"] [data-open-pin]').click();
  await rider.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await rider.locator('[data-pin-form]').press('Enter');
  await expect(rider.locator('[data-view="rider"] [data-delivery-panel]')).toBeVisible();

  // El cliente arma y CONFIRMA el pedido (sin abrir WhatsApp).
  await client.locator('.mobile-nav [data-nav-view="catalog"]').click();
  await client.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await client.locator('.mobile-nav [data-nav-view="cart"]').click();
  await fillCheckout(client, {
    name: 'Cliente Demo',
    phone: '2995550000',
    address: 'Roca 123',
    notes: 'Tocar timbre',
    payment: 'cash',
    deliveryMode: 'delivery',
  });
  await client.getByRole('button', { name: /Confirmar pedido/i }).click();
  await expect(client.locator('[data-view="tracking"]')).toBeVisible();
  await expect(client.locator('[data-toast]')).toContainText('Ya podés seguirlo en tiempo real');
  await expect(client.locator('[data-tracking-panel]')).toContainText('Roca 123, Neuquen centro');

  // SIN GPS real: el cliente NO ve mapa, ni marcadores, ni "En vivo".
  await expect(client.locator('[data-tracking-panel] [data-real-map]')).toHaveCount(0);
  await expect(client.locator('[data-tracking-panel] .map-marker')).toHaveCount(0);
  await expect(client.locator('[data-tracking-panel]')).toContainText('Sin GPS en vivo');
  await expect(client.locator('[data-tracking-panel]')).not.toContainText('En vivo');

  // El rider ve el pedido del cliente SIN recargar (vía relay).
  await expect(rider.locator('[data-delivery-panel]')).toContainText('LT-0002', { timeout: 10_000 });
  await expect(rider.locator('[data-delivery-panel]')).toContainText('Esperando preparación');

  // Rider: marcar listo y salir del local.
  await rider.locator('[data-rider-ready="LT-0002"]').click();
  await rider.locator('[data-delivery-leave="LT-0002"]').click();

  // El cliente ve "en camino" sin recargar (estado propagado por relay, sin GPS).
  await expect(client.locator('[data-tracking-panel]')).toContainText(/en camino|Llegando/i, { timeout: 10_000 });

  // Otra sala no mezcla el pedido del rider.
  const otherCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const other = await otherCtx.newPage();
  await stub(other);
  await other.goto(`${RELAY}/?relay=${encodeURIComponent(RELAY)}&room=${room}-other#rider`);
  await other.locator('[data-view="rider"] [data-open-pin]').click();
  await other.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await other.locator('[data-pin-form]').press('Enter');
  await expect(other.locator('[data-delivery-panel]')).not.toContainText('Cliente Demo');
  await otherCtx.close();

  // Rider: llegué al domicilio -> el cliente ve "Llegando".
  await rider.locator('[data-delivery-arrive="LT-0002"]').click();
  await expect(client.locator('[data-tracking-panel]')).toContainText('Llegando', { timeout: 10_000 });

  // Rider: pedido entregado -> el cliente ve entregado.
  await rider.locator('[data-delivery-done="LT-0002"]').click();
  await expect(client.locator('[data-tracking-panel]')).toContainText(/entregado|Disfrutalo/i, { timeout: 10_000 });

  await clientCtx.close();
  await riderCtx.close();
});

test('el rider usa el pedido activo de la sala aunque tenga localStorage viejo', async ({ browser }) => {
  const room = `stale-gps-e2e-${Date.now()}`;
  const url = (suffix = '', reset = false) => `${RELAY}/?${reset ? 'reset=1&' : ''}relay=${encodeURIComponent(RELAY)}&room=${room}${suffix}`;

  const clientCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const riderCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
    permissions: ['geolocation'],
    geolocation: { latitude: -38.9462, longitude: -68.0418, accuracy: 12 },
  });
  const client = await clientCtx.newPage();
  const rider = await riderCtx.newPage();
  await stub(client);
  await stubWithRiderState(rider, staleRiderState());
  const clientGuards = installPageGuards(client);
  const riderGuards = installPageGuards(rider);

  await client.goto(url('', true));
  await rider.goto(url('#rider'));
  await rider.locator('[data-view="rider"] [data-open-pin]').click();
  await rider.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await rider.locator('[data-pin-form]').press('Enter');

  await client.locator('.mobile-nav [data-nav-view="catalog"]').click();
  await client.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await client.locator('.mobile-nav [data-nav-view="cart"]').click();
  await fillCheckout(client, {
    name: 'Cliente GPS',
    phone: '2995550000',
    street: 'Mendoza 851',
    neighborhood: 'Centro',
    notes: 'GPS realtime',
    payment: 'cash',
    deliveryMode: 'delivery',
  });
  await client.getByRole('button', { name: /Confirmar pedido/i }).click();

  await expect(rider.locator('[data-delivery-panel]')).toContainText('LT-0002', { timeout: 10_000 });
  await expect(rider.locator('[data-delivery-panel]')).not.toContainText('LT-9999');

  await rider.locator('[data-sim-gps]').click();
  await expect(rider.locator('[data-delivery-panel]')).toContainText(/Compartiendo ubicaci/i, { timeout: 10_000 });
  await expect(client.locator('[data-tracking-panel]')).toContainText('Ubicación del repartidor en vivo', { timeout: 10_000 });
  await expect(client.locator('[data-tracking-panel]')).not.toContainText('Sin GPS en vivo');
  await expect(client.locator('[data-tracking-panel]')).not.toContainText('CL falso');
  await expect(client.locator('[data-tracking-panel]')).not.toContainText('LT falso');
  await expect(client.locator('[data-tracking-panel]')).not.toContainText('ruta falsa');
  await expect(client.locator('[data-tracking-panel]')).not.toContainText(/\bETA\b/i);
  await expect(client.locator('[data-tracking-panel]')).not.toContainText(/\b\d+(?:[.,]\d+)?\s*km\b/i);

  await rider.locator('[data-sim-gps-off]').click();
  await expect(client.locator('[data-tracking-panel]')).toContainText('Sin GPS en vivo', { timeout: 10_000 });

  await clientGuards.assertClean();
  await riderGuards.assertClean();
  await clientCtx.close();
  await riderCtx.close();
});

test('GPS real del rider se propaga al tracking del cliente por relay', async ({ browser }) => {
  const room = `gps-e2e-${Date.now()}`;
  const url = (suffix = '') => `${RELAY}/?relay=${encodeURIComponent(RELAY)}&room=${room}${suffix}`;

  const clientCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const riderCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
    permissions: ['geolocation'],
    geolocation: { latitude: -38.9462, longitude: -68.0418, accuracy: 14 },
  });
  const client = await clientCtx.newPage();
  const rider = await riderCtx.newPage();
  await stub(client);
  await stub(rider);
  const clientGuards = installPageGuards(client);
  const riderGuards = installPageGuards(rider);

  await client.goto(url());
  await rider.goto(url('#rider'));
  await rider.locator('[data-view="rider"] [data-open-pin]').click();
  await rider.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await rider.locator('[data-pin-form]').press('Enter');

  await client.locator('.mobile-nav [data-nav-view="catalog"]').click();
  await client.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await client.locator('.mobile-nav [data-nav-view="cart"]').click();
  await fillCheckout(client, {
    name: 'Cliente GPS',
    phone: '2995550000',
    address: 'Roca 123',
    notes: 'GPS realtime',
    payment: 'cash',
    deliveryMode: 'delivery',
  });
  await client.getByRole('button', { name: /Confirmar pedido/i }).click();

  await expect(rider.locator('[data-delivery-panel]')).toContainText('LT-0002', { timeout: 10_000 });
  await expect(rider.locator('[data-delivery-panel]')).toContainText('Esperando preparación');

  // El rider comparte su ubicación REAL.
  await rider.locator('[data-sim-gps]').click();

  await expect(rider.locator('[data-delivery-panel]')).toContainText('Compartiendo ubicación', { timeout: 10_000 });
  await expect(rider.locator('[data-delivery-panel]')).toContainText('Detalles de ubicación');
  await expect(rider.locator('[data-delivery-panel] [data-real-map]').first()).toBeVisible({ timeout: 10_000 });
  await expect(rider.locator('[data-delivery-panel] [data-real-map]').first()).toHaveAttribute('data-map-theme', 'light');

  // Recién con GPS real el cliente ve el mapa y la ubicación live del repartidor.
  await expect(client.locator('[data-tracking-panel] [data-real-map]').first()).toBeVisible({ timeout: 10_000 });
  await expect(client.locator('[data-tracking-panel] [data-real-map]').first()).toHaveAttribute('data-map-theme', 'light');
  await expect(client.locator('[data-map-meta]').first()).toContainText('Ubicación del repartidor en vivo', { timeout: 10_000 });
  await expect(client.locator('[data-map-meta]').first()).not.toContainText(/precisión|±/i);
  await expect(client.locator('[data-map-meta]').first()).not.toContainText(/km/i);
  await expect(client.locator('[data-tracking-panel]')).toContainText('Actualizado', { timeout: 10_000 });
  await expect(client.locator('[data-tracking-panel]')).toContainText('Roca 123, Neuquen centro', { timeout: 10_000 });

  await riderCtx.setGeolocation({ latitude: -38.9468, longitude: -68.0424, accuracy: 16 });
  await expect(client.locator('[data-map-meta]').first()).toContainText('Ubicación del repartidor en vivo', { timeout: 10_000 });

  await rider.locator('[data-sim-gps-off]').click();
  await expect(rider.locator('[data-delivery-panel]')).toContainText('Ubicación detenida', { timeout: 10_000 });

  await clientGuards.assertClean();
  await riderGuards.assertClean();

  await clientCtx.close();
  await riderCtx.close();
});
