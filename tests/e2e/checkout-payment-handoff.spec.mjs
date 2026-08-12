/*
 * El segundo toque en «Pagar con Mercado Pago».
 *
 * `window.location.assign()` PIDE la navegación y sigue: el documento sigue vivo
 * hasta que la página de Mercado Pago compromete, y en un teléfono con red mala
 * eso son segundos. En ese hueco corría el `finally` del checkout y devolvía el
 * botón a «Confirmar pedido», habilitado. Quien no ve reacción vuelve a tocar
 * —es el reflejo, no un error de la persona— y ese segundo toque creaba una
 * SEGUNDA sesión de pago.
 *
 * Por qué ninguna de las defensas existentes lo veía:
 *   - `createCheckoutClientRequestId()` devuelve un UUID NUEVO en cada llamada,
 *     así que la deduplicación por `client_request_id` del backend no la ve.
 *   - `mercadoPagoCheckoutInFlight` sólo funde llamadas CONCURRENTES; para
 *     cuando llega el segundo toque, la primera ya terminó.
 *   - `confirming` se apagaba en el `finally`, que es justamente el bug.
 *
 * Lo que dejaba atrás cada toque de más: otra fila en `checkout_sessions`, otra
 * reserva en `inventory_reservations` descontando stock del comercio, y el
 * registro local de recuperación pisado —que deja huérfana a la PRIMERA sesión,
 * con el stock tomado y sin nada del lado del cliente que sepa volver a
 * buscarla—.
 *
 * Acá no se toca Mercado Pago: el backend es de mentira y el destino externo se
 * responde localmente. No se crea ningún pago ni se mueve un peso.
 */
import { expect, test } from '@playwright/test';

const SUPABASE_URL = 'https://taba-checkout-handoff.supabase.co';
const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const ORIGEN_MP = 'https://www.mercadopago.com.ar';
const INIT_POINT = `${ORIGEN_MP}/checkout/v1/redirect?pref_id=E2E-SIN-PAGO`;

const PRODUCTO = {
  id: '30000000-0000-4000-8000-000000000001',
  external_id: 'AND-ROJA-473',
  sku: 'AND-ROJA-473',
  name: 'Cerveza Andes Origen Roja',
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

/**
 * Backend de mentira con Mercado Pago habilitado, que además CUENTA.
 *
 * `demoraDeLaFuncion` permite estirar la creación de la sesión: es el escenario
 * real —el checkout tarda, la persona toca de nuevo—.
 */
async function instalarBackend(page, { demoraDeLaFuncion = 0, demoraDelPedido = 0, rechazoDelPedido = null } = {}) {
  const llamadas = {
    sesiones: 0, preferencias: 0, pedidos: 0, requestIds: [], pedidoRequestIds: [],
  };

  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (body, headers = {}) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers,
      body: JSON.stringify(body),
    });

    if (url.pathname.includes('/functions/v1/mercadopago-create-checkout-session')) {
      llamadas.sesiones += 1;
      const enviado = JSON.parse(route.request().postData() || '{}');
      llamadas.requestIds.push(String(enviado.client_request_id || ''));
      if (demoraDeLaFuncion) await new Promise((resolve) => { setTimeout(resolve, demoraDeLaFuncion); });
      return json({
        ok: true,
        checkout: {
          checkout_session_id: `4f${String(llamadas.sesiones).padStart(2, '0')}0000-0000-4000-8000-000000000001`,
          expires_at: new Date(Date.now() + 900_000).toISOString(),
        },
      });
    }
    if (url.pathname.includes('/functions/v1/mercadopago-create-preference')) {
      llamadas.preferencias += 1;
      return json({ ok: true, init_point: INIT_POINT, expires_at: new Date(Date.now() + 900_000).toISOString() });
    }
    if (url.pathname.includes('/rest/v1/rpc/create_order_with_items')) {
      llamadas.pedidos += 1;
      const enviadoPedido = JSON.parse(route.request().postData() || '{}');
      llamadas.pedidoRequestIds.push(String(enviadoPedido?.payload?.client_request_id || ''));
      if (demoraDelPedido) await new Promise((resolve) => { setTimeout(resolve, demoraDelPedido); });
      if (rechazoDelPedido) {
        return route.fulfill({
          status: rechazoDelPedido.status,
          contentType: 'application/json',
          body: JSON.stringify({ message: rechazoDelPedido.message, code: rechazoDelPedido.code || 'P0001' }),
        });
      }
      return json({ order_id: '5f000000-0000-4000-8000-000000000001', code: 'LT-9001' });
    }
    if (url.pathname.includes('/rest/v1/rpc/get_mercadopago_checkout_availability')) {
      return json({
        available: true,
        environment: 'test',
        checkout_mode: 'checkout_pro',
        allow_offline_payment_methods: true,
        installments_limit: 6,
      });
    }
    if (url.pathname.includes('/rest/v1/products')) return json([PRODUCTO]);
    if (url.pathname.includes('/rest/v1/businesses')) return json(COMERCIO);
    if (url.pathname.includes('/rest/v1/rpc/get_public_business_contact')) {
      return json([{ whatsapp_number: '', whatsapp_verified: false }]);
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

  return llamadas;
}

