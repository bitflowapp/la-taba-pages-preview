// Rutas que no existen y promesas que la tienda no puede cumplir.
//
// Antes, un link viejo o mal copiado (`#promos-verano`) dejaba a la persona en
// el inicio SIN decir nada, con la barra de direcciones todavía mostrando la
// ruta rota: recargar repetía el mismo silencio y volver atrás también. Y el
// Perfil prometía "completar una dirección manualmente durante el checkout",
// un formulario que no existe: el checkout sólo elige entre direcciones ya
// guardadas.
import { expect, test } from '@playwright/test';
import { gotoDemoReset, installBrowserStubs } from './helpers.mjs';

async function abrir(page, url = '/?reset=1&demo=1') {
  await installBrowserStubs(page);
  await gotoDemoReset(page, url);
  await page.waitForSelector('[data-view="home"] .home-best-card');
}

test('una ruta inexistente avisa, corrige la URL y deja la tienda usable', async ({ page }) => {
  await abrir(page);

  await page.evaluate(() => { window.location.hash = '#promos-verano'; });

  const toast = page.locator('.toast, [data-toast]').filter({ hasText: 'No encontramos esa página' }).first();
  await expect(toast).toBeVisible();
  await expect(page.locator('[data-view="home"]')).toBeVisible();
  // La URL queda apuntando a algo que existe: recargar no repite el error.
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#home');
  expect(await page.locator('body').innerText()).not.toMatch(/404|not found|promos-verano/i);
});

test('la ruta inexistente al ABRIR la pestaña recibe el mismo trato', async ({ page }) => {
  await installBrowserStubs(page);
  await page.goto('/?demo=1#esta-ruta-no-existe');
  await page.waitForSelector('[data-view="home"] .home-best-card');

  await expect(
    page.locator('.toast, [data-toast]').filter({ hasText: 'No encontramos esa página' }).first(),
  ).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#home');
});

test('volver atrás después de una ruta rota no vuelve a la ruta rota', async ({ page }) => {
  await abrir(page);
  await page.evaluate(() => { window.location.hash = '#catalog'; });
  await expect(page.locator('[data-view="catalog"]')).toBeVisible();

  await page.evaluate(() => { window.location.hash = '#no-existe'; });
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#home');

  await page.goBack();
  // La corrección se escribió con replaceState, así que atrás lleva al
  // catálogo —el último lugar real donde estuvo— y no al link roto.
  await expect(page.locator('[data-view="catalog"]')).toBeVisible();
});

test('una vista operativa que este modo no sirve corrige la URL sin publicitarla', async ({ page }) => {
  // Sin ?demo=1 y sin runtime productivo el modo es preview: el panel del
  // negocio no existe para quien navega.
  await page.goto('/#business');
  await expect(page.locator('[data-view="home"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#home');
  await expect(page.locator('.toast, [data-toast]').filter({ hasText: 'No encontramos' })).toHaveCount(0);
  await expect(page.locator('[data-view="business"]')).toBeHidden();
});

test('Perfil no promete un formulario de dirección que el checkout no tiene', async ({ page }) => {
  await abrir(page);
  await page.evaluate(() => { window.location.hash = '#profile'; });
  await expect(page.locator('[data-view="profile"]')).toBeVisible();

  const perfil = page.locator('[data-view="profile"]');
  await expect(perfil).not.toContainText(/manualmente durante el checkout/i);
  await expect(perfil).not.toContainText(/completar una dirección manualmente/i);
});

test('el checkout sin autoridad de datos habla en criollo, no de sesiones', async ({ page }) => {
  // Preview: no hay backend que declare autoridad sobre los datos del cliente.
  await page.goto('/#cart');
  const bloque = page.locator('[data-profile-block="unsupported"]');
  await expect(bloque).toHaveCount(await bloque.count());
  if (await bloque.count()) {
    await expect(bloque.first()).not.toContainText(/sesión de cliente/i);
    await expect(bloque.first()).toContainText(/pedidos online|pedidos por la app/i);
  }
  // En cualquier caso, la frase técnica no puede estar en ninguna superficie.
  expect(await page.locator('body').innerText()).not.toMatch(/sesión de cliente/i);
});
