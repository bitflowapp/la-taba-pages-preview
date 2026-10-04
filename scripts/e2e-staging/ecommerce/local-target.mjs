// CERTIFICACIÓN E-COMMERCE — el destino LOCAL.
//
// El PostgREST real (la versión que sirve Staging) delante de un PostgreSQL local con
// TODAS las migraciones del repo. El runner no se bifurca: sigue armando las URL de
// Staging y usando los mismos clientes de supabase-js. Lo que cambia es el `fetch` que
// recibe, que contesta cada request sin salir de la máquina:
//
//   https://<ref>.supabase.co/rest/v1/<ruta>      → http://127.0.0.1:<puerto>/<ruta>, por red real
//                                                    contra el PostgREST local
//   https://<ref>.supabase.co/auth/v1/…           → un GoTrue de utilería EN PROCESO, que contesta
//                                                    sólo las cinco llamadas que hace el runner
//   https://api.supabase.com/v1/projects/<ref>…   → identidad local, y el SQL del observador por una
//                                                    conexión directa en transacción READ ONLY
//   https://<ref>.supabase.co/functions/v1/*      → 404 {"code":"NOT_AVAILABLE_LOCALLY"}
//   cualquier otra cosa                           → se RECHAZA con un error
//
// A cada request a PostgREST se le hace lo que le hace el camino de Supabase antes de
// llegar (`toLocalRequest`): se va `apikey`, la clave del proyecto se cambia por un token
// del rol, el origen de red lo pone el destino (`cf-connecting-ip`; el cliente no puede
// elegirlo) y la transacción corre en UTC, que es el huso de la base de Staging.
//
// LO QUE ESTE DESTINO NO ES
//   No es un stack de Supabase. No hay GoTrue, ni Cloudflare, ni la puerta de entrada que
//   exige la clave del proyecto, ni Edge Functions, ni Storage, ni Realtime, ni un
//   planificador que ejecute `cron.job`. Lo que acá contesta en lugar de esas piezas es
//   utilería de esta herramienta: un check sobre ellas queda SKIPPED_NOT_AVAILABLE_LOCALLY
//   (`lacks()`), nunca PASS. Lo que SÍ es real: cada request a `/rest/v1` viaja por HTTP
//   a un PostgREST de verdad, con sus roles, sus permisos por columna, sus políticas de
//   filas, su traducción de errores a estados HTTP y los `statement_timeout` de cada rol.
//
// NADA SALE DE LA MÁQUINA
//   Dos cerrojos independientes. El `fetch` de acá sólo conoce las rutas de arriba. Y por
//   debajo, mientras dura el proceso, ningún socket se conecta a otra cosa que loopback
//   (`installEgressLock`): un `fetch` global, un `https.request` o un WebSocket que se
//   escape del primero mueren en el segundo, antes de resolver un nombre.
//
// DE DÓNDE SALE LA COMPUERTA LOCAL
//   De un módulo que arma quien levanta el PostgREST (variable TABA_LOCAL_GATE = su ruta).
//   Exporta `REST_URL`, `DB`, `mint(claims, ttl)` y `tokens.anon()/service()` (firman con
//   el secreto con el que arrancó ese PostgREST) y `pg(database)` (conexión directa).
import net from 'node:net';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { CAPABILITY_NAMES, CONFIRMATIONS, LOAD_PROFILES, MANAGEMENT_HOST, RUN_ID_PATTERNS, RUN_ID_PREFIXES, STAGING_POSTGREST_VERSION, STAGING_REF,
  STAGING_ROLE_SETTINGS, STAGING_URL, assertGuardedRequest, lacksFrom } from './env.mjs';
import { createDirectDatabase } from './direct-db.mjs';
import { LOOPBACK_HOSTS, egressLockIsInstalled, installEgressLock as installSharedEgressLock } from './egress.mjs';

// La versión de PostgREST que sirve Staging (`env.mjs`). El preflight local exige ésta, y la configuración
// de roles de Staging: sin esto un timeout local no dice nada.
export const EXPECTED_POSTGREST_VERSION = STAGING_POSTGREST_VERSION;
export const LOCAL_LABEL = `local-postgrest-${EXPECTED_POSTGREST_VERSION}`;
// No son secretos ni tienen forma de clave real: son los nombres con los que el runner pide «rol anon» y
// «rol de servicio». El `fetch` local los cambia por un token firmado con el secreto de la compuerta.
export const LOCAL_KEYS = Object.freeze({ publishable: 'local-publishable-key', secret: 'local-service-role-key', observer: 'local-observer-token' });
const REAL_KEY_SHAPE = /^(sb_|sbp_|eyJ)/;
const SESSION_TTL_SECONDS = 3600;
const REST_PREFIX = '/rest/v1';
const AUTH_PREFIX = '/auth/v1';

