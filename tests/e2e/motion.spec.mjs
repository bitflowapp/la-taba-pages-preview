import { expect, test } from '@playwright/test';
import { gotoDemoReset, installBrowserStubs, installPageGuards } from './helpers.mjs';

test.describe('TABA2 motion system', () => {
  test('con movimiento reducido no queda NADA animándose para siempre', async ({ page }) => {
    /*
     * El reset de `prefers-reduced-motion` acortaba la duración a 0,001 ms y no
     * tocaba las iteraciones. Una animación `infinite` con duración cero no se
     * detiene: corre mil veces por segundo. No se ve —cada vuelta termina al
     * instante— pero el compositor no para nunca, que es exactamente lo que la
     * preferencia pide evitar, y en un teléfono se paga en batería.
     * Lo encontró la auditoría de accesibilidad mirando `getAnimations()`.
     */
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await installBrowserStubs(page);
    await gotoDemoReset(page, '/?reset=1&demo=1#home');
    await page.waitForTimeout(1_500);

    const infinitas = await page.evaluate(() => [...document.getAnimations()]
      .filter((a) => a.playState === 'running' && a.effect?.getTiming?.().iterations === Infinity)
      .map((a) => {
        const objetivo = a.effect?.target;
        const clase = typeof objetivo?.className === 'string' ? objetivo.className.trim().split(/\s+/)[0] : '';
        return `${objetivo?.tagName?.toLowerCase() || '?'}${clase ? `.${clase}` : ''}`;
      }));

    expect(infinitas, `quedaron animaciones infinitas vivas: ${infinitas.join(', ')}`).toEqual([]);
  });

  test('desktop motion is progressive, scroll-safe and tactile', async ({ page }) => {
    const guards = installPageGuards(page);
    await installBrowserStubs(page);
    await gotoDemoReset(page, '/?reset=1&demo=1#home');

    await expect(page.locator('body')).toHaveClass(/motion-ready/);
    await expect(page.locator('body')).toHaveAttribute('data-motion-reduced', 'false');
    await expect(page.locator('.taba-home-hero')).toHaveAttribute('data-motion-reveal', 'hero');
    await expect.poll(async () => page.locator('.taba-home-hero').evaluate((node) => node.classList.contains('is-motion-visible'))).toBe(true);
    const diagnostics = await page.evaluate(() => window.TABA2_MOTION?.getDiagnostics?.());
    expect(diagnostics?.active).toBe(true);
    expect(diagnostics?.observerCount).toBeLessThanOrEqual(1);
    expect(diagnostics?.mutationObserverCount).toBeLessThanOrEqual(1);

    await page.evaluate(() => window.scrollTo(0, 240));
    await expect(page.locator('body')).toHaveAttribute('data-motion-scrolled', 'true');

    await page.locator('[data-nav-view="catalog"]').first().click();
    const card = page.locator('[data-product-grid] .product-card').first();
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-motion-reveal', 'card');
    await card.hover();
    await expect.poll(() => card.evaluate((node) => getComputedStyle(node).transitionProperty)).toContain('transform');

    const add = page.locator('[data-product-grid] button[data-add-product]:not(:disabled)').first();
    await add.click();
    await expect(page.locator('[data-toast]')).toContainText('agregado al pedido');
    await expect(page.locator('[data-floating-cart]')).toHaveClass(/cart-bump/);
    await guards.assertClean();
  });

  test('reduced motion keeps content and feedback visible without movement', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await installBrowserStubs(page);
    await gotoDemoReset(page, '/?reset=1&demo=1#home');
    await expect(page.locator('body')).toHaveAttribute('data-motion-reduced', 'true');
    await expect(page.locator('.taba-home-hero')).toBeVisible();
    await expect.poll(() => page.locator('.taba-home-hero').evaluate((node) => getComputedStyle(node).transform)).toBe('none');
    await page.locator('[data-nav-view="catalog"]').first().click();
    const card = page.locator('[data-product-grid] .product-card').first();
    await expect.poll(() => card.evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
    await expect(page.locator('body')).not.toHaveClass(/motion-pressing/);
  });

  test('product detail uses a short progressive entrance and restores focus on close', async ({ page }) => {
    await installBrowserStubs(page);
    await gotoDemoReset(page, '/?reset=1&demo=1#catalog');
    const detail = page.locator('[data-product-grid] [data-product-detail]').first();
    await detail.focus();
    await detail.click();
    const modal = page.locator('[data-product-modal]');
    await expect(modal).toBeVisible();
    await expect.poll(() => modal.evaluate((node) => getComputedStyle(node).animationDuration)).not.toBe('0s');
    await modal.locator('[data-close-modal]').click();
    await expect(modal).not.toBeVisible();
    await expect(detail).toBeFocused();
  });
});
