// CERTIFICACIÓN E-COMMERCE — entorno, límites y evidencia.
//
// Todo lo que decide CONTRA QUÉ se corre y QUÉ se puede tocar vive acá:
//
//   · hay TRES destinos y cada uno tiene su confirmación, su prefijo de corrida y su
//     lista de adónde puede ir una request:
//       staging  el proyecto Supabase `la-taba-staging` y nada más;
//       local    el PostgREST real delante de un PostgreSQL local (`local-target.mjs`);
//       stack    el stack efímero de `supabase start` en loopback (`stack-target.mjs`);
//   · los proyectos conocidos que NO son de esta herramienta están prohibidos en duro
//     en los tres, y cualquier URL fuera del destino se rechaza ANTES de salir;
//   · los negocios que usan otras personas están protegidos: una request que los
//     nombre no sale, sea lectura o escritura;
//   · cada corrida crea y usa SU PROPIO negocio, y toda escritura queda acotada a los
//     negocios que la corrida creó: el resguardo de tenant rechaza cualquier otro;
//   · `service_role` sólo prepara y limpia ese tenant y sus usuarios, o hace la llamada
//     que en producción hace una Edge Function con esa clave; cada uso queda anotado
//     (propósito, acción, hora) antes de ejecutarse;
//   · la verdad de la base la lee un OBSERVADOR de sólo lectura, nunca `service_role`;
//   · ningún secreto llega a la evidencia: se registran y se borran de todo lo que se
//     escribe, junto con rutas de disco locales y cadenas con forma de token.
//
// El runner no se bifurca: lo que cambia entre un destino y otro vive en UN objeto
// (`STAGING_TARGET` acá abajo, los otros dos en sus archivos) y todos los resguardos
// de esta página valen para los tres.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { leerTokenDelCli } from '../../lib/supabase-cli-token.mjs';
import { loadTargetKeys } from '../../controlled-production/target-keys.mjs';

// ── Destino ──────────────────────────────────────────────────────────────────
export const STAGING_REF = 'ucbtjcurawxjwjdvvcvj';
export const STAGING_PROJECT_NAME = 'la-taba-staging';
export const STAGING_URL = `https://${STAGING_REF}.supabase.co`;
export const MANAGEMENT_HOST = 'api.supabase.com';
export const FORBIDDEN_REFS = Object.freeze(['tkanbadcglszlcyfjvpv', 'wwcpogltfgzgkrlilbcd', 'yakhtrkukqlgzvxuvhzs',
  'ygqbcvxdrewcnzedfcyo', 'enznqfzhikpasjzpvjfd']);
// Negocios que NO son de esta herramienta: el de las certificaciones de otra persona y
// el negocio inerte que traen las migraciones. No se nombran en ninguna request.
export const PROTECTED_BUSINESS_IDS = Object.freeze(['a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0',
  '00000000-0000-4000-8000-000000000001']);
export const EXPECTED_BASELINE = Object.freeze({ minMigrations: 158, baselineHead: '20261001010000' });
// Lo que sirve Staging, leído el 2026-10-02: la versión de PostgREST y la configuración de roles. Los destinos
// que no son Staging se comparan contra esto: sin la misma traducción de errores a estados HTTP y sin los
// mismos `statement_timeout`, lo que pase en ellos no dice nada de Staging.
export const STAGING_POSTGREST_VERSION = '14.5';
export const STAGING_ROLE_SETTINGS = Object.freeze({ anon: Object.freeze(['statement_timeout=3s']), authenticated: Object.freeze(['statement_timeout=8s']),
  authenticator: Object.freeze(['lock_timeout=8s', 'statement_timeout=8s']) });

// Cada destino tiene SU confirmación: la de uno no habilita una corrida en otro, así un
// comando copiado de un destino no escribe en el que no era.
export const CONFIRMATIONS = Object.freeze({ staging: 'STAGING_MUTATION_OK', local: 'LOCAL_MUTATION_OK', stack: 'STACK_MUTATION_OK' });
export const TARGET_KINDS = Object.freeze(Object.keys(CONFIRMATIONS));
// El prefijo de corrida también es de cada destino: una carpeta de evidencia de un
// destino no se puede continuar ni reconciliar contra otro.
export const RUN_ID_PREFIXES = Object.freeze({ staging: 'ecom-cert-', local: 'ecom-cert-local-', stack: 'ecom-cert-stack-' });
export const RUN_ID_PATTERNS = Object.freeze({ staging: /^ecom-cert-[0-9]{8}-[0-9]{6}$/, local: /^ecom-cert-local-[0-9]{8}-[0-9]{6}$/,
  stack: /^ecom-cert-stack-[0-9]{8}-[0-9]{6}$/ });

// Lo que NO depende de la corrida. El nombre, el slug y el prefijo de correo del tenant
// salen de `tenantIdentity`: cada corrida tiene el suyo.
export const TENANT = Object.freeze({
  emailDomain: 'example.invalid',
  currency: 'ARS',
  timezone: 'America/Argentina/Buenos_Aires',
  address: 'Avenida Certificacion 100, Neuquen Capital',
  // Prefijo de TODA clave de pedido y de checkout que crea el certificador: una fila
  // del tenant sin este prefijo no es nuestra y frena la corrida.
  requestPrefix: 'ecomcert-',
  appVersion: 'taba-ecom-cert',
});
// El tenant de las corridas anteriores a «un negocio por corrida». Sólo se vuelve a
// usar si alguien lo pide por su slug (`--reuse-tenant`).
export const LEGACY_TENANT = Object.freeze({ slug: 'qa-ecom-cert', name: 'QA ECOM CERT · no público', emailPrefix: 'qa-ecom-cert-' });
// Cómo se llama el negocio de cada destino. En Staging el nombre lo fijó el dueño:
// TABA_ECOMMERCE_FINAL_<fecha>_<hora>.
export const TENANT_NAME_PREFIXES = Object.freeze({ staging: 'TABA_ECOMMERCE_FINAL_', local: 'TABA_ECOMMERCE_LOCAL_', stack: 'TABA_ECOMMERCE_STACK_' });
const GENERATED_TENANT_SLUG = /^taba-ecommerce-(final|local|stack)-([0-9]{8})-([0-9]{6})$/;
const TENANT_SLUG = /^[a-z0-9][a-z0-9-]{2,47}$/;

