/*
 * QA-401 — «Ingresá un nombre de al menos 2 caracteres» con el perfil a la vista.
 *
 * Reproducido 3/3 en Staging (bcea25f) el 2026-09-27: el cliente escribía su
 * nombre y su WhatsApp en el checkout, tocaba «Guardar y continuar», la tarjeta
 * «Tus datos» mostraba el perfil guardado —el upsert contestaba 200— y
 * «Confirmar pedido» contestaba que faltaba el nombre, sin llegar a pedir nada
 * al servidor. La validación recibía "": el pedido lee los ocultos
 * `customerName`/`customerPhone` del formulario, y guardar en línea sólo
 * actualizaba la tarjeta. Recargar lo «arreglaba», porque la carga del perfil
 * era el único camino que copiaba el perfil a esos ocultos.
 *
 * Por qué ninguna suite lo vio: las productivas escriben esos ocultos a mano
 * antes de confirmar —se salteaban exactamente la costura rota— y la de
 * fricción mínima guarda en línea pero nunca confirma. Acá NO se escribe ningún
 * oculto: el nombre entra por donde entra el de un cliente, y lo que se mide es
 * lo que llega al servidor.
 *
 * El backend es de mentira pero fiel: `upsert_current_customer_profile` valida y
 * normaliza como la base (20260729150000), `get_current_customer_profile`
 * devuelve lo guardado y `create_order_with_items` anota cada payload. No se
 * toca Staging ni producción.
 */
import { expect, test } from '@playwright/test';

const SUPABASE_URL = 'https://taba-qa401-perfil.supabase.co';
const BUSINESS_ID = '00000000-0000-4000-8000-000000000401';
const CLIENTE_ID = '10000000-0000-4000-8000-000000000401';
const TELEFONO_QA = '299 555 0401';
const TELEFONO_QA_DIGITOS = '2995550401';
const MENSAJE_QA_401 = 'Ingresá un nombre de al menos 2 caracteres.';

const PRODUCTO = {
  id: '30000000-0000-4000-8000-000000000401',
  external_id: 'COCA-354',
  sku: 'COCA-354',
  name: 'Coca-Cola',
  brand: 'Coca-Cola',
  description: 'Producto verificado por el comercio.',
  category: 'Bebidas',
  subcategory: '',
  variant: 'Lata 354 ml',
  presentation: 'Lata 354 ml',
  capacity_value: 354,
  capacity_unit: 'ml',
  capacity: '354 ml',
  packaging_type: 'lata',
  units_per_pack: 1,
  price: 1800,
  price_status: 'confirmed',
  stock: 40,
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
  sort_order: 1,
  is_active: true,
  is_verified: true,
};

