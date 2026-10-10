/*
 * COBERTURA COMERCIAL DINÁMICA DEL CATÁLOGO Y DE SUS PROMOCIONES.
 *
 * Lo que este archivo no hace: elegir tres SKU a mano. La lista de productos y
 * la de campañas SALEN DE LOS DATOS, y cada una se recorre entera con el dedo:
 * toca la foto, abre la ficha, busca la acción de compra, la ejecuta y mira el
 * carrito. Si mañana el comercio publica 80 productos, o enciende una campaña
 * nueva, esta prueba los recorre sin que nadie la edite.
 *
 * ORIGEN DE LOS DATOS (nunca se mezclan sin decirlo):
 *   · REAL OBSERVADO  `tests/fixtures/catalog-live.json`: las 51 filas que la
 *                     tienda pública de producción devolvía el 2026-10-05
 *                     (lectura de sólo lectura, sin costos ni autores). Es la
 *                     instantánea, no producción en este instante: el control
 *                     contra producción en línea es `npm run campaigns:verify-live`.
 *   · SINTÉTICO       lo que lleva `[SINTÉTICO]` en el nombre: la misma fila real
 *                     con el stock, el precio o la disponibilidad que la prueba
 *                     necesita forzar. No existe en ninguna base.
 *
 * Corre en Chromium y en WebKit móvil (iPhone): es donde el toque, el
 * `<dialog>` y las capas se comportan distinto.
 */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { clickCatalogCategory, GRID, openRuntimeCatalog } from './catalog-runtime-fixture.mjs';
import { finishScene, HERO, INLINE } from './campaigns-fixture.mjs';
import { CAMPAIGNS } from '../../js/campaigns/campaign-config.js';
import { rowsVisibleToCustomers } from '../../scripts/campaigns/live-catalog-gate.mjs';

const live = JSON.parse(fs.readFileSync(new URL('../fixtures/catalog-live.json', import.meta.url), 'utf8'));
const VISIBLE = rowsVisibleToCustomers(live.products);
const rowOf = (sku) => live.products.find((row) => row.sku === sku);

// Lo que la tienda declara comprable AHORA: publicado, a la venta, con stock y
// con precio confirmado. Es la misma compuerta que la tarjeta, escrita sobre la
// fila cruda, a propósito: si la tienda y la fila discrepan, la prueba lo dice.
const buyable = (row) => row.is_active === true && row.is_verified === true && row.available === true
  && Number(row.stock) > 0 && row.price_status === 'confirmed' && Number(row.price) > 0;

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
test.describe.configure({ timeout: 240_000 });

const money = (page, amount) => page.evaluate((value) => new Intl.NumberFormat('es-AR', {
  style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
}).format(value), amount);

const openCart = async (page) => {
  await page.locator('[data-nav-view="cart"]:visible').first().tap();
  await expect(page.locator('[data-view="cart"]')).toBeVisible();
};

const cartLines = (page) => page.evaluate(() => [...document.querySelectorAll('[data-view="cart"] .cart-item:not(.cart-item-combo)')].map((item) => ({
  text: item.innerText.replace(/\s+/g, ' ').trim(),
  qty: Number(item.querySelector('.quantity-control strong')?.textContent || 0),
  line: item.querySelector('.cart-line')?.textContent.replace(/\s+/g, ' ').trim() ?? '',
})));

test('la instantánea real sigue siendo la que la prueba cree: 51 visibles, 34 comprables, 17 de vidriera sin habilitar', () => {
  expect(VISIBLE.length).toBe(live.products.length);
  expect(VISIBLE.filter(buyable).length).toBe(34);
  const blocked = VISIBLE.filter((row) => !buyable(row));
  expect(blocked.every((row) => row.is_alcoholic === true), 'lo no comprable es alcohol cerrado').toBe(true);
});

/* ─── Producto por producto ────────────────────────────────────────────────── */

