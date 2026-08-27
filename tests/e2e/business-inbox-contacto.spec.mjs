/*
 * EL TELÉFONO, EN LA TARJETA.
 *
 * Estaba dentro de `<details> Ver datos y productos`, así que llamar a quien
 * hizo el pedido —lo primero que hace un local cuando algo no cierra: falta una
 * aclaración, el timbre no anda, se acabó un producto— costaba abrir el detalle
 * primero. En un teléfono, con la bandeja llena y de pie, eso es un toque de más
 * sobre la acción más urgente del mostrador.
 *
 * Y se mide lo otro que el reemplazo total de `innerHTML` se llevaba puesto: el
 * `<details>` abierto y el foco, que se perdían con CADA evento de tiempo real.
 */
import { expect, test } from '@playwright/test';
import {
  fillCheckout,
  gotoDemoReset,
  installBrowserStubs,
  seedCartAboveMinimum,
} from './helpers.mjs';

const TELEFONO = '2995550123';

async function panelConUnPedido(page) {
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1#catalog');
  await seedCartAboveMinimum(page);
  await page.locator('[data-floating-cart]').click();
  await fillCheckout(page, {
    name: 'Ana Pérez',
    phone: TELEFONO,
    deliveryMode: 'pickup',
    payment: 'cash',
  });
  await page.locator('[data-checkout-form] [type="submit"]').click();
  await expect
    .poll(() => page.evaluate(async () => {
      const { getState } = await import('/js/state.js');
      return getState().orders.length;
    }), { timeout: 20_000 })
    .toBeGreaterThan(0);

  await page.evaluate(() => { window.location.hash = '#business'; });
  await page.locator('[data-open-pin][data-admin-target="business"]').click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await expect(page.locator('[data-view="business"]')).toBeVisible();
  await page.locator('[data-inbox-order]').first().waitFor({ state: 'visible', timeout: 20_000 });
}

test.describe('bandeja del negocio · contacto', () => {
  test.describe.configure({ timeout: 120_000 });

  test('el teléfono se ve en la tarjeta, sin abrir el detalle', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await panelConUnPedido(page);

    const tarjeta = page.locator('[data-inbox-order]').first();
    const contacto = tarjeta.locator('.inbox-contact-row');
    await expect(contacto).toBeVisible();
    await expect(contacto).toContainText(TELEFONO);

    // El detalle sigue CERRADO: el teléfono no depende de abrirlo.
    const detalle = tarjeta.locator('details').first();
    if (await detalle.count()) await expect(detalle).not.toHaveAttribute('open', '');

    // Y son acciones reales del sistema operativo, no adornos.
    await expect(contacto.locator('a.inbox-contact-phone')).toHaveAttribute('href', /^tel:/);
    await expect(contacto.locator('a.inbox-contact-wa')).toHaveAttribute('href', /^https:\/\/wa\.me\//);

    // Área táctil de pulgar.
    const alto = await contacto.locator('a.inbox-contact-phone').evaluate((n) => n.getBoundingClientRect().height);
    expect(alto).toBeGreaterThanOrEqual(44);
  });

  test('al entrar un pedido nuevo NO se cierra el detalle abierto ni se pierde el foco', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await panelConUnPedido(page);

    const tarjeta = page.locator('[data-inbox-order]').first();
    // Se sigue al pedido POR SU ID: el que entra después pasa a ser el primero,
    // así que mirar «el primero» mediría la tarjeta equivocada.
    const idOriginal = await tarjeta.getAttribute('data-inbox-order');
    const detalle = tarjeta.locator('details').first();
    await detalle.locator('summary').click();
    await expect(detalle).toHaveAttribute('open', '');

    const boton = tarjeta.locator('[data-order-advance]').first();
    if (await boton.count()) await boton.focus();
    const focoAntes = await page.evaluate(() => document.activeElement?.getAttribute('data-order-advance') || '');

    // Entra un pedido, como en un turno real: el panel se vuelve a dibujar entero.
    await page.evaluate(async () => {
      const { getState, updateState } = await import('/js/state.js');
      const { renderBusinessDashboard } = await import('/js/business.js');
      const base = getState().orders[0];
      const nuevo = JSON.parse(JSON.stringify(base));
      nuevo.id = 'LT-9999';
      nuevo.status = 'received';
      nuevo.createdAt = new Date().toISOString();
      updateState((estado) => { estado.orders = [nuevo, ...estado.orders]; });
      renderBusinessDashboard();
    });

    // Lo que el operador estaba leyendo sigue abierto.
    await expect(page.locator(`[data-inbox-order="${idOriginal}"]`).locator('details').first())
      .toHaveAttribute('open', '');
    if (focoAntes) {
      const focoDespues = await page.evaluate(() => document.activeElement?.getAttribute('data-order-advance') || '');
      expect(focoDespues, 'el foco se perdió al entrar un pedido').toBe(focoAntes);
    }
  });
});
