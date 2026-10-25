import { expect, test } from '@playwright/test';
import { gotoDemoReset, installBrowserStubs, installPageGuards } from './helpers.mjs';
import { GRID, openRuntimeCatalog } from './catalog-runtime-fixture.mjs';

// Contrato de la transformación comercial del catálogo (2026-10-24):
//  · vista Cuadrícula / Lista (js/catalog-layout.js),
//  · aviso de alcance cuando se busca dentro de un rubro,
//  · fotografía editorial sólo con autorización documentada (js/core/promo-rights.js),
//  · placeholder propio y honesto para productos sin foto,
//  · un solo combo ocupa el renglón en el teléfono.
// Mide geometría real; lo prometido se verifica con cajas, no con clases.

const VITRINA = '/?reset=1&demo=1&vitrina=neuquen20261024';
const MOTO = { width: 432, height: 815 }; // viewport útil medido en el Moto G15 físico
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const CARDS = `${GRID} article[data-card-product]`;
// 44px de zona táctil. La vista entra con una animación corta de escala que deja el alto en
// 43,99999…: se mide con medio píxel de tolerancia, no con otro criterio.
const TAP_MIN = 43.5;
const TOGGLE = '[data-view="catalog"] [data-catalog-layout-toggle]';

async function openCatalog(page, viewport) {
  await page.setViewportSize(viewport);
  await installBrowserStubs(page);
  await gotoDemoReset(page, VITRINA);
  await page.waitForSelector('[data-view="home"] .home-best-card');
  await page.evaluate(() => { window.location.hash = '#catalog'; });
  await expect(page.locator(CARDS).first()).toBeVisible();
}

