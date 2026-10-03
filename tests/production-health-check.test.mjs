import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  BASELINE_CRON, TARGETS, evaluateAlerts, evaluateCron, evaluateLedger, parseArgs, readOnlyAsk, repoLedger, runHealthCheck,
} from '../scripts/production-health-check.mjs';

const SCRIPT = new URL('../scripts/production-health-check.mjs', import.meta.url);
const job = (jobname, extra = {}) => ({ jobname, schedule: '* * * * *', active: true, last_status: 'succeeded', ...extra });

test('DIAG-03: una alerta CRITICAL abierta se ve (la tabla la escribe en mayúsculas)', () => {
  const alerts = evaluateAlerts([
    { severity: 'CRITICAL', alert_code: 'PAYMENT_APPROVED_WITHOUT_ORDER', abiertas: 2 },
    { severity: 'CRITICAL', alert_code: 'CHECKOUT_PROVIDER_UNVERIFIED', abiertas: 1 },
    { severity: 'ACTION_REQUIRED', alert_code: 'ORDER_NOT_ACCEPTED', abiertas: 4 },
  ]);
  assert.equal(alerts.critical, 3);
  assert.equal(alerts.open, 7);
  assert.deepEqual(alerts.bySeverity, { CRITICAL: 3, ACTION_REQUIRED: 4 });
  assert.equal(alerts.findings.length, 1);
  assert.match(alerts.findings[0], /3 alerta\(s\) CRITICAL abiertas: PAYMENT_APPROVED_WITHOUT_ORDER=2 CHECKOUT_PROVIDER_UNVERIFIED=1/);
  // Sin críticas, las demás se informan pero no ponen la sonda en rojo.
  assert.deepEqual(evaluateAlerts([{ severity: 'WARNING', alert_code: 'RIDER_SIGNAL_STALE', abiertas: 1 }]).findings, []);
  // Y una severidad escrita en minúscula también cuenta (comparación sin mayúsculas).
  assert.equal(evaluateAlerts([{ severity: 'critical', alert_code: 'X', abiertas: 1 }]).critical, 1);
});

test('DIAG-03: cinco tareas taba-* sanas no son un problema (antes se exigían exactamente cuatro)', () => {
  const jobs = [...BASELINE_CRON, 'taba-qa-window-expiry'].map((name) => job(name));
  const cron = evaluateCron({ jobs, inventoryAvailable: false });
  assert.equal(cron.source, 'baseline');
  assert.deepEqual(cron.findings, []);
  assert.deepEqual(cron.extra, ['taba-qa-window-expiry']);
});

test('con el inventario de la base, manda el inventario: falta, apagada o fallando es un hallazgo', () => {
  const inventory = [...BASELINE_CRON, 'taba-qa-window-expiry', 'taba-order-intake-purge', 'taba-unattended-order-expiry'];
  const jobs = [
    ...BASELINE_CRON.map((name) => job(name)),
    job('taba-qa-window-expiry', { active: false }),
    job('taba-order-intake-purge', { last_status: 'failed' }),
    job('taba-legacy-extra', { last_status: 'failed' }),
    job('taba-another-extra', { active: false }),
  ];
  const cron = evaluateCron({ jobs, inventoryAvailable: true, inventory });
  assert.equal(cron.source, 'inventory');
  assert.deepEqual(cron.findings.sort(), [
    'cron taba-legacy-extra (fuera de lo exigido) termino en failed',
    'cron taba-order-intake-purge termino en failed',
    'cron taba-qa-window-expiry inactivo',
    'falta el cron taba-unattended-order-expiry',
  ]);
  // Una tarea de más apagada no es un problema; una de más que falla, sí (arriba).
  assert.deepEqual(cron.extra.sort(), ['taba-another-extra', 'taba-legacy-extra']);
});

test('un inventario que existe y se lee vacío no apaga la exigencia: se avisa y se exigen las cuatro', () => {
  const cron = evaluateCron({ jobs: [job('taba-payment-outbox-worker')], inventoryAvailable: true, inventory: [] });
  assert.equal(cron.source, 'baseline');
  assert.match(cron.findings[0], /se leyo vacio/);
  assert.equal(cron.findings.filter((f) => f.startsWith('falta el cron')).length, 3);
});