test('CADA producto visible: foto propia, precio de la fila, ficha correcta y una acción de compra honesta', async ({ page }) => {
  await openRuntimeCatalog(page, { catalogRows: live.products });
  const bought = [];

  for (const row of VISIBLE) {
    const card = page.locator(`${GRID} [data-card-product="${row.id}"]`);
    await card.scrollIntoViewIfNeeded();
    await expect(card, `${row.sku}: no hay tarjeta`).toHaveCount(1);

    // Foto: carga, es la de ESE producto (el archivo lleva su SKU y la huella de
    // su miniatura) y no es el recurso de relleno.
    const image = card.locator('img').first();
    await expect.poll(() => image.evaluate((node) => node.complete && node.naturalWidth > 0), { message: `${row.sku}: la foto no cargó` }).toBe(true);
    const src = await image.evaluate((node) => node.currentSrc);
    expect(src, `${row.sku}: la foto no es la suya`).toContain(row.sku);
    expect(src, `${row.sku}: la huella de la foto no es la de la fila`).toContain(row.image_thumbnail_sha256.slice(0, 16));
    expect(src).not.toMatch(/placeholder/);

    // Precio: el de la fila, tal cual.
    await expect(card.locator('.product-foot'), `${row.sku}: precio distinto al de la fila`).toContainText(await money(page, row.price));

    const action = card.locator('.product-action button').first();
    if (buyable(row)) {
      await expect(action, `${row.sku}: debería poder comprarse`).toBeEnabled();
      await expect(action).toHaveAccessibleName(/^Agregar .+ al pedido$/);
      await action.tap();
      await expect(card.locator('.qty-stepper strong'), `${row.sku}: el toque no agregó una unidad`).toHaveText('1');
      bought.push(row);
    } else {
      // Honestidad: no se ofrece lo que no se puede entregar, y el botón dice por qué.
      await expect(action, `${row.sku}: no debería poder comprarse`).toBeDisabled();
      await expect(action.locator('.add-text')).toHaveText(row.is_alcoholic && row.stock > 0 ? 'Próximamente' : /^(Próximamente|No disponible)$/);
      // Y se anuncia como lo que es: nunca «Agregar … al pedido» sobre un control apagado.
      await expect(action, `${row.sku}: el nombre accesible promete una acción que no existe`).toHaveAccessibleName(/no disponible|todavía no está a la venta/);
      await action.tap({ force: true, noWaitAfter: true }).catch(() => {});
      await expect(card.locator('.qty-stepper')).toHaveCount(0);
    }

    // La ficha: tocar la foto abre la de ESTE producto, y su control de compra
    // dice lo mismo que la tarjeta.
    await card.locator('[data-product-detail]').first().tap();
    const modal = page.locator('[data-product-modal]');
    await expect(modal).toBeVisible();
    await expect(modal.locator('[data-modal-product-id]'), `${row.sku}: abrió la ficha de otro producto`).toHaveAttribute('data-modal-product-id', row.id);
    await expect(modal.locator('.modal-price')).toContainText(await money(page, row.price));
    const control = modal.locator('.modal-cart-control');
    if (buyable(row)) {
      await expect(control, `${row.sku}: la ficha no ofrece comprar`).toBeVisible();
      await expect(control).toBeEnabled();
    } else {
      await expect(modal.locator('[data-add-product]:not([disabled])'), `${row.sku}: la ficha ofrece comprar algo que no se vende`).toHaveCount(0);
    }
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
  }

  // El pedido armado: una línea por producto comprable, con SU precio, y el
  // subtotal es la suma de las filas.
  expect(bought.length).toBe(VISIBLE.filter(buyable).length);
  await openCart(page);
  const lines = await cartLines(page);
  expect(lines.length, 'líneas fantasma o faltantes en el carrito').toBe(bought.length);
  expect(lines.every((line) => line.qty === 1)).toBe(true);
  for (const row of bought) {
    const expected = await money(page, row.price);
    expect(lines.filter((line) => line.line.replace(/ /g, ' ') === expected.replace(/ /g, ' ')).length).toBeGreaterThan(0);
  }
  const total = bought.reduce((sum, row) => sum + Number(row.price), 0);
  await expect(page.locator('[data-cart-total-small]').first()).toHaveText(await money(page, total));
});

