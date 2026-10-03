// CERTIFICACIÓN BACKEND E2E EN STAGING — UN MISMO PEDIDO POR TODAS LAS CAPAS.
//
// Corre contra el STAGING REAL de La Taba (Supabase `la-taba-staging`) y nada
// más: se planta si el proyecto, la web publicada, el negocio QA o el ledger de
// migraciones no son los esperados. Un único ORDER_ID nace por el contrato del
// cliente (sesión anónima + `create_order_with_items`), lo opera el negocio con
// el MISMO repositorio que usa el Panel (`createSupabaseOrderRepository`), lo
// toma y entrega un rider con las MISMAS llamadas que hace la app Android, y el
// cliente lo sigue con el MISMO DTO público (`x-order-token`).
//
// Qué NO hace, a propósito:
//   · no toca Producción ni CONTROLLED_PRODUCTION (refs prohibidos en duro);
//   · no usa Mercado Pago: el pedido es en efectivo;
//   · no escribe estado de pedidos por SQL: toda escritura pasa por RPC/REST
//     con la sesión del actor que corresponde;
//   · `service_role` sólo prepara y limpia identidades/negocio QA de esta
//     corrida (un usuario registrado sin membresía y un negocio B). Ninguna
//     aserción de autorización se apoya en esa clave;
//   · la verificación de base de datos la hace un OBSERVADOR de sólo lectura
//     (`supabase_read_only_user` vía Management API), nunca `service_role`.
//
// Todo recurso creado queda anotado en `created-resources.json` ANTES de usarse,
// así un corte duro deja un ledger para `--reconcile <dir>`.
//
//   node scripts/e2e-staging/backend-e2e-certification.mjs --confirm STAGING_MUTATION_OK
//   node scripts/e2e-staging/backend-e2e-certification.mjs --reconcile artifacts/taba-e2e-cert-YYYYMMDD-HHMMSS
//   node scripts/e2e-staging/backend-e2e-certification.mjs --preflight
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createClient } from '@supabase/supabase-js';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { leerTokenDelCli } from '../lib/supabase-cli-token.mjs';
import { loadTargetKeys } from '../controlled-production/target-keys.mjs';
import { createSupabaseOrderRepository } from '../../js/repositories/supabase_order_repository.js';
import { BUSINESS_INBOX_DATABASE_STATUSES } from '../../js/core/business-order-intake.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const STAGING_REF = 'ucbtjcurawxjwjdvvcvj';
const STAGING_PROJECT_NAME = 'la-taba-staging';
const STAGING_URL = `https://${STAGING_REF}.supabase.co`;
const STAGING_WEB = 'https://taba2-staging.pages.dev';
const BUSINESS_A = 'a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0';
const BUSINESS_A_SLUG = 'la-taba-staging';
const FORBIDDEN_REFS = Object.freeze(['tkanbadcglszlcyfjvpv', 'wwcpogltfgzgkrlilbcd', 'yakhtrkukqlgzvxuvhzs',
  'ygqbcvxdrewcnzedfcyo', 'enznqfzhikpasjzpvjfd']);
