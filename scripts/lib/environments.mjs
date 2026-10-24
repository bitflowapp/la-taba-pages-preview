/*
 * Los entornos de La Taba, leídos de UN solo lugar: deploy/environments.json.
 *
 * POR QUÉ EXISTE
 * --------------
 * El ref del proyecto de producción vivía escrito a mano en más de veinte
 * guiones, en la función de Mercado Pago, en el flujo de release y en la app del
 * repartidor. Ese proyecto ya no existe (verificado el 23/10/2026: ausente del
 * listado de proyectos y sin DNS), y cada uno de esos lugares seguía apuntando a
 * él: el armado del sitio productivo derivaba el runtime-config hacia una base
 * borrada y sólo se enteraba el smoke, DESPUÉS de publicar.
 *
 * Acá vive una sola vez, con dos reglas:
 *
 *   · mientras `environments.production.status` no sea `active`, todo lo que
 *     pida el destino de producción recibe un error claro y sale sin tocar nada
 *     (código `PRODUCTION_NOT_PROVISIONED`);
 *   · ningún ref puede estar en dos entornos, ni ser a la vez activo y retirado
 *     o ajeno. La validación corre en cada lectura, no sólo en las pruebas.
 *
 * Activar producción es UN cambio revisable: scripts/production/bind-production.mjs
 * completa el registro y el binding de las funciones, y CI tiene que pasar sobre
 * ese SHA.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REGISTRY_PATH = registryPath();

// Las pruebas pueden leer un registro con producción activa, y SÓLO desde tests/fixtures/: un registro alternativo
// en cualquier otro lugar sería una forma de apuntar las herramientas de producción a otra base sin un PR.
function registryPath() {
  const fallback = path.join(ROOT, 'deploy', 'environments.json');
  const override = process.env.TABA_ENVIRONMENTS_FILE;
  if (!override) return fallback;
  const resolved = path.resolve(override);
  if (!resolved.startsWith(path.join(ROOT, 'tests', 'fixtures') + path.sep)) {
    throw new Error('TABA_ENVIRONMENTS_FILE sólo puede apuntar a un registro de tests/fixtures/');
  }
  return resolved;
}

const REF = /^[a-z]{20}$/;
const ORIGIN = /^https:\/\/[a-z0-9.-]+(?::\d+)?$/;

export class ProductionNotProvisionedError extends Error {
  constructor(status) {
    super('Producción todavía no tiene un proyecto de Supabase (deploy/environments.json: '
      + `production.status = ${status}). No se toca nada. Para activarla: `
      + 'node scripts/production/bind-production.mjs (ver docs/audit/commercial-readiness-20261023/ENTORNOS.md).');
    this.name = 'ProductionNotProvisionedError';
    this.code = 'PRODUCTION_NOT_PROVISIONED';
  }
}

/** Lee y valida el registro. Un registro inconsistente nunca se devuelve. */
export function readEnvironments(file = REGISTRY_PATH) {
  const registry = JSON.parse(fs.readFileSync(file, 'utf8'));
  validateEnvironments(registry);
  return registry;
}

