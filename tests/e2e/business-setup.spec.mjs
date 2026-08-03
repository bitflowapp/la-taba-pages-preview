import { expect, test } from '@playwright/test';
import { fillCheckout, gotoDemoReset, installPageGuards, openBusinessSection, waitForToast } from './helpers.mjs';

test('Business setup wizard mobile: guarda, persiste y restaura solo la config demo', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await page.addInitScript(() => {
    window.__openedUrls = [];
    window.__clipboardText = '';
    window.open = (...args) => {
      window.__openedUrls.push(String(args[0] || ''));
      return null;
    };
    const clipboardStub = {
      writeText: async (text) => {
        window.__clipboardText = String(text);
      },
      readText: async () => window.__clipboardText,
    };
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: clipboardStub,
      });
    } catch (_) {
      navigator.clipboard = clipboardStub;
    }
  });

  await gotoDemoReset(page, '/?reset=1&demo=1#business');
  await page.getByRole('button', { name: /Ingresar c[óo]digo/i }).click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await expect(page.locator('[data-view="business"]')).toBeVisible();

  await openBusinessSection(page, '[data-scroll-business-setup]');
  const setup = page.locator('[data-business-setup]');
  await expect(setup).toBeVisible();

  await page.getByLabel('Comercio visible').fill('QA Store');
  await page.getByLabel('Subtítulo del local').fill('Demo autoservicio QA');
  await page.getByLabel('Prefijo de pedido').fill('QA');
  await page.getByLabel('Dirección').fill('Roca 123, Neuquén');
  await page.getByLabel('WhatsApp').fill('5492995551234');
  await page.getByLabel('Zona de entrega').fill('Centro QA y alrededores');
  await page.getByLabel('Texto visible de horarios').fill('Lunes a viernes 10 a 20');
  await page.getByLabel('Hora de apertura').fill('10');
  await page.getByLabel('Hora de cierre').fill('20');
  await page.getByLabel('Costo de envío').fill('777');
  await page.getByLabel('Pedido mínimo para envío').fill('1000');
  await page.getByLabel('PIN del negocio').fill('4567');

  await expect(page.locator('[data-business-setup-preview]')).toContainText('QA Store');
  await page.getByLabel('PIN del negocio').press('Enter');
  await waitForToast(page, 'Configuración guardada.');
  await expect(page.locator('[data-business-setup-feedback]')).toContainText('Configuración guardada.');

  await page.locator('.topbar .brand').click();
  await expect(page.locator('[data-view="home"]')).toBeVisible();
  await page.locator('.mobile-nav [data-nav-view="profile"]').click();
  await expect(page.locator('.topbar .brand')).toContainText('QA Store');
  await expect(page.locator('[data-view="profile"]')).toContainText('QA Store');
  await expect(page.locator('[data-view="profile"]')).toContainText('Roca 123, Neuquén');
  await expect(page.locator('[data-view="profile"]')).toContainText('Lunes a viernes 10 a 20');
  await expect(page.locator('[data-view="profile"]')).toContainText('Centro QA y alrededores');
  await expect(page.locator('[data-business-whatsapp]')).toContainText('+5492995551234');

  await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  const productCountBeforeRestore = await page.locator('[data-product-grid] .product-card').count();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('[data-floating-cart]').click();
  await expect(page.locator('[data-order-summary]')).toContainText('$ 777');
  await expect(page.locator('[data-order-summary]')).toContainText('$ 1.000');
  await fillCheckout(page, {
    name: 'Cliente Wizard',
    phone: '2995550000',
    street: 'Roca 456',
    neighborhood: 'Centro',
    reference: 'Timbre QA',
    notes: 'Pedido setup wizard',
    payment: 'cash',
    deliveryMode: 'delivery',
  });
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, 'Pedido confirmado');
  await expect(page.locator('[data-tracking-panel]')).toContainText('QA-0001');
  await expect(page.locator('[data-tracking-panel] [data-real-map]')).toHaveCount(0);

  await page.reload();
  await expect(page.locator('.topbar .brand')).toContainText('QA Store');
  await page.evaluate(() => { window.location.hash = '#profile'; });
  await expect(page.locator('[data-view="profile"]')).toContainText('Roca 123, Neuquén');
  await expect(page.locator('[data-business-whatsapp]')).toContainText('+5492995551234');

  await page.evaluate(() => { window.location.hash = '#business'; });
  await expect(page.locator('[data-view="business"]')).toBeVisible();

  await openBusinessSection(page, '[data-scroll-business-setup]');
  await setup.getByRole('button', { name: 'Restaurar configuración base' }).first().click();
  const resetModal = page.locator('[data-business-setup-reset-modal]');
  await expect(resetModal).toBeVisible();
  await expect(resetModal).toContainText('No borra pedidos, productos, carrito, historial de clientes ni cierres de caja.');
  await resetModal.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.locator('.topbar .brand')).toContainText('QA Store');

  await setup.getByRole('button', { name: 'Restaurar configuración base' }).first().click();
  await resetModal.getByRole('button', { name: 'Restaurar configuración base' }).click();
  await waitForToast(page, 'Configuración base restaurada.');
  await expect(page.locator('.topbar .brand')).toContainText('La Taba 2');
  await page.locator('[data-business-view="orders"]').click();
  await expect(page.locator('[data-business-dashboard]')).toContainText('QA-0001');

  await page.locator('.topbar .brand').click();
  await expect(page.locator('[data-view="home"]')).toBeVisible();
  await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  await expect(page.locator('[data-product-grid] .product-card')).toHaveCount(productCountBeforeRestore);

  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(noOverflow).toBeTruthy();

  await guards.assertClean();
  await context.close();
});
