// Respaldos de producción y ensayo local de restauración: lo que se puede probar sin red ni base real.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';

import { BACKUP_KEY_NAME, DB_PASSWORD_NAME, productionBackupKey, productionPostgresEnvironment } from '../scripts/production/backup.mjs';
import { localPrelude } from '../scripts/recovery/local-restore-drill.mjs';

const REF = 'tabaprodfixturerefaa';

function store(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    read: (name) => values.get(name) || null,
    save: (name, usuario, secreto) => values.set(name, { usuario, secreto }),
    values,
  };
}

test('la clave de respaldo de producción se crea una vez, atada al ref, y se rechaza la de otro proyecto', () => {
  const vault = store();
  assert.throws(() => productionBackupKey(REF, vault), /no es de este proyecto/, 'sin clave y sin permiso de crear, no hay respaldo');
  const created = productionBackupKey(REF, { ...vault, create: true });
  assert.equal(created.length, 32);
  assert.equal(vault.values.get(BACKUP_KEY_NAME).usuario, REF);
  const again = productionBackupKey(REF, { ...vault, create: true });
  assert.equal(Buffer.compare(created, again), 0, 'no se pisa una clave existente: los respaldos viejos seguirían cifrados con ella');
  assert.throws(() => productionBackupKey('ixewllzzuzpqrkxzmfzx', vault), /no es de este proyecto/);
  const broken = store({ [BACKUP_KEY_NAME]: { usuario: REF, secreto: Buffer.alloc(16).toString('base64') } });
  assert.throws(() => productionBackupKey(REF, broken), /inválida/);
});

test('la conexión de respaldo es TLS verify-full al host del ref y con la contraseña de ESE proyecto', () => {
  const vault = store({ [DB_PASSWORD_NAME]: { usuario: REF, secreto: 'fixture-password' } });
  const env = productionPostgresEnvironment(REF, 'tests/fixtures/ca.crt', vault);
  assert.equal(env.PGHOST, `db.${REF}.supabase.co`);
  assert.equal(env.PGSSLMODE, 'verify-full');
  assert.match(env.PGSSLROOTCERT, /ca\.crt$/);
  assert.throws(() => productionPostgresEnvironment('otroproyectoxxxxxxxx', 'ca.crt', vault), /no es de este proyecto/);
});

test('el ensayo local reemplaza cron, net y Vault, pero las tablas de Storage vienen del respaldo', () => {
  const stubs = fs.readFileSync('scripts/local-db/stubs.sql', 'utf8');
  const prelude = localPrelude(stubs);
  assert.doesNotMatch(prelude, /storage\.(buckets|objects)/);
  assert.match(prelude, /create table vault\.secrets/);
  assert.match(prelude, /create table cron\.job/);
  assert.match(prelude, /create function net\.http_post/);
  assert.match(prelude, /create schema if not exists storage;/, 'el esquema sí, sus tablas no');
});

test('sin proyecto de producción el respaldo no lee ninguna credencial y sale 2', () => {
  const run = spawnSync(process.execPath, ['scripts/production/backup.mjs', '--tools', 'x', '--ca', 'y', '--out', 'z'], {
    encoding: 'utf8', env: { ...process.env, TABA_ENVIRONMENTS_FILE: '' } });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /todavía no tiene un proyecto/);
});