const NOT_AVAILABLE = Object.freeze({
  gotrue: 'GoTrue no existe: el ingreso, la suspensión y la baja de identidades los contesta un sustituto en proceso, que no prueba nada del servicio de Auth (proveedor anónimo habilitado, captcha, límites de tasa, suspensión real)',
  cloudflare: 'Cloudflare no existe: el origen de red lo pone este destino, y el 403 a un cf-connecting-ip falsificado es utilería',
  gateway: 'la puerta de entrada de Supabase no existe: nadie exige la clave del proyecto antes de PostgREST',
  edge_functions: 'las Edge Functions no existen: /functions/v1/* contesta 404 NOT_AVAILABLE_LOCALLY',
  edge_function_probes: 'las Edge Functions no existen: /functions/v1/* contesta 404 NOT_AVAILABLE_LOCALLY',
  hosted_deployment: 'no es un proyecto alojado: sin HTTPS de borde ni despliegue conocido por las funciones de pago',
  scheduler: 'pg_cron no corre: los trabajos están en cron.job y nada los ejecuta',
});

// ── Cerrojo de salida ────────────────────────────────────────────────────────
// El cerrojo es el de `egress.mjs`, compartido con el destino stack. Vale para todo el proceso y no se
// quita: el modo local nunca necesita salir.
export const installEgressLock = () => installSharedEgressLock({ errorPrefix: 'LOCAL_TARGET_EGRESS_REFUSED' });