/**
 * El destino externo no llega a comprometer: la navegación se cae.
 *
 * Es la forma honesta de dejar el documento de la tienda VIVO después de pedir
 * la navegación, que es exactamente el hueco donde vivía el defecto —y además es
 * un escenario real: se toca «Pagar», el teléfono pierde la red y la página de
 * Mercado Pago nunca aparece—. Con una navegación en curso, cualquier consulta a
 * la página se queda esperando y no se puede medir nada.
 *
 * `aborted` y no `connectionfailed`: el segundo hace que el navegador pinte SU
 * página de error, que se lleva puesto el documento de la tienda y deja la
 * prueba midiendo otra cosa.
 */
async function elDestinoExternoNoLlega(page) {
  await page.route(`${ORIGEN_MP}/**`, (route) => route.abort('aborted'));
}

async function abrirCheckoutConCarrito(page) {
  await page.goto('/#catalog');
  await expect(page.locator('body')).toHaveAttribute('data-app-mode', 'production');
  await expect
    .poll(() => page.evaluate(async () => {
      const { getState } = await import('/js/state.js');
      return getState().products.length;
    }), { timeout: 20_000 })
    .toBeGreaterThan(0);

  await page.evaluate(async (id) => {
    const { addToCart } = await import('/js/cart.js');
    addToCart(id, 2);
  }, PRODUCTO.id);

  await page.goto('/#cart');
  await expect(page.locator('[data-checkout-form]')).toBeVisible();
}

/*
 * Retiro en local a propósito: saca del medio la confirmación del punto de
 * entrega —que tiene su propia suite— y deja a la vista lo único que esta prueba
 * mide, que es cuántas sesiones de pago se crean.
 */
async function prepararPagoConMercadoPago(page) {
  await page.getByLabel('Retiro en local').check();
  await page.evaluate(() => {
    const form = document.querySelector('[data-checkout-form]');
    form.querySelector('[name="customerName"]').value = 'Cliente QA';
    form.querySelector('[name="customerPhone"]').value = '2995550000';
  });
  const formaDePago = page.getByLabel('Forma de pago');
  await expect(formaDePago.locator('option[value="mercadopago"]')).toHaveCount(1);
  await formaDePago.selectOption('mercadopago');
  return page.locator('[data-checkout-form] [type="submit"]');
}

