// Canonical executable entrypoint for the coordinated production Edge V2 release protocol.
//
// This protocol is strictly fail-closed:
// 1. Rejects any Supabase project ref other than 'wwcpogltfgzgkrlilbcd'.
// 2. Verifies repository root and worktree context.
// 3. Verifies local source file existence and SHA-256 fingerprints.
// 4. Verifies remote EXPAND state (migrations ledger, artifact fingerprints, V2 RPCs).
// 5. Verifies remote production financial inertness (settings disabled, 0 sellers, 0 intents,
//    0 attempts, 0 outbox jobs, 0 active leases, 0 in-flight refunds, 0 queued dispatches,
//    paused scheduler, disabled trigger, paused control row).
// 6. Enforces concurrency control using PostgreSQL advisory locking.
// 7. Deploys the exact three Edge functions in parallel:
//    - mercadopago-create-preference
//    - mercadopago-payment-worker
//    - mercadopago-refund
// 8. In --dry-run mode, performs zero mutations and executes zero CLI deploy commands.
// 9. Remotely verifies all three deployed Edge functions:
//    - Active status
//    - Integer version
//    - Valid bundle SHA-256
//    - Single coordinated switch window (<= 10,000 ms)
//    - Computes exact release identity sha256
// 10. Emits machine-readable release evidence JSON (without secrets).
// 11. Any failure or partial deployment fails closed with deterministic non-zero exit codes.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  canonicalJson,
  edgeReleaseSnapshot,
  sha256,
  validateManifest,
} from './a1-a4-contract-v3.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EXPECTED_PROJECT_REF = 'wwcpogltfgzgkrlilbcd';
export const PROTOCOL_VERSION = '1.0.0';

export const FORBIDDEN_PROJECT_REFS = new Map([
  ['ukxqbgswjlibmnjemrzd', 'la-taba-staging'],
  ['yakhtrkukqlgzvxuvhzs', 'la-taba-demo'],
]);

export const EXPECTED_EDGE_FUNCTIONS = [
  'mercadopago-create-preference',
  'mercadopago-payment-worker',
  'mercadopago-refund',
];

export const EXPECTED_SOURCE_HASHES = {
  'supabase/functions/mercadopago-create-preference/index.ts': '9e3ef99963f1b5fa4ae300fe1774e4916d0330fb1d93803b93f1255b7ecd1ab4',
  'supabase/functions/mercadopago-payment-worker/index.ts': 'ebc9c616f5037fafc8edf091e84ed4d2fdd560545ddd6a9c96816fde5f58c903',
  'supabase/functions/mercadopago-refund/index.ts': '8aa4d897ba086b09042c4feb642a814f5219c4ad00470635965ab706a7ab03ff',
};

export const EXPECTED_SHARED_HASHES = {
  'supabase/functions/_shared/current-payment-authority.deno.ts': '374451ff282500c15477149d6fa119e775ce4b0db1479eec1b2cca9d488f9565',
  'supabase/functions/_shared/mercadopago.ts': 'bb423b0d05cf5d9002935402b22a9d007e595cb7dc59c86a14b3f08f94d54fc4',
  'supabase/functions/_shared/refund-runtime.deno.ts': '794083107844f86a1785ac2fbfe3de3c8aadd8c0dd44856e92e2b36b1c6e7414',
  'supabase/functions/_shared/seller-oauth.ts': 'a643cbe8ea815938a612e8db13d1675ec09c493a4e30e6b07c460e8542df6a1e',
  'supabase/functions/_shared/payment-runtime.ts': 'c8a2631d9044d5c8d51cf52173b9545d87bf78b5b42f9a14ddf1e8341bcb9fa4',
  'supabase/functions/_shared/refund-correlation.ts': '04357f4d502e1b61a9c3c097332f0244e228d01f1c11eddd2ab48f4598a470a9',
};

