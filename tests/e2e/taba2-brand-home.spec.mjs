// Regresión visual de la home de marca de La Taba 2.
//
// Por qué NO son capturas de píxeles: el gate de CI corre en `ubuntu-latest` y
// el desarrollo ocurre en Windows. Una baseline de píxeles generada en una de
// las dos plataformas pone la otra en rojo por rasterizado de fuentes, no por
// una regresión real. Esta suite fija el CONTRATO VISUAL —superficie, color
// resuelto, contraste, geometría, objetivos táctiles y estado— que es idéntico
// en Chromium, WebKit y Firefox y en los dos sistemas operativos.
//
// Las capturas reales se generan como artefacto fuera de Git para la revisión
// humana; acá vive lo que puede fallar automáticamente.
import { expect, test } from '@playwright/test';
import { gotoDemoReset, installBrowserStubs, installPageGuards } from './helpers.mjs';

const PHONE = { width: 390, height: 844 };

const STORY_FIXTURES = [
  {
    id: 'story-combo',
    business_id: 'la-taba-2',
    title: 'Combo de la semana',
    media_type: 'image',
    media_url: 'assets/products/beverage-placeholder.svg',
    thumbnail_url: 'assets/products/beverage-placeholder.svg',
    starts_at: null,
    expires_at: null,
    priority: 10,
    cta_type: 'category',
    cta_target: 'cervezas',
    is_highlight: true,
    published: true,
  },
  {
    id: 'story-frio',
    business_id: 'la-taba-2',
    title: 'Siempre frío',
    media_type: 'image',
    media_url: 'assets/products/beverage-placeholder.svg',
    thumbnail_url: 'assets/products/beverage-placeholder.svg',
    starts_at: null,
    expires_at: null,
    priority: 1,
    cta_type: 'category',
    cta_target: 'gaseosas',
    is_highlight: false,
    published: true,
  },
];

// ── Contraste WCAG sobre el color REALMENTE pintado ──────────────────────────
// Resuelve el fondo subiendo por los ancestros hasta encontrar uno opaco, que
// es lo que el ojo ve. Sin esto un `transparent` daría un falso verde.
const CONTRAST_PROBE = `(selector) => {
  const node = document.querySelector(selector);
  if (!node) return null;
  const parse = (value) => {
    const parts = String(value).match(/[\\d.]+/g);
    if (!parts) return null;
    const [r, g, b, a = '1'] = parts.map(Number);
    return { r, g, b, a };
  };
  const luminance = ({ r, g, b }) => {
    const channel = (value) => {
      const v = value / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const foreground = parse(getComputedStyle(node).color);
  let background = null;
  for (let cursor = node; cursor; cursor = cursor.parentElement) {
    const candidate = parse(getComputedStyle(cursor).backgroundColor);
    if (candidate && candidate.a >= 0.92) { background = candidate; break; }
  }
  if (!foreground || !background) return null;
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return {
    ratio: Number(((light + 0.05) / (dark + 0.05)).toFixed(2)),
    fontSize: parseFloat(getComputedStyle(node).fontSize),
    fontWeight: Number(getComputedStyle(node).fontWeight) || 400,
  };
}`;

async function contrast(page, selector) {
  return page.evaluate(new Function(`return ${CONTRAST_PROBE}`)(), selector);
}

async function openHome(page, { stories = null, viewport = PHONE } = {}) {
  await page.setViewportSize(viewport);
  await installBrowserStubs(page);
  if (stories) {
    await page.addInitScript((fixtures) => { window.TABA2_STORIES = fixtures; }, stories);
  }
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await page.waitForSelector('[data-view="home"] .home-catalog-card');
}

