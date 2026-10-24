// Despliegue y actualización del proyecto de PRODUCCIÓN con el mismo mecanismo probado en QA
// (libro de migraciones con SHA, ensayo con rollback, funciones con hash de cada archivo), detrás de la guardia de
// scripts/production/hosted.mjs. Todo comando que escribe exige --apply y --confirm <ref de producción>.
//
//   node scripts/production/deploy.mjs status                                   sólo lectura
//   node scripts/production/deploy.mjs bootstrap  --apply --confirm <ref>       proyecto VACÍO: marca + todas las migraciones
//   node scripts/production/deploy.mjs rehearse   --migration <archivo> [--tap <archivo>]   transacción que siempre revierte
//   node scripts/production/deploy.mjs migrations [--apply --confirm <ref>]      sólo las posteriores al libro
//   node scripts/production/deploy.mjs functions  <a,b|all> [--apply --confirm <ref>]
//   node scripts/production/deploy.mjs schedulers [--enable a,b | --disable a,b] [--confirm <ref>]
//   node scripts/production/deploy.mjs gates                                    las funciones rechazan lo no autenticado
//
// --evidence <archivo> agrega una línea JSON por paso. Ningún comando imprime credenciales, consultas ni cuerpos de
// error crudos. Mientras deploy/environments.json no tenga proyecto de producción, todo sale 2 sin leer credenciales.
import fs from 'node:fs';
import path from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { productionTargetOrExit } from '../lib/environments.mjs';
import { ROOT, recoveryPlan, sha256 } from '../recovery/plan.mjs';
import { PAUSE_SCHEDULERS, checkResumeLedger } from '../recovery/bootstrap-hosted.mjs';
import { LEDGER_TABLE, MARKER_TABLE, withProductionProject } from './hosted.mjs';

const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";

/** Una migración, en su transacción, con el libro de producción. Pura. */
export function productionMigrationTransaction(migration, sql) {
  if (sha256(Buffer.from(sql)) !== migration.sha256 || !/^\d{14}$/.test(migration.version)) {
    throw new Error('Migration bytes differ from the reviewed manifest');
  }
  return `begin;
set local statement_timeout='120s';
select pg_advisory_xact_lock(1413562945, 21);
do $deployment_version$ begin
  if exists(select 1 from ${LEDGER_TABLE} where version=${quote(migration.version)}) then
    raise exception 'DEPLOYMENT_CONCURRENT_MIGRATION_RETRY';
  end if;
end $deployment_version$;
${sql}
${PAUSE_SCHEDULERS}
insert into ${LEDGER_TABLE}(version,sha256) values(${quote(migration.version)},${quote(migration.sha256)});
insert into supabase_migrations.schema_migrations(version,name,statements)
values(${quote(migration.version)},${quote(path.basename(migration.path).slice(15, -4))},array[${quote(sql)}]);
commit;`;
}

/** El primer despliegue: marca y libro en un proyecto que no tiene nada de La Taba. Pura. */
export function productionBootstrapSql(ref) {
  if (!/^[a-z]{20}$/.test(ref)) throw new Error('ref inválido');
  return `begin;
create schema if not exists private;
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations(version text primary key,statements text[],name text);
create table ${MARKER_TABLE}(singleton boolean primary key default true check(singleton), project_ref text not null,
  environment text not null check (environment = 'production'), created_at timestamptz not null default now());
insert into ${MARKER_TABLE}(project_ref, environment) values(${quote(ref)}, 'production');
create table ${LEDGER_TABLE}(version text primary key,sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),applied_at timestamptz not null default now());
alter table ${MARKER_TABLE} enable row level security;
alter table ${LEDGER_TABLE} enable row level security;
revoke all on ${MARKER_TABLE}, ${LEDGER_TABLE} from public, anon, authenticated, service_role;
commit;`;
}

/** Qué falta aplicar, con el libro como prefijo exacto del repositorio. Pura. */
export function pendingMigrations(plan, ledger, platformVersions) {
  const start = checkResumeLedger(plan, ledger);
  if (JSON.stringify(platformVersions) !== JSON.stringify(ledger.map((row) => row.version))) {
    throw new Error('Platform migration ledger differs from the production ledger');
  }
  return plan.migrations.slice(start);
}

const args = process.argv.slice(2);
const command = args[0];
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const apply = args.includes('--apply');
const evidence = value('--evidence');
const record = (row) => {
  const line = JSON.stringify({ at: new Date().toISOString(), command, ...row });
  if (evidence) fs.appendFileSync(evidence, line + '\n');
  console.log(line);
};

function requireConfirmation(target) {
  if (value('--confirm') !== target.ref) {
    console.error(`Para escribir en producción hay que repetir el ref: --confirm ${target.ref}. No se tocó nada.`);
    process.exit(2);
  }
}

