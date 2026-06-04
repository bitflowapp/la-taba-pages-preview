import { expect, test } from '@playwright/test';
import { installBrowserStubs, installPageGuards, waitForToast } from './helpers.mjs';

test('Negocio: crea, edita, pausa y restaura el catalogo editable', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await installBrowserStubs(page);

  await page.goto('/?reset=1#business');
  await page.getByRole('button', { name: /Ingresar codigo|Ingresar código/i }).click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await expect(page.locator('[data-view="business"]')).toBeVisible();
  await page.locator('[data-scroll-catalog]').click();

  await page.getByLabel('Producto a vender').fill('Producto Catalogo QA');
  await page.getByLabel('Precio').fill('12345');
  await page.getByLabel('Categoria').selectOption('carnes');
  await page.getByLabel('Descripcion breve').fill('Producto creado desde negocio');
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
  await page.getByRole('button', { name: 'Restaurar catalogo demo' }).click();
  await waitForToast(page, 'Catalogo demo restaurado.');

  await page.evaluate(() => { window.location.hash = '#catalog'; });
  await expect(page.locator('[data-product-grid]')).not.toContainText('Producto Catalogo QA');

  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(noOverflow).toBeTruthy();

  await guards.assertClean();
  await context.close();
});
