import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_NAME, IMAGE, IMAGE_DIGEST, NAME_PATTERN, parseArgs } from '../scripts/db/dev-database.mjs';

test('la base de desarrollo sólo acepta contenedores descartables con el nombre del gate', () => {
  assert.equal(parseArgs(['start']).name, DEFAULT_NAME);
  assert.match(DEFAULT_NAME, NAME_PATTERN);
  assert.equal(parseArgs(['start', '--name', 'taba-a1-a4-local-otra']).name, 'taba-a1-a4-local-otra');
  for (const bad of ['supabase_db_la-taba', 'postgres', 'taba-a1-a4-local-', 'taba-a1-a4-local-x;rm']) {
    assert.throws(() => parseArgs(['start', '--name', bad]), /taba-a1-a4-local-\*/, bad);
  }
});

test('los comandos y sus argumentos se validan antes de tocar Docker', () => {
  assert.throws(() => parseArgs([]), /uso:/);
  assert.throws(() => parseArgs(['reset']), /uso:/);
  assert.throws(() => parseArgs(['start', '--until', '2026']), /14 dígitos/);
  assert.equal(parseArgs(['start', '--until', '20261003090000']).until, '20261003090000');
  assert.throws(() => parseArgs(['test']), /al menos un archivo/);
  assert.deepEqual(parseArgs(['test', '--name', 'taba-a1-a4-local-dev', 'a_test.sql', 'b_test.sql']).files, ['a_test.sql', 'b_test.sql']);
});

test('la imagen es la del gate, por el mismo digest', () => {
  const runner = fs.readFileSync(new URL('../scripts/run-release-v5-db.mjs', import.meta.url), 'utf8');
  assert.ok(runner.includes(`const image='${IMAGE}'`), 'misma imagen que scripts/run-release-v5-db.mjs');
  assert.ok(runner.includes(`const imageDigest='${IMAGE_DIGEST}'`), 'mismo digest que scripts/run-release-v5-db.mjs');
});
