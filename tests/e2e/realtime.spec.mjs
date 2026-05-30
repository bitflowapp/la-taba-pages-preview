import { expect, test } from '@playwright/test';
import { fillCheckout } from './helpers.mjs';

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

  // Rider: llegué al domicilio -> el cliente ve "Llegando".
  await rider.locator('[data-delivery-arrive="LT-0002"]').click();
  await expect(client.locator('[data-tracking-panel]')).toContainText('Llegando', { timeout: 10_000 });

  // Rider: pedido entregado -> el cliente ve entregado.
  await rider.locator('[data-delivery-done="LT-0002"]').click();
  await expect(client.locator('[data-tracking-panel]')).toContainText(/entregado|Disfrutalo/i, { timeout: 10_000 });

  await clientCtx.close();
  await riderCtx.close();
});
