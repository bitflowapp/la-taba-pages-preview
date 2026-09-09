// Historical V3 manifest/fingerprint helpers. Not a release authorization API.
// All production operations and trusted proof validation live in release-v5.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_REF = 'wwcpogltfgzgkrlilbcd';
const EXPAND_FILES = [
  'supabase/migrations/20260908164550_current_payment_authority_and_refund_identity.sql',
  'supabase/migrations/20260908190758_a1_attempt_authority_expand_v2.sql',
  'supabase/migrations/20260909011239_a1_a4_durable_contract_control_v3.sql',
];
const CONTRACT_FILE = 'supabase/contracts/20260909012000_a1_a4_legacy_contract_v3.sql';
const EDGE_FUNCTIONS = [
  'mercadopago-create-preference',
  'mercadopago-payment-worker',
  'mercadopago-refund',
];

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function edgeReleaseSnapshot(functions) {
  const selected = EDGE_FUNCTIONS.map((name) => {
    const item = functions.find((candidate) => candidate.name === name || candidate.slug === name);
    if (!item || item.status !== 'ACTIVE' || !item.id || !Number.isInteger(Number(item.version))) {
      throw new Error(`Edge function ${name} is not an exact active release`);
    }
    const updatedAt = Number(item.updated_at);
    if (!Number.isFinite(updatedAt) || updatedAt <= 0 || !/^[a-f0-9]{64}$/.test(String(item.ezbr_sha256 || ''))) {
      throw new Error(`Edge function ${name} has incomplete release identity`);
    }
    return { name, id: String(item.id), version: Number(item.version), bundle_sha: String(item.ezbr_sha256), updated_at: updatedAt };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const deployed = selected.map((item) => item.updated_at);
  if (Math.max(...deployed) - Math.min(...deployed) > 10_000) {
    throw new Error('A1/A4 Edge functions were not switched as one release window');
  }
  const payload = { project_ref: PROJECT_REF, functions: selected };
  return {
    identity: `sha256:${sha256(canonicalJson(payload))}`,
    deployedAt: new Date(Math.max(...deployed)).toISOString(),
    payload,
  };
}

export function validateManifest(manifest, readFile = (relative) => fs.readFileSync(path.join(ROOT, relative))) {
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.expand_version, '20260909011239');
  assert.ok(Array.isArray(manifest.expand_files) && manifest.expand_files.length === 3);
  assert.deepEqual(manifest.expand_files.map((entry) => entry.path), EXPAND_FILES);
  assert.equal(manifest.contract.path, CONTRACT_FILE);
  for (const entry of [...manifest.expand_files, manifest.contract]) {
    assert.match(entry.path, /^(supabase\/migrations\/|supabase\/contracts\/)[a-zA-Z0-9_./-]+\.sql$/);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    assert.equal(sha256(readFile(entry.path)), entry.sha256, `${entry.path} differs from the reviewed manifest`);
  }
  const combined = sha256(canonicalJson(manifest.expand_files.map(({ path: file, sha256: hash }) => ({ path: file, sha256: hash }))));
  assert.equal(combined, manifest.expand_sha256, 'combined EXPAND SHA differs');
  return manifest;
}

export function validateReleaseEvidence() {
  throw new Error('Local JSON cannot authorize CONTRACT; use the durable V5 lifecycle');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.error('V3 operational entrypoint retired; use scripts/release-edge-production.mjs');
  process.exitCode = 1;
}
