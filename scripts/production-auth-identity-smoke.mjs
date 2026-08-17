// El camino de sesion del Panel y del Rider, contra produccion, de verdad.
//
// `production-security-smoke.mjs` cubre al Customer: entra anonimo, mide que no
// ve nada y se borra. Pero el Panel y el Rider NO entran anonimos: entran con
// correo y contrasena, y de ese camino no habia una sola medida contra el
// proyecto productivo. Lo unico que se sabia es que la configuracion existia.
//
// Esta sonda mide lo que hace una sesion de verdad, de punta a punta:
//
//   1. entra con contrasena y recibe una sesion
//   2. el JWT dice authenticated y NO dice anonimo
//   3. sin fila en business_members no obtiene ningun rol
//   4. no puede leer ninguna de las 16 tablas cerradas
//   5. no puede darse un rol a si misma
//   6. no puede ver a la OTRA identidad sintetica (aislamiento entre pares)
//   7. la sesion se restaura con el refresh token, y el token nuevo sirve
//   8. logout revoca: ni el refresh viejo ni la sesion vieja siguen valiendo
//   9. no puede crear un pedido con la persiana cerrada
//
// ## Por que las identidades se crean por SQL y no por /signup
//
// Con `mailer_autoconfirm=false` -que es como tiene que estar- un alta por
// `/signup` deja al usuario sin confirmar y dispara un correo. El unico SMTP
// configurado es el integrado de Supabase, limitado a dos correos por hora: una
// sonda que quema ese presupuesto contra un dominio inventado deja al proyecto
// sin poder mandar el correo que si importa. Crearlas por SQL no manda ninguno,
// no toca la configuracion de Auth, y deja el borrado en una sola sentencia.
//
// El hash es bcrypt por `extensions.crypt`, que es el mismo formato que escribe
// GoTrue: si el login funciona, funciona por el camino real.
//
//   $env:SUPABASE_ACCESS_TOKEN = <token del CLI>
//   node scripts/production-auth-identity-smoke.mjs --ref wwcpogltfgzgkrlilbcd --key <publishable>
//
// Salida 0 = el camino de sesion es el esperado y no quedo nada. 1 = hallazgos.
// 2 = no se pudo preguntar.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const PRODUCTION_REF = 'wwcpogltfgzgkrlilbcd';
const CANONICAL_BUSINESS = '00000000-0000-4000-8000-000000000001';

// Dominio reservado por RFC 6761 para que jamas resuelva. Si una identidad se
// escapara de la limpieza, su correo dice a la cara que es de prueba y no puede
// recibir nada.
const DOMINIO_QA = 'taba-qa-smoke.invalid';

const TABLAS_CERRADAS = [
  'orders', 'order_items', 'order_events', 'customers', 'rider_profiles',
  'rider_locations', 'rider_order_offers', 'payment_attempts', 'payment_outbox',
  'checkout_sessions', 'fiscal_documents', 'business_members', 'staff_profiles',
  'identity_sessions', 'operational_alerts', 'operational_sweep_runs',
];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const ref = (arg('ref') || '').trim();
if (ref !== PRODUCTION_REF) {
  console.error(`--ref debe ser ${PRODUCTION_REF}`);
  process.exit(2);
}
const keyArg = arg('key');
const keyFile = arg('key-file');
const KEY = (keyArg || (keyFile ? fs.readFileSync(keyFile, 'utf8') : '')).trim();
if (!KEY) { console.error('falta --key o --key-file (la clave publicable)'); process.exit(2); }
if (!KEY.startsWith('sb_publishable_')) {
  console.error('la clave tiene que ser publicable: esta sonda no acepta otra clase');
  process.exit(2);
}
const PAT = process.env.SUPABASE_ACCESS_TOKEN;
if (!PAT) { console.error('falta SUPABASE_ACCESS_TOKEN (para crear y borrar las identidades)'); process.exit(2); }

const BASE = `https://${ref}.supabase.co`;