// Quién es el tenant de una corrida: nombre, slug y el prefijo de correo de TODAS sus
// identidades. Sale del destino y del id de corrida; con `slug` (y `name`) se describe
// un tenant pedido a mano. El prefijo de correo es función del slug: reusar un tenant
// encuentra a sus operadores sin que nadie guarde nada.
export function tenantIdentity({ kind, runId, slug = null, name = null }) {
  if (!TARGET_KINDS.includes(kind)) throw Error(`UNKNOWN_TARGET:${kind}`);
  let identity;
  if (slug) {
    const wanted = String(slug).trim().toLowerCase();
    if (!TENANT_SLUG.test(wanted)) throw Error('TENANT_SLUG_INVALID');
    const generated = GENERATED_TENANT_SLUG.exec(wanted);
    identity = wanted === LEGACY_TENANT.slug ? { ...LEGACY_TENANT }
      : generated ? { slug: wanted, name: wanted.toUpperCase().replaceAll('-', '_'), emailPrefix: `ecomcert-${generated[2]}${generated[3]}-` }
        : { slug: wanted, name: null, emailPrefix: `${wanted}-` };
    if (name) identity.name = String(name).trim();
    if (!identity.name) throw Error('TENANT_NAME_REQUIRED_FOR_A_CUSTOM_SLUG');
  } else {
    if (!RUN_ID_PATTERNS[kind].test(String(runId || ''))) throw Error('RUN_ID_INVALID_FOR_TARGET');
    const [date, time] = String(runId).slice(RUN_ID_PREFIXES[kind].length).split('-');
    const generatedName = name ? String(name).trim() : `${TENANT_NAME_PREFIXES[kind]}${date}_${time}`;
    identity = { slug: `${TENANT_NAME_PREFIXES[kind].toLowerCase().replaceAll('_', '-')}${date}-${time}`, name: generatedName,
      emailPrefix: `ecomcert-${date}${time}-` };
  }
  if (identity.name.length < 3 || identity.name.length > 80) throw Error('TENANT_NAME_INVALID');
  const email = (local) => `${identity.emailPrefix}${local}@${TENANT.emailDomain}`;
  return Object.freeze({ ...identity,
    // Operadores y pagadores: persistentes, uno por rol y por tenant.
    operatorEmail: (label) => email(`op-${label}`),
    // Identidades de UNA corrida (clientes, extraños): se borran al terminar.
    runUserEmail: (label) => email(`u-${String(label).replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 22)}-${shortId(2)}`),
    operatorEmailPattern: `${identity.emailPrefix}op-%`,
    emailPattern: `${identity.emailPrefix}%@${TENANT.emailDomain}`,
    // El segundo negocio de la corrida (privacidad): mismo prefijo, su propia rama.
    second: Object.freeze({ slug: `${identity.slug}-b`, name: `${identity.name}${identity.name === LEGACY_TENANT.name ? ' B' : '_B'}`, ownerEmail: email('op-b-owner') }),
    throwawaySlugPrefix: `${identity.slug}-x-` });
}

export const CLIENT_OPTIONS = Object.freeze({ auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const sha = (value) => createHash('sha256').update(String(value)).digest('hex');
// Lo que DICE un token de sesión (sin verificar la firma: eso lo hace el backend). Sirve para afirmar sobre los
// claims que emite Auth: `is_anonymous`, `session_id`, `role`.
export function jwtClaims(token) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return null; }
}
export const nowIso = () => new Date().toISOString();
export const rowOf = (data) => (Array.isArray(data) ? data[0] : data);
export const sqlText = (value) => `'${String(value).replaceAll("'", "''")}'`;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const sqlUuid = (value) => {
  if (!UUID.test(String(value))) throw Error('SQL_UUID_INVALID');
  return `'${String(value).toLowerCase()}'::uuid`;
};
export const sqlUuidList = (values) => (values.length ? values.map(sqlUuid).join(',') : "'00000000-0000-0000-0000-000000000000'::uuid");

// ── Resguardo de destino ─────────────────────────────────────────────────────
export function assertNoForbiddenRef(text) {
  const haystack = String(text ?? '');
  for (const ref of FORBIDDEN_REFS) {
    if (haystack.includes(ref)) throw Error(`FORBIDDEN_REF:${ref}`);
  }
  return true;
}

export function assertAllowedUrl(input) {
  const text = String(input?.url ?? input ?? '');
  assertNoForbiddenRef(text);
  let url;
  try { url = new URL(text); } catch { throw Error('TARGET_URL_INVALID'); }
  if (url.protocol !== 'https:') throw Error('TARGET_NOT_HTTPS');
  if (url.hostname === `${STAGING_REF}.supabase.co`) return url;
  if (url.hostname === MANAGEMENT_HOST) {
    if (!(url.pathname === `/v1/projects/${STAGING_REF}` || url.pathname.startsWith(`/v1/projects/${STAGING_REF}/`))) {
      throw Error('MANAGEMENT_PATH_NOT_STAGING');
    }
    return url;
  }
  throw Error(`TARGET_HOST_NOT_ALLOWED:${url.hostname}`);
}

// De la Management API sólo se usa: la identidad del proyecto (GET) y el
// observador SQL de sólo lectura (POST). Nada que cambie el proyecto.
export function assertManagementRequest(method, pathname) {
  const verb = String(method || 'GET').toUpperCase();
  const base = `/v1/projects/${STAGING_REF}`;
  if (verb === 'GET' && pathname === base) return true;
  if (verb === 'POST' && pathname === `${base}/database/query/read-only`) return true;
  throw Error(`MANAGEMENT_CALL_NOT_ALLOWED:${verb}:${pathname}`);
}