test.describe('vista del catálogo: cuadrícula y lista', () => {
  test('en el teléfono la grilla es la vista de entrada y el botón ofrece la lista', async ({ page }) => {
    await openCatalog(page, MOTO);
    const toggle = page.locator(TOGGLE);
    await expect(toggle).toBeVisible();
    await expect(page.locator(GRID)).toHaveAttribute('data-catalog-layout', 'grid');
    await expect(toggle).toHaveAttribute('aria-label', 'Ver los productos en lista');
    const box = await toggle.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(TAP_MIN);
    expect(box.height).toBeGreaterThanOrEqual(TAP_MIN);
  });

  test('la lista muestra al menos cuatro productos completos, con precio y «Agregar», sin desborde', async ({ page }) => {
    await openCatalog(page, MOTO);
    await page.locator(TOGGLE).click();
    await expect(page.locator(GRID)).toHaveAttribute('data-catalog-layout', 'list');
    await expect(page.locator(TOGGLE)).toHaveAttribute('aria-label', 'Ver los productos en cuadrícula');
    await page.evaluate(() => window.scrollTo(0, 0));

    const nav = (await page.locator('.mobile-nav').boundingBox()).y;
    const visibles = await page.evaluate((navTop) => {
      const cards = [...document.querySelectorAll('[data-view="catalog"] [data-product-grid] article[data-card-product]')];
      return cards.map((card) => {
        const r = card.getBoundingClientRect();
        const price = card.querySelector('.price strong')?.getBoundingClientRect();
        const add = card.querySelector('[data-add-product]')?.getBoundingClientRect();
        const photo = card.querySelector('.product-media')?.getBoundingClientRect();
        return {
          completa: r.top >= 0 && r.bottom <= navTop + 1,
          precio: !!price && price.bottom <= navTop,
          agregarAlto: add ? Math.round(add.height) : 0,
          foto: photo ? Math.round(photo.width) : 0,
          alto: Math.round(r.height),
        };
      });
    }, nav);
    const completas = visibles.filter((row) => row.completa);
    expect(completas.length, 'renglones completos en la primera pantalla').toBeGreaterThanOrEqual(4);
    for (const row of completas) {
      expect(row.precio).toBe(true);
      expect(row.agregarAlto).toBeGreaterThanOrEqual(44);
      expect(row.foto).toBe(88);
      expect(row.alto).toBeLessThanOrEqual(120);
    }
    for (const width of [320, 360, 390, 412, 432, 699]) {
      await page.setViewportSize({ width, height: 815 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${width}px`).toBe(true);
    }
  });

  test('agregar desde la lista pone el stepper en su lugar y el corazón y los textos no se pisan', async ({ page }) => {
    await openCatalog(page, MOTO);
    await page.locator(TOGGLE).click();
    const card = page.locator(CARDS).first();
    await card.locator('[data-add-product]').click();
    const stepper = card.locator('.qty-stepper');
    await expect(stepper).toBeVisible();
    await expect(page.locator('[data-cart-count]').first()).toHaveText('1');

    const geo = await card.evaluate((node) => {
      const r = (selector) => { const el = node.querySelector(selector); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
      return { card: node.getBoundingClientRect().toJSON(), stepper: r('.qty-stepper'), heart: r('.product-favorite'), title: r('h3'), price: r('.price') };
    });
    expect(geo.stepper.h).toBeGreaterThanOrEqual(44);
    expect(geo.stepper.r).toBeLessThanOrEqual(geo.card.right + 0.5);
    expect(geo.stepper.y, 'el stepper queda debajo del corazón').toBeGreaterThanOrEqual(geo.heart.b - 1);
    expect(geo.heart.w).toBeGreaterThanOrEqual(44);
    expect(geo.title.r, 'el título no invade la columna de la acción').toBeLessThanOrEqual(geo.stepper.x + 1);
  });

  test('la elección se recuerda en la próxima visita y vuelve a la grilla con un toque', async ({ page, context }) => {
    await openCatalog(page, MOTO);
    await page.locator(TOGGLE).click();
    await expect(page.locator(GRID)).toHaveAttribute('data-catalog-layout', 'list');
    expect(await page.evaluate(() => localStorage.getItem('la_taba_catalog_layout_v1'))).toBe('list');

    // Otra pestaña del mismo navegador, sin los stubs que limpian el almacenamiento en cada navegación.
    const siguiente = await context.newPage();
    await siguiente.setViewportSize(MOTO);
    await siguiente.goto('/?demo=1&vitrina=neuquen20261024#catalog');
    await siguiente.waitForSelector(CARDS);
    await expect(siguiente.locator(GRID)).toHaveAttribute('data-catalog-layout', 'list');
    await siguiente.locator(TOGGLE).click();
    await expect(siguiente.locator(GRID)).toHaveAttribute('data-catalog-layout', 'grid');
    expect(await siguiente.evaluate(() => localStorage.getItem('la_taba_catalog_layout_v1'))).toBe('grid');
    await siguiente.close();
  });

  test('productos agotados y sin precio caben en la lista sin desbordar', async ({ page }) => {
    await page.setViewportSize(MOTO);
    await installBrowserStubs(page);
    await gotoDemoReset(page, VITRINA);
    await page.waitForSelector('[data-view="home"] .home-best-card');
    await page.evaluate(() => { window.location.hash = '#catalog'; });
    await page.locator(TOGGLE).click();
    // Cervezas incluye productos que el local todavía no vende: son los renglones más estrechos.
    await page.locator('[data-view="catalog"] [data-category-id="cervezas"]').first().click();
    await expect(page.locator('[data-catalog-title]')).toHaveText('Cervezas');
    const filas = await page.evaluate(() => [...document.querySelectorAll('[data-view="catalog"] [data-product-grid] article[data-card-product]')].map((card) => {
      const r = card.getBoundingClientRect();
      const over = [...card.querySelectorAll('*')].filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.right > r.right + 0.5; }).length;
      const add = card.querySelector('[data-add-product], .qty-stepper');
      return { sobresale: over, accion: !!add, alto: r.height };
    }));
    expect(filas.length).toBeGreaterThan(3);
    for (const fila of filas) {
      expect(fila.sobresale).toBe(0);
      expect(fila.accion).toBe(true);
      expect(fila.alto).toBeLessThanOrEqual(140);
    }
  });

  test('desde tableta no hay botón y la grilla no cambia aunque haya «lista» guardada', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await installBrowserStubs(page);
    await page.addInitScript(() => { try { localStorage.setItem('la_taba_catalog_layout_v1', 'list'); } catch (_) { /* sin almacenamiento */ } });
    await gotoDemoReset(page, VITRINA);
    await page.waitForSelector('[data-view="home"] .home-best-card');
    await page.evaluate(() => { window.location.hash = '#catalog'; });
    await expect(page.locator(CARDS).first()).toBeVisible();
    await expect(page.locator(TOGGLE)).toBeHidden();
    const columnas = await page.evaluate(() => {
      const xs = new Set([...document.querySelectorAll('[data-view="catalog"] [data-product-grid] article[data-card-product]')].slice(0, 12).map((c) => Math.round(c.getBoundingClientRect().x)));
      return xs.size;
    });
    expect(columnas).toBeGreaterThanOrEqual(3);
  });
});

test.describe('buscar dentro de un rubro', () => {
  test('avisa el alcance y «Buscar en todo» lo suelta sin perder la búsqueda', async ({ page }) => {
    const guards = installPageGuards(page);
    await openCatalog(page, MOTO);
    await page.locator('[data-view="catalog"] [data-category-id="cervezas"]').first().click();
    await expect(page.locator('[data-catalog-scope]')).toHaveCount(0);

    await page.locator('[data-view="catalog"] [data-search-input]').fill('quilmes');
    const aviso = page.locator('[data-catalog-scope]');
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText('Cervezas');
    const boton = aviso.locator('[data-search-everywhere]');
    expect((await boton.boundingBox()).height).toBeGreaterThanOrEqual(44);

    await boton.click();
    await expect(page.locator('[data-catalog-scope]')).toHaveCount(0);
    await expect(page.locator('[data-view="catalog"] [data-search-input]')).toHaveValue('quilmes');
    await expect(page.locator(CARDS).first()).toBeVisible();
    await guards.assertClean();
  });

  test('en «Todas» no hay aviso de alcance', async ({ page }) => {
    await openCatalog(page, MOTO);
    await page.locator('[data-view="catalog"] [data-search-input]').fill('coca');
    await expect(page.locator(CARDS).first()).toBeVisible();
    await expect(page.locator('[data-catalog-scope]')).toHaveCount(0);
  });
});

test.describe('fotografía editorial y derechos', () => {
  test('en demostración la home muestra el hero con foto y los banners con su imagen', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await installBrowserStubs(page);
    await gotoDemoReset(page, VITRINA);
    await page.waitForSelector('[data-view="home"] .home-best-card');
    const hero = page.locator('.home-hero-promo').first();
    if (await hero.count()) {
      await expect(hero).not.toHaveClass(/is-text-only/);
      const fondo = await hero.locator('.home-hero-promo-media').evaluate((node) => getComputedStyle(node).backgroundImage);
      expect(fondo).toContain('assets/promos/cervezas-heineken-band');
    }
  });

  test('en producción (catálogo simulado) no se pide ni se pinta ninguna foto editorial', async ({ page }) => {
    await page.setViewportSize(PHONE);
    const pedidos = [];
    page.on('request', (request) => { if (/\/assets\/promos\//.test(request.url())) pedidos.push(request.url()); });
    await openRuntimeCatalog(page, { view: 'home', waitForCatalog: false });
    await page.waitForSelector('[data-view="home"] .home-best-card, [data-view="home"] article');

    const hero = page.locator('.home-hero-promo').first();
    await expect(hero).toBeVisible();
    await expect(hero).toHaveClass(/is-text-only/);
    await expect(hero.locator('.home-hero-promo-copy strong')).toBeVisible();
    // La puerta sigue siendo una puerta: lleva a una categoría real.
    expect(await hero.getAttribute('data-category-id')).toBeTruthy();

    const conFotoEditorial = await page.evaluate(() => [...document.querySelectorAll('[data-view="home"] *')]
      .filter((el) => /assets\/promos\//.test(getComputedStyle(el).backgroundImage) || /assets\/promos\//.test(el.getAttribute('style') || '')).length);
    expect(conFotoEditorial).toBe(0);
    expect(pedidos, 'ninguna petición a assets/promos/').toEqual([]);
  });
});

test.describe('historias del backend y derechos editoriales', () => {
  // Revisión de #154: el control de derechos cubría el hero y los banners, pero
  // una historia PUBLICADA por el backend se pintaba tal cual. Se simula el
  // origen productivo con historias que apuntan a assets/promos/ por cuatro
  // caminos (relativo, absoluto del mismo origen, otro host de La Taba y ../)
  // y una historia autorizada que no es fotografía editorial.
  test('en producción una historia con foto editorial sin derechos no se publica; la autorizada sí', async ({ page }) => {
    await page.setViewportSize(PHONE);
    const pedidos = [];
    page.on('request', (request) => { if (/\/assets\/promos\//i.test(request.url())) pedidos.push(request.url()); });
    await page.addInitScript(() => {
      const base = { published: true, media_type: 'image' };
      window.TABA2_STORIES = [
        { ...base, id: 'editorial-relativa', title: 'Heineken', media_url: 'assets/promos/story-cervezas-heineken.webp', thumbnail_url: 'assets/promos/story-cervezas-heineken-thumb.webp', is_highlight: true },
        { ...base, id: 'editorial-absoluta', title: 'Schweppes', media_url: `${location.origin}/assets/promos/story-mixers-schweppes.webp` },
        { ...base, id: 'editorial-otro-host', title: 'Monster', media_url: 'https://la-taba.pages.dev/assets/promos/story-energizantes-monster.webp' },
        { ...base, id: 'editorial-relativa-con-puntos', title: 'Jack', media_url: 'assets/products/../promos/story-whisky-jack-daniels.webp' },
        { ...base, id: 'autorizada', title: 'Abrimos hasta las 2', media_url: 'assets/brand/taba-app-icon-192.png', priority: -1 },
      ];
    });
    await openRuntimeCatalog(page, { view: 'home', waitForCatalog: false });
    await page.waitForSelector('[data-view="home"] .home-best-card, [data-view="home"] article');

    const ids = await page.evaluate(async () => (await import('/js/ui.js')).getHomeStories().map((story) => story.id));
    expect(ids).toEqual(['autorizada']);
    const slot = page.locator('[data-stories-slot]').first();
    await expect(slot).toHaveAttribute('data-stories-state', 'unseen');

    const conFotoEditorial = () => page.evaluate(() => [...document.querySelectorAll('*')].filter((el) => {
      const refs = `${getComputedStyle(el).backgroundImage} ${el.getAttribute('style') || ''} ${el.getAttribute('src') || ''} ${el.getAttribute('poster') || ''}`;
      return /assets\/promos\//i.test(refs);
    }).length);
    expect(await conFotoEditorial()).toBe(0);
    // El visor abre y sólo trae la historia autorizada.
    await page.evaluate(async () => (await import('/js/ui.js')).showStoriesModal());
    const visor = page.locator('[data-stories-modal]');
    await expect(visor.locator('.stories-media img')).toHaveAttribute('src', 'assets/brand/taba-app-icon-192.png');
    expect(await conFotoEditorial()).toBe(0);
    expect(pedidos, 'ninguna petición a assets/promos/').toEqual([]);
  });

  // Revisión final de v167: la miniatura de una historia se interpola en un style="…url('…')". Una
  // comilla en el valor cerraba el url() y dejaba escribir CSS propio: otro background-image editorial
  // (que el control de rutas no veía) o cualquier otra regla. Se simulan las dos formas.
  test('en producción una miniatura con comillas no inyecta CSS ni trae una foto editorial', async ({ page }) => {
    await page.setViewportSize(PHONE);
    const pedidos = [];
    page.on('request', (request) => { if (/\/assets\/promos\//i.test(request.url())) pedidos.push(request.url()); });
    await page.addInitScript(() => {
      const base = { published: true, media_type: 'image', media_url: 'assets/brand/taba-app-icon-192.png' };
      window.TABA2_STORIES = [
        { ...base, id: 'inyeccion-editorial', title: 'Trampa', thumbnail_url: "x');background-image:url('assets/promos/story-cervezas-heineken.webp" },
        { ...base, id: 'inyeccion-css', title: 'Capa', thumbnail_url: "assets/brand/taba-app-icon-192.png?x=');position:fixed;top:0;left:0;width:100vw;height:100vh;background:red;('" },
        { ...base, id: 'autorizada', title: 'Abrimos hasta las 2', priority: -1 },
      ];
    });
    await openRuntimeCatalog(page, { view: 'home', waitForCatalog: false });
    await page.waitForSelector('[data-view="home"] .home-best-card, [data-view="home"] article');

    const ids = await page.evaluate(async () => (await import('/js/ui.js')).getHomeStories().map((story) => story.id));
    // La que apunta a la foto editorial se descarta; la otra no es editorial y se publica,
    // pero su estilo ya no puede salirse de sus comillas.
    expect([...ids].sort()).toEqual(['autorizada', 'inyeccion-css']);

    const caras = await page.evaluate(() => [...document.querySelectorAll('.brand-story-face')].map((el) => ({
      declaraciones: el.style.length,
      posicion: getComputedStyle(el).position,
      estilo: el.getAttribute('style') || '',
    })));
    expect(caras.length).toBe(2);
    for (const cara of caras) {
      expect(cara.declaraciones, cara.estilo).toBe(1);
      expect(cara.posicion, cara.estilo).not.toBe('fixed');
      expect(cara.estilo).not.toMatch(/promos/i);
    }
    expect(pedidos, 'ninguna petición a assets/promos/').toEqual([]);
  });

  test('en demostración las historias editoriales se siguen viendo', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await installBrowserStubs(page);
    await gotoDemoReset(page, VITRINA);
    await page.waitForSelector('[data-view="home"] .home-best-card');
    const urls = await page.evaluate(async () => (await import('/js/ui.js')).getHomeStories().map((story) => story.mediaUrl));
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => /assets\/promos\//.test(url))).toBe(true);
  });
});

test.describe('vitrina sólo en demostración efectiva', () => {
  test('en producción ?demo=1&vitrina=neuquen20261024 no cambia el catálogo base ni las categorías', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openRuntimeCatalog(page, { view: 'home', waitForCatalog: false });
    await page.goto('/?demo=1&vitrina=neuquen20261024#catalog', { waitUntil: 'load' });
    const mundo = await page.evaluate(async () => {
      const [datos, aprobado, modo] = await Promise.all([
        import('/js/data.js'), import('/js/approved-beverage-demo-data.js'), import('/js/core/app-mode.js'),
      ]);
      return {
        modo: modo.getAppMode(),
        version: datos.PREVIEW_CATALOG_VERSION, versionAprobada: aprobado.PREVIEW_CATALOG_VERSION,
        categorias: datos.categories.map((c) => c.id), categoriasAprobadas: aprobado.categories.map((c) => c.id),
      };
    });
    expect(mundo.modo).toBe('production');
    expect(mundo.version).toBe(mundo.versionAprobada);
    expect(mundo.categorias).toEqual(mundo.categoriasAprobadas);
    // Los precios que se ven son los del catálogo productivo simulado, no los de la vitrina.
    await expect(page.locator(CARDS).first()).toBeVisible();
    const precios = await page.locator(`${CARDS} .price-amounts strong`).allTextContents();
    expect(precios.length).toBeGreaterThan(0);
    expect([...new Set(precios.map((p) => p.replace(/\s/g, '')))]).toEqual(['$2.500']);
  });

  test('en demostración la vitrina sigue activa con sus 52 SKU', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await installBrowserStubs(page);
    await gotoDemoReset(page, VITRINA);
    const total = await page.evaluate(async () => (await import('/js/data.js')).products.length);
    expect(total).toBe(52);
  });
});

test.describe('productos sin foto autorizada', () => {
  test('el placeholder es propio, legible y honesto, y el producto sigue comprándose', async ({ page }) => {
    await openCatalog(page, MOTO);
    const tarjeta = page.locator(`${CARDS}:has(.uses-placeholder)`).first();
    await tarjeta.scrollIntoViewIfNeeded();
    await expect(tarjeta.locator('.uses-placeholder')).toHaveAttribute('aria-label', /sin imagen oficial/i);
    const img = tarjeta.locator('img.thumb-img.is-placeholder');
    await expect(img).toHaveAttribute('src', /beverage-placeholder\.svg$/);
    await expect.poll(() => img.evaluate((node) => node.complete && node.naturalWidth > 0)).toBe(true);

    const svg = await (await page.request.get('/assets/products/beverage-placeholder.svg')).text();
    expect(svg).toContain('Foto próximamente');
    expect(svg).not.toMatch(/Imagen pendiente/);
    expect(svg.length).toBeLessThan(4096);
    await expect(tarjeta.locator('[data-add-product], .qty-stepper')).toBeVisible();
  });
});

test.describe('combo único en el teléfono', () => {
  test('un solo combo ocupa el ancho del renglón y no deja un hueco a la derecha', async ({ page }) => {
    await page.setViewportSize(MOTO);
    await installBrowserStubs(page);
    await gotoDemoReset(page, VITRINA);
    await page.waitForSelector('[data-view="home"] .home-best-card');
    const rail = page.locator('.home-combos-rail');
    await rail.first().scrollIntoViewIfNeeded();
    if ((await rail.first().locator('> .combo-card').count()) !== 1) test.skip(true, 'la vitrina declara más de un combo: la regla es del combo único');
    const r = await rail.first().boundingBox();
    const c = await rail.first().locator('> .combo-card').first().boundingBox();
    expect(c.width).toBeGreaterThanOrEqual(r.width - 4);
  });
});
