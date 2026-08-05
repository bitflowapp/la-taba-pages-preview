import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
  gotoDemoReset, installBrowserStubs, installPageGuards, measureStableControls,
} from './helpers.mjs';

test('la home presenta La Taba 2 con marca propia y un storefront comercial limpio', async ({ page }) => {
  const guards = installPageGuards(page);
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');

  await expect(page.locator('[data-demo-mode-banner]')).toHaveCount(0);
  await expect(page.locator('.topbar .brand-word')).toHaveText('La Taba 2');
  await expect(page.getByRole('heading', { name: 'La Taba 2', level: 1 })).toBeVisible();
  await expect(page.locator('[data-view="home"] .taba-home-search')).toBeVisible();
  // La fila la componen las categorías con producto comprable + "Todas".
  const homeCategories = page.locator('[data-view="home"] .home-category-card');
  await expect(homeCategories).toHaveCount(5);
  await expect(page.locator('[data-view="home"] [data-home-category-strip] [data-category-id="gaseosas"]')).toHaveText('Gaseosas');
  await expect(page.locator('[data-view="home"] [data-home-category-strip] [data-category-id="cervezas"]')).toHaveText('Cervezas');
  // La marca activa refleja el filtro REAL del catálogo, que arranca en "Todas".
  await expect(page.locator('[data-home-category-strip] [data-category-id="all"]')).toHaveClass(/active/);
  await expect(page.locator('[data-home-category-strip] [data-category-id="gaseosas"]')).not.toHaveClass(/active/);
  // Un rubro sin precio publicado no puede ser protagonista de la home.
  await expect(page.locator('[data-home-category-strip] [data-category-id="fernet"]')).toHaveCount(0);
  await expect(page.locator('[data-home-category-strip] [data-category-id="whisky"]')).toHaveCount(0);
  // Ninguna etiqueta técnica en la superficie del cliente.
  await expect(page.locator('.home-preview-label')).toHaveCount(0);
  await expect(page.locator('[data-view="home"]')).not.toContainText('PREVIEW INTERNA');

  // Sin una promoción aprobada, fechada y verificable no se muestra ningún
  // descuento ni precio anterior en la superficie cliente.
  const promoBanner = page.locator('[data-view="home"] [data-promo-banner]');
  await expect(promoBanner).toBeHidden();
  await expect(page.locator('[aria-labelledby="home-promotions-title"]')).toBeHidden();
  await expect(page.locator('[data-home-promotions] .home-promo-card')).toHaveCount(0);
  // Copy honesto: "Destacados" es una selección del local, no una métrica.
  await expect(page.getByRole('heading', { name: 'Destacados' })).toBeVisible();
  await expect(page.locator('[data-view="home"]')).not.toContainText('Los más vendidos');
  // La home se compone de carruseles por sección de bebidas. El contrato ya no
  // es un número fijo de tarjetas sino QUÉ puede aparecer: la home es la
  // superficie de compra, así que todo lo que muestra tiene que ser comprable.
  // Un precio pendiente sigue vivo en catálogo y en la búsqueda, pero no acá.
  const homeSectionCards = page.locator('[data-home-sections] .home-best-card');
  await expect(homeSectionCards.first()).toBeVisible();
  expect(await homeSectionCards.count()).toBeGreaterThan(0);
  await expect(page.locator('[data-home-sections] [data-add-product][disabled]')).toHaveCount(0);
  await expect(page.locator('[data-home-sections] .is-price-pending')).toHaveCount(0);
  await expect(page.locator('[data-home-sections]')).not.toContainText('Precio pendiente');
  // Ninguna sección se renderiza vacía ni sin título: no quedan huecos.
  const homeSections = page.locator('[data-home-sections] .home-category-section');
  const homeSectionCount = await homeSections.count();
  expect(homeSectionCount).toBeGreaterThan(0);
  for (let index = 0; index < homeSectionCount; index += 1) {
    const section = homeSections.nth(index);
    await expect(section.locator('h2')).not.toBeEmpty();
    expect(await section.locator('.home-best-card').count()).toBeGreaterThan(0);
  }

  await expect(page.locator('[data-view="home"] .role-intro')).toHaveCount(0);
  await expect(page.locator('[data-view="home"] .product-intro')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('La Taba Pizzería');
  for (const forbidden of [
    'TABA Bebidas · QA',
    'Catálogo técnico no comercial',
    'Presentación comercial',
    'Fixture técnico QA',
    'Sin valor comercial',
    'No publicar',
  ]) {
    await expect(page.locator('[data-view="home"]')).not.toContainText(forbidden);
  }
  await gotoDemoReset(page, '/?reset=1&demo=1#catalog');
  const catalogCategories = page.locator(
    '[data-view="catalog"] [data-category-strip] .category-button:not([data-category-id="all"]):not([data-category-id="favorites"])',
  );
  await expect(catalogCategories).toHaveCount(15);
  await expect(page.locator('[data-view="catalog"] [data-category-id="gaseosas"]')).toHaveText('Gaseosas');
  await expect(page.locator('[data-view="catalog"] [data-category-id="cervezas"]')).toHaveText('Cervezas');
  await expect(page.locator('[data-product-grid] .product-card').first()).not.toContainText('QA');
  const activeCatalogText = await page.locator('[data-product-grid]').innerText();
  expect(activeCatalogText).not.toMatch(/\b(?:pizza|muzzarella|fugazzeta|calabresa|pepperoni|combo-pizza)\b/i);
  await guards.assertClean();
});

for (const viewport of [
  { name: '320', width: 320, height: 700 },
  { name: '390', width: 390, height: 844 },
]) {
  test(`home acotada por secciones en ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installBrowserStubs(page);
    await gotoDemoReset(page, '/?reset=1&demo=1');
    // La home dejó de ser una grilla de vista previa y pasó a ser una vidriera
    // de carruseles por sección: crece con el catálogo, así que lo que se acota
    // es la cantidad de secciones (HOME_MAX_SECTIONS), no un alto fijo. El
    // techo queda como backstop de crecimiento descontrolado.
    const geometry = await page.evaluate(() => ({
      height: Math.ceil(document.querySelector('[data-view="home"]').getBoundingClientRect().height),
      sections: document.querySelectorAll('[data-home-sections] .home-category-section').length,
    }));
    expect(geometry.sections).toBeGreaterThan(0);
    expect(geometry.sections).toBeLessThanOrEqual(6);
    // 3700 y no 2800: la composición cerrada suma el hero promocional (270px) y
    // el tramo de "Selección del local" (≈370px). Medido da 3539–3559 en los
    // anchos de teléfono, así que el techo deja holgura para el copy y sigue
    // rompiéndose con un tramo de más, que es lo que tiene que detectar.
    expect(geometry.height).toBeLessThan(3700);
    await expect(page.locator('.topbar .brand-word')).toHaveText('La Taba 2');
    await expect(page.locator('.topbar .brand-text small')).toBeHidden();
    await expect(page.locator('.topbar-actions .cart-button')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  });
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]) {
  test(`home final de bebidas mantiene layout físico en ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installBrowserStubs(page);
    await gotoDemoReset(page, '/?reset=1&demo=1&home=v37');
    await expect(page.locator('[data-view="home"]')).toBeVisible();
    await expect(page.locator('.mobile-nav [data-nav-view="home"]')).toHaveClass(/active/);
    await expect(page.locator('[aria-labelledby="home-promotions-title"]')).toBeHidden();

    const geometry = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      homeRight: document.querySelector('[data-view="home"]')?.getBoundingClientRect().right || 0,
      navBottom: document.querySelector('.mobile-nav')?.getBoundingClientRect().bottom || 0,
      navHeight: Math.round(document.querySelector('.mobile-nav')?.getBoundingClientRect().height || 0),
      navBlockToken: Math.round(Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--nav-h'),
      ) + Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--safe-area-bottom') || '0',
      )),
      innerHeight: window.innerHeight,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.homeRight).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    // La navegación es una barra a sangre con hairline, no una píldora
    // flotante: llega al borde inferior y su alto sale del token del stack.
    expect(geometry.innerHeight - geometry.navBottom).toBe(0);
    expect(geometry.navHeight).toBe(geometry.navBlockToken);

    const productImages = page.locator('[data-view="home"] .thumb-img');
    await expect(productImages.first()).toBeVisible();
    await productImages.last().scrollIntoViewIfNeeded();

    // La home pasó de ~7 imágenes a las de todos los carruseles, y cada una es
    // `loading="lazy"`. Exigir que TODAS estén resueltas describía la home vieja:
    // Chromium precarga agresivamente y pasaba, Firefox y WebKit dejan las de
    // fuera de pantalla sin resolver y fallaban. Eso es lazy loading haciendo su
    // trabajo, no un asset roto.
    //
    // La garantía que importa se mantiene entera y en dos partes:
    // 1) ninguna imagen rota en toda la home — si el navegador terminó de
    //    resolverla, tiene que tener bitmap;
    // 2) las que el cliente ve al entrar sí están cargadas de verdad.
    expect(await productImages.evaluateAll((images) => images.every((image) => (
      !image.complete || (image.naturalWidth > 0 && image.naturalHeight > 0)
    )))).toBeTruthy();

    // "Lo que ve el cliente al entrar" son las tarjetas EFECTIVAMENTE dentro del
    // pantallazo. El rail de Destacados pasó de tres tarjetas —todas visibles— a
    // ocho, así que exigir las ocho resueltas describía la composición vieja y
    // volvía a castigar al lazy loading por hacer su trabajo: en un carrusel
    // horizontal las de la derecha están fuera de pantalla a propósito.
    // La garantía que importa no se toca: lo que entra en el primer pantallazo
    // tiene bitmap de verdad, y el `every` de más arriba sigue prohibiendo una
    // imagen rota en TODA la home.
    // El paso anterior bajó hasta la última imagen de la home; "lo que ve el
    // cliente al entrar" se mide desde arriba.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    const aboveTheFold = page.locator('[data-home-best-sellers] .thumb-img');
    await expect(aboveTheFold.first()).toBeVisible();
    await expect.poll(() => aboveTheFold.evaluateAll((images) => {
      const visibles = images.filter((image) => {
        const rect = image.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0
          && rect.left < window.innerWidth && rect.right > 0
          && rect.top < window.innerHeight && rect.bottom > 0;
      });
      return visibles.length > 0 && visibles.every((image) => (
        image.complete && image.naturalWidth > 0 && image.naturalHeight > 0
      ));
    })).toBeTruthy();

    const captureDir = process.env.TABA_HOME_CAPTURE_DIR;
    if (captureDir) {
      fs.mkdirSync(captureDir, { recursive: true });
      await page.screenshot({
        path: path.join(captureDir, `home-final-${viewport.width}x${viewport.height}.png`),
      });
    }

    const finalCard = page.locator('[data-home-sections] .home-best-card').last();
    await finalCard.scrollIntoViewIfNeeded();
    const [finalCardBox, navBox] = await Promise.all([
      finalCard.boundingBox(),
      page.locator('.mobile-nav').boundingBox(),
    ]);
    expect(finalCardBox).not.toBeNull();
    expect(navBox).not.toBeNull();
    expect(finalCardBox.y + finalCardBox.height).toBeLessThanOrEqual(navBox.y + 1);
  });
}

