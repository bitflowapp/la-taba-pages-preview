/*
 * La góndola comercial de Neuquén, vista con un navegador de verdad.
 *
 * Las pruebas unitarias verifican que cada fila sobreviva el mapeo. Esto
 * verifica lo otro: que la tienda las DIBUJE. El catálogo entra por el camino
 * productivo —`/rest/v1/products` respondido con las filas exactas que va a
 * escribir el lote— así que pasa por `rowToCatalogProduct`, por el modelo
 * minorista y por el render, igual que en producción.
 *
 * Lo que se mide:
 *   1. la vitrina dibuja los 52 y ninguno se cae en silencio;
 *   2. cada categoría queda en su estante, con su nombre bien escrito;
 *   3. todos tienen precio visible y ninguno dice «Precio próximamente»;
 *   4. el alcohol se anuncia como tal y arrastra su edad mínima;
 *   5. el pack se distingue de la unidad suelta;
 *   6. agregar al carrito funciona, incluido un alcohólico;
 *   7. ninguna imagen queda rota.
 */
import { expect, test } from '@playwright/test';
import { installPageGuards } from './helpers.mjs';
import { GONDOLA } from '../../catalog/gondola-neuquen.mjs';

const SUPABASE_URL = 'https://taba-gondola-neuquen.supabase.co';
const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';

/** Una fila como la va a guardar `artifacts/taba2-gondola-neuquen/gondola-neuquen.sql`. */
function filaDeProducto(p, indice) {
  return {
    id: `40000000-0000-4000-8000-${String(indice + 1).padStart(12, '0')}`,
    external_id: p.externalId,
    sku: p.sku,
    name: p.name,
    brand: p.brand,
    description: p.description,
    category: p.category,
    subcategory: p.subcategory,
    variant: p.variant,
    presentation: p.presentation,
    capacity_value: p.capacityValue,
    capacity_unit: p.capacityUnit,
    capacity: p.capacity,
    packaging_type: p.packagingType,
    units_per_pack: p.unitsPerPack,
    sold_as_pack: p.soldAsPack,
    price: p.price,
    price_status: 'confirmed',
    stock: p.stock,
    available: true,
    is_active: true,
    is_verified: true,
    chilled: p.chilled,
    is_alcoholic: p.alcoholic,
    minimum_age: p.minimumAge,
    // Sin foto a propósito: es el estado real con el que abre la góndola, y la
    // migración 108 lo permite. La vitrina pone el recurso propio de TABA.
    image_url: null,
    image_sha256: null,
    image_thumbnail_url: null,
    image_thumbnail_sha256: null,
    source_image_sha256: null,
    tags: [...p.tags],
    sort_order: p.sortOrder,
  };
}

const FILAS = GONDOLA.map(filaDeProducto);

const NEGOCIO = {
  id: BUSINESS_ID,
  name: 'La Taba',
  address: 'Mendoza 827, Neuquén',
  currency_code: 'ARS',
  ordering_enabled: true,
  ordering_verified: true,
  delivery_enabled: true,
  pickup_enabled: true,
  delivery_fee: 0,
  minimum_delivery_subtotal: 0,
  is_active: true,
  status: 'open',
};

async function montarGondola(page) {
  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (body, headers = {}) => route.fulfill({
      status: 200, contentType: 'application/json', headers, body: JSON.stringify(body),
    });
    if (url.pathname.includes('/rest/v1/products')) return json(FILAS);
    if (url.pathname.includes('/rest/v1/businesses')) return json(NEGOCIO);
    if (url.pathname.includes('/rest/v1/rpc/get_public_business_contact')) {
      return json([{ whatsapp_number: '', whatsapp_verified: false }]);
    }
    if (url.pathname.includes('/rest/v1/rpc/get_mercadopago_checkout_availability')) {
      return json({ available: false });
    }
    if (url.pathname.includes('/auth/v1/')) {
      return json({
        access_token: 'gondola-token',
        refresh_token: 'gondola-refresh',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: '10000000-0000-4000-8000-000000000001', is_anonymous: true, aud: 'authenticated' },
      });
    }
    return json([], { 'content-range': '0-0/0' });
  });

  await page.addInitScript(({ supabaseUrl, businessId }) => {
    globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
      mode: 'production',
      repository: {
        provider: 'supabase',
        supabaseUrl,
        publishableKey: 'sb_publishable_test_key',
        businessId,
      },
    };
  }, { supabaseUrl: SUPABASE_URL, businessId: BUSINESS_ID });
}