test('el tope de unidades es el stock: no se puede pedir más de lo que hay', async ({ page }) => {
  await openRuntimeCatalog(page, { catalogRows: live.products });
  const scarcest = VISIBLE.filter(buyable).sort((a, b) => a.stock - b.stock)[0];
  const card = page.locator(`${GRID} [data-card-product="${scarcest.id}"]`);
  await card.scrollIntoViewIfNeeded();
  await card.locator('.product-action button').first().tap();
  const plus = card.locator('[data-cart-inc]');
  for (let n = 1; n < scarcest.stock; n += 1) await plus.tap();
  await expect(card.locator('.qty-stepper strong')).toHaveText(String(scarcest.stock));
  await expect(plus, 'se puede pedir una unidad más de la que hay').toBeDisabled();
});

/* ─── Promociones: cada pieza que promete un producto ──────────────────────── */

const ENABLED = CAMPAIGNS.filter((campaign) => campaign.enabled && campaign.approval.status === 'APROBADA');

/** Todas las superficies donde puede vivir una pieza, recorridas de verdad. */
async function surfaces(page) {
  const found = new Map();
  const collect = async (name) => {
    const ids = await page.evaluate(() => [...document.querySelectorAll('[data-campaign]')]
      .filter((node) => node.getBoundingClientRect().height > 0)
      .map((node) => `${node.dataset.campaign}|${node.dataset.campaignPlacement}`));
    for (const id of ids) if (!found.has(id)) found.set(id, name);
  };
  await collect('home');
  await page.locator('[data-nav-view="catalog"]:visible').first().tap();
  await expect(page.locator(`${GRID} .product-card`).first()).toBeVisible();
  await collect('catalogo:todo');
  const categories = await page.evaluate(() => [...document.querySelectorAll('[data-view="catalog"] [data-category-strip] [data-category-id]')]
    .map((node) => node.dataset.categoryId).filter((id) => id && id !== 'all'));
  for (const id of categories) {
    await clickCatalogCategory(page, id);
    await page.waitForTimeout(150);
    await collect(`catalogo:${id}`);
  }
  return found;
}

test('TODA campaña encendida se muestra en alguna superficie con su producto real, y ninguna apagada aparece', async ({ page }) => {
  await openRuntimeCatalog(page, { catalogRows: live.products, view: 'home', waitForCatalog: false });
  await expect(page.locator(`${HERO} [data-campaign]`)).toBeVisible({ timeout: 20_000 });
  const found = await surfaces(page);
  const seen = new Set([...found.keys()].map((key) => key.split('|')[0]));

  for (const campaign of ENABLED) {
    const row = rowOf(campaign.target.skus[0]);
    expect(row, `${campaign.id}: el SKU ${campaign.target.skus[0]} no existe en el catálogo real`).toBeTruthy();
    expect(buyable(row), `${campaign.id}: promociona algo que no se puede comprar`).toBe(true);
    expect(seen.has(campaign.id), `${campaign.id}: está encendida y no se ve en ninguna superficie`).toBe(true);
  }
  for (const campaign of CAMPAIGNS.filter((entry) => !ENABLED.includes(entry))) {
    expect(seen.has(campaign.id), `${campaign.id}: está apagada y se muestra`).toBe(false);
  }
  expect(found.size, 'ninguna pieza visible').toBeGreaterThan(0);
});

/**
 * Lleva la pantalla a la primera superficie donde la pieza se ve: la home, el
 * catálogo en «Todas» o el rubro que la admite. Devuelve su localizador. La
 * superficie no se supone: la decide el motor (prioridad, contexto y lista).
 */
async function reveal(page, campaignId) {
  const piece = () => page.locator(`[data-campaign="${campaignId}"]:visible`).first();
  await expect(page.locator('html')).toHaveAttribute('data-taba-startup', 'ready', { timeout: 20_000 });
  if (await piece().count()) return piece();
  await page.locator('[data-nav-view="catalog"]:visible').first().tap();
  await expect(page.locator(`${GRID} .product-card`).first()).toBeVisible();
  if (await piece().count()) return piece();
  const categories = await page.evaluate(() => [...document.querySelectorAll('[data-view="catalog"] [data-category-strip] [data-category-id]')]
    .map((node) => node.dataset.categoryId).filter((id) => id && id !== 'all'));
  for (const id of categories) {
    await clickCatalogCategory(page, id);
    await page.waitForTimeout(120);
    if (await piece().count()) return piece();
  }
  throw new Error(`${campaignId}: no aparece en ninguna superficie`);
}

