// Caja Clara × La Taba — the owner closes a till from La Taba, live on
// CONTROLLED_PRODUCTION, QA control business only (the real store is untouched).
//
// The QA staff connects a real Caja Clara engine (CajaClara.TabaAgent, same
// services as the Windows app on a throw-away SQLite). The QA owner closes that
// session with the audited RPC the Panel uses (identity_revoke_session). La
// Taba must refuse the till at once; Caja Clara must say so and keep selling;
// what it sold meanwhile waits and is sent exactly once after the staff
// connects again. Till sessions left open by crashed runs of the QA business
// are closed the same way. The one QA unit sold is put back at the end.
//
//   node scripts/controlled-production/caja-clara-revocation-e2e.mjs --agent <CajaClara.TabaAgent.dll> [report.json]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createClient } from '@supabase/supabase-js';
import { loadTargetKeys } from './target-keys.mjs';
import { readQaCredential } from './qa-credentials.mjs';
import { operatorClient } from './qa-cleanup.mjs';
import { QA_CONTROL_BUSINESS, REAL_BUSINESS } from './qa-window.mjs';

const BUSINESS = QA_CONTROL_BUSINESS;
const STORE_URL = 'https://la-taba-commercial-pilot.pages.dev';
const OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const args = process.argv.slice(2);
const agentPath = args[args.indexOf('--agent') + 1];
const out = args.find((a) => a.endsWith('.json')) || `artifacts/controlled-production/caja-clara-revocation-${Date.now()}.json`;
assert.ok(agentPath && agentPath.endsWith('.dll'), 'AGENT_DLL_REQUIRED');

