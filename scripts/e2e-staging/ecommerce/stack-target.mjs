// CERTIFICACIÓN E-COMMERCE — el destino STACK.
//
// El stack efímero que levanta `supabase start` con la CLI fijada: PostgreSQL de
// Supabase con TODAS las migraciones del repo, PostgREST detrás de la puerta de entrada
// (que exige la clave del proyecto), GoTrue, pg_cron ejecutando los trabajos de verdad y
// el runtime de Edge. Vive en loopback y existe sólo mientras dura el job que lo levanta.
//
// ES EL CAMINO DE STAGING CON OTRAS DIRECCIONES. No hay un `fetch` que conteste por
// nadie: cada request sale tal cual hacia el stack, con los mismos clientes (el
// transporte propio y supabase-js), la misma clave publicable en `apikey`, sesiones que
// emite GoTrue (ingreso anónimo real, usuarios con contraseña por la API de
// administración, tokens con `session_id`) y las mismas RPC. Lo que cambia respecto de
// Staging es lo que este archivo declara:
//
//   · las entradas vienen SÓLO del entorno (`TABA_STACK_API_URL`, `TABA_STACK_ANON_KEY`,
//     `TABA_STACK_SERVICE_ROLE_KEY`, `TABA_STACK_DB_URL`: lo que imprime
//     `supabase status -o env`), y se rechaza todo lo que no sea loopback o que nombre un
//     proyecto alojado;
//   · el observador no es la Management API: es una conexión directa a la base, y cada
//     lectura corre dentro de una transacción de sólo lectura (`direct-db.mjs`);
//   · la base es de quien levantó el stack: una fila se puede envejecer por esa conexión
//     para no esperar un plazo de minutos. Cada intervención queda anotada en el ledger y
//     dicha en el check que la usa;
//   · no hay Cloudflare: el origen de red que ve el guardián de admisión es el que
//     DECLARA este transporte en `cf-connecting-ip` (uno por corrida). Que un cliente no
//     pueda falsificar ese encabezado es un hecho del borde y acá no se prueba.
//
// NADA SALE DE LA MÁQUINA. Dos cerrojos, como en el destino local: el `fetch` de acá sólo
// deja pasar el origen del stack y sus tres prefijos (`/rest/v1`, `/auth/v1`,
// `/functions/v1`), y por debajo ningún socket del proceso se conecta a otra cosa que
// loopback (`egress.mjs`).
//
// LO QUE ESTE DESTINO NO PRUEBA: Cloudflare, TLS de borde, el despliegue alojado de las
// Edge Functions (las de pago no reconocen a `127.0.0.1` como proyecto y se niegan antes
// de mirar una firma) y la carga real de una red.
import { createHash } from 'node:crypto';
import net from 'node:net';
import pg from 'pg';
import { CAPABILITY_NAMES, CONFIRMATIONS, FORBIDDEN_REFS, LOAD_PROFILES, RUN_ID_PATTERNS, RUN_ID_PREFIXES, STAGING_POSTGREST_VERSION, STAGING_REF,
  STAGING_ROLE_SETTINGS, assertNoForbiddenRef, assertNoProtectedBusiness, lacksFrom, sleep } from './env.mjs';
import { createDirectDatabase } from './direct-db.mjs';
import { egressLockIsInstalled, installEgressLock, isLoopbackHost, offMachine } from './egress.mjs';

export const STACK_LABEL = 'supabase-ephemeral-stack';
// Los nombres de las cuatro entradas. Sus valores nunca se escriben: ni en un log ni en la evidencia.
export const STACK_INPUTS = Object.freeze({ apiUrl: 'TABA_STACK_API_URL', anonKey: 'TABA_STACK_ANON_KEY', serviceKey: 'TABA_STACK_SERVICE_ROLE_KEY',
  dbUrl: 'TABA_STACK_DB_URL' });
