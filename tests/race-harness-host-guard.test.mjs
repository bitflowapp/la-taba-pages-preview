// Los arneses de carrera escriben fixtures: sólo pueden correr contra una base local descartable.
// `?host=` (o `hostaddr`) en la URL pisa el host para el cliente de pg, así que una URL que dice
// 127.0.0.1 podía conectar a otra máquina. Cada arnés se tiene que negar ANTES de conectar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HARNESSES = [
  ['scripts/order-intake/intake-race.mjs', 'TABA_LOCAL_INTAKE_DB'],
  ['scripts/order-intake/stock-race.mjs', 'TABA_LOCAL_INTAKE_DB'],
  ['scripts/order-intake/idempotency-race.mjs', 'TABA_LOCAL_INTAKE_DB'],
  ['scripts/print-agent/claim-race.mjs', 'TABA_LOCAL_PRINT_DB'],
];
// 203.0.113.0/24 es TEST-NET-3 (RFC 5737): no enruta a ninguna parte.
const REMOTE_OVERRIDES = [
  'postgres://postgres@127.0.0.1:55999/x?host=203.0.113.7',
  'postgres://postgres@localhost:55999/x?hostaddr=203.0.113.7',
  'postgres://postgres@203.0.113.7:55999/x',
];

for (const [script, flag] of HARNESSES) {
  for (const url of REMOTE_OVERRIDES) {
    test(`${path.basename(script)} se niega a ${url.replace(/^postgres:\/\/postgres@/, '')}`, () => {
      const run = spawnSync(process.execPath, [script, url], {
        cwd: root, encoding: 'utf8', timeout: 20_000, env: { ...process.env, [flag]: '1' },
      });
      assert.notEqual(run.status, 0, 'tenía que negarse');
      assert.match(`${run.stdout}${run.stderr}`, /solo contra una base local descartable/);
      assert.doesNotMatch(`${run.stdout}${run.stderr}`, /ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH/, 'no tiene que llegar a intentar conectar');
    });
  }
}
