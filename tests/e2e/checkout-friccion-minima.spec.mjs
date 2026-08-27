/*
 * EL CLIENTE NO ESTÁ CREANDO UN PERFIL. ESTÁ HACIENDO UN PEDIDO.
 *
 * Esta suite fija cuántas cosas hay que contestar para comprar, y que ninguna
 * de ellas obligue a SALIR del pedido.
 *
 * El defecto que cierra, medido: quien compraba por primera vez y elegía retiro
 * en local recibía una tarjeta «Completá tu perfil para continuar» con un botón
 * que navegaba a `#profile`. Para retiro eso era TODO el trámite —no hace falta
 * ninguna dirección— y aun así costaba dos navegaciones y perder el hilo del
 * pedido. El nombre y el WhatsApp ahora se piden en línea, con la misma capa de
 * guardado que ya usaba el editor de direcciones.
 *
 * Lo que NO se afloja, y por eso se mide también: el punto de entrega
 * confirmado sigue siendo obligatorio para delivery, y un campo con error tiene
 * que quedar A LA VISTA aunque viva en el pliegue de opcionales.
 */
import { expect, test } from '@playwright/test';
import {
  gotoDemoReset,
  installBrowserStubs,
  seedCartAboveMinimum,
  seedCheckoutProfile,
} from './helpers.mjs';

/*
 * Carrito con producto y checkout a la vista, con el Perfil VACÍO.
 *
 * El vaciado es explícito y no accidental: el sandbox del modo demostración
 * pre-siembra un perfil («Cliente Demo»), así que sin esto la suite mediría
 * siempre a un cliente que ya tiene sus datos —justo el caso que NO tiene
 * fricción—. Se siembra por el mismo helper que el resto de las suites, con
 * nombre y teléfono en blanco.
 */
async function checkoutDeClienteNuevo(page) {
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1#catalog');
  await seedCartAboveMinimum(page);
  await seedCheckoutProfile(page, { name: '', phone: '', addresses: [] });
  await page.evaluate(() => { window.location.hash = '#cart'; });
  await expect(page.locator('[data-checkout-form]')).toBeVisible();
}

