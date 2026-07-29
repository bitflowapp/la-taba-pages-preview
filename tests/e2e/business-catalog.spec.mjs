import { expect, test } from '@playwright/test';
import { gotoDemoReset, installBrowserStubs, installPageGuards, waitForToast } from './helpers.mjs';

test('Negocio: crea, edita, pausa y restaura el catálogo editable', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await installBrowserStubs(page);

  await gotoDemoReset(page, '/?reset=1&demo=1#business');
  await page.getByRole('button', { name: /Ingresar codigo|Ingresar código/i }).click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await expect(page.locator('[data-view="business"]')).toBeVisible();
  await page.locator('[data-scroll-catalog]').click();

  // El formulario de alta arranca cerrado: se abre con "Nuevo producto".
  await expect(page.locator('[data-catalog-form]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Nuevo producto' }).click();
  await expect(page.locator('[data-catalog-form]')).toBeVisible();

  await page.getByLabel('Producto a vender').fill('Producto Catalogo QA');
  await page.getByLabel('Precio').fill('12345');
  await page.locator('select[name="categoryId"]').selectOption('gaseosas');
  await page.getByLabel('Descripción breve').fill('Producto creado desde negocio');
  await page.getByLabel('Etiqueta opcional').selectOption('Nuevo');
  await page.getByRole('button', { name: 'Crear producto' }).click();
  await waitForToast(page, 'Producto creado.');

  await page.evaluate(() => { window.location.hash = '#catalog'; });
  const customerCard = page.locator('.product-card').filter({ hasText: 'Producto Catalogo QA' });
  await expect(customerCard).toBeVisible();
  await expect(customerCard).toContainText('12.345');

  await page.evaluate(() => { window.location.hash = '#business'; });
  const adminRow = page.locator('[data-catalog-admin-row]').filter({ hasText: 'Producto Catalogo QA' });
  await adminRow.getByRole('button', { name: 'Editar' }).click();
  await page.getByLabel('Precio').fill('15999');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await waitForToast(page, 'Producto actualizado.');

  await page.evaluate(() => { window.location.hash = '#catalog'; });
  await expect(customerCard).toContainText('15.999');

  await page.evaluate(() => { window.location.hash = '#business'; });
  await adminRow.getByRole('button', { name: 'Pausar' }).click();
  await waitForToast(page, 'Disponibilidad actualizada.');

  await page.evaluate(() => { window.location.hash = '#catalog'; });
  await expect(customerCard).toContainText('No disponible');
  await expect(customerCard.locator('[data-add-product]')).toBeDisabled();

  await page.evaluate(() => { window.location.hash = '#business'; });
  // Restaurar es destructivo: el primer tap abre el modal y no borra nada.
  await page.getByRole('button', { name: 'Restaurar catálogo base' }).click();
  const resetModal = page.locator('[data-catalog-reset-modal]');
  await expect(resetModal).toBeVisible();
  await resetModal.getByRole('button', { name: 'Cancelar' }).click();
  await expect(adminRow).toContainText('Producto Catalogo QA');

  // Recién al confirmar se reemplaza el catálogo por el demo.
  await page.getByRole('button', { name: 'Restaurar catálogo base' }).click();
  await resetModal.getByRole('button', { name: 'Restaurar catálogo base' }).click();
  await waitForToast(page, 'Catálogo base restaurado.');

  await page.evaluate(() => { window.location.hash = '#catalog'; });
  await expect(page.locator('[data-product-grid]')).not.toContainText('Producto Catalogo QA');

  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(noOverflow).toBeTruthy();

  await guards.assertClean();
  await context.close();
});