export function assertNoProtectedBusiness(text) {
  const haystack = String(text ?? '').toLowerCase();
  for (const id of PROTECTED_BUSINESS_IDS) {
    if (haystack.includes(id)) throw Error(`PROTECTED_BUSINESS_REFERENCED:${id.slice(0, 8)}`);
  }
  return true;
}

// TODA request de la corrida pasa por acá, también las del SDK. Los resguardos están
// separados del envío porque el destino local los aplica igual antes de contestar sin
// salir de la máquina: una request que Staging rechazaría tampoco corre en local.
export function assertGuardedRequest(input, init = {}) {
  const url = assertAllowedUrl(input);
  const method = String(init?.method || input?.method || 'GET').toUpperCase();
  if (url.hostname === MANAGEMENT_HOST) assertManagementRequest(method, url.pathname);
  assertNoProtectedBusiness(url.href);
  if (typeof init?.body === 'string') assertNoProtectedBusiness(init.body);
  return url;
}
export async function guardedFetch(input, init = {}) {
  assertGuardedRequest(input, init);
  return fetch(input, init);
}
// Un resguardo que frenó una request (destino, negocio protegido, tenant, salida de la máquina) no es una
// respuesta del backend: corta la corrida, no se anota como un fallo de red. `fetch` envuelve en `cause`
// lo que falla al conectar.
const GUARD_STOP = /^(FORBIDDEN_REF|PROTECTED_BUSINESS|WRITE_OUTSIDE|TARGET_|LOCAL_TARGET_|STACK_TARGET_|EGRESS_REFUSED|NETWORK_ORIGIN_)/;
export const isGuardStop = (error) => GUARD_STOP.test(String(error?.message)) || GUARD_STOP.test(String(error?.cause?.message));

// El resguardo de tenant: una escritura lleva un negocio que ESTA corrida creó o no sale.
export function createTenantGuard(tenantId) {
  if (!UUID.test(String(tenantId || ''))) throw Error('TENANT_ID_REQUIRED');
  const own = String(tenantId).toLowerCase();
  if (PROTECTED_BUSINESS_IDS.includes(own)) throw Error('TENANT_CANNOT_BE_A_PROTECTED_BUSINESS');
  const decoys = new Set();
  const adopted = new Set();
  return Object.freeze({
    tenantId: own,
    // Un uuid al azar para pruebas negativas («negocio inexistente»): nunca puede
    // coincidir con un negocio real y es el único id ajeno que se admite.
    decoy() { const id = randomUUID(); decoys.add(id); return id; },
    registerDecoy(id) { decoys.add(String(id).toLowerCase()); return id; },
    // Otro negocio que creó ESTA corrida (el segundo negocio de la fase de privacidad). Se
    // puede escribir en él igual que en el tenant: es nuestro. Un negocio protegido, nunca.
    adopt(id) {
      const business = String(id ?? '').toLowerCase();
      if (!UUID.test(business)) throw Error('TENANT_ID_REQUIRED');
      if (PROTECTED_BUSINESS_IDS.includes(business)) throw Error('PROTECTED_BUSINESS_WRITE_REFUSED');
      adopted.add(business);
      return id;
    },
    owns: (id) => String(id ?? '').toLowerCase() === own || adopted.has(String(id ?? '').toLowerCase()),
    assertWrite(businessId, { allowDecoy = false } = {}) {
      const id = String(businessId ?? '').toLowerCase();
      if (PROTECTED_BUSINESS_IDS.includes(id)) throw Error('PROTECTED_BUSINESS_WRITE_REFUSED');
      if (id === own || adopted.has(id)) return true;
      if (allowDecoy && decoys.has(id)) return true;
      throw Error('WRITE_OUTSIDE_TENANT_REFUSED');
    },
    // Recorre los parámetros de una RPC buscando un negocio declarado.
    assertParams(params, options = {}) {
      const seen = [];
      const visit = (value, key) => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          for (const [k, v] of Object.entries(value)) visit(v, k);
        } else if (typeof value === 'string' && /^(p_)?business_id$/.test(key || '')) {
          seen.push(value);
        }
      };
      visit(params, '');
      for (const id of seen) this.assertWrite(id, options);
      return seen.length;
    },
  });
}

// ── Secretos y redacción ─────────────────────────────────────────────────────
const REDACTED_KEYS = new Set(['access_token', 'refresh_token', 'provider_token', 'password', 'tracking_token', 'delivery_code',
  'x-order-token', 'apikey', 'authorization', 'jwt', 'secret']);
const TOKEN_SHAPES = [
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}/g,
  /\bsbp_[A-Za-z0-9]{20,}/g,
  new RegExp(['\\b(?:APP_USR|TE', 'ST)-[A-Za-z0-9_-]{20,}'].join(''), 'g'),
  // Una URL de base con su contraseña adentro (el destino stack recibe una).
  /\bpostgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/g,
];
const LOCAL_PATH_SHAPES = [
  new RegExp(['(?<![A-Za-z0-9_.-])[A-Za-z]', ':[\\\\/][^\\s`"\'<>|]+'].join(''), 'g'),
  new RegExp(['(?<![A-Za-z0-9_.:/-])\\/(?:Us', 'ers|ho', 'me)\\/[^\\s`"\'<>|]+'].join(''), 'g'),
];