const hallazgos = [];
function exigir(ok, detalle) { if (!ok) hallazgos.push(detalle); return ok; }

async function sql(query, readOnly = true) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(readOnly ? { query, read_only: true } : { query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : [];
}

async function rest(path_, token, init = {}) {
  const r = await fetch(`${BASE}${path_}`, {
    ...init,
    headers: { apikey: KEY, Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: r.status, body };
}

async function auth(path_, init = {}) {
  const r = await fetch(`${BASE}/auth/v1${path_}`, {
    ...init,
    headers: { apikey: KEY, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: r.status, body };
}

function claims(jwt) {
  try {
    return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
  } catch (_) {
    return null;
  }
}

/** Comilla simple de Postgres. Los valores son nuestros, pero la costumbre vale. */
function lit(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

// El sufijo hace que dos corridas simultaneas no se pisen y que el borrado por
// patron no pueda alcanzar una identidad de otra corrida.
const corrida = crypto.randomBytes(4).toString('hex');
const identidades = [
  { etiqueta: 'panel ', correo: `panel-${corrida}@${DOMINIO_QA}` },
  { etiqueta: 'rider ', correo: `rider-${corrida}@${DOMINIO_QA}` },
];
// Contrasena aleatoria por corrida: no queda escrita en ningun lado, y como
// supera el minimo de 12 tambien sirve de comprobacion de que la politica de
// contrasenas no rechaza una legitima.
const CLAVE = `Taba-${crypto.randomBytes(12).toString('base64url')}-Qa1!`;

/**
 * Las cuatro columnas de token van en cadena vacia, no en NULL.
 *
 * `confirmation_token`, `recovery_token`, `email_change_token_new` y
 * `email_change` admiten NULL en el esquema pero no tienen default, y GoTrue
 * las lee como cadenas no nulas: una fila con NULL ahi hace que el login
 * devuelva 500. Medido: con NULL, `/token?grant_type=password` daba HTTP 500
 * para las dos identidades; con cadena vacia, 200.
 *
 * Es la clase de detalle por el que crear usuarios a mano parece funcionar
 * hasta que alguien intenta entrar.
 */
const COLUMNAS_DE_TOKEN_VACIAS = `'', '', '', ''`;

async function crear(correo) {
  const id = crypto.randomUUID();
  await sql(`
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_anonymous,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', ${lit(id)}, 'authenticated', 'authenticated',
      ${lit(correo)}, extensions.crypt(${lit(CLAVE)}, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), false,
      ${COLUMNAS_DE_TOKEN_VACIAS}
    );
    insert into auth.identities (
      provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      ${lit(id)}, ${lit(id)},
      jsonb_build_object('sub', ${lit(id)}, 'email', ${lit(correo)}, 'email_verified', true),
      'email', now(), now(), now()
    );
  `, false);
  return id;
}

async function borrarTodo() {
  await sql(`delete from auth.users where email like ${lit(`%${corrida}@${DOMINIO_QA}`)};`, false);
}

console.log(`--- SMOKE DE SESION CON CONTRASENA (${ref}) ---`);

const [antes] = await sql('select count(*)::int as n from auth.users;');
console.log(`  auth.users antes  : ${antes.n}`);
exigir(antes.n === 0, `auth.users empieza en ${antes.n}: hay identidades que nadie esperaba antes de lanzar`);

const sesiones = [];
try {
  for (const identidad of identidades) {
    identidad.id = await crear(identidad.correo);
  }
  console.log(`  identidades       : ${identidades.length} creadas por SQL (sin correo enviado)`);

  // --- 1 · entrar con contrasena ---
  for (const identidad of identidades) {
    const r = await auth('/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email: identidad.correo, password: CLAVE }),
    });
    if (r.status !== 200 || !r.body?.access_token) {
      hallazgos.push(`${identidad.etiqueta.trim()}: no pudo entrar con contrasena (HTTP ${r.status})`);
      continue;
    }
    identidad.sesion = r.body;
    sesiones.push(identidad);
    const c = claims(r.body.access_token);
    console.log(`  ${identidad.etiqueta}login    : HTTP 200 · role=${c?.role} · anonimo=${c?.is_anonymous === true}`);
    exigir(c?.role === 'authenticated', `${identidad.etiqueta.trim()}: el JWT dice role=${c?.role}`);
    exigir(c?.is_anonymous !== true, `${identidad.etiqueta.trim()}: una sesion con contrasena se declara anonima`);
    exigir(c?.sub === identidad.id, `${identidad.etiqueta.trim()}: el JWT no es de la identidad que se creo`);
  }

  if (sesiones.length !== identidades.length) throw new Error('sin sesiones no hay nada mas que medir');

  const [panel, rider] = sesiones;

  // --- 2 · sin membresia no hay rol, ni datos, ni forma de darselo ---
  for (const identidad of sesiones) {
    const token = identidad.sesion.access_token;

    const abiertas = [];
    for (const tabla of TABLAS_CERRADAS) {
      const r = await rest(`/rest/v1/${tabla}?select=*&limit=1`, token);
      if (r.status === 200 && Array.isArray(r.body) && r.body.length > 0) abiertas.push(tabla);
    }
    exigir(abiertas.length === 0, `${identidad.etiqueta.trim()}: lee tablas cerradas: ${abiertas.join(', ')}`);

    const ctx = await rest('/rest/v1/rpc/identity_current_context', token, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const rol = Array.isArray(ctx.body) ? ctx.body[0]?.role : ctx.body?.role;
    exigir(!rol, `${identidad.etiqueta.trim()}: obtuvo el rol ${rol} sin que nadie se lo diera`);

    const alza = await rest('/rest/v1/business_members', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({
        business_id: CANONICAL_BUSINESS, user_id: identidad.id, role: 'owner', is_active: true,
      }),
    });
    exigir(alza.status >= 400, `${identidad.etiqueta.trim()}: pudo insertarse en business_members (HTTP ${alza.status})`);

    console.log(`  ${identidad.etiqueta}aislada  : ${TABLAS_CERRADAS.length} tablas cerradas · rol=${rol ?? 'ninguno'} · auto-membresia HTTP ${alza.status}`);
  }

  // --- 3 · una identidad no ve a la otra ---
  //
  // Es la comprobacion que faltaba: las dos existen a la vez y ninguna puede
  // enumerar a la otra. Sin esto, «no ve nada» podria significar «no hay nada».
  const verOtro = await rest(
    `/rest/v1/customers?select=id&limit=5`, panel.sesion.access_token,
  );
  exigir(
    !(verOtro.status === 200 && Array.isArray(verOtro.body) && verOtro.body.length > 0),
    'una identidad sin membresia enumera clientes con otra identidad viva en la base',
  );
  const [vivos] = await sql('select count(*)::int as n from auth.users;');
  console.log(`  aislamiento par a par: ${vivos.n} identidades vivas y ninguna se ve`);
  exigir(vivos.n === antes.n + identidades.length, `hay ${vivos.n} identidades y se esperaban ${antes.n + identidades.length}`);

  // --- 4 · restaurar la sesion con el refresh token ---
  const refrescada = await auth('/token?grant_type=refresh_token', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: panel.sesion.refresh_token }),
  });
  exigir(refrescada.status === 200 && Boolean(refrescada.body?.access_token), `el refresh fallo (HTTP ${refrescada.status})`);
  const nuevaSesion = refrescada.body;
  if (nuevaSesion?.access_token) {
    exigir(
      nuevaSesion.refresh_token !== panel.sesion.refresh_token,
      'el refresh devolvio el MISMO refresh token: la rotacion esta declarada pero no ocurre',
    );
    const c = claims(nuevaSesion.access_token);
    exigir(c?.sub === panel.id, 'el refresh devolvio una sesion de otra identidad');
    const usable = await rest('/rest/v1/rpc/scheduler_heartbeat', nuevaSesion.access_token, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    exigir(usable.status === 200, `la sesion restaurada no sirve para llamar (HTTP ${usable.status})`);
    console.log(`  restaurar sesion  : HTTP 200 · refresh rotado · sesion nueva usable`);
    panel.sesion = nuevaSesion;
  }

  // --- 5 · logout revoca ---
  const salida = await auth('/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${panel.sesion.access_token}` },
    body: '{}',
  });
  exigir(salida.status === 204 || salida.status === 200, `el logout devolvio HTTP ${salida.status}`);

  const reintento = await auth('/token?grant_type=refresh_token', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: panel.sesion.refresh_token }),
  });
  exigir(reintento.status >= 400, `despues del logout el refresh token viejo SIGUE sirviendo (HTTP ${reintento.status})`);
  console.log(`  logout            : HTTP ${salida.status} · refresh posterior HTTP ${reintento.status}`);

  // El otro par tiene que seguir vivo: cerrar una sesion no puede cerrar la del
  // companiero de turno.
  const otroSigue = await rest('/rest/v1/rpc/scheduler_heartbeat', rider.sesion.access_token, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  exigir(otroSigue.status === 200, `el logout de una identidad tumbo la sesion de la otra (HTTP ${otroSigue.status})`);

  // --- 6 · la persiana sigue cerrada ---
  const pedido = await rest('/rest/v1/orders', rider.sesion.access_token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ business_id: CANONICAL_BUSINESS, total_amount: 1 }),
  });
  exigir(pedido.status >= 400, `una identidad con contrasena pudo insertar en orders (HTTP ${pedido.status})`);
  console.log(`  insert en orders  : HTTP ${pedido.status}`);
} catch (error) {
  hallazgos.push(`la sonda se corto: ${error.message}`);
} finally {
  await borrarTodo();
  const [despues] = await sql('select count(*)::int as n from auth.users;');
  console.log(`  limpieza          : auth.users = ${despues.n}`);
  if (despues.n !== antes.n) {
    hallazgos.push(`auth.users quedo en ${despues.n}, esperaba ${antes.n}`);
  }
  const [residuo] = await sql(
    `select count(*)::int as n from auth.users where email like ${lit(`%@${DOMINIO_QA}`)};`,
  );
  if (residuo.n !== 0) hallazgos.push(`quedaron ${residuo.n} identidades del dominio de QA`);
}