/**
 * Para cada pieza publicada, en la superficie donde se encuentra: la compra
 * directa, el toque a la ficha, el teclado, la capa de animación y el carrito.
 */
for (const campaign of ENABLED) {
  const row = rowOf(campaign.target.skus[0]);

  test(`campaña «${campaign.id}»: la pieza compra el producto correcto con un toque, abre su ficha y no la tapa la animación`, async ({ page }) => {
    await openRuntimeCatalog(page, { catalogRows: live.products, view: 'home', waitForCatalog: false });
    const pieceSelector = `[data-campaign="${campaign.id}"]`;
    const piece = await reveal(page, campaign.id);
    await expect(piece, `${campaign.id}: no se ve`).toBeVisible();
    await piece.scrollIntoViewIfNeeded();
    const add = piece.locator('[data-campaign-add]');
    await expect(add, `${campaign.id}: la pieza promete un producto y no ofrece comprarlo`).toHaveCount(1);
    await expect(add).toHaveAttribute('data-add-product', row.id);
    await expect(add).toHaveAccessibleName(/^Agregar .+ al pedido$/);
    await expect(piece.locator('[data-campaign-cta]')).toHaveAttribute('data-product-detail', row.id);
    await expect(piece.locator('.cmp-price-now')).toHaveText(await money(page, row.price));

    // 1 · Ninguna capa tapa el control —ni con la escena corriendo ni al final—
    // y el área tocable llega a 44 px aunque lo que se ve mida menos.
    const reach = () => add.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const x = box.x + box.width / 2;
      const owns = (y) => {
        const top = document.elementFromPoint(x, y);
        return Boolean(top && (top === node || node.contains(top)));
      };
      return { centre: owns(box.y + box.height / 2), above: owns(box.y + box.height / 2 - 20), below: owns(box.y + box.height / 2 + 20), height: box.height };
    });
    for (const moment of ['inicio', 'escena corriendo', 'cuadro final']) {
      if (moment === 'escena corriendo') await page.waitForTimeout(700);
      if (moment === 'cuadro final') await finishScene(page, `[data-campaign="${campaign.id}"]`);
      const reached = await reach();
      expect(reached.centre, `${campaign.id} (${moment}): algo tapa «Agregar»`).toBe(true);
      expect(reached.above && reached.below, `${campaign.id} (${moment}): el área tocable no llega a 44 px`).toBe(true);
      expect(reached.height).toBeGreaterThanOrEqual(26);
    }

    // 2 · Tocar la foto o el título abre SU ficha, con el mismo precio y el
    // control de compra a la vista sin desplazar.
    const box = await piece.boundingBox();
    await page.touchscreen.tap(box.x + box.width * 0.2, box.y + box.height * 0.3);
    const modal = page.locator('[data-product-modal]');
    await expect(modal, `${campaign.id}: tocar el título no abrió la ficha`).toBeVisible();
    await expect(modal.locator('[data-modal-product-id]')).toHaveAttribute('data-modal-product-id', row.id);
    await expect(modal.locator('.modal-price')).toContainText(await money(page, row.price));
    await expect(modal.locator('.modal-cart-control')).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();

    // 3 · «Agregar» con UN toque: una unidad del producto prometido, al precio
    // de la fila, y la pieza lo refleja.
    await add.tap();
    await expect(piece.locator('[data-campaign-qty] strong')).toHaveText('1');
    await expect(modal, 'agregar desde la pieza no debería abrir la ficha').toBeHidden();
    await openCart(page);
    const lines = await cartLines(page);
    expect(lines, `${campaign.id}: el carrito no tiene exactamente una línea`).toHaveLength(1);
    expect(lines[0].qty).toBe(1);
    expect(lines[0].line.replace(/ /g, ' ')).toBe((await money(page, row.price)).replace(/ /g, ' '));
    expect(lines[0].text).toContain(row.name.split(' ')[0]);

    // 4 · Volver: la pieza sigue ahí, recuerda la unidad, y quitarla deja el
    // carrito vacío.
    await page.locator('.mobile-nav [data-nav-view="home"]:visible, .desktop-nav [data-nav-view="home"]:visible').first().tap();
    const back = await reveal(page, campaign.id);
    await expect(back.locator('[data-campaign-qty] strong')).toHaveText('1');
    await back.locator('[data-cart-dec]').tap();
    await expect(page.locator(`${pieceSelector}:visible [data-campaign-add]`).first()).toBeVisible();
    await openCart(page);
    expect(await cartLines(page)).toHaveLength(0);
  });

  test(`campaña «${campaign.id}»: el teclado compra sin ratón (Tab hasta «Agregar», Enter)`, async ({ page }) => {
    await openRuntimeCatalog(page, { catalogRows: live.products, view: 'home', waitForCatalog: false });
    const piece = await reveal(page, campaign.id);
    await piece.scrollIntoViewIfNeeded();
    const hit = piece.locator('[data-campaign-cta]');
    const add = piece.locator('[data-campaign-add]');
    await hit.focus();
    await page.keyboard.press('Tab');
    await expect(add, 'tras la ficha, el siguiente foco debe ser la compra').toBeFocused();
    await page.keyboard.press('Enter');
    await expect(piece.locator('[data-campaign-qty] strong')).toHaveText('1');
    // La cantidad que reemplazó al botón se maneja igual con el teclado: el «+»
    // es un botón de verdad, alcanzable y activable con Enter.
    const plus = piece.locator('[data-cart-inc]');
    await plus.focus();
    await expect(plus).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(piece.locator('[data-campaign-qty] strong')).toHaveText('2');
  });
}

