/*
 * El catálogo con las 46 fichas reales, mirado como lo mira un cliente.
 *
 * Cada prueba de este archivo es un defecto que se vio en pantalla el
 * 2026-09-30 y que ninguna prueba existente detectaba: la góndola en orden
 * alfabético, nombres cortados, un control invisible, una búsqueda que no
 * perdonaba un error de tipeo, un adorno que tartamudeaba el scroll y un
 * teléfono bajando la foto grande de cada tarjeta.
 */
import { expect, test } from '@playwright/test';
import { GRID, openRuntimeCatalog, instrumentCatalog, readProbe, clickCatalogCategory } from './catalog-runtime-fixture.mjs';

test.use({ viewport: { width: 390, height: 844 } });

const goHome = async (page) => {
  await page.locator('[data-nav-view="home"]:visible').first().click();
  await expect(page.locator('[data-view="home"] .home-best-card').first()).toBeVisible();
};

test('«Todas» se lee por rubro, en el mismo orden que los chips, no por alfabeto', async ({ page }) => {
  await openRuntimeCatalog(page);
  const titles = await page.locator(`${GRID} .product-card h3`).allTextContents();
  expect(titles.slice(0, 4)).toEqual(['Coca-Cola', 'Coca-Cola Sin Azúcar', 'Fanta Naranja', 'Pepsi Black']);
  // Cada rubro aparece junto: el orden de los rubros de la grilla es el de la tira de chips.
  const chips = await page.locator('[data-view="catalog"] [data-category-strip] [data-category-id]')
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.categoryId).filter((id) => !['all', 'favorites'].includes(id)));
  const groups = await page.evaluate(async (selector) => {
    const { getState } = await import('/js/state.js');
    const byId = new Map(getState().products.map((product) => [product.id, product.categoryId]));
    const order = [];
    for (const node of document.querySelectorAll(`${selector} .product-card [data-product-detail]`)) {
      const category = byId.get(node.dataset.productDetail);
      if (order[order.length - 1] !== category) order.push(category);
    }
    return order;
  }, GRID);
  expect(new Set(groups).size, 'un rubro aparece partido en dos tramos').toBe(groups.length);
  expect(groups).toEqual(chips.filter((id) => groups.includes(id)));
  // «Menor precio» sigue ordenando por precio, sin agrupar.
  await page.locator('[data-sort-select]').selectOption('price_asc');
  const prices = await page.locator(`${GRID} .product-card .price strong`)
    .evaluateAll((nodes) => nodes.map((node) => Number(node.textContent.replace(/\D/g, ''))));
  expect(prices).toEqual([...prices].sort((a, b) => a - b));
});

test('la vidriera demo conserva su orden curado: lo primero que se puede agregar no es alcohol', async ({ page }) => {
  // REGRESIÓN (CI 36817855269, 2026-10-01). El agrupado por rubro de «Todas»
  // reordenaba también este catálogo, que ya viene curado y abre con
  // energizantes: le subió siete cervezas al principio. Los recorridos de compra
  // agregan «el primer producto», se llevaron una cerveza y el pedido pidió
  // mayoría de edad. Agrupar por rubro es el respaldo del catálogo real sin
  // ordenar, no una regla de la grilla.
  await page.goto('/?demo=1#catalog');
  const firstAdd = page.locator('[data-view="catalog"] [data-product-grid] [data-add-product]:not([disabled])').first();
  await expect(firstAdd).toBeVisible();
  const report = await page.evaluate(async () => {
    const { getState } = await import('/js/state.js');
    const products = getState().products;
    const delivered = new Map(products.map((product, index) => [product.id, index]));
    const byId = new Map(products.map((product) => [product.id, product]));
    const buyable = [...document.querySelectorAll('[data-view="catalog"] [data-product-grid] [data-add-product]:not([disabled])')]
      .map((node) => node.dataset.addProduct);
    const first = byId.get(buyable[0]);
    return {
      first: first ? { name: first.name, alcoholic: Boolean(first.alcoholic), category: first.categoryId } : null,
      // Rubros de lo comprable, en el orden en que aparecen.
      categories: buyable.map((id) => byId.get(id)?.categoryId).filter((id, index, all) => id !== all[index - 1]),
      // Entre productos del MISMO rubro la grilla no tiene ningún motivo para
      // invertir el orden en que llegaron.
      keptDeliveredOrder: buyable.every((id, index) => index === 0
        || byId.get(id)?.categoryId !== byId.get(buyable[index - 1])?.categoryId
        || delivered.get(id) > delivered.get(buyable[index - 1])),
    };
  });
  expect(report.first, 'la demo no tiene nada para agregar').not.toBeNull();
  expect(report.first.alcoholic, `lo primero que se puede agregar es «${report.first.name}»`).toBe(false);
  expect(report.categories.indexOf('energizantes'), 'los energizantes abren la vidriera demo')
    .toBeLessThan(report.categories.indexOf('cervezas'));
  expect(report.keptDeliveredOrder).toBe(true);
});

