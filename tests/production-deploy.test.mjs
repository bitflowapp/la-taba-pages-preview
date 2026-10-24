// Las herramientas de despliegue de PRODUCCIÓN (scripts/production/hosted.mjs y deploy.mjs), sin red: la guardia
// sobre lo que contestaría la Management API, el libro de migraciones y la línea de comandos sin proyecto.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';

import { assertProductionPlatform, LEDGER_TABLE, MARKER_TABLE, withProductionProject } from '../scripts/production/hosted.mjs';
import { pendingMigrations, productionBootstrapSql, productionMigrationTransaction } from '../scripts/production/deploy.mjs';
import { productionTarget } from '../scripts/lib/environments.mjs';
import { recoveryPlan, sha256 } from '../scripts/recovery/plan.mjs';

const ACTIVE = JSON.parse(fs.readFileSync('tests/fixtures/environments.production-active.json', 'utf8'));
const target = productionTarget({ registry: ACTIVE });
const organization = { id: target.organizationId, plan: 'pro' };
const project = { id: target.ref, organization_id: target.organizationId, region: target.region, status: 'ACTIVE_HEALTHY' };

test('la guardia acepta sólo el proyecto del registro, sano, en su región y en una organización paga', () => {
  assert.doesNotThrow(() => assertProductionPlatform(target, { organization, project }));
  const rejects = (changes, pattern) => assert.throws(() => assertProductionPlatform(target, {
    organization: { ...organization, ...changes.organization }, project: { ...project, ...changes.project } }), pattern);
  rejects({ organization: { plan: 'free' } }, /plan gratuito/);
  rejects({ organization: { id: 'otraorganizacionxyz' } }, /organización no es la del registro/);
  rejects({ project: { region: 'us-east-1' } }, /región us-east-1/);
  rejects({ project: { status: 'INACTIVE' } }, /estado INACTIVE/);
  rejects({ project: { id: 'otroproyectoxxxxxxxx', organization_id: 'otraorganizacionxyz' } }, /no es el del registro/);
});

function fakeApi({ plan = 'pro', marker = [{ project_ref: target.ref, environment: 'production' }] } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push(String(url));
    if (url.includes('/organizations/')) return Response.json({ ...organization, plan });
    if (url.endsWith(`/projects/${target.ref}`)) return Response.json(project);
    if (url.endsWith('/database/query')) {
      const sql = JSON.parse(init.body).query;
      if (sql.includes(MARKER_TABLE)) return Response.json(marker);
      return Response.json([]);
    }
    throw new Error(`unexpected ${url}`);
  };
  return { fetchImpl, calls, withToken: (task) => task('fixture-management-token') };
}

test('sin proyecto de producción en el registro real no se lee ninguna credencial', async () => {
  let tokenRead = false;
  await assert.rejects(withProductionProject(async () => {}, { withToken: async () => { tokenRead = true; } }), /todavía no tiene un proyecto/);
  assert.equal(tokenRead, false);
});

test('con el registro activo, la guardia mira organización, proyecto y marca antes de prestar la conexión', async () => {
  const api = fakeApi();
  const seen = await withProductionProject(async ({ target: t }) => t.ref, { registry: ACTIVE, withToken: api.withToken, fetchImpl: api.fetchImpl });
  assert.equal(seen, target.ref);
  assert.ok(api.calls[0].includes('/organizations/'));
  assert.ok(api.calls[1].endsWith(`/projects/${target.ref}`));
});

test('una organización gratuita o una base sin la marca de producción cortan antes de la acción', async () => {
  let ran = false;
  const free = fakeApi({ plan: 'free' });
  await assert.rejects(withProductionProject(async () => { ran = true; }, { registry: ACTIVE, withToken: free.withToken, fetchImpl: free.fetchImpl }), /plan gratuito/);
  const unmarked = fakeApi({ marker: [] });
  await assert.rejects(withProductionProject(async () => { ran = true; }, { registry: ACTIVE, withToken: unmarked.withToken, fetchImpl: unmarked.fetchImpl }), /marca de producción/);
  const otherBase = fakeApi({ marker: [{ project_ref: 'ixewllzzuzpqrkxzmfzx', environment: 'production' }] });
  await assert.rejects(withProductionProject(async () => { ran = true; }, { registry: ACTIVE, withToken: otherBase.withToken, fetchImpl: otherBase.fetchImpl }), /marca de producción/);
  assert.equal(ran, false);
});

test('cada migración va en su transacción, con el libro de producción, la pausa de los cron y su SHA', () => {
  const plan = recoveryPlan();
  const migration = plan.migrations.at(-1);
  const sql = fs.readFileSync(migration.path, 'utf8');
  const tx = productionMigrationTransaction(migration, sql);
  assert.match(tx, /^begin;/);
  assert.match(tx, new RegExp(`insert into ${LEDGER_TABLE.replace('.', '\\.')}\\(version,sha256\\) values\\('${migration.version}','${migration.sha256}'\\)`));
  assert.match(tx, /cron\.alter_job\(j\.jobid, active := false\)/);
  assert.match(tx, /commit;$/);
  assert.throws(() => productionMigrationTransaction(migration, sql + '\n-- cambiado'), /differ from the reviewed manifest/);
  assert.equal(sha256(Buffer.from(sql)), migration.sha256);
});

test('el primer despliegue crea la marca de producción con el ref, nunca con otro entorno', () => {
  const sql = productionBootstrapSql(target.ref);
  assert.match(sql, new RegExp(`insert into ${MARKER_TABLE.replace('.', '\\.')}\\(project_ref, environment\\) values\\('${target.ref}', 'production'\\)`));
  assert.match(sql, /check \(environment = 'production'\)/);
  assert.throws(() => productionBootstrapSql("x'; drop table y; --"), /ref inválido/);
});

test('sólo se aplica lo posterior al libro, y el libro tiene que ser un prefijo exacto', () => {
  const plan = recoveryPlan();
  const ledger = plan.migrations.slice(0, -1).map(({ version, sha256: hash }) => ({ version, sha256: hash }));
  const pending = pendingMigrations(plan, ledger, ledger.map((row) => row.version));
  assert.deepEqual(pending.map((m) => m.version), [plan.migrations.at(-1).version]);
  assert.throws(() => pendingMigrations(plan, [{ ...ledger[0], sha256: '0'.repeat(64) }, ...ledger.slice(1)], ledger.map((r) => r.version)), /changed SQL/);
  assert.throws(() => pendingMigrations(plan, ledger, ledger.slice(1).map((r) => r.version)), /differs from the production ledger/);
});

test('la línea de comandos sin proyecto de producción sale 2 y no toca nada; un comando desconocido también', () => {
  for (const argv of [['status'], ['migrations', '--apply', '--confirm', 'x'], ['nada']]) {
    const run = spawnSync(process.execPath, ['scripts/production/deploy.mjs', ...argv], { encoding: 'utf8', env: { ...process.env, TABA_ENVIRONMENTS_FILE: '' } });
    assert.equal(run.status, 2, `${argv.join(' ')}: ${run.stderr}`);
  }
});