export function createRedactor() {
  const secrets = new Set();
  const secret = (value) => { if (value !== null && value !== undefined && String(value).length >= 4) secrets.add(String(value)); return value; };
  const scrub = (input) => {
    let text = String(input ?? '');
    // Los más largos primero: un secreto que contiene a otro no deja medio valor a la vista.
    for (const s of [...secrets].sort((a, b) => b.length - a.length)) {
      if (text.includes(s)) text = text.split(s).join(`<redacted:${sha(s).slice(0, 10)}>`);
    }
    for (const shape of TOKEN_SHAPES) text = text.replace(shape, '<redacted-token>');
    for (const shape of LOCAL_PATH_SHAPES) text = text.replace(shape, '<local-path>');
    return text;
  };
  const redact = (value) => scrub(JSON.stringify(value, (key, v) => (REDACTED_KEYS.has(String(key).toLowerCase()) && v !== null && v !== undefined ? '<redacted>' : v), 2));
  return { secret, scrub, redact, size: () => secrets.size };
}

// ── Checks y veredictos ──────────────────────────────────────────────────────
// Un check es PASS o FAIL. Los otros tres veredictos son de lo que NO se probó, cada uno
// con su motivo escrito: el contrato no está desplegado, la pieza no existe en el destino
// local, o este destino no puede probarlo. Ninguno tapa un fallo: un check que falla por
// un hallazgo registrado y abierto sigue siendo FAIL.
export const VERDICTS = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', SKIPPED: 'SKIPPED_NOT_DEPLOYED',
  NOT_AVAILABLE_LOCALLY: 'SKIPPED_NOT_AVAILABLE_LOCALLY', NOT_AVAILABLE_ON_TARGET: 'SKIPPED_NOT_AVAILABLE_ON_TARGET', NOT_RUN: 'NOT_RUN' });
const UNAVAILABLE = Object.freeze([VERDICTS.NOT_AVAILABLE_LOCALLY, VERDICTS.NOT_AVAILABLE_ON_TARGET]);
const UNDECIDED = Object.freeze([VERDICTS.SKIPPED, ...UNAVAILABLE]);
export const isSkip = (result) => UNDECIDED.includes(result);
// El veredicto de «este destino no lo puede probar». El destino local conserva el suyo de siempre.
export const unavailableVerdict = (kind) => (kind === 'local' ? VERDICTS.NOT_AVAILABLE_LOCALLY : VERDICTS.NOT_AVAILABLE_ON_TARGET);

export function createRecorder({ log = () => {}, targetKind = 'local' } = {}) {
  const checks = [];
  const skipped = new Map();
  const clip = (value) => { const text = JSON.stringify(value); return text && text.length > 320 ? `${text.slice(0, 320)}…` : text; };
  const unavailable = (phase, name, reason, verdict) => {
    checks.push({ phase, name, result: verdict, expected: null, observed: { not_available: reason, ...(verdict === VERDICTS.NOT_AVAILABLE_LOCALLY ? { not_available_locally: reason } : {}) }, at: nowIso() });
    log(`N/A  [${phase}] ${name} (este destino no lo prueba: ${reason})`);
    return false;
  };
  return {
    checks,
    // `blocking: false` sólo lo usa el preflight de un destino para un hecho de FIDELIDAD (la versión de PostgREST,
    // los tiempos límite de los roles…): si falla es un FAIL como cualquier otro —cuenta y cambia el código de
    // salida—, pero la corrida sigue, porque todo lo demás que mida también sirve para entender la diferencia.
    check(phase, name, pass, observed = null, expected = null, { blocking = true } = {}) {
      const entry = { phase, name, result: pass ? VERDICTS.PASS : VERDICTS.FAIL, expected, observed, at: nowIso(), ...(blocking ? {} : { blocking: false }) };
      checks.push(entry);
      log(`${entry.result} [${phase}] ${name}${pass ? '' : ` -> ${clip(observed)}`}${!pass && !blocking ? ' (no frena la corrida)' : ''}`);
      return Boolean(pass);
    },
    // Lo que frena una corrida en el preflight: cualquier FAIL que no se declaró como hecho de fidelidad.
    blockingFailures(phase) { return checks.filter((c) => c.phase === phase && c.result === VERDICTS.FAIL && c.blocking !== false); },
    // Un check que depende de un contrato que todavía no está desplegado: ni PASS ni FAIL.
    skipCheck(phase, name, capability) {
      checks.push({ phase, name, result: VERDICTS.SKIPPED, expected: null, observed: { capability_absent: capability }, at: nowIso() });
      log(`SKIP [${phase}] ${name} (falta ${capability})`);
      return false;
    },
    // Un check sobre una pieza de la plataforma que el destino local no tiene (GoTrue, Cloudflare,
    // Edge Functions, el planificador). Nunca PASS: lo que contesta ahí es utilería de esta herramienta.
    skipLocally(phase, name, reason) { return unavailable(phase, name, reason, VERDICTS.NOT_AVAILABLE_LOCALLY); },
    // Lo mismo, para cualquier destino: la corrida dice qué no pudo probar y por qué.
    skipOnTarget(phase, name, reason) { return unavailable(phase, name, reason, unavailableVerdict(targetKind)); },
    // Una compuerta que todavía no tiene contra qué compararse: la de rendimiento, sin umbrales versionados para
    // este destino. No es PASS ni FAIL: se midió, el motivo queda escrito y el resumen lo lista entre lo no probado.
    notGated(phase, name, reason) {
      checks.push({ phase, name, result: VERDICTS.SKIPPED, expected: null, observed: { capability_absent: 'performance_thresholds', reason }, at: nowIso() });
      log(`SKIP [${phase}] ${name} (${reason})`);
      return false;
    },
    skipPhase(phase, missing) {
      skipped.set(phase, [].concat(missing));
      log(`SKIP fase ${phase}: contrato no desplegado (${[].concat(missing).join(', ')})`);
    },
    dropPhase(phase) {
      for (let i = checks.length - 1; i >= 0; i -= 1) if (checks[i].phase === phase) checks.splice(i, 1);
      skipped.delete(phase);
    },
    restore(previous = [], previousSkipped = {}) {
      for (const entry of previous) checks.push(entry);
      for (const [phase, missing] of Object.entries(previousSkipped)) skipped.set(phase, missing);
    },
    skippedPhases: () => Object.fromEntries(skipped),
    verdict(phase) {
      if (skipped.has(phase)) return VERDICTS.SKIPPED;
      const own = checks.filter((c) => c.phase === phase);
      const decided = own.filter((c) => !UNDECIDED.includes(c.result));
      if (!own.length) return VERDICTS.NOT_RUN;
      if (!decided.length) {
        const kinds = [...new Set(own.map((c) => c.result))];
        return kinds.length === 1 ? kinds[0] : kinds.every((kind) => UNAVAILABLE.includes(kind)) ? VERDICTS.NOT_AVAILABLE_ON_TARGET : VERDICTS.SKIPPED;
      }
      return decided.every((c) => c.result === VERDICTS.PASS) ? VERDICTS.PASS : VERDICTS.FAIL;
    },
    counts(phase) {
      const own = checks.filter((c) => !phase || c.phase === phase);
      const of = (result) => own.filter((c) => c.result === result).length;
      return { checks: own.length, pass: of(VERDICTS.PASS), fail: of(VERDICTS.FAIL), skipped: of(VERDICTS.SKIPPED),
        notAvailableLocally: of(VERDICTS.NOT_AVAILABLE_LOCALLY), notAvailableOnTarget: of(VERDICTS.NOT_AVAILABLE_ON_TARGET) };
    },
  };
}

