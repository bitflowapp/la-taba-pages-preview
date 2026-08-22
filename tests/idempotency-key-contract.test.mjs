import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compactSegment,
  IDEMPOTENCY_KEY_PATTERN,
  isValidIdempotencyKey,
  operationKey,
  randomOperationKey,
  sanitizeKeySegment,
} from '../js/core/idempotency-key.js';
import { inventoryOperationKey } from '../js/business/business-operations-center.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/*
 * El defecto que estos casos fijan lo encontró el primer gate físico de
 * recepción, con la mercadería sobre el mostrador: el Panel mandaba
 * `inventory:<uuid>` y doce funciones del servidor rechazan el `:` con
 * «idempotency_key invalida» antes de escribir nada. Ninguna suite lo veía
 * porque los repositorios de prueba aceptan cualquier cadena.
 */

test('el contrato del cliente es LITERALMENTE el de las migraciones', () => {
  // Si alguien cambia el regex del servidor, este caso cae: el cliente no puede
  // enterarse tarde y en producción.
  const migracion = fs.readFileSync(
    path.join(ROOT, 'supabase/migrations/20260802160000_business_windows_scanner_fiscal.sql'),
    'utf8',
  );
  assert.match(migracion, /idempotency_key[^\n]*'\^\[A-Za-z0-9_-\]\{8,128\}\$'/);
  assert.equal(IDEMPOTENCY_KEY_PATTERN.source, '^[A-Za-z0-9_-]{8,128}$');
});

test('una clave con dos puntos es inválida: es exactamente lo que fallaba', () => {
  assert.equal(isValidIdempotencyKey('inventory:0b6d4f1e-3c2a-4b77-9a51-2f8e6c1d4a90'), false);
  assert.equal(isValidIdempotencyKey('stock-count:abc12345'), false);
  assert.equal(isValidIdempotencyKey('packing:pedido:3'), false);
});

test('una clave malformada sigue siendo rechazada, no se la maquilla', () => {
  assert.equal(isValidIdempotencyKey(''), false);
  assert.equal(isValidIdempotencyKey('corto'), false, 'menos de 8 no cumple');
  assert.equal(isValidIdempotencyKey('a'.repeat(129)), false, 'más de 128 no cumple');
  assert.equal(isValidIdempotencyKey('con espacio 123'), false);
  assert.equal(isValidIdempotencyKey('acentuada-ñ-123'), false);
  assert.equal(isValidIdempotencyKey('barra/12345'), false);
  assert.equal(isValidIdempotencyKey(null), false);
  assert.equal(isValidIdempotencyKey(12345678), false, 'un número no es una clave');
});

test('sanitizeKeySegment reemplaza, no borra: dos fragmentos distintos siguen distintos', () => {
  assert.equal(sanitizeKeySegment('a:b'), 'a-b');
  assert.notEqual(sanitizeKeySegment('a:b'), sanitizeKeySegment('ab'));
  assert.equal(sanitizeKeySegment('2026-08-22'), '2026-08-22');
});

test('operationKey produce claves válidas y respeta el mínimo y el máximo', () => {
  assert.ok(isValidIdempotencyKey(operationKey('inv', 'abc')));
  assert.ok(isValidIdempotencyKey(operationKey('a')), 'una clave corta se completa hasta el mínimo');
  const larga = operationKey('x', 'y'.repeat(400));
  assert.ok(isValidIdempotencyKey(larga));
  assert.equal(larga.length, 128);
});

test('randomOperationKey siempre es válida, incluso sin crypto.randomUUID', () => {
  for (let i = 0; i < 200; i += 1) assert.ok(isValidIdempotencyKey(randomOperationKey('inventory')));
  const original = globalThis.crypto?.randomUUID;
  try {
    if (globalThis.crypto) globalThis.crypto.randomUUID = undefined;
    for (let i = 0; i < 50; i += 1) assert.ok(isValidIdempotencyKey(randomOperationKey('inventory')));
  } finally {
    if (globalThis.crypto && original) globalThis.crypto.randomUUID = original;
  }
});

test('dos operaciones aleatorias distintas nunca comparten clave', () => {
  const claves = new Set();
  for (let i = 0; i < 500; i += 1) claves.add(randomOperationKey('inventory'));
  assert.equal(claves.size, 500);
});

// ── La recepción de mercadería ───────────────────────────────────────────────

const RECEPCION = {
  movementType: 'purchase_receipt',
  binding: { product_id: '30000000-0000-4000-8000-000000000001', id: '40000000-0000-4000-8000-000000000009' },
  quantity: 6,
  direction: 1,
  reason: '',
  salt: 'a1b2c3d4e5f6',
};

test('la recepción genera una clave que el servidor acepta', () => {
  const clave = inventoryOperationKey(RECEPCION);
  assert.ok(isValidIdempotencyKey(clave), `clave inválida: ${clave}`);
  assert.ok(clave.length <= 128);
  assert.doesNotMatch(clave, /:/);
});