test('el ledger se compara por conjuntos: faltantes, deriva y el mismo número con otra migración adentro', () => {
  const repo = ['20260101000000', '20260102000000', '20260103000000'];
  assert.deepEqual(evaluateLedger(repo, repo).findings, []);
  const behind = evaluateLedger(repo.slice(0, 2), repo);
  assert.deepEqual(behind.missing, ['20260103000000']);
  assert.match(behind.findings[0], /faltan 1 migration\(s\)/);
  // Misma cuenta y misma última, otra migración en el medio: antes pasaba.
  const swapped = evaluateLedger(['20260101000000', '20260102500000', '20260103000000'], repo);
  assert.equal(swapped.total, 3);
  assert.equal(swapped.last, '20260103000000');
  assert.deepEqual(swapped.unknown, ['20260102500000']);
  assert.deepEqual(swapped.missing, ['20260102000000']);
  assert.equal(swapped.findings.length, 2);
  assert.match(swapped.findings[0], /deriva/);
});

test('el ledger del repositorio sale del directorio, ordenado y sin repetidos', () => {
  const versions = repoLedger();
  assert.ok(versions.length >= 200);
  assert.deepEqual(versions, [...versions].sort());
  assert.equal(new Set(versions).size, versions.length);
  for (const version of versions) assert.match(version, /^\d{14}$/);
});

test('el destino se nombra siempre; CP y Staging se pueden mirar; un ref desconocido se rechaza', () => {
  assert.throws(() => parseArgs([]), /no hay default implicito/);
  assert.throws(() => parseArgs(['--target', 'demo']), /--target tiene que ser/);
  assert.throws(() => parseArgs(['--ref', 'yakhtrkukqlgzvxuvhzs']), /no es ninguno de los proyectos/);
  assert.throws(() => parseArgs(['--target', 'staging', '--ref', TARGETS.production.ref]), /no es el proyecto de staging/);
  assert.throws(() => parseArgs(['--target', 'staging', '--business-id', "x' or 1=1"]), /uuid/);
  // Compatibilidad: verify-production.mjs sigue llamando con --ref de la producción vieja.
  assert.deepEqual(parseArgs(['--ref', 'wwcpogltfgzgkrlilbcd']), {
    target: 'production', ref: 'wwcpogltfgzgkrlilbcd', canonicalBusiness: '00000000-0000-4000-8000-000000000001',
    prelaunch: true, report: undefined,
  });
  const cp = parseArgs(['--target', 'controlled-production']);
  assert.equal(cp.ref, 'tkanbadcglszlcyfjvpv');
  const deploy = JSON.parse(fs.readFileSync(new URL('../deploy/controlled-production.json', import.meta.url), 'utf8'));
  assert.equal(cp.canonicalBusiness, deploy.businessId, 'el negocio de CP sale de deploy/controlled-production.json');
  assert.equal(cp.prelaunch, false);
  assert.equal(parseArgs(['--target', 'staging']).canonicalBusiness, null);
});

test('la sonda sólo manda SELECT/WITH y sólo al endpoint de sólo lectura', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify([{ ok: 1 }]), { status: 200 });
  };
  const ask = readOnlyAsk({ ref: TARGETS['controlled-production'].ref, token: 'token-de-prueba', fetchImpl });
  assert.deepEqual(await ask('select 1 as ok'), [{ ok: 1 }]);
  assert.equal(calls[0].url, 'https://api.supabase.com/v1/projects/tkanbadcglszlcyfjvpv/database/query/read-only');
  assert.deepEqual(JSON.parse(calls[0].init.body), { query: 'select 1 as ok' });
  for (const bad of ['update public.orders set status = 1', 'delete from cron.job', 'do $$ begin end $$']) {
    await assert.rejects(ask(bad), /solo ejecuta SELECT/);
  }
  assert.equal(calls.length, 1, 'nada que no sea de lectura llega a salir');
});

