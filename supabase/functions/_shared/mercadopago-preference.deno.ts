/*
 * EL IMPORTE QUE VIAJA A MERCADO PAGO.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 * ---------------------------
 * `preferenceRequest()` es donde se decide cuánto se le cobra a una persona.
 * Construye las líneas de la preferencia, agrega el envío y arma las URLs de
 * retorno y de notificación. Hasta acá no tenía NI UNA prueba: la aritmética
 * más importante del sistema de pagos se sostenía sola.
 *
 * Y ya falló una vez. `items` llevaba sólo los productos, así que el envío no
 * llegaba a Mercado Pago: se le cobraba el subtotal a quien compraba mientras
 * el `payment_intent` esperaba el total. Eso es cobrar de menos y, además,
 * hace fallar la aserción `amount_mismatch` cuando el pago vuelve —el pedido
 * queda en revisión de seguridad y nadie lo prepara—. El comentario que
 * explica el arreglo está en el código; lo que faltaba era la medición.
 *
 * Estas pruebas fijan las dos direcciones del error: que el total que se cobra
 * sea EXACTAMENTE el que el servidor calculó, y que un carrito cuyas líneas
 * superen ese total no se pueda cobrar en vez de cobrarse de más.
 */
import { preferenceRequest, type PreferencePreparation } from './mercadopago.ts';

const BASE = 'https://la-taba.pages.dev';
const SUPABASE = 'https://proyecto.supabase.co';

function prepararEntorno(entorno: 'test' | 'production', autorizado = false) {
  Deno.env.set('MERCADOPAGO_ENVIRONMENT', entorno);
  Deno.env.set('TABA_CHECKOUT_BASE_URL', BASE);
  Deno.env.set('SUPABASE_URL', SUPABASE);
  if (entorno === 'production') {
    Deno.env.set('MERCADOPAGO_PRODUCTION_REVIEW_STATUS', 'approved');
    if (autorizado) {
      Deno.env.set(
        'MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION',
        'I_AUTHORIZE_REAL_MERCADOPAGO_PAYMENT_SMOKE',
      );
    } else {
      Deno.env.delete('MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION');
    }
  } else {
    Deno.env.delete('MERCADOPAGO_PRODUCTION_REVIEW_STATUS');
    Deno.env.delete('MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION');
  }
}

function preparacion(overrides: Partial<PreferencePreparation> = {}): PreferencePreparation {
  return {
    checkout_session_id: '4f000000-0000-4000-8000-000000000001',
    payment_intent_id: '4f000000-0000-4000-8000-000000000002',
    payment_attempt_id: '4f000000-0000-4000-8000-000000000003',
    attempt_status: 'preparing',
    attempt_number: 1,
    idempotency_key: 'clave-idempotente',
    preference_id: null,
    init_point: null,
    sandbox_init_point: null,
    external_reference: 'taba-test-4f000000',
    environment: 'test',
    currency: 'ARS',
    total: 12_300,
    expires_at: new Date(Date.now() + 900_000).toISOString(),
    items: [
      { id: 'p1', title: 'Coca-Cola Original 1,5 L', description: null, quantity: 2, currency_id: 'ARS', unit_price: 4_990 },
      { id: 'p2', title: 'Agua Villavicencio 500 ml', description: null, quantity: 1, currency_id: 'ARS', unit_price: 1_420 },
    ],
    allow_offline_payment_methods: false,
    installments_limit: 6,
    ...overrides,
  };
}

function sumaDeLineas(cuerpo: Record<string, unknown>): number {
  const items = cuerpo.items as Array<{ quantity: number; unit_price: number }>;
  return items.reduce((total, item) => total + item.unit_price * item.quantity, 0);
}

function assert(condicion: unknown, mensaje: string) {
  if (!condicion) throw new Error(mensaje);
}

function assertLanza(fn: () => unknown, mensaje: string) {
  let lanzo = false;
  try {
    fn();
  } catch (_) {
    lanzo = true;
  }
  if (!lanzo) throw new Error(mensaje);
}

Deno.test('el envío viaja como línea propia y el total cobrado es el del servidor', () => {
  prepararEntorno('test');
  // 2×4990 + 1×1420 = 11 400. El servidor calculó 12 300: los 900 de diferencia
  // son el envío, y tienen que llegar a Mercado Pago o se cobra de menos.
  const cuerpo = preferenceRequest(preparacion());
  const items = cuerpo.items as Array<{ id: string; unit_price: number; quantity: number }>;

  assert(items.length === 3, `se esperaban 3 líneas (2 productos + envío) y hay ${items.length}`);
  const envio = items.find((item) => item.id === 'taba-delivery-fee');
  assert(envio, 'la línea de envío no llegó a la preferencia');
  assert(envio!.unit_price === 900, `el envío cobrado es ${envio!.unit_price} y debería ser 900`);
  assert(
    sumaDeLineas(cuerpo) === 12_300,
    `la preferencia cobra ${sumaDeLineas(cuerpo)} y el servidor calculó 12 300`,
  );
});

