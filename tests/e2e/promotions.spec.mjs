import { expect, test } from '@playwright/test';
import { installBrowserStubs, installPageGuards, waitForToast } from './helpers.mjs';

test('sandbox only publishes a human-approved SKU promotion and syncs it to customer tabs', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const business = await context.newPage();
  const customer = await context.newPage();
  const businessGuards = installPageGuards(business);
  const customerGuards = installPageGuards(customer);
  await installBrowserStubs(business);
  await installBrowserStubs(customer);

  await customer.goto('/?reset=1&demo=1#home');
  await expect(customer.locator('[data-promo-banner]')).toBeHidden();

  await business.goto('/?demo=1#business');
  await business.getByRole('button', { name: /Ingresar c[óo]digo/i }).click();
  await business.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await business.locator('[data-pin-form]').press('Enter');
  await business.locator('[data-business-view="promotions"]').click();
  await expect(business.locator('[data-promotion-manager]')).toBeVisible();
  await expect(business.locator('[data-promotion-row="promo-candidate-monster-import"]')).toContainText('No publicada');

  await business.locator('[data-promotion-new]').click();
  const form = business.locator('[data-promotion-form]');
  await form.locator('[name="promoId"]').fill('promo-coca-confirmada-e2e');
  await form.locator('[name="title"]').fill('Coca-Cola por unidad — condición confirmada');
  await form.locator('[name="includedSkus"]').selectOption(['qa-promo-bebidas']);
  await form.locator('[name="regularPrice"]').fill('5000');
  await form.locator('[name="promotionalPrice"]').fill('4200');
  await form.locator('[name="validFrom"]').fill('2020-01-01');
  await form.locator('[name="validUntil"]').fill('2099-12-31');
  await form.locator('[name="approvalStatus"]').selectOption('APROBADA');
  await form.locator('[name="approvalReference"]').fill('E2E-APPROVAL-001');
  await form.locator('[name="sourceEvidence"]').fill('Registro de aprobación sandbox para prueba automatizada.');
  await form.locator('[name="terms"]').fill('Precio especial por unidad.');
  await form.locator('[name="active"]').check();
  await form.locator('[data-promotion-save]').click();
  await waitForToast(business, /Promoción activada/i);
  await expect(business.locator('[data-promotion-row="promo-coca-confirmada-e2e"]')).toContainText('Activa');

  await expect(customer.locator('[data-promo-banner]')).toBeVisible();
  await expect(customer.locator('[data-promo-banner]')).toContainText('Coca-Cola por unidad');
  await customer.goto('/?demo=1#catalog');
  await customer.locator('[data-view="catalog"] [data-category-strip] [data-category-id="promos"]').click();
  const promotedCard = customer.locator('[data-product-grid] .product-card', { hasText: 'Coca-Cola Original 1,5 L' });
  await expect(promotedCard).toBeVisible();
  await expect(promotedCard).toContainText('4.200');
  await expect(promotedCard).toContainText('Precio promocional');
  await promotedCard.locator('[data-add-product]').click();
  await customer.locator('[data-floating-cart]').click();
  await expect(customer.locator('[data-order-summary]')).toContainText('Coca-Cola por unidad — condición confirmada');
  await expect(customer.locator('[data-order-summary]')).toContainText('800');
  await expect(customer.locator('[data-order-summary]')).toContainText('6.190');

  await customer.reload();
  await customer.goto('/?demo=1#home');
  await expect(customer.locator('[data-promo-banner]')).toBeVisible();
  await businessGuards.assertClean();
  await customerGuards.assertClean();
  await context.close();
});

test('business distinguishes scheduled and expired promotions without publishing either', async ({ page }) => {
  await installBrowserStubs(page);
  await page.goto('/?demo=1#business');
  await page.locator('[data-view="business"]').waitFor({ state: 'visible' });
  await page.evaluate(async () => {
    const { updateState } = await import(new URL('js/state.js', location.href).href);
    const shared = {
      title: 'Coca-Cola Original 1,5 L',
      includedSkus: ['qa-promo-bebidas'],
      promotionType: 'precio_promocional',
      regularPrice: 5000,
      promotionalPrice: 4200,
      requiredQuantity: 1,
      active: true,
      priority: 10,
      previewOnly: true,
      approvalStatus: 'APROBADA',
      approvalReference: 'E2E-APPROVAL-002',
      sourceEvidence: 'Registro de aprobación de prueba.',
      terms: 'Precio especial por unidad.',
    };
    updateState((draft) => {
      draft.promotions = [
        { ...shared, promoId: 'promo-futura-e2e', validFrom: '2099-01-01', validUntil: '2099-01-31' },
        { ...shared, promoId: 'promo-vencida-e2e', validFrom: '2020-01-01', validUntil: '2020-01-31' },
      ];
    });
  });
  const dashboard = page.locator('[data-business-dashboard]');
  if (!(await dashboard.isVisible())) {
    await page.locator('[data-open-pin][data-admin-target="business"]').first().click();
    await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
    await page.locator('[data-pin-form]').press('Enter');
  }
  await dashboard.waitFor({ state: 'visible' });
  await page.locator('[data-business-view="promotions"]').click();
  await expect(page.locator('[data-promotion-row="promo-futura-e2e"]')).toContainText('Programada');
  await expect(page.locator('[data-promotion-row="promo-vencida-e2e"]')).toContainText('Vencida');
  await expect(page.locator('.business-promo-count')).toContainText('0 activas');
});