// Por qué no se probó cada check salteado, en palabras: es lo que el resumen lista.
export function skipReason(check) {
  if (check.result === VERDICTS.SKIPPED) {
    return `contrato no desplegado: ${check.observed?.capability_absent ?? 'desconocido'}${check.observed?.reason ? ` — ${check.observed.reason}` : ''}`;
  }
  return String(check.observed?.not_available ?? check.observed?.not_available_locally ?? 'sin motivo anotado');
}

// LA REGLA DE SALIDA. El proceso termina en 0 sólo si ningún check falló, ninguna fase
// pedida quedó sin correr y no hubo un error fatal. Un salteo con su motivo no cambia el
// código; un FAIL siempre.
export function exitCodeFor({ failed = 0, fatal = null, notRun = 0 } = {}) {
  return failed > 0 || Boolean(fatal) || notRun > 0 ? 1 : 0;
}

// ── Capacidades (contratos que pueden no estar desplegados todavía) ──────────
export const CAPABILITY_SQL = `select json_build_object(
  'order_intake_guard', to_regprocedure('private.order_intake_guard(public.businesses,uuid,text,bigint,text,text)') is not null
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'businesses' and column_name = 'order_intake_guard_mode'),
  'service_status', to_regprocedure('public.get_business_service_status(uuid,timestamptz)') is not null,
  'customer_cancel', to_regprocedure('public.cancel_own_order(uuid,text,text)') is not null,
  'order_expiry', to_regprocedure('public.expire_unattended_manual_orders(integer)') is not null,
  'cancel_republish', to_regprocedure('private.release_order_inventory(uuid)') is not null,
  'order_trace', to_regprocedure('public.get_order_trace(uuid,text)') is not null,
  'ecommerce_health', to_regprocedure('public.get_ecommerce_health()') is not null,
  'catalog_stock_authority', to_regclass('public.catalog_change_batches') is not null,
  'enforcement_lock', exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.set_service_enforcement(uuid,boolean,boolean,boolean,text)')
    and p.prosrc like '%ENFORCEMENT_LOCKED%'),
  'delivery_coverage_gate', to_regprocedure('public.guard_verified_business_delivery_coverage()') is not null,
  'opening_rules_gate', exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.platform_verify_business_ordering(uuid,text,text,integer,text)')
    and p.prosrc like '%verification_blockers%'),
  'checkout_payments', to_regprocedure('public.create_checkout_session(uuid,jsonb)') is not null
    and to_regprocedure('public.prepare_mercadopago_preference_v2(uuid,uuid,boolean)') is not null
    and to_regprocedure('public.record_mercadopago_preference_created_v2(uuid,text,uuid,uuid,uuid,text,text,text,text,text,text)') is not null
    and to_regprocedure('public.record_mercadopago_payment_snapshot(uuid,jsonb,text,uuid)') is not null
    and to_regprocedure('public.finalize_paid_checkout_session(uuid)') is not null,
  'payment_refunds', to_regprocedure('public.prepare_payment_refund_v2(uuid,numeric,uuid,text)') is not null
    and to_regprocedure('public.record_payment_refund_identity(uuid,uuid,text,uuid,text)') is not null
    and to_regprocedure('public.record_payment_refund_response_v2(uuid,text,text,numeric,text)') is not null,
  'business_self_delivery', to_regprocedure('public.confirm_business_delivery_code(uuid,bigint,text,text)') is not null,
  'operational_alerts', to_regprocedure('public.refresh_operational_alerts(uuid)') is not null,
  'tracking_revocation', to_regprocedure('public.revoke_public_tracking(uuid)') is not null
) as capabilities`;
export const CAPABILITY_NAMES = Object.freeze(['order_intake_guard', 'service_status', 'customer_cancel', 'order_expiry',
  'cancel_republish', 'order_trace', 'ecommerce_health', 'catalog_stock_authority', 'enforcement_lock', 'delivery_coverage_gate', 'opening_rules_gate',
  'checkout_payments', 'payment_refunds', 'business_self_delivery', 'operational_alerts', 'tracking_revocation']);

export function normalizeCapabilities(raw = {}) {
  return Object.freeze(Object.fromEntries(CAPABILITY_NAMES.map((name) => [name, raw?.[name] === true])));
}
export const missingCapabilities = (requires = [], capabilities = {}) => requires.filter((name) => capabilities[name] !== true);

// Decide si una fase corre: si falta un contrato, queda SKIPPED_NOT_DEPLOYED y no se ejecuta.
export async function runGatedPhase(phase, ctx) {
  const missing = missingCapabilities(phase.requires || [], ctx.caps || {});
  if (missing.length) {
    ctx.rec.skipPhase(phase.id, missing);
    return { id: phase.id, ran: false, verdict: VERDICTS.SKIPPED, missing };
  }
  await phase.run(ctx);
  return { id: phase.id, ran: true, verdict: ctx.rec.verdict(phase.id), missing: [] };
}