test('el doble click no duplica el movimiento: misma operación, misma clave', () => {
  assert.equal(inventoryOperationKey(RECEPCION), inventoryOperationKey({ ...RECEPCION }));
});

test('el reintento tras un error de red reusa la clave: es replay, no una segunda escritura', () => {
  const primerIntento = inventoryOperationKey(RECEPCION);
  const reintento = inventoryOperationKey(RECEPCION);
  assert.equal(reintento, primerIntento);
});

test('dos recepciones DISTINTAS generan claves distintas', () => {
  const base = inventoryOperationKey(RECEPCION);
  const otraCantidad = inventoryOperationKey({ ...RECEPCION, quantity: 7 });
  const otroProducto = inventoryOperationKey({ ...RECEPCION, binding: { product_id: '30000000-0000-4000-8000-000000000002', id: RECEPCION.binding.id } });
  const otroCodigo = inventoryOperationKey({ ...RECEPCION, binding: { product_id: RECEPCION.binding.product_id, id: '40000000-0000-4000-8000-000000000008' } });
  const otraDireccion = inventoryOperationKey({ ...RECEPCION, direction: -1 });
  const otroTipo = inventoryOperationKey({ ...RECEPCION, movementType: 'manual_adjustment' });
  const conMotivo = inventoryOperationKey({ ...RECEPCION, reason: 'rotura' });
  const otraSesion = inventoryOperationKey({ ...RECEPCION, salt: 'f6e5d4c3b2a1' });
  const todas = [base, otraCantidad, otroProducto, otroCodigo, otraDireccion, otroTipo, conMotivo, otraSesion];
  assert.equal(new Set(todas).size, todas.length, 'dos operaciones distintas comparten clave');
  for (const clave of todas) assert.ok(isValidIdempotencyKey(clave), clave);
});

test('recibir lo mismo otra vez MÁS TARDE es otra operación: la sesión se renueva', () => {
  // Seis botellas hoy y otras seis mañana son dos recepciones legítimas. Sin el
  // sufijo de sesión la segunda reusaría la clave y el servidor la descartaría
  // en silencio: el stock quedaría corto y nadie se enteraría.
  const hoy = inventoryOperationKey(RECEPCION);
  const manana = inventoryOperationKey({ ...RECEPCION, salt: 'b9c8d7e6f5a4' });
  assert.notEqual(hoy, manana);
});

test('el motivo del operador no viaja dentro de la clave', () => {
  const clave = inventoryOperationKey({ ...RECEPCION, reason: 'remito 4321 proveedor Andina' });
  assert.doesNotMatch(clave, /remito|proveedor|andina/i);
  assert.match(clave, /r28/, 'sólo entra el largo del motivo');
});

test('compactSegment distingue identificadores que comparten prefijo', () => {
  // Los UUID de este proyecto son estructurados y difieren en el ÚLTIMO
  // carácter: recortarlos por el principio los volvía la misma clave.
  const a = '30000000-0000-4000-8000-000000000001';
  const b = '30000000-0000-4000-8000-000000000002';
  assert.notEqual(compactSegment(a), compactSegment(b));
  assert.ok(compactSegment(a).length <= 12);
  assert.equal(compactSegment('corto'), 'corto', 'lo que ya entra no se toca');
  // Y distingue también un lote grande de identificadores parecidos.
  const claves = new Set();
  for (let i = 0; i < 500; i += 1) claves.add(compactSegment(`30000000-0000-4000-8000-${String(i).padStart(12, '0')}`));
  assert.equal(claves.size, 500);
});

test('ninguna superficie del Panel arma claves pegando el prefijo con dos puntos', () => {
  // El defecto vivía en una plantilla escrita a mano. Que no vuelva.
  const patronPlantilla = new RegExp(['`\\$\\{', '[A-Za-z]+', '\\}', ':', '\\$\\{'].join(''));
  for (const archivo of ['js/business/business-operations-center.js', 'js/catalog/inventory-controller.js', 'js/production-operations.js']) {
    const fuente = fs.readFileSync(path.join(ROOT, archivo), 'utf8');
    // Se miran sólo las líneas de código: un comentario puede nombrar el
    // defecto sin cometerlo.
    const codigo = fuente.split('\n').filter((linea) => !/^\s*(\/\/|\*|\/\*)/.test(linea)).join('\n');
    const sospechosas = [...codigo.matchAll(/idempotencyKey[^\n]*`[^`\n]*:\$\{/g)].map((m) => m[0]);
    assert.deepEqual(sospechosas, [], `${archivo} arma una clave con dos puntos`);
    assert.doesNotMatch(codigo, patronPlantilla, `${archivo} conserva el generador con dos puntos`);
  }
});
