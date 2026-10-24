/*
 * Activar el proyecto de producción de La Taba: UN cambio revisable.
 *
 * Antes, apuntar La Taba a un proyecto nuevo exigía editar a mano más de veinte
 * archivos, y el proyecto anterior se borró con todos ellos apuntándolo. Ahora
 * casi todo lee deploy/environments.json; lo que no puede leerlo —la función de
 * Mercado Pago (Deno, revisada por diseño), el navegador, el Worker del vigía y
 * la app del repartidor— se actualiza acá, siempre igual:
 *
 *   1. deploy/environments.json                       producción: ref, organización, plan, estado
 *   2. supabase/functions/_shared/seller-oauth.ts      binding de La Taba Delivery para el ref nuevo
 *   3. supabase/functions/_shared/recovery-deployment.ts   QA nunca puede reclamar ese ref
 *   4. scripts/recovery/plan.mjs                       las herramientas de QA tampoco
 *   5. js/core/runtime-config.js                       un piloto no puede apuntar a producción (+ CACHE_NAME)
 *   6. services/scheduler-watchdog/wrangler.toml       el reloj externo de producción
 *   7. apps/rider-android (gradle + RiderApi.kt)       la app del repartidor de producción
 *
 *   node scripts/production/bind-production.mjs --ref <ref> --organization <org> --plan pro
 *        [--origin https://la-taba.pages.dev] [--status provisioned|active] [--verify-remote] [--write]
 *
 * Sin --write sólo muestra el plan. --verify-remote consulta (sólo lectura) la
 * Management API: el proyecto existe, está sano, en sa-east-1, en esa
 * organización y la organización NO es gratuita. Nada de esto crea recursos,
 * carga secretos ni habilita cobros: es el PR de binding del plan de lanzamiento.
 *
 * Salida 0 = plan válido (o escrito). 1 = el destino no pasa. 2 = uso.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { environmentProblems, ROOT } from '../lib/environments.mjs';

const REF = /^[a-z]{20}$/;
export const PRODUCTION_CLIENT_ID = '7677852968049976';

export const FILES = Object.freeze({
  registry: 'deploy/environments.json',
  sellerOauth: 'supabase/functions/_shared/seller-oauth.ts',
  recoveryDeployment: 'supabase/functions/_shared/recovery-deployment.ts',
  recoveryPlan: 'scripts/recovery/plan.mjs',
  runtimeConfig: 'js/core/runtime-config.js',
  serviceWorker: 'sw.js',
  stagingPreflight: 'scripts/preflight-staging-package.mjs',
  wrangler: 'services/scheduler-watchdog/wrangler.toml',
  riderGradle: 'apps/rider-android/app/build.gradle.kts',
  riderApi: 'apps/rider-android/app/src/main/java/com/lataba/rider/RiderApi.kt',
});

function replaceOnce(source, search, replacement, label) {
  const index = source.indexOf(search);
  if (index < 0 || source.indexOf(search, index + search.length) >= 0) {
    throw new Error(`${label}: el texto esperado no aparece exactamente una vez; no se toca nada`);
  }
  return source.slice(0, index) + replacement + source.slice(index + search.length);
}

/** 1. El registro: producción con proyecto. Devuelve el registro nuevo, validado. */
export function bindRegistry(registry, { ref, organizationId, plan, status = 'provisioned', at = new Date().toISOString() }) {
  const next = JSON.parse(JSON.stringify(registry));
  if (next.environments.production.status !== 'not_provisioned') {
    throw new Error(`producción ya está ${next.environments.production.status} con ${next.environments.production.supabase.ref}`);
  }
  Object.assign(next.environments.production, { status });
  Object.assign(next.environments.production.supabase, { ref, organizationId, plan });
  delete next.environments.production.pendingDecisions;
  next.environments.production.boundAt = at;
  const problems = environmentProblems(next);
  if (problems.length) throw new Error(`el registro resultante no es válido: ${problems.join('; ')}`);
  return next;
}