// ── Evidencia y ledger durable ───────────────────────────────────────────────
export function createEvidence(directory, redactor) {
  const dir = path.resolve(directory);
  const safeName = (name) => { if (!/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(name)) throw Error('EVIDENCE_NAME_INVALID'); return name; };
  return {
    dir,
    write(name, data) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, safeName(name)), `${redactor.redact(data)}\n`);
    },
    writeText(name, text) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, safeName(name)), redactor.scrub(text));
    },
    read(name) {
      const file = path.join(dir, safeName(name));
      return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    },
  };
}

export function createLedger({ runId, evidence, target = STAGING_TARGET, identity = null }) {
  const ledger = { runId, startedAt: nowIso(), target: { kind: target.kind, label: target.label, ref: target.project.ref,
    tenantSlug: identity?.slug ?? null, tenantName: identity?.name ?? null, tenantId: null, tenantReused: false },
  invocations: [], anonymousSignIns: 0, serviceRoleUses: [], databaseInterventions: [], users: [], sessions: [], orders: [], checkouts: [],
  tenantChanges: [], businesses: [] };
  const persist = () => {
    evidence.write('created-resources.json', ledger);
    evidence.write('service-role-uses.json', { runId: ledger.runId, uses: ledger.serviceRoleUses, databaseInterventions: ledger.databaseInterventions });
  };
  return { ledger, persist };
}

// ── Observador de base de datos (sólo lectura) ───────────────────────────────
const TRANSIENT = /HTTP_(429|5\d\d)|fetch failed|timeout|aborted|ECONNRESET|ENOTFOUND|EAI_AGAIN|UND_ERR|terminated/i;
export function createObserver({ token, fetchImpl = guardedFetch, minGapMs = 120, log = () => {} }) {
  let last = 0;
  let chain = Promise.resolve();
  const stats = { calls: 0, retries: 0 };
  const once = async (pathname, init) => {
    const wait = last + minGapMs - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const res = await fetchImpl(`https://${MANAGEMENT_HOST}${pathname}`, {
      ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(90_000) });
    const text = await res.text();
    if (!res.ok) {
      const error = Error(`MGMT_HTTP_${res.status}:${pathname.split('?')[0]}:${text.slice(0, 240)}`);
      error.retryAfter = Number(res.headers.get('retry-after')) || 0;
      throw error;
    }
    return text ? JSON.parse(text) : null;
  };
  const call = (pathname, init = {}) => {
    const task = async () => {
      for (let attempt = 1; ; attempt += 1) {
        try {
          stats.calls += 1;
          return await once(pathname, init);
        } catch (error) {
          if (attempt >= 6 || !TRANSIENT.test(`${error.name} ${error.message} ${error.cause?.code || ''}`)) throw error;
          stats.retries += 1;
          const pause = Math.max(1500 * attempt, (error.retryAfter || 0) * 1000);
          log(`observador: reintento ${attempt} en ${pause} ms (${String(error.message).slice(0, 60)})`);
          await sleep(pause);
        }
      }
    };
    // En serie: el presupuesto de la Management API es compartido.
    const result = chain.then(task, task);
    chain = result.catch(() => {});
    return result;
  };
  return {
    stats,
    project: () => call(`/v1/projects/${STAGING_REF}`, { method: 'GET' }),
    observe: (sql) => call(`/v1/projects/${STAGING_REF}/database/query/read-only`, { method: 'POST', body: JSON.stringify({ query: sql }) }),
  };
}

// ── Lo que un destino puede NO tener ─────────────────────────────────────────
// Las piezas por las que una fase le pregunta al destino antes de afirmar algo. `lacks(pieza)`
// devuelve el motivo por el que ESE destino no puede probarla, o null si puede. Una pieza mal
// escrita lanza: un salteo nunca nace de un error de tipeo.
export const PLATFORM_PIECES = Object.freeze(['gotrue', 'cloudflare', 'gateway', 'edge_functions', 'scheduler',
  'origin_choice', 'database_ownership', 'environment_ownership', 'edge_function_probes', 'webhook_receipts', 'hosted_deployment']);
export function lacksFrom(reasons) {
  return (piece) => {
    if (!PLATFORM_PIECES.includes(piece)) throw Error(`UNKNOWN_PLATFORM_PIECE:${piece}`);
    return reasons[piece] ?? null;
  };
}

// Cuánta carga admite cada destino en la fase de rendimiento. Staging es compartido: nunca más
// de 30 en vuelo ni más de 3000 requests de carga por corrida.
export const LOAD_PROFILES = Object.freeze({
  staging: Object.freeze({ levels: Object.freeze([10, 30]), baselineSamples: 15, requestsPerLevel: (level) => Math.max(level, 30), maxConcurrency: 30,
    budget: 3000, payers: 10, note: 'Staging es compartido: el nivel 100 no se corre ahí' }),
  local: Object.freeze({ levels: Object.freeze([10, 30, 100]), baselineSamples: 30, requestsPerLevel: (level) => Math.max(level, 40), maxConcurrency: 100,
    budget: 12000, payers: 100, note: null }),
  stack: Object.freeze({ levels: Object.freeze([10, 30, 100]), baselineSamples: 30, requestsPerLevel: (level) => Math.max(level, 40), maxConcurrency: 100,
    budget: 12000, payers: 100, note: null }),
});

