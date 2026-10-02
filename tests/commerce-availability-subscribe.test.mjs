import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  clearCommerceAvailability,
  getCommerceAvailability,
  setCommerceAvailability,
  subscribeCommerceAvailability,
} from '../js/core/commerce-availability-store.js';

const abierto = { business_id: 'b1', channel: 'delivery', ordering_ready: true, is_open: true, hours_enforced: true };
const cerrado = { ...abierto, is_open: false, next_open_at: '2026-10-01T19:00:00-03:00' };

test('quien dibuja se entera cuando la respuesta cambia, y sólo entonces', () => {
  clearCommerceAvailability();
  const vistos = [];
  const dejar = subscribeCommerceAvailability((estado) => vistos.push(estado.known ? estado.isOpen : 'no sé'));

  setCommerceAvailability(abierto);
  assert.deepEqual(vistos, [true]);

  // La reconciliación de cada vuelta a la pestaña trae casi siempre lo mismo:
  // una respuesta idéntica no es una novedad y no cuesta un render.
  setCommerceAvailability(abierto);
  setCommerceAvailability({ ...abierto });
  assert.deepEqual(vistos, [true]);

  // El local cerró con la pestaña abierta.
  setCommerceAvailability(cerrado);
  assert.deepEqual(vistos, [true, false]);
  assert.equal(getCommerceAvailability().isOpen, false);

  // Se cayó la consulta: el estado vuelve a «no sé» y eso también se dibuja.
  clearCommerceAvailability();
  clearCommerceAvailability();
  assert.deepEqual(vistos, [true, false, 'no sé']);

  dejar();
  setCommerceAvailability(abierto);
  assert.deepEqual(vistos, [true, false, 'no sé'], 'un oyente desuscripto siguió recibiendo avisos');
  clearCommerceAvailability();
});

test('editar el barrio o el punto de la MISMA dirección vuelve a preguntar la cobertura', () => {
  // El servidor resuelve la zona con el barrio y el punto, no con la calle. Si
  // la clave del aviso no los lleva, agregarle el barrio a una dirección vieja
  // no dispara la consulta y el carrito sigue diciendo «fuera de zona».
  const source = fs.readFileSync(new URL('../js/customer-delivery.js', import.meta.url), 'utf8');
  const key = source.match(/const key = address\s*\?\s*\[([^\]]+)\]\.join\('\|'\)/);
  assert.ok(key, 'la clave del aviso de dirección cambió de forma');
  for (const field of ['address.id', 'address.formattedAddress', 'address.neighborhood', 'address.latitude', 'address.longitude']) {
    assert.ok(key[1].includes(field), `la clave del aviso no incluye ${field}`);
  }
});

test('un oyente que falla no deja a los demás sin aviso, y lo que no es función se ignora', () => {
  clearCommerceAvailability();
  let avisos = 0;
  const dejarRoto = subscribeCommerceAvailability(() => { throw new Error('roto'); });
  const dejar = subscribeCommerceAvailability(() => { avisos += 1; });
  assert.equal(typeof subscribeCommerceAvailability(null), 'function');

  assert.doesNotThrow(() => setCommerceAvailability(abierto));
  assert.equal(avisos, 1);
  assert.equal(getCommerceAvailability().known, true, 'el estado no se guardó porque un oyente falló');

  dejarRoto();
  dejar();
  clearCommerceAvailability();
});