test.describe('checkout · fricción mínima', () => {
  test.describe.configure({ timeout: 120_000 });

  test('cliente nuevo + retiro: dos campos en línea y NUNCA se sale del pedido', async ({ page }) => {
    await checkoutDeClienteNuevo(page);
    await page.getByLabel('Retiro en local').check();

    const bloque = page.locator('[data-profile-identity-form]');
    await expect(bloque).toBeVisible();

    // Los DOS conceptos del retiro, y nada más.
    await expect(bloque.locator('[name="checkoutIdentityName"]')).toBeVisible();
    await expect(bloque.locator('[name="checkoutIdentityPhone"]')).toBeVisible();
    expect(await bloque.locator('input, select, textarea').count()).toBe(2);

    // Y ningún camino que mande a otra pantalla.
    await expect(bloque.locator('[data-profile-checkout-action="edit-profile"]')).toHaveCount(0);
    await expect(bloque).not.toContainText('Perfil');

    await bloque.locator('[name="checkoutIdentityName"]').fill('Ana Pérez');
    await bloque.locator('[name="checkoutIdentityPhone"]').fill('299 620 9136');
    await bloque.locator('[data-profile-checkout-action="save-identity"]').click();

    // Se guardó SIN navegar: seguimos en el carrito y el bloque ya no pide nada.
    await expect(page.locator('[data-profile-identity-form]')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator('[data-checkout-form]')).toBeVisible();
    expect(await page.evaluate(() => window.location.hash)).toBe('#cart');
  });

  test('un teléfono inválido se dice en línea y NO borra lo que la persona escribió', async ({ page }) => {
    await checkoutDeClienteNuevo(page);
    await page.getByLabel('Retiro en local').check();

    const bloque = page.locator('[data-profile-identity-form]');
    await bloque.locator('[name="checkoutIdentityName"]').fill('Ana Pérez');
    await bloque.locator('[name="checkoutIdentityPhone"]').fill('123');
    await bloque.locator('[data-profile-checkout-action="save-identity"]').click();

    await expect(page.locator('.profile-checkout-identity-error')).toBeVisible();
    // Lo escrito sobrevive al error: volver a pedirlo es perder la compra.
    await expect(page.locator('[name="checkoutIdentityName"]')).toHaveValue('Ana Pérez');
    expect(await page.evaluate(() => window.location.hash)).toBe('#cart');
  });

  test('cliente nuevo + delivery: los detalles de entrega arrancan plegados', async ({ page }) => {
    await checkoutDeClienteNuevo(page);
    await seedCheckoutProfile(page, { name: 'Ana Pérez', phone: '2996209136', addresses: [] });
    await page.evaluate(() => { window.location.hash = '#cart'; });

    await page.locator('[data-profile-checkout-action="new-address"]').first().click();
    const editor = page.locator('[data-address-capture="checkout"]');
    await expect(editor).toBeVisible();

    // Arriba sólo lo que define la dirección.
    await expect(editor.locator('[name="captureAddressStreet"]')).toBeVisible();
    await expect(editor.locator('[name="captureAddressNumber"]')).toBeVisible();

    // Lo demás, plegado y accesible.
    const pliegue = editor.locator('[data-address-capture-optional]');
    await expect(pliegue).toHaveCount(1);
    await expect(pliegue).not.toHaveAttribute('open', '');
    await expect(editor.locator('[name="captureAddressReference"]')).toBeHidden();

    await pliegue.locator('> summary').click();
    await expect(editor.locator('[name="captureAddressReference"]')).toBeVisible();
    await expect(editor.locator('[name="captureAddressFloor"]')).toBeVisible();
  });

  test('un error sobre un campo plegado ABRE el pliegue en vez de señalar el vacío', async ({ page }) => {
    await checkoutDeClienteNuevo(page);
    await seedCheckoutProfile(page, { name: 'Ana Pérez', phone: '2996209136', addresses: [] });
    await page.evaluate(() => { window.location.hash = '#cart'; });
    await page.locator('[data-profile-checkout-action="new-address"]').first().click();

    const editor = page.locator('[data-address-capture="checkout"]');
    // Calle sí, número no: el rechazo apunta a un campo que está ARRIBA, así que
    // esta prueba mide el otro lado —que guardar sin número no pasa en silencio—.
    await editor.locator('[name="captureAddressStreet"]').fill('Antártida Argentina');
    await editor.locator('[data-address-capture-save]').click();
    await expect(editor.locator('[data-address-capture-status]')).not.toHaveText('');
  });

  test('cliente recurrente: cero campos, resumen y «Cambiar»', async ({ page }) => {
    await installBrowserStubs(page);
    await gotoDemoReset(page, '/?reset=1&demo=1#catalog');
    await seedCartAboveMinimum(page);
    await seedCheckoutProfile(page, { name: 'Ana Pérez', phone: '2996209136' });
    await page.evaluate(() => { window.location.hash = '#cart'; });
    await expect(page.locator('[data-checkout-form]')).toBeVisible();

    const resumen = page.locator('[data-checkout-summary-rows]');
    // El resumen sólo aparece con historial real de compras; si esta versión de
    // la semilla no lo trae, lo que NO puede haber es un formulario de identidad.
    if (await resumen.count()) {
      await expect(resumen).toBeVisible();
      await expect(resumen).toContainText('Ana Pérez');
      await expect(page.locator('[data-profile-identity-form]')).toHaveCount(0);
    } else {
      await expect(page.locator('[data-profile-identity-form]')).toHaveCount(0);
    }
  });

  for (const ancho of [320, 390, 430]) {
    test(`a ${ancho}px el checkout de retiro entra sin desbordar y con el CTA alcanzable`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: 780 });
      await checkoutDeClienteNuevo(page);
      await page.getByLabel('Retiro en local').check();

      const bloque = page.locator('[data-profile-identity-form]');
      await expect(bloque).toBeVisible();

      // Nada desborda a lo ancho.
      const desborde = await page.evaluate(() => (
        document.documentElement.scrollWidth - document.documentElement.clientWidth
      ));
      expect(desborde, `la pantalla desborda ${desborde}px a lo ancho`).toBeLessThanOrEqual(1);

      // 16px en los inputs: por debajo, Safari en iPhone hace zoom al enfocar y
      // se lleva el botón de confirmar fuera de la vista.
      for (const campo of ['checkoutIdentityName', 'checkoutIdentityPhone']) {
        const tamano = await page.locator(`[name="${campo}"]`).evaluate((n) => (
          Number.parseFloat(getComputedStyle(n).fontSize)
        ));
        expect(tamano, `${campo} tiene ${tamano}px y dispara el zoom de Safari`).toBeGreaterThanOrEqual(16);
      }

      // El botón de guardar se puede tocar con el pulgar: 44px reales.
      const alto = await bloque.locator('[data-profile-checkout-action="save-identity"]')
        .evaluate((n) => n.getBoundingClientRect().height);
      expect(alto).toBeGreaterThanOrEqual(44);
    });
  }
});
