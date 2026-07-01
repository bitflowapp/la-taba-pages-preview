import { expect, test } from '@playwright/test';
import { installPageGuards } from './helpers.mjs';

// Confirmación segura de cancelación/rechazo desde el panel negocio (sin
// window.confirm): el primer tap abre un modal con motivo obligatorio, "Volver"
// no cancela, y recién "Confirmar" con motivo cambia el estado. Mobile-first.

function seededState(status) {
  const at = new Date().toISOString();
  return {
    orders: [{
      id: 'LT-0002',
      customerName: 'Walter Cliente',
      customerPhone: '2995551234',
      address: 'Mendoza 851, Centro',
      addressDetails: { streetLine: 'Mendoza 851', neighborhood: 'Centro', reference: 'Portón gris', label: 'Mendoza 851, Centro' },
      deliveryMode: 'delivery',
      paymentMethod: 'Efectivo',
      notes: 'Sin sal',
      createdAt: at,
      status,
      items: [{ productId: 'p-muzzarella', name: 'Vacío premium', icon: '', quantity: 1, unitPrice: 31890, unit: 'kg' }],
      subtotal: 31890, deliveryFee: 1990, total: 33880,
      statusHistory: [{ status: 'received', at }],
      delivery: { driverName: 'Sin asignar', driverPhone: '', currentLocationLabel: 'En el local' },
    }],
    lastOrderId: 'LT-0002',
    cart: [],
  };
}

async function seedAndOpenBusiness(page, state) {
  await page.addInitScript((saved) => {
    window.open = () => null;
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('la_taba_mvp_v4_state', JSON.stringify(saved));
  }, state);
  await page.goto('/');
  await page.locator('.mobile-nav [data-nav-view="profile"]').click();
  await page.locator('[data-view="profile"] [data-open-admin-view="business"]').click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await expect(page.locator('[data-view="business"]')).toBeVisible();
}

test('rechazar pedido: el primer tap no cancela, "Volver" no cancela y confirmar con motivo sí', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await seedAndOpenBusiness(page, seededState('received'));

  const orderCard = page.locator('.inbox-order[data-inbox-order="LT-0002"]');
  await expect(orderCard).toBeVisible();

  const modal = page.locator('[data-cancel-modal]');

  // 1) Primer tap en "Cancelar": abre el modal, NO cancela.
  await orderCard.locator('[data-order-cancel]').click();
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('LT-0002');
  await expect(modal).toContainText('Cancelar este pedido');
  await expect(orderCard).toBeVisible(); // sigue activo
  await expect(orderCard).not.toContainText('Cancelado');

  // 2) "Volver" cierra sin cancelar.
  await modal.locator('[data-cancel-dismiss]').click();
  await expect(modal).toBeHidden();
  await expect(orderCard).toBeVisible();

  // 3) Reabrir y confirmar SIN motivo: muestra la ayuda y NO cancela.
  await orderCard.locator('[data-order-cancel]').click();
  await expect(modal).toBeVisible();
  await modal.locator('[data-cancel-confirm]').click();
  await expect(modal.locator('[data-cancel-hint]')).toBeVisible();
  await expect(modal).toBeVisible();
  await expect(page.locator('.inbox-order[data-inbox-order="LT-0002"]')).toBeVisible();

  // 4) Elegir motivo (chip) y confirmar: ahora sí cancela y registra el motivo.
  await modal.locator('[data-cancel-preset="Sin stock"]').click();
  await expect(modal.locator('[data-cancel-reason]')).toHaveValue('Sin stock');
  await modal.locator('[data-cancel-confirm]').click();
  await expect(modal).toBeHidden();

  // El pedido sale de la cola activa y queda en cerrados con el motivo visible.
  await expect(page.locator('.inbox-order[data-inbox-order="LT-0002"]')).toHaveCount(0);
  const closed = page.locator('.inbox-closed');
  await expect(closed).toContainText('LT-0002');
  await expect(closed).toContainText('Cancelado');
  await expect(closed).toContainText('Motivo: Sin stock');

  // Sin overflow horizontal ni errores JS.
  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(noOverflow).toBeTruthy();
  await guards.assertClean();
  await context.close();
});

test('rechazar un pedido en reparto muestra un aviso reforzado antes de cancelar', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await seedAndOpenBusiness(page, seededState('on_the_way'));

  const orderCard = page.locator('.inbox-order[data-inbox-order="LT-0002"]');
  await expect(orderCard).toBeVisible();
  await orderCard.locator('[data-order-cancel]').click();

  const modal = page.locator('[data-cancel-modal]');
  await expect(modal).toBeVisible();
  // Aviso explícito porque ya hay rider/cliente involucrados.
  await expect(modal.locator('.cancel-onway-warning')).toBeVisible();
  await expect(modal).toContainText('ya está en reparto');
  await expect(modal.locator('[data-cancel-confirm]')).toContainText('cancelar el reparto');

  // No cancela hasta confirmar con motivo.
  await modal.locator('[data-cancel-reason]').fill('Cliente no responde');
  await modal.locator('[data-cancel-confirm]').click();
  await expect(modal).toBeHidden();
  await expect(page.locator('.inbox-closed')).toContainText('Motivo: Cliente no responde');

  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(noOverflow).toBeTruthy();
  await guards.assertClean();
  await context.close();
});
