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

test('el operador nunca ve el constraint ni el SQL crudo que rechazó la fila', () => {
  const raw = classifyRpcError({
    code: '23514',
    message: 'new row for relation "fiscal_profiles" violates check constraint "fiscal_profiles_homologation_authorization_pairing"',
  }, 400);
  assert.equal(raw.code, '23514');
  assert.doesNotMatch(raw.message, /constraint|relation|fiscal_profiles/i);
  // Los mensajes que el propio servidor ya redactó llegan intactos.
  assert.equal(classifyRpcError({ code: '42501', message: 'homologacion no autorizada' }, 400).message, 'homologacion no autorizada');
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
  assert.equal(client.calls[1].name, 'request_fiscal_document');
  assert.equal(client.calls[1].args.p_source_id, 'sale-1');
  assert.equal(client.calls[1].args.p_idempotency_key, 'checkout-00001-fiscal');
});

test('una falla fiscal posterior no revierte ni disfraza la venta confirmada', async () => {
  const client = mockClient();
  client.rpc = async (name, args) => {
    client.calls.push({ name, args });
    if (name === 'checkout_pos_sale') return { data: { sale_id: 'sale-2', state: 'completed', total: 100 }, error: null, status: 200 };
    return { data: null, error: { code: 'P0001', message: 'fiscalizacion deshabilitada' }, status: 400 };
  };
  const repository = createSupabasePosRepository({ client, businessId: BUSINESS_ID });
  const result = await repository.checkout({ items: [{ productId: 'p1', quantity: 1 }], paymentMethod: 'cash', idempotencyKey: 'checkout-00002', requestFiscal: true });
  assert.equal(result.ok, true);
  assert.equal(result.data.state, 'completed');
  assert.equal(result.data.fiscal_status, 'request_failed');
  assert.equal(result.fiscal.ok, false);
});

test('packing inicia, reconcilia, revierte y confirma idempotente sólo mediante RPC', async () => {
  const client = mockClient();
  const repository = createSupabasePackingRepository({ client });
  await repository.start({ orderId: 'o1', expectedRevision: 3, idempotencyKey: 'packing-o1-r3' });
  await repository.scan({ sessionId: 's1', gtin: '4006381333931', scanKey: 'scan-00001' });
  await repository.manifest({ sessionId: 's1' });
  await repository.revert({ sessionId: 's1', scanKey: 'scan-00001', idempotencyKey: 'revert-00001' });
  await repository.confirm({ sessionId: 's1', exceptionReason: null, idempotencyKey: 'confirm-00001' });
  assert.deepEqual(client.calls.map(({ name }) => name), [
    'start_packing_session', 'record_packing_scan', 'get_packing_manifest',
    'revert_packing_scan', 'confirm_packing_session_once',
  ]);
});

test('fiscal no acepta endpoints, certificado, CAE ni n\u00famero desde el panel', async () => {
  const client = mockClient();
  const repository = createSupabaseFiscalRepository({ client, businessId: BUSINESS_ID });
  await repository.requestDocument({ sourceType: 'pos_sale', sourceId: 's1', idempotencyKey: 'fiscal-00001', endpoint: 'blocked', cae: 'blocked' });
  const args = client.calls[0].args;
  assert.deepEqual(Object.keys(args).sort(), ['p_business_id', 'p_document_intent', 'p_idempotency_key', 'p_source_id', 'p_source_type']);
});

test('panel fiscal solicita nota parcial, artefacto privado y reimpresión sólo mediante contratos server-side', async () => {
  const client = mockClient();
  const repository = createSupabaseFiscalRepository({ client, businessId: BUSINESS_ID });
  await repository.requestCreditNote({ originalDocumentId: 'd1', reason: 'Devolución parcial válida', creditKind: 'partial', lines: [{ original_item_id: 'i1', quantity: 1 }], idempotencyKey: 'credit-00001' });
  await repository.regenerateArtifact('d1');
  await repository.listArtifacts();
  await repository.requestPrintJob({ fiscalDocumentId: 'd1', artifactId: 'a1', printerNameHash: 'a'.repeat(64), format: 'a4', copies: 1, idempotencyKey: 'print-00001' });
  await repository.updatePrintJob({ printJobId: 'p1', status: 'unknown' });
  assert.deepEqual(client.calls.map(({ name }) => name), ['request_credit_note', 'request_fiscal_artifact_regeneration', 'list_fiscal_document_artifacts', 'request_fiscal_print_job', 'update_fiscal_print_job']);
  assert.equal(client.calls[0].args.p_credit_kind, 'partial');
  assert.deepEqual(client.calls[0].args.p_lines, [{ original_item_id: 'i1', quantity: 1 }]);
  assert.equal(client.calls[3].args.p_printer_name_hash, 'a'.repeat(64));
});

test('URL de PDF sólo llega desde Edge privada y no expone storage_path en el repositorio', async () => {
  const client = mockClient();
  const repository = createSupabaseFiscalRepository({ client, businessId: BUSINESS_ID });
  const response = await repository.requestArtifactUrl({ artifactId: 'artifact-1', action: 'preview' });
  assert.equal(response.ok, true);
  assert.equal(response.data.signedUrl, 'https://example.invalid/signed.pdf');
  assert.deepEqual(client.functions.calls[0], { name: 'fiscal-artifact-access', args: { body: { artifactId: 'artifact-1', action: 'preview' } } });
  const source = fs.readFileSync(new URL('../js/repositories/supabase-fiscal-repository.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /storage_path/i);
  assert.doesNotMatch(source, /service.?role/i);
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
  const functionCalls = [];
  return {
    calls, queries,
    functions: {
      calls: functionCalls,
      async invoke(name, args) {
        functionCalls.push({ name, args });
        return { data: { signedUrl: 'https://example.invalid/signed.pdf' }, error: null };
      },
    },
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: name === 'checkout_pos_sale' ? { sale_id: 'sale-1', state: 'completed', total: 100 } : { ok: true, fiscal_document_id: 'fiscal-1', state: 'queued' }, error: null, status: 200 };
    },
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