test('el encabezado presenta la identidad real del comercio, no una escrita a mano', async ({ page }) => {
  const guards = installPageGuards(page);
  await openHome(page);

  await expect(page.locator('.brand-hero-welcome')).toHaveText('¡Bienvenido a');
  await expect(page.getByRole('heading', { name: 'La Taba 2', level: 1 })).toBeVisible();
  // Rubro y dirección salen de `businessConfig`: la vista sólo los concatena.
  await expect(page.locator('[data-home-business-place]')).toHaveText('Tienda de bebidas · Mendoza 827, Neuquén');
  await expect(page.locator('[data-open-status]')).toBeVisible();
  await expect(page.locator('[data-open-status]')).toHaveText('Pedidos disponibles');
  // Sin horario publicado no se inventa ninguno.
  await expect(page.locator('[data-home-business-hours]')).toBeHidden();
  await guards.assertClean();
});

test('sin historias publicadas el logo no se anuncia como botón', async ({ page }) => {
  await openHome(page);

  await expect(page.locator('[data-stories-slot]')).toHaveAttribute('data-stories-state', 'empty');
  await expect(page.locator('.brand-logo-action')).toBeHidden();
  await expect(page.locator('.brand-stories-cta')).toBeHidden();
  await expect(page.locator('[data-stories-static]')).toBeVisible();
  // El aro no se pinta: nada promete contenido inexistente.
  const ringPainted = await page.locator('[data-stories-static] .brand-logo-ring')
    .evaluate((node) => getComputedStyle(node).backgroundImage !== 'none');
  expect(ringPainted).toBe(false);
});

test('la caja del logo no se mueve entre estados: sin historias y con historias mide igual', async ({ page }) => {
  await openHome(page);
  const empty = await page.locator('[data-stories-slot]').boundingBox();

  const context = await page.context().browser().newContext({ viewport: PHONE });
  const withStories = await context.newPage();
  await installBrowserStubs(withStories);
  await withStories.addInitScript((fixtures) => { window.TABA2_STORIES = fixtures; }, STORY_FIXTURES);
  await gotoDemoReset(withStories, '/?reset=1&demo=1');
  await withStories.waitForSelector('.brand-logo-action:not([hidden])');
  const filled = await withStories.locator('[data-stories-slot]').boundingBox();

  expect(Math.round(filled.width)).toBe(Math.round(empty.width));
  expect(Math.round(filled.height)).toBe(Math.round(empty.height));
  await context.close();
});

test('con historias vigentes el logo es botón, el aro se enciende y el acceso dice cuántas hay', async ({ page }) => {
  await openHome(page, { stories: STORY_FIXTURES });

  await expect(page.locator('[data-stories-slot]')).toHaveAttribute('data-stories-state', 'unseen');
  const logo = page.locator('.brand-logo-action');
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute('aria-label', /2 historias nuevas de La Taba 2/);
  // El estado no viaja sólo en el color del aro.
  await expect(page.locator('[data-stories-cta-detail]')).toHaveText('2 historias nuevas');

  await logo.click();
  const modal = page.locator('[data-stories-modal]');
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('heading', { name: 'Combo de la semana' })).toBeVisible();
  await expect(modal.locator('[data-story-cta]')).toHaveText('Ver categoría');

  // La CTA usa una acción que ya existe: filtra el catálogo real.
  await modal.locator('[data-story-cta]').click();
  await expect(modal).toBeHidden();
  await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  await expect(page.locator('[data-catalog-title]')).toHaveText('Cervezas');
  await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
});

test('las historias vistas atenúan el aro en vez de desaparecer', async ({ page }) => {
  await openHome(page, { stories: STORY_FIXTURES });
  await page.locator('.brand-logo-action').click();
  await page.locator('[data-story-next]').click();
  await page.locator('[data-close-stories]').click();

  await expect(page.locator('[data-stories-slot]')).toHaveAttribute('data-stories-state', 'seen');
  await expect(page.locator('[data-stories-cta-detail]')).toHaveText('Ver historias');
  await expect(page.locator('.brand-logo-action')).toBeVisible();
});

test('el foco vuelve al logo al cerrar el visor', async ({ page }) => {
  await openHome(page, { stories: STORY_FIXTURES });
  const logo = page.locator('.brand-logo-action');
  await logo.click();
  await page.locator('[data-close-stories]').click();
  await expect(logo).toBeFocused();
});