test.describe('handoff a Mercado Pago', () => {
  // El arranque productivo de esta suite levanta el grafo de módulos entero
  // antes de poder tocar nada; con el plazo por defecto del gate, la primera
  // prueba del archivo se queda sin tiempo en el setup y no llega a medir.
  test.describe.configure({ timeout: 120_000 });

  test('el segundo toque durante la navegación NO crea una segunda sesión de pago', async ({ page }) => {
    const llamadas = await instalarBackend(page);
    await elDestinoExternoNoLlega(page);
    await abrirCheckoutConCarrito(page);
    const boton = await prepararPagoConMercadoPago(page);

    await boton.click();
    await expect.poll(() => llamadas.sesiones, { timeout: 15_000 }).toBe(1);

    // La persona no ve reacción —la navegación externa todavía no comprometió—
    // y vuelve a tocar. `force` porque un botón deshabilitado no se puede tocar
    // de la forma normal, y ESA es la defensa que se está midiendo.
    for (let i = 0; i < 3; i += 1) {
      await page.waitForTimeout(400);
      await boton.click({ force: true, noWaitAfter: true, timeout: 3_000 }).catch(() => undefined);
    }
    await page.waitForTimeout(1_200);

    expect(llamadas.sesiones, `se crearon ${llamadas.sesiones} sesiones de pago con client_request_id distintos: ${llamadas.requestIds.join(', ')}`).toBe(1);
    expect(llamadas.preferencias).toBe(1);
    expect(new Set(llamadas.requestIds).size).toBe(1);
  });

  test('mientras se prepara el pago el botón nunca vuelve a estar disponible', async ({ page }) => {
    const llamadas = await instalarBackend(page, { demoraDeLaFuncion: 1_500 });
    await elDestinoExternoNoLlega(page);
    await abrirCheckoutConCarrito(page);
    const boton = await prepararPagoConMercadoPago(page);

    await boton.click();

    // Durante toda la preparación y todo el handoff: deshabilitado y diciendo
    // qué está pasando. Un botón que vuelve a decir «Confirmar pedido» es una
    // invitación a tocar de nuevo.
    const estados = [];
    for (let i = 0; i < 12; i += 1) {
      estados.push(await boton.evaluate((n) => `${n.disabled ? 'off' : 'ON'}:${n.textContent.trim()}`));
      await page.waitForTimeout(300);
    }

    expect(estados.filter((estado) => estado.startsWith('ON')), `el botón volvió a estar disponible: ${estados.join(' | ')}`).toEqual([]);
    expect(llamadas.sesiones).toBe(1);
  });

  test('al volver de Mercado Pago el checkout se re-arma y se puede cambiar el medio de pago', async ({ page }) => {
    const llamadas = await instalarBackend(page);
    await elDestinoExternoNoLlega(page);
    await abrirCheckoutConCarrito(page);
    const boton = await prepararPagoConMercadoPago(page);

    await boton.click();
    await expect.poll(() => llamadas.sesiones, { timeout: 15_000 }).toBe(1);
    await expect(boton).toBeDisabled();

    // La vuelta: los tres eventos que dispara un regreso real, sea con «atrás»
    // o desde otra aplicación. El bloqueo tiene que soltarse, o el checkout
    // queda muerto y la persona no puede ni elegir efectivo.
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await expect(boton).toBeEnabled({ timeout: 10_000 });
    await expect(boton).toHaveText(/Confirmar pedido/);

    const formaDePago = page.getByLabel('Forma de pago');
    await formaDePago.selectOption('cash');
    await expect(formaDePago).toHaveValue('cash');

    // Y el carrito llegó intacto hasta acá.
    expect(await page.evaluate(async () => {
      const { getState } = await import('/js/state.js');
      return getState().cart.map((i) => `${i.productId}:${i.quantity}`);
    })).toEqual([`${PRODUCTO.id}:2`]);
  });

  /*
   * Los tres rechazos que el backend puede mandar en el último segundo, y que
   * son los que deciden si la persona entiende qué pasó o se queda mirando.
   *
   * En los tres, lo que NO puede pasar es lo mismo: perder el carrito. Un
   * rechazo del servidor no es «la persona vació su carrito», y quedarse sin
   * nada después de tocar Confirmar es la forma más rápida de perder la venta.
   * El botón además tiene que volver: un rechazo por stock se resuelve sacando
   * un producto y confirmando otra vez.
   */
  for (const caso of [
    {
      nombre: 'stock insuficiente',
      rechazo: { status: 400, message: 'producto no disponible: 30000000-0000-4000-8000-000000000001' },
      espera: /stock/i,
    },
    {
      nombre: 'el pedido cambió durante el envío',
      rechazo: { status: 409, message: 'client_request_id fingerprint mismatch' },
      espera: /cambió durante el envío/i,
    },
    {
      nombre: 'sesión vencida',
      rechazo: { status: 401, message: 'JWT expired' },
      espera: /sesión segura venció/i,
    },
  ]) {
    test(`el rechazo por ${caso.nombre} se dice, no se pierde el carrito y se puede reintentar`, async ({ page }) => {
      const llamadas = await instalarBackend(page, { rechazoDelPedido: caso.rechazo });
      await abrirCheckoutConCarrito(page);
      await page.getByLabel('Retiro en local').check();
      await page.evaluate(() => {
        const form = document.querySelector('[data-checkout-form]');
        form.querySelector('[name="customerName"]').value = 'Cliente QA';
        form.querySelector('[name="customerPhone"]').value = '2995550000';
      });
      await page.getByLabel('Forma de pago').selectOption('cash');
      const boton = page.locator('[data-checkout-form] [type="submit"]');

      await boton.click({ noWaitAfter: true });
      await expect.poll(() => llamadas.pedidos, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
      await page.waitForTimeout(1_200);

      // Se dice lo que pasó, en alguna superficie que la persona ve.
      const textoVisible = await page.evaluate(() => document.body.innerText);
      expect(textoVisible, `no se dijo nada sobre «${caso.nombre}»`).toMatch(caso.espera);

      // El carrito sobrevive.
      expect(await page.evaluate(async () => {
        const { getState } = await import('/js/state.js');
        return getState().cart.map((i) => `${i.productId}:${i.quantity}`);
      })).toEqual([`${PRODUCTO.id}:2`]);

      // Y se puede volver a intentar: el botón vuelve, habilitado y con su texto.
      await expect(boton).toBeEnabled({ timeout: 10_000 });
      await expect(boton).toHaveText(/Confirmar pedido/);
    });
  }

  test('si la navegación externa nunca salió, moverse por la tienda devuelve el checkout', async ({ page }) => {
    /*
     * El caso sin salida: se toca «Pagar», la navegación no llega a comprometer
     * y la persona sigue en el mismo documento. No hay `pageshow`, no hay
     * `focus` y no hay `visibilitychange` —nunca se fue a ningún lado—, así que
     * sin esto el checkout quedaba tomado para siempre y la venta muerta.
     * Lo primero que hace alguien en esa situación es tocar la barra de abajo.
     */
    const llamadas = await instalarBackend(page);
    await elDestinoExternoNoLlega(page);
    await abrirCheckoutConCarrito(page);
    const boton = await prepararPagoConMercadoPago(page);

    await boton.click();
    await expect.poll(() => llamadas.sesiones, { timeout: 15_000 }).toBe(1);
    await expect(boton).toBeDisabled();

    await page.evaluate(() => { window.location.hash = '#home'; });
    await page.waitForTimeout(600);
    await page.evaluate(() => { window.location.hash = '#cart'; });
    await page.waitForTimeout(600);

    await expect(boton).toBeEnabled({ timeout: 10_000 });
    await expect(boton).toHaveText(/Confirmar pedido/);
    expect(llamadas.sesiones, 'moverse por la tienda no puede crear otra sesión').toBe(1);
  });

  test('el doble toque sobre un backend lento tampoco duplica el pedido en efectivo', async ({ page }) => {
    // El otro medio de pago, con la misma mano humana: el backend tarda, no
    // pasa nada visible, se vuelve a tocar. Acá el pedido se crea de este lado,
    // así que un duplicado es un pedido de verdad para el comercio.
    const llamadas = await instalarBackend(page, { demoraDelPedido: 2_000 });
    await abrirCheckoutConCarrito(page);
    await page.getByLabel('Retiro en local').check();
    await page.evaluate(() => {
      const form = document.querySelector('[data-checkout-form]');
      form.querySelector('[name="customerName"]').value = 'Cliente QA';
      form.querySelector('[name="customerPhone"]').value = '2995550000';
    });
    await page.getByLabel('Forma de pago').selectOption('cash');
    const boton = page.locator('[data-checkout-form] [type="submit"]');

    await boton.click({ noWaitAfter: true });
    for (let i = 0; i < 4; i += 1) {
      await page.waitForTimeout(300);
      await boton.click({ force: true, noWaitAfter: true, timeout: 2_000 }).catch(() => undefined);
    }
    await page.waitForTimeout(2_500);

    /*
     * El pedido directo ya tiene su propia defensa, y es más profunda que la del
     * botón: `createOrder` conserva `pendingRequest` mientras el intento no
     * cerró bien, así que un reintento viaja con el MISMO `client_request_id` y
     * el backend lo reconoce como el mismo pedido. Lo que se fija acá es ESO —la
     * clave estable—, no el número de llamadas: una llamada de más con la misma
     * clave no es un pedido de más.
     *
     * La contracara es el hueco que queda anotado como deuda: el camino de
     * Mercado Pago NO tiene esta capa. `createCheckoutClientRequestId()` devuelve
     * un UUID nuevo cada vez y no se persiste, así que ahí la única defensa es la
     * del botón.
     */
    expect(llamadas.pedidos, 'no llegó a crearse ningún pedido').toBeGreaterThanOrEqual(1);
    expect(
      new Set(llamadas.pedidoRequestIds.filter(Boolean)).size,
      `se crearon pedidos distintos: ${llamadas.pedidoRequestIds.join(', ')}`,
    ).toBe(1);
  });
});