async function readLedger(query) {
  const ledger = await query(`select version,sha256 from ${LEDGER_TABLE} order by version`);
  const platform = (await query('select version from supabase_migrations.schema_migrations order by version')).map((row) => row.version);
  return { ledger, platform };
}

async function deployFunctions(request, plan, names) {
  const selected = names.includes('all') ? plan.functions : plan.functions.filter((fn) => names.includes(fn.name));
  const unknown = names.filter((name) => name !== 'all' && !plan.functions.some((fn) => fn.name === name));
  if (unknown.length || !selected.length) throw new Error(`Funciones desconocidas: ${unknown.join(', ') || '(ninguna)'}`);
  for (const fn of selected) {
    const form = new FormData();
    form.set('metadata', JSON.stringify({ name: fn.name, verify_jwt: fn.verifyJwt, entrypoint_path: fn.entrypoint.replace('supabase/functions/', '') }));
    for (const file of fn.files) {
      const bytes = fs.readFileSync(path.join(ROOT, file.path));
      if (sha256(bytes) !== file.sha256) throw new Error('Function source hash mismatch');
      form.append('file', new Blob([bytes], { type: 'application/typescript' }), file.path.replace('supabase/functions/', ''));
    }
    const result = await request(`/functions/deploy?slug=${fn.name}`, { method: 'POST', body: form });
    record({ function: fn.name, status: result.status, version: result.version, verifyJwt: fn.verifyJwt });
  }
}

