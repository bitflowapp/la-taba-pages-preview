// El P1 comercial: en producción, un carrito con productos se perdía al
// recargar la pestaña. La persona volvía a la tienda y empezaba de nuevo.
//
// En producción el estado NO se persiste: pedidos, catálogo y PII viven sólo en
// memoria y se reconstruyen desde Supabase en cada arranque, que es el contrato
// que evita renderizar datos de otra persona desde el disco. El carrito quedaba
// adentro de esa regla sin necesitarlo: un id de catálogo y una cantidad no son
// datos de nadie.
//
// Estas pruebas fijan las dos mitades del arreglo:
//   1. el carrito sobrevive la recarga;
//   2. lo que sobrevive se reconcilia contra el catálogo verificado —producto
//      que desapareció, que se quedó sin stock o que perdió el precio NO vuelve.
import { expect, test } from '@playwright/test';

const SUPABASE_URL = 'https://taba-production-cart.supabase.co';
const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const CART_KEY = 'la_taba_production_cart_v1';
const STATE_KEY = 'la_taba_mvp_v4_state';

const VIGENTE = productRow({
  id: '30000000-0000-4000-8000-000000000001',
  name: 'Cerveza Andes Origen Roja',
  sku: 'AND-ROJA-473',
  price: 2400,
  stock: 40,
  sortOrder: 1,
});
const SE_QUEDA_SIN_STOCK = productRow({
  id: '30000000-0000-4000-8000-000000000002',
  name: 'Cerveza Imperial Golden',
  sku: 'IMP-GOLD-473',
  price: 2900,
  stock: 25,
  sortOrder: 2,
});
const PIERDE_EL_PRECIO = productRow({
  id: '30000000-0000-4000-8000-000000000003',
  name: 'Gaseosa Sprite Lima',
  sku: 'SPR-LIMA-1500',
  price: 1800,
  stock: 30,
  sortOrder: 3,
});

function productRow({ id, name, sku, price, stock, sortOrder }) {
  return {
    id,
    external_id: sku,
    sku,
    name,
    brand: name.split(' ')[1] || 'Marca',
    description: 'Producto verificado por el comercio.',
    category: 'Bebidas',
    subcategory: '',
    variant: 'Lata 473 ml',
    presentation: 'Lata 473 ml',
    capacity_value: 473,
    capacity_unit: 'ml',
    capacity: '473 ml',
    packaging_type: 'lata',
    units_per_pack: 1,
    price,
    price_status: 'confirmed',
    stock,
    available: true,
    chilled: true,
    is_alcoholic: false,
    minimum_age: null,
    image_url: '/assets/catalog/placeholder.png',
    image_sha256: '',
    image_thumbnail_url: '/assets/catalog/placeholder.png',
    image_thumbnail_sha256: '',
    source_image_sha256: '',
    tags: [],
    sort_order: sortOrder,
    is_active: true,
    is_verified: true,
  };
}

const BUSINESS_ROW = {
  id: BUSINESS_ID,
  name: 'La Taba 2',
  address: 'Mendoza 827, Neuquén',
  currency_code: 'ARS',
  ordering_enabled: true,
  ordering_verified: true,
  delivery_enabled: true,
  pickup_enabled: true,
  delivery_fee: 900,
  minimum_delivery_subtotal: 0,
  is_active: true,
  status: 'open',
};

/*
 * Un backend de mentira, pero con las mismas respuestas que mira el
 * repositorio. `catalogo()` se evalúa en cada pedido: así una prueba puede
 * cambiar el catálogo ENTRE la primera carga y la recarga, que es exactamente
 * lo que pasa cuando el local edita su góndola mientras alguien compra.
 */