const log = (m) => process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] ${m}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { at: new Date().toISOString(), target: 'controlled-production', business: 'QA control', checks: {}, codes: {}, latency: {} };
const check = (name, ok, detail) => {
  report.checks[name] = ok ? 'PASS' : 'FAIL';
  if (detail !== undefined) report.codes[name] = detail;
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ` (${JSON.stringify(detail)})` : ''}`);
};

function startAgent() {
  const child = spawn('dotnet', [agentPath], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const lines = readline.createInterface({ input: child.stdout });
  const waiting = [];
  lines.on('line', (line) => { const next = waiting.shift(); if (next) next(JSON.parse(line)); });
  child.stderr.on('data', () => {});
  return {
    async send(cmd, body = {}, { expectOk = true } = {}) {
      const reply = new Promise((resolve) => waiting.push(resolve));
      child.stdin.write(`${JSON.stringify({ cmd, ...body })}\n`);
      const result = await Promise.race([reply, sleep(120_000).then(() => ({ ok: false, error: 'TIMEOUT' }))]);
      if (expectOk && !result.ok) throw Error(`AGENT_${cmd.toUpperCase()}:${result.error}:${result.message || ''}`);
      return result;
    },
    async quit() { try { await this.send('quit'); } catch { /* ignore */ } child.kill(); },
  };
}

const keys = await loadTargetKeys('controlled-production');
assert.equal(keys.ref, 'tkanbadcglszlcyfjvpv', 'WRONG_TARGET');
const admin = createClient(keys.url, keys.secret, OPTIONS);
const owner = await operatorClient(keys, 'CP QA OWNER', BUSINESS, 'owner');
const staff = await operatorClient(keys, 'CP QA STAFF', BUSINESS, 'staff');
const staffCred = readQaCredential('CP QA STAFF');
assert.ok(staffCred, 'QA_STAFF_CREDENTIAL_REQUIRED');
const openTills = async (business) => (await admin.from('identity_sessions').select('session_id,user_id,first_seen_at,last_seen_at')
  .eq('business_id', business).eq('client', 'caja_clara_windows').is('revoked_at', null)).data || [];

// ── 0. Till sessions left open by crashed runs: closed by the owner, audited ──
report.realStoreTillSessions = (await openTills(REAL_BUSINESS)).length;
check('NO_TILL_SESSION_ON_THE_REAL_STORE', report.realStoreTillSessions === 0, report.realStoreTillSessions);
const orphans = await openTills(BUSINESS);
report.orphansFound = orphans.length;
for (const orphan of orphans) {
  const r = await owner.rpc('identity_revoke_session', { p_session_id: orphan.session_id });
  if (r.error || !r.data?.ok) throw Error(`ORPHAN_REVOKE:${r.error?.code || r.data?.code}`);
}
check('ORPHAN_TILL_SESSIONS_CLOSED', (await openTills(BUSINESS)).length === 0, { found: orphans.length });

const product = (await staff.from('products').select('id,sku,name,price,stock,available').eq('business_id', BUSINESS)
  .eq('available', true).not('sku', 'is', null).gt('stock', 12).order('price', { ascending: false }).limit(1)).data?.[0];
assert.ok(product, 'QA_PRODUCT_REQUIRED');
const stockOf = async () => (await admin.from('products').select('stock,available').eq('id', product.id).single()).data;
const reservedOf = async () => {
  const { data } = await admin.from('order_items').select('quantity,orders!inner(status,inventory_released_at)').eq('product_uuid', product.id)
    .in('orders.status', ['received', 'submitted', 'accepted', 'preparing', 'ready', 'assigned']).is('orders.inventory_released_at', null);
  return (data || []).reduce((sum, row) => sum + Number(row.quantity), 0);
};
const initialStock = Number(product.stock);
report.product = { sku: product.sku, initialStock };

const agent = startAgent();
try {
  // ── 1. The staff opens a till bound to this PC ──────────────────────────
  const init = await agent.send('init');
  const connected = await agent.send('connect', { storeUrl: STORE_URL, email: staffCred.usuario, password: staffCred.secreto, business: BUSINESS });
  check('STAFF_TILL_CONNECTED', connected.connected === true && connected.role === 'staff', connected.role);
  const tills = (await admin.from('identity_sessions').select('session_id,client,revoked_at').eq('device_key_hash', init.device_hash).is('revoked_at', null)).data;
  assert.equal(tills?.length, 1, 'ONE_TILL_SESSION_EXPECTED');
  const tillSession = tills[0].session_id;
  await agent.send('sync', { full: true });
  const physical = initialStock + (await reservedOf());
  await agent.send('product', { name: product.name, sku: product.sku, price: Number(product.price), stock: physical });
  await agent.send('link', { sku: product.sku });
  await agent.send('sync', { full: true });
  const linked = await agent.send('stock', { sku: product.sku });
  check('LINKED_IN_SYNC', linked.link_state === 'InSync' && linked.taba_physical === physical, linked);

  // ── 2. The owner closes that till from La Taba ──────────────────────────
  const revokedAt = Date.now();
  const revoke = await owner.rpc('identity_revoke_session', { p_session_id: tillSession });
  check('OWNER_REVOKES_THE_TILL_WITH_THE_PANEL_RPC', !revoke.error && revoke.data?.code === 'revoked', revoke.error?.code || revoke.data?.code);
  const row = (await admin.from('identity_sessions').select('revoked_reason').eq('session_id', tillSession).single()).data;
  check('REVOCATION_RECORDED_AS_OWNER_REVOKED', row?.revoked_reason === 'owner_revoked', row?.revoked_reason);

  const refused = await agent.send('sync');
  const afterRevoke = await agent.send('status');
  report.latency.revocationNoticedMs = Date.now() - revokedAt;
  check('LA_TABA_REFUSES_THE_TILL_AT_ONCE', refused.failure !== null && afterRevoke.link === 'SessionExpired',
    { failure: refused.failure, link: afterRevoke.link, ms: report.latency.revocationNoticedMs });

  // ── 3. The counter keeps selling; the change waits, nothing reaches La Taba ─
  const before = await stockOf();
  await agent.send('sell', { sku: product.sku, qty: 1 });
  const stillRefused = await agent.send('sync');
  const waiting = await agent.send('outbox');
  const untouched = await stockOf();
  check('TILL_KEEPS_SELLING_AND_HOLDS_THE_CHANGE', stillRefused.failure !== null && waiting.items['StockDelta:Pending'] === 1 && untouched.stock === before.stock,
    { outbox: waiting.items, server: untouched.stock, before: before.stock });

  // ── 4. The staff connects again: what waited is sent once ───────────────
  const again = await agent.send('connect', { storeUrl: STORE_URL, email: staffCred.usuario, password: staffCred.secreto, business: BUSINESS });
  await agent.send('sync', { full: true });
  await agent.send('sync');
  const sent = await agent.send('outbox');
  const after = await stockOf();
  const status = await agent.send('status');
  const sessions = (await admin.from('identity_sessions').select('session_id,revoked_at').eq('device_key_hash', init.device_hash)).data || [];
  check('RECONNECT_SENDS_WHAT_WAITED_EXACTLY_ONCE', again.connected === true && status.link === 'Connected' && after.stock === before.stock - 1
    && sent.items['StockDelta:Done'] === 1 && !sent.items['StockDelta:Pending'], { outbox: sent.items, server: after.stock, link: status.link });
  check('OLD_TILL_SESSION_STAYS_CLOSED', sessions.length === 2 && sessions.filter((s) => !s.revoked_at).length === 1
    && sessions.find((s) => s.session_id === tillSession)?.revoked_at, sessions.length);
} catch (error) {
  report.error = error.message;
  log(`ERROR ${error.message}`);
} finally {
  try { await agent.send('disconnect', {}, { expectOk: false }); } catch { /* ignore */ }
  await agent.quit();
  // Put the QA unit back the way the other QA runs do.
  const now = await stockOf();
  const delta = initialStock - now.stock;
  if (delta !== 0) {
    const r = await owner.rpc('apply_inventory_movement', { p_business_id: BUSINESS, p_product_id: product.id, p_barcode_id: null,
      p_movement_type: 'stock_count', p_package_quantity: Math.abs(delta), p_direction: delta > 0 ? 1 : -1,
      p_reference_type: 'pilot_qa_return', p_reference_id: null, p_reason: 'QA Caja Clara revocación: restitución del stock QA',
      p_idempotency_key: `qa_cc_revoke_restore_${Date.now()}` });
    report.restore = r.error ? { error: r.error.code } : { delta };
  }
  const final = await stockOf();
  report.stockRestored = final.stock === initialStock && final.available === true;
  report.tillSessionsLeftOpen = (await openTills(BUSINESS)).length;
  const realStore = (await admin.from('businesses').select('status,ordering_enabled').eq('id', REAL_BUSINESS).single()).data;
  report.realStoreUntouched = realStore.status === 'closed' && realStore.ordering_enabled === false;
  for (const c of [owner, staff]) { try { await c.rpc('identity_close_own_session', { p_business_id: BUSINESS }); } catch { /* ignore */ } }
}

const failed = Object.entries(report.checks).filter(([, v]) => v !== 'PASS').map(([k]) => k);
report.failed = failed;
report.verdict = !report.error && failed.length === 0 && report.stockRestored && report.tillSessionsLeftOpen === 0 && report.realStoreUntouched ? 'PASS' : 'FAIL';
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ verdict: report.verdict, failed, error: report.error, latency: report.latency, orphans: report.orphansFound }, null, 1));
process.exit(report.verdict === 'PASS' ? 0 : 1);