async function catalogoEnMemoria(page) {
  return page.evaluate(async () => {
    const { getState } = await import('/js/state.js');
    return getState().products.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      categoryId: p.categoryId,
      categoryName: p.categoryName,
      price: p.price,
      pricePending: p.pricePending,
      alcoholic: p.alcoholic,
      minimumAge: p.minimumAge,
      unitsPerPack: p.unitsPerPack,
      procurementOnly: p.procurementOnly === true,
    }));
  });
}

async function abrirGondola(page, ruta = '/#catalog') {
  const guardas = installPageGuards(page);
  await montarGondola(page);
  await page.goto(ruta);
  await expect(page.locator('body')).toHaveAttribute('data-app-mode', 'production');
  await expect
    .poll(() => page.evaluate(async () => {
      const { getState } = await import('/js/state.js');
      return getState().products.length;
    }), { timeout: 20_000 })
    .toBeGreaterThan(0);
  return guardas;
}

test('los 52 llegan enteros a la góndola, sin derivados fantasma', async ({ page }) => {
  await abrirGondola(page);
  const catalogo = await catalogoEnMemoria(page);

  // Exactamente 52: ni uno menos por caerse en el mapeo —`rowToCatalogProduct`
  // devuelve null sin avisar—, ni uno más por una unidad derivada que el modelo
  // minorista hubiera inventado a partir del pack.
  expect(catalogo.length).toBe(GONDOLA.length);
  const presentes = new Set(catalogo.map((c) => c.sku));
  const faltantes = GONDOLA.map((p) => p.sku).filter((sku) => !presentes.has(sku));
  expect(faltantes, 'se cayeron en el camino').toEqual([]);
  expect(catalogo.filter((c) => c.pricePending === true).map((c) => c.sku)).toEqual([]);
  expect(catalogo.filter((c) => c.procurementOnly).map((c) => c.sku)).toEqual([]);
});

test('cada categoría queda en su estante y con su nombre bien escrito', async ({ page }) => {
  await abrirGondola(page);
  const catalogo = await catalogoEnMemoria(page);

  // El defecto que motivó la migración 20260818040000: una categoría cuyo slug
  // no existe en la vitrina se dibuja con el slug crudo de nombre.
  for (const item of catalogo) {
    expect(item.categoryId, 'categoría vacía').toBeTruthy();
    expect(item.categoryName, `«${item.categoryId}» quedó sin nombre propio`).not.toBe(item.categoryId);
  }

  const esperadas = new Set(GONDOLA.map((p) => p.category));
  const dibujadas = new Set(catalogo.map((c) => c.categoryName));
  expect([...esperadas].filter((c) => !dibujadas.has(c) && c !== 'Fernet' && c !== 'Espumantes' && c !== 'Hielo')).toEqual([]);

  // Y la tira de categorías del catálogo las ofrece de verdad.
  const tira = page.locator('[data-view="catalog"] [data-category-strip]');
  await expect(tira.locator('[data-category-id]').first()).toBeVisible();
  const ids = await tira.locator('[data-category-id]').evaluateAll(
    (nodos) => nodos.map((n) => n.getAttribute('data-category-id')),
  );
  for (const necesaria of ['cervezas', 'gaseosas', 'fernet', 'vinos', 'destilados', 'energizantes']) {
    expect(ids, `falta el estante «${necesaria}»`).toContain(necesaria);
  }
});