const ALLOWED_PREFIXES = Object.freeze(['/rest/v1', '/auth/v1', '/functions/v1']);
// Las tablas que esta herramienta escribe con la clave de servicio para preparar el tenant: en un proyecto
// alojado `service_role` las tiene por los privilegios por defecto de la plataforma.
const PROVISIONING_TABLES = Object.freeze(['businesses', 'business_members', 'identity_user_security', 'staff_profiles', 'products',
  'business_payment_settings', 'mp_seller_connections']);
const DOCUMENTATION_ADDRESS = /^(192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)[0-9]{1,3}$|^2001:db8:[0-9a-f:]+$/;
const digestOf = (seed) => createHash('sha256').update(String(seed)).digest();

const NOT_AVAILABLE = Object.freeze({
  cloudflare: 'el stack no tiene Cloudflare delante: nadie rechaza un cf-connecting-ip escrito por el cliente, y el origen de red es el que declara el transporte de esta herramienta',
  hosted_deployment: 'el stack no es un despliegue alojado: sirve HTTP plano en loopback y las funciones de pago no lo reconocen como proyecto, así que se niegan antes de mirar la firma del aviso',
});

// ── Entradas ─────────────────────────────────────────────────────────────────
const jwtPayload = (token) => {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return null; }
};

// Lee y valida las cuatro entradas. Es pura (recibe el entorno) para poder probarla sin stack: lo que no
// sea loopback, o nombre un proyecto alojado, no llega a abrir una conexión.
export function resolveStackInputs(env = process.env) {
  const values = Object.fromEntries(Object.entries(STACK_INPUTS).map(([key, name]) => [key, String(env[name] ?? '').trim()]));
  const missing = Object.entries(STACK_INPUTS).filter(([key]) => !values[key]).map(([, name]) => name);
  if (missing.length) throw Error(`STACK_TARGET_INPUT_MISSING:${missing.join(',')}`);
  for (const value of Object.values(values)) {
    assertNoForbiddenRef(value);
    if (value.includes(STAGING_REF) || /\.supabase\.(co|com|in)\b/i.test(value)) throw Error('STACK_TARGET_INPUT_NAMES_A_HOSTED_PROJECT');
  }

  let api;
  try { api = new URL(values.apiUrl); } catch { throw Error('STACK_TARGET_API_URL_INVALID'); }
  if (!['http:', 'https:'].includes(api.protocol) || !isLoopbackHost(api.hostname) || !api.port || api.username || api.password
    || !['', '/'].includes(api.pathname) || api.search || api.hash) throw Error('STACK_TARGET_API_URL_IS_NOT_LOOPBACK');

  let db;
  try { db = new URL(values.dbUrl); } catch { throw Error('STACK_TARGET_DB_URL_INVALID'); }
  if (!['postgres:', 'postgresql:'].includes(db.protocol) || !isLoopbackHost(db.hostname) || !db.port) throw Error('STACK_TARGET_DB_URL_IS_NOT_LOOPBACK');

  // Las claves de un stack local son tokens con rol y SIN `ref`: una clave que nombra un proyecto es de un
  // proyecto alojado y no entra, aunque la URL sea loopback.
  const claims = { anon: jwtPayload(values.anonKey), service: jwtPayload(values.serviceKey) };
  if (!claims.anon || !claims.service) throw Error('STACK_TARGET_KEY_IS_NOT_A_LOCAL_JWT');
  if (claims.anon.ref || claims.service.ref) throw Error('STACK_TARGET_KEY_BELONGS_TO_A_HOSTED_PROJECT');
  if (claims.anon.role !== 'anon' || claims.service.role !== 'service_role') throw Error('STACK_TARGET_KEY_ROLE_MISMATCH');
  if (values.anonKey === values.serviceKey) throw Error('STACK_TARGET_KEY_ROLE_MISMATCH');

  return Object.freeze({ apiUrl: api.origin, apiHost: api.hostname, apiPort: Number(api.port), anonKey: values.anonKey, serviceKey: values.serviceKey,
    dbUrl: values.dbUrl, dbHost: db.hostname, dbPort: Number(db.port), dbName: decodeURIComponent(db.pathname.slice(1)) || 'postgres',
    dbPassword: db.password ? decodeURIComponent(db.password) : '', keyIssuer: claims.service.iss ?? null });
}

