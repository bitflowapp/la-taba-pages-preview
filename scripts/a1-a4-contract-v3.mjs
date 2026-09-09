// Reviewed operational control for the A1/A4 V3 CONTRACT.
// This file is inert unless an explicit mode and confirmation are supplied.
// It never deploys Edge code, changes secrets, enables payments or connects a seller.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_REF = 'wwcpogltfgzgkrlilbcd';
const CONFIRMATION = 'I_AUTHORIZE_A1_A4_V3_CONTRACT_CONTROL';
const MANIFEST_PATH = path.join(ROOT, 'artifacts', 'codex', 'A1_A4_V3_RELEASE_MANIFEST.json');
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

export function validateReleaseEvidence(evidence, expectedProjectRef = PROJECT_REF, expectedReleaseIdentity = null) {
  if (!evidence || typeof evidence !== 'object') {
    throw new Error('Release evidence is missing or invalid');
  }
  if (evidence.result !== 'SUCCESS') {
    throw new Error(`Release evidence result is not SUCCESS (got "${evidence.result}")`);
  }
  if (evidence.partial_release === true) {
    throw new Error('Release evidence indicates a PARTIAL Edge rollout; CONTRACT cannot proceed');
  }
  if (evidence.dry_run === true) {
    throw new Error('Release evidence is from a DRY-RUN and cannot authorize CONTRACT');
  }
  if (evidence.project_ref !== expectedProjectRef) {
    throw new Error(`Release evidence project ref "${evidence.project_ref}" does not match "${expectedProjectRef}"`);
  }
  if (!Array.isArray(evidence.edge_functions) || evidence.edge_functions.length !== EDGE_FUNCTIONS.length ||
      !EDGE_FUNCTIONS.every((fn) => evidence.edge_functions.includes(fn))) {
    throw new Error('Release evidence does not contain the exact expected Edge functions');
  }
  if (expectedReleaseIdentity && evidence.release_identity !== expectedReleaseIdentity) {
    throw new Error(`Release evidence identity "${evidence.release_identity}" does not match active platform identity "${expectedReleaseIdentity}"`);
  }
  return true;
}

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'null';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function postgresEnvironment() {
  const raw = process.env.TABA_A1_A4_DATABASE_URL;
  if (!raw) throw new Error('TABA_A1_A4_DATABASE_URL is required');
  const url = new URL(raw);
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') throw new Error('PostgreSQL URL required');
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGDATABASE: url.pathname.replace(/^\//, '') || 'postgres',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: local ? 'prefer' : 'require',
  };
}

function psql(args, input) {
  const result = spawnSync(process.env.PSQL_BIN || 'psql', ['-X', '-v', 'ON_ERROR_STOP=1', ...args], {
    cwd: ROOT, env: postgresEnvironment(), input, encoding: 'utf8', windowsHide: true,
  });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'psql failed').trim());
  return result.stdout.trim();
}

function query(sql) {
  return psql(['-qAt'], sql);
}