const COMERCIO = {
  id: BUSINESS_ID,
  name: 'La Taba QA',
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

/**
 * Backend con memoria: lo que se guarda en el perfil es lo que la carga
 * devuelve después, incluso tras recargar la página.
 */
async function instalarBackend(page, { demoraDelPedido = 0, coberturaDelivery = false } = {}) {
  const backend = { perfil: null, guardados: [], direcciones: [], pedidos: [] };

  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200, headers = {}) => route.fulfill({
      status,
      contentType: 'application/json',
      headers,
      body: JSON.stringify(body),
    });
    const rpc = url.pathname.match(/\/rest\/v1\/rpc\/([a-z0-9_]+)/)?.[1] || '';

    if (rpc === 'upsert_current_customer_profile') {
      const enviado = JSON.parse(request.postData() || '{}');
      backend.guardados.push({ p_name: enviado.p_name, p_phone: enviado.p_phone });
      // Las mismas reglas que la base: btrim, espacios colapsados, 2 a 80
      // caracteres con letras, y un teléfono de 10 a 13 dígitos no repetidos.
      const nombre = String(enviado.p_name || '').trim().replace(/\s+/g, ' ');
      const telefono = String(enviado.p_phone || '').replace(/\D/g, '');
      if (nombre.length < 2 || nombre.length > 80 || !/\p{L}/u.test(nombre)) {
        return json({ code: '22023', message: 'nombre invalido: usa entre 2 y 80 caracteres e incluye letras' }, 400);
      }
      if (!/^\d{10,13}$/.test(telefono) || /^(\d)\1+$/.test(telefono)) {
        return json({ code: '22023', message: 'telefono argentino invalido' }, 400);
      }
      const ahora = new Date().toISOString();
      backend.perfil = {
        id: CLIENTE_ID,
        name: nombre,
        phone: telefono,
        lastOrderAt: null,
        createdAt: backend.perfil?.createdAt || ahora,
        updatedAt: ahora,
      };
      return json(backend.perfil);
    }
    if (rpc === 'get_current_customer_profile') {
      return json({ profile: backend.perfil, addresses: backend.direcciones });
    }
    if (rpc === 'upsert_current_customer_address') {
      // La base exige el cliente ANTES que la dirección.
      if (!backend.perfil) return json({ code: 'P0001', message: 'guardá primero tu nombre y telefono' }, 400);
      const { p_address: direccion = {} } = JSON.parse(request.postData() || '{}');
      const guardada = {
        ...direccion,
        id: direccion.id || '20000000-0000-4000-8000-000000000401',
        formattedAddress: `${direccion.street} ${direccion.streetNumber}, ${direccion.city}`,
        isDefault: true,
      };
      backend.direcciones = [guardada];
      return json({ ok: true, address: guardada });
    }
    if (rpc === 'create_order_with_items') {
      const payload = JSON.parse(request.postData() || '{}').payload || {};
      backend.pedidos.push(payload);
      if (demoraDelPedido) await new Promise((resolve) => { setTimeout(resolve, demoraDelPedido); });
      // La fila que devuelve la base: sin `id` el repositorio no da el pedido
      // por creado, y la prueba mediría otra cosa.
      const ahora = new Date().toISOString();
      return json({
        id: '5f000000-0000-4000-8000-000000000401',
        business_id: BUSINESS_ID,
        public_code: 'LT-0401',
        status: 'received',
        client_request_id: payload.client_request_id,
        customer_name: payload.customer_name,
        customer_phone: payload.customer_phone,
        delivery_mode: payload.delivery_mode,
        payment_method: payload.payment_method,
        payment_status: 'pending',
        subtotal: PRODUCTO.price,
        delivery_fee: payload.delivery_mode === 'delivery' ? COMERCIO.delivery_fee : 0,
        total: PRODUCTO.price + (payload.delivery_mode === 'delivery' ? COMERCIO.delivery_fee : 0),
        ...(payload.delivery_mode === 'delivery' ? { delivery_code: '4821' } : {}),
        created_at: ahora,
        updated_at: ahora,
        order_items: [{
          product_id: PRODUCTO.id,
          name: PRODUCTO.name,
          quantity: 1,
          unit_price: PRODUCTO.price,
          line_total: PRODUCTO.price,
        }],
      });
    }
    if (rpc === 'commerce_availability') {
      // Abierto, como el comercio de Staging cuando QA lo reprodujo. Sin esto la
      // respuesta genérica se lee como «cerrado» y bloquea por otro motivo.
      const { p_channel: canal = 'delivery' } = JSON.parse(request.postData() || '{}');
      return json({
        business_id: BUSINESS_ID,
        channel: canal,
        ordering_ready: true,
        is_open: true,
        hours_enforced: false,
        coverage_enforced: false,
        next_open_at: null,
        hours: [],
        areas: [],
        delivery: canal === 'pickup'
          ? { eligible: false, reason: 'pickup', message: 'Retiro en el local.' }
          : coberturaDelivery
            ? {
              eligible: true,
              reason: 'ok',
              zone_name: 'Centro',
              delivery_fee: COMERCIO.delivery_fee,
              minimum_subtotal: 0,
              message: null,
            }
            : { eligible: false, reason: 'out_of_coverage', message: 'Por el momento no realizamos entregas en esta zona.' },
      });
    }
    if (rpc === 'get_mercadopago_checkout_availability') return json({ available: false });
    if (rpc === 'get_public_business_contact') return json([{ whatsapp_number: '', whatsapp_verified: false }]);
    if (url.pathname.includes('/rest/v1/products')) return json([PRODUCTO]);
    if (url.pathname.includes('/rest/v1/businesses')) return json(COMERCIO);
    if (url.pathname.includes('/auth/v1/')) {
      return json({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: CLIENTE_ID, is_anonymous: true, aud: 'authenticated' },
      });
    }
    return json([], 200, { 'content-range': '0-0/0' });
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

  return backend;
}