test('ningún nombre se corta en la grilla, a 360 y a 390 de ancho', async ({ page }) => {
  await openRuntimeCatalog(page);
  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(200);
    const report = await page.locator(`${GRID} .product-card`).evaluateAll((cards) => ({
      clipped: cards.map((card) => card.querySelector('h3')).filter((title) => title.scrollHeight > title.clientHeight + 1).map((title) => title.textContent),
      brandLines: cards.filter((card) => card.querySelector('.product-brand')).length,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    }));
    expect(report.clipped, `${width}px: nombres cortados`).toEqual([]);
    expect(report.brandLines, 'un renglón de marca repite lo que el título ya dice').toBe(0);
    expect(report.overflow).toBe(false);
  }
  const brahma = page.locator(`${GRID} .product-card`).filter({ hasText: 'Brahma Chopp Rubia' });
  await expect(brahma).toContainText('1 L · Retornable');
});

test('el título del rubro no pierde el pie de sus letras', async ({ page }) => {
  await openRuntimeCatalog(page);
  // «Jugos» tiene dos letras que bajan del renglón. El título recorta para poder
  // poner una elipsis, y con interlineado 1 se comía ese pie.
  await clickCatalogCategory(page, 'jugos');
  const title = page.locator('[data-catalog-title]');
  await expect(title).toHaveText('Jugos');
  const box = await title.evaluate((node) => ({ visible: node.clientHeight, needed: node.scrollHeight, row: node.parentElement.getBoundingClientRect().height }));
  expect(box.needed, 'el título se recorta por abajo').toBeLessThanOrEqual(box.visible);
  await clickCatalogCategory(page, 'all');
  const rowAll = await title.evaluate((node) => node.parentElement.getBoundingClientRect().height);
  expect(rowAll, 'darle lugar al descendente cambió el alto de la fila').toBe(box.row);
});

test('el corazón de favoritos se ve, guardado y sin guardar', async ({ page }) => {
  await openRuntimeCatalog(page);
  const favorite = page.locator(`${GRID} .product-card`).first().locator('[data-favorite-toggle]');
  const contrast = () => favorite.evaluate((node) => {
    const channel = (value) => { const s = value / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    const luminance = (color) => { const [r, g, b] = color.match(/[\d.]+/g).map(Number); return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b); };
    const icon = luminance(getComputedStyle(node.querySelector('path')).stroke);
    const disc = luminance(getComputedStyle(node, '::before').backgroundColor);
    return (Math.max(icon, disc) + 0.05) / (Math.min(icon, disc) + 0.05);
  });
  expect(await contrast(), 'el corazón sin guardar no se distingue del disco').toBeGreaterThanOrEqual(3);
  await favorite.click();
  await expect(favorite).toHaveAttribute('aria-pressed', 'true');
  expect(await contrast(), 'el corazón guardado no se distingue del disco').toBeGreaterThanOrEqual(3);
});

