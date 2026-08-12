/*
 * El carrito con dos pestañas abiertas.
 *
 * Pasa de verdad: se abre la tienda, se manda el link por WhatsApp, se abre otra
 * vez desde el chat, y quedan dos pestañas contra el mismo `localStorage`. La
 * suite de persistencia (`production-cart-persistence`) cubre una sola pestaña:
 * recargar, reconciliar contra el catálogo, vencer a las 72 h y no vaciarse por
 * un 503. Ninguna de esas mira qué pasa cuando hay dos.
 *
 * Lo que se exige acá es lo comercialmente serio, no una sincronización en vivo:
 *   · la pestaña que se abre DESPUÉS ve lo que la primera guardó;
 *   · ninguna pestaña puede quedar con un producto que la persona no puso;
 *   · y sobre todo: abrir una segunda pestaña NO puede dejar el carrito vacío.
 *     Perder una línea agregada en paralelo es un empate desprolijo; perder el
 *     carrito entero es perder la venta.
 */
import { expect, test } from '@playwright/test';

const SUPABASE_URL = 'https://taba-cart-two-tabs.supabase.co';
const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const CLAVE_CARRITO = 'la_taba_production_cart_v1';

function producto(id, name, sortOrder) {
  return {
    id,
    external_id: id.slice(-8),
    sku: id.slice(-8),
    name,
    brand: 'Andes',
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
    price: 2400,
    price_status: 'confirmed',
    stock: 40,
    available: true,
    chilled: true,
    is_alcoholic: false,
    minimum_age: null,
    image_url: '/assets/products/beverage-placeholder.svg',
    image_sha256: '',
    image_thumbnail_url: '/assets/products/beverage-placeholder.svg',
    image_thumbnail_sha256: '',
    source_image_sha256: '',
    tags: [],
    sort_order: sortOrder,
    is_active: true,
    is_verified: true,
  };
}

const UNO = producto('30000000-0000-4000-8000-000000000001', 'Cerveza Andes Origen Roja', 1);
const DOS = producto('30000000-0000-4000-8000-000000000002', 'Cerveza Imperial Golden', 2);
const COMERCIO = {
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

async function instalarBackend(destino) {
  await destino.route(`${SUPABASE_URL}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (body, headers = {}) => route.fulfill({
      status: 200, contentType: 'application/json', headers, body: JSON.stringify(body),
    });
    if (url.pathname.includes('/rest/v1/products')) return json([UNO, DOS]);
    if (url.pathname.includes('/rest/v1/businesses')) return json(COMERCIO);
    if (url.pathname.includes('/rest/v1/rpc/get_public_business_contact')) {
      return json([{ whatsapp_number: '', whatsapp_verified: false }]);
    }
    if (url.pathname.includes('/rest/v1/rpc/get_mercadopago_checkout_availability')) return json({ available: false });
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
  await destino.addInitScript(({ supabaseUrl, businessId }) => {
    globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
      mode: 'production',
      repository: { provider: 'supabase', supabaseUrl, publishableKey: 'sb_publishable_test_key', businessId },
    };
  }, { supabaseUrl: SUPABASE_URL, businessId: BUSINESS_ID });
}

async function abrirTienda(page) {
  await page.goto('/#catalog');
  await expect(page.locator('body')).toHaveAttribute('data-app-mode', 'production');
  await expect
    .poll(() => page.evaluate(async () => {
      const { getState } = await import('/js/state.js');
      return getState().products.length;
    }), { timeout: 20_000 })
    .toBeGreaterThan(0);
}

const lineas = (page) => page.evaluate(async () => {
  const { getState } = await import('/js/state.js');
  return getState().cart.map((i) => `${i.productId}:${i.quantity}`).sort();
});

const enDisco = (page) => page.evaluate((clave) => {
  const crudo = localStorage.getItem(clave);
  if (!crudo) return null;
  try {
    return JSON.parse(crudo).cart.map((i) => `${i.productId}:${i.quantity}`).sort();
  } catch (_) { return 'ILEGIBLE'; }
}, CLAVE_CARRITO);

const agregar = (page, id, cantidad) => page.evaluate(async ([producto_, n]) => {
  const { addToCart } = await import('/js/cart.js');
  addToCart(producto_, n);
}, [id, cantidad]);

test.describe('carrito con dos pestañas', () => {
  test.describe.configure({ timeout: 120_000 });

  test('la pestaña que se abre después ve el carrito que dejó la primera', async ({ context }) => {
    await instalarBackend(context);
    const primera = await context.newPage();
    await abrirTienda(primera);
    await agregar(primera, UNO.id, 2);
    await expect.poll(() => enDisco(primera)).toEqual([`${UNO.id}:2`]);

    const segunda = await context.newPage();
    await abrirTienda(segunda);

    expect(await lineas(segunda), 'la segunda pestaña arrancó sin el carrito que ya existía').toEqual([`${UNO.id}:2`]);
    await segunda.close();
  });

  test('abrir una segunda pestaña NO vacía el carrito de la primera', async ({ context }) => {
    await instalarBackend(context);
    const primera = await context.newPage();
    await abrirTienda(primera);
    await agregar(primera, UNO.id, 2);
    await expect.poll(() => enDisco(primera)).toEqual([`${UNO.id}:2`]);

    // La segunda pestaña arranca, hidrata y persiste su propio estado. Ese
    // guardado es el que podría pisar el disco con un carrito vacío.
    const segunda = await context.newPage();
    await abrirTienda(segunda);
    await segunda.waitForTimeout(1_500);

    expect(await enDisco(segunda), 'la segunda pestaña dejó el disco vacío').not.toEqual([]);
    expect(await enDisco(segunda)).not.toBeNull();
    expect(await lineas(primera), 'la primera pestaña perdió el carrito al abrirse otra').toEqual([`${UNO.id}:2`]);
    await segunda.close();
  });

  test('lo que agrega cada pestaña queda registrado, y ninguna inventa productos', async ({ context }) => {
    await instalarBackend(context);
    const primera = await context.newPage();
    await abrirTienda(primera);
    await agregar(primera, UNO.id, 1);
    await expect.poll(() => enDisco(primera)).toEqual([`${UNO.id}:1`]);

    const segunda = await context.newPage();
    await abrirTienda(segunda);
    await agregar(segunda, DOS.id, 3);
    await segunda.waitForTimeout(800);

    const disco = await enDisco(segunda);
    // La segunda hidrató de disco antes de agregar, así que su guardado tiene
    // las dos líneas. Lo que NO puede pasar es que aparezca un producto que
    // nadie puso o una cantidad que nadie eligió.
    expect(disco).toContain(`${DOS.id}:3`);
    for (const linea of disco) {
      const [id, cantidad] = linea.split(':');
      expect([UNO.id, DOS.id], `apareció un producto que nadie agregó: ${id}`).toContain(id);
      expect(Number(cantidad), `cantidad inventada en ${id}`).toBeGreaterThan(0);
    }

    // Y la primera, al recargar, recoge el estado del disco sin perder lo suyo.
    await primera.reload();
    await abrirTienda(primera);
    expect(await lineas(primera), 'al recargar, la primera pestaña perdió su propia línea').toContain(`${UNO.id}:1`);
    await segunda.close();
  });
});
