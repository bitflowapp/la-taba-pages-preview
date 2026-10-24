// El registro de entornos (deploy/environments.json) y las listas que tienen que coincidir con él.
//
// Antes de este registro el ref de producción estaba copiado a mano en más de veinte lugares y TODOS seguían
// apuntando a un proyecto borrado. Estas pruebas atan cada lista de bloqueo y cada binding al registro: si alguien
// agrega un proyecto en un lado y no en el otro, falla acá y no en producción.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  ProductionNotProvisionedError,
  environmentProblems,
  forbiddenRefsFor,
  productionTarget,
  qaTarget,
  readEnvironments,
} from '../scripts/lib/environments.mjs';

const registry = readEnvironments();
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const clone = () => JSON.parse(JSON.stringify(registry));
const retired = Object.keys(registry.retiredSupabaseRefs);
const foreign = Object.keys(registry.foreignSupabaseRefs);

test('el registro versionado es consistente y producción todavía no existe', () => {
  assert.deepEqual(environmentProblems(registry), []);
  assert.equal(registry.environments.production.status, 'not_provisioned');
  assert.equal(registry.environments.production.supabase.ref, null);
  assert.throws(() => productionTarget({ registry }), (error) => {
    assert.ok(error instanceof ProductionNotProvisionedError);
    assert.equal(error.code, 'PRODUCTION_NOT_PROVISIONED');
    assert.match(error.message, /bind-production\.mjs/);
    return true;
  });
});

test('QA del registro es el mismo proyecto y la misma aplicación que su recibo y que el binding de las funciones', () => {
  const receipt = JSON.parse(read('deploy/recovery-free-hosted.json'));
  const qa = qaTarget(registry);
  assert.equal(qa.ref, receipt.projectRef);
  assert.equal(registry.environments.qa.supabase.organizationId, receipt.organizationId);
  assert.equal(qa.mercadoPagoApplicationId, receipt.mercadoPagoApplicationId);
  assert.match(read('supabase/functions/_shared/recovery-deployment.ts'),
    new RegExp(`RECOVERY_TEST_APPLICATION_ID = '${qa.mercadoPagoApplicationId}'`));
});

test('todo ref retirado o ajeno está bloqueado en las funciones y en las herramientas de QA', () => {
  const edge = read('supabase/functions/_shared/recovery-deployment.ts');
  const plan = read('scripts/recovery/plan.mjs');
  for (const ref of [...retired, ...foreign]) {
    assert.match(edge, new RegExp(`'${ref}'`), `RECOVERY_FORBIDDEN_REFS no bloquea ${ref}`);
    assert.match(plan, new RegExp(`'${ref}'`), `BLOCKED_REFS no bloquea ${ref}`);
  }
});

test('los bindings de Mercado Pago sólo conocen refs retirados (fijos de prueba, inertes) o el de producción del registro', () => {
  const source = read('supabase/functions/_shared/seller-oauth.ts');
  const block = source.slice(source.indexOf('const DEPLOYMENT_BINDINGS'), source.indexOf('};', source.indexOf('const DEPLOYMENT_BINDINGS')));
  const refs = [...block.matchAll(/^ {2}([a-z]{20}): \{/gm)].map((m) => m[1]);
  assert.ok(refs.length >= 4, 'no se pudo leer DEPLOYMENT_BINDINGS');
  const production = registry.environments.production.supabase.ref;
  for (const ref of refs) {
    assert.ok(retired.includes(ref) || ref === production, `binding de ${ref}: no es producción ni está retirado`);
  }
  if (production) assert.ok(refs.includes(production), 'producción activada sin binding de Mercado Pago');
});

test('un piloto del navegador no puede apuntar a QA, a producción ni a un proyecto retirado de producción', () => {
  const source = read('js/core/runtime-config.js');
  const list = source.match(/PILOT_FORBIDDEN_SUPABASE_REFS = Object\.freeze\(\[([^\]]*)\]\)/);
  assert.ok(list, 'falta la lista PILOT_FORBIDDEN_SUPABASE_REFS');
  const refs = [...list[1].matchAll(/'([a-z]{20})'/g)].map((m) => m[1]);
  const required = [registry.environments.qa.supabase.ref, 'wwcpogltfgzgkrlilbcd', 'ucbtjcurawxjwjdvvcvj', 'yakhtrkukqlgzvxuvhzs'];
  if (registry.environments.production.supabase.ref) required.push(registry.environments.production.supabase.ref);
  for (const ref of required) assert.ok(refs.includes(ref), `el piloto podría apuntar a ${ref}`);
});

