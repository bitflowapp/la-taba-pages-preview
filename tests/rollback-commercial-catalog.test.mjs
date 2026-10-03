import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  REVERSIBLE_SOURCES,
  describeBatchItems,
  describeBatches,
  imageChanges,
  listCatalogBatches,
  parseRollbackArgs,
  readCatalogBatch,
  renderRollbackResult,
  rollbackCatalogBatch,
  runRollback,
} from '../scripts/rollback-commercial-catalog.mjs';
import { applyCommercialImport, buildCommercialPlan } from '../scripts/import-commercial-catalog.mjs';

const BUSINESS = '00000000-0000-4000-8000-000000000001';
const BATCH = '11111111-2222-4333-8444-555555555555';
const ROLLBACK = '99999999-8888-4777-8666-555555555555';

/*
 * Un cliente de mentira que anota cada lectura y cada RPC. Las pruebas de acá
 * abajo afirman sobre lo que la herramienta PIDE, no sólo sobre lo que muestra:
 * que nunca lee sin acotar al comercio y que la única escritura es la RPC.
 */
function fakeClient({ batches = [], items = [], rpc } = {}) {
  const calls = [];
  const from = (table) => {
    const query = { table, filters: [] };
    const api = {
      select(columns) { query.columns = columns; return api; },
      eq(column, value) { query.filters.push(['eq', column, value]); return api; },
      in(column, values) { query.filters.push(['in', column, values]); return api; },
      order() { return api; },
      limit(count) { query.limit = count; return api; },
      then(resolve, reject) {
        calls.push(query);
        const source = table === 'catalog_change_batches' ? batches : items;
        const data = source.filter((row) => query.filters.every(([kind, column, value]) => (
          kind === 'eq' ? row[column] === value : value.includes(row[column])
        )));
        return Promise.resolve({ data: query.limit ? data.slice(0, query.limit) : data, error: null }).then(resolve, reject);
      },
    };
    return api;
  };
  return {
    calls,
    from,
    rpc: async (name, payload) => {
      calls.push({ rpc: name, payload });
      return rpc ? rpc(name, payload) : { data: null, error: { message: 'sin RPC' } };
    },
  };
}

const batchRow = (overrides = {}) => ({
  id: BATCH, business_id: BUSINESS, source: 'commercial_plan', created_at: '2026-10-02T15:00:00+00:00',
  rolled_back_at: null, rollback_batch_id: null, reverts_batch_id: null, ...overrides,
});
const image = (overrides = {}) => ({
  price: 1500, price_status: 'confirmed', stock: 12, available: true, merchant_available: true, is_verified: true, ...overrides,
});
const itemRows = () => ([
  { batch_id: BATCH, business_id: BUSINESS, sku: 'agua-villavicencio-1500ml', action: 'updated', before: image(), after: image({ price: 1800 }) },
  { batch_id: BATCH, business_id: BUSINESS, sku: 'galletitas-oreo-118g', action: 'updated', before: image({ available: false, merchant_available: false }), after: image() },
  { batch_id: BATCH, business_id: BUSINESS, sku: 'lavandina-ayudin-1000ml', action: 'created', before: null, after: image({ available: false, merchant_available: false, is_verified: false }) },
  { batch_id: BATCH, business_id: BUSINESS, sku: 'yerba-playadito-500g', action: 'unchanged', before: image(), after: image() },
]);

test('los argumentos: listar, mirar un lote o revertirlo, y nada a medias', () => {
  assert.deepEqual(parseRollbackArgs(['--list']), { mode: 'list', limit: 20, json: false });
  assert.deepEqual(parseRollbackArgs(['--list', '--limit', '5', '--json']), { mode: 'list', limit: 5, json: true });
  assert.deepEqual(parseRollbackArgs([BATCH.toUpperCase()]), { mode: 'preview', batchId: BATCH, json: false });
  assert.deepEqual(parseRollbackArgs([BATCH, '--apply', '--target', 'supabase']), { mode: 'apply', batchId: BATCH, json: false });

  assert.throws(() => parseRollbackArgs([]), /exactamente un lote/);
  assert.throws(() => parseRollbackArgs(['el-de-ayer']), /UUID/);
  assert.throws(() => parseRollbackArgs([BATCH, '--apply']), /--apply exige --target/);
  assert.throws(() => parseRollbackArgs([BATCH, '--apply', '--target', 'produccion']), /único destino/);
  assert.throws(() => parseRollbackArgs([BATCH, '--target']), /--target requiere un valor/);
  assert.throws(() => parseRollbackArgs(['--list', '--apply', '--target', 'supabase']), /no se combina/);
  assert.throws(() => parseRollbackArgs(['--list', BATCH]), /no lleva lote/);
  assert.throws(() => parseRollbackArgs(['--list', '--limit', '0']), /entre 1 y 100/);
  assert.throws(() => parseRollbackArgs([BATCH, '--forzar']), /Flag desconocido: --forzar/);
});

