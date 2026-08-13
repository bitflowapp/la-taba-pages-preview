// Lo último que lee una persona cuando su compra no entra.
//
// Con 100 sesiones sobre 40 unidades, 60 personas reciben un rechazo. Lo que
// ese mensaje diga decide si vuelven a intentar con el carrito arreglado o si
// se quedan tocando «Confirmar» contra un producto que ya no existe.
import test from 'node:test';
import assert from 'node:assert/strict';

import { readableOrderCreationError } from '../js/repositories/supabase_order_repository.js';

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
