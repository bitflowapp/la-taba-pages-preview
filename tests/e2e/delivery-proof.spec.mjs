import { expect, test } from '@playwright/test';
import { fillCheckout, gotoDemoReset, installBrowserStubs, installPageGuards, waitForToast } from './helpers.mjs';

const PROOF_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

test('Delivery proof photo: rider adjunta foto y negocio ve comprobante local/demo', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await installBrowserStubs(page);

  await gotoDemoReset(page, '/?reset=1&demo=1');

  await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('[data-floating-cart]').click();
  await fillCheckout(page, {
    name: 'Cliente Foto',
    phone: '2995557777',
    street: 'Roca 123',
    neighborhood: 'Centro',
    reference: 'Casa verde',
    notes: 'Dejar en porton',
    payment: 'cash',
    deliveryMode: 'delivery',
  });
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, 'Pedido confirmado. Seguilo en Seguimiento.');

  await page.goto('/?demo=1#business');
  await expect(page.locator('[data-view="business"]')).toBeVisible();
  await page.locator('[data-open-pin][data-admin-target="business"]').click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await expect(page.locator('[data-view="business"]')).toBeVisible();
  await expect(page.locator('[data-inbox-order="LT-0002"]')).toBeVisible();

  await page.locator('[data-inbox-order="LT-0002"] [data-prep-minutes]').selectOption('20');
  await page.locator('[data-order-advance="LT-0002"]').click();
  await waitForToast(page, 'Estado del pedido actualizado.');
  await page.locator('[data-order-advance="LT-0002"]').click();
  await waitForToast(page, 'Estado del pedido actualizado.');

  await page.goto('/?demo=1#rider');
  await page.locator('[data-rider-accept="LT-0002"]').click();
  await waitForToast(page, 'Entrega aceptada. Ya podés ver los datos del pedido.');
  await page.locator('[data-delivery-leave="LT-0002"]').click();
  await waitForToast(page, 'Pedido marcado como en camino.');

  await page.goto('/?demo=1#tracking');
  const tracking = page.locator('[data-tracking-panel]');
  await expect(tracking.locator('.tracking-hero h1')).toHaveText('Tu pedido está en camino');
  await expect(tracking.locator('[data-tracking-map-placeholder]')).toContainText('Ubicación no disponible');
  await expect(tracking.locator('[data-tracking-gps-note]')).toHaveText(
    'El rider está en camino. La ubicación aparecerá cuando esté disponible.',
  );
  await expect(tracking.locator('[data-real-map]')).toHaveCount(0);
  await expect(tracking.locator('.lt-rider-marker')).toHaveCount(0);

  await page.goto('/?demo=1#rider');
  const riderPanel = page.locator('[data-delivery-panel]');
  await expect(riderPanel).toContainText('LT-0002');
  await riderPanel.locator('[data-delivery-arrive="LT-0002"]').click();
  await waitForToast(page, 'Llegada al domicilio registrada.');
  await expect(riderPanel).toContainText('Foto de entrega');

  await riderPanel.locator('[data-delivery-proof-input="LT-0002"]').setInputFiles({
    name: 'proof.png',
    mimeType: 'image/png',
    buffer: PROOF_PNG,
  });
  await waitForToast(page, 'Foto de entrega adjunta.');
  await expect(riderPanel.locator('[data-delivery-proof-preview]')).toBeVisible();
  await expect(riderPanel).toContainText('Comprobante tomado');

  await riderPanel.locator('[data-delivery-proof-remove="LT-0002"]').click();
  await waitForToast(page, 'Foto de entrega quitada.');
  await expect(riderPanel.locator('[data-delivery-proof-preview]')).toHaveCount(0);

  const businessNoProofPage = await context.newPage();
  await businessNoProofPage.goto('/?demo=1#business');
  await expect(businessNoProofPage.locator('[data-view="business"]')).toBeVisible();
  await businessNoProofPage.locator('[data-open-pin][data-admin-target="business"]').click();
  await businessNoProofPage.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await businessNoProofPage.locator('[data-pin-form]').press('Enter');
  await expect(businessNoProofPage.locator('[data-view="business"]')).toBeVisible();
  await expect(businessNoProofPage.locator('[data-inbox-order="LT-0002"] [data-delivery-proof-summary]')).toHaveCount(0);
  await businessNoProofPage.close();

  await page.goto('/?demo=1#rider');
  await expect(page.locator('[data-delivery-panel]')).toContainText('LT-0002');
  await page.locator('[data-delivery-proof-input="LT-0002"]').setInputFiles({
    name: 'proof-2.png',
    mimeType: 'image/png',
    buffer: PROOF_PNG,
  });
  await waitForToast(page, 'Foto de entrega adjunta.');
  await expect(page.locator('[data-delivery-panel] [data-delivery-proof-preview]')).toBeVisible();

  await page.goto('/?demo=1#tracking');
  const code = await page.locator('[data-delivery-code]').getAttribute('data-delivery-code');
  expect(code).toMatch(/^\d{4}$/);
  await page.goto('/?demo=1#rider');
  await page.locator('[data-delivery-code-input="LT-0002"]').fill(code);
  await page.locator('[data-delivery-code-confirm="LT-0002"]').click();
  await waitForToast(page, 'Código de entrega confirmado.');
  await riderPanel.locator('[data-delivery-done="LT-0002"]').click();
  await waitForToast(page, 'Pedido marcado como entregado.');

  const businessWithProofPage = await context.newPage();
  await businessWithProofPage.goto('/?demo=1#business');
  await expect(businessWithProofPage.locator('[data-view="business"]')).toBeVisible();
  await businessWithProofPage.locator('[data-open-pin][data-admin-target="business"]').click();
  await businessWithProofPage.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await businessWithProofPage.locator('[data-pin-form]').press('Enter');
  await expect(businessWithProofPage.locator('[data-view="business"]')).toBeVisible();
  await businessWithProofPage.locator('[data-order-filter="done"]').click();
  const proof = businessWithProofPage.locator('[data-delivery-proof-summary="LT-0002"]');
  await expect(proof).toBeVisible();
  await expect(proof).toContainText('Foto de entrega');
  await expect(proof.locator('[data-delivery-proof-thumb]')).toBeVisible();
  await expect(businessWithProofPage.locator('[data-order-inbox]')).toContainText('Entregado');

  await proof.locator('[data-order-proof="LT-0002"]').click();
  await expect(businessWithProofPage.locator('[data-delivery-proof-modal]')).toBeVisible();
  await expect(businessWithProofPage.locator('[data-delivery-proof-modal]')).toContainText('Comprobante tomado');
  await expect(businessWithProofPage.locator('[data-delivery-proof-modal-image]')).toBeVisible();
  await businessWithProofPage.locator('[data-close-modal]').click();
  await businessWithProofPage.close();

  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(noOverflow).toBeTruthy();

  await guards.assertClean();
  await context.close();
});