test('mirar un lote no escribe: ninguna RPC, y cada lectura va acotada al comercio o al lote', async () => {
  const client = fakeClient({ batches: [batchRow()], items: itemRows() });
  const lines = [];
  const outcome = await runRollback({ mode: 'preview', batchId: BATCH, json: false }, { client, businessId: BUSINESS, out: (line) => lines.push(line) });
  assert.deepEqual(outcome, { mode: 'preview', items: 4 });
  assert.equal(client.calls.filter((call) => call.rpc).length, 0);
  const batchRead = client.calls.find((call) => call.table === 'catalog_change_batches');
  assert.deepEqual(batchRead.filters, [['eq', 'business_id', BUSINESS], ['eq', 'id', BATCH]]);
  const text = lines.join('\n');
  assert.match(text, /agua-villavicencio-1500ml\n\s+precio: 1500 → 1800/);
  assert.match(text, /galletitas-oreo-118g\n\s+el comercio lo ofrece: false → true\n\s+a la venta: false → true/);
  assert.match(text, /ALTAS DEL LOTE \(1\) — no se borran/);
  assert.match(text, /Sin cambio en el lote: 1 producto/);
  assert.match(text, /No se escribió nada/);
});

test('un lote de otro comercio se contesta igual que uno que no existe', async () => {
  const client = fakeClient({ batches: [batchRow({ business_id: '22222222-2222-4222-8222-222222222222' })], items: itemRows() });
  await assert.rejects(
    () => runRollback({ mode: 'apply', batchId: BATCH, json: false }, { client, businessId: BUSINESS, out: () => {} }),
    /no existe para este comercio/,
  );
  assert.equal(client.calls.filter((call) => call.rpc).length, 0, 'sin lote visible no se llama a la base');
});

test('revertir llama UNA vez a la RPC con el comercio y el lote, y muestra lo que la base contestó', async () => {
  const result = {
    ok: true, batch_id: ROLLBACK, reverts_batch_id: BATCH, replay: false,
    restored: 1, skipped_changed: 1, skipped_created: 1, unchanged: 1, holds_reopened: 0, off_sale_intent_on: 0,
    items: [
      { sku: 'agua-villavicencio-1500ml', outcome: 'restored', price: 1500, price_status: 'confirmed', available_stock: 12, available: true },
      { sku: 'galletitas-oreo-118g', outcome: 'skipped_changed', changed_fields: ['price'], price: 990, price_status: 'confirmed', available_stock: 3, available: true },
      { sku: 'lavandina-ayudin-1000ml', outcome: 'skipped_created', price: null, price_status: 'pending', available_stock: 0, available: false },
    ],
  };
  const client = fakeClient({ batches: [batchRow()], items: itemRows(), rpc: async () => ({ data: result, error: null }) });
  const lines = [];
  const outcome = await runRollback({ mode: 'apply', batchId: BATCH, json: false }, { client, businessId: BUSINESS, out: (line) => lines.push(line) });
  assert.deepEqual(outcome, { mode: 'apply', restored: 1, replay: false });
  const rpcs = client.calls.filter((call) => call.rpc);
  assert.deepEqual(rpcs, [{ rpc: 'rollback_commercial_catalog_batch', payload: { p_business_id: BUSINESS, p_batch_id: BATCH } }]);
  const text = lines.join('\n');
  assert.match(text, new RegExp(`Reversión registrada como lote ${ROLLBACK}`));
  assert.match(text, /agua-villavicencio-1500ml — RESTAURADO/);
  assert.match(text, /galletitas-oreo-118g — NO SE TOCÓ \(cambió después del lote\) · cambió: price/);
  assert.match(text, /lavandina-ayudin-1000ml — NO SE TOCÓ \(es un alta: no se borra\)/);
  assert.match(text, /queda: precio \(vacío\) \(pending\), stock disponible 0, a la venta false/);
});

test('pedir de nuevo una reversión ya hecha se informa como repetición, no como otra reversión', () => {
  const lines = renderRollbackResult({ ok: true, replay: true, batch_id: ROLLBACK, restored: 1, items: [] });
  assert.match(lines[0], /ya estaba revertido/);
  assert.doesNotMatch(lines.join('\n'), /Reversión registrada/);
});

test('lo que no es un lote comercial no se intenta revertir', async () => {
  assert.deepEqual([...REVERSIBLE_SOURCES], ['commercial_batch', 'commercial_plan']);
  for (const source of ['publication', 'unpublish', 'verification', 'scanned_product', 'rollback']) {
    const client = fakeClient({
      batches: [batchRow({ source, ...(source === 'rollback' ? { reverts_batch_id: ROLLBACK } : {}) })],
      items: [],
      rpc: async () => ({ data: { ok: true }, error: null }),
    });
    await assert.rejects(
      () => runRollback({ mode: 'apply', batchId: BATCH, json: false }, { client, businessId: BUSINESS, out: () => {} }),
      /la base no lo revierte/, source,
    );
    assert.equal(client.calls.filter((call) => call.rpc).length, 0, source);
  }
});

