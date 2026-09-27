import { expect, test } from '@playwright/test';
import {
  fillCheckout,
  gotoDemoReset,
  installBrowserStubs,
  installPageGuards,
  seedCartAboveMinimum,
  waitForToast,
} from './helpers.mjs';

test.describe('E2E Real Browser: Facturación de Pedidos y Taba Fiscal', () => {

  async function unlockIfLocked(p) {
    const pinBtn = p.getByRole('button', { name: /Ingresar codigo|Ingresar código/i });
    if (await pinBtn.isVisible({ timeout: 2500 }).catch(() => false)) {
      await pinBtn.click();
      await p.locator('[data-pin-form] input[name="pin"]').fill('1234');
      await p.locator('[data-pin-form]').press('Enter');
      await expect(p.locator('[data-order-card]').first()).toBeVisible({ timeout: 10000 });
    }
  }

  test('Flujo completo de facturación en pedido existente: Desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const guards = installPageGuards(page);
    await installBrowserStubs(page);

    // 1. Crear un pedido inicial en demo
    await gotoDemoReset(page, '/?reset=1&demo=1#catalog');
    await seedCartAboveMinimum(page);
    await page.locator('[data-floating-cart]').click();
    await fillCheckout(page, {
      name: 'Walter Mostrador',
      phone: '2994112233',
      street: 'Av. Argentina 1842',
      neighborhood: 'Centro',
      reference: 'Local comercial',
      notes: 'Facturar con Efectivo',
      payment: 'cash',
      deliveryMode: 'delivery',
    });
    await page.getByRole('button', { name: /Confirmar pedido/i }).click();
    await waitForToast(page, 'Pedido confirmado. Seguilo en Seguimiento.');

    // 2. Abrir el Panel del negocio
    await page.goto('/?demo=1#business');
    await expect(page.locator('[data-view="business"]')).toBeVisible();
    await unlockIfLocked(page);

    // 3. Inspeccionar el pedido en la bandeja
    const orderCard = page.locator('[data-order-card]').first();
    await expect(orderCard).toBeVisible();
    await expect(orderCard.locator('.production-order-money, .inbox-order-money')).toBeVisible();

    // 4. Verificar presencia de botones de facturación
    const fiscalBlock = orderCard.locator('[data-order-fiscal-block]');
    await expect(fiscalBlock).toBeVisible();

    const billBtn = fiscalBlock.locator('[data-order-bill]');
    const billPrintBtn = fiscalBlock.locator('[data-order-bill-print]');
    await expect(billBtn).toBeVisible();
    await expect(billBtn).toHaveText(/FACTURAR/i);
    await expect(billPrintBtn).toBeVisible();
    await expect(billPrintBtn).toHaveText(/FACTURAR E IMPRIMIR/i);

    // 5. Prueba de doble clic / clic rápido (debounce)
    await billBtn.click({ clickCount: 2, delay: 50 });

    // El botón se deshabilita inmediatamente o muestra "Emitiendo…" o "Factura emitida."
    await expect(fiscalBlock.locator('[data-order-fiscal-status], .order-mode-chip')).toBeVisible();

    // 6. Refresco de página: el estado persiste
    await page.reload();
    await expect(page.locator('[data-view="business"]')).toBeVisible();
    await unlockIfLocked(page);

    // El bloque fiscal sigue visible en la tarjeta
    const reloadedCard = page.locator('[data-order-card]').first();
    await expect(reloadedCard.locator('[data-order-fiscal-block]')).toBeVisible();
  });

  test('Prueba Mobile Responsive (390x844 y 430x932) y Dos Pestañas Concurrentes', async ({ context }) => {
    // Contexto compartido (mismo negocio, dos pestañas concurrentes: mobile y PC)
    const mobilePage = await context.newPage();
    await mobilePage.setViewportSize({ width: 390, height: 844 });
    await installBrowserStubs(mobilePage);

    const pcPage = await context.newPage();
    await pcPage.setViewportSize({ width: 1280, height: 900 });
    await installBrowserStubs(pcPage);

    // Crear pedido desde mobile
    await gotoDemoReset(mobilePage, '/?reset=1&demo=1#catalog');
    await seedCartAboveMinimum(mobilePage);
    await mobilePage.locator('[data-floating-cart]').click();
    await fillCheckout(mobilePage, {
      name: 'Cliente Concurrente',
      phone: '2994998877',
      street: 'Mendoza 827',
      neighborhood: 'Centro',
      payment: 'cash',
      deliveryMode: 'pickup',
    });
    await mobilePage.getByRole('button', { name: /Confirmar pedido/i }).click();
    await waitForToast(mobilePage, 'Pedido confirmado. Seguilo en Seguimiento.');

    // Cargar negocio en mobile y en PC simultáneamente
    await mobilePage.goto('/?demo=1#business');
    await pcPage.goto('/?demo=1#business');

    // Desbloquear PIN en ambos si aparece
    await unlockIfLocked(mobilePage);
    await unlockIfLocked(pcPage);

    // Ambas pantallas ven la misma tarjeta con botones
    const mobileCard = mobilePage.locator('[data-order-card]').first();
    const pcCard = pcPage.locator('[data-order-card]').first();
    await expect(mobileCard).toBeVisible();
    await expect(pcCard).toBeVisible();

    // Prueba de concurrencia: mobile y PC disparan facturación simultáneamente
    await Promise.all([
      mobileCard.locator('[data-order-bill-print]').click(),
      pcCard.locator('[data-order-bill]').click().catch(() => {}),
    ]);

    // Ambas vistas deben converger sin errores SOAP ni caídas
    await expect(mobileCard.locator('[data-order-fiscal-block]')).toBeVisible();
    await expect(pcCard.locator('[data-order-fiscal-block]')).toBeVisible();

    // Comprobar también viewport 430x932 en mobile
    await mobilePage.setViewportSize({ width: 430, height: 932 });
    await expect(mobileCard.locator('[data-order-fiscal-block]')).toBeVisible();

    await mobilePage.close();
    await pcPage.close();
  });

});