// Deterministic exit codes
export const EXIT_SUCCESS = 0;
export const EXIT_VALIDATION_ERROR = 1;
export const EXIT_TARGET_GUARD_REJECTED = 2;
export const EXIT_FINANCIAL_INERT_FAILED = 3;
export const EXIT_EXPAND_COMPAT_FAILED = 4;
export const EXIT_SOURCE_MISMATCH = 5;
export const EXIT_DEPLOY_FAILED = 6;
export const EXIT_REMOTE_VERIFY_FAILED = 7;
export const EXIT_CONCURRENCY_LOCKED = 8;

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (item.startsWith('--')) {
      const eqIdx = item.indexOf('=');
      if (eqIdx !== -1) {
        const key = item.slice(2, eqIdx);
        const val = item.slice(eqIdx + 1);
        args[key] = val;
      } else {
        const key = item.slice(2);
        if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
          args[key] = argv[++i];
        } else {
          args[key] = true;
        }
      }
    }
  }
  return args;
}

export function verifyTargetProject(projectRef, root = ROOT) {
  const requested = String(projectRef || '').trim();
  if (!requested) {
    const err = new Error('Target project ref is required; missing --project-ref');
    err.exitCode = EXIT_TARGET_GUARD_REJECTED;
    throw err;
  }
  if (!/^[a-z]{20}$/.test(requested)) {
    const err = new Error(`Target project ref "${requested}" has invalid format`);
    err.exitCode = EXIT_TARGET_GUARD_REJECTED;
    throw err;
  }
  if (requested !== EXPECTED_PROJECT_REF) {
    const err = new Error(`Target project ref "${requested}" is not production (${EXPECTED_PROJECT_REF})`);
    err.exitCode = EXIT_TARGET_GUARD_REJECTED;
    throw err;
  }
  if (FORBIDDEN_PROJECT_REFS.has(requested)) {
    const err = new Error(`Target project ref "${requested}" is forbidden (${FORBIDDEN_PROJECT_REFS.get(requested)})`);
    err.exitCode = EXIT_TARGET_GUARD_REJECTED;
    throw err;
  }
  const linkedFile = path.join(root, 'supabase', '.temp', 'project-ref');
  if (fs.existsSync(linkedFile)) {
    const linked = fs.readFileSync(linkedFile, 'utf8').trim();
    if (linked && linked !== requested) {
      const err = new Error(`Worktree is linked to "${linked}", not target "${requested}"`);
      err.exitCode = EXIT_TARGET_GUARD_REJECTED;
      throw err;
    }
  }
  return { ok: true, projectRef: requested };
}

export function verifyLocalSource(root = ROOT) {
  const hashes = {};
  for (const [relPath, expectedHash] of Object.entries(EXPECTED_SOURCE_HASHES)) {
    const fullPath = path.join(root, relPath);
    if (!fs.existsSync(fullPath)) {
      const err = new Error(`Required Edge function entrypoint missing: ${relPath}`);
      err.exitCode = EXIT_SOURCE_MISMATCH;
      throw err;
    }
    const content = fs.readFileSync(fullPath);
    const calculated = crypto.createHash('sha256').update(content).digest('hex');
    if (calculated !== expectedHash) {
      const err = new Error(`Local source hash mismatch for ${relPath}: expected ${expectedHash}, got ${calculated}`);
      err.exitCode = EXIT_SOURCE_MISMATCH;
      throw err;
    }
    hashes[relPath] = calculated;
  }

  for (const [relPath, expectedHash] of Object.entries(EXPECTED_SHARED_HASHES)) {
    const fullPath = path.join(root, relPath);
    if (!fs.existsSync(fullPath)) {
      const err = new Error(`Required shared Edge dependency missing: ${relPath}`);
      err.exitCode = EXIT_SOURCE_MISMATCH;
      throw err;
    }
    const content = fs.readFileSync(fullPath);
    const calculated = crypto.createHash('sha256').update(content).digest('hex');
    if (calculated !== expectedHash) {
      const err = new Error(`Shared module hash mismatch for ${relPath}: expected ${expectedHash}, got ${calculated}`);
      err.exitCode = EXIT_SOURCE_MISMATCH;
      throw err;
    }
    hashes[relPath] = calculated;
  }

  const combinedHash = crypto.createHash('sha256').update(canonicalJson(hashes)).digest('hex');
  return { ok: true, hashes, combinedHash };
}