const PRODUCT_SKU = process.env.TABA_CERT_PRODUCT_SKU || 'STG-009';
const CREDENTIALS = Object.freeze({
  owner: 'STAGING PILOT OWNER QA 20260923',
  staff: 'STAGING PILOT STAFF QA 20260923',
  admin: 'STAGING BUSINESS QA 20260920',
  rider1: 'STAGING CP CAPACITY RIDER 1',
  rider2: 'STAGING CP CAPACITY RIDER 2',
});
const ADDRESS = Object.freeze({ neighborhood: 'Centro', city: 'Neuquén Capital', lat: -38.9516, lng: -68.0591 });
const OPTIONS = Object.freeze({ auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
// La bandeja del Panel filtra `origin = 'production'` (BUSINESS_INBOX_ORIGIN en el repositorio).
const BUSINESS_INBOX_ORIGIN = 'production';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => { const i = args.indexOf(name); return i < 0 ? '' : args[i + 1] || ''; };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha = (value) => createHash('sha256').update(String(value)).digest('hex');
const nowIso = () => new Date().toISOString();
const log = (message) => process.stderr.write(`[${nowIso().slice(11, 19)}] ${message}\n`);
const rowOf = (data) => (Array.isArray(data) ? data[0] : data);

// ── Secretos: se registran y se borran de TODA evidencia escrita ────────────
const SECRETS = new Set();
const secret = (value) => { if (value) SECRETS.add(String(value)); return value; };
function redact(value) {
  let text = JSON.stringify(value, (key, v) => (['access_token', 'refresh_token', 'provider_token', 'password'].includes(key) ? '<redacted>' : v), 2);
  for (const s of SECRETS) {
    if (s.length >= 4) text = text.split(s).join(`<redacted:${sha(s).slice(0, 10)}>`);
  }
  return text;
}

// ── Evidencia ────────────────────────────────────────────────────────────────
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const RUN_ID = `TABA_E2E_CERT_${stamp}`;
const RUN_SNAKE = RUN_ID.toLowerCase();
const EVIDENCE = flag('--reconcile') ? path.resolve(opt('--reconcile'))
  : opt('--evidence-dir') ? path.resolve(opt('--evidence-dir'))
    : path.join(ROOT, 'artifacts', `taba-e2e-cert-${stamp.slice(0, 8)}-${stamp.slice(8)}`);
const NOTES = `${RUN_ID} QA certificacion backend staging no despachar`;
const evidence = {};
function write(name, data) {
  evidence[name] = data;
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(path.join(EVIDENCE, name), `${redact(data)}\n`);
}

// ── Checks ───────────────────────────────────────────────────────────────────
const checks = [];
function check(phase, name, pass, observed = null, expected = null) {
  const entry = { phase, name, result: pass ? 'PASS' : 'FAIL', expected, observed, at: nowIso() };
  checks.push(entry);
  log(`${entry.result} [${phase}] ${name}${pass ? '' : ` -> ${JSON.stringify(observed).slice(0, 300)}`}`);
  return pass;
}
const phaseVerdict = (phase) => {
  const own = checks.filter((c) => c.phase === phase);
  if (!own.length) return 'NOT_RUN';
  return own.every((c) => c.result === 'PASS') ? 'PASS' : 'FAIL';
};

// ── Ledger durable de recursos ───────────────────────────────────────────────
const ledger = { runId: RUN_ID, startedAt: nowIso(), target: { ref: STAGING_REF, business: BUSINESS_A },
  serviceRoleUses: [], users: [], businesses: [], memberships: [], orders: [], sessions: [], availability: [],
  inventoryMovements: [], manualPayments: [] };
function persistLedger() {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(path.join(EVIDENCE, 'created-resources.json'), `${redact(ledger)}\n`);
}

// ── Observador de base de datos: sólo lectura, nunca service_role ────────────
let MGMT_TOKEN = '';
// Sólo lecturas (identidad del proyecto y observador SQL): un corte de red transitorio se reintenta.
const TRANSIENT = /HTTP_(429|5\d\d)|fetch failed|timeout|aborted|ECONNRESET|ENOTFOUND|EAI_AGAIN|UND_ERR/i;
async function retryRead(task) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      if (attempt >= 4 || !TRANSIENT.test(`${error.name} ${error.message} ${error.cause?.code || ''}`)) throw error;
      await sleep(1500 * attempt);
    }
  }
}
const mgmt = (pathname, init = {}) => retryRead(async () => {
  const res = await fetch(`https://api.supabase.com${pathname}`, {
    ...init, headers: { Authorization: `Bearer ${MGMT_TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(90_000),
  });
  const text = await res.text();
  if (!res.ok) throw Error(`MGMT_HTTP_${res.status}:${pathname.split('?')[0]}:${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
});
const observe = (sql) => mgmt(`/v1/projects/${STAGING_REF}/database/query/read-only`, { method: 'POST', body: JSON.stringify({ query: sql }) });
const publishedText = (pathname) => retryRead(async () => {
  const res = await fetch(`${STAGING_WEB}${pathname}`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw Error(`WEB_HTTP_${res.status}:${pathname}`);
  return res.text();
});
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;

// ── Clientes ─────────────────────────────────────────────────────────────────
let KEYS = null;
const newClient = (headers = {}) => createClient(STAGING_URL, KEYS.publishable, { ...OPTIONS, global: { headers } });

async function rpc(client, fn, params = {}) {
  const t0 = performance.now();
  const { data, error, status } = await client.rpc(fn, params);
  return { ok: !error, status, ms: Math.round(performance.now() - t0), data: error ? null : data,
    code: error?.code || null, message: error ? String(error.message || '').slice(0, 240) : null };
}

async function raw(fn, body, { jwt = null, headers = {}, timeoutMs = 60_000, signal } = {}) {
  const t0 = performance.now();
  try {
    const res = await fetch(`${STAGING_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: KEYS.publishable, Authorization: `Bearer ${jwt || KEYS.publishable}`, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body), signal: signal || AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: res.status, ms: Math.round(performance.now() - t0), ok: res.ok, data: res.ok ? json : null,
      code: res.ok ? null : json?.code || null, message: res.ok ? null : String(json?.message || text).slice(0, 240) };
  } catch (error) {
    return { status: 0, ms: Math.round(performance.now() - t0), ok: false, aborted: error?.name === 'AbortError' || error?.name === 'TimeoutError', code: error?.name || 'NETWORK', message: String(error?.message || error).slice(0, 200) };
  }
}

async function restGet(pathAndQuery, jwt = null) {
  const res = await fetch(`${STAGING_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: KEYS.publishable, Authorization: `Bearer ${jwt || KEYS.publishable}` }, signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, rows: Array.isArray(json) ? json : null, code: Array.isArray(json) ? null : json?.code || null };
}

async function restPatch(pathAndQuery, body, jwt) {
  const res = await fetch(`${STAGING_URL}/rest/v1/${pathAndQuery}`, {
    method: 'PATCH', headers: { apikey: KEYS.publishable, Authorization: `Bearer ${jwt || KEYS.publishable}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, rows: Array.isArray(json) ? json : null, code: Array.isArray(json) ? null : json?.code || null };
}

// Respuesta perdida, de forma determinista: el request sale por un socket propio, se espera a que el
// servidor lo haya confirmado (lo dice el observador) y se corta la conexión SIN entregar la respuesta
// a quien llamó. Lo que haya llegado al socket se destruye sin leer: quien llamó no supo nada.
async function sendAndDropResponse(fn, body, jwt, serverProcessed, maxMs = 25_000) {
  const https = await import('node:https');
  const info = { mode: 'dropped-unread', requestSent: false, serverProcessed: false, responseDeliveredToCaller: false, bytesReachedSocketBeforeDrop: false };
  const req = https.request(`${STAGING_URL}/rest/v1/rpc/${fn}`, { method: 'POST', agent: false,
    headers: { apikey: KEYS.publishable, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' } });
  req.on('error', () => {});
  req.on('response', (res) => { info.bytesReachedSocketBeforeDrop = true; res.destroy(); });
  await new Promise((resolve) => req.end(JSON.stringify(body), resolve));
  info.requestSent = true;
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (await serverProcessed()) { info.serverProcessed = true; break; }
    await sleep(400);
  }
  req.destroy();
  info.waitedMs = Date.now() - t0;
  return info;
}

const accessToken = async (client) => (await client.auth.getSession()).data.session?.access_token || null;
const memoryStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

// Clave de la app Rider: android- + sha256("op:id:revision:code") (Domain.kt · RiderCommands.key).
const riderKey = (operation, id, revision, code = '') => `android-${sha(`${operation}:${id}:${revision}:${code}`)}`;

// ── Fase 1 · identidad del entorno ───────────────────────────────────────────
async function phaseIdentity() {
  const P = 'P1_IDENTITY';
  MGMT_TOKEN = leerTokenDelCli();
  const project = await mgmt(`/v1/projects/${STAGING_REF}`);
  check(P, 'MGMT_PROJECT_IS_LA_TABA_STAGING', project?.name === STAGING_PROJECT_NAME && (project.ref ?? project.id) === STAGING_REF,
    { name: project?.name, ref: project?.ref ?? project?.id, region: project?.region, status: project?.status });
  KEYS = await loadTargetKeys('staging');
  check(P, 'KEYS_BOUND_TO_STAGING_REF', KEYS.ref === STAGING_REF && KEYS.url === STAGING_URL, { ref: KEYS.ref });
  for (const ref of FORBIDDEN_REFS) assert.ok(!KEYS.url.includes(ref), 'FORBIDDEN_REF');
  const runtimeText = await publishedText('/runtime-config.js');
  const runtime = JSON.parse(runtimeText.slice(runtimeText.indexOf('(') + 1, runtimeText.lastIndexOf(')')));
  const repo = runtime.repository || {};
  // El proyecto puede tener más de una clave publicable: lo que identifica al entorno es que la clave
  // que sirve la web publicada y la que usa esta corrida sean, las dos, claves DE ESTE proyecto.
  const apiKeys = await mgmt(`/v1/projects/${STAGING_REF}/api-keys?reveal=true`);
  const projectKeys = new Set((apiKeys || []).map((k) => k.api_key).filter(Boolean));
  const webKeyBelongs = projectKeys.has(repo.publishableKey) && String(repo.publishableKey || '').startsWith('sb_publishable_');
  const runKeyBelongs = projectKeys.has(KEYS.publishable);
  check(P, 'PUBLISHED_WEB_POINTS_TO_STAGING', repo.supabaseUrl === STAGING_URL && repo.deploymentEnvironment === 'staging'
    && repo.businessId === BUSINESS_A && webKeyBelongs && runKeyBelongs,
  { supabaseUrl: repo.supabaseUrl, deploymentEnvironment: repo.deploymentEnvironment, businessId: repo.businessId,
    webPublishableKeyIsAKeyOfThisProject: webKeyBelongs, runPublishableKeyIsAKeyOfThisProject: runKeyBelongs,
    sameKey: repo.publishableKey === KEYS.publishable });
  const swText = await publishedText('/sw.js');
  const webBuild = /la-taba-runtime-v[0-9]+[a-z0-9-]*/.exec(swText)?.[0] || null;
  const db = (await observe(`select current_user as usr, version() as v,
    (select count(*) from supabase_migrations.schema_migrations) as migrations,
    (select max(version) from supabase_migrations.schema_migrations) as head,
    (select json_agg(version || '_' || name order by version) from supabase_migrations.schema_migrations) as ledger,
    (select row_to_json(b) from (select id, slug, name, status, is_active, ordering_enabled, ordering_verified, delivery_enabled, pickup_enabled,
       hours_enforced, delivery_zone_enforced, minimum_delivery_subtotal, delivery_fee, rider_presence_required, qa_fixture
       from public.businesses where id = ${q(BUSINESS_A)}) b) as business`))[0];
  const repoLedger = readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort().map((f) => f.slice(0, -4));
  check(P, 'OBSERVER_IS_READ_ONLY_ROLE', db.usr === 'supabase_read_only_user', { user: db.usr });
  check(P, 'DB_LEDGER_EQUALS_REPO', JSON.stringify(db.ledger) === JSON.stringify(repoLedger),
    { staging: Number(db.migrations), repo: repoLedger.length, head: db.head });
  check(P, 'QA_BUSINESS_IS_STAGING_TENANT', db.business?.slug === BUSINESS_A_SLUG && /STAGING/.test(db.business?.name || '')
    && db.business?.status === 'open' && db.business?.ordering_enabled && db.business?.ordering_verified, db.business);
  const functions = await mgmt(`/v1/projects/${STAGING_REF}/functions`);
  const git = (cmd) => { try { return execFileSync('git', cmd, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return null; } };
  const env = {
    runId: RUN_ID, at: nowIso(), environment: 'STAGING',
    project: { ref: STAGING_REF, name: project?.name, region: project?.region, status: project?.status, createdAt: project?.created_at, organization: project?.organization_id },
    apiUrl: STAGING_URL, web: { url: STAGING_WEB, runtimeConfig: { ...repo, publishableKey: '<public key of this project (verified via Management API)>' }, build: webBuild },
    database: { observer: db.usr, server: db.v, migrations: Number(db.migrations), head: db.head, ledgerEqualsRepo: JSON.stringify(db.ledger) === JSON.stringify(repoLedger) },
    business: db.business,
    edgeFunctions: (functions || []).map((f) => ({ slug: f.slug, version: f.version, verify_jwt: f.verify_jwt, updated_at: f.updated_at })),
    repoEdgeFunctions: readdirSync(path.join(ROOT, 'supabase/functions')).filter((d) => !d.startsWith('_')),
    forbiddenRefs: FORBIDDEN_REFS, productSku: PRODUCT_SKU,
  };
  write('environment.json', env);
  writeFileSync(path.join(EVIDENCE, 'git-state.txt'), [
    `repo: ${git(['config', '--get', 'remote.origin.url'])}`,
    // Sólo el nombre: la evidencia se commitea y la higiene de release no admite rutas de disco locales.
    `worktree: ${path.basename(ROOT)}`,
    `branch: ${git(['rev-parse', '--abbrev-ref', 'HEAD'])}`,
    `head: ${git(['rev-parse', 'HEAD'])}`,
    `head_subject: ${git(['log', '-1', '--format=%s'])}`,
    `origin_main: ${git(['rev-parse', 'origin/main'])}`,
    'status_porcelain:', git(['status', '--porcelain']) || '(clean)', ''].join('\n'));
  return env;
}

// ── Actores ──────────────────────────────────────────────────────────────────
const LIVE_SESSIONS = new Set();
// Desde cuándo se buscan sesiones del Panel en navegador sin cerrar (por defecto, el inicio de la corrida del ledger).
const UI_SESSIONS_SINCE = () => opt('--ui-sessions-since') || ledger.startedAt;
async function operator(role, credentialName, client = 'panel_web') {
  const stored = leerSecreto(credentialName);
  assert.ok(stored?.secreto && stored?.usuario, `QA_CREDENTIAL_REQUIRED:${credentialName}`);
  const c = newClient();
  const { data, error } = await c.auth.signInWithPassword({ email: stored.usuario, password: stored.secreto });
  if (error || !data?.session) throw Error(`LOGIN_FAILED:${role}:${error?.code || error?.status || 'NO_SESSION'}`);
  // Igual que la app Rider: la membresía se lee con la propia sesión antes de registrar la sesión de identidad.
  const memberships = await c.from('business_members').select('business_id,role,is_active').eq('user_id', data.user.id).eq('is_active', true);
  const reg = await rpc(c, 'identity_register_session', { p_business_id: BUSINESS_A, p_client: client,
    p_device_label: `${RUN_ID} ${role}`, p_device_key_hash: null, p_app_version: 'taba-e2e-cert' });
  if (!reg.ok || !reg.data?.ok) throw Error(`SESSION_REFUSED:${role}:${reg.code || reg.data?.code}`);
  LIVE_SESSIONS.add(reg.data.session_id);
  ledger.sessions.push({ role, userId: data.user.id, sessionId: reg.data.session_id, client, closed: false });
  persistLedger();
  return { role, client: c, userId: data.user.id, email: stored.usuario, sessionRole: reg.data.role,
    memberships: memberships.data || [], jwt: data.session.access_token };
}

async function anonymousCustomer(label, phone) {
  const c = newClient();
  const { data, error } = await c.auth.signInAnonymously({ options: { data: { taba_actor: 'customer', qa_run: RUN_ID } } });
  if (error || !data?.session) throw Error(`ANON_SIGNIN_FAILED:${error?.code}`);
  ledger.users.push({ kind: 'anonymous_customer', label, userId: data.user.id, deleted: false });
  persistLedger();
  const profile = await rpc(c, 'upsert_current_customer_profile', { p_name: 'QA Certificacion E2E', p_phone: phone });
  const address = await rpc(c, 'upsert_current_customer_address', { p_address: { label: 'Casa', street: 'Calle Certificacion', streetNumber: '901',
    city: ADDRESS.city, neighborhood: ADDRESS.neighborhood, latitude: ADDRESS.lat, longitude: ADDRESS.lng, geolocationAccuracy: 10,
    source: 'gps', locationSource: 'map_pin', locationConfirmedAt: nowIso(), isDefault: true } });
  if (!profile.ok || !address.ok) throw Error(`CUSTOMER_SETUP_FAILED:${profile.code}:${address.code}`);
  return { label, client: c, userId: data.user.id, jwt: data.session.access_token, addressId: address.data?.address?.id, phone };
}

// service_role SOLO para preparar identidades/negocio QA de esta corrida.
async function serviceRoleSetup() {
  const admin = createClient(STAGING_URL, KEYS.secret, OPTIONS);
  const out = {};
  const mkUser = async (label) => {
    const email = `${RUN_SNAKE.replaceAll('_', '-')}-${label}@qa.lataba.invalid`;
    const password = secret(randomBytes(24).toString('base64url'));
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true,
      user_metadata: { qa_run: RUN_ID, purpose: 'authorization-negative-test' } });
    if (created.error) throw Error(`SR_CREATE_USER:${label}:${created.error.code || created.error.status}`);
    ledger.users.push({ kind: 'registered_test_user', label, userId: created.data.user.id, email, deleted: false });
    ledger.serviceRoleUses.push({ purpose: 'setup', action: 'auth.admin.createUser', label, at: nowIso() });
    persistLedger();
    const c = newClient();
    const signed = await c.auth.signInWithPassword({ email, password });
    if (signed.error) throw Error(`SIGNIN_TEST_USER:${label}:${signed.error.code}`);
    return { label, client: c, userId: created.data.user.id, email, jwt: signed.data.session.access_token };
  };
  out.noMembership = await mkUser('nomember');
  out.otherOwner = await mkUser('otherowner');
  const businessB = randomUUID();
  ledger.businesses.push({ id: businessB, purpose: 'cross-tenant negative tests', deleted: false });
  ledger.serviceRoleUses.push({ purpose: 'setup', action: 'insert businesses (QA business B)', at: nowIso() });
  persistLedger();
  // Inactivo y cerrado: ningún barrido operativo lo toma y no vende nada.
  const insB = await admin.from('businesses').insert({ id: businessB, name: `QA ${RUN_ID} negocio B`, slug: `qa-${RUN_SNAKE.replaceAll('_', '-')}-b`,
    status: 'closed', is_active: false, ordering_enabled: false, ordering_verified: false }).select('id').single();
  if (insB.error) throw Error(`SR_INSERT_BUSINESS_B:${insB.error.code}:${insB.error.message}`);
  const mem = await admin.from('business_members').insert({ business_id: businessB, user_id: out.otherOwner.userId, role: 'owner', is_active: true }).select('id').single();
  if (mem.error) throw Error(`SR_INSERT_MEMBERSHIP_B:${mem.error.code}`);
  ledger.memberships.push({ business: businessB, userId: out.otherOwner.userId, role: 'owner', id: mem.data.id });
  ledger.serviceRoleUses.push({ purpose: 'setup', action: 'insert business_members (owner of B)', at: nowIso() });
  persistLedger();
  const reg = await rpc(out.otherOwner.client, 'identity_register_session', { p_business_id: businessB, p_client: 'panel_web',
    p_device_label: `${RUN_ID} owner-B`, p_device_key_hash: null, p_app_version: 'taba-e2e-cert' });
  if (!reg.ok || !reg.data?.ok) throw Error(`SESSION_B_REFUSED:${reg.code || reg.data?.code}`);
  LIVE_SESSIONS.add(reg.data.session_id);
  ledger.sessions.push({ role: 'owner-B', userId: out.otherOwner.userId, sessionId: reg.data.session_id, business: businessB, closed: false });
  persistLedger();
  out.businessB = businessB;
  out.admin = admin;
  return out;
}

// ── Panel real (UI), opcional ────────────────────────────────────────────────
// Entra por el formulario del Panel como una persona y busca la tarjeta del MISMO pedido.
// Se captura sólo esa tarjeta: la bandeja de staging puede tener pedidos de otras corridas.
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
async function serveStatic(dir) {
  const http = await import('node:http');
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    const clean = decodeURIComponent(String(req.url || '/').split('?')[0].split('#')[0]);
    const file = path.resolve(root, `.${clean.endsWith('/') ? `${clean}index.html` : clean}`);
    if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function panelUiEvidence({ orderId, publicCode, credentialName, distDir }) {
  const results = [];
  let chromium;
  try { ({ chromium } = await import('@playwright/test')); } catch (error) {
    return [{ label: 'panel-ui', result: 'NOT_RUN', reason: `playwright: ${String(error.message).slice(0, 120)}` }];
  }
  const stored = leerSecreto(credentialName);
  const origins = [];
  let local = null;
  if (distDir && existsSync(path.join(distDir, 'index.html'))) {
    local = await serveStatic(distDir);
    const version = existsSync(path.join(distDir, 'version.json')) ? JSON.parse(readFileSync(path.join(distDir, 'version.json'), 'utf8')) : null;
    origins.push({ label: 'current-build-local', url: local.url, build: version });
  }
  origins.push({ label: 'deployed-staging', url: `${STAGING_WEB}/`, build: null });
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const origin of origins) {
      const entry = { label: origin.label, url: origin.label === 'deployed-staging' ? origin.url : 'http://127.0.0.1:<port>/', build: origin.build, result: 'FAIL' };
      const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(String(error.message).slice(0, 200)));
      try {
        // Se escribe cuando el Panel terminó de arrancar: el formulario se redibuja al terminar de mirar si ya había sesión.
        await page.goto(`${origin.url}#business`, { waitUntil: 'networkidle', timeout: 90_000 }).catch(() => {});
        await page.waitForTimeout(2500);
        const form = page.locator('[data-production-auth-form]:visible').first();
        await form.waitFor({ timeout: 60_000 });
        await form.locator('[name="email"]').fill(stored.usuario);
        await form.locator('[name="password"]').fill(stored.secreto);
        await form.locator('button[type="submit"]').click();
        await page.locator('[data-production-workspace="business"]').waitFor({ state: 'visible', timeout: 60_000 });
        entry.signedInThroughForm = true;
        // La tarjeta se identifica por el código público (único por comercio); el vínculo código ↔ order_id lo certifica la base.
        const card = page.locator(`[data-order-card="${publicCode}"]`).first();
        await card.waitFor({ state: 'visible', timeout: 60_000 });
        await card.scrollIntoViewIfNeeded().catch(() => {});
        const text = (await card.innerText()).replace(/\s+/g, ' ').trim();
        entry.cardFound = true;
        entry.cardShowsPublicCode = text.includes(publicCode);
        entry.cardText = text.slice(0, 500);
        entry.screenshot = `panel-ui-${origin.label}.png`;
        await card.screenshot({ path: path.join(EVIDENCE, entry.screenshot) });
        entry.result = entry.cardShowsPublicCode ? 'PASS' : 'FAIL';
      } catch (error) {
        entry.error = String(error.message).split('\n')[0].slice(0, 300);
      } finally {
        // Salir por pantalla siempre que se haya entrado: el cierre de sesión del Panel es parte de la prueba.
        if (entry.signedInThroughForm) {
          await page.locator('[data-production-sign-out]:visible').first().click({ timeout: 15_000 }).catch(() => { entry.signOutClicked = false; });
          entry.signedOut = await page.locator('[data-production-auth-form]:visible').first().waitFor({ timeout: 30_000 }).then(() => true).catch(() => false);
        }
        entry.jsErrors = errors;
        await context.close();
      }
      results.push(entry);
    }
  } catch (error) {
    results.push({ label: 'panel-ui', result: 'NOT_RUN', reason: String(error.message).split('\n')[0].slice(0, 200) });
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (local) await local.close().catch(() => {});
  }
  return results;
}

// ── Snapshots ────────────────────────────────────────────────────────────────
async function productSnapshot(productId) {
  return (await observe(`select id, sku, name, price, price_status, stock, available, merchant_available, is_active, is_verified,
    is_alcoholic, catalog_origin, updated_at,
    (select count(*) from public.inventory_movements m where m.product_id = p.id)::int as inventory_movements,
    (select count(*) from public.inventory_reservations r where r.product_id = p.id and r.status in ('active','pending','reserved'))::int as active_reservations,
    (select coalesce(sum(oi.quantity),0) from public.order_items oi join public.orders o on o.id = oi.order_id
      where oi.product_uuid = p.id and o.status in ('received','submitted','accepted','preparing','ready','assigned','picked_up','on_the_way','arrived')
        and o.inventory_released_at is null)::int as units_in_open_orders
    from public.products p where p.id = ${q(productId)}`))[0];
}
const catalogFingerprint = async () => (await observe(`select md5(string_agg(id::text || ':' || coalesce(stock::text,'') || ':' || available::text || ':' ||
  merchant_available::text || ':' || price::text || ':' || price_status || ':' || is_verified::text || ':' || is_active::text, ',' order by id)) fp,
  count(*)::int n from public.products where business_id = ${q(BUSINESS_A)}`))[0];

async function orderTruth(orderId) {
  return (await observe(`select row_to_json(o) as order_row,
    (select json_agg(row_to_json(i) order by i.created_at, i.id) from public.order_items i where i.order_id = o.id) as items,
    (select json_agg(json_build_object('sequence', e.sequence, 'event_type', e.event_type, 'actor_role', e.actor_role, 'actor_user_id', e.actor_user_id,
       'metadata', e.metadata, 'created_at', e.created_at) order by e.sequence) from public.order_events e where e.order_id = o.id) as events,
    (select count(*) from public.order_public_tokens t where t.order_id = o.id)::int as tracking_tokens,
    (select json_agg(json_build_object('state', n.state, 'event_type', n.event_type, 'suppressed', n.payload->'suppressed')) from public.notification_outbox n where n.aggregate_id = o.id) as notifications,
    (select json_agg(json_build_object('status', f.status, 'rider', f.rider_user_id, 'version', f.version)) from public.rider_order_offers f where f.order_id = o.id) as offers,
    (select count(*) from public.rider_locations l where l.order_id = o.id)::int as rider_locations,
    (select count(*) from public.print_jobs pj where pj.source_entity_id = o.id)::int as print_jobs
    from public.orders o where o.id = ${q(orderId)}`))[0];
}

// ── Pedido ───────────────────────────────────────────────────────────────────
function orderPayload({ requestId, token, productId, quantity, mode, customer, payment = 'cash' }) {
  return { business_id: BUSINESS_A, client_request_id: requestId, tracking_token: token,
    items: [{ product_id: productId, quantity }], customer_name: 'QA Certificacion E2E', customer_phone: customer.phone,
    delivery_mode: mode, payment_method: payment, age_confirmed: false, customer_notes: NOTES,
    ...(mode === 'delivery' ? { customer_address_id: customer.addressId, customer_street_address: 'Calle Certificacion 901', customer_neighborhood: ADDRESS.neighborhood } : {}) };
}
const newToken = () => secret(randomBytes(32).toString('base64url'));
const newRequestId = (label) => `cert-${label}-${stamp}-${randomBytes(4).toString('hex')}`;

function registerOrder(row, label, extra = {}) {
  ledger.orders.push({ id: row.id, publicCode: row.public_code, label, ...extra });
  persistLedger();
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const env = await phaseIdentity();
  if (flag('--preflight')) {
    console.log(JSON.stringify({ preflight: true, checks }, null, 1));
    return;
  }
  assert.equal(opt('--confirm'), 'STAGING_MUTATION_OK', 'EXPLICIT_CONFIRMATION_REQUIRED');
  const identityOk = phaseVerdict('P1_IDENTITY') === 'PASS';
  if (!identityOk) throw Error('STAGING_IDENTITY_NOT_VERIFIED');
  persistLedger();
  // Lo que exista en cada momento: la limpieza lo recibe aunque la corrida se corte a mitad de camino.
  const ctx = {};
  try {
    return await certify(ctx);
  } catch (error) {
    check('RUN', 'UNEXPECTED_ERROR', false, { message: error.message, stack: String(error.stack || '').split('\n').slice(0, 4) });
    throw Object.assign(error, { ctx });
  }
}

async function certify(ctx) {
  // ── Fase 2 · aislamiento y estado inicial ──────────────────────────────────
  const P2 = 'P2_ISOLATION';
  const product = (await observe(`select id, sku, name, price, stock, available, merchant_available, is_active, is_verified, is_alcoholic, catalog_origin
    from public.products where business_id = ${q(BUSINESS_A)} and sku = ${q(PRODUCT_SKU)}`))[0];
  check(P2, 'FIXTURE_PRODUCT_IS_STAGING_SYNTHETIC', Boolean(product) && /^STG-/.test(product.sku) && product.is_alcoholic === false
    && product.available && product.is_verified && product.merchant_available && product.stock >= 20, product);
  if (!product) throw Error('FIXTURE_PRODUCT_MISSING');
  const catalogBefore = await catalogFingerprint();
  const stockBefore = await productSnapshot(product.id);
  Object.assign(ctx, { product, catalogBefore, stockBefore });
  const stagingStateBefore = (await observe(`select
    (select count(*) from public.orders where business_id = ${q(BUSINESS_A)})::int orders,
    (select count(*) from public.orders where business_id = ${q(BUSINESS_A)} and status not in ('delivered','cancelled','canceled','rejected'))::int open_orders,
    (select count(*) from public.rider_order_offers where status = 'pending')::int pending_offers,
    (select count(*) from public.print_jobs)::int print_jobs,
    (select count(*) from public.fiscal_documents)::int fiscal_documents,
    (select count(*) from public.payment_intents)::int payment_intents,
    (select json_agg(json_build_object('rider', rider_user_id, 'available', available, 'version', version)) from public.rider_availability where business_id = ${q(BUSINESS_A)}) riders`))[0];
  ctx.stagingStateBefore = stagingStateBefore;
  write('stock-before.json', { runId: RUN_ID, product: stockBefore, catalogFingerprint: catalogBefore, stagingStateBefore });

  const owner = ctx.owner = await operator('owner', CREDENTIALS.owner);
  const staff = ctx.staff = await operator('staff', CREDENTIALS.staff);
  const adminOp = ctx.adminOp = await operator('admin', CREDENTIALS.admin);
  const rider1 = ctx.rider1 = await operator('rider1', CREDENTIALS.rider1, 'rider_android');
  const rider2 = ctx.rider2 = await operator('rider2', CREDENTIALS.rider2, 'rider_android');
  check(P2, 'OPERATOR_ROLES', owner.sessionRole === 'owner' && staff.sessionRole === 'staff' && adminOp.sessionRole === 'admin'
    && rider1.sessionRole === 'rider' && rider2.sessionRole === 'rider',
  { owner: owner.sessionRole, staff: staff.sessionRole, admin: adminOp.sessionRole, rider1: rider1.sessionRole, rider2: rider2.sessionRole });
  const customerA = ctx.customerA = await anonymousCustomer('customer-A-main', '2995550901');
  const customerB = ctx.customerB = await anonymousCustomer('customer-B-other', '2995550902');
  const customerR = ctx.customerR = await anonymousCustomer('customer-R-races', '2995550903');
  const sr = ctx.sr = await serviceRoleSetup();
  check(P2, 'ISOLATED_TEST_IDENTITIES_CREATED', Boolean(customerA.addressId && customerB.userId && customerR.userId && sr.noMembership.userId && sr.otherOwner.userId && sr.businessB));

  const panelRepo = createSupabaseOrderRepository({ client: staff.client, businessId: BUSINESS_A,
    storage: memoryStorage(), durableStorage: memoryStorage(), windowRef: undefined, documentRef: undefined });

  const transitions = [];
  const recordTransition = (entry) => { transitions.push({ at: nowIso(), ...entry }); };
  const trackingLog = [];
  const riderLog = [];
  const panelLog = [];
  const idem = { replay: null, concurrentReplays: null, races: [] };
  const conc = { staleRevision: [], doubleAccept: null, raceAcceptVsCancel: null, lostResponse: {} };
  const negatives = [];
  const rls = [];
  let mainOrder = null;
  let mainToken = null;
  let mainPayload = null;
  let deliveryCode = null;
  const heartbeat = ctx.heartbeat = { timer: null };
  const P = { create: 'P3_CREATE', db: 'P4_DATABASE', panel: 'P5_PANEL', sm: 'P6_STATE_MACHINE', rider: 'P7_RIDER', track: 'P8_TRACKING',
    code: 'P9_DELIVERY_CODE', idem: 'P10_IDEMPOTENCY', lost: 'P11_LOST_RESPONSE', rls: 'P12_RLS', events: 'P13_EVENTS', stock: 'P14_STOCK', neg: 'P15_NEGATIVE', clean: 'P16_CLEANUP' };

  const trackingClient = (token) => newClient({ 'x-order-token': token });
  const track = async (stage, token = mainToken, publicId = mainOrder?.public_code) => {
    const r = await rpc(trackingClient(token), 'get_public_order_tracking', { p_public_id: publicId });
    trackingLog.push({ stage, publicId, tokenIsMain: token === mainToken, ok: r.ok, status: r.status, code: r.code, dto: r.data });
    return r;
  };
  const panelRow = async (stage) => {
    const snap = await panelRepo.fetchBusinessOrderSnapshot();
    const row = snap.ok ? (snap.rows || []).find((o) => o.id === mainOrder.id) : null;
    const domain = snap.ok ? (snap.orders || []).find((o) => [o.backendId, o.id, o.code].includes(mainOrder.id) || o.code === mainOrder.public_code) : null;
    panelLog.push({ stage, ok: snap.ok, code: snap.code || null, inboxSize: snap.rows?.length ?? null, found: Boolean(row),
      row: row ? { id: row.id, public_code: row.public_code, status: row.status, revision: row.revision, delivery_mode: row.delivery_mode,
        payment_method: row.payment_method, subtotal: row.subtotal, delivery_fee: row.delivery_fee, total: row.total, origin: row.origin,
        assigned_rider_user_id: row.assigned_rider_user_id, manual_payment_status: row.manual_payment_status, customer_name: row.customer_name,
        customer_street_address: row.customer_street_address, created_at: row.created_at, accepted_at: row.accepted_at, ready_at: row.ready_at,
        items: (row.order_items || []).map((i) => ({ product_uuid: i.product_uuid, name: i.name, quantity: Number(i.quantity), unit_price: Number(i.unit_price), subtotal: Number(i.subtotal) })) } : null,
      domain: domain ? { status: domain.status || domain.workflowStatus, code: domain.code, total: domain.total } : null });
    return { snap, row };
  };
  const orderRev = async () => Number((await observe(`select revision from public.orders where id = ${q(mainOrder.id)}`))[0].revision);
  const orderState = async (id = mainOrder.id) => (await observe(`select status, revision, assigned_rider_user_id, manual_payment_status, origin, inventory_released_at from public.orders where id = ${q(id)}`))[0];
  const board = async (rider, stage = '') => {
    const r = await rpc(rider.client, 'get_rider_delivery_board');
    riderLog.push({ stage, rider: rider.role, ok: r.ok, code: r.code, available: r.data?.available, offers: (r.data?.offers || []).map((o) => ({ id: o.offer_id || o.id, order_id: o.order_id || o.order?.id, version: o.version, public_code: o.public_code || o.order?.public_code })),
      orders: (r.data?.orders || []).map((o) => ({ id: o.id, public_code: o.public_code, status: o.status, revision: o.revision, total: o.total, items: o.order_items, has_customer_location: Boolean(o.customer_location) })) });
    return r;
  };

  try {
    // ── Fase 3 · pedido real por el contrato del cliente ─────────────────────
    mainToken = newToken();
    const mainRequestId = newRequestId('main');
    const quantity = Math.ceil(6001 / Number(product.price));
    mainPayload = orderPayload({ requestId: mainRequestId, token: mainToken, productId: product.id, quantity, mode: 'delivery', customer: customerA });
    const t0 = performance.now();
    const created = await rpc(customerA.client, 'create_order_with_items', { payload: mainPayload });
    const createdMs = Math.round(performance.now() - t0);
    mainOrder = ctx.mainOrder = rowOf(created.data);
    check(P.create, 'ORDER_CREATED_BY_CUSTOMER_CONTRACT', created.ok && Boolean(mainOrder?.id), { code: created.code, message: created.message, ms: createdMs });
    if (!mainOrder?.id) throw Error('MAIN_ORDER_NOT_CREATED');
    registerOrder(mainOrder, 'main', { clientRequestId: mainRequestId, quantity, mode: 'delivery' });
    const expectedSubtotal = Number(product.price) * quantity;
    check(P.create, 'ORDER_RESPONSE_SHAPE', mainOrder.business_id === BUSINESS_A && mainOrder.client_request_id === mainRequestId
      && Number(mainOrder.subtotal) === expectedSubtotal && mainOrder.status === 'received' && mainOrder.delivery_mode === 'delivery'
      && mainOrder.payment_method === 'cash', { status: mainOrder.status, subtotal: mainOrder.subtotal, fee: mainOrder.delivery_fee, total: mainOrder.total });

    // ── Fase 4 · base de datos (observador) ──────────────────────────────────
    const truth = await orderTruth(mainOrder.id);
    const o = truth.order_row;
    const items = truth.items || [];
    const stockAfterCreate = await productSnapshot(product.id);
    check(P.db, 'DB_ORDER_PERSISTED', o?.id === mainOrder.id && o.business_id === BUSINESS_A && o.customer_user_id === customerA.userId
      && o.client_request_id === mainRequestId && o.status === 'received' && o.origin === 'production' && o.delivery_mode === 'delivery'
      && o.payment_method === 'cash' && o.manual_payment_status === 'pending' && o.customer_notes === NOTES, { status: o?.status, origin: o?.origin, payment: o?.manual_payment_status });
    check(P.db, 'DB_ORDER_ITEMS_FROZEN_PRICES', items.length === 1 && items[0].product_uuid === product.id && Number(items[0].quantity) === quantity
      && Number(items[0].unit_price) === Number(product.price) && Number(items[0].subtotal) === expectedSubtotal, items);
    check(P.db, 'DB_TOTALS', Number(o.subtotal) === expectedSubtotal && Number(o.delivery_fee) === 1200 && Number(o.total) === expectedSubtotal + 1200,
      { subtotal: o.subtotal, fee: o.delivery_fee, total: o.total });
    check(P.db, 'DB_DELIVERY_SNAPSHOT', o.delivery_zone_name === 'Centro' && Number(o.delivery_latitude) === ADDRESS.lat && Number(o.delivery_longitude) === ADDRESS.lng
      && o.delivery_location_source === 'map_pin' && Boolean(o.delivery_location_confirmed_at), { zone: o.delivery_zone_name, lat: o.delivery_latitude, lng: o.delivery_longitude });
    check(P.db, 'DB_RECEIVED_EVENT_AND_TOKEN', (truth.events || []).filter((e) => e.event_type === 'order.received').length === 1 && truth.tracking_tokens === 1,
      { events: truth.events?.map((e) => e.event_type), tokens: truth.tracking_tokens });
    check(P.db, 'STOCK_DECREMENT_EXACT', stockAfterCreate.stock === stockBefore.stock - quantity && stockAfterCreate.available === true,
      { before: stockBefore.stock, ordered: quantity, after: stockAfterCreate.stock });
    check(P.db, 'NO_TEMPORARY_RESERVATIONS_MANUAL_PATH', stockAfterCreate.active_reservations === 0, { reservations: stockAfterCreate.active_reservations });
    write('order.json', { stage: 'after-create', order: o, createResponseMs: createdMs });
    write('order-items.json', items);

    // ── Fase 5 · Panel (repositorio real) ────────────────────────────────────
    const pc = await panelRow('received');
    check(P.panel, 'PANEL_INBOX_SHOWS_SAME_ORDER', pc.snap.ok && Boolean(pc.row) && pc.row.status === 'received' && Number(pc.row.total) === Number(o.total)
      && pc.row.order_items?.length === 1 && Number(pc.row.order_items[0].quantity) === quantity && pc.row.delivery_mode === 'delivery',
    panelLog.at(-1));
    check(P.panel, 'PANEL_INBOX_FILTER_IS_PRODUCTION_ORIGIN_ACTIVE', BUSINESS_INBOX_DATABASE_STATUSES.includes('received') && pc.row?.origin === BUSINESS_INBOX_ORIGIN, { statuses: BUSINESS_INBOX_DATABASE_STATUSES });
    const panelEvents = await panelRepo.fetchOrderEvents(mainOrder.id);
    check(P.panel, 'PANEL_ORDER_AUDIT_READS_EVENTS', panelEvents.ok && panelEvents.events?.some((e) => e.event_type === 'order.received'), { ok: panelEvents.ok, n: panelEvents.events?.length });

    // ── Fase 8a · tracking recién creado ─────────────────────────────────────
    const tr0 = await track('received');
    check(P.track, 'TRACKING_SAME_ORDER_RECEIVED', tr0.ok && tr0.data?.public_code === mainOrder.public_code && tr0.data?.status === 'received'
      && Number(tr0.data?.revision) === Number(o.revision), tr0.data);
    const dtoKeys = Object.keys(tr0.data || {});
    check(P.track, 'TRACKING_DTO_HAS_NO_PII', !dtoKeys.some((k) => /customer|phone|name|address|street|user_id|notes|token|business_id|^id$/.test(k)), dtoKeys);

    // ── Fase 15a · negativos de creación (no deben crear nada) ───────────────
    const countOrders = async () => Number((await observe(`select count(*) n from public.orders where business_id = ${q(BUSINESS_A)}`))[0].n);
    const ordersBeforeNeg = await countOrders();
    const stockBeforeNeg = (await productSnapshot(product.id)).stock;
    const negCreate = async (name, mutate, expectCode) => {
      const p = mutate(orderPayload({ requestId: newRequestId('neg'), token: newToken(), productId: product.id, quantity: 1, mode: 'pickup', customer: customerR }));
      const r = await rpc(customerR.client, 'create_order_with_items', { payload: p });
      negatives.push({ name, ok: r.ok, status: r.status, code: r.code, message: r.message });
      check(P.neg, name, !r.ok && (!expectCode || [].concat(expectCode).includes(r.code)), { status: r.status, code: r.code, message: r.message }, expectCode);
    };
    const unavailable = (await observe(`select id from public.products where business_id = ${q(BUSINESS_A)} and available = false limit 1`))[0];
    const otherBusinessProduct = (await observe(`select id from public.products where business_id <> ${q(BUSINESS_A)} limit 1`))[0];
    await negCreate('NEG_QUANTITY_ZERO', (p) => ({ ...p, items: [{ product_id: product.id, quantity: 0 }] }), '22023');
    await negCreate('NEG_QUANTITY_NEGATIVE', (p) => ({ ...p, items: [{ product_id: product.id, quantity: -1 }] }), '22023');
    await negCreate('NEG_QUANTITY_OVER_STOCK', (p) => ({ ...p, items: [{ product_id: product.id, quantity: stockBeforeNeg + 1 }] }), '23514');
    if (unavailable) await negCreate('NEG_PRODUCT_UNAVAILABLE', (p) => ({ ...p, items: [{ product_id: unavailable.id, quantity: 1 }] }), '55000');
    await negCreate('NEG_PRODUCT_NONEXISTENT', (p) => ({ ...p, items: [{ product_id: randomUUID(), quantity: 1 }] }), '23503');
    await negCreate('NEG_BUSINESS_NONEXISTENT', (p) => ({ ...p, business_id: randomUUID() }), '23503');
    await negCreate('NEG_BUSINESS_NOT_ACCEPTING', (p) => ({ ...p, business_id: '00000000-0000-4000-8000-000000000001' }), '55000');
    if (otherBusinessProduct) await negCreate('NEG_PRODUCT_OF_OTHER_BUSINESS', (p) => ({ ...p, items: [{ product_id: otherBusinessProduct.id, quantity: 1 }] }), '23503');
    await negCreate('NEG_UNKNOWN_FIELD_PRICE_INJECTION', (p) => ({ ...p, delivery_fee: 0, total: 1 }), '22023');
    await negCreate('NEG_DELIVERY_WITHOUT_LOCATION', (p) => ({ ...p, delivery_mode: 'delivery', customer_street_address: 'Sin punto 1', customer_neighborhood: 'Centro' }), '22023');
    await negCreate('NEG_DELIVERY_BELOW_MINIMUM', (p) => ({ ...p, delivery_mode: 'delivery', customer_address_id: customerR.addressId,
      customer_street_address: 'Calle Certificacion 901', customer_neighborhood: 'Centro' }), '23514');
    const unauthCreate = await raw('create_order_with_items', { payload: orderPayload({ requestId: newRequestId('anon'), token: newToken(), productId: product.id, quantity: 1, mode: 'pickup', customer: customerR }) });
    negatives.push({ name: 'NEG_CREATE_WITHOUT_SESSION', status: unauthCreate.status, code: unauthCreate.code });
    check(P.neg, 'NEG_CREATE_WITHOUT_SESSION', !unauthCreate.ok && [401, 403].includes(unauthCreate.status), { status: unauthCreate.status, code: unauthCreate.code });
    const reusedOther = await rpc(customerA.client, 'create_order_with_items', { payload: { ...mainPayload, items: [{ product_id: product.id, quantity: quantity + 1 }] } });
    negatives.push({ name: 'NEG_IDEMPOTENCY_KEY_REUSED_DIFFERENT_PAYLOAD', status: reusedOther.status, code: reusedOther.code, message: reusedOther.message });
    check(P.neg, 'NEG_IDEMPOTENCY_KEY_REUSED_DIFFERENT_PAYLOAD', !reusedOther.ok && reusedOther.code === '23505', { code: reusedOther.code, message: reusedOther.message });
    // Otra persona con la MISMA clave y el MISMO token (con su propia dirección, para llegar al núcleo).
    const otherCustomerSameKey = await rpc(customerB.client, 'create_order_with_items', { payload: { ...mainPayload, customer_address_id: customerB.addressId } });
    negatives.push({ name: 'NEG_IDEMPOTENCY_KEY_OTHER_CUSTOMER', status: otherCustomerSameKey.status, code: otherCustomerSameKey.code });
    check(P.neg, 'NEG_IDEMPOTENCY_KEY_OTHER_CUSTOMER', !otherCustomerSameKey.ok && otherCustomerSameKey.code === '23505', { code: otherCustomerSameKey.code });
    check(P.neg, 'NEG_NO_SIDE_EFFECTS', (await countOrders()) === ordersBeforeNeg && (await productSnapshot(product.id)).stock === stockBeforeNeg,
      { ordersBefore: ordersBeforeNeg, ordersAfter: await countOrders(), stockBefore: stockBeforeNeg });

    // ── Fase 10 · idempotencia del pedido original ───────────────────────────
    const eventsBeforeReplay = (await orderTruth(mainOrder.id)).events.length;
    const replay = await rpc(customerA.client, 'create_order_with_items', { payload: mainPayload });
    idem.replay = { ok: replay.ok, status: replay.status, sameId: rowOf(replay.data)?.id === mainOrder.id, ms: replay.ms };
    const concurrentReplays = await Promise.all(Array.from({ length: 20 }, () => raw('create_order_with_items', { payload: mainPayload }, { jwt: customerA.jwt })));
    idem.concurrentReplays = concurrentReplays.map((r) => ({ status: r.status, ms: r.ms, id: rowOf(r.data)?.id || null, code: r.code }));
    const afterReplay = await orderTruth(mainOrder.id);
    const sameKeyOrders = Number((await observe(`select count(*) n from public.orders where business_id = ${q(BUSINESS_A)} and client_request_id = ${q(mainRequestId)}`))[0].n);
    check(P.idem, 'REPLAY_RETURNS_SAME_ORDER', replay.ok && idem.replay.sameId, idem.replay);
    check(P.idem, 'REPLAY_20_CONCURRENT_SAME_ORDER', concurrentReplays.every((r) => r.status === 200 && rowOf(r.data)?.id === mainOrder.id),
      idem.concurrentReplays.map((r) => `${r.status}:${r.id === mainOrder.id ? 'same' : r.id || r.code}`));
    check(P.idem, 'REPLAY_NO_DUPLICATES', sameKeyOrders === 1 && afterReplay.items.length === 1 && afterReplay.events.length === eventsBeforeReplay
      && (await productSnapshot(product.id)).stock === stockAfterCreate.stock, { orders: sameKeyOrders, items: afterReplay.items.length, events: afterReplay.events.length });

    // Carreras de creación: n requests simultáneos, MISMA clave nueva.
    const raceOrders = [];
    for (const n of [2, 5, 20]) {
      const stockPre = (await productSnapshot(product.id)).stock;
      const requestId = newRequestId(`race${n}`);
      const token = newToken();
      const body = { payload: orderPayload({ requestId, token, productId: product.id, quantity: 1, mode: 'pickup', customer: customerR }) };
      const results = await Promise.all(Array.from({ length: n }, () => raw('create_order_with_items', body, { jwt: customerR.jwt })));
      const ids = [...new Set(results.map((r) => rowOf(r.data)?.id).filter(Boolean))];
      const dbRows = await observe(`select id, public_code, status from public.orders where business_id = ${q(BUSINESS_A)} and client_request_id = ${q(requestId)}`);
      for (const row of dbRows) registerOrder(row, `race-${n}`, { clientRequestId: requestId, quantity: 1, mode: 'pickup' });
      const stockPost = (await productSnapshot(product.id)).stock;
      const events = dbRows[0] ? (await orderTruth(dbRows[0].id)).events.filter((e) => e.event_type === 'order.received').length : 0;
      const race = { n, statuses: results.map((r) => r.status), latenciesMs: results.map((r) => r.ms), distinctIds: ids.length,
        dbOrders: dbRows.length, stockPre, stockPost, receivedEvents: events, codes: results.filter((r) => !r.ok).map((r) => r.code) };
      idem.races.push(race);
      check(P.idem, `RACE_${n}_SAME_KEY_ONE_ORDER`, results.every((r) => r.status === 200) && ids.length === 1 && dbRows.length === 1 && events === 1, race);
      check(P.idem, `RACE_${n}_ONE_STOCK_DECREMENT`, stockPost === stockPre - 1, { stockPre, stockPost });
      if (dbRows[0]) raceOrders.push({ id: dbRows[0].id, public_code: dbRows[0].public_code, token, requestId, body });
    }

    // ── Fase 11 · respuesta perdida, timeout y revisión vieja ────────────────
    // Caso A: el servidor procesa y el cliente pierde la respuesta (socket abortado).
    {
      const requestId = newRequestId('lostA');
      const token = newToken();
      const body = { payload: orderPayload({ requestId, token, productId: product.id, quantity: 1, mode: 'pickup', customer: customerR }) };
      const stockPre = (await productSnapshot(product.id)).stock;
      const attempts = [];
      let processed = null;
      for (const abortAfterMs of [60, 120, 250, 500]) {
        const controller = new AbortController();
        const pending = raw('create_order_with_items', body, { jwt: customerR.jwt, signal: controller.signal });
        await sleep(abortAfterMs);
        controller.abort();
        const first = await pending;
        let rows = [];
        for (let i = 0; i < 10 && !rows.length; i += 1) {
          rows = await observe(`select id, public_code, status from public.orders where business_id = ${q(BUSINESS_A)} and client_request_id = ${q(requestId)}`);
          if (!rows.length) await sleep(500);
        }
        attempts.push({ abortAfterMs, clientSawResponse: first.status > 0, clientAborted: Boolean(first.aborted), serverProcessed: rows.length === 1 });
        if (rows.length) { processed = rows[0]; break; }
      }
      // Si ningún corte por tiempo cayó entre «procesado» y «respondido» (depende de la latencia), se usa el corte determinista.
      let dropped = null;
      if (!processed) {
        const find = async () => (await observe(`select id, public_code, status from public.orders where business_id = ${q(BUSINESS_A)} and client_request_id = ${q(requestId)}`))[0] || null;
        dropped = await sendAndDropResponse('create_order_with_items', body, customerR.jwt, async () => Boolean(await find()));
        processed = await find();
      }
      if (processed) registerOrder(processed, 'lost-response-A', { clientRequestId: requestId, quantity: 1, mode: 'pickup' });
      const retry = await raw('create_order_with_items', body, { jwt: customerR.jwt });
      const rowsAfter = await observe(`select id from public.orders where business_id = ${q(BUSINESS_A)} and client_request_id = ${q(requestId)}`);
      if (!processed && rowsAfter[0]) registerOrder({ id: rowsAfter[0].id }, 'lost-response-A', { clientRequestId: requestId, quantity: 1, mode: 'pickup' });
      const stockPost = (await productSnapshot(product.id)).stock;
      conc.lostResponse.caseA = { attempts, dropped, retry: { status: retry.status, sameId: rowOf(retry.data)?.id === (processed?.id || rowsAfter[0]?.id) }, dbOrders: rowsAfter.length, stockPre, stockPost };
      const lostReally = attempts.some((a) => a.clientAborted && !a.clientSawResponse && a.serverProcessed)
        || Boolean(dropped?.serverProcessed && !dropped.responseDeliveredToCaller);
      conc.lostResponse.caseA.mode = attempts.some((a) => a.serverProcessed) ? 'network-abort-before-response' : dropped?.mode || 'none';
      check(P.lost, 'CASE_A_SERVER_PROCESSED_CLIENT_LOST_RESPONSE', lostReally, { mode: conc.lostResponse.caseA.mode, attempts, dropped });
      check(P.lost, 'CASE_A_RETRY_RETURNS_SAME_ORDER_NO_DUPLICATE', retry.status === 200 && rowsAfter.length === 1 && conc.lostResponse.caseA.retry.sameId && stockPost === stockPre - 1,
        conc.lostResponse.caseA);
      if (rowsAfter[0]) raceOrders.push({ id: rowsAfter[0].id, token, requestId, body, label: 'lost-A' });
    }

    // ── Fase 6 · máquina de estados real sobre el MISMO pedido ───────────────
    const tx = async (actor, status, rev, key, phase = P.sm) => {
      const before = await orderState();
      const r = await rpc(actor.client, 'transition_order', { p_order_id: mainOrder.id, p_expected_revision: rev, p_new_status: status, p_idempotency_key: key });
      const after = await orderState();
      recordTransition({ phase, op: 'transition_order', actor: actor.role || actor.label, requested: status, expectedRevision: rev, before: { status: before.status, revision: before.revision },
        response: { ok: r.ok, http: r.status, code: r.code, idempotent_replay: r.data?.idempotent_replay, idempotent_no_op: r.data?.idempotent_no_op, ms: r.ms },
        after: { status: after.status, revision: after.revision } });
      return { r, before, after };
    };

    // Revisión vieja: rechazo inmediato (PT409 → HTTP 409), sin girar.
    let rev = await orderRev();
    const stale = await tx(staff, 'accepted', rev - 1, `cert-stale-${randomBytes(6).toString('hex')}`, P.lost);
    conc.staleRevision.push({ op: 'transition_order', http: stale.r.status, code: stale.r.code, ms: stale.r.ms });
    check(P.lost, 'CASE_C_STALE_REVISION_REJECTED_FAST', !stale.r.ok && stale.r.code === 'PT409' && stale.r.status === 409 && stale.r.ms < 5000
      && stale.after.status === 'received' && stale.after.revision === rev, { http: stale.r.status, code: stale.r.code, ms: stale.r.ms });

    // Dos operadores aceptan a la vez con la misma revisión: gana uno.
    rev = await orderRev();
    const keyStaff = `cert-acc-staff-${randomBytes(6).toString('hex')}`;
    const keyOwner = `cert-acc-owner-${randomBytes(6).toString('hex')}`;
    const [accStaff, accOwner] = await Promise.all([
      raw('transition_order', { p_order_id: mainOrder.id, p_expected_revision: rev, p_new_status: 'accepted', p_idempotency_key: keyStaff }, { jwt: staff.jwt }),
      raw('transition_order', { p_order_id: mainOrder.id, p_expected_revision: rev, p_new_status: 'accepted', p_idempotency_key: keyOwner }, { jwt: owner.jwt }),
    ]);
    const afterAccept = await orderState();
    const acceptEvents = (await orderTruth(mainOrder.id)).events.filter((e) => e.event_type === 'order.status_changed' && e.metadata?.next_status === 'accepted').length;
    conc.doubleAccept = { staff: { http: accStaff.status, code: accStaff.code, ms: accStaff.ms }, owner: { http: accOwner.status, code: accOwner.code, ms: accOwner.ms },
      after: afterAccept, acceptedEvents: acceptEvents };
    const winners = [accStaff, accOwner].filter((r) => r.ok);
    recordTransition({ phase: P.sm, op: 'transition_order (concurrent x2)', actor: 'staff+owner', requested: 'accepted', expectedRevision: rev,
      before: { status: 'received', revision: rev }, response: conc.doubleAccept, after: { status: afterAccept.status, revision: afterAccept.revision } });
    check(P.lost, 'CASE_C_CONCURRENT_SAME_REVISION_ONE_WINNER', winners.length === 1 && [accStaff, accOwner].some((r) => r.status === 409 && r.code === 'PT409')
      && afterAccept.status === 'accepted' && acceptEvents === 1, conc.doubleAccept);
    check(P.sm, 'RECEIVED_TO_ACCEPTED', afterAccept.status === 'accepted' && afterAccept.revision === rev + 1, afterAccept);
    const winnerKey = accStaff.ok ? keyStaff : keyOwner;
    const winnerActor = accStaff.ok ? staff : owner;
    const replayAccept = await tx(winnerActor, 'accepted', rev, winnerKey, P.idem);
    check(P.idem, 'TRANSITION_REPLAY_SAME_KEY_IDEMPOTENT', replayAccept.r.ok && replayAccept.r.data?.idempotent_replay === true && replayAccept.after.revision === rev + 1,
      { replay: replayAccept.r.data?.idempotent_replay, revision: replayAccept.after.revision });
    const reusedKey = await tx(winnerActor, 'preparing', rev + 1, winnerKey, P.neg);
    negatives.push({ name: 'NEG_TRANSITION_KEY_REUSED_OTHER_PAYLOAD', http: reusedKey.r.status, code: reusedKey.r.code });
    check(P.neg, 'NEG_TRANSITION_KEY_REUSED_OTHER_PAYLOAD', !reusedKey.r.ok && reusedKey.r.code === '23505' && reusedKey.after.status === 'accepted', { code: reusedKey.r.code });
    const sameStatus = await tx(staff, 'accepted', rev + 1, `cert-same-${randomBytes(6).toString('hex')}`, P.neg);
    negatives.push({ name: 'NEG_REPEATED_TRANSITION_IS_NOOP', ok: sameStatus.r.ok, no_op: sameStatus.r.data?.idempotent_no_op });
    check(P.neg, 'NEG_REPEATED_TRANSITION_IS_NOOP', sameStatus.r.ok && sameStatus.r.data?.idempotent_no_op === true && sameStatus.after.revision === rev + 1, sameStatus.r.data && { no_op: sameStatus.r.data.idempotent_no_op });

    const pAcc = await panelRow('accepted');
    check(P.panel, 'PANEL_SEES_ACCEPTED', pAcc.row?.status === 'accepted', panelLog.at(-1)?.row);
    const trAcc = await track('accepted');
    check(P.track, 'TRACKING_SEES_ACCEPTED', trAcc.data?.status === 'accepted', trAcc.data);

    // Panel real (UI), si se pidió: el mismo pedido, visto en pantalla. No decide la certificación del backend.
    if (flag('--panel-ui')) {
      const ui = await panelUiEvidence({ orderId: mainOrder.id, publicCode: mainOrder.public_code, credentialName: CREDENTIALS.staff, distDir: opt('--panel-ui-dist') });
      // Sesiones de identidad que el Panel haya abierto y no cerrado (el cierre por pantalla es parte de la prueba).
      const uiSessions = (await observe(`select count(*)::int n from public.identity_sessions where user_id = ${q(staff.userId)} and revoked_at is null
        and first_seen_at > now() - interval '15 minutes' and coalesce(device_label, '') not like ${q(`${RUN_ID}%`)}`))[0].n;
      write('panel-ui.json', { contract: 'Panel real en navegador: ingreso por formulario + tarjeta del mismo ORDER_ID', orderId: mainOrder.id, publicCode: mainOrder.public_code,
        results: ui, panelSessionsLeftOpen: uiSessions });
      for (const r of ui) {
        if (r.result === 'NOT_RUN') { log(`SKIP [P5B_PANEL_UI] ${r.label}: ${r.reason}`); continue; }
        check('P5B_PANEL_UI', `PANEL_UI_SHOWS_SAME_ORDER_${r.label.toUpperCase().replaceAll('-', '_')}`, r.result === 'PASS', { error: r.error, card: r.cardText?.slice(0, 160), jsErrors: r.jsErrors });
      }
    }

    // Caso B: timeout durante la transición accepted → preparing, y reintento.
    rev = await orderRev();
    const keyPrep = `cert-prep-${randomBytes(6).toString('hex')}`;
    const prepBody = { p_order_id: mainOrder.id, p_expected_revision: rev, p_new_status: 'preparing', p_idempotency_key: keyPrep };
    const prepAttempts = [];
    let prepApplied = false;
    for (const abortAfterMs of [60, 120, 250, 500]) {
      const controller = new AbortController();
      const pending = raw('transition_order', prepBody, { jwt: staff.jwt, signal: controller.signal });
      await sleep(abortAfterMs);
      controller.abort();
      const first = await pending;
      let state = null;
      for (let i = 0; i < 10; i += 1) { state = await orderState(); if (state.status === 'preparing') break; await sleep(500); }
      prepAttempts.push({ abortAfterMs, clientSawResponse: first.status > 0, clientAborted: Boolean(first.aborted), serverApplied: state.status === 'preparing' });
      if (state.status === 'preparing') { prepApplied = true; break; }
    }
    let prepDropped = null;
    if (!prepApplied) {
      prepDropped = await sendAndDropResponse('transition_order', prepBody, staff.jwt, async () => (await orderState()).status === 'preparing');
      prepApplied = prepDropped.serverProcessed;
    }
    const prepRetry = await raw('transition_order', prepBody, { jwt: staff.jwt });
    const afterPrep = await orderState();
    const prepEvents = (await orderTruth(mainOrder.id)).events.filter((e) => e.event_type === 'order.status_changed' && e.metadata?.next_status === 'preparing').length;
    conc.lostResponse.caseB = { mode: prepAttempts.some((a) => a.serverApplied) ? 'network-abort-before-response' : prepDropped?.mode || 'none', attempts: prepAttempts, dropped: prepDropped, retry: { http: prepRetry.status, code: prepRetry.code, idempotent_replay: prepRetry.data?.idempotent_replay }, after: afterPrep, preparingEvents: prepEvents };
    recordTransition({ phase: P.sm, op: 'transition_order (response lost + retry same key)', actor: 'staff', requested: 'preparing', expectedRevision: rev,
      before: { status: 'accepted', revision: rev }, response: conc.lostResponse.caseB, after: { status: afterPrep.status, revision: afterPrep.revision } });
    check(P.lost, 'CASE_B_TIMEOUT_DURING_TRANSITION_RETRY_SAFE', prepApplied && (prepAttempts.some((a) => a.clientAborted && !a.clientSawResponse && a.serverApplied) || Boolean(prepDropped?.serverProcessed && !prepDropped.responseDeliveredToCaller))
      && prepRetry.status === 200 && prepRetry.data?.idempotent_replay === true && afterPrep.status === 'preparing' && afterPrep.revision === rev + 1 && prepEvents === 1,
    conc.lostResponse.caseB);
    check(P.sm, 'ACCEPTED_TO_PREPARING', afterPrep.status === 'preparing', afterPrep);

    rev = await orderRev();
    const toReady = await tx(staff, 'ready', rev, `cert-ready-${randomBytes(6).toString('hex')}`);
    check(P.sm, 'PREPARING_TO_READY', toReady.r.ok && toReady.after.status === 'ready' && toReady.after.revision === rev + 1, toReady.after);

    // Transiciones inválidas con el pedido en ready.
    rev = await orderRev();
    for (const [name, actor, status, code] of [
      ['NEG_UNKNOWN_STATUS', staff, 'shipped', '22023'],
      ['NEG_BUSINESS_DELIVERS_DELIVERY_WITHOUT_CODE', staff, 'delivered', '23514'],
      ['NEG_BUSINESS_TAKES_RIDER_EDGE', staff, 'assigned', '23514'],
      ['NEG_BACKWARDS_READY_TO_PREPARING', staff, 'preparing', '23514'],
      ['NEG_CUSTOMER_CANNOT_OPERATE', customerA, 'accepted', '42501'],
      ['NEG_RIDER_CANNOT_USE_OPERATOR_RPC', rider2, 'assigned', '42501'],
    ]) {
      const r = await tx(actor, status, rev, `cert-neg-${randomBytes(6).toString('hex')}`, P.neg);
      negatives.push({ name, http: r.r.status, code: r.r.code, statusAfter: r.after.status });
      check(P.neg, name, !r.r.ok && r.r.code === code && r.after.status === 'ready' && r.after.revision === rev, { http: r.r.status, code: r.r.code }, code);
    }
    const missing = await rpc(staff.client, 'transition_order', { p_order_id: randomUUID(), p_expected_revision: 1, p_new_status: 'accepted', p_idempotency_key: `cert-missing-${randomBytes(6).toString('hex')}` });
    negatives.push({ name: 'NEG_ORDER_ID_NONEXISTENT', http: missing.status, code: missing.code });
    check(P.neg, 'NEG_ORDER_ID_NONEXISTENT', !missing.ok && missing.code === 'P0002', { code: missing.code });

    // ── Fase 7 · rider ───────────────────────────────────────────────────────
    let b1 = await board(rider1, 'before-availability');
    const setAvail = async (rider, value) => {
      const cur = await board(rider, 'read-availability-version');
      const version = Number(cur.data?.availability_version || 0);
      const r = await rpc(rider.client, 'set_rider_availability', { p_business_id: BUSINESS_A, p_available: value, p_expected_version: version,
        p_idempotency_key: riderKey('availability', BUSINESS_A, version, String(value)) });
      if (value) await rpc(rider.client, 'heartbeat_rider_availability', { p_business_id: BUSINESS_A });
      ledger.availability.push({ rider: rider.role, userId: rider.userId, value, at: nowIso(), ok: r.ok && r.data?.ok !== false });
      persistLedger();
      return r;
    };
    const av = await setAvail(rider1, true);
    heartbeat.timer = setInterval(() => { void rpc(rider1.client, 'heartbeat_rider_availability', { p_business_id: BUSINESS_A }); }, 30_000);
    b1 = await board(rider1, 'available');
    const availability = await rpc(staff.client, 'list_business_rider_availability', { p_business_id: BUSINESS_A });
    const r1Visible = JSON.stringify(availability.data || '').includes(rider1.userId);
    check(P.rider, 'RIDER_AVAILABILITY_ON_AND_VISIBLE_TO_PANEL', av.ok && b1.data?.available === true && availability.ok && r1Visible, { set: av.data, board: b1.data?.available });

    rev = await orderRev();
    const offer = await rpc(staff.client, 'offer_order_to_rider', { p_order_id: mainOrder.id, p_expected_status: 'ready', p_expected_rider_user_id: null, p_new_rider_user_id: rider1.userId });
    recordTransition({ phase: P.rider, op: 'offer_order_to_rider', actor: 'staff', requested: 'offer->rider1', expectedRevision: rev, before: { status: 'ready', revision: rev },
      response: { ok: offer.ok, code: offer.code || offer.data?.code, offer_id: offer.data?.offer_id, version: offer.data?.version }, after: await orderState() });
    check(P.rider, 'OFFER_CREATED_BY_PANEL_CONTRACT', offer.ok && offer.data?.ok === true && offer.data?.code === 'offered', offer.data || offer.code);
    const dupOffer = await rpc(staff.client, 'offer_order_to_rider', { p_order_id: mainOrder.id, p_expected_status: 'ready', p_expected_rider_user_id: null, p_new_rider_user_id: rider1.userId });
    const inFlight = await rpc(staff.client, 'offer_order_to_rider', { p_order_id: mainOrder.id, p_expected_status: 'ready', p_expected_rider_user_id: null, p_new_rider_user_id: rider2.userId });
    check(P.rider, 'OFFER_DEDUP_AND_IN_FLIGHT_GUARD', dupOffer.data?.code === 'already_offered' && ['offer_in_flight', 'rider_unavailable'].includes(inFlight.data?.code),
      { duplicate: dupOffer.data?.code, other: inFlight.data?.code });
    b1 = await board(rider1, 'offer-pending');
    const b2 = await board(rider2, 'offer-pending-other-rider');
    const offerOnBoard = (b1.data?.offers || []).find((f) => (f.offer_id || f.id) === offer.data?.offer_id);
    check(P.rider, 'RIDER_BOARD_SHOWS_OFFER_ONLY_TO_TARGET', Boolean(offerOnBoard) && !(b2.data?.offers || []).some((f) => (f.offer_id || f.id) === offer.data?.offer_id),
      { rider1Offers: (b1.data?.offers || []).length, rider2Offers: (b2.data?.offers || []).length });
    const wrongAccept = await rpc(rider2.client, 'accept_rider_order_offer', { p_offer_id: offer.data.offer_id, p_expected_version: offer.data.version,
      p_idempotency_key: riderKey('accept_rider_order_offer', offer.data.offer_id, offer.data.version) });
    rls.push({ name: 'WRONG_RIDER_ACCEPTS_OFFER', actor: 'rider2', ok: wrongAccept.ok, code: wrongAccept.code || wrongAccept.data?.code });
    check(P.rls, 'WRONG_RIDER_CANNOT_ACCEPT_OFFER', !wrongAccept.ok || wrongAccept.data?.ok === false, { code: wrongAccept.code || wrongAccept.data?.code });
    const offerVersion = Number(offerOnBoard?.version ?? offer.data.version);
    const acceptKey = riderKey('accept_rider_order_offer', offer.data.offer_id, offerVersion);
    const accepted = await rpc(rider1.client, 'accept_rider_order_offer', { p_offer_id: offer.data.offer_id, p_expected_version: offerVersion, p_idempotency_key: acceptKey });
    const afterAssign = await orderState();
    recordTransition({ phase: P.rider, op: 'accept_rider_order_offer', actor: 'rider1', requested: 'assigned', expectedRevision: offerVersion,
      before: { status: 'ready' }, response: { ok: accepted.ok && accepted.data?.ok, code: accepted.data?.code || accepted.code }, after: { status: afterAssign.status, revision: afterAssign.revision } });
    check(P.rider, 'RIDER_ACCEPTS_OFFER_ASSIGNED', accepted.ok && accepted.data?.ok === true && afterAssign.status === 'assigned' && afterAssign.assigned_rider_user_id === rider1.userId,
      { code: accepted.data?.code, status: afterAssign.status });
    const acceptReplay = await rpc(rider1.client, 'accept_rider_order_offer', { p_offer_id: offer.data.offer_id, p_expected_version: offerVersion, p_idempotency_key: acceptKey });
    check(P.idem, 'RIDER_ACCEPT_REPLAY_IDEMPOTENT', acceptReplay.ok && acceptReplay.data?.idempotent_no_op === true && (await orderState()).revision === afterAssign.revision,
      { replay: acceptReplay.data?.idempotent_no_op });
    const pAssigned = await panelRow('assigned');
    check(P.panel, 'PANEL_SEES_ASSIGNED_RIDER', pAssigned.row?.status === 'assigned' && pAssigned.row?.assigned_rider_user_id === rider1.userId, panelLog.at(-1)?.row);
    const trAssigned = await track('assigned');
    check(P.track, 'TRACKING_SEES_ASSIGNED', trAssigned.data?.status === 'assigned', trAssigned.data);
    b1 = await board(rider1, 'assigned');
    const riderOrder = (b1.data?.orders || []).find((x) => x.id === mainOrder.id);
    check(P.rider, 'RIDER_BOARD_SHOWS_SAME_ORDER_ITEMS_TOTAL', Boolean(riderOrder) && riderOrder.status === 'assigned' && Number(riderOrder.total) === Number(o.total)
      && riderOrder.order_items?.length === 1 && Number(riderOrder.order_items[0].quantity) === quantity && Boolean(riderOrder.customer_location),
    riderLog.at(-1));

    // Rider equivocado: no ve ni opera el pedido.
    const wrongRead = await restGet(`orders?select=id,status&id=eq.${mainOrder.id}`, rider2.jwt);
    rls.push({ name: 'WRONG_RIDER_READS_ORDER', http: wrongRead.status, rows: wrongRead.rows?.length ?? null });
    check(P.rls, 'WRONG_RIDER_CANNOT_READ_ORDER', wrongRead.status === 200 && wrongRead.rows?.length === 0, wrongRead);
    const r2rev = await orderRev();
    for (const fn of ['mark_delivery_picked_up', 'start_rider_delivery', 'mark_rider_arrived']) {
      const r = await rpc(rider2.client, fn, { p_order_id: mainOrder.id, p_expected_revision: r2rev, p_idempotency_key: riderKey(fn, mainOrder.id, r2rev) });
      rls.push({ name: `WRONG_RIDER_${fn}`, ok: r.ok, code: r.code || r.data?.code });
      check(P.rls, `WRONG_RIDER_CANNOT_${fn.toUpperCase()}`, (!r.ok || r.data?.ok === false) && (await orderState()).status === 'assigned', { code: r.code || r.data?.code });
    }
    const riderRead = await restGet(`orders?select=id,status,total&id=eq.${mainOrder.id}`, rider1.jwt);
    check(P.rider, 'ASSIGNED_RIDER_READS_ORDER_VIA_RLS', riderRead.status === 200 && riderRead.rows?.length === 1 && riderRead.rows[0].status === 'assigned', riderRead);

    // Pickup con revisión vieja, después la buena.
    let cur = await orderState();
    const stalePick = await rpc(rider1.client, 'mark_delivery_picked_up', { p_order_id: mainOrder.id, p_expected_revision: cur.revision - 1,
      p_idempotency_key: riderKey('mark_delivery_picked_up', mainOrder.id, cur.revision - 1) });
    conc.staleRevision.push({ op: 'mark_delivery_picked_up', ok: stalePick.ok, code: stalePick.data?.code, ms: stalePick.ms });
    check(P.lost, 'RIDER_STALE_REVISION_REJECTED', stalePick.ok && stalePick.data?.ok === false && stalePick.data?.code === 'stale_revision' && (await orderState()).status === 'assigned',
      stalePick.data);
    const riderStep = async (fn, expectStatus) => {
      const before = await orderState();
      const key = riderKey(fn, mainOrder.id, before.revision);
      const r = await rpc(rider1.client, fn, { p_order_id: mainOrder.id, p_expected_revision: before.revision, p_idempotency_key: key });
      const after = await orderState();
      recordTransition({ phase: P.rider, op: fn, actor: 'rider1', requested: expectStatus, expectedRevision: before.revision, before: { status: before.status, revision: before.revision },
        response: { ok: r.ok && r.data?.ok, code: r.code || r.data?.code || r.data?.outcome, ms: r.ms }, after: { status: after.status, revision: after.revision } });
      check(P.sm, `${before.status.toUpperCase()}_TO_${expectStatus.toUpperCase()}`, r.ok && r.data?.ok === true && after.status === expectStatus && after.revision > before.revision, { code: r.data?.code, after });
      const again = await rpc(rider1.client, fn, { p_order_id: mainOrder.id, p_expected_revision: before.revision, p_idempotency_key: key });
      check(P.idem, `RIDER_${fn.toUpperCase()}_REPLAY_IDEMPOTENT`, again.ok && again.data?.idempotent_no_op === true && (await orderState()).revision === after.revision, { replay: again.data?.idempotent_no_op });
      return { r, before, after };
    };
    await riderStep('mark_delivery_picked_up', 'picked_up');
    const trPicked = await track('picked_up');
    check(P.track, 'TRACKING_SEES_PICKED_UP', trPicked.data?.status === 'picked_up', trPicked.data);
    await riderStep('start_rider_delivery', 'on_the_way');
    const gps = await rpc(rider1.client, 'publish_rider_location_fanout', { p_lat: -38.9488, p_lng: -68.0562, p_accuracy: 12, p_heading: 210, p_speed: 6,
      p_captured_at: nowIso(), p_idempotency_key: randomUUID(), p_is_mock: false });
    await sleep(500);
    const trWay = await track('on_the_way');
    check(P.rider, 'RIDER_GPS_RECEIPT_ACCEPTED', gps.ok && gps.data?.ok !== false, { ok: gps.ok, code: gps.code || gps.data?.code });
    check(P.track, 'TRACKING_SEES_ON_THE_WAY_WITH_COARSE_GPS', trWay.data?.status === 'on_the_way' && trWay.data?.rider_location
      && Number(trWay.data.rider_location.accuracy) >= 100 && String(trWay.data.rider_location.lat).split('.')[1]?.length <= 4, trWay.data);
    const panelOnWay = await panelRow('on_the_way');
    check(P.panel, 'PANEL_SEES_ON_THE_WAY', panelOnWay.row?.status === 'on_the_way', panelLog.at(-1)?.row);
    await riderStep('mark_rider_arrived', 'arrived');
    const trArrived = await track('arrived');
    check(P.track, 'TRACKING_SEES_ARRIVED', trArrived.data?.status === 'arrived', trArrived.data);

    // ── Fase 9 · código de entrega ───────────────────────────────────────────
    const issued = await rpc(customerA.client, 'issue_order_delivery_code', { p_order_id: mainOrder.id, p_tracking_token: mainToken });
    deliveryCode = secret(String(issued.data?.delivery_code || ''));
    check(P.code, 'CUSTOMER_OBTAINS_CODE_WITH_TOKEN', issued.ok && /^[0-9]{4}$/.test(deliveryCode), { ok: issued.ok, code: issued.code });
    const reissued = await rpc(customerA.client, 'issue_order_delivery_code', { p_order_id: mainOrder.id, p_tracking_token: mainToken });
    check(P.code, 'CODE_STABLE_ON_REISSUE', reissued.ok && String(reissued.data?.delivery_code) === deliveryCode, { same: String(reissued.data?.delivery_code) === deliveryCode });
    const otherCustomerCode = await rpc(customerB.client, 'issue_order_delivery_code', { p_order_id: mainOrder.id, p_tracking_token: mainToken });
    const wrongTokenCode = await rpc(customerA.client, 'issue_order_delivery_code', { p_order_id: mainOrder.id, p_tracking_token: newToken() });
    rls.push({ name: 'OTHER_CUSTOMER_ISSUES_CODE', code: otherCustomerCode.code }, { name: 'WRONG_TOKEN_ISSUES_CODE', code: wrongTokenCode.code });
    check(P.code, 'CODE_NOT_ISSUED_TO_OTHER_CUSTOMER_OR_WRONG_TOKEN', !otherCustomerCode.ok && otherCustomerCode.code === '42501' && !wrongTokenCode.ok && wrongTokenCode.code === '42501',
      { other: otherCustomerCode.code, wrongToken: wrongTokenCode.code });
    cur = await orderState();
    const wrongCode = String(((Number(deliveryCode) - 1000 + 1) % 9000) + 1000);
    const wrong = await rpc(rider1.client, 'confirm_delivery_code', { p_order_id: mainOrder.id, p_expected_revision: cur.revision, p_delivery_code: wrongCode,
      p_idempotency_key: riderKey('confirm_delivery_code', mainOrder.id, cur.revision, wrongCode) });
    check(P.code, 'WRONG_CODE_REJECTED', wrong.ok && wrong.data?.ok === false && wrong.data?.code === 'incorrect_code' && (await orderState()).status === 'arrived',
      { code: wrong.data?.code, remaining: wrong.data?.remaining_attempts });
    cur = await orderState();
    const r2code = await rpc(rider2.client, 'confirm_delivery_code', { p_order_id: mainOrder.id, p_expected_revision: cur.revision, p_delivery_code: deliveryCode,
      p_idempotency_key: riderKey('confirm_delivery_code', mainOrder.id, cur.revision, deliveryCode) + '-r2' });
    rls.push({ name: 'WRONG_RIDER_CONFIRMS_CODE', code: r2code.code || r2code.data?.code });
    check(P.rls, 'WRONG_RIDER_CANNOT_CONFIRM_CODE', (!r2code.ok || r2code.data?.ok === false) && (await orderState()).status === 'arrived', { code: r2code.code || r2code.data?.code });
    const staffDeliver = await tx(staff, 'delivered', cur.revision, `cert-staffdeliver-${randomBytes(6).toString('hex')}`, P.neg);
    check(P.neg, 'NEG_BUSINESS_CANNOT_CLOSE_RIDER_DELIVERY', !staffDeliver.r.ok && staffDeliver.after.status === 'arrived', { code: staffDeliver.r.code });
    cur = await orderState();
    const confirmKey = riderKey('confirm_delivery_code', mainOrder.id, cur.revision, deliveryCode);
    const right = await rpc(rider1.client, 'confirm_delivery_code', { p_order_id: mainOrder.id, p_expected_revision: cur.revision, p_delivery_code: deliveryCode, p_idempotency_key: confirmKey });
    const afterDelivered = await orderState();
    recordTransition({ phase: P.code, op: 'confirm_delivery_code', actor: 'rider1', requested: 'delivered', expectedRevision: cur.revision, before: { status: 'arrived', revision: cur.revision },
      response: { ok: right.ok && right.data?.ok, outcome: right.data?.outcome }, after: { status: afterDelivered.status, revision: afterDelivered.revision } });
    check(P.code, 'RIGHT_CODE_DELIVERS', right.ok && right.data?.ok === true && right.data?.outcome === 'confirmed' && afterDelivered.status === 'delivered', { outcome: right.data?.outcome });
    check(P.sm, 'ARRIVED_TO_DELIVERED', afterDelivered.status === 'delivered', afterDelivered);
    const sameKeyReplay = await rpc(rider1.client, 'confirm_delivery_code', { p_order_id: mainOrder.id, p_expected_revision: cur.revision, p_delivery_code: deliveryCode, p_idempotency_key: confirmKey });
    const newKeyReplay = await rpc(rider1.client, 'confirm_delivery_code', { p_order_id: mainOrder.id, p_expected_revision: afterDelivered.revision, p_delivery_code: deliveryCode,
      p_idempotency_key: riderKey('confirm_delivery_code', mainOrder.id, afterDelivered.revision, deliveryCode) });
    const deliveredEvents = (await orderTruth(mainOrder.id)).events.filter((e) => e.event_type === 'order.status_changed' && e.metadata?.next_status === 'delivered').length;
    check(P.code, 'CODE_REPLAY_DOES_NOT_REDELIVER', sameKeyReplay.data?.idempotent_no_op === true && newKeyReplay.data?.outcome === 'already_delivered'
      && deliveredEvents === 1 && (await orderState()).revision === afterDelivered.revision, { sameKey: sameKeyReplay.data?.outcome || sameKeyReplay.data?.idempotent_no_op, newKey: newKeyReplay.data?.outcome, deliveredEvents });
    const reissueAfter = await rpc(customerA.client, 'issue_order_delivery_code', { p_order_id: mainOrder.id, p_tracking_token: mainToken });
    check(P.code, 'NO_CODE_AFTER_DELIVERY', !reissueAfter.ok && reissueAfter.code === '55000', { code: reissueAfter.code });
    const afterTerminal = await tx(staff, 'preparing', afterDelivered.revision, `cert-terminal-${randomBytes(6).toString('hex')}`, P.neg);
    const cancelDelivered = await rpc(owner.client, 'cancel_order', { p_order_id: mainOrder.id, p_expected_revision: afterDelivered.revision, p_reason: 'QA intento cancelar entregado',
      p_idempotency_key: `cert-cancel-delivered-${randomBytes(6).toString('hex')}` });
    negatives.push({ name: 'NEG_TERMINAL_STATE_LOCKED', code: afterTerminal.r.code }, { name: 'NEG_CANCEL_DELIVERED', code: cancelDelivered.code });
    check(P.neg, 'NEG_TERMINAL_STATE_LOCKED', !afterTerminal.r.ok && afterTerminal.r.code === '23514' && !cancelDelivered.ok && (await orderState()).status === 'delivered',
      { transition: afterTerminal.r.code, cancel: cancelDelivered.code });

    // Cobro en efectivo (pago manual) confirmado una sola vez.
    cur = await orderState();
    const payKey = `cert-pay-${randomBytes(6).toString('hex')}`;
    const pay = await rpc(staff.client, 'confirm_manual_order_payment', { p_order_id: mainOrder.id, p_expected_revision: cur.revision, p_actual_method: 'cash', p_idempotency_key: payKey });
    if (pay.ok) { ledger.manualPayments.push({ order: mainOrder.id, confirmed: true, reversed: false }); persistLedger(); }
    const payAgain = await rpc(staff.client, 'confirm_manual_order_payment', { p_order_id: mainOrder.id, p_expected_revision: cur.revision, p_actual_method: 'cash', p_idempotency_key: payKey });
    const cashEvents = (await orderTruth(mainOrder.id)).events.filter((e) => e.event_type === 'order.manual_payment_confirmed').length;
    check(P.sm, 'CASH_PAYMENT_CONFIRMED_ONCE', pay.ok && pay.data?.ok === true && payAgain.data?.idempotent_replay === true && cashEvents === 1
      && (await orderState()).manual_payment_status === 'confirmed', { pay: pay.data?.code || pay.code, again: payAgain.data?.idempotent_replay, cashEvents });

    const panelDelivered = await panelRow('delivered');
    check(P.panel, 'PANEL_INBOX_RELEASES_DELIVERED_ORDER', panelDelivered.snap.ok && !panelDelivered.row, { found: Boolean(panelDelivered.row) });
    const panelEventsFinal = await panelRepo.fetchOrderEvents(mainOrder.id);
    const trDelivered = await track('delivered');
    const b1Final = await board(rider1, 'delivered');
    check(P.rider, 'RIDER_BOARD_RELEASES_DELIVERED_ORDER', !(b1Final.data?.orders || []).some((x) => x.id === mainOrder.id), { orders: (b1Final.data?.orders || []).length });
    const riderAfter = await restGet(`orders?select=id&id=eq.${mainOrder.id}`, rider1.jwt);
    check(P.rls, 'RIDER_LOSES_READ_ACCESS_AFTER_DELIVERY', riderAfter.status === 200 && riderAfter.rows?.length === 0, riderAfter);

    // ── Fase 8b · tracking negativo ──────────────────────────────────────────
    const otherOrder = raceOrders[0];
    const crossToken = await track('cross-order-with-main-token', mainToken, otherOrder?.public_code);
    const wrongToken = await track('wrong-token', newToken(), mainOrder.public_code);
    const enumeration = [];
    const codeNum = Number(String(mainOrder.public_code).replace(/\D/g, ''));
    for (let d = -3; d <= 3; d += 1) {
      if (!d) continue;
      const candidate = `LT-${String(codeNum + d).padStart(4, '0')}`;
      const r = await track(`enumerate:${candidate}`, mainToken, candidate);
      enumeration.push({ candidate, data: r.data, code: r.code });
    }
    const anonTrack = await raw('get_public_order_tracking', { p_public_id: mainOrder.public_code });
    const uuidLookup = await track('lookup-by-uuid-other-order', mainToken, otherOrder?.id);
    check(P.track, 'TRACKING_OTHER_ORDER_WITH_MY_TOKEN_IS_NULL', crossToken.ok && crossToken.data === null, crossToken.data);
    check(P.track, 'TRACKING_WRONG_TOKEN_IS_NULL', wrongToken.ok && wrongToken.data === null, wrongToken.data);
    check(P.track, 'TRACKING_ENUMERATION_RETURNS_NOTHING', enumeration.every((e) => e.data === null), enumeration);
    check(P.track, 'TRACKING_WITHOUT_TOKEN_IS_NULL', anonTrack.ok && anonTrack.data === null, { http: anonTrack.status, data: anonTrack.data });
    check(P.track, 'TRACKING_UUID_OF_OTHER_ORDER_IS_NULL', uuidLookup.ok && uuidLookup.data === null, uuidLookup.data);
    const custWrite = await restPatch(`orders?id=eq.${mainOrder.id}`, { status: 'cancelled' }, customerA.jwt);
    check(P.track, 'CUSTOMER_CANNOT_WRITE_ORDER', custWrite.status >= 400 || (custWrite.rows || []).length === 0, custWrite);
    check(P.track, 'TRACKING_TERMINAL_STATE_CONSISTENT', trDelivered.ok && (trDelivered.data === null || trDelivered.data?.status === 'delivered'),
      { visible: trDelivered.data !== null, status: trDelivered.data?.status, until: trDelivered.data?.terminal_visible_until });

    // ── Fase 12 · RLS y autorización ─────────────────────────────────────────
    const denyRead = async (name, jwt) => {
      const r = await restGet(`orders?select=id,status,customer_phone&id=eq.${mainOrder.id}`, jwt);
      const items = await restGet(`order_items?select=id&order_id=eq.${mainOrder.id}`, jwt);
      const events = await restGet(`order_events?select=id&order_id=eq.${mainOrder.id}`, jwt);
      const list = await restGet(`orders?select=id&business_id=eq.${BUSINESS_A}&limit=5`, jwt);
      rls.push({ name: `${name}_READ`, orders: [r.status, r.rows?.length ?? r.code], items: [items.status, items.rows?.length ?? items.code],
        events: [events.status, events.rows?.length ?? events.code], list: [list.status, list.rows?.length ?? list.code] });
      check(P.rls, `${name}_CANNOT_READ_OR_LIST`, (r.rows?.length ?? 0) === 0 && (items.rows?.length ?? 0) === 0 && (events.rows?.length ?? 0) === 0 && (list.rows?.length ?? 0) === 0,
        rls.at(-1));
    };
    const denyOps = async (name, jwt) => {
      const st = await orderState();
      const ops = {
        transition: await raw('transition_order', { p_order_id: mainOrder.id, p_expected_revision: st.revision, p_new_status: 'cancelled', p_idempotency_key: `cert-rls-${randomBytes(6).toString('hex')}` }, { jwt }),
        cancel: await raw('cancel_order', { p_order_id: mainOrder.id, p_expected_revision: st.revision, p_reason: 'QA RLS negativo', p_idempotency_key: `cert-rls-${randomBytes(6).toString('hex')}` }, { jwt }),
        offer: await raw('offer_order_to_rider', { p_order_id: mainOrder.id, p_expected_status: 'ready', p_expected_rider_user_id: null, p_new_rider_user_id: rider2.userId }, { jwt }),
        panelCenter: await raw('get_production_operation_center', { p_business_id: BUSINESS_A }, { jwt }),
        riderAvailability: await raw('list_business_rider_availability', { p_business_id: BUSINESS_A }, { jwt }),
        reversePayment: await raw('reverse_manual_order_payment', { p_order_id: mainOrder.id, p_expected_revision: st.revision, p_reason: 'QA RLS negativo intento', p_idempotency_key: `cert-rls-${randomBytes(6).toString('hex')}` }, { jwt }),
        classify: await raw('classify_order_as_qa', { p_order_id: mainOrder.id, p_reason: 'rls_negative' }, { jwt }),
        directUpdate: await restPatch(`orders?id=eq.${mainOrder.id}`, { customer_notes: 'pwned' }, jwt),
        openStore: await raw('set_business_open_state', { p_business_id: BUSINESS_A, p_status: 'closed' }, { jwt }),
      };
      const st2 = await orderState();
      const summary = Object.fromEntries(Object.entries(ops).map(([k, r]) => [k, { http: r.status, code: r.code || null, okData: r.ok ? (r.data?.ok ?? (Array.isArray(r.rows) ? r.rows.length : 'ok')) : null }]));
      rls.push({ name: `${name}_OPERATE`, ...summary, stateUnchanged: st2.status === st.status && st2.revision === st.revision });
      const allDenied = Object.entries(ops).every(([k, r]) => (k === 'directUpdate' ? (r.status >= 400 || (r.rows || []).length === 0) : (!r.ok || r.data?.ok === false)));
      check(P.rls, `${name}_CANNOT_OPERATE`, allDenied && st2.status === st.status && st2.revision === st.revision, summary);
      const notes = (await observe(`select customer_notes from public.orders where id = ${q(mainOrder.id)}`))[0].customer_notes;
      check(P.rls, `${name}_NO_DATA_CHANGE`, notes === NOTES, { notesIntact: notes === NOTES });
      const businessStatus = (await observe(`select status from public.businesses where id = ${q(BUSINESS_A)}`))[0].status;
      check(P.rls, `${name}_CANNOT_CLOSE_STORE`, businessStatus === 'open', { businessStatus });
    };
    await denyRead('UNAUTHENTICATED', null);
    await denyOps('UNAUTHENTICATED', null);
    await denyRead('AUTHENTICATED_NO_MEMBERSHIP', sr.noMembership.jwt);
    await denyOps('AUTHENTICATED_NO_MEMBERSHIP', sr.noMembership.jwt);
    await denyRead('ANONYMOUS_OTHER_CUSTOMER', customerB.jwt);
    await denyOps('ANONYMOUS_OTHER_CUSTOMER', customerB.jwt);
    await denyRead('OTHER_BUSINESS_OWNER', sr.otherOwner.jwt);
    await denyOps('OTHER_BUSINESS_OWNER', sr.otherOwner.jwt);
    const crossSession = await rpc(sr.otherOwner.client, 'identity_register_session', { p_business_id: BUSINESS_A, p_client: 'panel_web', p_device_label: `${RUN_ID} cross`, p_device_key_hash: null, p_app_version: 'taba-e2e-cert' });
    check(P.rls, 'OTHER_BUSINESS_OWNER_CANNOT_REGISTER_SESSION_IN_A', crossSession.data?.ok === false, crossSession.data || crossSession.code);
    const anonSession = await rpc(customerB.client, 'identity_register_session', { p_business_id: BUSINESS_A, p_client: 'panel_web', p_device_label: `${RUN_ID} anon`, p_device_key_hash: null, p_app_version: 'taba-e2e-cert' });
    check(P.rls, 'ANONYMOUS_CANNOT_REGISTER_OPERATOR_SESSION', anonSession.data?.ok === false, anonSession.data || anonSession.code);
    await denyOps('WRONG_RIDER', rider2.jwt);
    const customerOwn = await restGet(`orders?select=id,status&id=eq.${mainOrder.id}`, customerA.jwt);
    check(P.rls, 'OWNING_CUSTOMER_READS_OWN_ORDER_ONLY', customerOwn.status === 200 && customerOwn.rows?.length === 1
      && ((await restGet(`orders?select=id&business_id=eq.${BUSINESS_A}`, customerA.jwt)).rows || []).every((r) => ledger.orders.some((x) => x.id === r.id && ['main'].includes(x.label))), customerOwn);
    const staffSeesNotes = await restGet(`orders?select=id,customer_phone&id=eq.${mainOrder.id}`, staff.jwt);
    check(P.rls, 'BUSINESS_MEMBER_WITH_SESSION_READS_ORDER', staffSeesNotes.status === 200 && staffSeesNotes.rows?.length === 1, { http: staffSeesNotes.status, rows: staffSeesNotes.rows?.length });
    // Un miembro sin sesión de identidad registrada no tiene rol efectivo.
    const bare = newClient();
    const ownerCred = leerSecreto(CREDENTIALS.owner);
    const bareLogin = await bare.auth.signInWithPassword({ email: ownerCred.usuario, password: ownerCred.secreto });
    const bareJwt = bareLogin.data?.session?.access_token;
    const bareRead = await restGet(`orders?select=id&id=eq.${mainOrder.id}`, bareJwt);
    const bareOp = await raw('get_production_operation_center', { p_business_id: BUSINESS_A }, { jwt: bareJwt });
    check(P.rls, 'MEMBER_WITHOUT_REGISTERED_SESSION_HAS_NO_ROLE', bareRead.rows?.length === 0 && !bareOp.ok, { read: bareRead.rows?.length, op: bareOp.code });
    try { await bare.auth.signOut({ scope: 'local' }); } catch { /* sesión local descartada */ }

    // ── Fase 13 · consistencia de eventos entre superficies ──────────────────
    const finalTruth = await orderTruth(mainOrder.id);
    const ev = finalTruth.events || [];
    const statusChanges = ev.filter((e) => e.event_type === 'order.status_changed').map((e) => `${e.metadata.previous_status}>${e.metadata.next_status}`);
    const expectedChain = ['received>accepted', 'accepted>preparing', 'preparing>ready', 'ready>assigned', 'assigned>picked_up', 'picked_up>on_the_way', 'on_the_way>arrived', 'arrived>delivered'];
    const seqOk = ev.every((e, i) => i === 0 || Number(e.sequence) > Number(ev[i - 1].sequence));
    const timeOk = ev.every((e, i) => i === 0 || Date.parse(e.created_at) >= Date.parse(ev[i - 1].created_at));
    const terminalIdx = ev.findIndex((e) => e.event_type === 'order.status_changed' && e.metadata.next_status === 'delivered');
    const afterTerminalStatus = ev.slice(terminalIdx + 1).filter((e) => e.event_type === 'order.status_changed');
    check(P.events, 'EVENT_CHAIN_EXACT_NO_GAPS_NO_DUPLICATES', JSON.stringify(statusChanges) === JSON.stringify(expectedChain), statusChanges);
    check(P.events, 'EVENT_SEQUENCE_AND_TIME_MONOTONIC', seqOk && timeOk, { seqOk, timeOk });
    check(P.events, 'NO_STATUS_EVENT_AFTER_TERMINAL', afterTerminalStatus.length === 0, afterTerminalStatus);
    check(P.events, 'EVENT_ACTORS_MATCH_ROLES', ev.filter((e) => e.event_type === 'order.status_changed').every((e) =>
      (['accepted', 'preparing', 'ready'].includes(e.metadata.next_status) ? e.actor_role === 'business' : e.actor_role === 'rider')), ev.map((e) => `${e.event_type}:${e.actor_role}`));
    check(P.events, 'SINGLE_RECEIVED_OFFER_ACCEPT_PAYMENT_EVENTS', ['order.received', 'order.rider_offered', 'order.rider_accepted_offer', 'order.manual_payment_confirmed']
      .every((t) => ev.filter((e) => e.event_type === t).length === 1), ['order.received', 'order.rider_offered', 'order.rider_accepted_offer', 'order.manual_payment_confirmed'].map((t) => `${t}:${ev.filter((e) => e.event_type === t).length}`));
    const fr = finalTruth.order_row;
    const tsOk = ['created_at', 'accepted_at', 'preparing_at', 'ready_at', 'picked_up_at', 'arrived_at', 'delivered_at']
      .map((k) => Date.parse(fr[k])).every((t, i, a) => Number.isFinite(t) && (i === 0 || t >= a[i - 1]));
    check(P.events, 'ORDER_TIMESTAMPS_ORDERED', tsOk, ['created_at', 'accepted_at', 'preparing_at', 'ready_at', 'picked_up_at', 'arrived_at', 'delivered_at'].map((k) => `${k}=${fr[k]}`));
    const panelHistory = (panelEventsFinal.events || []).filter((e) => e.event_type === 'order.status_changed').length;
    check(P.events, 'PANEL_AUDIT_EQUALS_DB_EVENTS', panelEventsFinal.ok && panelEventsFinal.events.length === ev.length && panelHistory === statusChanges.length,
      { panel: panelEventsFinal.events?.length, db: ev.length });
    const surfaces = { db: fr.status, panelInbox: panelDelivered.row ? panelDelivered.row.status : 'not-in-inbox(terminal)', tracking: trDelivered.data?.status ?? 'hidden(terminal)',
      riderBoard: (b1Final.data?.orders || []).some((x) => x.id === mainOrder.id) ? 'active' : 'released', revision: fr.revision };
    check(P.events, 'SURFACES_AGREE_ON_FINAL_STATE', fr.status === 'delivered' && surfaces.panelInbox === 'not-in-inbox(terminal)' && surfaces.riderBoard === 'released'
      && ['delivered', 'hidden(terminal)'].includes(surfaces.tracking), surfaces);
    check(P.events, 'GPS_TRAIL_PURGED_AT_TERMINAL', finalTruth.rider_locations === 0, { riderLocations: finalTruth.rider_locations });
    write('events.json', { orderId: mainOrder.id, publicCode: mainOrder.public_code, dbEvents: ev, panelContractEvents: panelEventsFinal.events, statusChain: statusChanges, surfaces });
    write('order.json', { stage: 'final-before-cleanup', order: fr, notifications: finalTruth.notifications, offers: finalTruth.offers, printJobs: finalTruth.print_jobs });

    // ── Fase 14a · stock antes de limpiar ────────────────────────────────────
    for (const ro of raceOrders) {
      const st = await orderState(ro.id);
      const r = await rpc(owner.client, 'cancel_order', { p_order_id: ro.id, p_expected_revision: st.revision, p_reason: `${RUN_ID} QA limpieza carrera`,
        p_idempotency_key: `cert-cancel-${ro.id.replaceAll('-', '').slice(0, 20)}-${st.revision}` });
      ledger.orders.find((x) => x.id === ro.id).cancelledByTest = r.ok;
      persistLedger();
    }
    // Carrera transición vs. cancelación sobre un pedido propio: gana uno solo.
    {
      const requestId = newRequestId('raceTxCancel');
      const token = newToken();
      const created2 = await rpc(customerR.client, 'create_order_with_items', { payload: orderPayload({ requestId, token, productId: product.id, quantity: 1, mode: 'pickup', customer: customerR }) });
      const ro = rowOf(created2.data);
      if (ro?.id) {
        registerOrder(ro, 'race-accept-vs-cancel', { clientRequestId: requestId, quantity: 1, mode: 'pickup' });
        const stockPre = (await productSnapshot(product.id)).stock;
        const st = await orderState(ro.id);
        const [acc, can] = await Promise.all([
          raw('transition_order', { p_order_id: ro.id, p_expected_revision: st.revision, p_new_status: 'accepted', p_idempotency_key: `cert-rtc-a-${randomBytes(6).toString('hex')}` }, { jwt: staff.jwt }),
          raw('cancel_order', { p_order_id: ro.id, p_expected_revision: st.revision, p_reason: `${RUN_ID} QA carrera cancelacion`, p_idempotency_key: `cert-rtc-c-${randomBytes(6).toString('hex')}` }, { jwt: owner.jwt }),
        ]);
        let fin = await orderState(ro.id);
        const winner = acc.ok ? 'accept' : can.ok ? 'cancel' : 'none';
        if (fin.status !== 'cancelled') {
          await rpc(owner.client, 'cancel_order', { p_order_id: ro.id, p_expected_revision: fin.revision, p_reason: `${RUN_ID} QA limpieza carrera`, p_idempotency_key: `cert-rtc-clean-${randomBytes(6).toString('hex')}` });
          fin = await orderState(ro.id);
        }
        const stockPost = (await productSnapshot(product.id)).stock;
        conc.raceAcceptVsCancel = { accept: { http: acc.status, code: acc.code, ms: acc.ms }, cancel: { http: can.status, code: can.code, ms: can.ms }, winner, final: fin, stockPre, stockPost };
        check(P.lost, 'CASE_C_ACCEPT_VS_CANCEL_ONE_WINNER_NO_CORRUPTION', [acc, can].filter((r) => r.ok).length === 1 && [acc, can].some((r) => r.status === 409)
          && fin.status === 'cancelled' && Boolean(fin.inventory_released_at) && stockPost === stockPre + 1, conc.raceAcceptVsCancel);
        ledger.orders.find((x) => x.id === ro.id).cancelledByTest = fin.status === 'cancelled';
        persistLedger();
      }
    }
    const stockAfterRaces = await productSnapshot(product.id);
    check(P.stock, 'STOCK_AFTER_DELIVERY_EQUALS_INITIAL_MINUS_MAIN', stockAfterRaces.stock === stockBefore.stock - quantity && stockAfterRaces.units_in_open_orders === stockBefore.units_in_open_orders,
      { initial: stockBefore.stock, main: quantity, now: stockAfterRaces.stock });

    write('business-panel-query.json', { contract: 'createSupabaseOrderRepository(...).fetchBusinessOrderSnapshot() + fetchOrderEvents()', actor: 'staff (panel_web session)', orderId: mainOrder.id, snapshots: panelLog });
    write('rider-query.json', { contract: 'get_rider_delivery_board + rider RPCs (same shapes as apps/rider-android)', orderId: mainOrder.id, boards: riderLog });
    write('tracking-query.json', { contract: 'get_public_order_tracking with x-order-token header', orderId: mainOrder.id, publicCode: mainOrder.public_code, calls: trackingLog });
    write('state-transitions.json', { orderId: mainOrder.id, transitions });
    write('idempotency-results.json', idem);
    write('concurrency-results.json', conc);
    write('rls-negative-tests.json', rls);
    write('negative-tests.json', negatives);
    return ctx;
  } finally {
    write('state-transitions.json', { orderId: mainOrder?.id, transitions });
    write('idempotency-results.json', idem);
    write('concurrency-results.json', conc);
    write('rls-negative-tests.json', rls);
    write('negative-tests.json', negatives);
    write('tracking-query.json', { orderId: mainOrder?.id, calls: trackingLog });
    write('rider-query.json', { orderId: mainOrder?.id, boards: riderLog });
    write('business-panel-query.json', { orderId: mainOrder?.id, snapshots: panelLog });
  }
}

// ── Fase 16 · limpieza (sólo recursos de esta corrida) ───────────────────────
async function cleanup(ctx) {
  const P = 'P16_CLEANUP';
  const steps = [];
  const step = (name, ok, detail) => { steps.push({ name, ok, detail, at: nowIso() }); log(`${ok ? 'OK ' : 'ERR'} cleanup ${name}`); return ok; };
  if (ctx?.heartbeat?.timer) clearInterval(ctx.heartbeat.timer);
  const { owner, staff, adminOp, rider1, rider2, customerA, customerB, customerR, sr, product, stockBefore, catalogBefore, stagingStateBefore } = ctx || {};
  // 1. Pedidos de la corrida: devolución del cobro, cancelación pre-despacho, devolución auditada de stock, clasificación QA.
  for (const entry of ledger.orders) {
    try {
      let st = (await observe(`select status, revision, origin, manual_payment_status, picked_up_at, inventory_released_at, business_id from public.orders where id = ${q(entry.id)}`))[0];
      if (!st || st.business_id !== BUSINESS_A) { step(`order ${entry.publicCode || entry.id} skipped`, false, 'not found or foreign'); continue; }
      if (st.manual_payment_status === 'confirmed' && owner) {
        const r = await rpc(owner.client, 'reverse_manual_order_payment', { p_order_id: entry.id, p_expected_revision: st.revision,
          p_reason: `${RUN_ID} QA sin dinero real`, p_idempotency_key: `cert-rev-${entry.id.replaceAll('-', '').slice(0, 24)}` });
        step(`reverse payment ${entry.publicCode}`, r.ok && r.data?.ok !== false, r.code || r.data?.code);
        const mp = ledger.manualPayments.find((x) => x.order === entry.id); if (mp) mp.reversed = r.ok;
        st = (await observe(`select status, revision, origin, manual_payment_status, picked_up_at, inventory_released_at from public.orders where id = ${q(entry.id)}`))[0];
      }
      if (!['delivered', 'cancelled', 'canceled', 'rejected'].includes(st.status) && staff) {
        const r = await rpc(owner.client, 'cancel_order', { p_order_id: entry.id, p_expected_revision: st.revision, p_reason: `${RUN_ID} QA limpieza`,
          p_idempotency_key: `cert-clean-${entry.id.replaceAll('-', '').slice(0, 24)}-${st.revision}` });
        step(`cancel ${entry.publicCode}`, r.ok, r.code);
        st = (await observe(`select status, revision, origin, manual_payment_status, picked_up_at, inventory_released_at from public.orders where id = ${q(entry.id)}`))[0];
      }
      if ((st.status === 'delivered' || (['cancelled', 'canceled'].includes(st.status) && st.picked_up_at)) && owner) {
        const items = await observe(`select product_uuid, quantity from public.order_items where order_id = ${q(entry.id)}`);
        for (const item of items) {
          const key = `cert-restore-${entry.id.replaceAll('-', '').slice(0, 20)}-${item.product_uuid.replaceAll('-', '').slice(0, 12)}`;
          const r = await rpc(owner.client, 'apply_inventory_movement', { p_business_id: BUSINESS_A, p_product_id: item.product_uuid, p_barcode_id: null,
            p_movement_type: 'manual_adjustment', p_package_quantity: Number(item.quantity), p_direction: 1, p_reference_type: 'pilot_qa_return',
            p_reference_id: entry.id, p_reason: `${RUN_ID} QA mercaderia no entregada fisicamente`, p_idempotency_key: key });
          ledger.inventoryMovements.push({ order: entry.id, product: item.product_uuid, quantity: Number(item.quantity), key, ok: r.ok });
          persistLedger();
          step(`restore stock ${entry.publicCode} +${item.quantity}`, r.ok, r.code || r.message);
        }
      }
      if (st.origin !== 'qa' && owner) {
        const r = await rpc(owner.client, 'classify_order_as_qa', { p_order_id: entry.id, p_reason: RUN_SNAKE });
        step(`classify QA ${entry.publicCode}`, r.ok && r.data?.ok === true, r.code || r.data?.origin);
      }
    } catch (error) { step(`order ${entry.id}`, false, error.message); }
  }
  // 2. Riders: disponibilidad en false (estado previo) y sesiones cerradas.
  for (const rider of [rider1, rider2].filter(Boolean)) {
    try {
      const b = await rpc(rider.client, 'get_rider_delivery_board');
      if (b.data?.available !== false || ledger.availability.some((a) => a.userId === rider.userId)) {
        const version = Number(b.data?.availability_version || 0);
        const r = await rpc(rider.client, 'set_rider_availability', { p_business_id: BUSINESS_A, p_available: false, p_expected_version: version,
          p_idempotency_key: riderKey('availability', BUSINESS_A, version, 'false') });
        step(`availability off ${rider.role}`, r.ok, r.code || r.data?.code);
      }
    } catch (error) { step(`availability off ${rider.role}`, false, error.message); }
  }
  // 3a. Sesiones que quedaron sin quien las cierre: las de una corrida que se cortó (su JWT murió con el
  //     proceso) y las que el Panel en navegador haya dejado abiertas. Las revoca el dueño, por contrato.
  if (owner) {
    try {
      const staffId = staff?.userId || ledger.sessions.find((x) => x.role === 'staff')?.userId || '00000000-0000-0000-0000-000000000000';
      const stale = await observe(`select session_id, coalesce(device_label, 'panel-ui') as label from public.identity_sessions
        where business_id = ${q(BUSINESS_A)} and revoked_at is null
          and (device_label like ${q(`${ledger.runId}%`)}
            or (user_id = ${q(staffId)} and coalesce(device_label, '') not like 'TABA_E2E_CERT_%' and first_seen_at >= ${q(UI_SESSIONS_SINCE())}::timestamptz))`);
      for (const row of stale.filter((x) => !LIVE_SESSIONS.has(x.session_id))) {
        const r = await rpc(owner.client, 'identity_revoke_session', { p_session_id: row.session_id });
        const s = ledger.sessions.find((x) => x.sessionId === row.session_id); if (s) s.closed = r.ok && r.data?.ok === true;
        step(`revoke stale session ${row.label}`, r.ok && r.data?.ok === true, r.code || r.data?.code);
      }
    } catch (error) { step('revoke stale sessions', false, error.message); }
  }
  // 3b. Sesiones de identidad de este proceso: logout propio (contrato normal).
  for (const actor of [owner, staff, adminOp, rider1, rider2].filter(Boolean)) {
    try {
      const r = await rpc(actor.client, 'identity_close_own_session', { p_business_id: BUSINESS_A });
      const s = ledger.sessions.find((x) => x.userId === actor.userId && x.role === actor.role); if (s) s.closed = r.ok;
      step(`close session ${actor.role}`, r.ok && r.data?.ok === true, r.code || r.data?.code);
    } catch (error) { step(`close session ${actor.role}`, false, error.message); }
  }
  if (sr?.otherOwner) {
    const r = await rpc(sr.otherOwner.client, 'identity_close_own_session', { p_business_id: sr.businessB });
    const s = ledger.sessions.find((x) => x.role === 'owner-B'); if (s) s.closed = r.ok;
    step('close session owner-B', r.ok, r.code);
  }
  persistLedger();
  // 4. service_role SOLO para borrar identidades/negocio creados por esta corrida.
  const admin = sr?.admin || (KEYS?.secret ? createClient(STAGING_URL, KEYS.secret, OPTIONS) : null);
  if (admin) {
    for (const biz of ledger.businesses.filter((b) => !b.deleted)) {
      const r = await admin.from('businesses').delete().eq('id', biz.id).like('slug', 'qa-taba-e2e-cert-%');
      biz.deleted = !r.error;
      ledger.serviceRoleUses.push({ purpose: 'cleanup', action: 'delete QA business B', ok: !r.error, at: nowIso() });
      step(`delete business B ${biz.id}`, !r.error, r.error?.code);
    }
    // Antes de borrar: las sesiones de las identidades de prueba dejan de servir (logout propio).
    for (const actor of [customerA, customerB, customerR, sr?.noMembership, sr?.otherOwner].filter(Boolean)) {
      try { await actor.client.auth.signOut({ scope: 'global' }); } catch { /* la cuenta se borra igual */ }
    }
    for (const user of ledger.users.filter((u) => !u.deleted)) {
      const r = await admin.auth.admin.deleteUser(user.userId);
      user.deleted = !r.error;
      if (r.error) user.deleteError = { status: r.error.status || null, code: r.error.code || null, message: String(r.error.message || '').slice(0, 160) };
      ledger.serviceRoleUses.push({ purpose: 'cleanup', action: `auth.admin.deleteUser (${user.kind})`, ok: !r.error, at: nowIso() });
      step(`delete user ${user.label}`, !r.error, r.error ? user.deleteError : null);
    }
  }
  persistLedger();
  // 5. Verificación posterior (observador de sólo lectura).
  const runOrderIds = ledger.orders.map((x) => x.id);
  const idList = runOrderIds.length ? runOrderIds.map(q).join(',') : `'00000000-0000-0000-0000-000000000000'`;
  const userIds = ledger.users.map((u) => q(u.userId)).join(',') || `'00000000-0000-0000-0000-000000000000'`;
  const post = (await observe(`select
    (select json_agg(json_build_object('id', id, 'code', public_code, 'status', status, 'origin', origin, 'manual_payment', manual_payment_status)) from public.orders where id in (${idList})) orders,
    (select count(*) from public.orders where id in (${idList}) and (status not in ('delivered','cancelled','canceled','rejected') or origin <> 'qa'))::int non_terminal_or_non_qa,
    (select count(*) from public.rider_order_offers where order_id in (${idList}) and status = 'pending')::int pending_offers,
    (select count(*) from public.notification_outbox where aggregate_id in (${idList}) and state = 'pending')::int pending_notifications,
    (select count(*) from public.inventory_reservations r where r.product_id = ${q(product?.id || '00000000-0000-0000-0000-000000000000')} and r.status in ('active','pending','reserved'))::int reservations,
    (select count(*) from auth.users where id in (${userIds}))::int users_left,
    (select count(*) from public.businesses where slug like 'qa-taba-e2e-cert-%')::int qa_businesses_left,
    (select count(*) from public.identity_sessions where revoked_at is null and (device_label like ${q(`${RUN_ID}%`)} or device_label like ${q(`${ledger.runId}%`)}
      or (user_id = ${q(staff?.userId || '00000000-0000-0000-0000-000000000000')} and coalesce(device_label, '') not like 'TABA_E2E_CERT_%' and first_seen_at >= ${q(UI_SESSIONS_SINCE())}::timestamptz)))::int open_sessions,
    (select count(*) from public.order_events e where e.order_id in (${idList}) and not exists (select 1 from public.orders o where o.id = e.order_id))::int orphan_events,
    (select count(*) from public.rider_locations where order_id in (${idList}))::int rider_locations,
    (select json_agg(json_build_object('rider', rider_user_id, 'available', available, 'version', version)) from public.rider_availability where business_id = ${q(BUSINESS_A)}) riders,
    (select count(*) from public.print_jobs)::int print_jobs,
    (select count(*) from public.fiscal_documents)::int fiscal_documents,
    (select count(*) from public.payment_intents)::int payment_intents,
    (select count(*) from public.orders where business_id = ${q(BUSINESS_A)} and status not in ('delivered','cancelled','canceled','rejected'))::int open_orders_business`))[0];
  // Con contexto de corrida se compara contra la foto inicial; en `--reconcile` no hay foto y no se inventa una.
  if (product && stockBefore) {
    const stockFinal = await productSnapshot(product.id);
    const catalogAfter = await catalogFingerprint();
    check('P14_STOCK', 'STOCK_RESTORED_EXACTLY', stockFinal.stock === stockBefore.stock && stockFinal.available === stockBefore.available
      && stockFinal.merchant_available === stockBefore.merchant_available && Number(stockFinal.price) === Number(stockBefore.price) && stockFinal.is_verified === stockBefore.is_verified
      && stockFinal.units_in_open_orders === stockBefore.units_in_open_orders,
    { before: stockBefore.stock, after: stockFinal.stock });
    check('P14_STOCK', 'CATALOG_FINGERPRINT_IDENTICAL', catalogAfter.fp === catalogBefore?.fp && catalogAfter.n === catalogBefore?.n, { before: catalogBefore, after: catalogAfter });
    write('stock-after.json', { runId: RUN_ID, product: stockFinal, catalogFingerprint: catalogAfter, before: { stock: stockBefore.stock, fp: catalogBefore?.fp },
      inventoryMovementsAdded: stockFinal.inventory_movements - stockBefore.inventory_movements });
  }
  check(P, 'ALL_RUN_ORDERS_TERMINAL_AND_QA', post.non_terminal_or_non_qa === 0, post.orders);
  check(P, 'NO_PENDING_OFFERS_NOTIFICATIONS_RESERVATIONS', post.pending_offers === 0 && post.pending_notifications === 0 && post.reservations === 0,
    { offers: post.pending_offers, notifications: post.pending_notifications, reservations: post.reservations });
  check(P, 'TEST_USERS_AND_BUSINESS_B_DELETED', post.users_left === 0 && post.qa_businesses_left === 0, { users: post.users_left, businesses: post.qa_businesses_left });
  // La baja del cliente desvincula sus pedidos y los conserva: el delivery mantiene su punto de entrega.
  const kept = runOrderIds.length ? await observe(`select public_code, delivery_mode, customer_user_id is null as unlinked, customer_address_id is null as address_unlinked,
    (delivery_mode <> 'delivery' or (delivery_latitude is not null and delivery_longitude is not null and delivery_location_confirmed_at is not null)) as point_kept
    from public.orders where id in (${idList})`) : [];
  check(P, 'CUSTOMER_DELETION_KEEPS_ORDERS_AND_DELIVERY_POINT', kept.length === runOrderIds.length && kept.every((r) => r.unlinked && r.address_unlinked && r.point_kept), kept);
  check(P, 'NO_OPEN_RUN_SESSIONS', post.open_sessions === 0, { open: post.open_sessions });
  check(P, 'NO_ORPHAN_EVENTS_OR_GPS', post.orphan_events === 0 && post.rider_locations === 0, { orphanEvents: post.orphan_events, gps: post.rider_locations });
  if (stagingStateBefore) {
    const ridersBefore = new Map((stagingStateBefore.riders || []).map((r) => [r.rider, r.available]));
    const ridersRestored = (post.riders || []).every((r) => !ridersBefore.has(r.rider) || ridersBefore.get(r.rider) === r.available);
    check(P, 'RIDER_AVAILABILITY_RESTORED', ridersRestored, post.riders);
    check(P, 'NO_FISCAL_PAYMENT_OR_PRINT_SIDE_EFFECTS', post.print_jobs === stagingStateBefore.print_jobs && post.fiscal_documents === stagingStateBefore.fiscal_documents
      && post.payment_intents === stagingStateBefore.payment_intents, { print: post.print_jobs, fiscal: post.fiscal_documents, intents: post.payment_intents });
    check(P, 'BUSINESS_OPEN_ORDERS_BACK_TO_BASELINE', post.open_orders_business === stagingStateBefore.open_orders, { before: stagingStateBefore.open_orders, after: post.open_orders_business });
  } else {
    check(P, 'NO_RIDER_LEFT_AVAILABLE', (post.riders || []).every((r) => r.available === false), post.riders);
  }
  check(P, 'CLEANUP_STEPS_ALL_OK', steps.every((s) => s.ok), steps.filter((s) => !s.ok));
  ledger.finishedAt = nowIso();
  persistLedger();
  write(flag('--reconcile') ? 'reconcile-result.json' : 'cleanup-result.json', { runId: ledger.runId, executedBy: RUN_ID, steps, post, retainedByDesign: [
    'orders (origin=qa, terminal) + order_items/order_events/order_public_tokens/order_delivery_handoffs: append-only audit of the run, tagged by customer_notes and origin_reason',
    'inventory_movements (manual_adjustment pilot_qa_return) that restore stock: append-only ledger',
    'business_command_receipts / rider_delivery_operations / delivery_confirmation_attempts: idempotency receipts',
    'identity_sessions (revoked) + identity_audit_events: session audit trail, device_label starts with RUN_ID',
    'notification_outbox / delivery_outbox rows: processed+suppressed, no consumer exists',
  ] });
}

async function reconcile() {
  const P = 'P16_CLEANUP';
  const stored = JSON.parse(readFileSync(path.join(EVIDENCE, 'created-resources.json'), 'utf8'));
  Object.assign(ledger, stored);
  MGMT_TOKEN = leerTokenDelCli();
  KEYS = await loadTargetKeys('staging');
  assert.equal(KEYS.ref, STAGING_REF);
  log(`reconcile ${stored.runId}: ${ledger.orders.length} orders, ${ledger.users.length} users`);
  const owner = await operator('owner', CREDENTIALS.owner);
  const staff = await operator('staff', CREDENTIALS.staff);
  const rider1 = await operator('rider1', CREDENTIALS.rider1, 'rider_android');
  const rider2 = await operator('rider2', CREDENTIALS.rider2, 'rider_android');
  await cleanup({ owner, staff, rider1, rider2, product: null, stockBefore: null, catalogBefore: null, stagingStateBefore: null });
  write('reconcile-checks.json', checks);
  console.log(JSON.stringify({ reconcile: stored.runId, verdict: phaseVerdict(P), failed: checks.filter((c) => c.result === 'FAIL').map((c) => c.name) }, null, 1));
  process.exitCode = phaseVerdict(P) === 'PASS' ? 0 : 1;
}

async function run() {
  if (flag('--reconcile')) { await reconcile(); return; }
  let ctx = null;
  let fatal = null;
  try {
    ctx = await main();
  } catch (error) {
    fatal = error;
    ctx = error.ctx || null;
    log(`FATAL ${error.message}`);
  } finally {
    if (ctx && !flag('--preflight')) {
      try { await cleanup(ctx); } catch (error) { check('P16_CLEANUP', 'CLEANUP_CRASHED', false, error.message); }
    }
    if (!flag('--preflight')) {
      const phases = ['P1_IDENTITY', 'P2_ISOLATION', 'P3_CREATE', 'P4_DATABASE', 'P5_PANEL', 'P6_STATE_MACHINE', 'P7_RIDER', 'P8_TRACKING', 'P9_DELIVERY_CODE',
        'P10_IDEMPOTENCY', 'P11_LOST_RESPONSE', 'P12_RLS', 'P13_EVENTS', 'P14_STOCK', 'P15_NEGATIVE', 'P16_CLEANUP'];
      const summary = { runId: RUN_ID, evidence: path.relative(ROOT, EVIDENCE), finishedAt: nowIso(), fatal: fatal ? fatal.message : null,
        mainOrder: ledger.orders.find((x) => x.label === 'main') || null,
        phases: Object.fromEntries(phases.map((p) => [p, phaseVerdict(p)])),
        // Evidencia adicional de pantalla; se informa aparte y no decide la certificación del backend.
        panelUi: phaseVerdict('P5B_PANEL_UI'),
        totals: { checks: checks.length, pass: checks.filter((c) => c.result === 'PASS').length, fail: checks.filter((c) => c.result === 'FAIL').length },
        failed: checks.filter((c) => c.result === 'FAIL').map((c) => `${c.phase}:${c.name}`) };
      summary.backendPhasesAllPass = !fatal && phases.every((p) => summary.phases[p] === 'PASS');
      write('checks.json', checks);
      write('summary.json', summary);
      console.log(JSON.stringify(summary, null, 1));
      process.exitCode = summary.backendPhasesAllPass ? 0 : 1;
    }
  }
}

await run();