test('el buscador ocupa el ancho útil, es táctil y no dispara el zoom de iOS', async ({ page }) => {
  await openHome(page);
  const search = page.locator('[data-view="home"] .taba-home-search');
  const input = search.locator('input');

  const [box, home] = await Promise.all([search.boundingBox(), page.locator('[data-view="home"]').boundingBox()]);
  expect(box.width).toBeGreaterThan(home.width * 0.88);
  expect(box.height).toBeGreaterThanOrEqual(48);
  expect(await input.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
  await expect(input).toHaveAttribute('placeholder', 'Buscar bebidas, marcas y ofertas…');

  await input.fill('coca');
  await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
});

test('la fila de categorías sólo ofrece rubros que hoy se pueden comprar', async ({ page }) => {
  await openHome(page);
  const chips = page.locator('[data-home-category-strip] [data-category-id]');
  const ids = await chips.evaluateAll((nodes) => nodes.map((node) => node.dataset.categoryId));

  expect(ids[0]).toBe('all');
  expect(ids).toContain('gaseosas');
  expect(ids).toContain('cervezas');
  // Sin precio publicado un rubro no puede ser protagonista de la home.
  expect(ids).not.toContain('whisky');
  expect(ids).not.toContain('fernet');

  // Ninguna categoría de la fila lleva a un catálogo vacío.
  for (const id of ids.filter((candidate) => candidate !== 'all')) {
    await page.locator(`[data-home-category-strip] [data-category-id="${id}"]`).click();
    await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
    await page.goBack();
    await expect(page.locator('[data-view="home"]')).toBeVisible();
  }
});

test('el banner editorial lleva a una categoría real y no afirma un descuento', async ({ page }) => {
  await openHome(page);
  const banner = page.locator('.home-brand-banner').first();
  await expect(banner).toBeVisible();
  await expect(banner).not.toContainText('%');
  await expect(banner).not.toContainText('$');

  const categoryId = await banner.getAttribute('data-category-id');
  expect(categoryId).toBeTruthy();
  await banner.click();
  await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
});

test('la superficie de marca se aplica a la home y NO se filtra al catálogo', async ({ page }) => {
  await openHome(page);
  const homeSurface = await page.evaluate(() => ({
    body: getComputedStyle(document.body).backgroundColor,
    topbar: getComputedStyle(document.querySelector('.topbar')).backgroundColor,
    nav: getComputedStyle(document.querySelector('.mobile-nav')).backgroundColor,
    card: getComputedStyle(document.querySelector('.home-catalog-card')).backgroundColor,
  }));
  // Fondo de marca oscuro, producto sobre blanco.
  expect(homeSurface.body).toBe('rgb(9, 11, 14)');
  expect(homeSurface.card).toBe('rgb(255, 255, 255)');

  await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  const catalogSurface = await page.evaluate(() => ({
    body: getComputedStyle(document.body).backgroundColor,
    topbar: getComputedStyle(document.querySelector('.topbar')).backgroundColor,
    nav: getComputedStyle(document.querySelector('.mobile-nav')).backgroundColor,
  }));
  expect(catalogSurface.body).not.toBe('rgb(9, 11, 14)');
  expect(catalogSurface.topbar).not.toBe(homeSurface.topbar);
  expect(catalogSurface.nav).not.toBe(homeSurface.nav);
});

test('el texto de la home cumple el contraste mínimo sobre la superficie oscura', async ({ page }) => {
  await openHome(page, { stories: STORY_FIXTURES });

  const probes = [
    ['.brand-hero-welcome', 4.5],
    ['[data-home-business-place]', 4.5],
    ['[data-open-status]', 4.5],
    ['[data-stories-cta-detail]', 4.5],
    ['[data-view="home"] .taba-home-search input', 4.5],
    ['.home-section-head h2', 4.5],
    ['.home-section-head button', 4.5],
    ['.home-section-title small', 4.5],
    ['.home-brand-banner small', 4.5],
    ['.home-brand-banner span', 4.5],
    ['.mobile-nav button.active .mn-label', 4.5],
    ['.mobile-nav button:not(.active) .mn-label', 4.5],
  ];

  for (const [selector, minimum] of probes) {
    const measured = await contrast(page, selector);
    expect(measured, `sin medición para ${selector}`).not.toBeNull();
    expect(measured.ratio, `${selector} → ${measured.ratio}:1`).toBeGreaterThanOrEqual(minimum);
  }
});

test('todo control de la home alcanza 44x44 en los anchos compactos', async ({ page }) => {
  await openHome(page, { stories: STORY_FIXTURES });

  for (const viewport of [{ width: 320, height: 568 }, { width: 360, height: 800 }, PHONE, { width: 412, height: 915 }]) {
    await page.setViewportSize(viewport);
    const undersized = await page.locator('[data-view="home"] button:not([hidden])').evaluateAll((nodes) => nodes
      .filter((node) => node.offsetParent !== null)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return { html: node.outerHTML.slice(0, 90), width: rect.width, height: rect.height };
      })
      .filter(({ width, height }) => width < 44 || height < 44));
    expect(undersized, `${viewport.width}x${viewport.height}`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  }
});

