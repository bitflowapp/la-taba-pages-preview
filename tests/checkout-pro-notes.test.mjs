// Lo que el cliente escribe en «Observaciones del pedido» tiene que llegar al
// negocio también cuando paga con Mercado Pago (F05).
//
// POR QUÉ EXISTE ESTE ARCHIVO
// ---------------------------
// El campo se escribe, se valida y se perdía. El camino DIRECTO sí lo manda
// (`customer_notes` en el payload de `create_order_with_items`); el de Checkout
// Pro no: `buildMercadoPagoCheckoutPayload` nunca incluyó las notas y
// `finalize_paid_checkout_session` nunca insertó `customer_notes`. El negocio
// preparaba y el rider salía sin la indicación —«tocar timbre», «dejar en
// portería», «sin hielo»—, que en un reparto es la diferencia entre entregar y
// no entregar.
//
// Y NO ALCANZABA CON TOCAR EL CLIENTE: `create_checkout_session` valida el
// payload contra una lista blanca y levanta «campo no permitido en checkout»
// ante cualquier clave que no conozca. Mandar `notes` sólo desde el navegador
// habría hecho fallar el checkout ENTERO —un P1 convertido en P0—. Por eso este
// archivo prueba las dos mitades juntas: si alguien revierte una sola, falla.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildMercadoPagoCheckoutPayload } from '../js/payments/mercadopago-checkout.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRACION = 'supabase/migrations/20260813020000_checkout_pro_carries_customer_notes.sql';
const leer = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const BASE = {
  businessId: '11111111-1111-4111-8111-111111111111',
  clientRequestId: '22222222-2222-4222-8222-222222222222',
  items: [{ product_id: '33333333-3333-4333-8333-333333333333', quantity: 1 }],
};

test('la observación del cliente viaja en el payload de Checkout Pro', () => {
  const payload = buildMercadoPagoCheckoutPayload({
    ...BASE,
    values: {
      customerName: 'Cliente real',
      customerPhone: '2995550000',
      deliveryMode: 'pickup',
      customerNotes: 'Tocar timbre, no funciona el portero',
    },
  });
  assert.equal(payload.notes, 'Tocar timbre, no funciona el portero');
});

test('sin observación no se manda la clave, porque la lista blanca es estricta', () => {
  // No es cosmético: mandar `notes: ''` es mandar una clave. La lista blanca la
  // acepta ahora, pero el criterio del payload en todo este módulo es no enviar
  // lo que no existe.
  for (const notas of [undefined, '', '   ']) {
    const payload = buildMercadoPagoCheckoutPayload({
      ...BASE,
      values: { customerName: 'C', customerPhone: '2995550000', deliveryMode: 'pickup', customerNotes: notas },
    });
    assert.ok(!('notes' in payload), `con ${JSON.stringify(notas)} no debería existir la clave`);
  }
});

test('la observación se recorta como el resto del texto del payload', () => {
  const payload = buildMercadoPagoCheckoutPayload({
    ...BASE,
    values: { customerName: 'C', customerPhone: '2995550000', deliveryMode: 'pickup', customerNotes: '  con espacios  ' },
  });
  assert.equal(payload.notes, 'con espacios');
});

test('el backend acepta la clave: sin esto el checkout entero se caía', () => {
  const sql = leer(MIGRACION);
  const listaBlanca = sql.match(/where key not in \(([\s\S]*?)\)\s*\n\s*limit 1;/);
  assert.ok(listaBlanca, 'no se encontró la lista blanca del payload');
  assert.match(listaBlanca[1], /'notes'/);
  // Y las otras claves siguen ahí: la lista se amplió, no se reemplazó.
  for (const clave of ['business_id', 'client_request_id', 'items', 'fulfillment_type', 'contact', 'address', 'age_confirmed', 'payment_method']) {
    assert.match(listaBlanca[1], new RegExp(`'${clave}'`), `se perdió ${clave} de la lista blanca`);
  }
});

test('el backend sanea la observación antes de guardarla', () => {
  const sql = leer(MIGRACION);
  assert.match(sql, /v_notes := nullif\(btrim\(regexp_replace\(coalesce\(p_payload ->> 'notes', ''\), '\[\[:cntrl:\]\]', ' ', 'g'\)\), ''\);/);
  assert.match(sql, /char_length\(v_notes\) > 280/, 'tiene que haber un tope de largo');
});

test('la observación termina en el pedido, que es el único lugar que importa', () => {
  const sql = leer(MIGRACION);
  // Viaja dentro del snapshot de contacto para no agregar una columna.
  assert.match(sql, /v_contact_snapshot := jsonb_strip_nulls\(jsonb_build_object\('name', v_name, 'phone', v_phone, 'notes', v_notes\)\);/);
  // Y de ahí al INSERT del pedido.
  assert.match(sql, /payment_method, subtotal, discount_total, delivery_fee, total,\s*\n\s*customer_notes\s*\n\s*\) values \(/);
  assert.match(sql, /nullif\(v_session\.contact_snapshot ->> 'notes', ''\)/);
});

test('no se tocó nada del dinero ni del stock', () => {
  const sql = leer(MIGRACION);
  // La corrección es de texto libre. Si aparece un cambio en importes o en la
  // reserva, alguien amplió el alcance sin decirlo.
  assert.match(sql, /v_session\.subtotal, v_session\.discount_total, v_session\.delivery_fee, v_session\.total/);
  assert.doesNotMatch(sql, /alter table public\.orders/i);
  assert.doesNotMatch(sql, /alter table public\.checkout_sessions/i);
  assert.doesNotMatch(sql, /drop /i);
});

// La reconstrucción sobre la definición VIGENTE no puede perder lo que esa
// definición trajo.
//
// La primera versión de esta migración partía de 20260808191000 y habría
// revertido en silencio `20260812220000_business_operations_checkout_enforcement`,
// que ya vive en staging y redefine estas dos mismas funciones. `create or
// replace` pisa y sigue: no falla, no avisa. Lo destapó el preflight comparando
// el ledger real contra los archivos locales.
//
// Este test es la prueba de que la versión nueva conserva aquel trabajo.
test('la migración de notas conserva horario y cobertura del enforcement', () => {
  const sql = leer(MIGRACION);

  // Horario de atención.
  assert.match(sql, /business_is_open/, 'se perdió la verificación de horario');
  // Zona de entrega y su cobertura.
  assert.match(sql, /resolve_delivery_zone/, 'se perdió la resolución de zona');
  // La zona decidida viaja al pedido.
  assert.match(sql, /v_session\.delivery_zone_id, v_session\.delivery_zone_name/);
  // Y el barrio declarado, que agregó 20260812240000.
  assert.match(sql, /address_snapshot ->> 'neighborhood'/);
});

test('parte de la definición vigente y no de la vieja', () => {
  const sql = leer(MIGRACION);
  // Marca inequívoca del cuerpo moderno: el pedido guarda la zona resuelta.
  assert.match(sql, /delivery_zone_id/);
  // Y la sesión congela envío y mínimo, que es lo que agregó el enforcement.
  assert.match(sql, /create or replace function public\.create_checkout_session/i);
  assert.match(sql, /create or replace function public\.finalize_paid_checkout_session/i);
});