export function verifyExpandState(queryFn, manifest) {
  const versions = manifest.expand_files.map((entry) => path.basename(entry.path).slice(0, 14));
  let ledgerRows;
  try {
    const raw = queryFn(`select coalesce(json_agg(version order by version),'[]'::json) from supabase_migrations.schema_migrations where version in (${versions.map((v) => `'${v}'`).join(',')});`);
    ledgerRows = JSON.parse(raw);
  } catch (err) {
    const error = new Error(`EXPAND ledger check failed: ${err.message || String(err)}`);
    error.exitCode = EXIT_EXPAND_COMPAT_FAILED;
    throw error;
  }
  if (!Array.isArray(ledgerRows) || ledgerRows.length !== versions.length || !versions.every((v, i) => ledgerRows[i] === v)) {
    const error = new Error(`Remote migration ledger does not contain the exact EXPAND sequence. Expected ${JSON.stringify(versions)}, got ${JSON.stringify(ledgerRows)}`);
    error.exitCode = EXIT_EXPAND_COMPAT_FAILED;
    throw error;
  }

  let artifactRows;
  try {
    const raw = queryFn(`select coalesce(json_agg(json_build_object('version',version,'path',path,'sha256',sha256) order by version),'[]'::json) from private.a1_a4_expand_artifacts;`);
    artifactRows = JSON.parse(raw);
  } catch (err) {
    const error = new Error(`EXPAND artifact fingerprints check failed: ${err.message || String(err)}`);
    error.exitCode = EXIT_EXPAND_COMPAT_FAILED;
    throw error;
  }
  const expectedArtifacts = manifest.expand_files.slice(0, 2).map((entry) => ({
    version: path.basename(entry.path).slice(0, 14),
    path: entry.path,
    sha256: entry.sha256,
  }));
  if (JSON.stringify(artifactRows) !== JSON.stringify(expectedArtifacts)) {
    const error = new Error(`Database EXPAND artifact fingerprints differ from reviewed manifest`);
    error.exitCode = EXIT_EXPAND_COMPAT_FAILED;
    throw error;
  }

  let schema;
  try {
    const raw = queryFn(`select json_build_object(
      'authority_rpc',to_regprocedure('public.get_mercadopago_payment_authority_v2(uuid,text,uuid,uuid,uuid)') is not null,
      'refund_v2',to_regprocedure('public.record_payment_refund_response_v2(uuid,text,text,numeric,text)') is not null,
      'prepare_refund_v2',to_regprocedure('public.prepare_payment_refund_v2(uuid,numeric,uuid,text)') is not null,
      'claim_outbox_v2',to_regprocedure('public.claim_payment_outbox_v2(text,integer,integer)') is not null,
      'executor',to_regprocedure('private.execute_a1_a4_legacy_contract_v3(uuid,text,text,text,text,text,text)') is not null,
      'attestations',to_regclass('private.deployment_drain_attestations') is not null,
      'dispatch_control',to_regclass('private.a1_a4_payment_dispatch_control') is not null
    );`);
    schema = JSON.parse(raw);
  } catch (err) {
    const error = new Error(`EXPAND schema fingerprint check failed: ${err.message || String(err)}`);
    error.exitCode = EXIT_EXPAND_COMPAT_FAILED;
    throw error;
  }

  const missing = Object.entries(schema).filter(([, exists]) => !exists).map(([key]) => key);
  if (missing.length > 0) {
    const error = new Error(`EXPAND schema is incomplete. Missing components: ${missing.join(', ')}`);
    error.exitCode = EXIT_EXPAND_COMPAT_FAILED;
    throw error;
  }

  return { ok: true, versions, artifacts: artifactRows, schema };
}

