// La activación del proyecto de producción (scripts/production/bind-production.mjs), probada sobre una COPIA de
// los archivos que toca. Nada de esto crea proyectos ni sale a la red.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { FILES, planBinding } from '../scripts/production/bind-production.mjs';
import { environmentProblems, productionTarget } from '../scripts/lib/environments.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NEW_REF = 'nuevaproduccionrefaa';
const ORG = 'lunasystemsfixtureor';
const AT = '2026-11-01T12:00:00.000Z';

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taba-bind-'));
  for (const file of Object.values(FILES)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, file), path.join(dir, file));
  }
  return dir;
}
const digestOf = (dir) => Object.values(FILES).map((file) => createHash('sha256').update(fs.readFileSync(path.join(dir, file))).digest('hex')).join(',');

test('el binding deja producción aprovisionada en el registro y en cada lugar que no puede leerlo', () => {
  const dir = sandbox();
  const { files, cache } = planBinding({ root: dir, ref: NEW_REF, organizationId: ORG, plan: 'pro', at: AT });

  const registry = JSON.parse(files[FILES.registry]);
  assert.deepEqual(environmentProblems(registry), []);
  const target = productionTarget({ registry, allowProvisioned: true });
  assert.equal(target.ref, NEW_REF);
  assert.equal(target.plan, 'pro');
  assert.throws(() => productionTarget({ registry }), /todavía no tiene/, 'aprovisionada no es abierta al público');

  const seller = files[FILES.sellerOauth];
  assert.match(seller, new RegExp(`^ {2}${NEW_REF}: \\{\\n {4}deployment: "production",`, 'm'));
  assert.match(seller, new RegExp(`clientId: "7677852968049976",\\n {4}supabaseUrl: "https://${NEW_REF}\\.supabase\\.co"`));
  assert.match(seller, /allowedOrigins: "https:\/\/la-taba\.pages\.dev",\n {2}\},\n\};/);

  for (const file of [FILES.recoveryDeployment, FILES.recoveryPlan, FILES.runtimeConfig]) {
    assert.match(files[file], new RegExp(`'${NEW_REF}'`), `${file} no bloquea el ref de producción`);
  }
  assert.match(files[FILES.recoveryDeployment], new RegExp(`'zvmfdlynnutxquktrgyl', '${NEW_REF}',\\n\\]\\);`), 'respeta la coma final y el salto de línea');
  assert.match(files[FILES.runtimeConfig], new RegExp(`PILOT_FORBIDDEN_SUPABASE_REFS = Object\\.freeze\\(\\[[^\\]]*'${NEW_REF}'\\]\\)`));

  assert.match(cache.to, /^la-taba-runtime-v\d+-production-binding$/);
  assert.match(files[FILES.serviceWorker], new RegExp(`const CACHE_NAME = '${cache.to}';`));
  assert.match(files[FILES.stagingPreflight], new RegExp(`cache: '${cache.to}'`));
  assert.match(files[FILES.wrangler], new RegExp(`\\[env\\.production\\.vars\\][\\s\\S]*SUPABASE_URL = "https://${NEW_REF}\\.supabase\\.co"`));
  assert.match(files[FILES.wrangler], /^SUPABASE_URL = "https:\/\/ixewllzzuzpqrkxzmfzx\.supabase\.co"$/m, 'el reloj de QA no cambia');
  assert.match(files[FILES.riderGradle], new RegExp(`^val productionRef = "${NEW_REF}"$`, 'm'));
  assert.match(files[FILES.riderApi], new RegExp(`BuildConfig\\.BACKEND_REF == "${NEW_REF}"\\)`));
});

test('el binding se niega a QA, a un retirado, a un ajeno, al plan gratuito y a la organización de QA', () => {
  const dir = sandbox();
  const intento = (overrides) => () => planBinding({ root: dir, ref: NEW_REF, organizationId: ORG, plan: 'pro', at: AT, ...overrides });
  assert.throws(intento({ ref: 'ixewllzzuzpqrkxzmfzx' }), /está en qa y en production/);
  assert.throws(intento({ ref: 'wwcpogltfgzgkrlilbcd' }), /retirado/);
  assert.throws(intento({ ref: 'enznqfzhikpasjzpvjfd' }), /ajeno/);
  assert.throws(intento({ plan: 'free' }), /plan gratuito/);
  assert.throws(intento({ organizationId: 'tpdpuvnasszkcpdanxpk' }), /organización con QA/);
  assert.throws(intento({ ref: 'NoEsUnRef' }), /ref inválido/);
});

test('un segundo binding no pisa al primero', () => {
  const dir = sandbox();
  const { files } = planBinding({ root: dir, ref: NEW_REF, organizationId: ORG, plan: 'pro', at: AT });
  for (const [file, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), content);
  assert.throws(() => planBinding({ root: dir, ref: 'otraproduccionrefaaa', organizationId: ORG, plan: 'pro', at: AT }), /ya está provisioned/);
});

test('sin --write el comando sólo muestra el plan y no cambia un byte', () => {
  const dir = sandbox();
  const before = digestOf(dir);
  const run = spawnSync(process.execPath, ['scripts/production/bind-production.mjs', '--root', dir, '--ref', NEW_REF, '--organization', ORG, '--plan', 'pro'],
    { cwd: ROOT, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /PLAN SOLAMENTE/);
  assert.equal(digestOf(dir), before);
});

test('el registro real sigue sin producción: este PR no activa nada', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, FILES.registry), 'utf8'));
  assert.equal(registry.environments.production.status, 'not_provisioned');
});