// Un destino como el CP de hoy: cinco tareas, sin inventario, una alerta crítica abierta, al día con el checkout.
function fakeTarget({ ledger, jobs, inventory = null, alerts = [], business = null }) {
  const asked = [];
  const ask = async (sql) => {
    asked.push(sql);
    if (/current_database\(\)/.test(sql)) return [{ db: 'postgres', server: 'PostgreSQL 17.6' }];
    if (/from supabase_migrations\.schema_migrations/.test(sql)) return ledger.map((version) => ({ version }));
    if (/from public\.operational_sweep_runs/.test(sql)) return [{ last_run_at: '2026-10-03T12:00:00Z', age_seconds: 40 }];
    if (/has_function_privilege/.test(sql)) return [{ anon_heartbeat: true, anon_watchdog: true }];
    if (/from cron\.job j/.test(sql)) return jobs;
    if (/to_regclass\('private\.scheduler_expected_jobs'\)/.test(sql)) return [{ available: inventory !== null }];
    if (/from private\.scheduler_expected_jobs/.test(sql)) return (inventory || []).map((job_name) => ({ job_name }));
    if (/from public\.operational_alerts/.test(sql)) return alerts;
    if (/'auth_users' as tabla/.test(sql)) return [{ tabla: 'auth_users', filas: 3 }, { tabla: 'orders', filas: 12 }];
    if (/from public\.businesses where id =/.test(sql)) return business ? [business] : [];
    throw new Error(`consulta inesperada: ${sql.slice(0, 80)}`);
  };
  return { ask, asked };
}

test('el CP de hoy: cinco tareas sanas y al día da SANO; una alerta crítica abierta la pone en rojo', async () => {
  const repoVersions = ['20260101000000', '20260102000000'];
  const options = parseArgs(['--target', 'controlled-production']);
  const business = { id: options.canonicalBusiness, name: 'La Taba', ordering_enabled: false, ordering_verified: false, status: 'closed' };
  const jobs = [...BASELINE_CRON, 'taba-qa-window-expiry'].map((name) => job(name));
  const sano = await runHealthCheck({ ask: fakeTarget({ ledger: repoVersions, jobs, business }).ask, options, repoVersions });
  assert.deepEqual(sano.findings, []);
  assert.equal(sano.healthy, true);
  assert.equal(sano.prelaunchOrderingClosed, null, 'CP no es prelanzamiento');

  const target = fakeTarget({
    ledger: repoVersions, jobs, business,
    alerts: [{ severity: 'CRITICAL', alert_code: 'CHECKOUT_PROVIDER_UNVERIFIED', abiertas: 1 }],
  });
  const rojo = await runHealthCheck({ ask: target.ask, options, repoVersions });
  assert.equal(rojo.healthy, false);
  assert.deepEqual(rojo.findings, ['1 alerta(s) CRITICAL abiertas: CHECKOUT_PROVIDER_UNVERIFIED=1']);
  for (const sql of target.asked) assert.match(sql, /^\s*(select|with)\b/i, 'sólo lecturas');
  assert.ok(target.asked.some((sql) => /status <> 'resolved'/.test(sql)), 'abierta es lo que la base llama abierta');
});

test('con inventario en la base, una tarea del inventario que falta pone la sonda en rojo aunque haya «suficientes»', async () => {
  const repoVersions = ['20260101000000'];
  const options = parseArgs(['--target', 'staging']);
  const jobs = [...BASELINE_CRON, 'taba-qa-window-expiry', 'taba-order-intake-purge'].map((name) => job(name));
  const result = await runHealthCheck({
    ask: fakeTarget({ ledger: repoVersions, jobs, inventory: [...BASELINE_CRON, 'taba-cron-history-purge'] }).ask,
    options, repoVersions,
  });
  assert.deepEqual(result.findings, ['falta el cron taba-cron-history-purge']);
  assert.equal(result.business, 'not_checked');
});

test('sin destino o sin token la sonda sale con 2 y no pregunta nada', () => {
  const run = (args, env = {}) => spawnSync(process.execPath, [fileURLToPath(SCRIPT), ...args], {
    encoding: 'utf8', env: { PATH: process.env.PATH, ...env },
  });
  const sinDestino = run([]);
  assert.equal(sinDestino.status, 2);
  assert.match(sinDestino.stderr, /no hay default implicito/);
  const sinToken = run(['--target', 'controlled-production']);
  assert.equal(sinToken.status, 2);
  assert.match(sinToken.stderr, /falta SUPABASE_ACCESS_TOKEN/);
});
