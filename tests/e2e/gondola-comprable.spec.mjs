import { expect, test } from '@playwright/test';
import { installBrowserStubs, installPageGuards } from './helpers.mjs';

// La góndola tiene que llevar a lo que HOY se puede comprar.
//
// El catálogo publicado convive con productos cuyo precio el negocio todavía no
// confirmó: hoy son 69 de 80. Siguen visibles y buscables a propósito —son
// productos reales que el local va a vender— pero cada superficie que ORDENA o
// que PRIORIZA tiene que dejarlos atrás, o la tienda entera se lee como si no
// vendiera nada. Estas pruebas son la red de ese contrato.

const MOBILE = { width: 390, height: 844 };

async function abrir(browser, ruta) {
  const context = await browser.newContext({ viewport: MOBILE });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await installBrowserStubs(page);
  await page.goto(ruta);
  return { context, page, guards };
}

test('ordenar por precio no abre con los productos que todavía no tienen precio', async ({ browser }) => {
  const { context, page, guards } = await abrir(browser, '/?demo=1#catalog');
  await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();

  await page.locator('[data-sort-select]').selectOption('price_asc');
  await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();

  // Un precio pendiente vale `null`, y `Number(null)` es 0: comparados con
  // `a.price - b.price` los sin precio ganaban el primer puesto y «Precio:
  // menor a mayor» abría con ocho tarjetas que no se pueden comprar.
  const primeros = await page.locator('[data-product-grid] .product-card').evaluateAll(
    (tarjetas) => tarjetas.slice(0, 6).map((tarjeta) => ({
      pendiente: Boolean(tarjeta.querySelector('.is-price-pending')),
      texto: tarjeta.innerText.replace(/\s+/g, ' '),
    })),
  );
  expect(primeros.length).toBeGreaterThan(0);
  for (const tarjeta of primeros) {
    expect(tarjeta.pendiente, `no puede abrir con un precio pendiente: ${tarjeta.texto}`).toBe(false);
  }

  // Y el orden entre los que sí tienen precio es realmente ascendente.
  const precios = await page.locator('[data-product-grid] .product-card .price-amounts strong').evaluateAll(
    (nodos) => nodos.slice(0, 6).map((nodo) => Number(nodo.textContent.replace(/[^\d]/g, ''))),
  );
  const ordenados = [...precios].sort((a, b) => a - b);
  expect(precios).toEqual(ordenados);

  await guards.assertClean();
  await context.close();
});

test('las categorías del catálogo abren por las que tienen algo comprable', async ({ browser }) => {
  const { context, page, guards } = await abrir(browser, '/?demo=1#catalog');
  const tira = page.locator('[data-view="catalog"] [data-category-strip]');
  await expect(tira.locator('[data-category-id]').first()).toBeVisible();

  const orden = await tira.locator('[data-category-id]').evaluateAll(
    (botones) => botones.map((boton) => boton.dataset.categoryId),
  );
  expect(orden.slice(0, 2), '«Todos» y «Favoritos» quedan fijos al principio').toEqual(['all', 'favorites']);

  const comprables = await page.evaluate(async () => {
    const { getState } = await import('/js/state.js');
    const { getCustomerCatalogProducts } = await import('/js/core/catalog-store.js');
    return [...new Set(getCustomerCatalogProducts(getState().products)
      .filter((product) => !product.pricePending && product.available && Number(product.stock) > 0)
      .map((product) => product.categoryId))];
  });
  expect(comprables.length, 'el fixture tiene que tener alguna categoría comprable').toBeGreaterThan(0);

  // Antes el orden era fijo y abría con Gaseosas y Mixers, que no publican un
  // solo precio: los dos primeros toques caían en «Precio próximamente».
  const seleccionables = orden.slice(2);
  const primerVacia = seleccionables.findIndex((id) => !comprables.includes(id));
  const ultimaComprable = seleccionables.reduce(
    (ultimo, id, indice) => (comprables.includes(id) ? indice : ultimo),
    -1,
  );
  if (primerVacia >= 0 && ultimaComprable >= 0) {
    expect(ultimaComprable, 'ninguna categoría sin precio puede colarse antes de una comprable')
      .toBeLessThan(primerVacia);
  }

  // Y tocar la primera lleva a productos que se pueden agregar de verdad.
  await tira.locator(`[data-category-id="${seleccionables[0]}"]`).click();
  await expect(page.locator('[data-product-grid] [data-add-product]:not([disabled])').first()).toBeVisible();

  await guards.assertClean();
  await context.close();
});