/* ─── «Ocultar» no pisa la foto del producto ───────────────────────────────── */

test('el botón de ocultar no recibe ningún toque dirigido a la foto del producto, en los tres teléfonos', async ({ page }) => {
  await openRuntimeCatalog(page, { catalogRows: live.products, view: 'home', waitForCatalog: false });
  await expect(page.locator(`${HERO} [data-campaign]`)).toBeVisible({ timeout: 20_000 });
  for (const size of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 430, height: 932 }]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(250);
    for (const selector of [`${HERO} [data-campaign]`, `${INLINE} [data-campaign]`]) {
      const piece = page.locator(`${selector}:visible`).first();
      await piece.scrollIntoViewIfNeeded();
      const stolen = await piece.evaluate((root) => {
        const photo = root.querySelector('img.cmp-packshot');
        if (!photo) return { photo: false, hits: 0 };
        const box = photo.getBoundingClientRect();
        let hits = 0;
        for (let i = 0; i < 12; i += 1) {
          for (let j = 0; j < 12; j += 1) {
            const x = box.left + (box.width * (i + 0.5)) / 12;
            const y = box.top + (box.height * (j + 0.5)) / 12;
            const top = document.elementFromPoint(x, y);
            if (top?.closest('[data-campaign-dismiss]')) hits += 1;
          }
        }
        return { photo: true, hits };
      });
      expect(stolen.photo, `${size.width}px ${selector}: no se encontró la foto`).toBe(true);
      expect(stolen.hits, `${size.width}px ${selector}: «Ocultar» recibe toques dirigidos a la foto`).toBe(0);
    }
  }
});

/* ─── Estados que NO deben poder comprarse [SINTÉTICO] ─────────────────────── */

test('[SINTÉTICO] si el producto de la pieza se agota, la pieza desaparece y su tarjeta no se puede comprar', async ({ page }) => {
  const target = rowOf('red-bull-original-250ml');
  await openRuntimeCatalog(page, {
    catalogRows: live.products, view: 'home', waitForCatalog: false,
    mapRow: (row) => (row.sku === target.sku ? { ...row, stock: 0, available: false } : row),
  });
  await expect(page.locator(`${HERO} button`).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(`[data-campaign="red-bull-cold-can"]`), 'se promociona un producto agotado').toHaveCount(0);
  await expect(page.locator(`[data-view="home"] [data-add-product="${target.id}"]:not([disabled])`)).toHaveCount(0);
  await expect(page.locator(`[data-campaign] [data-product-detail="${target.id}"]`)).toHaveCount(0);
  await page.locator('[data-nav-view="catalog"]:visible').first().tap();
  const card = page.locator(`${GRID} [data-card-product="${target.id}"]`);
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator('.product-action button')).toBeDisabled();
});

