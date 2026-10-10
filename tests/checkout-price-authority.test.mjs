/*
 * AUTORIDAD DEL PRECIO EN EL CHECKOUT
 * ===================================
 *
 * El cliente nunca decide cuánto cuesta un producto. Lo que viaja al servidor
 * son identificadores y cantidades; el precio lo lee el backend de `products`
 * al momento de crear el pedido (`create_order_with_items_core` y
 * `create_checkout_session`, verificadas en la base productiva el 2026-10-10).
 *
 * Estos tests fijan ese contrato en el código del cliente y de la Edge Function:
 * si alguien agrega un precio a una línea del carrito, el test falla.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { buildMercadoPagoCheckoutPayload } from '../js/payments/mercadopago-checkout.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const leer = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const PRECIO_FALSO = { unit_price: 1, price: 1, precio: 1, total: 1, subtotal: 1 };

test('el payload de Mercado Pago descarta cualquier precio que llegue en una línea del carrito', () => {
  const payload = buildMercadoPagoCheckoutPayload({
    businessId: '00000000-0000-4000-8000-000000000001',
    clientRequestId: 'req-test-1',
    values: { deliveryMode: 'pickup', customerName: 'Prueba', customerPhone: '000' },
    items: [
      { product_id: '11111111-1111-4111-8111-111111111111', quantity: 2, ...PRECIO_FALSO },
      { combo_id: 'combo-prueba-1', quantity: 1, ...PRECIO_FALSO },
    ],
  });
  for (const linea of payload.items) {
    assert.deepEqual(
      Object.keys(linea).sort(),
      'combo_id' in linea ? ['combo_id', 'quantity'] : ['product_id', 'quantity'],
      'la línea sólo puede llevar identificador y cantidad',
    );
  }
  const serializado = JSON.stringify(payload);
  for (const clave of ['unit_price', '"price"', 'precio', 'subtotal']) {
    assert.ok(!serializado.includes(clave), `el payload no debe contener ${clave}`);
  }
});

test('el carrito de pedidos arma las líneas sólo con product_id y quantity (ambos caminos)', () => {
  const src = leer('js/repositories/supabase_order_repository.js');
  const bloques = [...src.matchAll(/const items = cartItems\.map\(\(item\) => \(\{([\s\S]*?)\}\)\);/g)].map((m) => m[1]);
  assert.ok(bloques.length >= 2, 'se esperaban los dos mapeos de cartItems');
  for (const bloque of bloques) {
    assert.match(bloque, /product_id:/);
    assert.match(bloque, /quantity:/);
    assert.doesNotMatch(bloque, /price|precio|total|subtotal/i, 'la línea no debe llevar importes');
  }
});

test('la Edge Function de checkout no lee ningún precio del cuerpo de la petición', () => {
  const src = leer('supabase/functions/mercadopago-create-checkout-session/index.ts');
  // El comentario del propio archivo lo dice: el precio no viaja desde el cliente.
  assert.match(src, /price, currency, preference ID/);
  const lecturas = src.match(/(body|payload|request|input)\??\.(unit_)?price\b/gi) ?? [];
  assert.deepEqual(lecturas, [], 'no debe leer price del cuerpo');
});

test('el RPC de pedido lee el precio de products en el servidor (contrato verificado en la base)', () => {
  // Contrato documentado en docs/catalog/CHECKOUT_AUTHORITY_EVIDENCE.md, extraído
  // de la definición desplegada. Si una migración cambia esa fuente, el evidencia
  // queda desactualizada y este test lo señala.
  const evidencia = leer('artifacts/catalog-expansion-pedidosya-20261010/CHECKOUT_AUTHORITY_EVIDENCE.md');
  assert.match(evidencia, /v_product\.price/);
  assert.match(evidencia, /precio no verificado para producto|price_status <> 'confirmed'/);
});