export function verifyFinancialInertness(queryFn) {
  const checks = [
    {
      id: 'business_payment_settings_enabled',
      description: 'Zero enabled business payment settings in production',
      sql: "select count(*)::int from public.business_payment_settings where environment='production' and enabled=true;",
      expected: 0,
    },
    {
      id: 'seller_connections_connected',
      description: 'Zero connected sellers in production',
      sql: "select count(*)::int from public.mp_seller_connections where environment='production' and status='connected';",
      expected: 0,
    },
    {
      id: 'seller_connections_tokens',
      description: 'Zero usable seller token material in production',
      sql: "select count(*)::int from public.mp_seller_connections where environment='production' and protected_tokens is not null;",
      expected: 0,
    },
    {
      id: 'payment_intents_active',
      description: 'Zero in-flight payment intents in production',
      sql: "select count(*)::int from public.payment_intents where environment='production' and internal_status in ('pending','processing','payment_method_selected');",
      expected: 0,
    },
    {
      id: 'payment_attempts_active',
      description: 'Zero in-flight payment attempts in production',
      sql: "select count(*)::int from public.payment_attempts where status in ('created','pending','processing');",
      expected: 0,
    },
    {
      id: 'payment_outbox_active_or_leased',
      description: 'Zero active or leased payment outbox jobs',
      sql: "select count(*)::int from public.payment_outbox where status in ('claimed','processing') or (owner is not null and lease_expires_at > clock_timestamp());",
      expected: 0,
    },
    {
      id: 'payment_refunds_in_flight',
      description: 'Zero in-flight refund operations in production',
      sql: "select count(*)::int from public.payment_refunds where status in ('requested','processing','ambiguous');",
      expected: 0,
    },
    {
      id: 'pg_net_worker_dispatches_pending',
      description: 'Zero pending payment worker HTTP dispatches in pg_net',
      sql: "select count(*)::int from net.http_request_queue where url like '%/functions/v1/mercadopago-payment-worker%';",
      expected: 0,
    },
    {
      id: 'cron_worker_scheduler_inactive',
      description: 'Payment outbox worker scheduler cron is paused',
      sql: "select count(*)::int from cron.job where jobname='taba-payment-outbox-worker' and active=true;",
      expected: 0,
    },
    {
      id: 'trigger_worker_kick_disabled',
      description: 'Immediate payment outbox worker trigger is disabled',
      sql: "select count(*)::int from pg_trigger where tgrelid='public.payment_outbox'::regclass and tgname='payment_outbox_worker_kick' and tgenabled<>'D';",
      expected: 0,
    },
    {
      id: 'dispatch_control_paused',
      description: 'Private dispatch control row is paused for production',
      sql: "select coalesce((select paused from private.a1_a4_payment_dispatch_control where environment='production'), false);",
      expected: 't',
    },
  ];

  const results = {};
  const violations = [];

  for (const check of checks) {
    let rawOutput;
    try {
      rawOutput = queryFn(check.sql);
    } catch (err) {
      const error = new Error(`Financial inertness check [${check.id}] failed query execution: ${err.message || String(err)}`);
      error.exitCode = EXIT_FINANCIAL_INERT_FAILED;
      throw error;
    }

    if (rawOutput === null || rawOutput === undefined || typeof rawOutput !== 'string') {
      const error = new Error(`Financial inertness check [${check.id}] returned empty or non-string result: ${rawOutput}`);
      error.exitCode = EXIT_FINANCIAL_INERT_FAILED;
      throw error;
    }

    const trimmed = rawOutput.trim();
    if (check.expected === 't') {
      if (trimmed !== 't' && trimmed !== 'true') {
        violations.push(`${check.id}: expected true, got "${trimmed}" (${check.description})`);
      }
      results[check.id] = trimmed === 't' || trimmed === 'true';
    } else {
      const count = parseInt(trimmed, 10);
      if (Number.isNaN(count)) {
        const error = new Error(`Financial inertness check [${check.id}] returned unparseable integer count: "${trimmed}"`);
        error.exitCode = EXIT_FINANCIAL_INERT_FAILED;
        throw error;
      }
      if (count !== check.expected) {
        violations.push(`${check.id}: count was ${count}, expected ${check.expected} (${check.description})`);
      }
      results[check.id] = count;
    }
  }

  if (violations.length > 0) {
    const error = new Error(`Production is NOT financially inert:\n  - ${violations.join('\n  - ')}`);
    error.exitCode = EXIT_FINANCIAL_INERT_FAILED;
    error.violations = violations;
    error.results = results;
    throw error;
  }

  return { ok: true, results };
}

export function acquireReleaseLock(queryFn) {
  try {
    const raw = queryFn("select pg_try_advisory_lock(hashtext('taba_edge_v2_release_production'));");
    return raw.trim() === 't' || raw.trim() === 'true';
  } catch (err) {
    const error = new Error(`Failed to acquire deployment concurrency lock: ${err.message || String(err)}`);
    error.exitCode = EXIT_CONCURRENCY_LOCKED;
    throw error;
  }
}

export function releaseReleaseLock(queryFn) {
  try {
    queryFn("select pg_advisory_unlock(hashtext('taba_edge_v2_release_production'));");
  } catch (_) {
    // best-effort unlock
  }
}