test('todos los productos muestran precio y ninguno dice que falta', async ({ page }) => {
  await abrirGondola(page);
  const tarjetas = page.locator('[data-product-grid] .product-card');
  await expect(tarjetas.first()).toBeVisible();

  const cuerpo = await page.locator('[data-view="catalog"]').innerText();
  expect(cuerpo).not.toContain('Precio próximamente');
  expect(cuerpo).not.toContain('Precio pendiente');

  const precios = await tarjetas.locator('.price-amounts strong').evaluateAll(
    (nodos) => nodos.map((n) => Number(n.textContent.replace(/[^\d]/g, ''))),
  );
  expect(precios.length).toBeGreaterThan(0);
  for (const precio of precios) expect(precio).toBeGreaterThan(0);

  // Los precios dibujados son EXACTAMENTE los del catálogo: nada se redondea ni
  // se convierte en el camino.
  const declarados = new Set(GONDOLA.map((p) => p.price));
  for (const precio of precios) expect(declarados.has(precio), `precio inesperado: ${precio}`).toBe(true);
});

test('el alcohol se anuncia como alcohol y arrastra su edad mínima', async ({ page }) => {
  await abrirGondola(page);
  const catalogo = await catalogoEnMemoria(page);
  const conAlcohol = catalogo.filter((c) => c.alcoholic);
  const sinAlcohol = catalogo.filter((c) => !c.alcoholic);

  expect(conAlcohol.length).toBe(GONDOLA.filter((p) => p.alcoholic).length);
  for (const item of conAlcohol) expect(item.minimumAge, 'alcohol sin +18').toBe(18);
  for (const item of sinAlcohol) expect(item.minimumAge).toBe(null);
});

test('el pack se distingue de la unidad suelta y se puede comprar', async ({ page }) => {
  await abrirGondola(page, '/#home');
  const catalogo = await catalogoEnMemoria(page);
  const packs = catalogo.filter((c) => c.unitsPerPack > 1);
  expect(packs.length).toBe(GONDOLA.filter((p) => p.soldAsPack).length);
  for (const pack of packs) expect(pack.procurementOnly, 'el pack salió de la góndola').toBe(false);

  // El multiplicador viaja adelante de la capacidad: un pack x6 a $11.400 leído
  // como «473 ml · $11.400» afirmaría un precio unitario que nadie ofrece.
  await expect(page.locator('[data-home-sections] .home-category-section').first())
    .toBeVisible({ timeout: 20_000 });
  const texto = await page.locator('[data-view="home"]').innerText();
  expect(texto).toContain('Pack x6');

  // Y también en la grilla del catálogo, que es donde el pack y su unidad
  // suelta quedan uno al lado del otro. Sin la marca de formato son dos
  // tarjetas «Quilmes Clásica / Lager» con precios distintos y nada que lo
  // explique: la base exige `presentation = variant`, así que el texto que
  // llega es la variedad, nunca el formato.
  await page.goto('/#catalog');
  await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
  const tarjetas = await page.locator('[data-product-grid] .product-card').evaluateAll(
    (nodos) => nodos.map((n) => n.innerText.replace(/\s+/g, ' ').trim()),
  );
  const quilmes = tarjetas.filter((t) => t.includes('Quilmes Clásica'));
  expect(quilmes.length, 'tienen que convivir el pack y la unidad').toBeGreaterThanOrEqual(2);
  expect(
    quilmes.filter((t) => t.includes('Pack x6')).length,
    `el pack no se distingue de la unidad: ${quilmes.join(' || ')}`,
  ).toBe(1);
});