// ── Destino de la corrida ────────────────────────────────────────────────────
// Staging, el destino de siempre. Todo lo que el runner le pregunta al destino está acá:
// con qué `fetch` sale cada request, de dónde vienen las credenciales, qué se afirma de
// la identidad del entorno y cómo se llaman sus corridas. Los otros dos destinos arman
// un objeto con esta misma forma.
export const STAGING_TARGET = Object.freeze({
  kind: 'staging',
  label: STAGING_PROJECT_NAME,
  environment: 'STAGING',
  confirmation: CONFIRMATIONS.staging,
  runIdPrefix: RUN_ID_PREFIXES.staging,
  runIdPattern: RUN_ID_PATTERNS.staging,
  // La base de las URL que arman los clientes (el transporte propio y supabase-js).
  baseUrl: STAGING_URL,
  apiUrl: STAGING_URL,
  project: Object.freeze({ ref: STAGING_REF, name: STAGING_PROJECT_NAME }),
  // El presupuesto de la Management API es compartido: las lecturas del observador van espaciadas.
  observerGapMs: 120,
  // El límite del endpoint de tokens es por dirección de red y esa dirección la comparte otra persona.
  signInGapMs: 800,
  defaultMaxMinutes: 30,
  load: LOAD_PROFILES.staging,
  fetch: guardedFetch,
  guard: assertGuardedRequest,
  // Qué NO puede probar Staging (motivo) o null. Las piezas de plataforma están todas; lo que falta es
  // lo que sólo se puede hacer siendo dueño del entorno.
  lacks: lacksFrom({
    origin_choice: 'en Staging el origen de red lo pone Cloudflare: es uno solo, el de la máquina que corre, y no se elige',
    database_ownership: 'la base de Staging no es de esta herramienta: no puede envejecer una fila ni tocar el planificador, y los plazos reales son de 5 y 15 minutos',
    environment_ownership: 'Staging es compartido: el estado de sus componentes no depende sólo de esta corrida',
    edge_function_probes: 'las Edge Functions de Staging tienen la configuración real del proveedor de pagos: esta herramienta no las llama',
    webhook_receipts: 'un recibo de webhook en Staging lo levantaría el worker real de pagos y dispararía la alerta de firma',
  }),
  // La dirección de red con la que una request llega al backend la pone Cloudflare: desde acá no se elige.
  canChooseOrigin: false,
  fromOrigin() { throw Error('NETWORK_ORIGIN_CANNOT_BE_CHOSEN_ON_STAGING'); },
  originOf() { throw Error('NETWORK_ORIGIN_CANNOT_BE_CHOSEN_ON_STAGING'); },
  // Encabezados que el transporte agrega por el origen: en Staging, ninguno (los pone el borde).
  originHeaders(origin = null) { if (origin) throw Error('NETWORK_ORIGIN_CANNOT_BE_CHOSEN_ON_STAGING'); return {}; },
  // Conexión directa y con escritura a la base: Staging no la tiene.
  database: null,
  bindRun() {},
  // La request tal como viaja cuando se manda por un socket propio (corte de respuesta): en Staging, la misma.
  wire: (url, headers) => ({ url, headers }),
  async loadCredentials({ redactor, requireSecret }) {
    const token = redactor.secret(leerTokenDelCli());
    const keys = await loadTargetKeys('staging', { requireSecret });
    if (keys.ref !== STAGING_REF || keys.url !== STAGING_URL) throw Error('KEYS_NOT_BOUND_TO_STAGING');
    assertAllowedUrl(keys.url);
    redactor.secret(keys.secret);
    redactor.secret(keys.publishable);
    return { token, keys };
  },
  createObserver: ({ token, log }) => createObserver({ token, log, fetchImpl: guardedFetch, minGapMs: 120 }),
  // Identidad del entorno, sin escrituras. Devuelve cómo está el libro de migraciones contra el repo (`ledger`)
  // y, si el destino los tiene, sus hechos propios (`facts`), para la evidencia.
  async assertIdentity({ check, project, db, repoLedger, keys }) {
    check('MGMT_PROJECT_IS_LA_TABA_STAGING', project?.name === STAGING_PROJECT_NAME && (project.ref ?? project.id) === STAGING_REF,
      { name: project?.name, ref: project?.ref ?? project?.id, status: project?.status });
    check('KEYS_BOUND_TO_STAGING_REF', keys.ref === STAGING_REF && keys.url === STAGING_URL
      && FORBIDDEN_REFS.every((ref) => !keys.url.includes(ref)), { ref: keys.ref });
    check('OBSERVER_IS_READ_ONLY_ROLE', db.usr === 'supabase_read_only_user', { user: db.usr });
    const staging = db.ledger || [];
    const unknownOnTarget = staging.filter((entry) => !repoLedger.includes(entry));
    const notDeployed = repoLedger.filter((entry) => !staging.includes(entry));
    // Staging puede ir detrás del repo (migraciones de esta misión todavía sin aplicar),
    // pero no puede tener nada que el repo no conozca ni huecos en el medio.
    const isPrefix = staging.every((entry, index) => repoLedger[index] === entry);
    check('STAGING_LEDGER_IS_KNOWN_TO_THE_REPO', unknownOnTarget.length === 0 && isPrefix && db.migrations >= EXPECTED_BASELINE.minMigrations,
      { staging: db.migrations, repo: repoLedger.length, head: db.head, unknownOnStaging: unknownOnTarget, notDeployedYet: notDeployed });
    return { ledger: { notDeployedYet: notDeployed, unknownOnStaging: unknownOnTarget }, facts: null };
  },
  // Lo que se afirma al terminar sobre adónde fueron las requests. En Staging el resguardo es `guardedFetch` mismo.
  assertContainment() {},
  async close() {},
});

// ── Entorno de la corrida ────────────────────────────────────────────────────
// `tag` marca cada línea cuando el destino no es Staging: una corrida local no se confunde con una real.
export function createLogger(redactor, tag = '') {
  return (message) => process.stderr.write(`[${nowIso().slice(11, 19)}]${tag ? ` ${tag}` : ''} ${redactor.scrub(message)}\n`);
}

