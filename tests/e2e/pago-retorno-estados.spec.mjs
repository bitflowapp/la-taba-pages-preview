/*
 * La pantalla a la que Mercado Pago devuelve a la persona después de pagar.
 *
 * Hasta acá el contrato de esta pantalla sólo se probaba contra el banco de
 * cobros (por HTTP) y en pruebas de unidad de `paymentStatusPresentation`; en un
 * navegador no había nada. Lo que se mide acá es lo que ve el cliente:
 *
 *   - la URL de retorno NO confirma nada: `?status=approved` con el servidor
 *     diciendo «pendiente» sigue mostrando «Pago pendiente»;
 *   - pendiente → aprobado se resuelve solo, sin recargar;
 *   - rechazo, revisión manual, sin conexión y servidor caído se dicen con su
 *     texto y no tocan el carrito;
 *   - lo que se pagó sale del carrito y lo que no, se queda (incluidos los
 *     combos, que viajan al servidor por identificador y vuelven expandidos a
 *     productos).
 *
 * El backend es de mentira: no se crea ningún pago ni se mueve un peso.
 */
import { expect, test } from '@playwright/test';

const SUPABASE_URL = 'https://taba-pago-retorno.supabase.co';
const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const CHECKOUT_ID = '4f010000-0000-4000-8000-000000000001';
const PRODUCTO_PAGADO = '30000000-0000-4000-8000-000000000001';
const PRODUCTO_NUEVO = '30000000-0000-4000-8000-000000000002';
const COMPONENTE_DEL_COMBO = '30000000-0000-4000-8000-000000000003';
const COMBO_PAGADO = 'combo-asado-de-la-casa';
const COMBO_NUEVO = 'combo-picada-para-cuatro';

const RECORD_KEY = `taba-mercadopago-checkout-v1:${BUSINESS_ID}`;
const CART_KEY = 'la_taba_production_cart_v1';

function checkout(extra = {}) {
  return {
    checkout_session_id: CHECKOUT_ID,
    status: 'payment_pending',
    payment_status: 'pending',
    order_public_code: null,
    items: [{ product_id: PRODUCTO_PAGADO, quantity: 2 }],
    ...extra,
  };
}

const COMPLETADO = checkout({
  status: 'completed',
  payment_status: 'completed',
  order_public_code: 'LT-9001',
});

/**
 * Responde `mercadopago-checkout-status` con una secuencia: cada consulta saca
 * la siguiente respuesta y la última se repite. `'caido'` aborta la conexión.
 */
async function instalarBackend(page, secuencia) {
  const llamadas = { estado: 0 };
  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (body, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
    if (url.pathname.includes('/functions/v1/mercadopago-checkout-status')) {
      const respuesta = secuencia[Math.min(llamadas.estado, secuencia.length - 1)];
      llamadas.estado += 1;
      if (respuesta === 'caido') return route.abort('failed');
      return json({ ok: true, checkout: respuesta });
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
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'content-range': '0-0/0' },
      body: '[]',
    });
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

/** Deja el navegador como lo dejó la tienda antes de redirigir a Mercado Pago. */
async function sembrar(page, { registro = { checkoutSessionId: CHECKOUT_ID }, carrito }) {
  await page.goto('/manifest.webmanifest');
  await page.evaluate(({ registroGuardado, carritoGuardado, recordKey, cartKey }) => {
    localStorage.clear();
    if (registroGuardado) {
      localStorage.setItem(recordKey, JSON.stringify({
        ...registroGuardado,
        updatedAt: new Date().toISOString(),
      }));
    }
    if (carritoGuardado) {
      localStorage.setItem(cartKey, JSON.stringify({
        schemaVersion: 2,
        savedAt: new Date().toISOString(),
        cart: carritoGuardado.cart || [],
        comboSelections: carritoGuardado.comboSelections || [],
      }));
    }
  }, { registroGuardado: registro, carritoGuardado: carrito, recordKey: RECORD_KEY, cartKey: CART_KEY });
}