test('la búsqueda perdona el tipeo y lo dice; lo que no se vende sigue sin aparecer', async ({ page }) => {
  await openRuntimeCatalog(page);
  await instrumentCatalog(page);
  const search = page.locator('[data-view="catalog"] [data-search-input]');
  const note = page.locator(`${GRID} [data-catalog-similar]`);
  const cards = page.locator(`${GRID} .product-card`);

  await search.fill('heiniken');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('Heineken Lager');
  await expect(note).toContainText('No encontramos «heiniken»');
  await expect(note).toContainText('Esto es lo más parecido');

  // Una búsqueda exacta no lleva aviso.
  await search.fill('heineken');
  await expect(cards).toHaveCount(1);
  await expect(note).toHaveCount(0);

  for (const [query, count] of [['cocacola', 2], ['1 litro', 3], ['vino tinto', 4], ['710 cc', 3]]) {
    await search.fill(query);
    await expect(cards, `«${query}»`).toHaveCount(count);
    await expect(note).toHaveCount(0);
  }

  // Tolerar errores no es inventar surtido.
  await search.fill('vodka');
  await expect(cards).toHaveCount(0);
  await expect(page.locator(`${GRID} .empty-state`)).toContainText('No encontramos «vodka»');
  await expect(note).toHaveCount(0);
  await page.locator(`${GRID} [data-clear-search]`).click();
  await expect(cards).toHaveCount(46);

  const metrics = await readProbe(page);
  expect(metrics.cardReplacements, 'buscar reemplazó tarjetas').toBe(0);
  expect(metrics.imageReplacements).toBe(0);
});

