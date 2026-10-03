// Lo último que lee una persona cuando su compra no entra.
//
// Con 100 sesiones sobre 40 unidades, 60 personas reciben un rechazo. Lo que
// ese mensaje diga decide si vuelven a intentar con el carrito arreglado o si
// se quedan tocando «Confirmar» contra un producto que ya no existe.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ORDER_REQUEST_TIMEOUT_MS,
  readableOrderCreationError,
  withRequestTimeout,
} from '../js/repositories/supabase_order_repository.js';
import { commerceCheckoutBlock, setCommerceAvailability } from '../js/core/commerce-availability-store.js';

const SIN_STOCK = 'Algunos productos ya no tienen stock. Actualizá el carrito y probá de nuevo.';
const GENERICO = 'No pudimos confirmar el pedido. Conservamos el intento para reintentar sin duplicarlo.';

test('el rechazo por producto agotado se dice como agotado, no como error genérico', () => {
  // Tal cual lo emite la RPC cuando el stock llegó a cero y el contrato
  // comercial apagó la disponibilidad. Está en castellano: el humanizador
  // miraba sólo palabras en inglés y este caso caía en el genérico.
  const real = { message: 'producto no disponible: 28ad2a1a-510f-420e-a184-db2a1fa644ad' };
  assert.equal(readableOrderCreationError(real), SIN_STOCK);
});

test('y no invita a reintentar algo que nunca va a entrar', () => {
  const real = { message: 'producto no disponible: 28ad2a1a-510f-420e-a184-db2a1fa644ad' };
  assert.notEqual(readableOrderCreationError(real), GENERICO);
});

test('las otras formas de decir lo mismo también se entienden', () => {
  for (const message of [
    'insufficient stock for product',
    'product not available',
    'producto agotado',
    'PRODUCTO NO DISPONIBLE: abc',
  ]) {
    assert.equal(readableOrderCreationError({ message }), SIN_STOCK, message);
  }
});

test('un error de verdad desconocido sigue cayendo en el genérico honesto', () => {
  assert.equal(readableOrderCreationError({ message: 'deadlock detected' }), GENERICO);
});

test('el contrato de ubicación sigue teniendo su propio mensaje', () => {
  const mensaje = readableOrderCreationError({ message: 'DELIVERY_LOCATION_REQUIRED' });
  assert.notEqual(mensaje, SIN_STOCK);
  assert.notEqual(mensaje, GENERICO);
  assert.match(mensaje, /mapa|ubicaci[oó]n|punto|direcci[oó]n/i);
});

// F40: los rechazos de la política de alcohol caían todos en el genérico.
//
// El backend los emite en castellano y ninguno coincidía con las ramas del
// humanizador, así que la persona leía «conservamos el intento para reintentar
// sin duplicarlo» ante una compra que NUNCA iba a entrar. Peor que no decir
// nada: le pedía que insistiera.
//
// Los cuatro mensajes son literales de
// supabase/migrations/20260725030000_taba_production_orders.sql:661,686,689,694.
test('el rechazo por alcohol dice que es por alcohol, y qué hacer', () => {
  const casos = [
    ['politica de alcohol no configurada', /no tiene habilitada la venta de bebidas con alcohol/i],
    ['producto alcoholico sin edad minima configurada', /no tiene habilitada la venta de bebidas con alcohol/i],
    ['confirmacion de mayoria de edad requerida', /mayor de 18 años/i],
    ['venta de alcohol fuera de horario', /fuera del horario permitido/i],
  ];
  for (const [message, esperado] of casos) {
    const leido = readableOrderCreationError({ message });
    assert.match(leido, esperado, `«${message}» se tradujo a: ${leido}`);
    assert.notEqual(leido, GENERICO, `«${message}» sigue cayendo en el genérico`);
  }
});

test('el rechazo por mínimo de delivery ofrece las dos salidas reales', () => {
  const leido = readableOrderCreationError({ message: 'subtotal inferior al minimo de delivery' });
  assert.match(leido, /mínimo para envío/i);
  assert.match(leido, /retiro en el local/i, 'tiene que nombrar la alternativa que sí existe');
  assert.notEqual(leido, GENERICO);
});

test('el orden de las ramas importa: «edad minima» no se lo come «verified»', () => {
  // La rama de `verified` está después a propósito. Si alguien la sube, este
  // mensaje vuelve a decir «el comercio no habilitó los pedidos online», que es
  // otra cosa y manda a la persona a esperar en vez de a sacar el producto.
  const leido = readableOrderCreationError({ message: 'producto alcoholico sin edad minima configurada' });
  assert.doesNotMatch(leido, /no habilitó los pedidos online/i);
});

test('lo que ya funcionaba sigue funcionando', () => {
  assert.equal(readableOrderCreationError({ message: 'producto no disponible: abc' }), SIN_STOCK);
  assert.equal(readableOrderCreationError({ message: 'algo raro' }), GENERICO);
});

// ── Lo que el alta del pedido decide en el último segundo ───────────────────
//
// Los tres rechazos son literales de
// supabase/migrations/20260812220000_business_operations_checkout_enforcement.sql
// (líneas 423, 430 y 450): `message` es el código y `detail` la frase.
const CERRADO = { message: 'BUSINESS_CLOSED', details: 'el comercio no esta abierto para este canal' };
const FUERA_DE_ZONA = { message: 'OUT_OF_DELIVERY_ZONE', details: 'la direccion no esta dentro de la cobertura declarada' };
const ALCOHOL_FUERA_DE_VENTANA = { message: 'ALCOHOL_WINDOW_CLOSED', details: 'la venta de alcohol esta fuera de la ventana configurada' };

