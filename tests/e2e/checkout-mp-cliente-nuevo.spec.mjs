/*
 * Mercado Pago para un cliente NUEVO, en el mismo carrito.
 *
 * La disponibilidad de Mercado Pago es sólo de `authenticated`, por contrato
 * (mercadopago_availability_requires_seller: un visitante anónimo no la sondea).
 * Un cliente nuevo entra al carrito SIN sesión: la pregunta contesta 401 y la
 * tienda muestra sólo el pago a coordinar, que es la verdad para alguien sin
 * sesión. Cuando guarda «Tus datos» ahí mismo nace su sesión, y la tienda tiene
 * que volver a preguntar en ese momento: antes sólo preguntaba al ENTRAR al
 * carrito, así que Mercado Pago no aparecía hasta que la persona saliera y
 * volviera. Con el vendedor conectado, eso era perder el primer pago con tarjeta.
 *
 * Backend de mentira pero fiel al contrato: con la clave publicable (sin sesión)
 * la RPC contesta 401; con el token de la sesión anónima, «disponible».
 */
import { expect, test } from '@playwright/test';

const SUPABASE_URL = 'https://taba-mp-cliente-nuevo.supabase.co';
const BUSINESS_ID = '00000000-0000-4000-8000-000000000123';
const CLIENTE_ID = '10000000-0000-4000-8000-000000000123';
const TOKEN_DE_SESION = 'sesion-anonima-del-cliente';

const PRODUCTO = {
  id: '30000000-0000-4000-8000-000000000123', external_id: 'COCA-354', sku: 'COCA-354', name: 'Coca-Cola',
  brand: 'Coca-Cola', description: 'Producto verificado por el comercio.', category: 'Bebidas', subcategory: '',
  variant: 'Lata 354 ml', presentation: 'Lata 354 ml', capacity_value: 354, capacity_unit: 'ml', capacity: '354 ml',
  packaging_type: 'lata', units_per_pack: 1, price: 1800, price_status: 'confirmed', stock: 40, available: true,
  chilled: true, is_alcoholic: false, minimum_age: null, image_url: '/assets/catalog/placeholder.png', image_sha256: '',
  image_thumbnail_url: '/assets/catalog/placeholder.png', image_thumbnail_sha256: '', source_image_sha256: '', tags: [],
  sort_order: 1, is_active: true, is_verified: true,
};
const COMERCIO = {
  id: BUSINESS_ID, name: 'La Taba QA', address: 'Mendoza 827, Neuquén', currency_code: 'ARS', ordering_enabled: true,
  ordering_verified: true, delivery_enabled: true, pickup_enabled: true, delivery_fee: 900, minimum_delivery_subtotal: 0,
  is_active: true, status: 'open',
};

async function instalarBackend(page) {
  const backend = { preguntas: [] };
  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const rpc = url.pathname.match(/\/rest\/v1\/rpc\/([a-z0-9_]+)/)?.[1] || '';
    const conSesion = String(request.headers().authorization || '').includes(TOKEN_DE_SESION);

    if (rpc === 'get_mercadopago_checkout_availability') {
      backend.preguntas.push(conSesion ? 'con-sesion' : 'sin-sesion');
      if (!conSesion) return json({ code: '42501', message: 'permission denied for function get_mercadopago_checkout_availability' }, 401);
      return json({ available: true, environment: 'production', checkout_mode: 'checkout_pro',
        allow_offline_payment_methods: false, installments_limit: 1 });
    }
    if (rpc === 'upsert_current_customer_profile') {
      if (!conSesion) return json({ code: '42501', message: 'sin sesion' }, 401);
      const enviado = JSON.parse(request.postData() || '{}');
      return json({ id: CLIENTE_ID, name: enviado.p_name, phone: String(enviado.p_phone || '').replace(/\D/g, ''),
        lastOrderAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    }
    if (rpc === 'get_current_customer_profile') return json({ profile: null, addresses: [] });
    if (rpc === 'commerce_availability') {
      const { p_channel: canal = 'delivery' } = JSON.parse(request.postData() || '{}');
      return json({ business_id: BUSINESS_ID, channel: canal, ordering_ready: true, is_open: true, hours_enforced: false,
        coverage_enforced: false, next_open_at: null, hours: [], areas: [],
        delivery: canal === 'pickup' ? { eligible: false, reason: 'pickup', message: 'Retiro en el local.' }
          : { eligible: false, reason: 'out_of_coverage', message: 'Por el momento no realizamos entregas en esta zona.' } });
    }
    if (rpc === 'get_public_business_contact') return json([{ whatsapp_number: '', whatsapp_verified: false }]);
    if (url.pathname.includes('/rest/v1/products')) return json([PRODUCTO]);
    if (url.pathname.includes('/rest/v1/businesses')) return json(COMERCIO);
    if (url.pathname.includes('/auth/v1/')) {
      // La sesión anónima del cliente nace cuando guarda algo (signInAnonymously).
      return json({ access_token: TOKEN_DE_SESION, refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: CLIENTE_ID, is_anonymous: true, aud: 'authenticated' } });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '0-0/0' }, body: '[]' });
  });
  await page.addInitScript(({ supabaseUrl, businessId }) => {
    globalThis.__LA_TABA_RUNTIME_CONFIG__ = { mode: 'production',
      repository: { provider: 'supabase', supabaseUrl, publishableKey: 'sb_publishable_test_key', businessId } };
  }, { supabaseUrl: SUPABASE_URL, businessId: BUSINESS_ID });
  return backend;
}

test('cliente nuevo: Mercado Pago aparece al guardar «Tus datos», sin salir del carrito', async ({ page }) => {
  test.setTimeout(120_000);
  const backend = await instalarBackend(page);
  await page.goto('/#catalog');
  await expect(page.locator('body')).toHaveAttribute('data-app-mode', 'production');
  const agregar = page.locator('[data-view="catalog"] [data-add-product]:not([disabled])').first();
  await expect(agregar).toBeVisible({ timeout: 30_000 });
  await agregar.click();
  await page.locator('[data-open-cart]:visible').first().click();
  await expect(page.locator('[data-checkout-form]')).toBeVisible();
  await page.getByLabel('Retiro en local').check();

  // Sin sesión: la pregunta contesta 401 y Mercado Pago no se ofrece.
  const medio = page.locator('[name="paymentMethod"]');
  await expect.poll(() => backend.preguntas).toContain('sin-sesion');
  await expect(medio).toHaveAttribute('data-mercadopago-available', 'false');
  await expect(medio.locator('option[value="mercadopago"]')).toHaveCount(0);

  // Guarda sus datos en el carrito: nace la sesión y la tienda vuelve a preguntar.
  const formulario = page.locator('[data-profile-identity-form]');
  await expect(formulario).toBeVisible({ timeout: 15_000 });
  await formulario.locator('[name="checkoutIdentityName"]').fill('Marco');
  await formulario.locator('[name="checkoutIdentityPhone"]').fill('299 555 0123');
  await formulario.locator('[data-profile-checkout-action="save-identity"]').click();
  await expect(page.locator('[data-profile-summary] [data-profile-name]')).toHaveText('Marco', { timeout: 15_000 });

  await expect.poll(() => backend.preguntas, { timeout: 15_000 }).toContain('con-sesion');
  await expect(medio).toHaveAttribute('data-mercadopago-available', 'true');
  await expect(medio.locator('option[value="mercadopago"]')).toHaveCount(1);
  await expect(page.locator('body')).toHaveAttribute('data-active-view', 'cart');
});