async function installProductionBackend(page, catalogo = () => [VIGENTE, SE_QUEDA_SIN_STOCK, PIERDE_EL_PRECIO]) {
  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (body, headers = {}) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers,
      body: JSON.stringify(body),
    });

    if (url.pathname.includes('/rest/v1/products')) return json(catalogo());
    if (url.pathname.includes('/rest/v1/businesses')) return json(BUSINESS_ROW);
    if (url.pathname.includes('/rest/v1/rpc/get_public_business_contact')) {
      return json([{ whatsapp_number: '', whatsapp_verified: false }]);
    }
    if (url.pathname.includes('/rest/v1/rpc/get_mercadopago_checkout_availability')) {
      return json({ available: false });
    }
    if (url.pathname.includes('/auth/v1/')) {
      return json({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
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

async function lineasDelCarrito(page) {
  return page.evaluate(async () => {
    const { getState } = await import('/js/state.js');
    return getState().cart.map((item) => `${item.productId}:${item.quantity}`).sort();
  });
}

async function esperarCatalogoProductivo(page) {
  await expect(page.locator('body')).toHaveAttribute('data-app-mode', 'production');
  await expect
    .poll(() => page.evaluate(async () => {
      const { getState } = await import('/js/state.js');
      return getState().products.length;
    }), { timeout: 15_000 })
    .toBeGreaterThan(0);
}

test('P1: el carrito productivo sobrevive a recargar la pestaña', async ({ page }) => {
  await installProductionBackend(page);
  await page.goto('/#catalog');
  await esperarCatalogoProductivo(page);

  await page.evaluate(async ([primero, segundo]) => {
    const { addToCart } = await import('/js/cart.js');
    addToCart(primero, 2);
    addToCart(segundo, 1);
  }, [VIGENTE.id, SE_QUEDA_SIN_STOCK.id]);

  expect(await lineasDelCarrito(page)).toEqual([`${VIGENTE.id}:2`, `${SE_QUEDA_SIN_STOCK.id}:1`]);

  // Lo que se guarda es sólo id y cantidad, con su marca de tiempo. Nada más.
  const guardado = JSON.parse(await page.evaluate((key) => localStorage.getItem(key), CART_KEY));
  expect(guardado.cart).toEqual([
    { productId: VIGENTE.id, quantity: 2 },
    { productId: SE_QUEDA_SIN_STOCK.id, quantity: 1 },
  ]);
  expect(Object.keys(guardado).sort()).toEqual(['cart', 'comboSelections', 'savedAt', 'schemaVersion']);
  // El estado completo sigue SIN persistirse: ese contrato no se relaja.
  expect(await page.evaluate((key) => localStorage.getItem(key), STATE_KEY)).toBeNull();

  await page.reload();
  await esperarCatalogoProductivo(page);

  expect(await lineasDelCarrito(page)).toEqual([`${VIGENTE.id}:2`, `${SE_QUEDA_SIN_STOCK.id}:1`]);
  await page.goto('/#cart');
  await expect(page.locator('[data-cart-list] .cart-item').first()).toBeVisible();
  await expect(page.locator('[data-cart-list] .cart-item')).toHaveCount(2);
});

test('lo que vuelve del disco se reconcilia con el catálogo verificado', async ({ page }) => {
  let segundaCarga = false;
  await installProductionBackend(page, () => {
    if (!segundaCarga) return [VIGENTE, SE_QUEDA_SIN_STOCK, PIERDE_EL_PRECIO];
    // Segunda visita: uno se quedó sin stock, otro perdió el precio publicado
    // y un tercero salió del catálogo. Ninguno puede volver al carrito.
    return [
      VIGENTE,
      { ...SE_QUEDA_SIN_STOCK, stock: 0, available: false },
      { ...PIERDE_EL_PRECIO, price: null, price_status: 'pending' },
    ];
  });

  await page.goto('/#catalog');
  await esperarCatalogoProductivo(page);
  await page.evaluate(async (ids) => {
    const { addToCart } = await import('/js/cart.js');
    ids.forEach((id) => addToCart(id, 1));
  }, [VIGENTE.id, SE_QUEDA_SIN_STOCK.id, PIERDE_EL_PRECIO.id]);
  expect(await lineasDelCarrito(page)).toHaveLength(3);

  // Una línea de un producto que ya no existe en el catálogo, inyectada a mano
  // en el disco: tampoco puede volver.
  await page.evaluate(({ key, fantasma }) => {
    const saved = JSON.parse(localStorage.getItem(key));
    saved.cart.push({ productId: fantasma, quantity: 5 });
    localStorage.setItem(key, JSON.stringify(saved));
  }, { key: CART_KEY, fantasma: '30000000-0000-4000-8000-00000000dead' });

  segundaCarga = true;
  await page.reload();
  await esperarCatalogoProductivo(page);

  await expect.poll(() => lineasDelCarrito(page)).toEqual([`${VIGENTE.id}:1`]);
  // Y el disco queda reconciliado también: lo inválido no se conserva.
  await expect
    .poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}').cart?.length ?? -1, CART_KEY))
    .toBe(1);
});

// H-08, la mitad de PRODUCCIÓN. El test de arriba cubre la hidratación —lo que
// vuelve del disco—; éste cubre el carrito YA en pantalla.
//
// `loadCatalog()` consulta con `.eq('available', true)` y `available` en la base
// es `stock > 0`, así que un producto agotado no vuelve en la respuesta. Cada
// pedido de cualquier persona descuenta stock y dispara el realtime de
// `products`. Antes del arreglo la línea desaparecía del carrito de alguien que
// estaba mirando la pantalla, y el total bajaba solo.
test('un producto que se agota con el carrito abierto se avisa, no se borra', async ({ page }) => {
  let agotado = false;
  await installProductionBackend(page, () => (agotado
    // Segunda consulta: `SE_QUEDA_SIN_STOCK` ya no vuelve, exactamente como hace
    // el backend cuando otra persona compra la última unidad.
    ? [VIGENTE, PIERDE_EL_PRECIO]
    : [VIGENTE, SE_QUEDA_SIN_STOCK, PIERDE_EL_PRECIO]));

  await page.goto('/#catalog');
  await esperarCatalogoProductivo(page);
  await page.evaluate(async (ids) => {
    const { addToCart } = await import('/js/cart.js');
    ids.forEach((id) => addToCart(id, 2));
  }, [VIGENTE.id, SE_QUEDA_SIN_STOCK.id]);
  expect(await lineasDelCarrito(page)).toEqual(
    [`${VIGENTE.id}:2`, `${SE_QUEDA_SIN_STOCK.id}:2`].sort(),
  );

  // Se agota y el catálogo se refresca, que es lo que dispara el realtime.
  agotado = true;
  await page.evaluate(async () => {
    const { getOrderRepository } = await import('/js/repositories/repository_factory.js');
    await getOrderRepository().loadCatalog();
  });

  // 1. La línea sigue, con la cantidad que la persona eligió.
  await expect.poll(() => lineasDelCarrito(page)).toEqual(
    [`${VIGENTE.id}:2`, `${SE_QUEDA_SIN_STOCK.id}:2`].sort(),
  );

  // 2. Y viene marcada, con su salida al lado.
  const aviso = await page.evaluate(async (id) => {
    const { cartItemIssue, getCartItems, validateCartForCheckout } = await import('/js/cart.js');
    const linea = getCartItems().find((item) => item.productId === id);
    const issue = linea ? cartItemIssue(linea) : null;
    return {
      hayLinea: Boolean(linea),
      kind: issue?.kind || null,
      mensaje: issue?.message || '',
      accion: issue?.actionLabel || '',
      checkout: validateCartForCheckout('delivery').ok,
    };
  }, SE_QUEDA_SIN_STOCK.id);

  expect(aviso.hayLinea).toBe(true);
  expect(aviso.kind).toBe('unavailable');
  expect(aviso.mensaje).toMatch(/Se agotó/);
  expect(aviso.accion).toBe('Quitar del pedido');
  expect(aviso.checkout).toBe(false);

  // 3. Pero NO vuelve a la góndola: se retiene sólo para poder explicarlo.
  const enGondola = await page.evaluate(async (id) => {
    const { getCustomerCatalogProducts } = await import('/js/core/catalog-store.js');
    const { getState } = await import('/js/state.js');
    return getCustomerCatalogProducts(getState().products).some((product) => product.id === id);
  }, SE_QUEDA_SIN_STOCK.id);
  expect(enGondola).toBe(false);

  // 4. Y la persona puede sacarlo.
  await page.evaluate(async (id) => {
    const { removeCartItem } = await import('/js/cart.js');
    removeCartItem(id);
  }, SE_QUEDA_SIN_STOCK.id);
  await expect.poll(() => lineasDelCarrito(page)).toEqual([`${VIGENTE.id}:2`]);
});

test('un catálogo que no carga conserva el carrito en vez de vaciarlo', async ({ page }) => {
  let caido = false;
  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (caido && url.pathname.includes('/rest/v1/products')) {
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'upstream' }) });
    }
    if (url.pathname.includes('/rest/v1/products')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([VIGENTE]) });
    }
    if (url.pathname.includes('/rest/v1/businesses')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BUSINESS_ROW) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '0-0/0' }, body: '[]' });
  });
  await page.addInitScript(({ supabaseUrl, businessId }) => {
    globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
      mode: 'production',
      repository: { provider: 'supabase', supabaseUrl, publishableKey: 'sb_publishable_test_key', businessId },
    };
  }, { supabaseUrl: SUPABASE_URL, businessId: BUSINESS_ID });

  await page.goto('/#catalog');
  await esperarCatalogoProductivo(page);
  await page.evaluate(async (id) => {
    const { addToCart } = await import('/js/cart.js');
    addToCart(id, 3);
  }, VIGENTE.id);

  caido = true;
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-app-mode', 'production');

  // El catálogo no llegó: no hay con qué reconciliar, así que el carrito espera
  // en vez de desaparecer. Un 503 del backend no es "el cliente vació su
  // carrito".
  await page.waitForTimeout(2500);
  expect(await lineasDelCarrito(page)).toEqual([`${VIGENTE.id}:3`]);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}').cart?.length ?? -1, CART_KEY)).toBe(1);
});

test('el carrito guardado vence y no reaparece semanas después', async ({ page }) => {
  await installProductionBackend(page);
  await page.goto('/#catalog');
  await esperarCatalogoProductivo(page);
  await page.evaluate(async (id) => {
    const { addToCart } = await import('/js/cart.js');
    addToCart(id, 1);
  }, VIGENTE.id);
  expect(await lineasDelCarrito(page)).toHaveLength(1);

  await page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key));
    saved.savedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    localStorage.setItem(key, JSON.stringify(saved));
  }, CART_KEY);

  await page.reload();
  await esperarCatalogoProductivo(page);

  expect(await lineasDelCarrito(page)).toEqual([]);
  expect(await page.evaluate((key) => localStorage.getItem(key), CART_KEY)).toBeNull();
});