test('[SINTÉTICO] un producto con precio pendiente no se promociona ni se agrega', async ({ page }) => {
  const target = rowOf('coca-cola-original-2250ml');
  await openRuntimeCatalog(page, {
    catalogRows: live.products, view: 'home', waitForCatalog: false,
    mapRow: (row) => (row.sku === target.sku ? { ...row, price_status: 'pending', price: 0 } : row),
  });
  await expect(page.locator(`${HERO} button`).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-campaign="coca-cola-product-drop"]'), 'se promociona un producto sin precio').toHaveCount(0);
  await expect(page.locator(`[data-add-product="${target.id}"]:not([disabled])`)).toHaveCount(0);
});

test('[SINTÉTICO] con un stock de una unidad, la pieza compra una sola y después no deja sumar', async ({ page }) => {
  const target = rowOf('red-bull-original-250ml');
  await openRuntimeCatalog(page, {
    catalogRows: live.products, view: 'home', waitForCatalog: false,
    mapRow: (row) => (row.sku === target.sku ? { ...row, stock: 1 } : row),
  });
  const piece = page.locator('[data-campaign="red-bull-cold-can"]:visible').first();
  await expect(piece).toBeVisible({ timeout: 20_000 });
  await piece.locator('[data-campaign-add]').tap();
  await expect(piece.locator('[data-campaign-qty] strong')).toHaveText('1');
  await expect(piece.locator('[data-cart-inc]'), 'se puede sumar una unidad que no existe').toBeDisabled();
});

test('dos toques seguidos sobre «Agregar» suman dos unidades en UNA línea: ni línea duplicada ni toque perdido', async ({ page }) => {
  await openRuntimeCatalog(page, { catalogRows: live.products, view: 'home', waitForCatalog: false });
  const piece = page.locator('[data-campaign="red-bull-cold-can"]:visible').first();
  await expect(piece).toBeVisible({ timeout: 20_000 });
  const add = piece.locator('[data-campaign-add]');
  const box = await add.boundingBox();
  // Dos toques en el mismo punto, sin pausa, como un dedo impaciente. El
  // primero convierte el botón en cantidad y el segundo cae sobre su «+»: cada
  // toque es una intención y suma una unidad (agregar, sumar y restar no se
  // deduplican a propósito; `runCartAction`).
  await page.touchscreen.tap(box.x + box.width * 0.85, box.y + box.height / 2);
  await page.touchscreen.tap(box.x + box.width * 0.85, box.y + box.height / 2);
  await expect(piece.locator('[data-campaign-qty] strong')).toHaveText('2');
  await openCart(page);
  const lines = await cartLines(page);
  expect(lines, 'el doble toque dejó líneas duplicadas').toHaveLength(1);
  expect(lines[0].qty).toBe(2);
});

/* ─── Exploración adversarial: un cliente impaciente ───────────────────────── */

test('abrir y cerrar fichas desde piezas distintas, rápido, no deja diálogos abiertos ni cambia de producto', async ({ page }) => {
  await openRuntimeCatalog(page, { catalogRows: live.products, view: 'home', waitForCatalog: false });
  const hero = page.locator(`${HERO} [data-campaign]:visible`).first();
  const inline = page.locator(`${INLINE} [data-campaign]:visible`).first();
  await expect(hero).toBeVisible({ timeout: 20_000 });
  const heroId = await hero.locator('[data-campaign-cta]').getAttribute('data-product-detail');
  const inlineId = await inline.locator('[data-campaign-cta]').getAttribute('data-product-detail');
  expect(heroId).not.toBe(inlineId);
  const modal = page.locator('[data-product-modal]');
  for (let round = 0; round < 3; round += 1) {
    await hero.locator('[data-campaign-cta]').tap({ position: { x: 14, y: 14 } });
    await expect(modal.locator('[data-modal-product-id]')).toHaveAttribute('data-modal-product-id', heroId);
    await modal.locator('[data-close-modal]').first().tap();
    await expect(modal).toBeHidden();
    await inline.scrollIntoViewIfNeeded();
    await inline.locator('[data-campaign-cta]').tap({ position: { x: 14, y: 14 } });
    await expect(modal.locator('[data-modal-product-id]')).toHaveAttribute('data-modal-product-id', inlineId);
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await hero.scrollIntoViewIfNeeded();
  }
  await expect(page.locator('[data-view="cart"] .cart-item')).toHaveCount(0);
});

