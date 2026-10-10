/*
 * AUDITORÍA DE NAVEGACIÓN DEL CATÁLOGO: categorías, orden, búsqueda, filtros,
 * favoritos y «volver desde el carrito», tocando como un cliente.
 *
 * Contrasta lo que la pantalla muestra con las filas públicas (`--rows`):
 *   · cada píldora de categoría trae exactamente los productos de su rubro;
 *   · «Todas» trae todos; «Destacados» y «Favoritos» se explican solos;
 *   · el orden por precio es de verdad creciente/decreciente;
 *   · cada búsqueda devuelve lo que corresponde (y las vacías, un estado honesto);
 *   · los filtros ofrecen sólo opciones con resultado dentro del rubro mirado;
 *   · un favorito sobrevive a recargar y a cambiar de rubro;
 *   · del carrito se vuelve al catálogo en el mismo rubro.
 *
 * SÓLO LECTURA contra producción (estado local del navegador).
 *
 *   node scripts/audit/catalog-navigation-audit.mjs --rows=<json> --out=<dir>
 *        [--base=https://la-taba.pages.dev/] [--local=http://127.0.0.1:8099]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, webkit } from '@playwright/test';
import { openRuntimeCatalog } from '../../tests/e2e/catalog-runtime-fixture.mjs';

const arg = (name, fallback = '') => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const LOCAL = arg('local');
const BASE = LOCAL || arg('base', 'https://la-taba.pages.dev/');
const ENGINE = arg('engine', 'chromium');
const [VW, VH] = arg('viewport', '390x844').split('x').map(Number);
const OUT = arg('out', 'artifacts/catalog-commercial-audit-20261009/raw');
const ROWS = JSON.parse(fs.readFileSync(arg('rows'), 'utf8')).rows;
const MOBILE = VW < 700;
const TAG = `${LOCAL ? 'local' : 'prod'}-${ENGINE}-${VW}x${VH}`;
fs.mkdirSync(OUT, { recursive: true });

const slug = (value) => String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const norm = (value) => String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch();
const context = await browser.newContext({
  viewport: { width: VW, height: VH }, hasTouch: MOBILE, isMobile: MOBILE, serviceWorkers: 'block', locale: 'es-AR',
  ...(LOCAL ? { baseURL: LOCAL } : {
    storageState: { cookies: [], origins: [{ origin: new URL(BASE).origin, localStorage: [{ name: 'TABA_INSTALL_PROMPT_V1', value: '{"outcome":"dismissed"}' }] }] },
  }),
});
const page = await context.newPage();
if (LOCAL) await openRuntimeCatalog(page, { catalogRows: ROWS, view: 'catalog' });
else {
  await page.goto(new URL('#catalog', BASE).toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('[data-view="catalog"] [data-card-product]', { timeout: 30_000 });
}
await page.waitForTimeout(1200);

const click = (selector) => page.evaluate((s) => document.querySelector(s)?.click(), selector);
const readGrid = () => page.evaluate(() => ({
  cards: [...document.querySelectorAll('[data-view="catalog"] [data-product-grid] .product-card')].map((card) => ({
    id: card.dataset.cardProduct,
    title: card.querySelector('h3')?.innerText.trim(),
    price: Number((card.querySelector('.product-foot')?.innerText.match(/\$\s*([\d.]+)/)?.[1] || '').replace(/\./g, '')) || null,
  })),
  empty: document.querySelector('[data-view="catalog"] [data-product-grid] .empty-state strong')?.innerText.trim() ?? null,
  campaign: [...document.querySelectorAll('[data-view="catalog"] [data-product-grid] [data-campaign]')].map((n) => n.dataset.campaign),
}));
const selectCategory = async (id) => {
  await click(`[data-view="catalog"] [data-category-strip] [data-category-id="${id}"]`);
  await page.waitForTimeout(450);
};

const report = { tag: TAG, categories: [], sort: [], search: [], filters: [], favorites: null, backFromCart: null };

// 1 · categorías
const pills = await page.evaluate(() => [...document.querySelectorAll('[data-view="catalog"] [data-category-strip] [data-category-id]')]
  .map((node) => ({ id: node.dataset.categoryId, label: node.innerText.replace(/\s+/g, ' ').trim() })));
for (const pill of pills) {
  await selectCategory(pill.id);
  const grid = await readGrid();
  const ids = grid.cards.map((card) => card.id);
  let expected = null;
  if (pill.id === 'all') expected = ROWS.map((row) => row.id);
  else if (!['favorites', 'popular', 'promos'].includes(pill.id)) {
    expected = ROWS.filter((row) => slug(row.category) === pill.id).map((row) => row.id);
  }
  const missing = expected ? expected.filter((id) => !ids.includes(id)) : null;
  const extra = expected ? ids.filter((id) => !expected.includes(id)) : null;
  report.categories.push({
    id: pill.id, label: pill.label, shown: ids.length, expected: expected?.length ?? null,
    missing: missing?.map((id) => ROWS.find((row) => row.id === id)?.sku), extra: extra?.map((id) => ROWS.find((row) => row.id === id)?.sku),
    empty: grid.empty, campaigns: grid.campaign,
    selected: await page.evaluate((id) => document.querySelector(`[data-view="catalog"] [data-category-strip] [data-category-id="${id}"]`)?.getAttribute('aria-pressed')
      ?? document.querySelector(`[data-view="catalog"] [data-category-strip] [data-category-id="${id}"]`)?.getAttribute('aria-current'), pill.id),
    titles: pill.id === 'popular' || pill.id === 'favorites' ? grid.cards.map((card) => card.title) : undefined,
  });
}

// 2 · orden
await selectCategory('all');
const sortSelect = '[data-view="catalog"] [data-sort-select], [data-view="catalog"] select[data-catalog-sort]';
const sortInfo = await page.evaluate((selector) => {
  const sel = document.querySelector(selector);
  return sel ? [...sel.options].map((option) => ({ value: option.value, label: option.textContent.trim() })) : null;
}, sortSelect);
report.sortOptions = sortInfo;
if (sortInfo) {
  for (const option of sortInfo) {
    await page.locator(sortSelect.split(',')[0]).first().selectOption(option.value).catch(async () => {
      await page.locator(sortSelect.split(',')[1].trim()).first().selectOption(option.value);
    });
    await page.waitForTimeout(350);
    const prices = (await readGrid()).cards.map((card) => card.price).filter((value) => value != null);
    const asc = prices.every((value, index) => index === 0 || prices[index - 1] <= value);
    const desc = prices.every((value, index) => index === 0 || prices[index - 1] >= value);
    report.sort.push({ option: option.label, count: prices.length, ascending: asc, descending: desc, first: prices.slice(0, 5) });
  }
}

// 3 · búsqueda
const queries = ['coca', 'cocacola', 'coca cola zero', 'red bull', 'redbul', 'lata', '2,25', '2250', 'sin azucar', 'sin azúcar', 'pack', 'agua', 'heineken', 'cerveza', 'zzzz'];
const searchSelector = '[data-view="catalog"] [data-search-input]';
for (const query of queries) {
  await page.locator(searchSelector).fill(query);
  await page.waitForTimeout(500);
  const grid = await readGrid();
  const expectedByName = ROWS.filter((row) => norm(`${row.name} ${row.brand} ${row.variant ?? ''} ${row.capacity ?? ''} ${row.packaging_type ?? ''} ${row.category ?? ''}`).includes(norm(query)));
  report.search.push({ query, shown: grid.cards.length, exactContains: expectedByName.length, empty: grid.empty, top: grid.cards.slice(0, 4).map((card) => card.title) });
}
await page.locator(searchSelector).fill('');
await page.waitForTimeout(400);

// 4 · filtros por rubro
for (const category of ['gaseosas', 'energizantes', 'mixers']) {
  await selectCategory(category);
  const facets = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-catalog-filter]')]
    .map((select) => [select.dataset.catalogFilter, [...select.options].filter((option) => option.value !== 'all').map((option) => option.textContent.trim())])));
  const inCategory = ROWS.filter((row) => slug(row.category) === category);
  const brandsHere = new Set(inCategory.map((row) => row.brand));
  const offeredBrands = facets.brand || [];
  report.filters.push({
    category, products: inCategory.length, brandsOffered: offeredBrands.length, brandsPresent: brandsHere.size,
    brandsWithNoResult: offeredBrands.filter((brand) => ![...brandsHere].some((present) => norm(present) === norm(brand))),
  });
}

// 5 · favoritos
await selectCategory('all');
const firstCard = page.locator('[data-view="catalog"] [data-product-grid] .product-card').first();
const favoriteId = await firstCard.getAttribute('data-card-product');
await firstCard.locator('[data-favorite-toggle]').click();
await page.waitForTimeout(400);
await selectCategory('favorites');
const favoritesNow = (await readGrid()).cards.map((card) => card.id);
await page.reload({ waitUntil: 'domcontentloaded' });
if (LOCAL) await page.waitForTimeout(1500);
await page.waitForSelector('[data-view="catalog"] [data-card-product]', { timeout: 30_000 }).catch(() => {});
await selectCategory('favorites');
const favoritesAfterReload = (await readGrid()).cards.map((card) => card.id);
report.favorites = { id: favoriteId, listedAfterToggle: favoritesNow.includes(favoriteId), persistsAfterReload: favoritesAfterReload.includes(favoriteId) };

// 6 · volver desde el carrito
await selectCategory('gaseosas');
await page.locator('[data-view="catalog"] [data-product-grid] .product-action button:not([disabled])').first().click();
await page.locator('[data-nav-view="cart"]:visible').first().click();
await page.waitForTimeout(500);
await page.goBack().catch(() => {});
await page.waitForTimeout(600);
const afterBack = await page.evaluate(() => ({ view: document.body.dataset.activeView, hash: location.hash }));
await page.locator('[data-nav-view="catalog"]:visible').first().click().catch(() => {});
await page.waitForTimeout(500);
report.backFromCart = { afterBack, categoryAfterReturn: (await readGrid()).cards.length };

fs.writeFileSync(path.join(OUT, `navigation-${TAG}.json`), JSON.stringify(report, null, 1));
console.log(JSON.stringify({
  categories: report.categories.map((c) => `${c.id}:${c.shown}/${c.expected ?? '-'}${c.missing?.length || c.extra?.length ? ' MISMATCH' : ''}`),
  sort: report.sort.map((s) => `${s.option}: asc=${s.ascending} desc=${s.descending}`),
  filters: report.filters,
  favorites: report.favorites,
  back: report.backFromCart,
}, null, 1));
await browser.close();
