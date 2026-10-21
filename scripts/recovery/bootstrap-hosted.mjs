// Applies existing migrations only to a newly created, receipt-bound recovery
// project. No project creation, key retrieval, Edge deploy or real payments.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, assertRecoveryTarget, assertRecoveryOrganization, recoveryPlan, sha256 } from './plan.mjs';

const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
export const PAUSE_SCHEDULERS = `
do $recovery_pause$ declare j record; begin
  if to_regclass('cron.job') is not null then
    for j in select jobid from cron.job where jobname like 'taba-%' loop
      perform cron.alter_job(j.jobid, active := false);
    end loop;
  end if;
end $recovery_pause$;
`;

export function migrationTransaction(migration, sql) {
  if (sha256(Buffer.from(sql)) !== migration.sha256 || !/^\d{14}$/.test(migration.version)) {
    throw new Error('Migration bytes differ from the reviewed manifest');
  }
  return `begin;
set local statement_timeout='120s';
select pg_advisory_xact_lock(1413562945, 20);
do $recovery_version$ begin
  if exists(select 1 from private.la_taba_recovery_migrations where version=${quote(migration.version)}) then
    raise exception 'RECOVERY_CONCURRENT_MIGRATION_RETRY';
  end if;
end $recovery_version$;
${sql}
${PAUSE_SCHEDULERS}
insert into private.la_taba_recovery_migrations(version,sha256) values(${quote(migration.version)},${quote(migration.sha256)});
insert into supabase_migrations.schema_migrations(version,name,statements)
values(${quote(migration.version)},${quote(path.basename(migration.path).slice(15, -4))},array[${quote(sql)}]);
commit;`;
}

export function checkResumeLedger(plan, rows) {
  if (!Array.isArray(rows) || rows.length > plan.migrations.length) throw new Error('Invalid recovery migration ledger');
  rows.forEach((row, index) => {
    const expected = plan.migrations[index];
    if (row.version !== expected.version || row.sha256 !== expected.sha256) throw new Error('Recovery history has unknown, reordered or changed SQL');
  });
  return rows.length;
}

export async function bootstrapSchema({ target, plan, project, query, root = ROOT }) {
  assertRecoveryTarget(target, project);
  const current = recoveryPlan(root);
  // The backup summary can vary without changing executable schema sources.
  if (JSON.stringify(plan.migrations) !== JSON.stringify(current.migrations) ||
    JSON.stringify(plan.functions) !== JSON.stringify(current.functions)) throw new Error('Recovery sources changed; rebuild and review the manifest');
  const baseline = await query(`select
    to_regclass('private.la_taba_recovery_migrations') is not null as resumable,
    (select count(*)::int from pg_tables where schemaname in ('public','private','catalog_admin')
      and tablename not in ('spatial_ref_sys')) as application_tables,
    (select count(*)::int from auth.users) as auth_users;`);
  const state = baseline[0];
  if (!state || state.auth_users !== 0 || (!state.resumable && state.application_tables !== 0)) {
    throw new Error('Fresh empty recovery project required; existing data will not be altered');
  }
  if (!state.resumable) {
    await query(`begin;
create schema if not exists private;
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations(version text primary key,statements text[],name text);
create table private.la_taba_recovery_target(singleton boolean primary key default true check(singleton), project_ref text not null);
insert into private.la_taba_recovery_target(project_ref) values(${quote(target.projectRef)});
create table private.la_taba_recovery_migrations(version text primary key,sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),applied_at timestamptz not null default now());
alter table private.la_taba_recovery_target enable row level security;
alter table private.la_taba_recovery_migrations enable row level security;
revoke all on private.la_taba_recovery_target,private.la_taba_recovery_migrations from public,anon,authenticated,service_role;
commit;`);
  }
  const marker = await query('select project_ref from private.la_taba_recovery_target where singleton');
  if (marker.length !== 1 || marker[0].project_ref !== target.projectRef) throw new Error('Recovery database receipt mismatch');
  const ledger = await query('select version,sha256 from private.la_taba_recovery_migrations order by version');
  const start = checkResumeLedger(plan, ledger);
  const standard = await query('select version from supabase_migrations.schema_migrations order by version');
  if (JSON.stringify(standard.map(row => row.version)) !== JSON.stringify(ledger.map(row => row.version))) {
    throw new Error('Platform migration ledger differs from recovery ledger');
  }
  for (const migration of plan.migrations.slice(start)) {
    const sql = fs.readFileSync(path.join(root, migration.path), 'utf8');
    await query(migrationTransaction(migration, sql));
  }
  await query(`begin;
${PAUSE_SCHEDULERS}
update public.businesses set status='paused',ordering_enabled=false,ordering_verified=false;
update public.business_payment_settings set enabled=false;
commit;`);
  return { migrationsApplied: plan.migrations.length, resumedFrom: start,
    commercialPaymentsEnabled: false, seedSqlApplied: false, historicalUsersRestored: false };
}