/** 2. El binding de Mercado Pago para el ref nuevo, al final de DEPLOYMENT_BINDINGS. */
export function bindSellerOauth(source, { ref, origin, clientId = PRODUCTION_CLIENT_ID, at }) {
  const start = source.indexOf('const DEPLOYMENT_BINDINGS');
  if (start < 0) throw new Error('seller-oauth.ts: no encontré DEPLOYMENT_BINDINGS');
  if (new RegExp(`^ {2}${ref}: \\{`, 'm').test(source)) throw new Error(`seller-oauth.ts: ${ref} ya tiene binding`);
  const end = source.indexOf('\n};\n', start);
  if (end < 0) throw new Error('seller-oauth.ts: no encontré el cierre de DEPLOYMENT_BINDINGS');
  const entry = [
    `  // PRODUCCIÓN (deploy/environments.json; bind-production.mjs, ${at.slice(0, 10)}): La Taba Delivery en el`,
    '  // proyecto nuevo. Sin los secretos de producción cargados, cada función falla cerrada igual que antes.',
    `  ${ref}: {`,
    '    deployment: "production",',
    '    paymentEnvironment: "production",',
    '    oauthEnvironment: "production",',
    `    clientId: "${clientId}",`,
    `    supabaseUrl: "https://${ref}.supabase.co",`,
    `    panelUrl: "${origin}/",`,
    `    checkoutBaseUrl: "${origin}",`,
    `    allowedOrigins: "${origin}",`,
    '  },',
  ].join('\n');
  return source.slice(0, end) + '\n' + entry + source.slice(end);
}

/** 3–5. Agrega el ref a una lista literal (`[...]`) identificada por su declaración. */
export function addRefToList(source, declaration, ref, label) {
  const start = source.indexOf(declaration);
  if (start < 0) throw new Error(`${label}: no encontré ${declaration}`);
  const close = source.indexOf(']', start);
  const list = source.slice(start, close);
  if (list.includes(`'${ref}'`)) return source;
  // Se inserta después del último elemento, respetando la coma final y el salto de línea antes del cierre.
  const last = source.slice(0, close).replace(/\s*$/, '').length;
  const head = source.slice(0, last);
  const insertion = head.endsWith('[') ? `'${ref}'` : (head.endsWith(',') ? ` '${ref}',` : `, '${ref}'`);
  return head + insertion + source.slice(last);
}

/** 5b. Un archivo precacheado cambió: nueva identidad de release. */
export function bumpCacheName(swSource) {
  const match = swSource.match(/const CACHE_NAME = 'la-taba-runtime-v(\d+)-[a-z0-9-]+';/);
  if (!match) throw new Error('sw.js: CACHE_NAME con forma inesperada');
  const from = match[0].match(/'([^']+)'/)[1];
  const to = `la-taba-runtime-v${Number(match[1]) + 1}-production-binding`;
  return { source: swSource.replace(from, to), from, to };
}

/** 6. El reloj externo de producción. */
export function bindWrangler(source, ref) {
  const header = source.indexOf('[env.production.vars]');
  if (header < 0) throw new Error('wrangler.toml: no encontré [env.production.vars]');
  const tail = source.slice(header);
  const updated = tail.replace(/SUPABASE_URL = "[^"]*"/, `SUPABASE_URL = "https://${ref}.supabase.co"`);
  if (updated === tail) throw new Error('wrangler.toml: no encontré SUPABASE_URL de producción');
  return source.slice(0, header) + updated;
}

/** 7. La app del repartidor: producción ⇔ el ref nuevo, en la compilación y en el chequeo de arranque. */
export function bindRider(gradle, kotlin, { ref }) {
  const gradleNext = gradle.replace(/^val productionRef = "[a-z]{20}"$/m, `val productionRef = "${ref}"`);
  if (gradleNext === gradle && !gradle.includes(`val productionRef = "${ref}"`)) throw new Error('build.gradle.kts: no encontré productionRef');
  const kotlinNext = kotlin.replace(/\(BuildConfig\.TARGET_MODE == "production"\) == \(BuildConfig\.BACKEND_REF == "[a-z]{20}"\)/,
    `(BuildConfig.TARGET_MODE == "production") == (BuildConfig.BACKEND_REF == "${ref}")`);
  if (kotlinNext === kotlin && !kotlin.includes(`BACKEND_REF == "${ref}")`)) throw new Error('RiderApi.kt: no encontré el chequeo de producción');
  return { gradle: gradleNext, kotlin: kotlinNext };
}