/** Catálogo → un producto → carrito → retiro en local, como QA. */
async function llegarAlCheckoutConUnProducto(page, { retiro = true } = {}) {
  await page.goto('/#catalog');
  await expect(page.locator('body')).toHaveAttribute('data-app-mode', 'production');
  const agregar = page.locator('[data-view="catalog"] [data-add-product]:not([disabled])').first();
  await expect(agregar).toBeVisible({ timeout: 30_000 });
  await agregar.click();
  await expect.poll(() => page.evaluate(async () => {
    const { getState } = await import('/js/state.js');
    return getState().cart.map((item) => `${item.productId}:${item.quantity}`);
  })).toEqual([`${PRODUCTO.id}:1`]);

  await page.locator('[data-open-cart]:visible').first().click();
  await expect(page.locator('[data-checkout-form]')).toBeVisible();
  if (retiro) await page.getByLabel('Retiro en local').check();
}

async function guardarIdentidadEnLinea(page, nombre, telefono = TELEFONO_QA) {
  const formulario = page.locator('[data-profile-identity-form]');
  await expect(formulario).toBeVisible({ timeout: 15_000 });
  await formulario.locator('[name="checkoutIdentityName"]').fill(nombre);
  await formulario.locator('[name="checkoutIdentityPhone"]').fill(telefono);
  await formulario.locator('[data-profile-checkout-action="save-identity"]').click();
}

async function confirmarPedido(page) {
  const boton = page.locator('[data-checkout-submit]');
  await expect(boton).toBeEnabled();
  await boton.click();
}

/**
 * Lo que QA-401 mide: el pedido SALE, con el nombre que la pantalla muestra, y
 * el mensaje del defecto no aparece en ningún lado.
 */
async function esperarPedidoConNombre(page, backend, nombreEsperado, { modalidad = 'pickup' } = {}) {
  await expect.poll(() => backend.pedidos.length, {
    message: 'Confirmar pedido no pidió crear ningún pedido (QA-401)',
    timeout: 15_000,
  }).toBe(1);
  const [pedido] = backend.pedidos;
  expect(pedido.customer_name).toBe(nombreEsperado);
  expect(pedido.customer_phone).toBe(TELEFONO_QA_DIGITOS);
  expect(pedido.delivery_mode).toBe(modalidad);
  expect(pedido.items).toEqual([{ product_id: PRODUCTO.id, quantity: 1 }]);
  await expect(page.locator('body')).toHaveAttribute('data-active-view', 'tracking', { timeout: 15_000 });
  await expect(page.getByText(MENSAJE_QA_401)).toHaveCount(0);
}