// El resguardo de destino del stack: sólo el origen del stack, sólo sus tres prefijos, y los mismos
// proyectos prohibidos y negocios protegidos que valen para Staging.
export function createStackGuard(apiUrl) {
  const origin = new URL(apiUrl).origin;
  return function assertStackRequest(input, init = {}) {
    const text = String(input?.url ?? input ?? '');
    assertNoForbiddenRef(text);
    let url;
    try { url = new URL(text); } catch { throw Error('STACK_TARGET_URL_INVALID'); }
    if (url.origin !== origin) throw Error(`STACK_TARGET_HOST_NOT_ALLOWED:${url.host}`);
    if (!ALLOWED_PREFIXES.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))) {
      throw Error(`STACK_TARGET_PATH_NOT_ALLOWED:${url.pathname.split('/').slice(0, 3).join('/')}`);
    }
    assertNoProtectedBusiness(url.href);
    if (typeof init?.body === 'string') assertNoProtectedBusiness(init.body);
    return url;
  };
}

export async function createStackTarget({ log = () => {}, env = process.env } = {}) {
  const egress = installEgressLock({ errorPrefix: 'STACK_TARGET_EGRESS_REFUSED' });   // antes que cualquier otra cosa
  const inputs = resolveStackInputs(env);
  const guard = createStackGuard(inputs.apiUrl);
  const stats = { rest: 0, auth: 0, functions: 0, refused: [] };
  let runOrigin = null;
  log(`stack: API en ${inputs.apiUrl}, base en ${inputs.dbHost}:${inputs.dbPort}/${inputs.dbName} (claves emitidas por «${inputs.keyIssuer ?? 'sin emisor'}»)`);

  // ── El `fetch` del destino: el del sistema, detrás del resguardo ───────────
  async function stackFetch(input, init = {}) {
    let url;
    try { url = guard(input, init); } catch (error) { stats.refused.push(String(error.message).slice(0, 80)); throw error; }
    if (url.pathname.startsWith('/rest/v1')) stats.rest += 1;
    else if (url.pathname.startsWith('/auth/v1')) stats.auth += 1;
    else stats.functions += 1;
    return fetch(input, init);
  }

  // ── Conexión directa: el observador (sólo lectura) y las intervenciones anotadas ──
  const direct = createDirectDatabase({ connect: async () => {
    const client = new pg.Client({ connectionString: inputs.dbUrl, application_name: 'taba-ecommerce-certification', connectionTimeoutMillis: 15_000 });
    client.on('error', () => {});
    await client.connect();
    return client;
  } });
  const observerStats = { calls: 0, retries: 0 };
  const project = Object.freeze({ id: 'stack', ref: 'stack', name: STACK_LABEL, region: 'loopback', status: 'EPHEMERAL_STACK' });
  const observer = Object.freeze({
    stats: observerStats,
    project: async () => project,
    async observe(sql) {
      observerStats.calls += 1;
      try { return await direct.readOnly(sql); } catch (error) {
        // El mismo texto que da la Management API cuando una consulta falla: quien lo lee no distingue destinos.
        throw Error(`MGMT_HTTP_400:/database/query/read-only:${String(error.message).slice(0, 240)}`);
      }
    },
  });

  // ── Origen de red ────────────────────────────────────────────────────────
  // El guardián de admisión SÓLO cree en `cf-connecting-ip` (private.order_intake_client_fingerprint): la
  // dirección real del runner, que la puerta de entrada pasa en `x-forwarded-for`, no la mira nunca. Sin un
  // borde que escriba ese encabezado, en el stack el guardián no vería ningún origen y la mitad de sus reglas no
  // existiría. El transporte lo DECLARA en lugar de Cloudflare: uno por corrida (203.0.113.0/24, derivado del
  // id), que es la situación de Staging, donde toda la corrida sale de la dirección de una máquina. Las pruebas
  // de abuso no necesitan otro. `originOf` da otros sólo para repartir la carga de la fase de rendimiento entre
  // orígenes (en producción cada cliente trae el suyo) y para el check que muestra que el tope de un origen no
  // alcanza a otro; siempre de los rangos de documentación.
  const originOf = (label) => { const h = digestOf(`${runOrigin}|${label}`).toString('hex'); return `2001:db8:${h.slice(0, 4)}:${h.slice(4, 8)}::1`; };
  function originHeaders(origin = null) {
    const address = origin ?? runOrigin;
    if (!address) throw Error('STACK_TARGET_RUN_NOT_BOUND');
    if (!DOCUMENTATION_ADDRESS.test(String(address))) throw Error('STACK_TARGET_ORIGIN_IS_NOT_A_DOCUMENTATION_ADDRESS');
    return { 'cf-connecting-ip': String(address) };
  }
  function fromOrigin(address, task) {
    if (!DOCUMENTATION_ADDRESS.test(String(address))) throw Error('STACK_TARGET_ORIGIN_IS_NOT_A_DOCUMENTATION_ADDRESS');
    return task();   // el encabezado ya viaja en la request: lo puso `originHeaders`
  }

  // ── Preflight: los hechos del stack, sin escrituras ───────────────────────
  const keyHeaders = (key) => ({ apikey: key, Authorization: `Bearer ${key}` });
  // El texto entero del error (hasta 240): el que dice «read-only transaction» viene detrás del prefijo del observador.
  const attempt = async (task) => { try { await task(); return null; } catch (error) { return String(error?.cause?.message || error?.message).slice(0, 240); } };
  const getJson = async (pathname, headers = {}) => {
    const res = await stackFetch(`${inputs.apiUrl}${pathname}`, { headers, signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    return { status: res.status, body, server: res.headers.get('server'), text: text.slice(0, 200) };
  };
  async function assertIdentity({ check, skip, project: seen, db: database, repoLedger, keys, observe }) {
    log('stack · identidad: claves, puerta de entrada, PostgREST, GoTrue, base, privilegios, migraciones, pg_cron');
    check('STACK_INPUTS_ARE_LOOPBACK_AND_THE_KEYS_ARE_THE_STACKS_OWN', seen?.name === STACK_LABEL && isLoopbackHost(inputs.apiHost) && isLoopbackHost(inputs.dbHost)
      && keys.publishable === inputs.anonKey && keys.secret === inputs.serviceKey && FORBIDDEN_REFS.every((ref) => !inputs.apiUrl.includes(ref)),
    { api: inputs.apiUrl, database: `${inputs.dbHost}:${inputs.dbPort}/${inputs.dbName}`, keyIssuer: inputs.keyIssuer, anonRole: 'anon', serviceRole: 'service_role' });

    // La puerta de entrada de la plataforma exige la clave del proyecto: sin `apikey` la request no llega a
    // PostgREST. El gateway del stack local de la CLI 2.101 NO la exige: contesta 200 en /rest/v1/ sin clave
    // (run 37123838754). Es configuración de la plataforma, no del backend, y este destino no la puede
    // certificar: queda como no probada, con lo observado. Lo que anon ve sin JWT lo prueban rls y privacy.
    const withoutKey = await getJson('/rest/v1/');
    if (withoutKey.status === 200 && typeof skip === 'function') {
      skip('STACK_GATEWAY_REFUSES_A_REQUEST_WITHOUT_THE_PROJECT_KEY',
        'el gateway del stack local no exige la clave del proyecto (observado: HTTP 200 en /rest/v1/ sin apikey); en la plataforma alojada sí la exige');
    } else {
      check('STACK_GATEWAY_REFUSES_A_REQUEST_WITHOUT_THE_PROJECT_KEY', withoutKey.status === 401, { status: withoutKey.status, body: withoutKey.text },
        'HTTP 401 antes de PostgREST');
    }

    // La versión sale de la raíz OpenAPI, pedida con la clave de servicio (la puerta de entrada de una plataforma
    // nueva puede no dársela a anon). Recién levantado, con el catálogo frío, la primera puede vencer (57014 o un
    // 5xx de la puerta): se reintenta ese caso, dos veces, y los intentos quedan en la evidencia.
    let root = null;
    const rootAttempts = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try { root = await getJson('/rest/v1/', keyHeaders(inputs.serviceKey)); } catch (error) { root = { status: 0, body: null, server: null, text: String(error.message).slice(0, 80) }; }
      rootAttempts.push(root.status);
      if (root.status === 200) break;
      if (root.status !== 0 && root.status < 500) break;
      log(`stack · la raíz OpenAPI contestó ${root.status} (intento ${attempt}): se reintenta`);
      await sleep(3000);
    }
    const version = String(root.body?.info?.version ?? '');
    const postgrest = { status: root.status, version: version || null, server: root.server, staging: STAGING_POSTGREST_VERSION, attempts: rootAttempts };
    // La traducción de SQLSTATE a estado HTTP es de PostgREST: con otra versión mayor, un estado afirmado acá no
    // dice nada del que da Staging. La versión exacta queda en la evidencia. Es un hecho de fidelidad: si falla,
    // es FAIL, pero la corrida sigue (todo lo demás que mida ayuda a entender la diferencia).
    check('STACK_POSTGREST_IS_THE_MAJOR_VERSION_STAGING_SERVES', root.status === 200 && version.split('.')[0] === STAGING_POSTGREST_VERSION.split('.')[0],
      postgrest, { major: STAGING_POSTGREST_VERSION.split('.')[0] }, { blocking: false });

    const settings = await getJson('/auth/v1/settings', keyHeaders(inputs.anonKey));
    const health = await getJson('/auth/v1/health', keyHeaders(inputs.anonKey));
    const gotrue = { settingsStatus: settings.status, anonymousUsers: settings.body?.external?.anonymous_users ?? null, emailProvider: settings.body?.external?.email ?? null,
      disableSignup: settings.body?.disable_signup ?? null, healthStatus: health.status, version: health.body?.version ?? null, name: health.body?.name ?? null };
    check('STACK_GOTRUE_ANSWERS_AND_ALLOWS_ANONYMOUS_SIGN_INS', settings.status === 200 && settings.body?.external?.anonymous_users === true && health.status === 200,
      gotrue, 'GoTrue contesta y el ingreso anónimo (el de la tienda) está habilitado');

    const facts = (await observe(`select current_database() as database, current_user as usr, current_setting('transaction_read_only') as read_only,
      current_setting('server_version') as server_version,
      (select setting from pg_settings where name = 'TimeZone') as observer_time_zone,
      (select to_json(min(created_at)) #>> '{}' from public.businesses) as oldest_business,
      (select json_object_agg(r.rolname, (select json_agg(c order by c) from unnest(s.setconfig) c)) from pg_db_role_setting s
         join pg_roles r on r.oid = s.setrole where s.setdatabase = 0 and r.rolname in ('anon', 'authenticated', 'authenticator')) as role_settings,
      (select json_agg(t.name order by t.name) from unnest(array[${PROVISIONING_TABLES.map((t) => `'${t}'`).join(',')}]) as t(name)
         where coalesce(has_table_privilege('service_role', to_regclass('public.' || t.name), 'SELECT')
           and has_table_privilege('service_role', to_regclass('public.' || t.name), 'INSERT')
           and has_table_privilege('service_role', to_regclass('public.' || t.name), 'UPDATE'), false) is not true) as tables_service_role_cannot_write,
      (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p'))::int as public_tables,
      (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p')
         and not has_table_privilege('service_role', c.oid, 'INSERT'))::int as public_tables_service_role_cannot_insert,
      (select json_agg(json_build_object('owner', pg_get_userbyid(d.defaclrole), 'kind', d.defaclobjtype, 'acl', d.defaclacl::text) order by pg_get_userbyid(d.defaclrole), d.defaclobjtype)
         from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace where n.nspname = 'public') as public_default_privileges,
      (select extversion from pg_extension where extname = 'pg_cron') as pg_cron_version`))[0];

    // Lo primero que usa esta herramienta con la clave de servicio son INSERT directos en estas tablas. En un
    // proyecto alojado `service_role` los tiene por los privilegios por defecto de la plataforma; si el stack
    // se levantó sin ellos, el stack no es lo que es Staging y se dice acá, no doce pasos más adelante.
    // Frena: sin esos privilegios no se puede ni crear el negocio de la corrida, y las Edge Functions de pago —que
    // escriben con la misma clave— tampoco andarían. Los privilegios por defecto del esquema quedan en la evidencia.
    const cannotWrite = facts.tables_service_role_cannot_write || [];
    check('STACK_SERVICE_ROLE_HAS_THE_TABLE_PRIVILEGES_OF_A_HOSTED_PROJECT', cannotWrite.length === 0,
      { tablesServiceRoleCannotWrite: cannotWrite, publicTables: facts.public_tables, publicTablesWithoutInsertForServiceRole: facts.public_tables_service_role_cannot_insert,
        publicDefaultPrivileges: facts.public_default_privileges },
      'service_role lee y escribe las tablas de aprovisionamiento, como en un proyecto alojado: los privilegios por defecto que el job de base de datos del repo le da a service_role antes de las migraciones');

    // PostgREST y el observador miran la MISMA base: la fila más vieja de `businesses`, leída por HTTP con el
    // rol de servicio y por la conexión directa, lleva el mismo instante al microsegundo.
    const oldest = await getJson('/rest/v1/businesses?select=created_at&order=created_at.asc&limit=1', keyHeaders(inputs.serviceKey));
    const oldestSeen = oldest.status === 200 ? oldest.body?.[0]?.created_at ?? null : null;
    check('STACK_DATABASE_IS_THE_ONE_BEHIND_THE_API', Boolean(facts.oldest_business) && oldestSeen === facts.oldest_business,
      { database: facts.database, observer: facts.usr, directConnection: facts.oldest_business, throughPostgrest: oldestSeen, restStatus: oldest.status });
    check('STACK_POSTGREST_ANSWERS_IN_UTC_LIKE_STAGING', /\+00:00$/.test(String(oldestSeen)) && facts.observer_time_zone === 'UTC',
      { throughPostgrest: oldestSeen, observer: facts.observer_time_zone }, null, { blocking: false });

    const writeAttempt = await attempt(() => observe('select id from public.businesses limit 1 for update'));
    check('STACK_OBSERVER_CANNOT_WRITE', facts.read_only === 'on' && /read-only transaction/.test(String(writeAttempt)),
      { transaction_read_only: facts.read_only, lockingRead: writeAttempt });

    const ledger = database.ledger || [];
    const unknownOnTarget = ledger.filter((entry) => !repoLedger.includes(entry));
    const notApplied = repoLedger.filter((entry) => !ledger.includes(entry));
    // El stack se construye del repo: no puede ir ni detrás ni adelante. Las tres de abajo son hechos de fidelidad:
    // si fallan, la corrida sigue y cada fase que dependa de eso lo va a decir con sus propios checks.
    check('STACK_MIGRATIONS_ARE_EXACTLY_THE_REPO_LEDGER', ledger.length === repoLedger.length && ledger.every((entry, index) => repoLedger[index] === entry),
      { stack: ledger.length, repo: repoLedger.length, head: database.head, unknownToTheRepo: unknownOnTarget, notApplied }, null, { blocking: false });
    const missing = CAPABILITY_NAMES.filter((name) => database.capabilities?.[name] !== true);
    check('STACK_EVERY_CAPABILITY_IS_PRESENT', missing.length === 0, { missing }, null, { blocking: false });
    // Los tiempos límite por rol son los de Staging: lo que más de la configuración del rol traiga la imagen no cambia la afirmación.
    check('STACK_ROLE_TIMEOUTS_ARE_THE_ONES_OF_STAGING', Object.entries(STAGING_ROLE_SETTINGS).every(([role, wanted]) => wanted.every((setting) => (facts.role_settings?.[role] || []).includes(setting))),
      facts.role_settings, STAGING_ROLE_SETTINGS, { blocking: false });

    // pg_cron CORRE: los trabajos están programados y activos, y al menos uno ya terminó bien. Recién
    // levantado el stack la primera corrida llega con el próximo minuto: se la espera, una sola vez.
    const cronJobs = database.cron || [];
    const cronRun = async () => (await observe(`select (select count(*) from cron.job_run_details d join cron.job j on j.jobid = d.jobid
        where j.jobname like 'taba-%' and d.status = 'succeeded')::int as succeeded,
      (select count(*) from cron.job_run_details d join cron.job j on j.jobid = d.jobid where j.jobname like 'taba-%' and d.status = 'failed')::int as failed,
      (select json_agg(distinct j.jobname) from cron.job_run_details d join cron.job j on j.jobid = d.jobid where j.jobname like 'taba-%' and d.status = 'failed') as failed_jobs`))[0];
    let runs = await cronRun();
    for (let waited = 0; runs.succeeded === 0 && waited < 80_000; waited += 4000) {
      if (waited === 0) log('stack · pg_cron todavía no terminó ninguna corrida: se espera el próximo minuto (hasta 80 s)');
      await sleep(4000);
      runs = await cronRun();
    }
    check('STACK_PG_CRON_IS_SCHEDULED_AND_RUNNING', cronJobs.length > 0 && cronJobs.every((job) => job.active === true) && runs.succeeded > 0,
      { pgCron: facts.pg_cron_version, jobs: cronJobs.map((job) => job.job), succeededRuns: runs.succeeded, failedRuns: runs.failed, failedJobs: runs.failed_jobs },
      'los trabajos taba-* activos y al menos una corrida terminada bien', { blocking: false });

    // Nada sale de la máquina: lo que no es el origen del stack se rechaza, y un socket a cualquier otro lado
    // no llega a abrirse (se prueba contra la función instalada, que lanza antes de conectar).
    const probes = {
      hostedProject: await attempt(() => stackFetch(`https://${STAGING_REF}.supabase.co/rest/v1/`)),
      otherHost: await attempt(() => stackFetch('https://example.invalid/')),
      otherPort: await attempt(() => stackFetch(`http://${inputs.apiHost}:${inputs.apiPort + 1}/rest/v1/`)),
      storage: await attempt(() => stackFetch(`${inputs.apiUrl}/storage/v1/object/public/catalog/x.png`)),
      managementApi: await attempt(() => stackFetch('https://api.supabase.com/v1/projects')),
      rawSocket: egressLockIsInstalled() ? await attempt(() => new Promise((resolve, reject) => { const socket = new net.Socket(); socket.on('error', reject); socket.connect(443, '192.0.2.1', resolve); })) : null,
      globalFetch: egressLockIsInstalled() ? await attempt(() => fetch('https://192.0.2.1/')) : null,
    };
    check('STACK_TARGET_REFUSES_EVERYTHING_OUTSIDE_THE_STACK', Object.values(probes).every(Boolean)
      && ['rawSocket', 'globalFetch'].every((name) => /EGRESS_REFUSED/.test(probes[name])) && offMachine(egress).length === 0,
    { probes, socketsOpenedTo: egress.destinations });

    log(`stack · identidad leída: PostgREST ${postgrest.version}, GoTrue ${gotrue.version}, PostgreSQL ${facts.server_version}, ${ledger.length} migraciones, ${cronJobs.length} trabajos de pg_cron`);
    return { ledger: { notApplied, unknownToTheRepo: unknownOnTarget }, facts: { postgrest, gotrue, database: facts.database, observer: facts.usr,
      serverVersion: facts.server_version, pgCron: facts.pg_cron_version, roleSettings: facts.role_settings, runOrigin,
      serviceRole: { tablesItCannotWrite: cannotWrite, publicTablesWithoutInsert: facts.public_tables_service_role_cannot_insert, publicTables: facts.public_tables },
      cronRuns: runs } };
  }

  // Al terminar: adónde se conectó de verdad este proceso, en toda la corrida.
  function assertContainment(check) {
    const allowed = [`${inputs.apiHost}:${inputs.apiPort}`, `${inputs.dbHost}:${inputs.dbPort}`];
    const destinations = Object.keys(egress.destinations);
    const elsewhere = destinations.filter((destination) => !allowed.includes(destination));
    check('STACK_RUN_OPENED_NO_CONNECTION_OFF_THE_MACHINE', egressLockIsInstalled() && offMachine(egress).length === 0 && elsewhere.length === 0
      && egress.refused.every((destination) => destination.startsWith('192.0.2.1:')),
    { socketsOpenedTo: egress.destinations, refusedBeforeConnecting: egress.refused, requests: { rest: stats.rest, auth: stats.auth, functions: stats.functions,
      refusedByTheGuard: stats.refused.length }, observerReads: direct.stats.reads, databaseWrites: direct.stats.writes },
    'sólo el API y la base del stack, en loopback; los únicos intentos rechazados son las sondas del preflight (192.0.2.1, rango de documentación)');
  }

  return Object.freeze({
    kind: 'stack',
    label: STACK_LABEL,
    environment: 'STACK',
    confirmation: CONFIRMATIONS.stack,
    runIdPrefix: RUN_ID_PREFIXES.stack,
    runIdPattern: RUN_ID_PATTERNS.stack,
    baseUrl: inputs.apiUrl,
    apiUrl: inputs.apiUrl,
    project: Object.freeze({ ref: project.ref, name: project.name }),
    observerGapMs: 0,
    // GoTrue es real pero es de esta corrida y de nadie más: un espaciado corto alcanza. Si aplica su límite de
    // ingresos por dirección (`[auth.rate_limit] sign_in_sign_ups`, por ventana de cinco minutos), se espera hasta
    // una ventana entera antes de dar el ingreso por fallido.
    signInGapMs: 40,
    signInRetry: Object.freeze({ attempts: 9, baseMs: 10_000 }),
    defaultMaxMinutes: 30,
    load: LOAD_PROFILES.stack,
    fetch: stackFetch,
    guard,
    lacks: lacksFrom(NOT_AVAILABLE),
    canChooseOrigin: true,
    fromOrigin,
    originOf,
    originHeaders,
    // La base es de quien levantó el stack. Por acá pasan SÓLO las intervenciones que un check declara.
    database: Object.freeze({ write: (sql, params) => direct.write(sql, params) }),
    // El origen de la corrida sale de su id: determinista y el mismo en cada invocación que la continúa.
    bindRun(runId) { runOrigin = `203.0.113.${1 + (digestOf(runId).readUInt16BE(0) % 254)}`; },
    wire: (url, headers) => ({ url, headers }),
    async loadCredentials({ redactor }) {
      redactor.secret(inputs.anonKey);
      redactor.secret(inputs.serviceKey);
      redactor.secret(inputs.dbUrl);
      if (inputs.dbPassword.length >= 12) redactor.secret(inputs.dbPassword);
      return { token: 'stack-observer', keys: Object.freeze({ target: 'stack', ref: project.ref, url: inputs.apiUrl, publishable: inputs.anonKey, secret: inputs.serviceKey }) };
    },
    createObserver: () => observer,
    assertIdentity,
    assertContainment,
    close: () => direct.close(),
  });
}
