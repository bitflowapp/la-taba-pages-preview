import { expect, test } from '@playwright/test';
import { gotoDemoReset, installBrowserStubs, installPageGuards } from './helpers.mjs';

// Contrato de la capa `styles/ux-premium.css` y del visor de historias
// (2026-10-24). Mide geometría real, no clases: lo que se prometió es que el
// visor ocupe el teléfono, que se navegue con el pulgar y el teclado, y que el
// catálogo móvil muestre precios sin scrollear.

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

const STORY = (id, title, target) => ({
  id,
  business_id: 'la-taba-2',
  title,
  media_type: 'image',
  media_url: 'assets/products/beverage-placeholder.svg',
  thumbnail_url: 'assets/products/beverage-placeholder.svg',
  starts_at: null,
  expires_at: null,
  priority: 10,
  cta_type: 'category',
  cta_target: target,
  is_highlight: true,
  published: true,
});
const STORIES = [STORY('ux-uno', 'Primera historia', 'cervezas'), STORY('ux-dos', 'Segunda historia', 'energizantes')];

async function open(page, viewport, { stories = null } = {}) {
  await page.setViewportSize(viewport);
  await installBrowserStubs(page);
  if (stories) await page.addInitScript((fixtures) => { window.TABA2_STORIES = fixtures; }, stories);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await page.waitForSelector('[data-view="home"] .home-best-card');
}

const progressLabel = (page) => page.locator('[data-stories-modal] .stories-progress');

test('en el teléfono el visor de historias ocupa la pantalla entera, sin la página asomando', async ({ page }) => {
  const guards = installPageGuards(page);
  await open(page, PHONE, { stories: STORIES });
  await page.locator('.brand-hero .brand-logo-action').click();

  const modal = page.locator('[data-stories-modal]');
  await expect(modal).toBeVisible();
  // El diálogo entra con una animación corta: se mide ya quieto.
  await expect.poll(async () => { const b = await modal.boundingBox(); return b.width >= PHONE.width - 1 && b.x <= 1 && b.y <= 1; }).toBe(true);
  const box = await modal.boundingBox();
  expect(box.x).toBeLessThanOrEqual(1);
  expect(box.y).toBeLessThanOrEqual(1);
  expect(box.width).toBeGreaterThanOrEqual(PHONE.width - 1);
  expect(box.height).toBeGreaterThanOrEqual(PHONE.height - 1);

  // La pieza llena el marco; título y acción flotan dentro de la pantalla.
  const media = await modal.locator('.stories-media').boundingBox();
  expect(media.height).toBeGreaterThanOrEqual(box.height - 1);
  await expect(modal.getByRole('heading', { name: 'Primera historia' })).toBeInViewport();
  await expect(modal.locator('[data-story-cta]')).toBeInViewport();
  const close = await modal.locator('[data-close-stories]').boundingBox();
  expect(Math.min(close.width, close.height)).toBeGreaterThanOrEqual(44);
  await guards.assertClean();
});