test('se puede agregar al carrito, incluido un producto con alcohol', async ({ page }) => {
  await abrirGondola(page);
  const catalogo = await catalogoEnMemoria(page);
  const sinAlcohol = catalogo.find((c) => !c.alcoholic);
  const conAlcohol = catalogo.find((c) => c.alcoholic);
  expect(sinAlcohol && conAlcohol).toBeTruthy();

  await page.evaluate(async ([a, b]) => {
    const { addToCart } = await import('/js/cart.js');
    addToCart(a, 2);
    addToCart(b, 1);
  }, [sinAlcohol.id, conAlcohol.id]);

  const lineas = await page.evaluate(async () => {
    const { getState } = await import('/js/state.js');
    return getState().cart.map((i) => `${i.productId}:${i.quantity}`).sort();
  });
  expect(lineas).toEqual([`${sinAlcohol.id}:2`, `${conAlcohol.id}:1`].sort());

  await page.goto('/#cart');
  await expect(page.locator('[data-cart-list] .cart-item')).toHaveCount(2);
});

test('ninguna imagen queda rota y toda tarjeta sin foto usa el recurso de TABA', async ({ page }) => {
  await abrirGondola(page);
  await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();

  const rotas = await page.evaluate(() => [...document.querySelectorAll('img')]
    .filter((i) => i.complete && i.naturalWidth === 0)
    .map((i) => `${i.currentSrc || i.src} — ${i.outerHTML.slice(0, 160)}`));
  expect(rotas).toEqual([]);

  const conFoto = await page.locator('.thumb.has-photo').count();
  // Ya no es el mismo envase gris para todos: cada producto sin fotografía
  // publicable dibuja SU lámina, obra propia del comercio.
  const laminas = await page.locator('.thumb.uses-lamina').count();
  expect(laminas).toBeGreaterThan(0);
  expect(conFoto).toBe(0);
  const distintas = await page.evaluate(() => new Set(
    [...document.querySelectorAll('.thumb.uses-lamina img')].map((i) => i.getAttribute('src')),
  ).size);
  expect(distintas, 'todas las láminas son el mismo archivo: la góndola no distingue productos').toBeGreaterThan(1);
});

/*
 * Evidencia visual. No afirma nada por sí sola —las pruebas de arriba son las
 * que miden— pero deja las capturas que una persona puede mirar antes de
 * aprobar la carga, en el teléfono en el que TABA se usa de verdad.
 */