test('una categoría sin un solo precio publicado lo dice arriba, no después de scrollear', async ({ browser }) => {
  const { context, page, guards } = await abrir(browser, '/?demo=1#catalog');
  const tira = page.locator('[data-view="catalog"] [data-category-strip]');
  await expect(tira.locator('[data-category-id]').first()).toBeVisible();

  const sinPrecio = await page.evaluate(async () => {
    const { getState } = await import('/js/state.js');
    const { getCustomerCatalogProducts } = await import('/js/core/catalog-store.js');
    const productos = getCustomerCatalogProducts(getState().products);
    const porCategoria = new Map();
    for (const producto of productos) {
      const entrada = porCategoria.get(producto.categoryId) || { total: 0, comprables: 0 };
      entrada.total += 1;
      if (!producto.pricePending && producto.available && Number(producto.stock) > 0) entrada.comprables += 1;
      porCategoria.set(producto.categoryId, entrada);
    }
    for (const [id, entrada] of porCategoria) {
      if (entrada.total > 0 && entrada.comprables === 0) return id;
    }
    return '';
  });
  test.skip(!sinPrecio, 'el fixture no tiene ninguna categoría sin precio publicado');

  await tira.locator(`[data-category-id="${sinPrecio}"]`).click();
  await expect(page.locator('[data-catalog-count]')).toContainText('todavía sin precio publicado');

  // Y una categoría que sí vende NO lleva la aclaración: sólo se avisa lo que hay que avisar.
  await tira.locator('[data-category-id="cervezas"]').click();
  await expect(page.locator('[data-catalog-count]')).not.toContainText('todavía sin precio publicado');

  await guards.assertClean();
  await context.close();
});

test('los productos con alcohol se distinguen en la góndola, no recién en la ficha', async ({ browser }) => {
  const { context, page, guards } = await abrir(browser, '/?demo=1#catalog');
  await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();

  const marcas = await page.locator('[data-product-grid] .product-card').evaluateAll(
    (tarjetas) => tarjetas.map((tarjeta) => ({
      id: tarjeta.querySelector('[data-product-detail]')?.dataset.productDetail || '',
      marcado: Boolean(tarjeta.querySelector('.product-age-tag')),
    })),
  );
  const alcoholicos = await page.evaluate(async () => {
    const { getState } = await import('/js/state.js');
    return getState().products.filter((product) => product.alcoholic).map((product) => product.id);
  });
  expect(alcoholicos.length, 'el fixture tiene que tener alcohol').toBeGreaterThan(0);

  const conAlcoholEnPantalla = marcas.filter((tarjeta) => alcoholicos.includes(tarjeta.id));
  expect(conAlcoholEnPantalla.length).toBeGreaterThan(0);
  for (const tarjeta of conAlcoholEnPantalla) {
    expect(tarjeta.marcado, `${tarjeta.id} tiene alcohol y la tarjeta no lo dice`).toBe(true);
  }
  for (const tarjeta of marcas.filter((entrada) => !alcoholicos.includes(entrada.id))) {
    expect(tarjeta.marcado, `${tarjeta.id} no tiene alcohol y la tarjeta lo marca`).toBe(false);
  }

  // La marca es rótulo, no control: no toma foco ni se anuncia dos veces.
  const chip = page.locator('.product-age-tag').first();
  await expect(chip).toHaveText(/\+18/);
  await expect(chip.locator('.sr-only')).toHaveText(/mayores de 18/);

  await guards.assertClean();
  await context.close();
});

test('el encabezado nombra la dirección que el checkout va a usar', async ({ browser }) => {
  const { context, page, guards } = await abrir(browser, '/?demo=1');
  const chip = page.locator('[data-home-address-label]');
  await expect(chip).toBeVisible();

  // El chip leía sólo la copia local del perfil, que producción no usa: decía
  // «Elegí tu dirección» con una dirección predeterminada confirmada al lado.
  const elegida = await page.evaluate(async () => {
    const { getActiveDeliveryAddress } = await import('/js/customer-delivery.js');
    const direccion = getActiveDeliveryAddress();
    return direccion ? `${direccion.street} ${direccion.streetNumber}`.trim() : '';
  });
  expect(elegida, 'el fixture tiene que traer una dirección confirmada').not.toBe('');
  await expect(chip).toHaveText(elegida);
  await expect(page.locator('[data-home-address]')).not.toHaveClass(/is-missing/);

  await guards.assertClean();
  await context.close();
});

test('el resumen de pago suma sólo lo que se cobra', async ({ browser }) => {
  const { context, page, guards } = await abrir(browser, '/?demo=1');
  await expect(page.locator('[data-view="home"]')).toBeVisible();
  const agregar = page.locator('[data-add-product]:not([disabled])');
  await agregar.first().click();
  await page.goto('/?demo=1#cart');
  await expect(page.locator('[data-cart-list] .cart-item').first()).toBeVisible();

  const resumen = page.locator('[data-order-summary]');
  await expect(resumen).toBeVisible();
  // El pedido mínimo NO es un cargo. Estaba como fila con importe entre «Envío»
  // y «Total», que es donde se leen los cargos. La barra de progreso de arriba
  // ya lo dice, y además es accionable.
  await expect(resumen).not.toContainText('Pedido mínimo');
  await expect(page.locator('[data-cart-minimum-progress]')).toContainText('mínimo');

  await guards.assertClean();
  await context.close();
});