test('en la vidriera la presentación se ve siempre, y un nombre largo usa sus dos renglones sin cambiar el alto', async ({ page }) => {
  /*
   * Lo que se afirma acá vale con CUALQUIER tipografía de sistema. La primera
   * versión de esta prueba pedía que todo nombre largo entrara entero, y eso
   * depende del ancho de la fuente: en Windows pasaba y en el Chromium de Linux
   * del CI «Glaciar Con Gas Baja en Sodio» no entraba (corrida 36817855269). Peor:
   * lo que se perdía en ese caso era la presentación. Ahora la garantía es la
   * inversa —la presentación siempre, el nombre hasta donde entre— y es la que
   * se prueba.
   */
  await page.setViewportSize({ width: 360, height: 800 });
  await openRuntimeCatalog(page);
  await goHome(page);
  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForTimeout(200);
    const cards = await page.locator('[data-view="home"] .home-best-card').evaluateAll((nodes) => nodes.map((card) => {
      const copy = card.querySelector('.home-best-copy');
      const strong = copy.querySelector('strong');
      const small = copy.querySelector('small');
      const block = card.querySelector('.home-best-name');
      const box = (block || copy).getBoundingClientRect();
      const rectsOf = (node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return [...range.getClientRects()].filter((rect) => rect.width > 0);
      };
      // El renglón EMPIEZA dentro de la caja. Se mira el comienzo y no el final:
      // la caja de una línea en línea es más alta que su renglón, y cuánto más
      // depende del motor.
      const starts = (rect) => rect.top >= box.top - 4 && rect.top < box.bottom - 6;
      const nameRects = rectsOf(strong);
      const unitRects = small ? rectsOf(small) : [];
      return {
        title: strong.textContent,
        unit: small ? small.textContent : '',
        flow: Boolean(block),
        truncated: block ? false : strong.scrollWidth > strong.clientWidth + 1,
        nameLines: new Set(nameRects.filter(starts).map((rect) => Math.round(rect.top))).size,
        nameWhole: nameRects.every(starts),
        firstLineVisible: nameRects.length > 0 && starts(nameRects[0]),
        unitVisible: unitRects.length > 0
          && unitRects.every((rect) => starts(rect) && rect.left >= box.left - 1.5 && rect.right <= box.right + 1.5),
        blockHeight: block ? Math.round(block.getBoundingClientRect().height * 10) / 10 : null,
        rail: [...document.querySelectorAll('.offers-rail')].indexOf(card.parentElement),
        height: Math.round(card.getBoundingClientRect().height),
        copyHeight: Math.round(copy.getBoundingClientRect().height),
      };
    }));
    const flow = cards.filter((card) => card.flow);
    expect(flow.length, `${width}px: ningún nombre largo en la vidriera`).toBeGreaterThan(5);
    // 1. La presentación: en TODAS las tarjetas, entera adentro de su caja.
    expect(cards.filter((card) => card.unit && !card.unitVisible).map((card) => `${card.title} · ${card.unit}`),
      `${width}px: presentaciones que no se ven`).toEqual([]);
    // 2. El nombre largo: el primer renglón siempre, y nunca más de dos.
    expect(flow.filter((card) => !card.firstLineVisible).map((card) => card.title), `${width}px: nombres sin primer renglón`).toEqual([]);
    expect(flow.filter((card) => card.nameLines > 2).map((card) => card.title)).toEqual([]);
    // 3. El alto no cambia: 33,6 px, lo mismo que nombre + presentación.
    expect([...new Set(flow.map((card) => card.blockHeight))], `${width}px: el bloque del nombre largo cambió de alto`).toEqual([33.6]);
    // 4. El caso que motivó todo: «Coca-Cola Sin Azúcar» se lee entero, en dos
    //    renglones, con su «2,25 L», y la tarjeta mide lo mismo que su vecina.
    const coke = cards.find((card) => card.title === 'Coca-Cola Sin Azúcar');
    expect(coke, 'no está la tarjeta de Coca-Cola Sin Azúcar').toBeTruthy();
    expect(coke.flow).toBe(true);
    expect(coke.nameLines).toBe(2);
    expect(coke.nameWhole, '«Coca-Cola Sin Azúcar» no entró en sus dos renglones').toBe(true);
    expect(coke.unit).toBe('2,25 L');
    const neighbour = cards.find((card) => card.rail === coke.rail && !card.flow);
    expect(coke.height).toBe(neighbour.height);
    expect(coke.copyHeight).toBe(neighbour.copyHeight);
    // 5. El envase retornable se dice aunque el nombre sea largo: a 360 px era
    //    justo lo que se perdía.
    const brahma = cards.find((card) => card.title === 'Brahma Chopp Rubia');
    expect(brahma, 'no está la tarjeta de Brahma').toBeTruthy();
    expect(brahma.unit).toBe('1 L · Retornable');
    expect(brahma.unitVisible).toBe(true);
    // Los nombres cortos siguen como estaban: un renglón, sin puntos suspensivos.
    expect(cards.filter((card) => card.truncated).map((card) => card.title), `${width}px: nombres cortos cortados`).toEqual([]);
  }

  // Y el primer «Agregar» sigue sobre la barra inferior con los datos reales.
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(200);
  const fold = await page.evaluate(() => {
    const nav = document.querySelector('.mobile-nav');
    const add = document.querySelector('[data-view="home"] [data-add-product]');
    return { useful: window.innerHeight - nav.getBoundingClientRect().height, add: add.getBoundingClientRect().bottom + window.scrollY };
  });
  expect(fold.add).toBeLessThanOrEqual(fold.useful);
});