test('pedir con el comercio cerrado dice que está cerrado, no que reintente', () => {
  const leido = readableOrderCreationError(CERRADO, 500);
  assert.match(leido, /cerrado/i);
  assert.notEqual(leido, GENERICO, 'reintentar no abre el local');
  assert.notEqual(leido, SIN_STOCK);
});

test('y lo dice con la misma frase que el aviso previo del carrito', () => {
  setCommerceAvailability({ is_open: false, hours_enforced: true });
  try {
    assert.equal(readableOrderCreationError(CERRADO, 500), commerceCheckoutBlock('delivery').message);
  } finally {
    setCommerceAvailability(null);
  }
});

test('una dirección fuera de cobertura se dice, con las dos salidas reales', () => {
  const leido = readableOrderCreationError(FUERA_DE_ZONA, 500);
  assert.match(leido, /no realizamos entregas en esta zona/i);
  assert.match(leido, /retiro en el local/i);
  assert.match(leido, /cambiar la dirección/i);
  assert.notEqual(leido, GENERICO);
});

test('el alcohol fuera de su ventana es un horario, no una tienda que no vende alcohol', () => {
  const leido = readableOrderCreationError(ALCOHOL_FUERA_DE_VENTANA, 500);
  assert.match(leido, /fuera del horario permitido/i);
  assert.doesNotMatch(leido, /no tiene habilitada la venta/i, 'la vende, pero no a esta hora');
});

test('el comercio o la modalidad deshabilitados dicen eso', () => {
  assert.match(
    readableOrderCreationError({ message: 'el negocio no esta habilitado para recibir pedidos' }, 500),
    /no habilitó los pedidos online/i,
  );
  for (const message of ['delivery no habilitado', 'retiro no habilitado']) {
    const leido = readableOrderCreationError({ message }, 500);
    assert.match(leido, /modalidad elegida no está habilitada/i, message);
    assert.notEqual(leido, GENERICO, message);
  }
});

// ── Una caída no es falta de stock ──────────────────────────────────────────

test('«Service Unavailable» no se lee como producto agotado', () => {
  // «unavailable» contiene «available»: el 503 del borde mandaba a la persona
  // a cambiar el carrito en medio de una caída del servicio.
  for (const message of ['Service Unavailable', 'The service is currently unavailable', 'upstream unavailable']) {
    assert.equal(readableOrderCreationError({ message }, 503), GENERICO, message);
  }
  assert.equal(readableOrderCreationError({ message: 'product unavailable' }, 400), SIN_STOCK);
});

test('una respuesta que no llegó nunca se clasifica por las palabras de su traza', () => {
  // Estado 0: el cliente pone en `details` la traza del navegador, con rutas y
  // nombres de función. «stock», «auth» o «available» ahí adentro no son
  // respuestas del backend.
  const sinRespuesta = {
    message: 'TypeError: Failed to fetch',
    details: 'TypeError: Failed to fetch\n    at checkStockAvailable (https://tienda/js/stock.js:10:3)\n    at auth (https://tienda/js/auth.js:1:1)',
  };
  assert.equal(readableOrderCreationError(sinRespuesta, 0), GENERICO);
  // Sin estado conocido se conserva la lectura de siempre.
  assert.equal(readableOrderCreationError({ message: 'producto no disponible: abc' }), SIN_STOCK);
});

// ── El alta del pedido no espera para siempre ───────────────────────────────

test('una consulta que no contesta se aborta al vencer el plazo', async () => {
  let abortada = false;
  let vencer = null;
  let limpiado = 0;
  const consulta = {
    abortSignal(signal) {
      return new Promise((resolve) => {
        signal.addEventListener('abort', () => {
          abortada = true;
          // Lo que devuelve el cliente real cuando el transporte corta.
          resolve({ data: null, error: { message: 'AbortError: The operation was aborted.' }, status: 0 });
        });
      });
    },
  };
  const espera = withRequestTimeout(consulta, ORDER_REQUEST_TIMEOUT_MS, {
    setTimer: (callback, ms) => { vencer = { callback, ms }; return 7; },
    clearTimer: (id) => { if (id === 7) limpiado += 1; },
  });
  assert.equal(vencer.ms, ORDER_REQUEST_TIMEOUT_MS);
  assert.equal(abortada, false, 'antes del plazo la consulta sigue viva');
  vencer.callback();
  const resultado = await espera;
  assert.equal(abortada, true);
  assert.equal(resultado.status, 0);
  assert.equal(limpiado, 1, 'el temporizador se limpia siempre');
  assert.equal(readableOrderCreationError(resultado.error, resultado.status), GENERICO);
});

test('una consulta que contesta a tiempo no se toca, y su temporizador se limpia', async () => {
  let limpiado = 0;
  const consulta = { abortSignal: () => Promise.resolve({ data: { id: 'p-1' }, error: null, status: 200 }) };
  const resultado = await withRequestTimeout(consulta, 1000, {
    setTimer: () => 3,
    clearTimer: (id) => { if (id === 3) limpiado += 1; },
  });
  assert.deepEqual(resultado, { data: { id: 'p-1' }, error: null, status: 200 });
  assert.equal(limpiado, 1);
});

test('un cliente sin abortSignal se espera tal cual', async () => {
  const simple = Promise.resolve({ data: 1, error: null });
  assert.deepEqual(await withRequestTimeout(simple, 5), { data: 1, error: null });
});

test('el plazo deja lugar a una red móvil lenta', () => {
  assert.ok(ORDER_REQUEST_TIMEOUT_MS >= 15_000 && ORDER_REQUEST_TIMEOUT_MS <= 45_000);
});