async function main() {
  const known = ['status', 'bootstrap', 'rehearse', 'migrations', 'functions', 'schedulers', 'gates'];
  if (!known.includes(command)) {
    console.error(`uso: deploy.mjs ${known.join('|')} … (ver el encabezado del archivo)`);
    process.exit(2);
  }
  const target = productionTargetOrExit({ allowProvisioned: true });
  const plan = recoveryPlan();

  if (command === 'bootstrap') {
    if (!apply) { record({ plan: 'bootstrap', migrations: plan.migrations.length, functions: plan.functions.length, apply: false }); return; }
    requireConfirmation(target);
    await withProductionProject(async ({ query }) => {
      const [state] = await query(`select to_regclass('${MARKER_TABLE}') is not null as marked,
        (select count(*)::int from pg_tables where schemaname in ('public','private','catalog_admin') and tablename not in ('spatial_ref_sys')) as application_tables,
        (select count(*)::int from auth.users) as auth_users`);
      if (state.marked || state.auth_users !== 0 || state.application_tables !== 0) {
        throw new Error('Se exige un proyecto vacío y sin marca: el primer despliegue no altera datos existentes');
      }
      await query(productionBootstrapSql(target.ref));
      for (const migration of plan.migrations) {
        await query(productionMigrationTransaction(migration, fs.readFileSync(path.join(ROOT, migration.path), 'utf8')));
        record({ migration: migration.version, sha256: migration.sha256, result: 'applied' });
      }
      // Nada vende ni cobra todavía: el negocio sembrado queda cerrado y los cobros apagados; los cron quedan en pausa
      // hasta cargar secretos y Vault (sincronizar-worker-hmac.mjs) y reactivarlos con `schedulers --enable`.
      await query(`begin;
${PAUSE_SCHEDULERS}
update public.businesses set status='paused',ordering_enabled=false,ordering_verified=false;
update public.business_payment_settings set enabled=false;
commit;`);
      record({ result: 'bootstrapped', migrations: plan.migrations.length, commercialPaymentsEnabled: false, schedulersPaused: true });
    }, { requireMarker: false });
    return;
  }

  if (command === 'rehearse') {
    const file = path.resolve(ROOT, value('--migration') || '');
    if (!/supabase[\\/]migrations[\\/]\d{14}_[a-z0-9_]+\.sql$/.test(file)) throw new Error('--migration debe ser un archivo de migración');
    const migration = fs.readFileSync(file, 'utf8');
    if (/^\s*(?:begin|commit|rollback);/im.test(migration)) throw new Error('La migración no puede manejar su propia transacción');
    const tap = value('--tap') ? fs.readFileSync(path.resolve(ROOT, value('--tap')), 'utf8').replace(/^begin;\s*/m, '').replace(/rollback;\s*$/m, '') : '';
    await withProductionProject(async ({ query }) => {
      try {
        await query(`begin;\nset local statement_timeout='120s';\n${migration}\n${tap}\ndo $rehearsal$ begin raise exception 'REHEARSAL_OK_ROLLED_BACK'; end $rehearsal$;\nrollback;`);
        record({ migration: path.basename(file), result: 'unexpected_commit_path' });
        process.exitCode = 1;
      } catch (error) {
        const ok = String(error.message).includes('REHEARSAL_OK_ROLLED_BACK');
        record({ migration: path.basename(file), result: ok ? 'passed_and_rolled_back' : 'failed_and_rolled_back', detail: ok ? null : String(error.message).slice(0, 600) });
        if (!ok) process.exitCode = 1;
      }
    });
    return;
  }

  if (command === 'status' || command === 'migrations') {
    if (command === 'migrations' && apply) requireConfirmation(target);
    await withProductionProject(async ({ query, request, project, organization }) => {
      const { ledger, platform } = await readLedger(query);
      const pending = pendingMigrations(plan, ledger, platform);
      if (command === 'status') {
        const functions = await request('/functions');
        const jobs = await query(`select jobname, active from cron.job where jobname like 'taba-%' order by jobname`).catch(() => []);
        record({ project: { ref: target.ref, region: project.region, status: project.status }, plan: organization.plan,
          migrations: { applied: ledger.length, pending: pending.map((m) => m.version) },
          functions: { deployed: functions.map((fn) => ({ name: fn.slug, version: fn.version, status: fn.status })), expected: plan.functions.length },
          schedulers: jobs });
        return;
      }
      record({ pending: pending.map((m) => `${m.version} ${path.basename(m.path)}`), apply });
      if (!apply) return;
      for (const migration of pending) {
        await query(productionMigrationTransaction(migration, fs.readFileSync(path.join(ROOT, migration.path), 'utf8')));
        record({ migration: migration.version, sha256: migration.sha256, result: 'applied' });
      }
      if (pending.length) record({ next: 'desplegar las funciones que cambiaron y reactivar los cron que estaban activos (schedulers --enable)' });
    });
    return;
  }

  if (command === 'functions') {
    const names = String(args[1] || '').split(',').map((name) => name.trim()).filter(Boolean);
    if (!apply) { record({ plan: names, apply: false }); return; }
    requireConfirmation(target);
    await withProductionProject(({ request }) => deployFunctions(request, plan, names));
    return;
  }

  if (command === 'schedulers') {
    const mode = args.includes('--enable') ? 'enable' : args.includes('--disable') ? 'disable' : 'list';
    if (mode !== 'list') requireConfirmation(target);
    await withProductionProject(async ({ query }) => {
      let jobs = await query(`select jobid, jobname, active from cron.job where jobname like 'taba-%' order by jobname`);
      if (mode !== 'list') {
        const names = String(value(`--${mode}`) || '').split(',').map((name) => name.trim()).filter(Boolean);
        const unknown = names.filter((name) => !jobs.some((job) => job.jobname === name));
        if (!names.length || unknown.length) throw new Error(`Trabajos desconocidos: ${unknown.join(', ') || '(ninguno)'}`);
        await query(`do $production_cron$ declare j record; begin
          for j in select jobid from cron.job where jobname in (${names.map(quote).join(',')}) loop
            perform cron.alter_job(j.jobid, active := ${mode === 'enable'});
          end loop; end $production_cron$;`);
        jobs = await query(`select jobid, jobname, active from cron.job where jobname like 'taba-%' order by jobname`);
      }
      record({ mode, jobs: jobs.map(({ jobname, active }) => ({ jobname, active })) });
    });
    return;
  }

  if (command === 'gates') {
    await withProductionProject(async ({ request }) => {
      const functions = await request('/functions');
      const checks = [];
      for (const fn of functions) {
        const callback = fn.slug === 'mercadopago-oauth-callback';
        const response = await fetch(`${target.supabaseUrl}/functions/v1/${fn.slug}`, {
          method: callback ? 'GET' : 'POST', redirect: 'manual', body: callback ? undefined : '{}',
          headers: { 'content-type': 'application/json', origin: target.origin }, signal: AbortSignal.timeout(30000),
        });
        checks.push({ name: fn.slug, active: fn.status === 'ACTIVE', httpStatus: response.status,
          rejected: callback ? response.status === 303 : response.status >= 400 });
      }
      const call = (headers) => fetch(`${target.supabaseUrl}/functions/v1/mercadopago-payment-worker`, { method: 'POST', body: '{}',
        signal: AbortSignal.timeout(30000), headers: { 'content-type': 'application/json', ...headers } }).then((response) => response.status);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const worker = {
        unsigned: await call({}),
        wrongSignature: await call({ 'x-taba-worker-timestamp': timestamp, 'x-taba-worker-nonce': randomUUID(),
          'x-taba-worker-signature': createHmac('sha256', randomUUID()).update(timestamp).digest('hex') }),
      };
      const passed = functions.length === plan.functions.length && checks.every((row) => row.active && row.rejected)
        && worker.unsigned === 401 && worker.wrongSignature === 401;
      record({ checks, worker, passed });
      if (!passed) process.exitCode = 1;
    });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`DESPLIEGUE DETENIDO: ${String(error.message || error).slice(0, 600)}`);
    process.exitCode = 1;
  });
}
