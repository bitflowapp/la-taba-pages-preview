// La tienda no puede ofrecer una forma de pago que la base rechaza.
//
// POR QUÉ EXISTE ESTE ARCHIVO
// ---------------------------
// El checkout ofrecía tres formas de pago: «A coordinar con el local»,
// «Efectivo al recibir» y «Transferencia al confirmar». La base acepta
// exactamente cuatro valores —CHECK `orders_payment_method_valid`, en
// 20260806170000_order_payment_modality_integrity.sql— y `transfer` no es uno de
// ellos.
//
// El valor viaja sin traducción en todo el camino: el `<select>` lo entrega tal
// cual, `create_order_with_items` hace
// `v_payment_method := nullif(btrim(coalesce(payload->>'payment_method','')),'')`
// —sin lista blanca, sólo un límite de 40 caracteres— y lo inserta en
// `orders.payment_method`. El CHECK lo rechaza y el pedido NO SE CREA.
//
// Para el cliente eso era: elegir una forma de pago que el negocio publicita,
// completar nombre, teléfono, dirección y confirmar, y recibir un error
// genérico al final. No hay reintento que lo salve: falla siempre.
//
// El defecto no es que faltara una validación, es que había CUATRO listas de
// formas de pago que nadie mantenía juntas (el markup, `validators.js`, las
// etiquetas de `state.js` y el CHECK). Por eso este test compara las dos que
// importan de verdad —lo que se OFRECE contra lo que se ACEPTA— en vez de
// afirmar una lista escrita a mano por tercera vez.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIGRATION = 'supabase/migrations/20260806170000_order_payment_modality_integrity.sql';

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

/** Los valores que la base acepta, leídos del CHECK real. */
function acceptedByDatabase() {
  const sql = read(MIGRATION);
  const match = sql.match(
    /add constraint orders_payment_method_valid check \(\s*payment_method in \(([^)]*)\)/,
  );
  assert.ok(match, `no se encontró el CHECK en ${MIGRATION}`);
  return new Set(
    match[1]
      .split(',')
      .map((value) => value.trim().replace(/^'|'$/g, ''))
      .filter(Boolean),
  );
}

/** Los valores que el checkout ofrece, leídos del markup real. */
function offeredByStorefront() {
  const html = read('index.html');
  const select = html.match(
    /<select name="paymentMethod"[^>]*>([\s\S]*?)<\/select>/,
  );
  assert.ok(select, 'no se encontró el select de forma de pago');
  return [...select[1].matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]);
}

test('el CHECK de la base sigue siendo la autoridad y se puede leer', () => {
  const accepted = acceptedByDatabase();
  // Si alguien cambia el CHECK, que sea a propósito: estos cuatro son los que
  // el sistema sabe procesar hoy.
  assert.deepEqual([...accepted].sort(), ['cash', 'coordinate', 'mercadopago', 'qa_no_charge']);
});

test('toda forma de pago ofrecida al cliente es aceptada por la base', () => {
  const accepted = acceptedByDatabase();
  const offered = offeredByStorefront();

  assert.ok(offered.length > 0, 'el checkout se quedó sin formas de pago');
  for (const value of offered) {
    assert.ok(
      accepted.has(value),
      `el checkout ofrece "${value}" y el CHECK orders_payment_method_valid lo rechaza: `
      + 'el pedido no se crea y el cliente ve un error genérico al final del checkout',
    );
  }
});

test('no se ofrece transferencia hasta que exista su flujo', () => {
  // No es una preferencia estética: reponer la opción sin datos bancarios, sin
  // comprobante, sin quién confirma y sin migración devuelve el mismo defecto.
  assert.ok(!offeredByStorefront().includes('transfer'));
});

test('qa_no_charge nunca se le ofrece a una persona', () => {
  // La base lo acepta, pero sólo para pedidos de origen 'qa' (hay un segundo
  // CHECK que lo ata). Que esté permitido no lo hace ofrecible.
  assert.ok(!offeredByStorefront().includes('qa_no_charge'));
  assert.match(
    read(MIGRATION),
    /orders_qa_payment_method_requires_qa_origin/,
    'la atadura de qa_no_charge al origen qa es lo que hace segura la línea de arriba',
  );
});