test('sin conexión la compra desde la pieza sigue funcionando y el pedido sobrevive a recargar', async ({ page, context }) => {
  await openRuntimeCatalog(page, { catalogRows: live.products, view: 'home', waitForCatalog: false });
  const piece = page.locator('[data-campaign="red-bull-cold-can"]:visible').first();
  await expect(piece).toBeVisible({ timeout: 20_000 });
  await context.setOffline(true);
  await piece.locator('[data-campaign-add]').tap();
  await expect(piece.locator('[data-campaign-qty] strong')).toHaveText('1');
  await context.setOffline(false);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-taba-startup', 'ready', { timeout: 20_000 });
  const again = page.locator('[data-campaign="red-bull-cold-can"]:visible').first();
  await expect(again, 'tras recargar la pieza no recuerda el pedido').toBeVisible({ timeout: 20_000 });
  await expect(again.locator('[data-campaign-qty] strong')).toHaveText('1');
  await openCart(page);
  expect(await cartLines(page)).toHaveLength(1);
});

test('cambiar de rubro a toda velocidad no deja la pieza de otro rubro ni errores de página', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await openRuntimeCatalog(page, { catalogRows: live.products });
  const ids = await page.evaluate(() => [...document.querySelectorAll('[data-view="catalog"] [data-category-strip] [data-category-id]')]
    .map((node) => node.dataset.categoryId));
  for (let pass = 0; pass < 2; pass += 1) {
    for (const id of ids) {
      await page.evaluate((categoryId) => document.querySelector(`[data-view="catalog"] [data-category-strip] [data-category-id="${categoryId}"]`)?.click(), id);
    }
  }
  await clickCatalogCategory(page, 'energizantes');
  await expect(page.locator(`${GRID} .product-card`)).toHaveCount(5);
  await expect(page.locator(`${GRID} [data-campaign]`), 'una pieza de otro rubro quedó colgada en uno corto').toHaveCount(0);
  expect(errors).toEqual([]);
});

/* ─── Filtros: sólo opciones que tienen resultado en el rubro que se mira ───── */

test('las opciones de marca son las del rubro, ninguna lleva a una lista vacía, y el valor aplicado no miente al cambiar de rubro', async ({ page }) => {
  await openRuntimeCatalog(page, { catalogRows: live.products });
  const slug = (value) => String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const brandsOf = (category) => [...new Set(VISIBLE.filter((row) => slug(row.category) === category).map((row) => row.brand))].sort();
  const offered = () => page.evaluate(() => [...document.querySelector('[data-catalog-filter="brand"]').options]
    .filter((option) => option.value !== 'all').map((option) => option.textContent.trim()).sort());

  for (const category of ['gaseosas', 'energizantes', 'mixers', 'aguas', 'isotonicas']) {
    await clickCatalogCategory(page, category);
    expect(await offered(), `«${category}»: la marca ofrece algo que el rubro no tiene`).toEqual(brandsOf(category));
  }

  // Cada opción de un rubro llega a, al menos, un producto.
  await clickCatalogCategory(page, 'energizantes');
  for (const brand of brandsOf('energizantes')) {
    await page.locator('[data-catalog-filter="brand"]').selectOption({ label: brand }, { force: true });
    await expect(page.locator(`${GRID} .product-card`).first(), `energizantes + ${brand}: lista vacía`).toBeVisible();
  }

  // El valor aplicado se conserva aunque el rubro nuevo no lo tenga: el
  // selector dice lo que está filtrando y la lista vacía se explica sola.
  await clickCatalogCategory(page, 'gaseosas');
  await page.locator('[data-catalog-filter="brand"]').selectOption({ label: 'Coca-Cola' }, { force: true });
  await clickCatalogCategory(page, 'energizantes');
  expect(await offered()).toContain('Coca-Cola');
  expect(await page.locator('[data-catalog-filter="brand"]').evaluate((node) => node.selectedOptions[0].textContent.trim())).toBe('Coca-Cola');
  await expect(page.locator(`${GRID} .empty-state`)).toContainText(/Ningún producto coincide con los filtros/);
});