test('capturas de la góndola para revisión humana', async ({ page }, testInfo) => {
  const destino = 'artifacts/taba2-gondola-neuquen';
  await page.setViewportSize({ width: 390, height: 844 });

  // Recorrer la página entera ANTES de capturarla. Con `fullPage` las secciones
  // que todavía no entraron al viewport salen en negro: la captura mostraría
  // huecos que en la pantalla no existen, y una evidencia que miente es peor
  // que no tenerla.
  const despertarLaPagina = async () => {
    await page.evaluate(async () => {
      const paso = window.innerHeight;
      for (let y = 0; y < document.body.scrollHeight; y += paso) {
        window.scrollTo(0, y);
        await new Promise((listo) => setTimeout(listo, 120));
      }
      window.scrollTo(0, 0);
      await new Promise((listo) => setTimeout(listo, 250));
    });
  };

  await abrirGondola(page, '/#home');
  await expect(page.locator('[data-home-sections] .home-category-section').first()).toBeVisible({ timeout: 20_000 });
  await despertarLaPagina();
  await page.screenshot({ path: `${destino}/01-home.png`, fullPage: true });

  await page.goto('/#catalog');
  await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
  await despertarLaPagina();
  await page.screenshot({ path: `${destino}/02-catalogo.png`, fullPage: true });

  const cervezas = page.locator('[data-view="catalog"] [data-category-strip] [data-category-id="cervezas"]');
  if (await cervezas.count()) {
    await cervezas.first().click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${destino}/03-cervezas.png`, fullPage: true });
  }

  const fernet = page.locator('[data-view="catalog"] [data-category-strip] [data-category-id="fernet"]');
  if (await fernet.count()) {
    await fernet.first().click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${destino}/04-fernet.png`, fullPage: true });
  }

  await page.locator('[data-product-grid] .product-card [data-product-detail]').first().click();
  await expect(page.locator('[data-product-modal] .modal-card')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${destino}/05-ficha.png` });

  testInfo.annotations.push({ type: 'evidencia', description: destino });
});

test('la home no deja huecos: cada carrusel tiene tarjetas y ninguna sección queda vacía', async ({ page }) => {
  await abrirGondola(page, '/#home');
  await expect(page.locator('[data-home-sections] .home-category-section').first()).toBeVisible({ timeout: 20_000 });

  const medidas = await page.evaluate(() => [...document.querySelectorAll('[data-home-sections] .home-category-section')]
    .map((seccion) => ({
      titulo: seccion.querySelector('h2')?.textContent || '',
      tarjetas: seccion.querySelectorAll('.home-best-sellers > *').length,
      alto: Math.round(seccion.getBoundingClientRect().height),
    })));

  expect(medidas.length, 'la home se quedó sin carruseles').toBeGreaterThan(2);
  for (const seccion of medidas) {
    expect(seccion.tarjetas, `«${seccion.titulo}» quedó sin tarjetas`).toBeGreaterThan(0);
    expect(seccion.alto, `«${seccion.titulo}» ocupa ${seccion.alto}px: es un hueco`).toBeGreaterThan(120);
  }

  // Ningún tramo vertical vacío entre secciones: un salto grande se lee como
  // una tienda rota aunque el contenido esté cargado más abajo.
  const huecos = await page.evaluate(() => {
    const hijos = [...document.querySelector('[data-home-sections]').children];
    const saltos = [];
    for (let i = 1; i < hijos.length; i += 1) {
      const anterior = hijos[i - 1].getBoundingClientRect();
      const actual = hijos[i].getBoundingClientRect();
      const salto = Math.round(actual.top - anterior.bottom);
      if (salto > 120) saltos.push(`${hijos[i - 1].className} -> ${hijos[i].className}: ${salto}px`);
    }
    return saltos;
  });
  expect(huecos).toEqual([]);
});

test('sin Mercado Pago no se ofrece un combo que después nadie puede cobrar', async ({ page }) => {
  // El manifiesto de combos (`js/combos-data.js`) se resuelve contra el catálogo
  // VIVO: alcanza con que existan sus componentes para que el combo aparezca
  // solo. La góndola de Neuquén trae `corona-extra-botella-330ml`, así que
  // enciende «Corona Extra x6».
  //
  // Y la ruta directa de pedidos RECHAZA cualquier carrito con combos —«Los
  // combos se cobran con Mercado Pago»— porque el precio de un combo lo calcula
  // Checkout Pro. En producción `business_payment_settings` tiene 0 filas: no
  // hay Mercado Pago y ni siquiera aparece en el selector.
  //
  // Las dos cosas juntas eran un callejón sin salida: agregar el combo y no
  // tener con qué pagarlo. Acá se mide que la góndola no lo ofrezca.
  await abrirGondola(page, '/#home');
  await expect(page.locator('[data-home-sections] .home-category-section').first()).toBeVisible({ timeout: 20_000 });

  const medida = await page.evaluate(async () => {
    const { customerCombos } = await import('/js/ui.js');
    const rail = document.querySelector('[data-combos-rail]');
    return {
      combos: customerCombos().length,
      tarjetas: rail ? rail.children.length : 0,
      seccionOculta: Boolean(
        rail?.closest('.home-combos-section')?.hidden ?? rail?.closest('.rail-block')?.hidden,
      ),
      mercadoPagoEnElSelector: Boolean(document.querySelector('option[value="mercadopago"]')),
    };
  });

  expect(medida.mercadoPagoEnElSelector, 'el escenario deja de medir lo que dice medir').toBe(false);
  expect(medida.combos, 'se ofrece un combo que el checkout va a rechazar').toBe(0);
  expect(medida.tarjetas).toBe(0);
  expect(medida.seccionOculta).toBe(true);
});