test('las herramientas de un entorno tienen prohibidos los demás entornos, los retirados y los ajenos', () => {
  const forProduction = forbiddenRefsFor('production', registry);
  assert.ok(forProduction.has(registry.environments.qa.supabase.ref));
  for (const ref of [...retired, ...foreign]) assert.ok(forProduction.has(ref));
  assert.equal(forbiddenRefsFor('qa', registry).has(registry.environments.qa.supabase.ref), false);
});

test('la validación rechaza los registros que mezclan entornos', () => {
  const withRetiredQa = clone();
  withRetiredQa.environments.qa.supabase.ref = retired[0];
  assert.match(environmentProblems(withRetiredQa).join(' '), /retirado/);

  const shared = clone();
  Object.assign(shared.environments.production, { status: 'provisioned' });
  Object.assign(shared.environments.production.supabase, { ref: shared.environments.qa.supabase.ref, organizationId: 'aaaaaaaaaaaaaaaaaaaa', plan: 'pro' });
  assert.match(environmentProblems(shared).join(' '), /está en qa y en production/);

  const free = clone();
  Object.assign(free.environments.production, { status: 'provisioned' });
  Object.assign(free.environments.production.supabase, { ref: 'abcdefghijabcdefghij', organizationId: 'aaaaaaaaaaaaaaaaaaaa', plan: 'free' });
  assert.match(environmentProblems(free).join(' '), /plan gratuito/);

  const sameOrg = clone();
  Object.assign(sameOrg.environments.production, { status: 'provisioned' });
  Object.assign(sameOrg.environments.production.supabase, { ref: 'abcdefghijabcdefghij', organizationId: sameOrg.environments.qa.supabase.organizationId, plan: 'pro' });
  assert.match(environmentProblems(sameOrg).join(' '), /organización con QA/);

  const qaMoney = clone();
  qaMoney.environments.qa.realMoney = true;
  assert.match(environmentProblems(qaMoney).join(' '), /dinero ficticio/);

  const sameApp = clone();
  sameApp.environments.production.mercadoPago.applicationId = sameApp.environments.qa.mercadoPago.applicationId;
  assert.match(environmentProblems(sameApp).join(' '), /aplicación de Mercado Pago/);

  const refWithoutProject = clone();
  refWithoutProject.environments.production.supabase.ref = 'abcdefghijabcdefghij';
  assert.match(environmentProblems(refWithoutProject).join(' '), /sin aprovisionar no puede tener ref/);
});

test('con producción aprovisionada el destino sale del registro y no de una constante', () => {
  const ready = clone();
  Object.assign(ready.environments.production, { status: 'provisioned' });
  Object.assign(ready.environments.production.supabase, { ref: 'abcdefghijabcdefghij', organizationId: 'aaaaaaaaaaaaaaaaaaaa', plan: 'pro' });
  assert.deepEqual(environmentProblems(ready), []);
  assert.throws(() => productionTarget({ registry: ready }), /PRODUCTION_NOT_PROVISIONED|todavía no tiene/,
    'aprovisionada no es abierta: por defecto se exige active');
  const target = productionTarget({ registry: ready, allowProvisioned: true });
  assert.equal(target.supabaseUrl, 'https://abcdefghijabcdefghij.supabase.co');
  assert.equal(target.mercadoPagoApplicationId, '7677852968049976');
  assert.equal(target.businessId, '00000000-0000-4000-8000-000000000001');
});
