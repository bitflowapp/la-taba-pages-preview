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
  // `null` = sin origen declarado: manda lo que traiga el modo (la demo siembra
  // sus fixtures). Un array —incluido `[]`— declara el origen real y gana
  // siempre, que es el contrato que consumirá el backend.
  if (Array.isArray(stories)) {
    await page.addInitScript((fixtures) => { window.TABA2_STORIES = fixtures; }, stories);
  }
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await page.waitForSelector('[data-view="home"] .home-best-card');
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

// El origen productivo es el global que publica el backend. La demo siembra
// fixtures propias (`preview-stories-data.js`), así que para ejercitar el
// fail-closed hay que declarar explícitamente que el origen real está vacío:
// es exactamente lo que ocurre en producción antes del primer publicado.
test('sin historias publicadas el logo no se anuncia como botón', async ({ page }) => {
  await openHome(page, { stories: [] });

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

test('el shell de marca es continuo entre las vistas del cliente', async ({ page }) => {
  await openHome(page);
  const leer = () => page.evaluate(() => ({
    vista: document.body.dataset.activeView,
    body: getComputedStyle(document.body).backgroundColor,
    topbar: getComputedStyle(document.querySelector('.topbar')).backgroundColor,
    nav: getComputedStyle(document.querySelector('.mobile-nav')).backgroundColor,
  }));

  const home = await leer();
  // Fondo de marca oscuro, producto sobre blanco.
  expect(home.body).toBe('rgb(9, 11, 14)');
  expect(await page.locator('.home-best-card').first().evaluate((n) => getComputedStyle(n).backgroundColor))
    .toBe('rgb(255, 255, 255)');

  // Navegar NO puede producir un salto negro → blanco: el shell se conserva.
  for (const vista of ['catalog', 'cart', 'profile', 'tracking']) {
    await page.locator(`.mobile-nav [data-nav-view="${vista}"]`).click();
    await expect(page.locator(`[data-view="${vista}"]`)).toBeVisible();
    const actual = await leer();
    expect(actual.vista, `vista ${vista}`).toBe(vista);
    expect(actual.body, `fondo en ${vista}`).toBe(home.body);
    expect(actual.topbar, `barra en ${vista}`).toBe(home.topbar);
    expect(actual.nav, `navegación en ${vista}`).toBe(home.nav);
  }
});

test('el panel operativo conserva su superficie clara', async ({ page }) => {
  await openHome(page);
  const home = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.goto('/?demo=1#business');
  await expect(page.locator('[data-view="business"]')).toBeVisible();
  const negocio = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(negocio).not.toBe(home);
});

test('ningún texto de las vistas del cliente queda por debajo de 3:1', async ({ page }) => {
  await openHome(page);
  await page.locator('[data-home-sections] [data-add-product]:not([disabled])').first().click();

  for (const vista of ['home', 'catalog', 'cart', 'profile', 'tracking']) {
    await page.locator(`.mobile-nav [data-nav-view="${vista}"]`).click();
    await expect(page.locator(`[data-view="${vista}"]`)).toBeVisible();
    await page.waitForTimeout(250);
    const malos = await page.evaluate(() => {
      const parse = (v) => {
        const p = String(v).match(/[\d.]+/g);
        if (!p) return null;
        const [r, g, b, a = '1'] = p.map(Number);
        return { r, g, b, a };
      };
      const lum = ({ r, g, b }) => {
        const c = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
      };
      const out = [];
      for (const node of document.querySelectorAll('.app-view:not([hidden]) *')) {
        if (![...node.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) continue;
        const cs = getComputedStyle(node);
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.15) continue;
        const fg = parse(cs.color);
        if (!fg || fg.a < 0.15) continue;
        let bg = null;
        for (let c = node; c; c = c.parentElement) {
          const cand = parse(getComputedStyle(c).backgroundColor);
          if (cand && cand.a >= 0.9) { bg = cand; break; }
        }
        if (!bg) continue;
        const ratio = (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
        if (ratio < 3) out.push(`${ratio.toFixed(2)}:1 <${node.tagName.toLowerCase()}> "${node.textContent.trim().slice(0, 40)}"`);
      }
      return out;
    });
    expect(malos, `contraste en ${vista}`).toEqual([]);
  }
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

  await page.locator('[data-home-sections] [data-add-product]:not([disabled])').first().click();
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
  await expect(nav.locator('button')).toHaveCount(5);
  // Cinco destinos distintos: ninguno repetido, así `aria-current` apunta a uno.
  for (const vista of ['home', 'catalog', 'cart', 'tracking', 'profile']) {
    await expect(nav.locator(`[data-nav-view="${vista}"]`)).toHaveCount(1);
  }
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
    await page.waitForSelector('[data-view="home"] .home-best-card');
    const geometry = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      homeHeight: Math.ceil(document.querySelector('[data-view="home"]').getBoundingClientRect().height),
      homeSections: document.querySelectorAll('[data-home-sections] .home-category-section').length,
      homeBanners: [...document.querySelectorAll('[data-view="home"] .home-brand-banner')]
        .filter((node) => getComputedStyle(node).display !== 'none').length,
    }));
    expect(geometry.documentWidth, `${viewport.width}px`).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    // La home pasó de una grilla de vista previa de 4 tarjetas a carruseles por
    // sección de bebidas, así que es deliberadamente más alta. Lo que se
    // controla ya no es un alto arbitrario sino la CANTIDAD de secciones: el
    // tope real vive en HOME_MAX_SECTIONS y este techo lo respalda. Sin ese
    // tope las 11 secciones definidas darían ~4000px y esto volvería a fallar.
    expect(geometry.homeSections, `${viewport.width}px`).toBeLessThanOrEqual(6);
    // Cada tramo puede cerrar con un banner editorial, así que el techo sube con
    // la vidriera: 6 secciones + 6 banners de 150px en escritorio. Sigue siendo
    // un techo real —una sección de más lo rompe— y se acompaña del invariante
    // de abajo, que impide que los banners crezcan por su cuenta.
    expect(geometry.homeBanners, `${viewport.width}px`).toBeLessThanOrEqual(geometry.homeSections);
    expect(geometry.homeHeight, `${viewport.width}px`).toBeLessThan(3200);
  }
});

