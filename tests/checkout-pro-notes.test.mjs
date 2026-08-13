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
const MIGRACION = 'supabase/migrations/20260812235000_checkout_pro_carries_customer_notes.sql';
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
