/*
 * CAMBIAR LA CONTRASEÑA DESDE EL CORREO: SE VE LO QUE SE ESCRIBE Y UN ERROR NO
 * LO BORRA.
 *
 * Medido en producción el 2026-10-06 con el enlace real de recuperación: el
 * campo de /cuenta/ escribía #f7f7f8 sobre blanco (1,07:1) y cada intento
 * fallido repintaba el formulario vacío. La persona no veía lo que tecleaba ni
 * cuántos caracteres iban, y «Guardar contraseña» parecía no hacer nada.
 *
 * El paso se pinta con el MISMO render y el MISMO repintado que usa la página
 * (`renderAccountAction` + `paintForm`): no hace falta un enlace de Auth para
 * probar cómo se ve y cómo se comporta el formulario.
 */
import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

async function contraste(locator, fondo) {
  return locator.evaluate((element, selectorFondo) => {
    const parse = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
    const lum = (rgb) => {
      const [r, g, b] = rgb.map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const tinta = getComputedStyle(element).color;
    const base = selectorFondo
      ? getComputedStyle(document.querySelector(selectorFondo)).backgroundColor
      : getComputedStyle(element).backgroundColor;
    const [a, b] = [lum(parse(tinta)), lum(parse(base))].sort((p, q) => q - p);
    return (a + 0.05) / (b + 0.05);
  }, fondo);
}

test('la contraseña nueva se lee, se cuenta, se puede mostrar y sobrevive al error', async ({ page }) => {
  await page.goto('/cuenta/');
  await page.waitForSelector('[data-account-action]');
  await page.evaluate(async () => {
    const { renderAccountAction } = await import('/js/account-action.js');
    const { paintForm } = await import('/js/account-action-page.js');
    const host = document.querySelector('[data-account-action]');
    window.__pintar = (estado) => paintForm(host, renderAccountAction(estado));
    window.__pintar({ step: 'set_password' });
  });

  const campo = page.locator('[data-password-field]');
  const contador = page.locator('[data-password-count]');
  await expect(contador).toHaveText('Mínimo 12 caracteres.');
  expect(await contraste(campo)).toBeGreaterThanOrEqual(4.5);

  await campo.click();
  await page.keyboard.type('Corta-7');
  await expect(contador).toHaveText('Llevás 7 de 12 caracteres.');

  // El intento falla: el controlador repinta con «guardando» y después con el aviso.
  await page.evaluate(() => {
    window.__pintar({ step: 'set_password', busy: true });
    window.__pintar({ step: 'set_password', message: 'La contraseña necesita al menos 12 caracteres.' });
  });
  await expect(campo).toHaveValue('Corta-7');
  await expect(contador).toHaveText('Llevás 7 de 12 caracteres.');
  const aviso = page.locator('.account-action-message');
  await expect(aviso).toHaveText('La contraseña necesita al menos 12 caracteres.');
  expect(await contraste(aviso, '.payment-return-card')).toBeGreaterThanOrEqual(4.5);

  const mostrar = page.locator('[data-password-reveal]');
  await mostrar.click();
  await expect(campo).toHaveAttribute('type', 'text');
  await expect(mostrar).toHaveText('Ocultar');
  await expect(mostrar).toHaveAttribute('aria-pressed', 'true');
  await expect(campo).toBeFocused();
  await page.keyboard.type('-larga');
  await expect(contador).toHaveText('13 caracteres: alcanza el mínimo.');

  // Ver la contraseña es una elección de la persona: el repintado no la deshace.
  await page.evaluate(() => window.__pintar({ step: 'set_password', busy: true }));
  await expect(campo).toHaveAttribute('type', 'text');
  await expect(campo).toHaveValue('Corta-7-larga');

  await mostrar.click();
  await expect(campo).toHaveAttribute('type', 'password');

  // Terminado el cambio, no queda campo ni contraseña en la página.
  await page.evaluate(() => window.__pintar({ step: 'done' }));
  await expect(page.locator('[data-password-field]')).toHaveCount(0);
});
