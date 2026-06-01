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

async function riderProgress(page) {
  const style = (await page.locator('[data-tracking-panel] .map-marker.rider').getAttribute('style')) || '';
  const match = style.match(/--p:\s*([0-9.]+)/);
  return match ? Number.parseFloat(match[1]) : 0;
}

test('cliente y rider en dos equipos: pedido interno, realtime, simulación y entrega', async ({ browser }) => {
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
  await expect(rider.locator('[data-map-shell="rider"]')).toBeVisible();
  await expect(rider.locator('[data-real-map][data-map-role^="rider"]').first()).toHaveClass(/map-theme-dark/);

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
  await expect(client.locator('[data-real-map][data-map-role="tracking"]')).toBeVisible();
  await expect(client.locator('[data-real-map][data-map-role="tracking"]')).toHaveClass(/map-theme-light/);
  await expect(client.locator('[data-map-shell="tracking"]')).toBeVisible();
  await expect(client.locator('[data-tracking-panel] [data-bottom-sheet]')).toBeVisible();
  await expect(client.locator('[data-tracking-panel]')).toContainText('Roca 123, Neuquen centro');

  // El rider ve el pedido del cliente SIN recargar (vía relay).
  await expect(rider.locator('[data-delivery-panel]')).toContainText('LT-0002', { timeout: 10_000 });
  await expect(rider.locator('[data-delivery-panel]')).toContainText('Esperando preparación');

  // Rider: marcar listo y salir del local.
  await rider.locator('[data-rider-ready="LT-0002"]').click();
  await rider.locator('[data-delivery-leave="LT-0002"]').click();

  // El cliente ve "en camino" sin recargar.
  await expect(client.locator('[data-tracking-panel]')).toContainText(/en camino|Llegando/i, { timeout: 10_000 });

  // Rider inicia simulación; el cliente ve avanzar el progreso del rider.
  const beforeStart = await riderProgress(client);
  await rider.locator('[data-sim-start]').click();
  await expect.poll(async () => riderProgress(client), { timeout: 15_000 }).toBeGreaterThan(beforeStart);
  await expect(client.locator('[data-map-meta]').first()).toContainText(/Ubicación estimada|Ubicación rider/i);

  // Otra sala no mezcla el pedido ni la ubicación del rider.
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

test('GPS del rider se propaga al tracking del cliente por relay', async ({ browser }) => {
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
  await rider.locator('[data-street-destination]').selectOption('alto-comahue');
  await rider.locator('[data-sim-gps]').click();

  await expect(rider.locator('[data-delivery-panel]')).toContainText('GPS compartiendo ubicación', { timeout: 10_000 });
  await expect(rider.locator('[data-delivery-panel]')).toContainText('Detalles de ubicación');
  await expect(client.locator('[data-map-meta]').first()).toContainText('Ubicación rider', { timeout: 10_000 });
  await expect(client.locator('[data-map-meta]').first()).not.toContainText(/precisión|±/i);
  await expect(client.locator('[data-tracking-panel]')).toContainText('Roca 123, Neuquen centro', { timeout: 10_000 });

  await riderCtx.setGeolocation({ latitude: -38.9468, longitude: -68.0424, accuracy: 16 });
  await expect(client.locator('[data-map-meta]').first()).toContainText('Ubicación rider', { timeout: 10_000 });

  await rider.locator('[data-sim-gps-off]').click();
  await expect(rider.locator('[data-delivery-panel]')).toContainText('GPS detenido', { timeout: 10_000 });

  await clientGuards.assertClean();
  await riderGuards.assertClean();

  await clientCtx.close();
  await riderCtx.close();
});