export function quarantineSql(bytes) {
  const backup = JSON.parse(Buffer.from(bytes).toString('utf8'));
  if (backup.project_ref !== 'wwcpogltfgzgkrlilbcd' || !Array.isArray(backup.data?.products) ||
    !Array.isArray(backup.data?.businesses)) throw new Error('Expected original La Taba partial backup');
  const digest = sha256(bytes), rows = [];
  for (const table of ['businesses', 'products', 'orders_summary']) {
    for (const [ordinal, payload] of (backup.data[table] || []).entries()) {
      rows.push({ source_table: table, ordinal, payload, row_sha256: sha256(JSON.stringify(payload)) });
    }
  }
  return { digest, rowCount: rows.length, sql: `begin;
create table if not exists private.la_taba_recovery_source_rows(
  backup_sha256 text not null, source_table text not null, ordinal integer not null,
  payload jsonb not null, row_sha256 text not null, imported_at timestamptz not null default now(),
  primary key(backup_sha256,source_table,ordinal));
alter table private.la_taba_recovery_source_rows enable row level security;
revoke all on private.la_taba_recovery_source_rows from public,anon,authenticated,service_role;
insert into private.la_taba_recovery_source_rows(backup_sha256,source_table,ordinal,payload,row_sha256)
select ${quote(digest)},x.source_table,x.ordinal,x.payload,x.row_sha256
from jsonb_to_recordset(${quote(JSON.stringify(rows))}::jsonb)
as x(source_table text,ordinal integer,payload jsonb,row_sha256 text)
on conflict do nothing;
do $recovery_rows$ begin
  if (select count(*) from private.la_taba_recovery_source_rows where backup_sha256=${quote(digest)}) <> ${rows.length}
    or exists(select 1 from jsonb_to_recordset(${quote(JSON.stringify(rows))}::jsonb)
      as x(source_table text,ordinal integer,payload jsonb,row_sha256 text)
      left join private.la_taba_recovery_source_rows r on r.backup_sha256=${quote(digest)}
        and r.source_table=x.source_table and r.ordinal=x.ordinal
      where r.row_sha256 is distinct from x.row_sha256 or r.payload is distinct from x.payload) then
    raise exception 'RECOVERY_SOURCE_ROW_MISMATCH';
  end if;
end $recovery_rows$;
commit;` };
}

async function main() {
  const args = process.argv.slice(2);
  const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  if (!args.includes('--apply')) {
    console.log('PLAN ONLY: no credentials or network. --target, --manifest, --phase and --apply are required to execute.');
    return;
  }
  const target = JSON.parse(fs.readFileSync(option('--target'), 'utf8'));
  const plan = JSON.parse(fs.readFileSync(option('--manifest'), 'utf8'));
  assertRecoveryTarget(target); // Must fail before reading any credential.
  const phase = option('--phase');
  if (!['schema', 'quarantine'].includes(phase)) throw new Error('Explicit recovery phase required');
  const { conToken } = await import('../lib/supabase-cli-token.mjs');
  await conToken(async token => {
    const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const orgResponse = await fetch(`https://api.supabase.com/v1/organizations/${target.organizationId}`, {
      headers, signal: AbortSignal.timeout(10000),
    });
    if (!orgResponse.ok) throw new Error('Unable to verify Free organization');
    assertRecoveryOrganization(target, await orgResponse.json());
    const base = `https://api.supabase.com/v1/projects/${target.projectRef}`;
    const response = await fetch(base, { headers, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Recovery project unavailable');
    const project = await response.json();
    assertRecoveryTarget(target, project);
    const query = async sql => {
      const result = await fetch(base + '/database/query', { method: 'POST', headers,
        body: JSON.stringify({ query: sql }), signal: AbortSignal.timeout(150000) });
      if (!result.ok) throw new Error(`Recovery SQL failed (HTTP ${result.status}); no raw error or query is logged`);
      return await result.json();
    };
    if (phase === 'schema') console.log(JSON.stringify(await bootstrapSchema({ target, plan, project, query })));
    else {
      const marker = await query('select project_ref from private.la_taba_recovery_target where singleton');
      if (marker.length !== 1 || marker[0].project_ref !== target.projectRef) throw new Error('Recovery database receipt mismatch');
      const bytes = fs.readFileSync(option('--backup'));
      if (sha256(bytes) !== plan.backup?.sha256) throw new Error('Backup does not match the reviewed manifest');
      const data = quarantineSql(bytes);
      await query(data.sql);
      console.log(JSON.stringify({ stagedRows: data.rowCount, backupSha256: data.digest,
        publicCatalogModified: false, pricesModified: false, usersInvented: false, historicalOrdersInvented: false }));
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Recovery stopped. Inspect the completed-version ledger before resuming; credentials and SQL payloads are not logged.'); process.exitCode = 1; });
}