/** Devuelve la lista de problemas; vacía = consistente. */
export function environmentProblems(registry) {
  const problems = [];
  if (registry?.schemaVersion !== 1) problems.push('schemaVersion debe ser 1');
  const envs = registry?.environments || {};
  for (const name of ['development', 'qa', 'production']) {
    if (!envs[name]) problems.push(`falta el entorno ${name}`);
  }
  const retired = Object.keys(registry?.retiredSupabaseRefs || {});
  const foreign = Object.keys(registry?.foreignSupabaseRefs || {});
  for (const ref of [...retired, ...foreign]) if (!REF.test(ref)) problems.push(`ref inválido en las listas: ${ref}`);
  for (const ref of retired) if (foreign.includes(ref)) problems.push(`${ref} no puede ser retirado y ajeno a la vez`);

  const owners = new Map();
  for (const [name, env] of Object.entries(envs)) {
    const ref = env?.supabase?.ref ?? null;
    if (ref === null) continue;
    if (!REF.test(ref)) problems.push(`${name}: ref inválido ${ref}`);
    if (retired.includes(ref)) problems.push(`${name}: usa el ref retirado ${ref}`);
    if (foreign.includes(ref)) problems.push(`${name}: usa el ref ajeno ${ref}`);
    if (owners.has(ref)) problems.push(`${ref} está en ${owners.get(ref)} y en ${name}`);
    owners.set(ref, name);
  }

  const qa = envs.qa || {};
  if (qa.status === 'active' && !qa.supabase?.ref) problems.push('qa activo sin ref');
  if (qa.realMoney !== false || qa.mercadoPago?.environment !== 'test') problems.push('qa sólo puede mover dinero ficticio');

  const production = envs.production || {};
  if (!['not_provisioned', 'provisioned', 'active'].includes(production.status)) {
    problems.push(`production.status desconocido: ${production.status}`);
  }
  if (production.mercadoPago?.environment !== 'production' || production.realMoney !== true) {
    problems.push('production debe declarar Mercado Pago productivo y dinero real');
  }
  if (production.mercadoPago?.applicationId === qa.mercadoPago?.applicationId) {
    problems.push('producción y QA no pueden compartir la aplicación de Mercado Pago');
  }
  if (!ORIGIN.test(production.web?.origin || '')) problems.push('production.web.origin inválido');
  if (production.status === 'not_provisioned') {
    if (production.supabase?.ref !== null) problems.push('production sin aprovisionar no puede tener ref');
  } else if (!production.supabase?.ref || !production.supabase?.organizationId || !production.supabase?.plan) {
    problems.push('production aprovisionada requiere ref, organización y plan');
  } else if (production.supabase.plan === 'free') {
    problems.push('production no puede vivir en el plan gratuito (pausa por inactividad, sin copias gestionadas)');
  } else if (production.supabase.organizationId === qa.supabase?.organizationId) {
    problems.push('production no puede compartir organización con QA');
  }
  return problems;
}

export function validateEnvironments(registry) {
  const problems = environmentProblems(registry);
  if (problems.length) throw new Error(`deploy/environments.json inconsistente: ${problems.join('; ')}`);
  return registry;
}

export function retiredRefs(registry = readEnvironments()) {
  return new Set(Object.keys(registry.retiredSupabaseRefs || {}));
}

export function foreignRefs(registry = readEnvironments()) {
  return new Set(Object.keys(registry.foreignSupabaseRefs || {}));
}

/** Refs que una herramienta de un entorno NUNCA debe tocar: retirados, ajenos y los de los otros entornos. */
export function forbiddenRefsFor(environment, registry = readEnvironments()) {
  const refs = new Set([...retiredRefs(registry), ...foreignRefs(registry)]);
  for (const [name, env] of Object.entries(registry.environments)) {
    if (name !== environment && env?.supabase?.ref) refs.add(env.supabase.ref);
  }
  return refs;
}

export function qaTarget(registry = readEnvironments()) {
  const qa = registry.environments.qa;
  return Object.freeze({
    ref: qa.supabase.ref,
    supabaseUrl: `https://${qa.supabase.ref}.supabase.co`,
    origin: qa.web.origin,
    mercadoPagoApplicationId: qa.mercadoPago.applicationId,
  });
}

/**
 * El destino de producción, o ProductionNotProvisionedError. `allowProvisioned`
 * deja pasar un proyecto creado y todavía no abierto al público (para cargarlo y
 * probarlo sin dinero); por defecto se exige `active`.
 */
export function productionTarget({ registry = readEnvironments(), allowProvisioned = false } = {}) {
  const production = registry.environments.production;
  const ok = production.status === 'active' || (allowProvisioned && production.status === 'provisioned');
  if (!ok) throw new ProductionNotProvisionedError(production.status);
  const ref = production.supabase.ref;
  return Object.freeze({
    status: production.status,
    ref,
    supabaseUrl: `https://${ref}.supabase.co`,
    supabaseHost: `${ref}.supabase.co`,
    organizationId: production.supabase.organizationId,
    plan: production.supabase.plan,
    region: production.supabase.region,
    businessId: production.businessId,
    origin: production.web.origin,
    pagesProject: production.web.pagesProject,
    pagesBranch: production.web.pagesBranch,
    mercadoPagoApplicationId: production.mercadoPago.applicationId,
  });
}

/** Para guiones de línea de comandos: el destino o un mensaje y salida 2, sin traza. */
export function productionTargetOrExit(options = {}) {
  try {
    return productionTarget(options);
  } catch (error) {
    if (error?.code !== 'PRODUCTION_NOT_PROVISIONED') throw error;
    console.error(`::error::${error.message}`);
    process.exit(2);
  }
}

/** ¿El ref es uno que ninguna herramienta debería volver a usar? */
export function isRetiredOrForeignRef(ref, registry = readEnvironments()) {
  return retiredRefs(registry).has(ref) || foreignRefs(registry).has(ref);
}