test.describe('QA-401 · el perfil que se guarda en el checkout es el que viaja en el pedido', () => {
  test.describe.configure({ timeout: 120_000 });

  test('«Marco»: guardar y confirmar crea el pedido con ese nombre', async ({ page }) => {
    const backend = await instalarBackend(page);
    await llegarAlCheckoutConUnProducto(page);

    await guardarIdentidadEnLinea(page, 'Marco');
    // La pantalla refleja el perfil guardado…
    await expect(page.locator('[data-profile-summary] [data-profile-name]')).toHaveText('Marco');
    await expect(page.locator('[data-profile-summary] [data-profile-phone]')).toHaveText(TELEFONO_QA);
    expect(backend.guardados).toEqual([{ p_name: 'Marco', p_phone: TELEFONO_QA_DIGITOS }]);

    // …y confirmar usa ESE perfil.
    await confirmarPedido(page);
    await esperarPedidoConNombre(page, backend, 'Marco');
  });

  test('«Ma»: dos caracteres alcanzan', async ({ page }) => {
    const backend = await instalarBackend(page);
    await llegarAlCheckoutConUnProducto(page);

    await guardarIdentidadEnLinea(page, 'Ma');
    await expect(page.locator('[data-profile-summary] [data-profile-name]')).toHaveText('Ma');

    await confirmarPedido(page);
    await esperarPedidoConNombre(page, backend, 'Ma');
  });

  test('«M»: no se guarda, se dice junto al campo y no sale ningún pedido', async ({ page }) => {
    const backend = await instalarBackend(page);
    await llegarAlCheckoutConUnProducto(page);

    await guardarIdentidadEnLinea(page, 'M');
    // El rechazo aparece donde está el campo que lo resuelve, y lo escrito queda.
    const formulario = page.locator('[data-profile-identity-form]');
    await expect(formulario.locator('.profile-checkout-identity-error')).toHaveText(MENSAJE_QA_401);
    await expect(formulario.locator('[name="checkoutIdentityName"]')).toHaveValue('M');
    await expect(page.locator('[data-profile-summary]')).toHaveCount(0);
    expect(backend.guardados, 'un nombre inválido no puede llegar al servidor').toEqual([]);

    await page.locator('[data-checkout-submit]').click();
    await expect(page.locator('[data-checkout-warning]')).toBeVisible();
    await page.waitForTimeout(1_000);
    expect(backend.pedidos, 'con un nombre inválido no puede salir ningún pedido').toEqual([]);
    await expect(page.locator('body')).toHaveAttribute('data-active-view', 'cart');
  });

  test('«  Marco  »: se normaliza como en la base y el pedido viaja como «Marco»', async ({ page }) => {
    const backend = await instalarBackend(page);
    await llegarAlCheckoutConUnProducto(page);

    await guardarIdentidadEnLinea(page, '  Marco  ');
    await expect(page.locator('[data-profile-summary] [data-profile-name]')).toHaveText('Marco');
    expect(backend.guardados).toEqual([{ p_name: 'Marco', p_phone: TELEFONO_QA_DIGITOS }]);

    await confirmarPedido(page);
    await esperarPedidoConNombre(page, backend, 'Marco');
  });

  test('guardar, recargar y confirmar: el perfil y el carrito sobreviven', async ({ page }) => {
    const backend = await instalarBackend(page);
    await llegarAlCheckoutConUnProducto(page);
    await guardarIdentidadEnLinea(page, 'Marco');
    await expect(page.locator('[data-profile-summary] [data-profile-name]')).toHaveText('Marco');

    await page.reload();
    await expect(page.locator('[data-checkout-form]')).toBeVisible({ timeout: 30_000 });
    // La modalidad no se recuerda entre recargas (QA lo anotó): se elige otra vez.
    await page.getByLabel('Retiro en local').check();
    await expect(page.locator('[data-profile-summary] [data-profile-name]')).toHaveText('Marco', { timeout: 15_000 });
    expect(await page.evaluate(async () => {
      const { getState } = await import('/js/state.js');
      return getState().cart.map((item) => `${item.productId}:${item.quantity}`);
    })).toEqual([`${PRODUCTO.id}:1`]);

    await confirmarPedido(page);
    await esperarPedidoConNombre(page, backend, 'Marco');
  });

  test('doble toque en «Confirmar pedido»: un solo pedido', async ({ page }) => {
    // El backend tarda, como una red mala: es cuando la persona vuelve a tocar.
    const backend = await instalarBackend(page, { demoraDelPedido: 2_000 });
    await llegarAlCheckoutConUnProducto(page);
    await guardarIdentidadEnLinea(page, 'Marco');
    await expect(page.locator('[data-profile-summary] [data-profile-name]')).toHaveText('Marco');

    const boton = page.locator('[data-checkout-submit]');
    await boton.dblclick();
    for (let i = 0; i < 3; i += 1) {
      await page.waitForTimeout(250);
      await boton.click({ force: true, noWaitAfter: true, timeout: 1_000 }).catch(() => undefined);
    }

    await esperarPedidoConNombre(page, backend, 'Marco');
    await page.waitForTimeout(1_000);
    expect(backend.pedidos, 'el doble toque creó más de un pedido').toHaveLength(1);
    expect(new Set(backend.pedidos.map((pedido) => pedido.client_request_id)).size).toBe(1);
  });

  /*
   * La misma costura, por la otra puerta: con delivery, un cliente nuevo puede
   * dar su nombre DENTRO del editor de direcciones, que lo guarda antes que la
   * dirección. Ese guardado también cambiaba la tarjeta sin tocar los ocultos.
   */
  test('delivery: el nombre guardado desde el editor de direcciones viaja en el pedido', async ({ page, context }) => {
    const backend = await instalarBackend(page, { coberturaDelivery: true });
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: -38.9539, longitude: -68.0596, accuracy: 12 });
    await llegarAlCheckoutConUnProducto(page, { retiro: false });

    await page.locator('[data-profile-checkout-action="new-address"]').first().click();
    const editor = page.locator('[data-address-capture="checkout"]');
    await expect(editor).toBeVisible();
    await editor.locator('[name="captureCustomerName"]').fill('Marco');
    await editor.locator('[name="captureCustomerPhone"]').fill(TELEFONO_QA);
    await editor.locator('[name="captureAddressStreet"]').fill('Antártida Argentina');
    await editor.locator('[name="captureAddressNumber"]').fill('1450');
    const paso = editor.locator('[data-location-step]');
    await paso.locator('[data-profile-action="use-location"]').click();
    await expect(paso).toHaveAttribute('data-location-status', 'pending');
    await paso.locator('[data-profile-action="confirm-location"]').click();
    await expect(paso).toHaveAttribute('data-location-status', 'confirmed');
    await editor.locator('[data-address-capture-save]').click();

    await expect(page.locator('[data-profile-summary] [data-profile-name]')).toHaveText('Marco', { timeout: 15_000 });
    expect(backend.guardados).toEqual([{ p_name: 'Marco', p_phone: TELEFONO_QA_DIGITOS }]);
    expect(backend.direcciones).toHaveLength(1);

    await confirmarPedido(page);
    await esperarPedidoConNombre(page, backend, 'Marco', { modalidad: 'delivery' });
  });
});

test.describe('QA-401 · teléfono 390×844', () => {
  test.describe.configure({ timeout: 120_000 });
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('guardar en línea y confirmar crea el pedido, sin desbordar', async ({ page }) => {
    const backend = await instalarBackend(page);
    await llegarAlCheckoutConUnProducto(page);

    await guardarIdentidadEnLinea(page, 'Marco');
    await expect(page.locator('[data-profile-summary] [data-profile-name]')).toHaveText('Marco');
    const desborde = await page.evaluate(() => (
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    ));
    expect(desborde, `la pantalla desborda ${desborde}px a lo ancho`).toBeLessThanOrEqual(1);

    const boton = page.locator('[data-checkout-submit]');
    await boton.scrollIntoViewIfNeeded();
    await boton.tap();
    await esperarPedidoConNombre(page, backend, 'Marco');
  });
});