export async function executeDeployment({
  projectRef,
  functions = EXPECTED_EDGE_FUNCTIONS,
  dryRun = false,
  deployerFn = null,
}) {
  if (dryRun) {
    return {
      dryRun: true,
      partial: false,
      deployed: functions.map((name) => ({ name, status: 'DRY_RUN' })),
    };
  }

  if (deployerFn) {
    return deployerFn({ projectRef, functions, dryRun });
  }

  // Live Supabase CLI deployment:
  // Parallel deployment across all 3 functions:
  const result = spawnSync('npx', [
    '--yes', 'supabase@2.101.0', 'functions', 'deploy',
    ...functions,
    '--project-ref', projectRef,
    '--jobs', String(functions.length),
  ], {
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.status !== 0) {
    const errorOutput = (result.stderr || result.stdout || '').trim();
    const error = new Error(`Deployment command failed (exit code ${result.status}): ${errorOutput}`);
    error.status = result.status;
    error.partial = true;
    error.exitCode = EXIT_DEPLOY_FAILED;
    throw error;
  }

  return {
    dryRun: false,
    partial: false,
    deployed: functions.map((name) => ({ name, status: 'DEPLOYED' })),
  };
}

export async function verifyRemoteRelease({
  projectRef,
  token,
  fetcherFn = fetch,
  expectedFunctions = EXPECTED_EDGE_FUNCTIONS,
}) {
  if (!token) {
    const error = new Error('SUPABASE_ACCESS_TOKEN is required for remote function verification');
    error.exitCode = EXIT_REMOTE_VERIFY_FAILED;
    throw error;
  }
  const headers = { Authorization: `Bearer ${token}` };
  let response;
  try {
    response = await fetcherFn(`https://api.supabase.com/v1/projects/${projectRef}/functions`, { headers });
  } catch (err) {
    const error = new Error(`Failed to query Supabase Management API: ${err.message || String(err)}`);
    error.exitCode = EXIT_REMOTE_VERIFY_FAILED;
    throw error;
  }

  if (!response || !response.ok) {
    const error = new Error(`Supabase Management API returned HTTP ${response?.status || 'unknown'}`);
    error.exitCode = EXIT_REMOTE_VERIFY_FAILED;
    throw error;
  }

  let functions;
  try {
    functions = await response.json();
  } catch (err) {
    const error = new Error(`Failed to parse functions JSON from Management API: ${err.message || String(err)}`);
    error.exitCode = EXIT_REMOTE_VERIFY_FAILED;
    throw error;
  }

  if (!Array.isArray(functions)) {
    const error = new Error('Supabase Management API returned invalid function inventory (not an array)');
    error.exitCode = EXIT_REMOTE_VERIFY_FAILED;
    throw error;
  }

  // Uses edgeReleaseSnapshot from scripts/a1-a4-contract-v3.mjs to ensure 100% contract alignment
  let snapshot;
  try {
    snapshot = edgeReleaseSnapshot(functions);
  } catch (err) {
    const error = new Error(`Remote Edge release snapshot verification failed: ${err.message || String(err)}`);
    error.exitCode = EXIT_REMOTE_VERIFY_FAILED;
    throw error;
  }

  return {
    ok: true,
    snapshot,
  };
}

export function buildReleaseEvidence({
  projectRef,
  edgeFunctions,
  sourceHashes,
  releaseIdentity,
  deployedAt,
  financialInertness,
  expandCompatibility,
  partialRelease,
  dryRun,
  startedAt,
  completedAt,
  result,
  error,
}) {
  return {
    protocol_version: PROTOCOL_VERSION,
    target_environment: 'production',
    project_ref: projectRef,
    edge_functions: edgeFunctions,
    source_hashes: sourceHashes,
    release_identity: releaseIdentity || null,
    deployed_at: deployedAt || null,
    financial_inertness_precheck: financialInertness || null,
    expand_compatibility_precheck: expandCompatibility || null,
    partial_release: Boolean(partialRelease),
    contract_eligible: false, // CONTRACT is NEVER eligible immediately; requires subsequent drain and attestation
    dry_run: Boolean(dryRun),
    started_at: startedAt,
    completed_at: completedAt,
    result: result, // 'SUCCESS' or 'FAIL'
    error: error ? String(error.message || error) : null,
  };
}

function defaultPostgresEnv(dbUrl) {
  if (!dbUrl) throw new Error('TABA_A1_A4_DATABASE_URL is required');
  const url = new URL(dbUrl);
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

export function defaultQueryFn(dbUrl, root = ROOT) {
  if (!dbUrl) return null;
  return (sql) => {
    const psqlBin = process.env.PSQL_BIN || 'psql';
    const result = spawnSync(psqlBin, ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
      cwd: root,
      env: defaultPostgresEnv(dbUrl),
      input: sql,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'psql failed').trim());
    return result.stdout.trim();
  };
}

export function readManifest(root = ROOT) {
  const manifestPath = path.join(root, 'artifacts', 'codex', 'A1_A4_V3_RELEASE_MANIFEST.json');
  return validateManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), (rel) => fs.readFileSync(path.join(root, rel)));
}

