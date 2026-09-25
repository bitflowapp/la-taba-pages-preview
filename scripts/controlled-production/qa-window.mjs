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
// Longest QA run (capacity: 40 min job timeout) fits; the server caps it at 60.
export const QA_WINDOW_MINUTES = 45;

async function setState(ownerClient, businessId, status) {
  const { data, error } = await ownerClient.rpc('set_business_open_state',
    { p_business_id: businessId, p_status: status });
  if (error || data?.ok !== true || data.status !== status) {
    throw Error(`QA_WINDOW_${status.toUpperCase()}_FAILED:${error?.code || data?.status || 'refused'}`);
  }
}

// PGRST202: the RPC is not deployed yet (CP before 20260925090000).
const missingRpc = (error) => error?.code === 'PGRST202';

// Server-enforced window (20260925090000): the database closes it by itself
// when it expires, so a runner that dies without `finally` cannot leave the QA
// tenant public. Falls back to the plain open state only on a database that
// does not have the RPC yet.
export async function openWindowState(ownerClient, businessId, minutes = QA_WINDOW_MINUTES) {
  const { data, error } = await ownerClient.rpc('open_qa_window', { p_business_id: businessId, p_minutes: minutes });
  if (missingRpc(error)) { await setState(ownerClient, businessId, 'open'); return { enforced: false }; }
  if (error || data?.ok !== true || data.status !== 'open') throw Error(`QA_WINDOW_OPEN_FAILED:${error?.code || 'refused'}`);
  return { enforced: true, until: data.qa_window_until };
}

export async function closeWindowState(ownerClient, businessId) {
  const { data, error } = await ownerClient.rpc('close_qa_window', { p_business_id: businessId });
  if (missingRpc(error)) return setState(ownerClient, businessId, 'closed');
  if (error || data?.ok !== true || data.status !== 'closed') throw Error(`QA_WINDOW_CLOSED_FAILED:${error?.code || 'refused'}`);
  return undefined;
}

// Opens the QA business for one run. Never touches the real business: the
// window is for QA tenants only. `close()` is idempotent and always leaves the
// QA business closed, whatever state it had before (a QA tenant left open by a
// crashed run is exactly what this closes).
export async function openQaWindow(ownerClient, businessId, { log = () => {}, minutes = QA_WINDOW_MINUTES } = {}) {
  assert.notEqual(businessId, REAL_BUSINESS, 'QA_WINDOW_REFUSES_REAL_BUSINESS');
  const before = await ownerClient.from('businesses').select('status').eq('id', businessId).single();
  if (before.error) throw Error(`QA_WINDOW_READ_FAILED:${before.error.code}`);
  const opened = await openWindowState(ownerClient, businessId, minutes);
  log(`qa window open (was ${before.data.status}; server expiry ${opened.enforced ? opened.until : 'NOT ENFORCED'})`);
  let closed = false;
  return {
    previous: before.data.status,
    enforced: opened.enforced,
    async close() {
      if (closed) return 'closed';
      await closeWindowState(ownerClient, businessId);
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

// The operator's own open/close. `has_business_role` only recognises a session
// registered for the business (identity_register_session), exactly like the
// Panel does after login: a bare password sign-in gets 42501 from both RPCs.
export async function ownerWindowCommand(ownerClient, businessId, command) {
  assert.notEqual(businessId, REAL_BUSINESS, 'QA_WINDOW_REFUSES_REAL_BUSINESS');
  assert.ok(['open', 'close'].includes(command), 'QA_WINDOW_COMMAND_INVALID');
  const { data, error } = await ownerClient.rpc('identity_register_session', { p_business_id: businessId,
    p_client: 'panel_web', p_device_label: 'QA window operator', p_device_key_hash: null, p_app_version: 'cp-qa-window' });
  if (error || data?.ok !== true) throw Error(`QA_OWNER_SESSION_REFUSED:${error?.code || data?.code || 'refused'}`);
  if (command === 'open') await openWindowState(ownerClient, businessId);
  else await closeWindowState(ownerClient, businessId);
  return command === 'open' ? 'open' : 'closed';
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
  const status = await ownerWindowCommand(owner, businessId, command);
  console.log(JSON.stringify({ businessId, command, status }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => { console.error(`QA_WINDOW_FAIL:${error.message}`); process.exitCode = 1; });
}
