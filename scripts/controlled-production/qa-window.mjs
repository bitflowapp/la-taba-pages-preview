// The QA control business lives in the CONTROLLED_PRODUCTION database, so it
// must be CLOSED whenever no QA run is in progress: while it is `open`, the
// public RLS policy exposes its QA products to anyone holding the publishable
// key and the order RPCs accept anonymous orders for it. Every harness that
// needs it opens a window with the QA owner session and closes it in `finally`.
//
//   node scripts/controlled-production/qa-window.mjs close --target controlled-production
//   node scripts/controlled-production/qa-window.mjs status --target controlled-production
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const QA_CONTROL_BUSINESS = 'e1d2c342-da14-421e-884f-ff38bb55f642';
export const REAL_BUSINESS = 'e7850ad2-a447-402c-8375-3fd74e9466ba';

async function setState(ownerClient, businessId, status) {
  const { data, error } = await ownerClient.rpc('set_business_open_state',
    { p_business_id: businessId, p_status: status });
  if (error || data?.ok !== true || data.status !== status) {
    throw Error(`QA_WINDOW_${status.toUpperCase()}_FAILED:${error?.code || data?.status || 'refused'}`);
  }
}

// Opens the QA business for one run. Never touches the real business: the
// window is for QA tenants only. `close()` is idempotent and always leaves the
// QA business closed, whatever state it had before (a QA tenant left open by a
// crashed run is exactly what this closes).
export async function openQaWindow(ownerClient, businessId, { log = () => {} } = {}) {
  assert.notEqual(businessId, REAL_BUSINESS, 'QA_WINDOW_REFUSES_REAL_BUSINESS');
  const before = await ownerClient.from('businesses').select('status').eq('id', businessId).single();
  if (before.error) throw Error(`QA_WINDOW_READ_FAILED:${before.error.code}`);
  if (before.data.status !== 'open') await setState(ownerClient, businessId, 'open');
  log(`qa window open (was ${before.data.status})`);
  let closed = false;
  return {
    previous: before.data.status,
    async close() {
      if (closed) return 'closed';
      await setState(ownerClient, businessId, 'closed');
      closed = true;
      log('qa window closed');
      return 'closed';
    },
  };
}

// Anonymous exposure probe with the publishable key only: which tenants have
// products readable by the public, and whether any of them is not the real
// business. Used by the public smoke and by the CLI below.
export async function publicCatalogTenants(publicClient) {
  const { data, error } = await publicClient.from('products').select('business_id').limit(1000);
  if (error) throw Error(`PUBLIC_CATALOG_READ_FAILED:${error.code}`);
  return [...new Set((data || []).map((row) => row.business_id))].sort();
}

export function foreignPublicTenants(tenants, businessId) {
  return tenants.filter((id) => id !== businessId);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const opt = (name, fallback = '') => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
  assert.ok(['open', 'close', 'status'].includes(command), 'Usage: qa-window.mjs <open|close|status> --target controlled-production');
  assert.equal(opt('--target'), 'controlled-production', 'EXPLICIT_TARGET_REQUIRED');
  const businessId = opt('--business-id', QA_CONTROL_BUSINESS);
  const { createClient } = await import('@supabase/supabase-js');
  const { loadTargetKeys } = await import('./target-keys.mjs');
  const keys = await loadTargetKeys('controlled-production', { requireSecret: false });
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const tenants = await publicCatalogTenants(createClient(keys.url, keys.publishable, options));
  if (command === 'status') {
    const foreign = foreignPublicTenants(tenants, REAL_BUSINESS);
    console.log(JSON.stringify({ publicTenants: tenants, foreignPublic: foreign, verdict: foreign.length ? 'QA_EXPOSED' : 'PASS' }));
    process.exitCode = foreign.length ? 1 : 0;
    return;
  }
  const { readQaCredential } = await import('./qa-credentials.mjs');
  const stored = readQaCredential('CP QA OWNER');
  assert.ok(stored?.secreto, 'QA_CREDENTIAL_REQUIRED:CP QA OWNER');
  const owner = createClient(keys.url, keys.publishable, options);
  const signed = await owner.auth.signInWithPassword({ email: stored.usuario, password: stored.secreto });
  if (signed.error) throw Error(`QA_OWNER_SIGNIN_FAILED:${signed.error.code || signed.error.status}`);
  assert.notEqual(businessId, REAL_BUSINESS, 'QA_WINDOW_REFUSES_REAL_BUSINESS');
  await setState(owner, businessId, command === 'open' ? 'open' : 'closed');
  console.log(JSON.stringify({ businessId, command, status: command === 'open' ? 'open' : 'closed' }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => { console.error(`QA_WINDOW_FAIL:${error.message}`); process.exitCode = 1; });
}
