import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSupabaseBusinessRepository, classifyRpcError } from '../js/repositories/supabase-business-repository.js';
import { createSupabaseInventoryRepository } from '../js/repositories/supabase-inventory-repository.js';
import { createSupabasePosRepository } from '../js/repositories/supabase-pos-repository.js';
import { createSupabaseFiscalRepository } from '../js/repositories/supabase-fiscal-repository.js';
import { createSupabasePackingRepository } from '../js/repositories/supabase-packing-repository.js';

const BUSINESS_ID = 'business-1';

test('repositorio de negocio usa RPC idempotentes con CAS', async () => {
  const client = mockClient();
  const repository = createSupabaseBusinessRepository({ client, businessId: BUSINESS_ID });
  await repository.acknowledgeOrder({ orderId: 'o1', expectedRevision: 1, idempotencyKey: 'ack-00001' });
  await repository.transitionOrder({ orderId: 'o1', expectedRevision: 2, newStatus: 'preparing', idempotencyKey: 'transition-00001' });
  await repository.setPreparationEstimate({ orderId: 'o1', expectedRevision: 3, minutes: 20, idempotencyKey: 'estimate-00001' });
  await repository.cancelOrder({ orderId: 'o1', expectedRevision: 4, reason: 'Sin stock', idempotencyKey: 'cancel-00001' });
  assert.deepEqual(client.calls.map((call) => call.name), ['acknowledge_order', 'transition_order', 'set_preparation_estimate', 'cancel_order']);
  assert.equal(client.calls[1].args.p_expected_revision, 2);
  assert.equal(client.calls[1].args.p_idempotency_key, 'transition-00001');
});

test('errores RPC diferencian conflicto, sesi\u00f3n y transitorio', () => {
  assert.equal(classifyRpcError({ code: '40001', message: 'stale' }, 400).conflict, true);
  assert.equal(classifyRpcError({ code: '42501', message: 'auth' }, 401).code, 'SESSION_EXPIRED');
  assert.equal(classifyRpcError({ code: 'XX000', message: 'down' }, 503).retryable, true);
  assert.equal(classifyRpcError({ code: '23514', message: 'stock' }, 400).retryable, false);
});

test('inventario busca por negocio y muta s\u00f3lo mediante RPC', async () => {
  const client = mockClient();
  const repository = createSupabaseInventoryRepository({ client, businessId: BUSINESS_ID });
  await repository.lookupBarcode('4006381333931');
  await repository.applyMovement({ productId: 'p1', movementType: 'purchase_receipt', packageQuantity: 2, direction: 1, idempotencyKey: 'movement-00001' });
  assert.equal(client.queries[0].filters.business_id, BUSINESS_ID);
  assert.equal(client.calls[0].name, 'apply_inventory_movement');
  assert.equal(client.calls[0].args.p_package_quantity, 2);
});

test('POS env\u00eda IDs/cantidades y nunca totales calculados por cliente', async () => {
  const client = mockClient();
  const repository = createSupabasePosRepository({ client, businessId: BUSINESS_ID });
  await repository.checkout({ items: [{ productId: 'p1', quantity: 3, unitPrice: 999 }], paymentMethod: 'cash', idempotencyKey: 'checkout-00001', requestFiscal: true, total: 1 });
  const call = client.calls[0];
  assert.equal(call.name, 'checkout_pos_sale');
  assert.deepEqual(call.args.p_items, [{ productId: 'p1', quantity: 3 }]);
  assert.equal(Object.hasOwn(call.args, 'total'), false);
});

test('packing inicia, registra, deshace y confirma s\u00f3lo mediante RPC', async () => {
  const client = mockClient();
  const repository = createSupabasePackingRepository({ client });
  await repository.start({ orderId: 'o1', expectedRevision: 3, idempotencyKey: 'packing-o1-r3' });
  await repository.scan({ sessionId: 's1', gtin: '4006381333931', scanKey: 'scan-00001' });
  await repository.undo({ sessionId: 's1' });
  await repository.confirm({ sessionId: 's1', exceptionReason: null });
  assert.deepEqual(client.calls.map(({ name }) => name), [
    'start_packing_session', 'record_packing_scan', 'undo_last_packing_scan', 'confirm_packing_session',
  ]);
});

test('fiscal no acepta endpoints, certificado, CAE ni n\u00famero desde el panel', async () => {
  const client = mockClient();
  const repository = createSupabaseFiscalRepository({ client, businessId: BUSINESS_ID });
  await repository.requestDocument({ sourceType: 'pos_sale', sourceId: 's1', idempotencyKey: 'fiscal-00001', endpoint: 'blocked', cae: 'blocked' });
  const args = client.calls[0].args;
  assert.deepEqual(Object.keys(args).sort(), ['p_business_id', 'p_document_intent', 'p_idempotency_key', 'p_source_id', 'p_source_type']);
});

test('repositorios cr\u00edticos no contienen mutaciones directas PostgREST', () => {
  for (const relative of ['supabase-business-repository.js','supabase-inventory-repository.js','supabase-packing-repository.js','supabase-pos-repository.js','supabase-fiscal-repository.js']) {
    const source = fs.readFileSync(new URL(`../js/repositories/${relative}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /[.]from\([^\n]+\)[\s\S]{0,400}[.](?:insert|update|delete|upsert)\(/i);
  }
});

function mockClient() {
  const calls = [];
  const queries = [];
  return {
    calls, queries,
    async rpc(name, args) { calls.push({ name, args }); return { data: { ok: true }, error: null, status: 200 }; },
    from(table) {
      const record = { table, filters: {} };
      queries.push(record);
      const query = {
        select() { return query; },
        eq(key, value) { record.filters[key] = value; return query; },
        order() { return query; },
        limit() { return query; },
        async maybeSingle() { return { data: null, error: null, status: 200 }; },
        then(resolve) { resolve({ data: [], error: null, status: 200 }); },
      };
      return query;
    },
  };
}