export async function executeReleaseProtocol(options = {}) {
  const startedAt = new Date().toISOString();
  const root = options.root || ROOT;
  const projectRef = (options.projectRef || '').trim();
  const dryRun = Boolean(options.dryRun);
  const evidenceFile = options.evidenceFile || path.join(root, 'artifacts', 'codex', 'A1_A4_EDGE_RELEASE_EVIDENCE.json');
  const token = options.token || process.env.SUPABASE_ACCESS_TOKEN;
  const dbUrl = options.dbUrl || process.env.TABA_A1_A4_DATABASE_URL;
  const queryFn = options.queryFn || defaultQueryFn(dbUrl, root);
  const deployerFn = options.deployerFn || null;
  const fetcherFn = options.fetcherFn || fetch;

  let sourceResult = null;
  let lockAcquired = false;
  let expandResult = null;
  let financialResult = null;
  let deployResult = null;
  let remoteResult = null;
  let partialRelease = false;

  try {
    // Step 1: Project ref guard
    verifyTargetProject(projectRef, root);

    // Step 2: Local source files & hashes verification
    sourceResult = verifyLocalSource(root);

    // Step 3: Concurrency lock acquisition
    if (queryFn && !options.skipDb) {
      lockAcquired = acquireReleaseLock(queryFn);
      if (!lockAcquired) {
        const error = new Error('Concurrent release detected: could not acquire taba_edge_v2_release_production advisory lock');
        error.exitCode = EXIT_CONCURRENCY_LOCKED;
        throw error;
      }
    }

    // Step 4: EXPAND compatibility verification
    if (queryFn && !options.skipDb) {
      const manifest = readManifest(root);
      expandResult = verifyExpandState(queryFn, manifest);
    } else if (options.mockExpand) {
      expandResult = options.mockExpand;
    } else if (dryRun && options.skipDb) {
      expandResult = { ok: true, skipped: true, reason: 'dry-run without database' };
    } else {
      const error = new Error('Database connection or queryFn required for EXPAND precheck');
      error.exitCode = EXIT_EXPAND_COMPAT_FAILED;
      throw error;
    }

    // Step 5: Financial inertness verification
    if (queryFn && !options.skipDb) {
      financialResult = verifyFinancialInertness(queryFn);
    } else if (options.mockFinancial) {
      financialResult = options.mockFinancial;
    } else if (dryRun && options.skipDb) {
      financialResult = { ok: true, skipped: true, reason: 'dry-run without database' };
    } else {
      const error = new Error('Database connection or queryFn required for financial inertness precheck');
      error.exitCode = EXIT_FINANCIAL_INERT_FAILED;
      throw error;
    }

    // Step 6: Deploy Edge functions (zero mutations if dry-run)
    try {
      deployResult = await executeDeployment({
        projectRef,
        functions: EXPECTED_EDGE_FUNCTIONS,
        dryRun,
        deployerFn,
      });
    } catch (deployErr) {
      partialRelease = Boolean(deployErr.partial);
      deployErr.exitCode = EXIT_DEPLOY_FAILED;
      throw deployErr;
    }

    // Step 7: Remote verification (if live) or mock/dry-run snapshot
    if (!dryRun) {
      try {
        remoteResult = await verifyRemoteRelease({
          projectRef,
          token,
          fetcherFn,
          expectedFunctions: EXPECTED_EDGE_FUNCTIONS,
        });
      } catch (remoteErr) {
        partialRelease = true; // Remote verification failed after deploy
        remoteErr.exitCode = EXIT_REMOTE_VERIFY_FAILED;
        throw remoteErr;
      }
    } else {
      remoteResult = {
        ok: true,
        snapshot: {
          identity: `dry-run:sha256:${sourceResult.combinedHash}`,
          deployedAt: startedAt,
        },
      };
    }

    const completedAt = new Date().toISOString();
    const evidence = buildReleaseEvidence({
      projectRef,
      edgeFunctions: EXPECTED_EDGE_FUNCTIONS,
      sourceHashes: sourceResult.hashes,
      releaseIdentity: remoteResult?.snapshot?.identity,
      deployedAt: remoteResult?.snapshot?.deployedAt,
      financialInertness: financialResult,
      expandCompatibility: expandResult,
      partialRelease: false,
      dryRun,
      startedAt,
      completedAt,
      result: 'SUCCESS',
      error: null,
    });

    if (evidenceFile) {
      fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
      fs.writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2), 'utf8');
    }

    return {
      ok: true,
      exitCode: EXIT_SUCCESS,
      evidence,
    };
  } catch (err) {
    const completedAt = new Date().toISOString();
    const evidence = buildReleaseEvidence({
      projectRef: projectRef || null,
      edgeFunctions: EXPECTED_EDGE_FUNCTIONS,
      sourceHashes: sourceResult?.hashes || {},
      releaseIdentity: null,
      deployedAt: null,
      financialInertness: financialResult,
      expandCompatibility: expandResult,
      partialRelease,
      dryRun,
      startedAt,
      completedAt,
      result: 'FAIL',
      error: err,
    });

    if (evidenceFile && !options.skipEvidenceOnFailure) {
      try {
        fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
        fs.writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2), 'utf8');
      } catch (_) { /* ignore write errors */ }
    }

    const exitCode = err.exitCode || EXIT_VALIDATION_ERROR;
    return {
      ok: false,
      exitCode,
      error: err,
      evidence,
    };
  } finally {
    if (lockAcquired && queryFn) {
      try { releaseReleaseLock(queryFn); } catch (_) {}
    }
  }
}