test('tocar la pieza navega: derecha avanza, izquierda vuelve; las flechas también', async ({ page }) => {
  await open(page, PHONE, { stories: STORIES });
  await page.locator('.brand-hero .brand-logo-action').click();
  await expect(progressLabel(page)).toHaveAttribute('aria-label', 'Historia 1 de 2');

  const media = page.locator('[data-stories-modal] .stories-media');
  const box = await media.boundingBox();
  await page.mouse.click(box.x + box.width * 0.85, box.y + box.height * 0.3);
  await expect(progressLabel(page)).toHaveAttribute('aria-label', 'Historia 2 de 2');
  await expect(page.locator('[data-stories-modal]').getByRole('heading', { name: 'Segunda historia' })).toBeVisible();

  // En la última, tocar a la derecha no cierra ni rompe: se queda.
  await page.mouse.click(box.x + box.width * 0.85, box.y + box.height * 0.3);
  await expect(progressLabel(page)).toHaveAttribute('aria-label', 'Historia 2 de 2');

  await page.mouse.click(box.x + box.width * 0.12, box.y + box.height * 0.3);
  await expect(progressLabel(page)).toHaveAttribute('aria-label', 'Historia 1 de 2');

  await page.keyboard.press('ArrowRight');
  await expect(progressLabel(page)).toHaveAttribute('aria-label', 'Historia 2 de 2');
  await page.keyboard.press('ArrowLeft');
  await expect(progressLabel(page)).toHaveAttribute('aria-label', 'Historia 1 de 2');

  // El botón Siguiente conserva el foco al reescribirse el contenido.
  await page.locator('[data-story-next]').focus();
  await page.keyboard.press('Enter');
  await expect(progressLabel(page)).toHaveAttribute('aria-label', 'Historia 2 de 2');
  await expect(page.locator('[data-stories-modal]')).toContainText('Segunda historia');
  expect(await page.evaluate(() => document.querySelector('[data-stories-modal]').contains(document.activeElement))).toBe(true);
});

test('en escritorio el visor es un marco 9:16 centrado', async ({ page }) => {
  await open(page, DESKTOP, { stories: STORIES });
  await page.locator('.brand-hero .brand-logo-action').click();
  const box = await page.locator('[data-stories-modal]').boundingBox();
  expect(Math.abs(box.width / box.height - 9 / 16)).toBeLessThan(0.02);
  expect(Math.abs(box.x + box.width / 2 - DESKTOP.width / 2)).toBeLessThan(2);
});

test('catálogo en el teléfono: precio y botón a la vista sin scrollear, sin desborde horizontal', async ({ page }) => {
  const guards = installPageGuards(page);
  await open(page, PHONE);
  await page.evaluate(() => { window.location.hash = '#catalog'; });
  const firstCard = page.locator('[data-view="catalog"] [data-product-grid] article[data-card-product]').first();
  await expect(firstCard).toBeVisible();

  const navTop = (await page.locator('.mobile-nav').boundingBox()).y;
  const price = await firstCard.locator('.price strong').boundingBox();
  const add = await firstCard.locator('.add-button').boundingBox();
  expect(price.y + price.height).toBeLessThanOrEqual(navTop);
  expect(add.y + add.height).toBeLessThanOrEqual(navTop);
  expect(add.height).toBeGreaterThanOrEqual(44);

  // Sin el filtro de producción, título y orden comparten renglón.
  if (await page.locator('[data-catalog-filters]').isHidden()) {
    const title = await page.locator('[data-catalog-title]').boundingBox();
    const sort = await page.locator('[data-view="catalog"] .sort-field').boundingBox();
    expect(Math.abs((title.y + title.height / 2) - (sort.y + sort.height / 2))).toBeLessThan(16);
    expect(sort.height).toBeGreaterThanOrEqual(44);
  }

  for (const width of [320, 360, 390, 412]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${width}px`).toBe(true);
  }
  await guards.assertClean();
});

test('carrito en el teléfono: cada línea muestra cantidad e importe en dos renglones', async ({ page }) => {
  await open(page, PHONE);
  await page.evaluate(() => { window.location.hash = '#catalog'; });
  const add = page.locator('[data-view="catalog"] [data-product-grid] [data-add-product]').first();
  await add.click();
  await page.evaluate(() => { window.location.hash = '#cart'; });
  const item = page.locator('[data-view="cart"] .cart-item').first();
  await expect(item).toBeVisible();
  const box = await item.boundingBox();
  const qty = await item.locator('.quantity-control').boundingBox();
  const line = await item.locator('.cart-line').boundingBox();
  expect(box.height).toBeLessThan(130);
  expect(line.y).toBeLessThan(qty.y);
  expect(qty.height).toBeGreaterThanOrEqual(44);
  expect(line.x + line.width).toBeLessThanOrEqual(box.x + box.width + 1);
});
