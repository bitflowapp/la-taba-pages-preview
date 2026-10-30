import test from 'node:test';
import assert from 'node:assert/strict';
import { leerCompleto } from '../scripts/mercadopago/piloto/lectura-completa.mjs';
import { evaluarPreflight } from '../scripts/mercadopago/piloto/preflight.mjs';
import { reunirPreflight } from '../scripts/mercadopago/piloto-pago-real.mjs';

test('pilot rejects capped PostgREST results, errors and missing exact counts', async () => {
  for (const response of [{ data: [{}], count: 1001 }, { data: [], count: null },
    { data: null, count: 0 }, { data: [], count: 0, error: { code: '42501' } }]) {
    await assert.rejects(leerCompleto(Promise.resolve(response), 'la cola'));
  }
  assert.deepEqual(await leerCompleto(Promise.resolve({ data: [], count: 0 }), 'la cola'), []);
});
test('pilot reads an old completed payment and blocks on its unresolved refund', async () => {
  const db = {
    rpc: async () => ({ data: { pilot_lock_applies: true, authorizations: [] } }),
    from(table) {
      let rows = table === 'payment_intents' ? [{ id: 'old', internal_status: 'completed', updated_at: '2026-01-01T00:00:00Z' }]
        : table === 'payment_refunds' ? [{ payment_intent_id: 'old', status: 'ambiguous' }] : [];
      let head = false;
      const q = {
        select(fields, options = {}) { head = Boolean(options.head); return q; },
        eq() { return q; }, neq() { return q; }, gt() { return q; }, gte() { return q; }, is() { return q; },
        in(field, ids) { if (table === 'payment_refunds') rows = rows.filter(r => ids.includes(r[field])); return q; },
        or() { rows = []; return q; }, // The old seven-day filter hid this completed intent.
        limit(n) { rows = rows.slice(0, n); return q; },
        then(resolve) { return Promise.resolve({ data: head ? null : rows, count: rows.length }).then(resolve); },
      };
      return q;
    },
  };
  const input = await reunirPreflight({ db, entorno: 'test' }, { target: 'qa', business: 'B' });
  assert.equal(input.mp.refunds.length, 1);
  const result = evaluarPreflight(input);
  assert.equal(result.checks.find(c => c.id === 'cola_y_conciliacion').estado, 'FAIL');
});
test('unknown or malformed seller token expiry is a blocking check', () => {
  for (const expires_at of [null, undefined, 'invalid']) {
    const result = evaluarPreflight({ target: 'qa', ahora: Date.now(), conexion: { expires_at } });
    assert.equal(result.checks.find(c => c.id === 'credencial_vigente').estado, 'FAIL');
  }
});