// La vidriera intercalada tiene tres reglas que no pueden aflojarse sin que la
// home vuelva a ser un muestrario: un banner no repite un rubro que ya tiene
// carrusel, nunca hay dos seguidos y ninguno afirma un precio.
test('los banners editoriales cortan el ritmo sin repetir rubro ni prometer precio', async ({ page }) => {
  await openHome(page);

  const composicion = await page.evaluate(() => {
    const visible = (node) => getComputedStyle(node).display !== 'none';
    const banners = [...document.querySelectorAll('[data-view="home"] .home-brand-banner')].filter(visible);
    const secciones = [...document.querySelectorAll('[data-home-sections] .home-category-section')];
    return {
      rubrosBanner: banners.map((node) => node.dataset.categoryId),
      textos: banners.map((node) => node.textContent.replace(/\s+/g, ' ').trim()),
      seccionesConCarrusel: secciones
        .map((node) => node.querySelector('[data-category-id]')?.dataset.categoryId)
        .filter(Boolean),
      // Dos banners "seguidos" = sin un tramo de producto entre medio.
      adyacentes: banners.filter((node, index) => {
        if (index === 0) return false;
        const previo = banners[index - 1].getBoundingClientRect().bottom;
        return node.getBoundingClientRect().top - previo < 60;
      }).length,
    };
  });

  expect(composicion.rubrosBanner.length).toBeGreaterThan(0);
  expect(composicion.adyacentes, 'banners consecutivos').toBe(0);
  expect(new Set(composicion.rubrosBanner).size, 'rubros repetidos entre banners')
    .toBe(composicion.rubrosBanner.length);

  // Un banner sobre un rubro que ya tiene carrusel gasta un tramo en repetir.
  // El encabezado es la única excepción: abre la home antes del primer carrusel.
  for (const rubro of composicion.rubrosBanner.slice(1)) {
    expect(composicion.seccionesConCarrusel, `banner ${rubro} duplica su carrusel`)
      .not.toContain(rubro);
  }

  for (const texto of composicion.textos) {
    expect(texto, 'un banner editorial no puede afirmar importe ni descuento')
      .not.toMatch(/\$|%|\bdescuento\b|\boferta\b|\bpromo\b/i);
  }

  // Ningún banner puede ser un link muerto.
  for (const rubro of composicion.rubrosBanner) {
    await page.locator(`[data-view="home"] .home-brand-banner[data-category-id="${rubro}"]`).click();
    await expect(page.locator('[data-view="catalog"]')).toBeVisible();
    await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
    await page.goBack();
    await expect(page.locator('[data-view="home"]')).toBeVisible();
  }
});