export async function loadEnvironment({ redactor, log, requireSecret = true, target = STAGING_TARGET }) {
  const { token, keys } = await target.loadCredentials({ redactor, requireSecret });
  // El observador es del destino: en Staging (y en local, por su `fetch`) el endpoint de sólo lectura de la
  // Management API; en el stack, una conexión directa de sólo lectura.
  const observer = target.createObserver ? target.createObserver({ token, log })
    : createObserver({ token, log, fetchImpl: target.fetch, minGapMs: target.observerGapMs });
  const newClient = (headers = {}) => createClient(target.baseUrl, keys.publishable, { ...CLIENT_OPTIONS, global: { headers, fetch: target.fetch } });
  return { target, keys, observer, observe: observer.observe, newClient };
}

// `provision` / `cleanup`: preparar y limpiar el tenant y sus usuarios. `platform-read`: una lectura que sólo
// tiene la plataforma (la salud). `edge-function`: la llamada que en producción hace una Edge Function con su
// cliente de servicio (el checkout de Mercado Pago, el asiento de un pago): acá no hay otra forma de hacerla.
export const SERVICE_ROLE_PURPOSES = Object.freeze(['provision', 'cleanup', 'platform-read', 'edge-function']);
export function createServiceRole({ keys, ledger, persist, target = STAGING_TARGET }) {
  let admin = null;
  const assertUsable = (purpose) => {
    if (!SERVICE_ROLE_PURPOSES.includes(purpose)) throw Error(`SERVICE_ROLE_PURPOSE_NOT_ALLOWED:${purpose}`);
    if (!keys?.secret) throw Error('SERVICE_ROLE_KEY_NOT_LOADED');
  };
  async function serviceRole(purpose, action, task) {
    assertUsable(purpose);
    const entry = { purpose, action, at: nowIso(), ok: null };
    ledger.serviceRoleUses.push(entry);
    persist();   // anotado ANTES de usarse
    admin ||= createClient(target.baseUrl, keys.secret, { ...CLIENT_OPTIONS, global: { fetch: target.fetch } });
    const t0 = Date.now();
    try {
      const out = await task(admin);
      entry.ok = true;
      return out;
    } catch (error) {
      entry.ok = false;
      entry.error = String(error?.message || error).slice(0, 160);
      throw error;
    } finally {
      entry.ms = Date.now() - t0;
      persist();
    }
  }
  // Un LOTE de llamadas iguales por el transporte propio (el que mide y anota cada respuesta): se anota una
  // vez, antes, con cuántas son. Una fila por llamada de carga serían miles de escrituras del ledger.
  serviceRole.announce = (purpose, action, calls = 1) => {
    assertUsable(purpose);
    const entry = { purpose, action, at: nowIso(), ok: null, calls, transport: 'own' };
    ledger.serviceRoleUses.push(entry);
    persist();
    return (ok = true, note = null) => { entry.ok = Boolean(ok); if (note) entry.note = String(note).slice(0, 160); };
  };
  // Las llamadas que en producción hace una Edge Function, contadas por fase y por función: la primera de cada
  // par queda anotada antes de salir y las siguientes suman a esa misma fila.
  serviceRole.meter = (purpose, phaseOf = () => 'run') => {
    assertUsable(purpose);
    const entries = new Map();
    return (fn) => {
      const key = `${phaseOf()}:${fn}`;
      if (!entries.has(key)) {
        const entry = { purpose, action: `rpc ${fn} (${phaseOf()})`, at: nowIso(), ok: true, calls: 0, transport: 'own' };
        ledger.serviceRoleUses.push(entry);
        entries.set(key, entry);
        persist();
      }
      entries.get(key).calls += 1;
    };
  };
  return serviceRole;
}

// ── Identificadores de corrida ───────────────────────────────────────────────
export function newRunId(now = new Date(), prefix = STAGING_TARGET.runIdPrefix) {
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `${prefix}${stamp.slice(0, 8)}-${stamp.slice(8)}`;
}
export const RUN_ID_PATTERN = STAGING_TARGET.runIdPattern;
export const randomPassword = () => `${randomBytes(24).toString('base64url')}aA1!`;
export const randomToken = () => randomBytes(32).toString('base64url');
export function shortId(bytes = 4) { return randomBytes(bytes).toString('hex'); }

// ── Reloj del tenant ─────────────────────────────────────────────────────────
// Hora de pared en el huso del comercio, para armar grillas que incluyan o
// excluyan «ahora» sin depender del huso de la máquina que corre.
export function localClock(timezone, at = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' }).formatToParts(at).map((p) => [p.type, p.value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, weekday, minutes };
}
export const hhmm = (minutes) => {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
// Una misma franja para los siete días.
export const weeklyGrid = (opensAt, closesAt) => Array.from({ length: 7 }, (_, weekday) => ({ weekday, opens_at: opensAt, closes_at: closesAt }));
export const GRID_24X7 = Object.freeze(weeklyGrid('00:00', '24:00'));
// ¿La franja [abre, cierra) contiene el minuto local, contando el cruce de medianoche?
export function windowContains(opensMin, closesMin, nowMin) {
  if (opensMin === closesMin) return false;
  if (opensMin < closesMin) return nowMin >= opensMin && nowMin < closesMin;
  return nowMin >= opensMin || nowMin < closesMin;
}
// El instante (ISO, UTC) de una hora de pared en un huso. La fase de estado del servicio le pregunta a la base
// por instantes elegidos, no por «ahora»: así los bordes de una franja se prueban sin esperar al reloj.
export function instantAt(timezone, date, time) {
  const [year, month, day] = String(date).split('-').map(Number);
  const [hour, minute, second = 0] = String(time).split(':').map(Number);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  // Cuánto se corre el huso respecto de UTC en ese instante (dos pasadas cubren un cambio de horario).
  const offsetAt = (instant) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) - instant;
  };
  let instant = asUtc - offsetAt(asUtc);
  instant = asUtc - offsetAt(instant);
  return new Date(instant).toISOString();
}
// La fecha (AAAA-MM-DD) a `days` días de otra.
export const dateAfter = (date, days) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
