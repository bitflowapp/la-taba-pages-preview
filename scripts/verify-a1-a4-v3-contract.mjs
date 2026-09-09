// Disposable PostgreSQL proof for durable drain attestation and one-shot CONTRACT.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const container = process.argv[2];
if (process.env.TABA_LOCAL_PAYMENT_DB !== '1' || !/^taba-a1-a4-local-[\w-]+$/.test(container || '')) {
  throw new Error('Disposable local database required');
}
const inspection = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }))[0];
assert.equal(inspection.HostConfig.NetworkMode, 'none');
assert.equal(inspection.Mounts.some((mount) => mount.Type === 'bind'), false);
const args = ['exec', '-i', container, 'psql', '-h', '/tmp', '-U', 'postgres', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'];
const sql = (query) => execFileSync('docker', args, { input: `set search_path=public,extensions;\n${query}`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const quote = (value) => value === null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const contractPath = 'supabase/contracts/20260909012000_a1_a4_legacy_contract_v3.sql';
const contract = fs.readFileSync(contractPath, 'utf8');
const contractSha = digest(contract);
const expandFiles = [
  'supabase/migrations/20260908164550_current_payment_authority_and_refund_identity.sql',
  'supabase/migrations/20260908190758_a1_attempt_authority_expand_v2.sql',
  'supabase/migrations/20260909011239_a1_a4_durable_contract_control_v3.sql',
].map((file) => ({ path: file, sha256: digest(fs.readFileSync(file)) }));
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  : JSON.stringify(value);
const expandSha = digest(canonical(expandFiles));
const edgeVersion = `sha256:${'a'.repeat(64)}`;
const previousEdgeVersion = `sha256:${'b'.repeat(64)}`;
const actor = 'sol-v3-local-review';
const targetDeployedAt = new Date(Date.now() - 600_000).toISOString();
const previousDeployedAt = new Date(Date.now() - 1_200_000).toISOString();
const evidence = JSON.stringify({
  platform_project_ref: 'wwcpogltfgzgkrlilbcd', platform_snapshot_sha: 'c'.repeat(64),
  edge_functions: ['preference', 'refund', 'worker'].map((name) => ({ name, version: 10 })),
  previous_edge_version: previousEdgeVersion, target_edge_version: edgeVersion,
});

function createAttestation(overrides = {}) {
  const input = {
    environment: 'production', deploymentId: edgeVersion, previousEdgeVersion,
    edgeVersion, contractSha, expandVersion: '20260909011239', expandSha,
    previousDeployedAt, targetDeployedAt, trafficSwitchedAt: targetDeployedAt,
    expiresAt: new Date(Date.now() + 300_000).toISOString(), actor, evidence,
    ...overrides,
  };
  return sql(`select private.create_a1_a4_drain_attestation_v3(
    ${quote(input.environment)},${quote(input.deploymentId)},${quote(input.previousEdgeVersion)},
    ${quote(input.edgeVersion)},${quote(input.contractSha)},${quote(input.expandVersion)},${quote(input.expandSha)},
    ${quote(input.previousDeployedAt)}::timestamptz,${quote(input.targetDeployedAt)}::timestamptz,
    ${quote(input.trafficSwitchedAt)}::timestamptz,${quote(input.expiresAt)}::timestamptz,
    ${quote(input.actor)},${quote(input.evidence)}::jsonb);`);
}

function executeContract(attestationId, overrides = {}) {
  const input = { edgeVersion, contractSha, expandVersion: '20260909011239', expandSha, actor, ...overrides };
  const variables = [
    `\\set attestation_id ${attestationId}`,
    '\\set environment production',
    `\\set edge_version ${input.edgeVersion}`,
    `\\set contract_sha ${input.contractSha}`,
    `\\set expand_version ${input.expandVersion}`,
    `\\set expand_sha ${input.expandSha}`,
    `\\set actor ${input.actor}`,
  ].join('\n');
  return sql(`${variables}\n${contract}`);
}

// Browser roles cannot create evidence, inspect it, or execute the contract.
assert.equal(sql(`select has_table_privilege('authenticated','private.deployment_drain_attestations','insert')
  or has_table_privilege('authenticated','private.deployment_contract_executions','select')
  or has_function_privilege('authenticated','private.create_a1_a4_drain_attestation_v3(text,text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz,text,jsonb)','execute')
  or has_function_privilege('authenticated','private.execute_a1_a4_legacy_contract_v3(uuid,text,text,text,text,text,text)','execute')`), 'f');
assert.throws(() => sql(`set role authenticated; insert into private.deployment_drain_attestations default values`));
console.log('ATTESTATION_FORGERY: REJECTED');

// Production remains inert for the whole local contract exercise.
sql(`update business_payment_settings set enabled=false where environment='production';
  update mp_seller_connections set status='disconnected',protected_tokens=null where environment='production';
  begin; set local session_replication_role=replica;
  delete from payment_outbox; delete from payment_refunds; commit;`);

// Pause records a durable timestamp and disables cron plus immediate dispatch.
sql(`select private.set_a1_a4_payment_dispatch_paused_v3('production',${quote(edgeVersion)},${quote(actor)},true)`);
sql(`update private.a1_a4_payment_dispatch_control set paused_at=${quote(targetDeployedAt)}::timestamptz,
  updated_at=${quote(targetDeployedAt)}::timestamptz where environment='production'`);

// Scheduler state is independently enforced after the control row exists.
sql(`select cron.alter_job(jobid,active=>true) from cron.job where jobname='taba-payment-outbox-worker'`);
assert.throws(() => createAttestation(), /payment worker scheduler is active/);
sql(`select cron.alter_job(jobid,active=>false) from cron.job where jobname='taba-payment-outbox-worker'`);
console.log('SCHEDULER_ACTIVE_CONTRACT: REJECTED');

// A pg_net request that may still invoke a worker blocks attestation.
const queued = sql(`insert into net.http_request_queue(method,url,headers,body,timeout_milliseconds)
  values('POST','https://fixture.supabase.co/functions/v1/mercadopago-payment-worker','{}','{}',5000) returning id`);
assert.throws(() => createAttestation(), /payment worker pg_net dispatch is pending/);
sql(`delete from net.http_request_queue where id=${quote(queued)}::bigint`);
console.log('PG_NET_ACTIVE_CONTRACT: REJECTED');

// A dispatch already removed from pg_net is still bounded by the durable audit.
sql(`insert into private.a1_a4_payment_dispatch_audit(request_id,source,requested_at)
  values(-90001,'cron',clock_timestamp())`);
assert.throws(() => createAttestation(), /old Edge maximum lifetime has not drained/);
sql(`set session_replication_role=replica;
  update private.a1_a4_payment_dispatch_audit set requested_at=${quote(targetDeployedAt)}::timestamptz where request_id=-90001;
  set session_replication_role=origin;`);
console.log('PG_NET_RECENT_DISPATCH_CONTRACT: REJECTED');

// Wrong release/hash/expiry never consumes a valid attestation.
const expiredId = createAttestation();
sql(`set session_replication_role=replica;
  update private.deployment_drain_attestations set created_at=clock_timestamp()-interval '9 minutes',
    expires_at=clock_timestamp()-interval '1 second' where id=${quote(expiredId)}::uuid;
  set session_replication_role=origin;`);
assert.throws(() => executeContract(expiredId), /mismatch or expired/);
sql(`update private.deployment_drain_attestations set status='expired' where id=${quote(expiredId)}::uuid`);
console.log('DRAIN_EXPIRY: REJECTED');

const attestationId = createAttestation();
assert.throws(() => executeContract(attestationId, { edgeVersion: `sha256:${'d'.repeat(64)}` }), /mismatch or expired/);
assert.throws(() => executeContract(attestationId, { contractSha: 'e'.repeat(64) }), /mismatch or expired/);
assert.throws(() => executeContract(attestationId, { expandSha: 'f'.repeat(64) }), /mismatch or expired/);
assert.throws(() => executeContract(attestationId, { expandVersion: '20260909000000' }), /mismatch or expired/);
assert.equal(sql(`select status from private.deployment_drain_attestations where id=${quote(attestationId)}::uuid`), 'pending');
console.log('WRONG_EDGE_VERSION_CONTRACT_SHA_AND_EXPAND: REJECTED');

const result = executeContract(attestationId);
assert.match(result, /"result": "applied"|"result":"applied"/);
const ledger = JSON.parse(sql(`select row_to_json(e) from private.deployment_contract_executions e
  where contract_name='a1_a4_legacy_contract_v3' and environment='production'`));
assert.equal(ledger.contract_sha, contractSha);
assert.equal(ledger.expand_version, '20260909011239');
assert.equal(ledger.expand_sha, expandSha);
assert.equal(ledger.edge_version, edgeVersion);
assert.equal(ledger.actor, actor);
assert.equal(ledger.attestation_id, attestationId);
assert.equal(ledger.result, 'applied');
assert.equal(sql(`select status from private.deployment_drain_attestations where id=${quote(attestationId)}::uuid`), 'consumed');
assert.throws(() => executeContract(attestationId), /ALREADY_APPLIED/);
console.log('CONTRACT_LEDGER_AND_REAPPLICATION: PASS (second invocation REJECTED)');

// V2 remains functional after CONTRACT; old handlers and worker RPCs fail closed.
const childEnv = { ...process.env, TABA_LOCAL_PAYMENT_DB: '1' };
console.log(execFileSync(process.execPath, ['--experimental-vm-modules', 'scripts/verify-a1-v2-independent.mjs', container, '--current-contract'], { encoding: 'utf8', env: childEnv }));
console.log(execFileSync(process.execPath, ['--experimental-vm-modules', 'scripts/verify-a1-v2-independent.mjs', container, '--retired-contract'], { encoding: 'utf8', env: childEnv }));
assert.throws(() => sql(`select public.prepare_payment_refund(null,null,null,null)`), /legacy refund edge retired/);
assert.throws(() => sql(`select * from public.claim_payment_outbox('edge:legacy',1,90)`), /legacy worker retired/);
assert.equal(sql(`select count(*) from public.claim_payment_outbox_v2('edge:v2:fixture',1,90)`), '0');
console.log('NEW_EDGE_CONTRACT_DB: PASS');
console.log('OLD_EDGE_CONTRACT_DB: FAIL_CLOSED');
console.log('ROLLBACK_AFTER_CONTRACT: ROLL_FORWARD_ONLY');
sql(`select private.set_a1_a4_payment_dispatch_paused_v3('production',${quote(edgeVersion)},${quote(actor)},false)`);
assert.equal(sql(`select (not c.paused) and j.active and t.tgenabled<>'D'
  from private.a1_a4_payment_dispatch_control c
  join cron.job j on j.jobname='taba-payment-outbox-worker'
  join pg_trigger t on t.tgrelid='public.payment_outbox'::regclass and t.tgname='payment_outbox_worker_kick'
  where c.environment='production'`),'t');
console.log('POST_CONTRACT_V2_DISPATCH_RESUME: PASS');