test('confirmación de edad aparece y es obligatoria sólo con alcohol', async ({ page }) => {
  await installBrowserStubs(page);

  await gotoDemoReset(page, '/?reset=1&demo=1#catalog');
  await page.locator('[data-view="catalog"] [data-category-id="gaseosas"]').click();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('.desktop-nav [data-nav-view="cart"]').click();
  await expect(page.locator('[data-age-confirmation]')).toBeHidden();
  await expect(page.locator('[name="ageConfirmed"]')).not.toHaveAttribute('required');

  await gotoDemoReset(page, '/?reset=1&demo=1#catalog');
  await page.locator('[data-view="catalog"] [data-category-id="cervezas"]').click();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('.desktop-nav [data-nav-view="cart"]').click();
  await expect(page.locator('[data-age-confirmation]')).toBeVisible();
  await expect(page.locator('[name="ageConfirmed"]')).toHaveAttribute('required', '');
});

test('el detalle comparte el control rápido de cantidad del carrito', async ({ page }) => {
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1#catalog');
  await page.locator('[data-view="catalog"] [data-category-id="cervezas"]').click();

  const card = page.locator('[data-product-grid] .product-card').first();
  await card.locator('[data-product-detail]').click();
  const modal = page.locator('[data-product-modal]');
  await expect(modal.locator('.modal-cart-control[data-add-product]')).toBeVisible();

  await modal.locator('.modal-cart-control[data-add-product]').click();
  await expect(modal).toBeHidden();
  await card.locator('[data-product-detail]').click();
  await expect(modal.locator('.modal-cart-control [data-cart-dec] svg')).toBeVisible();
  await expect(modal.locator('.modal-cart-control strong')).toHaveText('1');

  await modal.locator('.modal-cart-control [data-cart-inc]').click();
  await expect(modal.locator('.modal-cart-control strong')).toHaveText('2');
  await page.waitForTimeout(140);
  await modal.locator('.modal-cart-control [data-cart-dec]').click();
  await expect(modal.locator('.modal-cart-control strong')).toHaveText('1');
  await page.waitForTimeout(140);
  await modal.locator('.modal-cart-control [data-cart-dec]').click();
  await expect(modal.locator('.modal-cart-control[data-add-product]')).toBeVisible();
});

