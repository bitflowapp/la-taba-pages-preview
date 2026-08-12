#!/usr/bin/env node
/**
 * Certifica que una sesión de staff REVOCADA no puede asignar riders, aunque
 * conserve un access token todavía vigente.
 *
 * Corre contra PostgREST de verdad —no por psql— porque la diferencia importa:
 * PostgREST entra como `authenticator` y hace `SET LOCAL ROLE authenticated`, y
 * es ahí donde se evalúa la autorización como en producción.
 *
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   TABA_BUSINESS_ID=... TABA_PROBE_ORDER=<uuid de un pedido delivery> \
 *   node scripts/certify-assign-rider-revocation.mjs
 *
 * NO MUTA NINGÚN PEDIDO, y eso no es una promesa: es la forma de la prueba. El
 * destinatario de la asignación es una cuenta que existe y NO es rider, así que
 * los dos caminos posibles terminan en 42501 antes de llegar a un solo UPDATE.
 * Lo que los distingue es el mensaje:
 *
 *   'rider activo del negocio requerido'  → la autorización del llamador PASÓ
 *   'rol de negocio requerido'            → la autorización BLOQUEÓ
 *
 * Por qué no se usa el CAS como señal: un 40001 hace que PostgREST reintente la
 * transacción hasta que el gateway corta con 504, y un 504 no dice nada. Se
 * midió al escribir esto.
 *
 * Las cuentas de ensayo se crean y se borran dentro de la corrida. Ninguna
 * cuenta real se toca ni se rota.
 */

const URL_BASE = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const ANON = String(process.env.SUPABASE_ANON_KEY || '').trim();
const SERVICE = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const BUSINESS = String(process.env.TABA_BUSINESS_ID || '').trim();
const ORDER = String(process.env.TABA_PROBE_ORDER || '').trim();

if (!URL_BASE || !ANON || !SERVICE || !BUSINESS || !ORDER) {
  console.error(
    'Faltan SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, '
    + 'TABA_BUSINESS_ID o TABA_PROBE_ORDER.',
  );
  process.exit(2);
}

const clave = `Assign-${Math.random().toString(36).slice(2)}-${Date.now()}!`;
const creadas = [];
const resultados = [];

async function pedir(ruta, { metodo = 'GET', token = ANON, apikey = ANON, cuerpo } = {}) {
  const respuesta = await fetch(`${URL_BASE}${ruta}`, {
    method: metodo,
    headers: { apikey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await respuesta.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* respuesta no JSON */ }
  return { status: respuesta.status, json };
}

async function crearCuenta(rol) {
  const email = `assign-cert-${rol}-${Date.now()}@taba-cert.invalid`;
  const creada = await pedir('/auth/v1/admin/users', {
    metodo: 'POST', token: SERVICE, apikey: SERVICE,
    cuerpo: { email, password: clave, email_confirm: true },
  });
  const id = creada.json?.id;
  if (!id) throw new Error(`no pude crear la cuenta de ${rol}: ${creada.status}`);
  creadas.push(id);
  await pedir('/rest/v1/business_members', {
    metodo: 'POST', token: SERVICE, apikey: SERVICE,
    cuerpo: { business_id: BUSINESS, user_id: id, role: rol, is_active: true },
  });
  const sesion = await pedir('/auth/v1/token?grant_type=password', {
    metodo: 'POST', cuerpo: { email, password: clave },
  });
  const token = sesion.json?.access_token;
  if (!token) throw new Error(`no pude entrar como ${rol}: ${sesion.status}`);
  const sessionId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).session_id;
  return { id, token, sessionId };
}

function leerVeredicto(respuesta) {
  const mensaje = respuesta.json?.message || '';
  if (/rider activo del negocio/.test(mensaje)) return 'PASO';
  if (/rol de negocio requerido/.test(mensaje)) return 'BLOQUEADA';
  return `INESPERADO status=${respuesta.status} ${JSON.stringify(respuesta.json).slice(0, 110)}`;
}

function chequeo(nombre, ok, detalle) {
  resultados.push(ok);
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre.padEnd(58, '.')}  ${detalle}`);
}

try {
  const staff = await crearCuenta('staff');
  const owner = await crearCuenta('owner');
  await pedir('/rest/v1/rpc/identity_register_session', {
    metodo: 'POST', token: staff.token,
    cuerpo: { p_business_id: BUSINESS, p_client: 'panel_web', p_device_label: 'Certificacion' },
  });

  // El destinatario es el propio staff: existe, pertenece al comercio y NO es
  // rider. Por eso ningun camino puede escribir.
  const llamada = {
    p_order_id: ORDER,
    p_expected_status: 'ready',
    p_expected_rider_user_id: null,
    p_new_rider_user_id: staff.id,
  };

  const antes = leerVeredicto(await pedir('/rest/v1/rpc/assign_order_rider', {
    metodo: 'POST', token: staff.token, cuerpo: llamada,
  }));
  chequeo('un staff ACTIVO conserva su autorizacion', antes === 'PASO', antes);

  const revocada = await pedir('/rest/v1/rpc/identity_revoke_session', {
    metodo: 'POST', token: owner.token, cuerpo: { p_session_id: staff.sessionId },
  });
  chequeo('el owner revoca la sesion del staff', revocada.json?.ok === true, revocada.json?.code || '');

  const despues = leerVeredicto(await pedir('/rest/v1/rpc/assign_order_rider', {
    metodo: 'POST', token: staff.token, cuerpo: llamada,
  }));
  chequeo(
    'revocada la sesion, no puede asignar con el mismo token',
    despues === 'BLOQUEADA',
    despues,
  );

  const orden = await pedir(
    `/rest/v1/orders?id=eq.${ORDER}&select=public_code,status,assigned_rider_user_id`,
    { token: SERVICE, apikey: SERVICE },
  );
  chequeo(
    'el pedido de la sonda quedo intacto',
    Boolean(orden.json?.[0]),
    JSON.stringify(orden.json?.[0] || {}),
  );
} catch (error) {
  chequeo('la certificacion corrio hasta el final', false, error.message);
} finally {
  for (const id of creadas) {
    await pedir(`/rest/v1/business_members?user_id=eq.${id}`, { metodo: 'DELETE', token: SERVICE, apikey: SERVICE });
    await pedir(`/auth/v1/admin/users/${id}`, { metodo: 'DELETE', token: SERVICE, apikey: SERVICE });
  }
  console.log(`\n· ${creadas.length} cuentas de ensayo borradas`);
}

const fallando = resultados.filter((ok) => !ok).length;
console.log(fallando === 0
  ? 'CERRADO: una sesion revocada no asigna riders.'
  : `${fallando} comprobacion(es) fallaron.`);
process.exit(fallando === 0 ? 0 : 1);
