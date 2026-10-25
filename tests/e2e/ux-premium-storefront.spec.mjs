import { expect, test } from '@playwright/test';
import { gotoDemoReset, installBrowserStubs, installPageGuards, waitForToast } from './helpers.mjs';
import { GRID, openRuntimeCatalog } from './catalog-runtime-fixture.mjs';

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
  const info = await item.locator('.cart-item-info').boundingBox();
  const qty = await item.locator('.quantity-control').boundingBox();
  const line = await item.locator('.cart-line').boundingBox();
  // El alto de la línea depende de la fuente del sistema (system-ui): con la
  // DejaVu del runner de Linux «Red Bull Energy Drink» parte en dos renglones y
  // la línea mide 137 px; con Segoe UI entra en uno. Lo que no puede cambiar es la
  // FORMA: nombre e importe en el primer renglón, cantidad sola en el segundo,
  // sin renglones ni huecos de más, y el nombre en dos renglones como máximo.
  const { padTop, padBottom, rowGap, titleLines } = await item.evaluate((node) => {
    const style = getComputedStyle(node);
    const title = node.querySelector('.cart-title');
    const lineHeight = parseFloat(getComputedStyle(title).lineHeight) || 1.25 * parseFloat(getComputedStyle(title).fontSize);
    return {
      padTop: parseFloat(style.paddingTop),
      padBottom: parseFloat(style.paddingBottom),
      rowGap: parseFloat(style.rowGap) || 0,
      titleLines: Math.round(title.getBoundingClientRect().height / lineHeight),
    };
  });
  expect(titleLines).toBeLessThanOrEqual(2);
  // Topes de diseño: el aire entre renglones y el relleno no pueden crecer.
  expect(rowGap).toBeLessThanOrEqual(12);
  expect(padTop + padBottom).toBeLessThanOrEqual(32);
  expect(line.y).toBeLessThan(qty.y);
  expect(qty.y).toBeGreaterThanOrEqual(Math.max(info.y + info.height, line.y + line.height) - 1);
  expect(qty.y - box.y).toBeLessThanOrEqual(padTop + Math.max(info.height, line.height) + rowGap + 1);
  expect(box.y + box.height - (qty.y + qty.height)).toBeLessThanOrEqual(padBottom + 1);
  expect(qty.height).toBeGreaterThanOrEqual(44);
  expect(line.x + line.width).toBeLessThanOrEqual(box.x + box.width + 1);
});

// La barra fija del checkout móvil muestra el MISMO total que la fila «Total»
// del resumen, y el botón sigue siendo el de siempre.
async function expectCheckoutBar(page) {
  const bar = page.locator('[data-view="cart"] .checkout-form .button-row');
  await bar.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('[data-view="cart"] .checkout-form').evaluate((form) => form.scrollIntoView({ block: 'start' }));
  const summaryTotal = (await page.locator('[data-order-summary] .summary-row.total strong').textContent()).trim();
  await expect(bar).toHaveAttribute('data-checkout-total', summaryTotal);
  const navTop = (await page.locator('.mobile-nav').boundingBox()).y;
  const box = await bar.boundingBox();
  expect(box.y + box.height, 'la barra queda sobre la navegación').toBeLessThanOrEqual(navTop + 1);
  expect(box.y, 'la barra se ve sin llegar al final del formulario').toBeLessThan(PHONE.height);
  // El total no es texto del DOM: no duplica lo que lee un lector de pantalla.
  expect(await bar.evaluate((node) => node.textContent.includes('$'))).toBe(false);
  const button = bar.locator('[data-checkout-submit]');
  expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
  return button;
}

test('vitrina con fotos reales, navegando con toques: categoría, ficha, carrito y pedido confirmado', async ({ page }) => {
  const guards = installPageGuards(page);
  await page.setViewportSize(PHONE);
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1&vitrina=neuquen20261024');
  await page.waitForSelector('[data-view="home"] .home-best-card');

  // Banner de marca: foto de producto autorizada, nunca la tarjeta de receta.
  const andes = page.locator('.home-brand-banner[data-brand-query="Andes Origen"] .home-brand-banner-media');
  if (await andes.count()) {
    const bg = await andes.evaluate((node) => getComputedStyle(node).backgroundImage);
    expect(bg).toContain('assets/products/andes-origen-rubia-lata-473ml');
    expect(bg).not.toContain('cervezas-andes-origen');
  }

  await page.locator('[data-view="home"] .home-category-card[data-category-id="gaseosas"]').click();
  await expect(page.locator('[data-catalog-title]')).toHaveText('Gaseosas');
  const card = page.locator(`${GRID} article[data-card-product]`).first();
  const cardImg = card.locator('.thumb-img');
  await expect(cardImg).toHaveAttribute('src', /assets\/products\/(?!beverage-placeholder)/);

  await card.locator('.product-media').click();
  const modal = page.locator('[data-modal-product-id]');
  await expect(modal).toBeVisible();
  await expect(modal.locator('.thumb-img')).toHaveAttribute('src', /assets\/products\/(?!beverage-placeholder)/);
  await modal.locator('[data-add-product]').click();
  await expect(page.locator('[data-cart-count]').first()).toHaveText('1');
  if (await modal.isVisible()) await modal.locator('[data-close-modal]').click();

  // Un segundo producto para pasar el mínimo de delivery sin depender del precio.
  await page.locator(`${GRID} article[data-card-product]`).nth(1).locator('[data-add-product]').click();
  await page.locator('[data-floating-cart]').click();
  await expect(page.locator('[data-view="cart"]')).toBeVisible();

  const button = await expectCheckoutBar(page);
  await expect(button).toHaveText(/Confirmar pedido/);
  await button.click();
  await waitForToast(page, 'Pedido confirmado. Seguilo en Seguimiento.');
  await guards.assertClean();
});

test('catálogo productivo (Supabase simulado): mismo diseño, precios a la vista y barra de total', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openRuntimeCatalog(page);
  const firstCard = page.locator(`${GRID} article[data-card-product]`).first();
  await expect(firstCard).toBeVisible();
  const navTop = (await page.locator('.mobile-nav').boundingBox()).y;
  const add = await firstCard.locator('[data-add-product]').boundingBox();
  expect(add.y + add.height).toBeLessThanOrEqual(navTop);
  await firstCard.locator('[data-add-product]').click();
  await page.locator('[data-nav-view="cart"]:visible').first().click();
  await expect(page.locator('[data-view="cart"]')).toBeVisible();
  await expectCheckoutBar(page);
});