async function main() {
  const args = parseArgs();
  const projectRef = args['project-ref'];
  const dryRun = Boolean(args['dry-run']);
  const skipDb = Boolean(args['skip-db']);
  const evidenceFile = args['evidence-file'] || path.join(ROOT, 'artifacts', 'codex', 'A1_A4_EDGE_RELEASE_EVIDENCE.json');

  console.log('=== TABA EDGE V2 PRODUCTION RELEASE PROTOCOL ===');
  console.log(`  TARGET REF   : ${projectRef || '(none)'}`);
  console.log(`  MODE         : ${dryRun ? 'DRY-RUN (zero mutations)' : 'LIVE DEPLOYMENT'}`);
  console.log(`  EVIDENCE FILE: ${evidenceFile}`);

  const outcome = await executeReleaseProtocol({
    projectRef,
    dryRun,
    skipDb,
    evidenceFile,
  });

  if (!outcome.ok) {
    console.error(`\n❌ RELEASE PROTOCOL FAILED (exit code ${outcome.exitCode}):`);
    console.error(`  ${outcome.error?.message || String(outcome.error)}`);
    if (outcome.evidence?.partial_release) {
      console.error('  ⚠️  WARNING: PARTIAL RELEASE DETECTED. Edge deployment is incomplete and fails closed.');
    }
    process.exit(outcome.exitCode);
  }

  console.log('\n✅ RELEASE PROTOCOL COMPLETED SUCCESSFULLY:');
  console.log(`  RELEASE IDENTITY: ${outcome.evidence.release_identity}`);
  console.log(`  DEPLOYED AT     : ${outcome.evidence.deployed_at}`);
  console.log(`  DRY RUN         : ${outcome.evidence.dry_run}`);
  console.log(`  PARTIAL RELEASE : ${outcome.evidence.partial_release}`);
  console.log(`  CONTRACT ELIGIBLE: ${outcome.evidence.contract_eligible} (requires subsequent drain and attestation)`);
  process.exit(EXIT_SUCCESS);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error('Unhandled protocol error:', err);
    process.exit(EXIT_VALIDATION_ERROR);
  });
}
