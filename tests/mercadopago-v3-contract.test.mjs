import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { canonicalJson, edgeReleaseSnapshot, sha256, validateManifest } from '../scripts/a1-a4-contract-v3.mjs';

const manifest = JSON.parse(fs.readFileSync('artifacts/codex/A1_A4_V3_RELEASE_MANIFEST.json', 'utf8'));
const expandA4 = fs.readFileSync('supabase/migrations/20260908164550_current_payment_authority_and_refund_identity.sql', 'utf8');
const expandAttempt = fs.readFileSync('supabase/migrations/20260908190758_a1_attempt_authority_expand_v2.sql', 'utf8');
const control = fs.readFileSync('supabase/migrations/20260909011239_a1_a4_durable_contract_control_v3.sql', 'utf8');
const contract = fs.readFileSync('supabase/contracts/20260909012000_a1_a4_legacy_contract_v3.sql', 'utf8');
const executor = fs.readFileSync('scripts/a1-a4-contract-v3.mjs', 'utf8');

test('V3 release manifest binds every EXPAND file and the exact CONTRACT', () => {
  assert.doesNotThrow(() => validateManifest(manifest));
  const files = manifest.expand_files.map(({ path, sha256: hash }) => ({ path, sha256: hash }));
  assert.equal(sha256(canonicalJson(files)), manifest.expand_sha256);
});

test('Edge release identity requires the exact three active functions in one switch window', () => {
  const now = Date.now();
  const functions = ['mercadopago-create-preference', 'mercadopago-payment-worker', 'mercadopago-refund']
    .map((name, index) => ({ name, slug: name, id: `id-${index}`, version: 10, status: 'ACTIVE', updated_at: now + index, ezbr_sha256: String(index + 1).repeat(64) }));
  const release = edgeReleaseSnapshot(functions);
  assert.match(release.identity, /^sha256:[a-f0-9]{64}$/);
  assert.throws(() => edgeReleaseSnapshot(functions.slice(1)), /not an exact active release/);
  assert.throws(() => edgeReleaseSnapshot(functions.map((item, index) => ({ ...item, updated_at: now + index * 20_000 }))), /one release window/);
});

test('EXPAND preserves the legacy result recorder and makes legacy retries reconcile before POST', () => {
  assert.doesNotMatch(expandA4, /create or replace function public\.record_payment_refund_response\s*\(/);
  assert.match(expandA4, /record_payment_refund_response_v2/);
  assert.match(expandAttempt, /create or replace function public\.prepare_payment_refund\s*\(/);
  assert.match(expandAttempt, /reconciliation_required'[\s\S]*requested'[\s\S]*processing'[\s\S]*ambiguous'/);
  assert.match(expandAttempt, /return public\.prepare_payment_refund_v2/);
});

test('durable attestation is private, expiring, release-bound and consumed with an append-only ledger', () => {
  for (const field of ['previous_edge_version', 'target_edge_version', 'contract_sha', 'expand_sha', 'expires_at', 'actor', 'evidence', 'status']) {
    assert.ok(control.includes(field), `missing attestation field ${field}`);
  }
  assert.match(control, /interval '430 seconds'/);
  assert.match(control, /payment worker scheduler is active/);
  assert.match(control, /payment worker pg_net dispatch is pending/);
  assert.match(control, /ALREADY_APPLIED/);
  assert.match(control, /deployment_contract_executions_append_only/);
  assert.match(control, /revoke all on function private\.execute_a1_a4_legacy_contract_v3[\s\S]*service_role/);
});

test('CONTRACT has no raw retirement DDL and the executor refuses unreviewed invocation', () => {
  assert.doesNotMatch(contract, /create or replace function public\./i);
  assert.doesNotMatch(contract, /a1_a4_drain_verified/);
  assert.match(contract, /private\.execute_a1_a4_legacy_contract_v3/);
  assert.match(executor, /V3 operational entrypoint retired/);
  assert.match(executor, /Local JSON cannot authorize CONTRACT/);
  assert.doesNotMatch(executor, /fetch\(|spawnSync\(/);
});
