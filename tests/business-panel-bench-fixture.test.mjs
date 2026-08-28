/*
 * EL BANCO DE PRUEBA NO PUEDE MENTIR HACIA EL LADO BUENO.
 * ============================================================================
 * El banco de la bandeja operativa generaba sus pedidos con
 * `00000000-0000-4000-8000-0000000${n}`: con `n` de cuatro dígitos eso da un
 * último grupo de ONCE caracteres y un UUID de 35, no de 36.
 *
 * No es cosmético y no falla ruidosamente. El adaptador descarta un `backendId`
 * que no es un UUID, y sin `backendId` el pedido pierde la identidad con la que
 * el coordinador compara revisiones: la bandeja se dibuja completa y NUNCA se
 * actualiza. Medir «cuánto cuesta un cambio» sobre eso da cero elementos
 * tocados y la conclusión de que todo anda perfecto.
 *
 * Un fixture roto que hace fallar la medición se descubre solo. Éste la
 * falsificaba a favor, que es la forma cara de equivocarse.
 *
 * Los dos bancos ahora comparten el molde, y esta prueba lo mira.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  esUuidValido,
  idDePedidoSintetico,
  pedidosSinteticos,
} from '../scripts/lib/business-panel-fixtures.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BANCOS = ['scripts/business-panel-bench.mjs', 'scripts/business-tray-scale-bench.mjs'];

test('el id sintético es un UUID v4 de 36 caracteres en todo el rango que se mide', () => {
  // 500 es el tope que sirve el repositorio y el tope de los bancos. Se miran
  // los bordes y el rango entero: el error original sólo aparecía a partir de
  // cierta cantidad de dígitos.
  for (let i = 0; i < 500; i += 1) {
    const id = idDePedidoSintetico(i);
    assert.equal(id.length, 36, `el pedido ${i} generó un UUID de ${id.length} caracteres: ${id}`);
    assert.ok(esUuidValido(id), `el pedido ${i} generó un UUID inválido: ${id}`);
  }
});

test('los pedidos sintéticos tienen identidad única y utilizable', () => {
  const lista = pedidosSinteticos(500);
  assert.equal(lista.length, 500);
  const ids = new Set(lista.map((pedido) => pedido.id));
  // Identidades repetidas serían dos tarjetas peleándose la misma clave, que es
  // justamente lo que la reconciliación por clave no puede resolver.
  assert.equal(ids.size, 500, 'hay ids repetidos entre los pedidos sintéticos');
  for (const pedido of lista) assert.ok(esUuidValido(pedido.id), `id inválido: ${pedido.id}`);
  const codigos = new Set(lista.map((pedido) => pedido.public_code));
  assert.equal(codigos.size, 500, 'hay códigos públicos repetidos');
});

test('el prefijo separa las bandejas de los dos bancos', () => {
  assert.ok(pedidosSinteticos(1, { prefijo: 'LT-9' })[0].public_code.startsWith('LT-9'));
  assert.ok(pedidosSinteticos(1, { prefijo: 'LT-8' })[0].public_code.startsWith('LT-8'));
});

test('ningún banco vuelve a armarse su propio molde de UUID', () => {
  for (const banco of BANCOS) {
    const fuente = fs.readFileSync(path.join(RAIZ, banco), 'utf8');
    // La forma exacta del error: un grupo final compuesto a mano en vez de
    // `padStart(12, …)`. Se busca cualquier UUID literal con `${` adentro que no
    // pase por el molde compartido.
    const literales = [...fuente.matchAll(/'?`[0-9a-f-]{8,}-\$\{[^`]*`/g)].map((m) => m[0]);
    assert.deepEqual(
      literales,
      [],
      `${banco} vuelve a componer un UUID a mano: ${literales.join(', ')}. `
      + 'Usá `idDePedidoSintetico()` / `pedidosSinteticos()`.',
    );
    assert.match(
      fuente,
      /pedidosSinteticos\(/,
      `${banco} tiene que derivar su bandeja del molde compartido`,
    );
  }
});

test('un molde que dejara de dar un UUID válido corta en el banco, no en la conclusión', () => {
  // La guarda vive dentro del generador: es lo que convierte «medición falsa»
  // en «el banco no arranca».
  const fuente = fs.readFileSync(
    path.join(RAIZ, 'scripts/lib/business-panel-fixtures.mjs'),
    'utf8',
  );
  assert.match(fuente, /throw new Error\(`UUID sintético inválido/);
});