test('Los filtros conservan el catálogo real y no fabrican promociones', async ({ page }) => {
  const guards = installPageGuards(page);
  await installBrowserStubs(page);
  await page.goto('/?demo=1&home=v37');

  await page.locator('[data-home-category-strip] [data-category-id="gaseosas"]').click();
  await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  await expect(page.locator('[data-catalog-title]')).toHaveText('Gaseosas');
  await expect(page.locator('[data-product-grid] [data-add-product]')).not.toHaveCount(0);

  await page.goBack();
  await expect(page.locator('[data-view="home"]')).toBeVisible();

  await expect(page.locator('[data-home-promotions] [data-add-product]')).toHaveCount(0);
  await expect(page.locator('[data-view="catalog"] [data-category-id="promos"]')).toHaveCount(0);
  await guards.assertClean();
});

test('controles táctiles de la Home alcanzan 44 por 44 y el carrusel sincroniza indicadores', async ({ page }) => {
  await installBrowserStubs(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?demo=1&home=v37');

  const controlSelector = [
    '.home-merch-section:not([hidden]) .home-section-head button',
    '[data-home-promotions] .home-add-button',
    '[data-home-best-sellers] .home-add-button',
    '[data-home-sections] .home-add-button',
    '[data-home-sections] .home-favorite-button',
  ].join(', ');
  for (const viewport of [
    { width: 320, height: 812 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
  ]) {
    await page.setViewportSize(viewport);
    // Consulta y medición en el mismo turno de JS: la home reemplaza su subárbol
    // al recomponer los carruseles, y medir en dos viajes distintos dejaba leer
    // nodos ya desconectados como si midieran 0x0. Ver measureStableControls.
    const measured = await measureStableControls(page, controlSelector);
    // El conteo exacto describía la composición vieja (una grilla de 4 tarjetas).
    // Con carruseles por sección la cantidad depende del catálogo, así que el
    // contrato pasa a ser el que importa y no se relaja: TODO control táctil de
    // la home mide 44x44, sea cual sea el número. Se exige un piso para que un
    // render vacío no haga pasar la prueba por ausencia de controles.
    expect(measured.controls.length, `${viewport.width}x${viewport.height}`).toBeGreaterThanOrEqual(12);
    // Un control medido fuera del documento no describe la home que ve el
    // cliente: si aparece, la medición no vale y el test tiene que decirlo.
    expect(
      measured.controls.filter(({ connected }) => !connected),
      `${viewport.width}x${viewport.height} controles desconectados`,
    ).toEqual([]);
    const undersized = measured.controls
      .filter(({ width, height }) => width < 44 || height < 44)
      .map(({ selector, width, height }) => ({ selector, width, height }));
    expect(undersized, `${viewport.width}x${viewport.height}`).toEqual([]);
    expect(measured.scrollWidth).toBeLessThanOrEqual(measured.innerWidth + 1);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const dots = page.locator('[data-home-paging-dots] span');
  await expect(dots).toHaveCount(1);
  await expect(dots.first()).toHaveClass(/is-active/);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('[data-home-paging-dots]')).toBeHidden();
});

test('la imagen de un producto real se reutiliza en Home, catálogo, modal y carrito', async ({ page }) => {
  await installBrowserStubs(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?demo=1&home=v37');
  const homeCard = page.locator('[data-home-sections] .home-best-card').first();
  const productId = await homeCard.locator('[data-product-detail]').getAttribute('data-product-detail');
  const source = await homeCard.locator('img').getAttribute('src');
  expect(productId).toBeTruthy();
  expect(source).toBeTruthy();

  await homeCard.locator('[data-product-detail]').click();
  await expect(page.locator(`dialog[open] [data-modal-product-id="${productId}"] img`)).toHaveAttribute('src', source);
  await page.locator('dialog[open] .modal-close').click();

  await homeCard.locator('[data-add-product]').click();
  await page.locator('[data-open-cart]').first().click();
  await expect(page.locator(`[data-view="cart"] img[src="${source}"]`)).toBeVisible();

  await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  await expect(page.locator(`[data-product-grid] [data-product-detail="${productId}"] img`)).toHaveAttribute('src', source);
});

test('la card de la home declara el pack cuando el precio es del pack completo', async ({ page }) => {
  await installBrowserStubs(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?demo=1&home=v37');

  // El precio que la card muestra al lado es el del pack entero. Si la línea de
  // unidad dice sólo la capacidad de una botella, la home afirma un precio
  // unitario inexistente. Este contrato se ancla en el catálogo, que ya declara
  // el pack, y exige que la home diga lo mismo.
  const packCard = page.locator('[data-home-sections] .home-best-card', {
    has: page.locator('[data-product-detail*="pack"]'),
  }).first();
  await expect(packCard).toBeVisible();

  const productId = await packCard.locator('[data-product-detail]').getAttribute('data-product-detail');
  const perPack = Number(/pack-(\d+)$/.exec(productId || '')?.[1]);
  expect(perPack, `${productId} debe declarar unidades por pack`).toBeGreaterThan(1);

  await expect(packCard.locator('.home-best-copy small')).toHaveText(new RegExp(`Pack x${perPack}\\b`));

  // La honestidad no puede costar el layout: la home sigue sin overflow.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
});

test('la CTA móvil compacta reserva espacio real sobre la navegación', async ({ page }) => {
  await installBrowserStubs(page);

  for (const viewport of [
    { width: 320, height: 812 },
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
  ]) {
    await page.setViewportSize(viewport);
    await gotoDemoReset(page, '/?reset=1&demo=1#catalog');
    await page.locator('[data-view="catalog"] [data-category-id="gaseosas"]').click();

    const main = page.locator('main[data-app-main]');
    const emptyPadding = await main.evaluate((node) => parseFloat(getComputedStyle(node).paddingBottom));
    await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();

    const floatingCart = page.locator('[data-floating-cart]');
    const mobileNav = page.locator('.mobile-nav');
    await expect(floatingCart).toBeVisible();
    await expect(floatingCart.locator('[data-floating-cart-label]')).toHaveText('Ver carrito');
    await expect(floatingCart.locator('[data-floating-cart-count]')).toHaveText('1 producto');
    await expect(floatingCart.locator('[data-floating-cart-summary]')).toContainText(/^\$/);
    await expect(mobileNav).toBeVisible();

    const [floatingBox, navBox, visiblePadding] = await Promise.all([
      floatingCart.boundingBox(),
      mobileNav.boundingBox(),
      main.evaluate((node) => parseFloat(getComputedStyle(node).paddingBottom)),
    ]);
    expect(floatingBox).not.toBeNull();
    expect(navBox).not.toBeNull();
    expect(floatingBox.height, `${viewport.width}px tactile height`).toBeGreaterThanOrEqual(44);
    expect(floatingBox.height, `${viewport.width}px compact height`).toBeLessThanOrEqual(54);
    expect(navBox.y - (floatingBox.y + floatingBox.height), `${viewport.width}px visual separation`).toBeGreaterThanOrEqual(10);
    expect(visiblePadding, `${viewport.width}px dynamic reserve`).toBeGreaterThan(emptyPadding);
    expect(visiblePadding, `${viewport.width}px reserve behind both bars`).toBeGreaterThanOrEqual(
      navBox.height + floatingBox.height + 8,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();

    const lastCard = page.locator('[data-product-grid] .product-card').last();
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await page.waitForFunction(() => (
      window.scrollY >= document.documentElement.scrollHeight - window.innerHeight - 1
    ));
    await expect(lastCard).toBeInViewport();
    const lastCardBox = await lastCard.boundingBox();
    expect(lastCardBox).not.toBeNull();
    expect(lastCardBox.y + lastCardBox.height, `${viewport.width}px content clear of the CTA`).toBeLessThanOrEqual(
      floatingBox.y - 8,
    );
  }
});