Deno.test('sin diferencia no se inventa una línea de envío', () => {
  prepararEntorno('test');
  const cuerpo = preferenceRequest(preparacion({ total: 11_400 }));
  const items = cuerpo.items as Array<{ id: string }>;
  assert(items.length === 2, 'se agregó una línea de envío que no existe');
  assert(sumaDeLineas(cuerpo) === 11_400, 'el total cobrado dejó de coincidir');
});

Deno.test('un carrito cuyas líneas superan el total del servidor NO se cobra', () => {
  prepararEntorno('test');
  // El caso peligroso es el opuesto al del envío: si las líneas suman MÁS que
  // lo que el servidor calculó, cobrar sería cobrar de más. Se rechaza.
  assertLanza(
    () => preferenceRequest(preparacion({ total: 10_000 })),
    'una preferencia que cobra más que el total del servidor fue aceptada',
  );
});

Deno.test('el importe nunca sale del entorno equivocado', () => {
  prepararEntorno('test');
  assertLanza(
    () => preferenceRequest(preparacion({ environment: 'production' })),
    'una preparación productiva se aceptó en un proyecto de prueba',
  );
  assertLanza(
    () => preferenceRequest(preparacion({ total: 0 })),
    'un total en cero se aceptó',
  );
  assertLanza(
    () => preferenceRequest(preparacion({ total: -100 })),
    'un total negativo se aceptó',
  );
});

Deno.test('en producción hace falta la autorización explícita de pago real', () => {
  prepararEntorno('production', false);
  assertLanza(
    () => preferenceRequest(preparacion({ environment: 'production' })),
    'se armó una preferencia con plata real sin autorización explícita',
  );
  prepararEntorno('production', true);
  const cuerpo = preferenceRequest(preparacion({ environment: 'production' }));
  assert(sumaDeLineas(cuerpo) === 12_300, 'el total productivo no coincide');
});

Deno.test('una sesión vencida no puede generar una preferencia', () => {
  prepararEntorno('test');
  assertLanza(
    () => preferenceRequest(preparacion({ expires_at: new Date(Date.now() - 1_000).toISOString() })),
    'una sesión vencida generó una preferencia',
  );
  assertLanza(
    () => preferenceRequest(preparacion({ expires_at: 'no es una fecha' })),
    'una fecha inválida generó una preferencia',
  );
});

Deno.test('OAuth usa un webhook compartido sin business_id fijo para todos los comercios', () => {
  prepararEntorno('test');
  Deno.env.set('MERCADOPAGO_CREDENTIAL_MODE', 'oauth');
  try {
    for (const business of ['business-a', 'business-b']) {
      assert(preferenceRequest(preparacion(), business).notification_url === `${SUPABASE}/functions/v1/mercadopago-webhook`, 'la URL depende del comercio');
    }
  } finally {
    Deno.env.delete('MERCADOPAGO_CREDENTIAL_MODE');
  }
});

Deno.test('la preferencia lleva la referencia externa, el webhook y las tres vueltas', () => {
  prepararEntorno('test');
  const cuerpo = preferenceRequest(preparacion());

  assert(cuerpo.external_reference === 'taba-test-4f000000', 'la referencia externa no es la del servidor');
  assert(
    cuerpo.notification_url === `${SUPABASE}/functions/v1/mercadopago-webhook`,
    `notification_url quedó en ${cuerpo.notification_url}`,
  );
  const vueltas = cuerpo.back_urls as Record<string, string>;
  assert(vueltas.success === `${BASE}/pago/resultado`, `success quedó en ${vueltas.success}`);
  assert(vueltas.pending === `${BASE}/pago/pendiente`, `pending quedó en ${vueltas.pending}`);
  assert(vueltas.failure === `${BASE}/pago/error`, `failure quedó en ${vueltas.failure}`);
  // `auto_return` sólo es válido con `back_urls.success` definida —la API
  // responde «auto_return invalid. back_url.success must be defined»—, así que
  // las dos cosas viajan juntas o no viaja ninguna.
  assert(cuerpo.auto_return === 'approved', 'auto_return dejó de ser approved');
  assert(cuerpo.expires === true, 'la preferencia dejó de vencer');
});

Deno.test('el medio de pago offline y las cuotas salen de la configuración del comercio', () => {
  prepararEntorno('test');
  const sinOffline = preferenceRequest(preparacion()).payment_methods as Record<string, unknown>;
  const excluidos = sinOffline.excluded_payment_types as Array<{ id: string }>;
  assert(excluidos?.[0]?.id === 'ticket', 'no se excluyó el pago en efectivo cuando el comercio no lo permite');
  assert(sinOffline.installments === 6, 'el tope de cuotas no es el del comercio');

  const conOffline = preferenceRequest(preparacion({ allow_offline_payment_methods: true, installments_limit: null }));
  const metodos = conOffline.payment_methods as Record<string, unknown> | undefined;
  assert(!metodos, 'se mandaron restricciones de medio de pago que el comercio no puso');
});

Deno.test('toda línea se cobra en pesos, sin excepción', () => {
  prepararEntorno('test');
  const cuerpo = preferenceRequest(preparacion());
  for (const item of cuerpo.items as Array<{ currency_id: string }>) {
    assert(item.currency_id === 'ARS', `una línea se cobra en ${item.currency_id}`);
  }
});