function leerCarrito(page) {
  return page.evaluate((cartKey) => {
    const raw = localStorage.getItem(cartKey);
    if (!raw) return { cart: [], comboSelections: [] };
    const parsed = JSON.parse(raw);
    return { cart: parsed.cart || [], comboSelections: parsed.comboSelections || [] };
  }, CART_KEY);
}

const registroGuardado = (page) => page.evaluate((key) => localStorage.getItem(key), RECORD_KEY);

const titulo = (page) => page.locator('[data-payment-return-title]');
const detalle = (page) => page.locator('[data-payment-return-detail]');
const sello = (page) => page.locator('[data-payment-return-status]');
const accion = (page) => page.locator('[data-payment-return-action]');

test.describe('retorno de Mercado Pago', () => {
  test.describe.configure({ timeout: 60_000 });

  test('la URL de retorno no confirma nada: manda el servidor', async ({ page }) => {
    await instalarBackend(page, [checkout()]);
    await sembrar(page, { carrito: { cart: [{ productId: PRODUCTO_PAGADO, quantity: 2 }] } });

    await page.goto('/pago/resultado/?status=approved&collection_status=approved&payment_id=185029125913&external_reference=x');

    await expect(titulo(page)).toHaveText('Pago pendiente');
    await expect(sello(page)).toContainText('Seguiremos escuchando');
    await expect(titulo(page)).not.toHaveText('Pedido confirmado');
    await expect(accion(page)).toHaveText('Volver al carrito');
    expect((await leerCarrito(page)).cart).toEqual([{ productId: PRODUCTO_PAGADO, quantity: 2 }]);
    expect(await registroGuardado(page)).not.toBeNull();
  });

  test('pendiente que se aprueba: se confirma solo, saca lo pagado y conserva lo nuevo', async ({ page }) => {
    const llamadas = await instalarBackend(page, [checkout(), COMPLETADO]);
    await sembrar(page, {
      carrito: {
        cart: [
          { productId: PRODUCTO_PAGADO, quantity: 2 },
          { productId: PRODUCTO_NUEVO, quantity: 1 },
        ],
      },
    });

    await page.goto('/pago/resultado/');
    await expect(titulo(page)).toHaveText('Pago pendiente');

    await expect(titulo(page)).toHaveText('Pedido confirmado', { timeout: 15_000 });
    await expect(sello(page)).toHaveText('Pedido LT-9001');
    await expect(accion(page)).toHaveText('Ver seguimiento');
    await expect(accion(page)).toHaveAttribute('href', '../../#tracking');
    expect(llamadas.estado).toBe(2);
    expect((await leerCarrito(page)).cart).toEqual([{ productId: PRODUCTO_NUEVO, quantity: 1 }]);
    expect(await registroGuardado(page)).toBeNull();
  });

  test('pago rechazado: se dice, el carrito queda y se puede volver a intentar', async ({ page }) => {
    await instalarBackend(page, [checkout({ status: 'payment_pending', payment_status: 'rejected' })]);
    await sembrar(page, { carrito: { cart: [{ productId: PRODUCTO_PAGADO, quantity: 2 }] } });

    await page.goto('/pago/resultado/');

    await expect(titulo(page)).toHaveText('Pago rechazado');
    await expect(detalle(page)).toContainText('No se confirmó el pago');
    await expect(accion(page)).toHaveText('Volver al carrito');
    await expect(accion(page)).toHaveAttribute('href', '../../#cart');
    expect((await leerCarrito(page)).cart).toEqual([{ productId: PRODUCTO_PAGADO, quantity: 2 }]);
  });

  test('pago que el comercio tiene que revisar: no se promete un pedido', async ({ page }) => {
    await instalarBackend(page, [checkout({ status: 'manual_review_required', payment_status: 'approved_order_pending' })]);
    await sembrar(page, { carrito: { cart: [{ productId: PRODUCTO_PAGADO, quantity: 2 }] } });

    await page.goto('/pago/resultado/');

    await expect(titulo(page)).toHaveText('Necesitamos revisar este pago');
    await expect(sello(page)).toContainText('El negocio revisará el pago');
    expect((await leerCarrito(page)).cart).toEqual([{ productId: PRODUCTO_PAGADO, quantity: 2 }]);
  });

  test('servidor inalcanzable: sigue «Verificando», nunca confirma y se recupera solo', async ({ page }) => {
    const llamadas = await instalarBackend(page, ['caido', COMPLETADO]);
    await sembrar(page, { carrito: { cart: [{ productId: PRODUCTO_PAGADO, quantity: 2 }] } });

    await page.goto('/pago/resultado/');

    await expect(titulo(page)).toHaveText('Verificando el pago');
    await expect.poll(() => llamadas.estado, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
    await expect(titulo(page)).not.toHaveText('Pedido confirmado');
    expect((await leerCarrito(page)).cart).toEqual([{ productId: PRODUCTO_PAGADO, quantity: 2 }]);

    await expect(titulo(page)).toHaveText('Pedido confirmado', { timeout: 15_000 });
    expect((await leerCarrito(page)).cart).toEqual([]);
  });

  test('sin conexión: se dice, el carrito queda y al volver la red se verifica', async ({ page }) => {
    const llamadas = await instalarBackend(page, [COMPLETADO]);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => !globalThis.__SIN_RED__ });
      globalThis.__SIN_RED__ = true;
    });
    await sembrar(page, { carrito: { cart: [{ productId: PRODUCTO_PAGADO, quantity: 2 }] } });

    await page.goto('/pago/resultado/');

    await expect(titulo(page)).toHaveText('Pago pendiente');
    await expect(detalle(page)).toContainText('Sin conexión');
    expect(llamadas.estado).toBe(0);
    expect((await leerCarrito(page)).cart).toEqual([{ productId: PRODUCTO_PAGADO, quantity: 2 }]);

    await page.evaluate(() => {
      globalThis.__SIN_RED__ = false;
      window.dispatchEvent(new Event('online'));
    });
    await expect(titulo(page)).toHaveText('Pedido confirmado', { timeout: 15_000 });
  });

  test('en otro navegador, sin la sesión guardada: no inventa un pedido', async ({ page }) => {
    const llamadas = await instalarBackend(page, [COMPLETADO]);
    await sembrar(page, { registro: null, carrito: { cart: [{ productId: PRODUCTO_PAGADO, quantity: 2 }] } });

    await page.goto('/pago/resultado/?status=approved&collection_status=approved');

    await expect(detalle(page)).toContainText('No encontramos una sesión de pago en este navegador');
    await expect(titulo(page)).not.toHaveText('Pedido confirmado');
    expect(llamadas.estado).toBe(0);
    expect((await leerCarrito(page)).cart).toEqual([{ productId: PRODUCTO_PAGADO, quantity: 2 }]);
  });

  /*
   * El combo viaja a `create-checkout-session` por identificador y el estado del
   * checkout lo devuelve ya expandido a productos, así que el cliente sólo puede
   * saber qué combos pagó si los guardó al iniciar el pago.
   */
  test('un combo pagado sale del carrito; otro combo agregado después se queda', async ({ page }) => {
    await instalarBackend(page, [checkout({
      status: 'completed',
      payment_status: 'completed',
      order_public_code: 'LT-9002',
      items: [{ product_id: COMPONENTE_DEL_COMBO, quantity: 3 }],
    })]);
    await sembrar(page, {
      registro: { checkoutSessionId: CHECKOUT_ID, combos: [{ comboId: COMBO_PAGADO, quantity: 1 }] },
      carrito: {
        cart: [],
        comboSelections: [
          { comboId: COMBO_PAGADO, quantity: 1 },
          { comboId: COMBO_NUEVO, quantity: 1 },
        ],
      },
    });

    await page.goto('/pago/resultado/');

    await expect(titulo(page)).toHaveText('Pedido confirmado');
    expect((await leerCarrito(page)).comboSelections).toEqual([{ comboId: COMBO_NUEVO, quantity: 1 }]);
    expect(await registroGuardado(page)).toBeNull();
  });
});