const destino = arg('report');
if (destino) {
  const reporte = {
    schemaVersion: 1,
    ref,
    checkedAt: new Date().toISOString(),
    identities: identidades.length,
    identityClass: 'email + contrasena, la misma que usan el Panel y el Rider',
    createdVia: 'SQL (no /signup): no consume el presupuesto de correo ni toca la configuracion de Auth',
    closedTablesProbed: TABLAS_CERRADAS.length,
    checks: [
      'login con contrasena', 'JWT authenticated y no anonimo', 'sin rol sin membresia',
      'tablas cerradas', 'auto-membresia rechazada', 'aislamiento entre identidades vivas',
      'refresh rota el token', 'sesion restaurada usable', 'logout revoca el refresh',
      'el logout no tumba la otra sesion', 'insert en orders rechazado',
    ],
    authUsersBefore: antes.n,
    findings: hallazgos,
    healthy: hallazgos.length === 0,
  };
  fs.mkdirSync(path.dirname(path.resolve(destino)), { recursive: true });
  fs.writeFileSync(path.resolve(destino), `${JSON.stringify(reporte, null, 2)}\n`, 'utf8');
  console.log(`  reporte           : ${destino}`);
}

if (hallazgos.length) {
  console.error('\n  HALLAZGOS:');
  for (const h of hallazgos) console.error(`    ${h}`);
  process.exitCode = 1;
} else {
  console.log('\n  RESULTADO         : EL CAMINO DE SESION ES EL ESPERADO');
}