test('la barra de carrito aparece con productos, respeta la nav y no la tapa', async ({ page }) => {
  await openHome(page);
  const bar = page.locator('[data-floating-cart]');
  await expect(bar).toBeHidden();

  await page.locator('[data-home-catalog-preview] [data-add-product]:not([disabled])').first().click();
  await expect(bar).toBeVisible();
  await expect(bar.locator('[data-floating-cart-count]')).toHaveText('1 producto');
  await expect(bar.locator('[data-floating-cart-summary]')).toContainText(/^\$/);

  const [barBox, navBox] = await Promise.all([bar.boundingBox(), page.locator('.mobile-nav').boundingBox()]);
  expect(navBox.y - (barBox.y + barBox.height)).toBeGreaterThanOrEqual(10);
  expect(barBox.height).toBeGreaterThanOrEqual(44);

  await bar.click();
  await expect(page.locator('[data-view="cart"]')).toBeVisible();
});

test('la navegación inferior conserva rutas, contador y estado accesible', async ({ page }) => {
  await openHome(page);
  const nav = page.locator('.mobile-nav');
  await expect(nav.locator('button')).toHaveCount(4);
  await expect(nav.locator('[data-nav-view="home"]')).toHaveAttribute('aria-current', 'page');
  await expect(nav.locator('[data-nav-view="catalog"]')).not.toHaveAttribute('aria-current', 'page');

  await nav.locator('[data-nav-view="catalog"]').click();
  await expect(nav.locator('[data-nav-view="catalog"]')).toHaveAttribute('aria-current', 'page');
  await page.goBack();
  await expect(page.locator('[data-view="home"]')).toBeVisible();
  await expect(nav.locator('[data-nav-view="home"]')).toHaveAttribute('aria-current', 'page');
});

test('con movimiento reducido el aro deja de animarse y el estado sigue siendo legible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openHome(page, { stories: STORY_FIXTURES });

  const ring = page.locator('.brand-logo-action .brand-logo-ring');
  const duration = await ring.evaluate((node) => getComputedStyle(node).animationDuration);
  expect(parseFloat(duration)).toBeLessThanOrEqual(0.01);
  // El aro sigue pintado y el texto sigue diciendo el estado.
  expect(await ring.evaluate((node) => getComputedStyle(node).backgroundImage)).not.toBe('none');
  await expect(page.locator('[data-stories-cta-detail]')).toHaveText('2 historias nuevas');
});

test('la home no crece sin control en los anchos objetivo', async ({ page }) => {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 393, height: 852 },
    { width: 412, height: 915 },
    { width: 768, height: 1024 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    await installBrowserStubs(page);
    await gotoDemoReset(page, '/?reset=1&demo=1');
    await page.waitForSelector('[data-view="home"] .home-catalog-card');
    const geometry = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      homeHeight: Math.ceil(document.querySelector('[data-view="home"]').getBoundingClientRect().height),
    }));
    expect(geometry.documentWidth, `${viewport.width}px`).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.homeHeight, `${viewport.width}px`).toBeLessThan(2000);
  }
});
