import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { isValidIdempotencyKey } from '../js/core/idempotency-key.js';
import {
  configureBusinessOperations, handleBusinessOperationsAction,
  renderBusinessOperations, resetBusinessOperationsForTests,
} from '../js/business/business-operations-center.js';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260802200000_durable_offline_packing.sql', import.meta.url), 'utf8');
const nativeCache = fs.readFileSync(new URL('../src-tauri/src/packing_cache.rs', import.meta.url), 'utf8');

test('contrato durable de packing es privado, idempotente y no cachea cliente', () => {
  assert.match(migration, /create or replace function public\.get_packing_manifest\(p_session_id uuid\)/i);
  assert.match(migration, /scan_key reutilizada con otro codigo/i);
  assert.match(migration, /business_command_request_hash\([\s\S]*revert_packing_scan/i);
  assert.match(migration, /confirm_packing_session_once[\s\S]*business_command_receipts/i);
  assert.match(migration, /revoke all on function public\.get_packing_manifest[\s\S]*from public,anon,authenticated/i);
  assert.doesNotMatch(migration.match(/create or replace function public\.get_packing_manifest[\s\S]*?\$packing_manifest\$;/i)?.[0] || '', /customer_|address_|delivery_code/i);
  assert.match(nativeCache, /snapshot_sha256/i);
  assert.match(nativeCache, /local_packing_cache_events/i);
  assert.match(nativeCache, /2_000_000/);
});

test('packing offline usa manifiesto cacheado, encola scan y bloquea confirmación remota', async () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  const saved = [];
  const queued = [];
  let lookupCalls = 0;
  try {
    configureBusinessOperations({
      businessId: 'business-1',
      operatorId: 'operator-1',
      getOrders: () => [{ id: 'order-1', backendId: 'order-1', code: 'ORD-1', revision: 2, status: 'accepted' }],
      lookupBarcode: async () => { lookupCalls += 1; return { ok: false }; },
      startPacking: async () => ({ ok: true, data: { id: 'session-1' } }),
      getPackingManifest: async () => ({
        ok: true,
        data: {
          schemaVersion: 1,
          session: {
            id: 'session-1', businessId: 'business-1', orderId: 'order-1', orderRevision: 2,
            status: 'in_progress', operatorId: 'operator-1', updatedAt: '2026-08-02T10:00:00Z',
          },
          items: [{ productId: 'product-1', name: 'Producto sintético', quantity: 1, barcodes: [{ gtin: '4006381333931', unitFactor: 1 }] }],
          scans: [],
        },
      }),
      recordPackingScan: async (input) => { queued.push(input); return { ok: false, pending: true }; },
      drainPackingCommands: async () => [],
      listPackingCommands: () => [],
      desktopPlatform: {
        async loadPackingCache() { return null; },
        async savePackingCache(snapshot) { saved.push(snapshot); return snapshot; },
        async deletePackingCache() { return true; },
      },
      onChange() {},
    });
    renderBusinessOperations('packing');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const root = {
      querySelector(selector) {
        if (selector === '[name="packingOrder"]') return { value: 'order-1' };
        if (selector === '[data-barcode-input]') return { value: '4006381333931' };
        if (selector === '[name="packingExceptionReason"]') return { value: '' };
        return null;
      },
    };
    const actionTarget = (selector) => ({
      closest(candidate) {
        if (candidate === selector) return this;
        if (candidate === '[data-business-ops-center]') return root;
        return null;
      },
    });
    assert.equal((await handleBusinessOperationsAction(actionTarget('[data-packing-start]'))).ok, true);
    globalThis.navigator.onLine = false;
    assert.equal((await handleBusinessOperationsAction(actionTarget('[data-business-scan-test]'))).ok, true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(lookupCalls, 0);
    assert.equal(queued.length, 1);
    // La clave del scan viaja como idempotency_key al servidor, así que lo que
    // importa no es el prefijo sino que CUMPLA el contrato: hasta el
    // 2026-08-22 este caso fijaba `packing-scan:` con dos puntos, o sea
    // afirmaba la forma exacta que el backend rechaza.
    assert.match(queued[0].scanKey, /^packing-scan-/);
    assert.ok(isValidIdempotencyKey(queued[0].scanKey), queued[0].scanKey);
    assert.equal(saved.at(-1).scans[0].syncState, 'pending');
    assert.match(renderBusinessOperations('packing'), /1 lectura\(s\) en cola durable/);
    const confirmation = await handleBusinessOperationsAction(actionTarget('[data-packing-confirm]'));
    assert.equal(confirmation.ok, false);
    assert.match(confirmation.message, /reconectá/i);
  } finally {
    resetBusinessOperationsForTests();
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    else delete globalThis.navigator;
  }
});