/** Todo el plan, en memoria. Devuelve { archivo: contenido nuevo } y la identidad de caché. */
export function planBinding({ root = ROOT, ref, organizationId, plan, status = 'provisioned', origin, at = new Date().toISOString() }) {
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  const registry = JSON.parse(read(FILES.registry));
  const target = origin || registry.environments.production.web.origin;
  if (!REF.test(ref || '')) throw new Error(`ref inválido: ${ref || '(vacío)'}`);
  if (!/^https:\/\/[a-z0-9.-]+$/.test(target)) throw new Error(`origen inválido: ${target}`);
  if (origin) registry.environments.production.web.origin = origin;
  const bound = bindRegistry(registry, { ref, organizationId, plan, status, at });
  const cache = bumpCacheName(read(FILES.serviceWorker));
  const preflight = replaceOnce(read(FILES.stagingPreflight), `cache: '${cache.from}'`, `cache: '${cache.to}'`, 'preflight-staging-package.mjs');
  const rider = bindRider(read(FILES.riderGradle), read(FILES.riderApi), { ref });
  const files = {
    [FILES.registry]: JSON.stringify(bound, null, 2) + '\n',
    [FILES.sellerOauth]: bindSellerOauth(read(FILES.sellerOauth), { ref, origin: target, at }),
    [FILES.recoveryDeployment]: addRefToList(read(FILES.recoveryDeployment), 'RECOVERY_FORBIDDEN_REFS = new Set([', ref, 'recovery-deployment.ts'),
    [FILES.recoveryPlan]: addRefToList(read(FILES.recoveryPlan), 'BLOCKED_REFS = new Set([', ref, 'plan.mjs'),
    [FILES.runtimeConfig]: addRefToList(read(FILES.runtimeConfig), 'PILOT_FORBIDDEN_SUPABASE_REFS = Object.freeze([', ref, 'runtime-config.js'),
    [FILES.serviceWorker]: cache.source,
    [FILES.stagingPreflight]: preflight,
    [FILES.wrangler]: bindWrangler(read(FILES.wrangler), ref),
    [FILES.riderGradle]: rider.gradle,
    [FILES.riderApi]: rider.kotlin,
  };
  return { files, cache, origin: target };
}

async function verifyRemote({ ref, organizationId }) {
  const { conToken } = await import('../lib/supabase-cli-token.mjs');
  return conToken(async (token) => {
    const headers = { Authorization: `Bearer ${token}` };
    const get = async (url) => {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`${url.replace(/^https:\/\/api\.supabase\.com/, '')} contestó ${response.status}`);
      return response.json();
    };
    const project = await get(`https://api.supabase.com/v1/projects/${ref}`);
    const organization = await get(`https://api.supabase.com/v1/organizations/${organizationId}`);
    const problems = [];
    if (project.status !== 'ACTIVE_HEALTHY') problems.push(`estado ${project.status}`);
    if (project.region !== 'sa-east-1') problems.push(`región ${project.region}`);
    if (project.organization_id !== organizationId) problems.push('pertenece a otra organización');
    if (String(organization.plan || '').toLowerCase() === 'free') problems.push('la organización está en el plan gratuito');
    return { project: { ref, name: project.name, region: project.region, status: project.status }, plan: organization.plan, problems };
  });
}

async function main() {
  const args = process.argv.slice(2);
  const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const root = path.resolve(value('--root') || ROOT);
  const ref = value('--ref');
  const organizationId = value('--organization');
  const plan = value('--plan');
  const status = value('--status') || 'provisioned';
  if (!ref || !organizationId || !plan) {
    console.error('uso: bind-production.mjs --ref <ref> --organization <org> --plan <plan> [--origin <url>] [--status provisioned|active] [--verify-remote] [--write]');
    process.exit(2);
  }
  let result;
  try {
    result = planBinding({ root, ref, organizationId, plan, status, origin: value('--origin') });
  } catch (error) {
    console.error(`NO SE PUEDE: ${error.message}`);
    process.exit(1);
  }
  if (args.includes('--verify-remote')) {
    const remote = await verifyRemote({ ref, organizationId });
    console.log(`proyecto remoto: ${JSON.stringify(remote.project)} · plan ${remote.plan}`);
    if (remote.problems.length) {
      console.error(`NO SE PUEDE: ${remote.problems.join('; ')}`);
      process.exit(1);
    }
  }
  console.log(`binding de producción → ${ref} (${status}) · origen ${result.origin} · caché ${result.cache.from} → ${result.cache.to}`);
  for (const file of Object.keys(result.files)) console.log(`  ${args.includes('--write') ? 'escribe' : 'cambiaría'}  ${file}`);
  if (!args.includes('--write')) {
    console.log('\nPLAN SOLAMENTE. Con --write se escriben los archivos y se vuelve a firmar la identidad de release.');
    return;
  }
  for (const [file, content] of Object.entries(result.files)) fs.writeFileSync(path.join(root, file), content, 'utf8');
  execFileSync(process.execPath, ['scripts/check-release-identity.mjs', '--write'], { cwd: root, stdio: 'inherit' });
  console.log(`
Siguiente (ver docs/audit/commercial-readiness-20261023/ENTORNOS.md §Activación):
  1. npm test (incluye tests/environments-registry.test.mjs) y npm run test:webhook
  2. PR con este cambio; CI verde del SHA exacto; revisión humana
  3. recién después: migraciones, funciones y secretos con las herramientas de producción`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`NO SE PUEDE: ${error.message}`); process.exit(1); });
}
