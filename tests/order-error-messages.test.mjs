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