// ── Compuerta ────────────────────────────────────────────────────────────────
async function loadGate() {
  const file = process.env.TABA_LOCAL_GATE;
  if (!file) throw Error('LOCAL_GATE_NOT_CONFIGURED: TABA_LOCAL_GATE tiene que ser la ruta del módulo de la compuerta local');
  const gate = await import(pathToFileURL(path.resolve(file)).href);
  const url = (() => { try { return new URL(gate.REST_URL); } catch { return null; } })();
  if (!url || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/') throw Error('LOCAL_GATE_REST_URL_IS_NOT_LOOPBACK');
  if (typeof gate.DB !== 'string' || !/^[a-z_][a-z0-9_]*$/.test(gate.DB)) throw Error('LOCAL_GATE_DATABASE_NAME_INVALID');
  if (typeof gate.mint !== 'function' || typeof gate.pg !== 'function' || typeof gate.tokens?.anon !== 'function' || typeof gate.tokens?.service !== 'function') {
    throw Error('LOCAL_GATE_CONTRACT_INCOMPLETE: REST_URL, DB, mint(), tokens.anon(), tokens.service() y pg()');
  }
  return { restUrl: url.origin, database: gate.DB, mint: gate.mint, tokens: gate.tokens, pg: gate.pg };
}

// ── Formas de respuesta ──────────────────────────────────────────────────────
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
// El cuerpo de error de GoTrue: auth-js saca el código de `error_code` y el texto de `msg`.
const gotrueError = (status, errorCode, message) => json(status, { code: status, error_code: errorCode, msg: message });
const iso = (value) => (value ? new Date(value).toISOString() : null);
const userJson = (row) => ({ id: row.id, aud: row.aud, role: row.role, email: row.email ?? '', email_confirmed_at: iso(row.email_confirmed_at),
  phone: row.phone ?? '', confirmed_at: iso(row.email_confirmed_at), last_sign_in_at: iso(row.last_sign_in_at), app_metadata: row.raw_app_meta_data,
  user_metadata: row.raw_user_meta_data, identities: [], created_at: iso(row.created_at), updated_at: iso(row.updated_at), is_anonymous: row.is_anonymous,
  ...(row.banned_until ? { banned_until: iso(row.banned_until) } : {}) });
const bearerOf = (headers) => /^Bearer\s+(.+)$/i.exec(headers.get('authorization') || '')?.[1] ?? null;

// Una duración como las escribe GoTrue (`876000h`, `1h30m`). `none` levanta la suspensión.
const DURATION_UNIT_MS = Object.freeze({ ns: 1e-6, us: 1e-3, 'µs': 1e-3, ms: 1, s: 1000, m: 60_000, h: 3_600_000 });
function banUntil(duration) {
  if (duration === 'none') return null;
  const parts = [...String(duration).matchAll(/([0-9]+(?:\.[0-9]+)?)(ns|us|µs|ms|s|m|h)/g)];
  if (!parts.length || parts.map((p) => p[0]).join('') !== String(duration)) throw Error(`LOCAL_TARGET_REFUSED:ban_duration ${duration}`);
  return new Date(Date.now() + parts.reduce((total, [, amount, unit]) => total + Number(amount) * DURATION_UNIT_MS[unit], 0));
}

// Direcciones de los rangos de documentación (RFC 5737 y RFC 3849): no se enrutan, no son de nadie.
const DOCUMENTATION_ADDRESS = /^(192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)[0-9]{1,3}$|^2001:db8:[0-9a-f:]+$/;
const digestOf = (seed) => createHash('sha256').update(String(seed)).digest();

export async function createLocalTarget({ log = () => {} } = {}) {
  const egress = installEgressLock();   // antes que cualquier otra cosa
  const gate = await loadGate();
  const stats = { rest: 0, auth: 0, management: 0, functions: 0, edgeRefused: 0, refused: [] };
  const originStore = new AsyncLocalStorage();
  // La contraseña de una identidad local vive sólo acá, en memoria: no se escribe en la base, en disco ni en
  // la evidencia. Cada invocación del runner rota la de los operadores antes de entrar, igual que en Staging.
  const passwords = new Map();
  let runOrigin = null;

  // ── Conexión directa (una sola, en serie): el observador y el GoTrue local ──
  // La misma pieza que usa el destino stack (`direct-db.mjs`): el observador lee dentro de una transacción de
  // sólo lectura, con los tipos de la Management API.
  const direct = createDirectDatabase({ connect: () => gate.pg(gate.database) });
  const { transaction, readOnly } = direct;

  // ── Origen de red ────────────────────────────────────────────────────────
  // En Staging toda la corrida sale de UNA dirección, la de la máquina que corre: acá también, una por
  // corrida (IPv4, 203.0.113.0/24). `originOf` da direcciones para las pruebas de abuso (un /64 de
  // 2001:db8::/32 por etiqueta: la huella del guardián reduce una IPv6 a su /64).
  const originOf = (label) => { const h = digestOf(`${runOrigin}|${label}`).toString('hex'); return `2001:db8:${h.slice(0, 4)}:${h.slice(4, 8)}::1`; };
  const currentOrigin = () => {
    const origin = originStore.getStore() ?? runOrigin;
    if (!origin) throw Error('LOCAL_TARGET_RUN_NOT_BOUND');
    return origin;
  };
  function fromOrigin(address, task) {
    if (!DOCUMENTATION_ADDRESS.test(String(address))) throw Error('LOCAL_TARGET_ORIGIN_IS_NOT_A_DOCUMENTATION_ADDRESS');
    return originStore.run(String(address), task);
  }

  // ── /rest/v1 → PostgREST local ────────────────────────────────────────────
  const platformTokens = new Map();
  function platformToken(kind) {
    const cached = platformTokens.get(kind);
    if (cached && cached.until > Date.now()) return cached.token;
    const token = gate.tokens[kind]();
    platformTokens.set(kind, { token, until: Date.now() + 30 * 60_000 });
    return token;
  }
  // La request tal como llega a PostgREST después de pasar por la entrada de Supabase:
  //   · `apikey` no llega (la consume la puerta de entrada). Si falta o no es del proyecto, en Staging la
  //     request no llegaría nunca: acá no se inventa una respuesta, se corta;
  //   · `Authorization` con la clave del proyecto se cambia por un token del rol (anon / service_role); un
  //     token de usuario pasa tal cual y lo valida PostgREST;
  //   · `cf-connecting-ip` lo pone el borde, nunca el cliente; `x-forwarded-for` llega «lo que mandó el
  //     cliente, origen real» (medido en Staging: evidence/rate-limit.md, «Origen de red»);
  //   · la base de Staging corre en UTC y la local en el huso de la máquina: `Prefer: timezone=UTC` deja
  //     cada transacción de PostgREST en UTC, como allá.
  function toLocalRequest(url, headers) {
    const apikey = headers.get('apikey');
    if (apikey !== LOCAL_KEYS.publishable && apikey !== LOCAL_KEYS.secret) throw Error('LOCAL_TARGET_REFUSED:request without the project key (the Supabase gateway would stop it)');
    const out = new Headers(headers);
    for (const name of ['apikey', 'host', 'content-length']) out.delete(name);
    const bearer = bearerOf(headers) ?? apikey;
    if (bearer === LOCAL_KEYS.publishable) out.set('authorization', `Bearer ${platformToken('anon')}`);
    else if (bearer === LOCAL_KEYS.secret) out.set('authorization', `Bearer ${platformToken('service')}`);
    const origin = currentOrigin();
    const forwarded = headers.get('x-forwarded-for');
    out.set('cf-connecting-ip', origin);
    out.set('x-forwarded-for', forwarded ? `${forwarded}, ${origin}` : origin);
    const prefer = headers.get('prefer');
    if (!/(^|,)\s*timezone=/i.test(prefer || '')) out.set('prefer', prefer ? `${prefer}, timezone=UTC` : 'timezone=UTC');
    const local = new URL(`${url.pathname.slice(REST_PREFIX.length) || '/'}${url.search}`, gate.restUrl);
    return { url: local, headers: out };
  }
  // A lo sumo `maxInFlight` requests dentro de PostgREST a la vez: cada una ocupa una conexión de su pool, y
  // el PostgreSQL local es compartido. Las demás esperan su turno, como esperan una conexión del pool.
  const maxInFlight = Math.min(16, Math.max(1, Number(process.env.TABA_LOCAL_MAX_IN_FLIGHT) || 16));
  let inFlight = 0;
  const waiting = [];
  const acquire = () => (inFlight < maxInFlight ? (inFlight += 1, Promise.resolve()) : new Promise((resolve) => waiting.push(resolve)));
  const release = () => { const next = waiting.shift(); if (next) next(); else inFlight -= 1; };
  async function rest(url, method, headers, body, signal) {
    // Cloudflare contesta 403 a quien trae su propio `cf-connecting-ip`: la request no llega al backend.
    if (headers.has('cf-connecting-ip')) {
      stats.edgeRefused += 1;
      return new Response('local edge stand-in: a client-supplied cf-connecting-ip is refused (Cloudflare answers 403 on Staging)',
        { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8', server: 'local-edge-stand-in' } });
    }
    const local = toLocalRequest(url, headers);
    await acquire();
    try {
      stats.rest += 1;
      return await fetch(local.url, { method, headers: local.headers, body: body ?? undefined, signal });
    } finally { release(); }
  }

  // ── /auth/v1 → GoTrue de utilería ─────────────────────────────────────────
  // Las identidades son filas de `auth.users` y `auth.sessions`; los tokens llevan los claims que emite
  // GoTrue (role, sub, aud, iat, exp, session_id, is_anonymous…) firmados con el secreto de la compuerta.
  const issuer = `${gate.restUrl}${AUTH_PREFIX} (local stand-in)`;
  async function openSession(client, user, method, headers) {
    const sessionId = randomUUID();
    await client.query('insert into auth.sessions (id, user_id, aal, user_agent, ip) values ($1, $2, $3, $4, $5)',
      [sessionId, user.id, 'aal1', headers.get('user-agent'), currentOrigin()]);
    const fresh = (await client.query('update auth.users set last_sign_in_at = now(), updated_at = now() where id = $1 returning *', [user.id])).rows[0];
    await client.query('commit');
    const now = Math.floor(Date.now() / 1000);
    const accessToken = gate.mint({ iss: issuer, sub: fresh.id, email: fresh.email ?? '', phone: fresh.phone ?? '', app_metadata: fresh.raw_app_meta_data,
      user_metadata: fresh.raw_user_meta_data, role: 'authenticated', aal: 'aal1', amr: [{ method, timestamp: now }], session_id: sessionId,
      is_anonymous: fresh.is_anonymous }, SESSION_TTL_SECONDS);
    return json(200, { access_token: accessToken, token_type: 'bearer', expires_in: SESSION_TTL_SECONDS, expires_at: now + SESSION_TTL_SECONDS,
      refresh_token: randomBytes(9).toString('base64url'), user: userJson(fresh) });
  }
  const onlyKeys = (payload, allowed, what) => {
    const extra = Object.keys(payload).filter((key) => !allowed.includes(key));
    // Un atributo que el sustituto no implementa no se ignora: se dice, para que nadie crea que se aplicó.
    if (extra.length) throw Error(`LOCAL_TARGET_REFUSED:${what} with ${extra.join(',')}`);
  };
  const signUpAnonymously = (payload, headers) => {
    onlyKeys(payload, ['data', 'gotrue_meta_security'], 'auth signup');
    return transaction('begin', async (client) => {
      const user = (await client.query(`insert into auth.users (aud, role, raw_app_meta_data, raw_user_meta_data, is_anonymous)
        values ('authenticated', 'authenticated', '{}'::jsonb, $1::jsonb, true) returning *`, [JSON.stringify(payload.data ?? {})])).rows[0];
      return openSession(client, user, 'anonymous', headers);
    });
  };
  const signInWithPassword = (payload, headers) => {
    onlyKeys(payload, ['email', 'password', 'gotrue_meta_security'], 'auth password grant');
    return transaction('begin', async (client) => {
      const user = (await client.query('select * from auth.users where lower(email) = lower($1) and not is_anonymous and deleted_at is null', [String(payload.email ?? '')])).rows[0];
      if (!user || !passwords.has(user.id) || passwords.get(user.id) !== payload.password) return gotrueError(400, 'invalid_credentials', 'Invalid login credentials');
      if (!user.email_confirmed_at) return gotrueError(400, 'email_not_confirmed', 'Email not confirmed');
      if (user.banned_until && new Date(user.banned_until).getTime() > Date.now()) return gotrueError(400, 'user_banned', 'User is banned');
      return openSession(client, user, 'password', headers);
    });
  };
  const adminCreateUser = (payload) => {
    onlyKeys(payload, ['email', 'password', 'email_confirm', 'user_metadata'], 'auth admin create user');
    const email = String(payload.email ?? '').trim().toLowerCase();
    if (!email || typeof payload.password !== 'string' || !payload.password) throw Error('LOCAL_TARGET_REFUSED:auth admin create user without email and password');
    return transaction('begin', async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtext('taba.local-gotrue.email'), hashtext($1))", [email]);
      if ((await client.query('select 1 from auth.users where lower(email) = $1', [email])).rowCount) {
        return gotrueError(422, 'email_exists', 'A user with this email address has already been registered');
      }
      const user = (await client.query(`insert into auth.users (aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, is_anonymous)
        values ('authenticated', 'authenticated', $1, case when $2 then now() end, '{"provider":"email","providers":["email"]}'::jsonb, $3::jsonb, false) returning *`,
      [email, payload.email_confirm === true, JSON.stringify(payload.user_metadata ?? {})])).rows[0];
      await client.query('commit');
      passwords.set(user.id, payload.password);
      return json(200, userJson(user));
    });
  };
  const adminUpdateUser = (id, payload) => {
    onlyKeys(payload, ['password', 'ban_duration', 'email_confirm'], 'auth admin update user');
    const bannedUntil = 'ban_duration' in payload ? banUntil(payload.ban_duration) : undefined;
    return transaction('begin', async (client) => {
      const user = (await client.query(`update auth.users set updated_at = now(),
          banned_until = case when $2 then $3::timestamptz else banned_until end,
          email_confirmed_at = case when $4 then coalesce(email_confirmed_at, now()) else email_confirmed_at end
        where id = $1 returning *`, [id, bannedUntil !== undefined, bannedUntil ?? null, payload.email_confirm === true])).rows[0];
      if (!user) return gotrueError(404, 'user_not_found', 'User not found');
      await client.query('commit');
      if (typeof payload.password === 'string') passwords.set(id, payload.password);
      return json(200, userJson(user));
    });
  };
  const adminDeleteUser = (id, payload) => {
    if (payload.should_soft_delete) throw Error('LOCAL_TARGET_REFUSED:auth admin soft delete');
    return transaction('begin', async (client) => {
      try {
        if (!(await client.query('delete from auth.users where id = $1', [id])).rowCount) return gotrueError(404, 'user_not_found', 'User not found');
        // GoTrue borra como `supabase_auth_admin`. Las cascadas corren como el dueño de cada tabla, pero los
        // triggers DIFERIDOS corren al confirmar con el rol de la sesión: un resguardo diferido que relea
        // una tabla sin privilegios para Auth tira la baja entera (20261001010000). Se confirma con ese rol.
        await client.query('set local role supabase_auth_admin');
        await client.query('commit');
      } catch (error) {
        // GoTrue contesta esto y nada más; el motivo de la base queda en el log de quien corre.
        log(`gotrue local: la baja de ${id.slice(0, 8)}… falló en la base (${error.code || 'sin código'}): ${String(error.message).slice(0, 160)}`);
        return gotrueError(500, 'unexpected_failure', 'Database error deleting user');
      }
      passwords.delete(id);
      return json(200, {});
    });
  };
  // Las cinco llamadas, y ninguna más: signInAnonymously, signInWithPassword y auth.admin.createUser /
  // updateUserById / deleteUser. Las de administración exigen la clave de servicio, como GoTrue.
  function gotrueHandler(url, method, headers) {
    const route = url.pathname.slice(AUTH_PREFIX.length);
    const userId = /^\/admin\/users\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(route)?.[1].toLowerCase();
    const admin = (handler) => (bearerOf(headers) === LOCAL_KEYS.secret ? handler : () => gotrueError(403, 'not_admin', 'User not allowed'));
    if (method === 'POST' && route === '/signup' && !url.search) return (payload) => signUpAnonymously(payload, headers);
    if (method === 'POST' && route === '/token' && url.search === '?grant_type=password') return (payload) => signInWithPassword(payload, headers);
    if (method === 'POST' && route === '/admin/users' && !url.search) return admin(adminCreateUser);
    if (method === 'PUT' && userId) return admin((payload) => adminUpdateUser(userId, payload));
    if (method === 'DELETE' && userId) return admin((payload) => adminDeleteUser(userId, payload));
    return null;
  }
  async function gotrue(url, method, headers, body) {
    const apikey = headers.get('apikey');
    if (apikey !== LOCAL_KEYS.publishable && apikey !== LOCAL_KEYS.secret) throw Error('LOCAL_TARGET_REFUSED:auth request without the project key (the Supabase gateway would stop it)');
    const handler = gotrueHandler(url, method, headers);
    if (!handler) throw Error(`LOCAL_TARGET_REFUSED:auth ${method} ${url.pathname.slice(AUTH_PREFIX.length)}${url.search}`);
    stats.auth += 1;
    return handler(body ? JSON.parse(body) : {});
  }

  // ── api.supabase.com → identidad local y observador ───────────────────────
  const project = Object.freeze({ id: 'local', ref: 'local', name: LOCAL_LABEL, region: 'loopback', status: 'LOCAL_STAND_IN', stand_in: true,
    note: 'NOT a Supabase project: the real PostgREST in front of a local PostgreSQL. No GoTrue, no Cloudflare, no Edge Functions.',
    database: { name: gate.database, host: '127.0.0.1' } });
  async function management(url, method, body) {
    stats.management += 1;
    if (method === 'GET') return json(200, project);   // `assertGuardedRequest` ya dejó pasar sólo las dos llamadas
    try {
      return json(201, await readOnly(String(JSON.parse(body || '{}').query ?? '')));
    } catch (error) {
      if (!error?.code) throw error;
      return json(400, { message: `Failed to run sql query: ${error.message}` });
    }
  }

  // ── El `fetch` del destino ────────────────────────────────────────────────
  async function localFetch(input, init = {}) {
    const url = assertGuardedRequest(input, init);
    const method = String(init?.method || input?.method || 'GET').toUpperCase();
    const headers = new Headers(init?.headers || input?.headers || {});
    const body = init?.body ?? (input instanceof Request && !['GET', 'HEAD'].includes(method) ? await input.clone().text() : null);
    if (url.hostname === MANAGEMENT_HOST) return management(url, method, body);
    if (url.pathname === REST_PREFIX || url.pathname.startsWith(`${REST_PREFIX}/`)) return rest(url, method, headers, body, init?.signal ?? input?.signal);
    if (url.pathname.startsWith(`${AUTH_PREFIX}/`)) return gotrue(url, method, headers, body);
    if (url.pathname.startsWith('/functions/v1/')) {
      stats.functions += 1;
      return json(404, { code: 'NOT_AVAILABLE_LOCALLY', message: 'Edge Functions do not exist in the local target' });
    }
    stats.refused.push(`${method} ${url.hostname}${url.pathname}`);
    throw Error(`LOCAL_TARGET_REFUSED:${method} ${url.hostname}${url.pathname}`);
  }

  // ── Preflight: los hechos del entorno local, sin escrituras ───────────────
  const platformHeaders = (key) => ({ apikey: key, Authorization: `Bearer ${key}` });
  const refusal = async (attempt) => { try { await attempt(); return null; } catch (error) { return String(error?.cause?.message || error?.message).slice(0, 80); } };
  async function assertIdentity({ check, project: seen, db: database, repoLedger, keys, observe }) {
    check('LOCAL_PROJECT_IDENTITY_IS_THE_MARKED_STAND_IN', seen?.stand_in === true && seen.name === LOCAL_LABEL && seen.ref === project.ref && seen.status === 'LOCAL_STAND_IN',
      { name: seen?.name, ref: seen?.ref, status: seen?.status, stand_in: seen?.stand_in });
    check('LOCAL_KEYS_ARE_PLACEHOLDERS_NO_REAL_CREDENTIAL_WAS_READ', keys.publishable === LOCAL_KEYS.publishable && keys.secret === LOCAL_KEYS.secret
      && Object.values(LOCAL_KEYS).every((key) => !REAL_KEY_SHAPE.test(key)), { target: keys.target, publishable: keys.publishable, secret: keys.secret });

    // La raíz OpenAPI la arma PostgREST con el rol anon (3 s de límite). Recién levantado, con el caché del
    // catálogo frío, la primera puede pasarse del límite (500 · 57014) sin que eso diga nada de la versión: se
    // reintenta sólo ese caso, dos veces, y los intentos quedan en la evidencia.
    let root = null;
    let openapi = null;
    const rootAttempts = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      root = await localFetch(`${STAGING_URL}${REST_PREFIX}/`, { headers: platformHeaders(LOCAL_KEYS.publishable) });
      openapi = await root.json().catch(() => null);
      rootAttempts.push(root.status);
      if (!(root.status === 500 && openapi?.code === '57014')) break;
      log(`local · la raíz OpenAPI se pasó del límite de anon con el catálogo frío (intento ${attempt}): se reintenta`);
    }
    const postgrest = { status: root.status, version: openapi?.info?.version ?? null, server: root.headers.get('server'), attempts: rootAttempts };
    check('LOCAL_POSTGREST_IS_THE_VERSION_STAGING_SERVES', root.status === 200 && postgrest.version === EXPECTED_POSTGREST_VERSION
      && postgrest.server === `postgrest/${EXPECTED_POSTGREST_VERSION}`, postgrest, { version: EXPECTED_POSTGREST_VERSION });

    const facts = (await observe(`select current_database() as database, current_setting('transaction_read_only') as read_only,
      current_setting('server_version') as server_version,
      (select setting from pg_settings where name = 'TimeZone') as observer_time_zone,
      (select to_json(min(created_at)) #>> '{}' from public.businesses) as oldest_business,
      (select json_object_agg(r.rolname, (select json_agg(c order by c) from unnest(s.setconfig) c)) from pg_db_role_setting s
         join pg_roles r on r.oid = s.setrole where s.setdatabase = 0 and r.rolname in ('anon', 'authenticated', 'authenticator')) as role_settings,
      (select json_agg(c) from pg_db_role_setting s join pg_database d on d.oid = s.setdatabase cross join unnest(s.setconfig) c
         where d.datname = current_database() and s.setrole = 0 and c ilike 'timezone=%') as database_time_zone`))[0];
    // PostgREST y el observador tienen que estar mirando la MISMA base: la fila más vieja de `businesses`,
    // leída por HTTP con el rol de servicio y por la conexión directa, lleva el mismo instante al microsegundo.
    const oldest = await localFetch(`${STAGING_URL}${REST_PREFIX}/businesses?select=created_at&order=created_at.asc&limit=1`, { headers: platformHeaders(LOCAL_KEYS.secret) });
    const oldestSeen = oldest.ok ? (await oldest.json())[0]?.created_at ?? null : null;
    check('LOCAL_DATABASE_IS_THE_GATE_DATABASE_BEHIND_POSTGREST', facts.database === gate.database && Boolean(facts.oldest_business)
      && oldestSeen === facts.oldest_business, { database: facts.database, expected: gate.database, directConnection: facts.oldest_business, throughPostgrest: oldestSeen });
    check('LOCAL_POSTGREST_ANSWERS_IN_UTC_LIKE_STAGING', /\+00:00$/.test(String(oldestSeen)) && facts.observer_time_zone === 'UTC',
      { throughPostgrest: oldestSeen, observer: facts.observer_time_zone, databaseSetting: facts.database_time_zone ?? 'none (machine time zone): every request carries Prefer: timezone=UTC' });

    const write = await localFetch(`https://${MANAGEMENT_HOST}/v1/projects/${STAGING_REF}/database/query/read-only`, { method: 'POST',
      body: JSON.stringify({ query: 'select id from public.businesses limit 1 for update' }) });
    const writeAnswer = await write.json().catch(() => null);
    check('LOCAL_OBSERVER_CANNOT_WRITE', facts.read_only === 'on' && write.status === 400 && /read-only transaction/.test(String(writeAnswer?.message)),
      { transaction_read_only: facts.read_only, lockingReadStatus: write.status, lockingReadMessage: String(writeAnswer?.message ?? '').slice(0, 120) });

    const ledger = database.ledger || [];
    const unknownOnTarget = ledger.filter((entry) => !repoLedger.includes(entry));
    const notDeployed = repoLedger.filter((entry) => !ledger.includes(entry));
    // A diferencia de Staging, la base local no puede ir detrás del repo: se construye de él.
    check('LOCAL_MIGRATIONS_ARE_EXACTLY_THE_REPO_LEDGER', ledger.length === repoLedger.length && ledger.every((entry, index) => repoLedger[index] === entry),
      { local: ledger.length, repo: repoLedger.length, head: database.head, unknownLocally: unknownOnTarget, notApplied: notDeployed });
    const missing = CAPABILITY_NAMES.filter((name) => database.capabilities?.[name] !== true);
    check('LOCAL_EVERY_CAPABILITY_IS_PRESENT', missing.length === 0, { missing });
    check('LOCAL_ROLE_SETTINGS_ARE_THE_ONES_OF_STAGING', Object.entries(STAGING_ROLE_SETTINGS).every(([role, settings]) => JSON.stringify(facts.role_settings?.[role]) === JSON.stringify(settings)),
      facts.role_settings, STAGING_ROLE_SETTINGS);

    // Nada sale de la máquina: lo que no es una de las rutas de arriba se rechaza, y un socket a cualquier
    // otro lado no llega a abrirse (se prueba contra la función instalada, que lanza antes de conectar).
    const probes = {
      storage: await refusal(() => localFetch(`${STAGING_URL}/storage/v1/object/public/catalog/x.png`)),
      realtime: await refusal(() => localFetch(`${STAGING_URL}/realtime/v1/api/broadcast`, { method: 'POST', body: '{}' })),
      otherAuthRoute: await refusal(() => localFetch(`${STAGING_URL}${AUTH_PREFIX}/user`, { headers: platformHeaders(LOCAL_KEYS.publishable) })),
      withoutProjectKey: await refusal(() => localFetch(`${STAGING_URL}${REST_PREFIX}/businesses?select=id&limit=1`)),
      otherManagementCall: await refusal(() => localFetch(`https://${MANAGEMENT_HOST}/v1/projects/${STAGING_REF}/secrets`)),
      otherHost: await refusal(() => localFetch('https://example.invalid/')),
      plainHttp: await refusal(() => localFetch(`http://${STAGING_REF}.supabase.co${REST_PREFIX}/`)),
      rawSocket: egressLockIsInstalled() ? await refusal(() => new Promise((resolve, reject) => { const socket = new net.Socket(); socket.on('error', reject); socket.connect(443, '192.0.2.1', resolve); })) : null,
      globalFetch: egressLockIsInstalled() ? await refusal(() => fetch('https://192.0.2.1/')) : null,
    };
    const edge = await localFetch(`${STAGING_URL}/functions/v1/mercadopago-webhook`, { method: 'POST', body: '{}' });
    const edgeAnswer = { status: edge.status, code: (await edge.json().catch(() => null))?.code ?? null };
    check('LOCAL_TARGET_REFUSES_EVERYTHING_OUTSIDE_ITS_ROUTES', Object.values(probes).every(Boolean)
      && ['rawSocket', 'globalFetch'].every((name) => /^LOCAL_TARGET_EGRESS_REFUSED/.test(probes[name]))
      && edgeAnswer.status === 404 && edgeAnswer.code === 'NOT_AVAILABLE_LOCALLY'
      && Object.keys(egress.destinations).every((destination) => LOOPBACK_HOSTS.includes(destination.slice(0, destination.lastIndexOf(':')))),
    { probes, edgeFunctions: edgeAnswer, socketsOpenedTo: egress.destinations });

    return { ledger: { notApplied: notDeployed, unknownToTheRepo: unknownOnTarget }, facts: { postgrest, database: facts.database, serverVersion: facts.server_version, observerTimeZone: facts.observer_time_zone,
      databaseTimeZoneSetting: facts.database_time_zone ?? null, roleSettings: facts.role_settings, runOrigin, maxInFlight } };
  }

  // Al terminar: adónde se conectó de verdad este proceso, en toda la corrida.
  function assertContainment(check) {
    const expected = [gate.restUrl.replace('http://', '')];
    const destinations = Object.keys(egress.destinations);
    const offMachine = destinations.filter((destination) => !LOOPBACK_HOSTS.includes(destination.slice(0, destination.lastIndexOf(':'))));
    check('LOCAL_RUN_OPENED_NO_CONNECTION_OFF_THE_MACHINE', egressLockIsInstalled() && offMachine.length === 0 && expected.every((destination) => destinations.includes(destination))
      && egress.refused.every((destination) => destination.startsWith('192.0.2.1:')),
    { socketsOpenedTo: egress.destinations, refusedBeforeConnecting: egress.refused, requests: { rest: stats.rest, auth: stats.auth, management: stats.management,
      functions: stats.functions, edgeRefused: stats.edgeRefused, refusedRoutes: stats.refused.length } },
    'sólo loopback; los únicos intentos rechazados son las sondas del preflight (192.0.2.1, rango de documentación)');
  }

  return Object.freeze({
    kind: 'local',
    label: LOCAL_LABEL,
    environment: 'LOCAL',
    confirmation: CONFIRMATIONS.local,
    runIdPrefix: RUN_ID_PREFIXES.local,
    runIdPattern: RUN_ID_PATTERNS.local,
    // Las URL que arma el runner siguen siendo las de Staging: el `fetch` de acá las contesta sin salir.
    baseUrl: STAGING_URL,
    apiUrl: gate.restUrl,
    project: Object.freeze({ ref: project.ref, name: project.name }),
    observerGapMs: 0,
    // No hay GoTrue que limite los ingresos: espaciarlos sólo demora.
    signInGapMs: 1,
    defaultMaxMinutes: 30,
    load: LOAD_PROFILES.local,
    fetch: localFetch,
    guard: assertGuardedRequest,
    lacks: lacksFrom(NOT_AVAILABLE),
    canChooseOrigin: true,
    fromOrigin,
    originOf,
    // El origen lo estampa el `fetch` de este destino (`toLocalRequest`): el transporte no agrega nada.
    originHeaders: () => ({}),
    // La base es de quien levantó la compuerta: una fila se puede envejecer por la conexión directa.
    database: Object.freeze({ write: (sql, params) => direct.write(sql, params) }),
    // El origen de la corrida sale de su id: determinista, el mismo en cada invocación que la continúa y, salvo
    // coincidencia (son 254 direcciones), distinto del de otra corrida sobre la misma base.
    bindRun(runId) { runOrigin = `203.0.113.${1 + (digestOf(runId).readUInt16BE(0) % 254)}`; },
    wire(url, headers) {
      const local = toLocalRequest(url, new Headers(headers));
      return { url: local.url, headers: Object.fromEntries(local.headers) };
    },
    async loadCredentials() {
      return { token: LOCAL_KEYS.observer, keys: Object.freeze({ target: 'local', ref: project.ref, url: gate.restUrl, publishable: LOCAL_KEYS.publishable, secret: LOCAL_KEYS.secret }) };
    },
    assertIdentity,
    assertContainment,
    close: () => direct.close(),
  });
}