test('el brillo no escribe mientras la página se mueve: una sola escritura, al asentarse', async ({ page, browserName }) => {
  /*
   * Sólo en Chromium. El WebKit de Playwright para Windows, sin pantalla real,
   * entrega unos dos cuadros por segundo: ahí no existe un «scroll continuo»
   * que medir, y entre dos cuadros la página está quieta más de lo que el
   * módulo espera para darla por asentada. El comportamiento en WebKit lo
   * cubre `catalog-card-glow.spec.mjs`, que no depende del ritmo de cuadros.
   */
  test.skip(browserName === 'webkit', 'WebKit para Windows no entrega cuadros continuos sin pantalla');
  await openRuntimeCatalog(page);
  await page.waitForFunction(() => window.TABA2_MOTION.getDiagnostics().glowSettling === false);
  const during = await page.evaluate(async () => {
    const shelf = document.querySelector('[data-view="catalog"] [data-glow-shelf]');
    let writes = 0;
    let bodyWrites = 0;
    let frames = 0;
    const observer = new MutationObserver((records) => { writes += records.length; });
    observer.observe(shelf, { attributes: true, attributeFilter: ['style'] });
    const body = new MutationObserver((records) => { bodyWrites += records.length; });
    body.observe(document.body, { attributes: true, attributeFilter: ['data-motion-scrolled'] });
    // Un recorrido continuo de un segundo y medio, cuadro por cuadro.
    const max = Math.min(document.documentElement.scrollHeight - innerHeight, innerHeight * 3);
    const start = performance.now();
    await new Promise((resolve) => {
      const step = () => {
        frames += 1;
        const t = Math.min(1, (performance.now() - start) / 1500);
        scrollTo(0, max * t);
        if (t < 1) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
    const whileMoving = { shelf: writes, body: bodyWrites, frames };
    window.__glowWrites = () => writes;
    return whileMoving;
  });
  /*
   * Antes: una escritura por cada paso de la curva, hasta 25 en este recorrido,
   * cada una recalculando el estilo de las 46 tarjetas. Ahora el scroll no
   * escribe el brillo. El margen de una escritura cubre a una máquina que se
   * atraganta más de 140 ms entre dos cuadros: para el módulo eso ES un scroll
   * asentado, y aplicar ahí es lo correcto.
   */
  expect(during.frames, 'el recorrido no llegó a moverse cuadro por cuadro').toBeGreaterThan(8);
  expect(during.shelf, 'el brillo se escribió en cada paso del scroll').toBeLessThanOrEqual(1);
  // `data-motion-scrolled` cambia UNA vez —de arriba a scrolleado—, no en cada cuadro.
  expect(during.body, 'el atributo de scroll se reescribió en cada cuadro').toBeLessThanOrEqual(1);
  await page.waitForFunction(() => window.TABA2_MOTION.getDiagnostics().glowSettling === false);
  const settled = await page.evaluate(() => ({
    writes: window.__glowWrites(),
    glow: getComputedStyle(document.querySelector('[data-view="catalog"] [data-glow-shelf]')).getPropertyValue('--card-glow').trim(),
  }));
  expect(settled.glow, 'asentado tres pantallas abajo, el brillo tiene que estar apagado').toBe('0');
  expect(settled.writes, 'asentar el scroll escribe el brillo una vez, no varias').toBeLessThanOrEqual(2);
});

test('un teléfono de densidad 3 baja la miniatura de cada tarjeta, no el master', async ({ browser }) => {
  // Recorre la grilla entera a densidad 3 esperando cada foto: en el WebKit para
  // Windows, con la máquina ocupada, no entra en el tiempo de una prueba común.
  // Lo que se afirma no cambia; sólo tiene más tiempo para recorrerla.
  test.slow();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, serviceWorkers: 'block' });
  const page = await context.newPage();
  const requested = [];
  page.on('request', (request) => { if (request.url().includes('/storage/')) requested.push(request.url()); });
  await openRuntimeCatalog(page);
  // Las fotos son diferidas y cada motor decide cuándo pedirlas: se recorre la
  // grilla de a media pantalla y se espera a que lo que está a la vista cargue.
  for (let step = 0; step <= 24; step += 1) {
    await page.evaluate((position) => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * position), step / 24);
    await page.waitForFunction(() => [...document.querySelectorAll('[data-product-grid] img.thumb-img')]
      .filter((image) => { const rect = image.getBoundingClientRect(); return rect.bottom > 0 && rect.top < window.innerHeight; })
      .every((image) => image.complete));
  }
  const thumbs = requested.filter((url) => /\/thumb-[a-f0-9]{64}\.webp/.test(url));
  const masters = requested.filter((url) => !/\/thumb-/.test(url));
  expect(thumbs.length, 'no se pidió ninguna miniatura').toBeGreaterThanOrEqual(42);
  expect(masters, 'una tarjeta de la grilla pidió el master').toEqual([]);
  // La ficha SÍ pide el master: ahí la foto ocupa la pantalla.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator(`${GRID} [data-product-detail]`).first().click();
  await expect(page.locator('[data-product-modal]')).toBeVisible();
  await expect.poll(() => requested.filter((url) => !/\/thumb-/.test(url)).length).toBeGreaterThan(0);
  await context.close();
});