test('un rechazo de la base o una respuesta que no es un resultado no se da por reversión hecha', async () => {
  const refused = fakeClient({ rpc: async () => ({ data: null, error: { message: 'Only an active owner/admin can roll back a commercial catalog batch.' } }) });
  await assert.rejects(() => rollbackCatalogBatch(refused, BUSINESS, BATCH), /El servidor no revirtió el lote: Only an active owner/);
  for (const data of [null, [], 'ok', { ok: false }, { restored: 3 }]) {
    const odd = fakeClient({ rpc: async () => ({ data, error: null }) });
    await assert.rejects(() => rollbackCatalogBatch(odd, BUSINESS, BATCH), /no se da por hecha/);
  }
  await assert.rejects(() => rollbackCatalogBatch({}, BUSINESS, BATCH), /Cliente Supabase inválido/);
});

test('la lista cuenta productos por lote y dice cuál se puede revertir', async () => {
  const other = '33333333-3333-4333-8333-333333333333';
  const client = fakeClient({
    batches: [
      batchRow(),
      batchRow({ id: other, source: 'publication', created_at: '2026-10-01T10:00:00+00:00' }),
      batchRow({ id: ROLLBACK, source: 'commercial_batch', rolled_back_at: '2026-10-02T16:00:00+00:00', rollback_batch_id: other }),
    ],
    items: [...itemRows(), { batch_id: other, business_id: BUSINESS, sku: 'x', action: 'updated', before: image(), after: image({ available: false }) }],
  });
  const batches = await listCatalogBatches(client, BUSINESS, { limit: 20 });
  assert.deepEqual(batches.map((batch) => [batch.id, batch.products, batch.moved]), [[BATCH, 4, 3], [other, 1, 1], [ROLLBACK, 0, 0]]);
  assert.deepEqual(client.calls[0].filters, [['eq', 'business_id', BUSINESS]]);
  const text = describeBatches(batches).join('\n');
  assert.match(text, new RegExp(`${BATCH}.*planilla · 3 de 4 producto\\(s\\) cambiaron · se puede revertir`));
  assert.match(text, new RegExp(`${other}.*publicación.*no es un lote reversible`));
  assert.match(text, new RegExp(`${ROLLBACK}.*lote del Panel.*revertido el 2026-10-02T16:00:00`));
  assert.deepEqual(describeBatches([]), ['No hay lotes registrados para este comercio.']);
  assert.equal(await readCatalogBatch(fakeClient(), BUSINESS, BATCH), null);
});

test('la imagen compara valores, no referencias, y un alta no tiene «antes»', () => {
  assert.deepEqual(imageChanges(image(), image()), []);
  assert.deepEqual(imageChanges(null, image()), []);
  assert.deepEqual(
    imageChanges(image({ price: null, price_status: 'pending' }), image()).map((change) => change.field),
    ['price', 'price_status'],
  );
  const lines = describeBatchItems({ batch: batchRow({ source: 'publication' }), items: [] }).join('\n');
  assert.match(lines, /la base no lo revierte/);
  assert.match(lines, /no cambió la imagen de ningún producto existente/);
});

test('el importador devuelve el lote que la base registró, para poder deshacerlo', async () => {
  const catalog = new Map([['coca-cola-original-1500ml', {
    sku: 'coca-cola-original-1500ml', name: 'Coca-Cola Original', category_id: 'gaseosas',
    price: '2500', stock: '10', publication_status: 'published', image_master: 'assets/products/coca.webp',
  }]]);
  const plan = buildCommercialPlan('sku,precio,stock,publicar\ncoca-cola-original-1500ml,2600,8,no\n', { catalog, imageExists: () => true });
  assert.deepEqual(plan.errors, []);
  const withTrail = { rpc: async (name, payload) => ({ data: { ok: true, created: 0, updated: payload.p_updates.length, batch_id: BATCH } }) };
  assert.equal((await applyCommercialImport(withTrail, plan, BUSINESS)).batchId, BATCH);
  // Una base anterior al rastro de cambios no devuelve lote: no se inventa uno.
  const withoutTrail = { rpc: async (name, payload) => ({ data: { ok: true, created: 0, updated: payload.p_updates.length } }) };
  assert.equal('batchId' in (await applyCommercialImport(withoutTrail, plan, BUSINESS)), false);
});

test('la herramienta no trae clave propia ni destino por defecto, y la reversión real es la RPC de la base', () => {
  const source = fs.readFileSync(new URL('../scripts/rollback-commercial-catalog.mjs', import.meta.url), 'utf8');
  assert.match(source, /readCommercialCredentials\(process\.env\)/);
  assert.doesNotMatch(source, /sb_secret_|service_role|supabase\.co/);
  assert.equal(source.match(/\.rpc\(/g).length, 1);
  assert.doesNotMatch(source, /\.(insert|update|upsert|delete)\(/);
  const migration = fs.readFileSync(new URL('../supabase/migrations/20261001210000_catalog_stock_authority.sql', import.meta.url), 'utf8');
  assert.match(migration, /create or replace function public\.rollback_commercial_catalog_batch\(p_business_id uuid, p_batch_id uuid\)/);
  assert.match(migration, /'batch_id', v_batch_id,/);
});
