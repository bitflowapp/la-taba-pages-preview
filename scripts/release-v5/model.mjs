import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PROJECT = 'wwcpogltfgzgkrlilbcd';
export const PROTOCOL = 'taba-a1-a4-v5';
export const CLI_VERSION = '2.101.0';
export const LOCK = [1413562945, 5];
export const QUIET_SECONDS = 430;
export const FUNCTIONS = Object.freeze([
  'mercadopago-create-preference', 'mercadopago-payment-worker', 'mercadopago-refund',
]);
export const INVENTORY = Object.freeze([
  ...FUNCTIONS, 'mercadopago-create-checkout-session', 'mercadopago-checkout-status',
  'mercadopago-webhook', 'mercadopago-cancel-payment', 'mercadopago-connect', 'mercadopago-oauth-callback',
].sort());
export const VERIFY_JWT = Object.freeze({
  'mercadopago-create-preference': false,
  'mercadopago-payment-worker': false,
  'mercadopago-refund': true,
});
export const EXPAND = Object.freeze([
  '20260908164550_current_payment_authority_and_refund_identity.sql',
  '20260908190758_a1_attempt_authority_expand_v2.sql',
  '20260909011239_a1_a4_durable_contract_control_v3.sql',
  '20260909050330_a1_a4_release_interlock_v5.sql',
]);
export const CONTRACT = 'supabase/contracts/a1_a4_contract_v5.sql';
export const EMPTY_TABLES = Object.freeze([
  'checkout_sessions', 'checkout_session_items', 'inventory_reservations',
  'payment_intents', 'payment_attempts', 'payment_webhook_receipts', 'payment_events',
  'payment_refunds', 'payment_cancellations', 'payment_disputes', 'payment_outbox',
]);
export const GUARDED_TABLES = Object.freeze([...EMPTY_TABLES, 'business_payment_settings', 'mp_seller_connections', 'mp_oauth_states']);
export const SCHEDULERS = Object.freeze({
  'taba-payment-outbox-worker': "select public.dispatch_payment_outbox_worker('cron');",
  'taba-checkout-expiry-sweep': 'select public.sweep_expired_checkout_sessions();',
  'taba-checkout-provider-truth-sweep': 'select public.enqueue_checkout_provider_probes();',
  'taba-operational-alerts-sweep': 'select public.evaluate_operational_alerts_sweep();',
});

export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
export const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
  : JSON.stringify(value);
export const identity = value => sha256(canonical(value));
export function target(project) { assert.equal(project, PROJECT, 'explicit production project required'); }
export function exactFunctions(values) {
  assert.deepEqual([...values].sort(), [...FUNCTIONS].sort(), 'exact three-function set required');
}
export function cliDeployArgs(project) {
  target(project);
  return ['functions', 'deploy', ...FUNCTIONS, '--project-ref', project, '--use-api', '--jobs', '3'];
}

// Baselines can have legacy JWT configuration. Newly staged versions must have
// the reviewed configuration. Timestamps and raw-source hashes are not versions.
export function remoteFunction(value, { staged = false } = {}) {
  assert.ok(value && typeof value === 'object', 'missing remote function');
  assert.equal(value.name, value.slug, 'remote function name/slug mismatch');
  assert.ok(INVENTORY.includes(value.slug), 'unexpected remote function');
  assert.match(value.id, /^[a-f0-9-]{36}$/i, 'remote ID required');
  assert.ok(Number.isSafeInteger(value.version) && value.version > 0, 'remote version required');
  assert.equal(value.status, 'ACTIVE', 'remote function inactive');
  if (!staged || value.ezbr_sha256 != null) assert.match(value.ezbr_sha256, /^[a-f0-9]{64}$/, 'remote ESZip identity required');
  assert.equal(typeof value.verify_jwt, 'boolean', 'remote JWT configuration missing');
  if (!staged || value.created_at != null) assert.ok(Number.isSafeInteger(value.created_at) && value.created_at > 0, 'remote creation timestamp required');
  if (!staged) assert.ok(Number.isSafeInteger(value.updated_at) && value.updated_at >= value.created_at, 'remote update timestamp required');
  if (!staged || value.entrypoint_path != null) assert.ok(typeof value.entrypoint_path === 'string' && value.entrypoint_path.length>0, 'remote entrypoint missing');
  if (staged) assert.equal(value.verify_jwt, VERIFY_JWT[value.slug], 'staged JWT configuration mismatch');
  const keys = ['id', 'name', 'slug', 'version', 'status', 'created_at', 'updated_at', 'verify_jwt', 'entrypoint_path', 'ezbr_sha256'];
  return Object.fromEntries(keys.filter(k => value[k] != null).map(k => [k, value[k]]));
}
export function inventory(values) {
  assert.ok(Array.isArray(values), 'remote inventory must be an array');
  assert.deepEqual(values.map(v => v.slug).sort(), INVENTORY, 'remote inventory differs from reviewed project');
  assert.equal(new Set(values.map(v => v.id)).size, values.length, 'duplicate remote ID');
  return values.map(v => remoteFunction(v)).sort((a, b) => a.slug.localeCompare(b.slug));
}
export function verifyRelease(baseline, staged, observed) {
  const before = inventory(baseline), after = inventory(observed);
  exactFunctions(staged.map(v => v.slug));
  for (const old of before) {
    const actual = after.find(v => v.slug === old.slug);
    const expected = staged.find(v => v.slug === old.slug);
    if (!expected) { assert.deepEqual(actual, old, 'unrelated remote function changed'); continue; }
    remoteFunction(expected, { staged: true });
    assert.equal(expected.id, old.id, 'remote function was replaced');
    assert.equal(actual.created_at,old.created_at,'remote function creation identity changed');
    assert.ok(expected.version > old.version, 'unchanged legacy/stale version');
    assert.notEqual(actual.ezbr_sha256, old.ezbr_sha256, 'unchanged legacy/stale bundle');
    for (const key of ['id', 'slug', 'name', 'version', 'ezbr_sha256', 'verify_jwt', 'entrypoint_path', 'created_at']) {
      if (expected[key] !== undefined) assert.equal(actual[key], expected[key], `deployment response mismatch: ${old.slug}.${key}`);
    }
    assert.ok(actual.updated_at > old.updated_at, 'stale remote update timestamp');
  }
  return after;
}

export function assertInert(snapshot) {
  assert.ok(snapshot && snapshot.schema_ok === true, 'schema mismatch');
  const expected = [...EMPTY_TABLES, 'settings', 'sellers', 'oauth_states', 'pg_net_pending', 'scheduler_active', 'dispatcher_active'];
  assert.deepEqual(Object.keys(snapshot.counts).sort(), expected.sort(), 'incomplete inertness snapshot');
  for (const [key, count] of Object.entries(snapshot.counts)) {
    assert.ok(Number.isSafeInteger(count) && count === 0, `financial inertness failed: ${key}`);
  }
  assert.equal(snapshot.paused, true, 'durable release quiescence missing');
  assert.equal(snapshot.drained, true, 'provider/pg_net quiet period incomplete');
  return snapshot;
}