async function platformContext() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is required');
  const headers = { Authorization: `Bearer ${token}` };
  const [functionsResponse, actorResponse] = await Promise.all([
    fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/functions`, { headers }),
    fetch('https://api.supabase.com/v1/profile', { headers }),
  ]);
  if (!functionsResponse.ok || !actorResponse.ok) throw new Error('Supabase control-plane identity unavailable');
  const functions = await functionsResponse.json();
  const actorProfile = await actorResponse.json();
  const actor = String(actorProfile.id || '').trim();
  if (!actor || !Array.isArray(functions)) throw new Error('Supabase actor or function inventory invalid');
  return { actor, release: edgeReleaseSnapshot(functions) };
}

function requireMutationAuthorization() {
  if (process.env.TABA_A1_A4_CONTRACT_CONFIRMATION !== CONFIRMATION) {
    throw new Error(`TABA_A1_A4_CONTRACT_CONFIRMATION must equal ${CONFIRMATION}`);
  }
  if (arg('project-ref') !== PROJECT_REF) throw new Error(`--project-ref must equal ${PROJECT_REF}`);
}

function readManifest() {
  return validateManifest(JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')));
}

function verifyExpandLedger(manifest) {
  const versions = manifest.expand_files.map((entry) => path.basename(entry.path).slice(0, 14));
  const rows = JSON.parse(query(`select coalesce(json_agg(version order by version),'[]'::json) from supabase_migrations.schema_migrations where version in (${versions.map(sqlLiteral).join(',')});`));
  assert.deepEqual(rows, versions, 'remote migration ledger does not contain the exact EXPAND sequence');
  const artifacts = JSON.parse(query(`select coalesce(json_agg(json_build_object('version',version,'path',path,'sha256',sha256) order by version),'[]'::json)
    from private.a1_a4_expand_artifacts;`));
  assert.deepEqual(artifacts, manifest.expand_files.slice(0, 2).map((entry) => ({
    version: path.basename(entry.path).slice(0, 14), path: entry.path, sha256: entry.sha256,
  })), 'database EXPAND artifact fingerprints differ from the reviewed files');
  const schema = JSON.parse(query(`select json_build_object(
    'authority_rpc',to_regprocedure('public.get_mercadopago_payment_authority_v2(uuid,text,uuid,uuid,uuid)') is not null,
    'refund_v2',to_regprocedure('public.record_payment_refund_response_v2(uuid,text,text,numeric,text)') is not null,
    'executor',to_regprocedure('private.execute_a1_a4_legacy_contract_v3(uuid,text,text,text,text,text,text)') is not null,
    'attestations',to_regclass('private.deployment_drain_attestations') is not null
  )`));
  if (!schema.authority_rpc || !schema.refund_v2 || !schema.executor || !schema.attestations) {
    throw new Error('EXPAND schema fingerprint is incomplete');
  }
}

function currentAttestation(id) {
  const result = query(`select row_to_json(a) from private.deployment_drain_attestations a where id=${sqlLiteral(id)}::uuid;`);
  if (!result) throw new Error('durable drain attestation not found');
  return JSON.parse(result);
}

async function main() {
  const mode = arg('mode');
  if (!['pause', 'attest', 'execute', 'resume', 'status'].includes(mode || '')) {
    throw new Error('--mode must be pause, attest, execute, resume, or status');
  }
  const manifest = readManifest();
  const platform = await platformContext();
  if (mode === 'status') {
    console.log(JSON.stringify({ project_ref: PROJECT_REF, release: platform.release, expand: manifest.expand_version }, null, 2));
    return;
  }
  requireMutationAuthorization();
  verifyExpandLedger(manifest);

  if (mode === 'pause') {
    const output = query(`select private.set_a1_a4_payment_dispatch_paused_v3('production',${sqlLiteral(platform.release.identity)},${sqlLiteral(platform.actor)},true);`);
    console.log(output);
    return;
  }
  if (mode === 'attest') {
    const previousEdge = arg('previous-edge-version');
    const previousDeployedAt = arg('previous-deployed-at');
    if (!previousEdge || !previousDeployedAt) throw new Error('previous Edge identity and timestamp are required');
    const evidencePath = arg('release-evidence');
    if (evidencePath) {
      if (!fs.existsSync(evidencePath)) throw new Error(`release evidence file not found: ${evidencePath}`);
      const releaseEvidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
      validateReleaseEvidence(releaseEvidence, PROJECT_REF, platform.release.identity);
    }
    const evidence = {
      platform_project_ref: PROJECT_REF,
      platform_snapshot_sha: sha256(canonicalJson(platform.release.payload)),
      edge_functions: platform.release.payload.functions,
      previous_edge_version: previousEdge,
      target_edge_version: platform.release.identity,
      collected_at: new Date().toISOString(),
      drain_model: { maximum_worker_seconds: 400, safety_margin_seconds: 30 },
    };
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const id = query(`select private.create_a1_a4_drain_attestation_v3(
      'production',${sqlLiteral(platform.release.identity)},${sqlLiteral(previousEdge)},${sqlLiteral(platform.release.identity)},
      ${sqlLiteral(manifest.contract.sha256)},${sqlLiteral(manifest.expand_version)},${sqlLiteral(manifest.expand_sha256)},
      ${sqlLiteral(previousDeployedAt)}::timestamptz,${sqlLiteral(platform.release.deployedAt)}::timestamptz,
      ${sqlLiteral(platform.release.deployedAt)}::timestamptz,${sqlLiteral(expiresAt)}::timestamptz,
      ${sqlLiteral(platform.actor)},${sqlLiteral(JSON.stringify(evidence))}::jsonb
    );`);
    console.log(JSON.stringify({ attestation_id: id, expires_at: expiresAt, edge_version: platform.release.identity }));
    return;
  }
  if (mode === 'execute') {
    const id = arg('attestation-id');
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('--attestation-id UUID is required');
    if (query("select exists(select 1 from private.deployment_contract_executions where contract_name='a1_a4_legacy_contract_v3' and environment='production')") === 't') {
      throw new Error('ALREADY_APPLIED');
    }
    const attestation = currentAttestation(id);
    if (attestation.status !== 'pending' || Date.parse(attestation.expires_at) <= Date.now()) throw new Error('attestation is consumed or expired');
    if (attestation.target_edge_version !== platform.release.identity || attestation.actor !== platform.actor ||
      attestation.contract_sha !== manifest.contract.sha256 || attestation.expand_sha !== manifest.expand_sha256) {
      throw new Error('attestation does not match current reviewed release');
    }
    const result = psql([
      '-v', `attestation_id=${id}`,
      '-v', 'environment=production',
      '-v', `edge_version=${platform.release.identity}`,
      '-v', `contract_sha=${manifest.contract.sha256}`,
      '-v', `expand_version=${manifest.expand_version}`,
      '-v', `expand_sha=${manifest.expand_sha256}`,
      '-v', `actor=${platform.actor}`,
      '-f', manifest.contract.path,
    ]);
    console.log(result);
    return;
  }
  const output = query(`select private.set_a1_a4_payment_dispatch_paused_v3('production',${sqlLiteral(platform.release.identity)},${sqlLiteral(platform.actor)},false);`);
  console.log(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
