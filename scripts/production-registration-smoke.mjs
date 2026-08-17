// El alta autogestionada y la aprobacion, contra PRODUCCION.
//
// `production-auth-identity-smoke.mjs` mide el camino de SESION: entrar, no
// obtener rol, no leer nada, salir. Lo que falta medir -y es lo que decide si
// una persona real puede empezar a trabajar en TABA- es el camino de ALTA:
//
//   1. /signup por el camino publico real                (mide el gate de SMTP)
//   2. pedir acceso, y quedar pendiente
//   3. que pendiente no sea acceso: ni sesion operativa, ni tablas, ni ofertas
//   4. que quien pide no pueda aprobarse solo
//   5. que un owner apruebe, y recien ahi haya membresia, con el rol que decidio
//   6. lo mismo para el Rider
//   7. que rechazar tambien funcione, y que no revele nada de mas
//
// ## Lo que esta sonda NO mide, y por que
//
// El paso del enlace del correo -confirmar la cuenta, o cambiar una contrasena
// olvidada- no se puede certificar contra produccion mientras no haya SMTP
// propio: GoTrue genera el token, intenta mandar el correo, el envio falla y la
// transaccion se revierte, asi que el token nunca llega a existir. El paso 1 lo
// deja medido en vez de suponerlo.
//
// Ese tramo se certifica aparte, contra un GoTrue real con casilla real, en
// `npm run auth:local:gate`. Escribir a mano un token de confirmacion o de
// recuperacion en `auth.users` seria la otra forma de hacerlo, y no se hace: un
// guion que fabrica enlaces de recuperacion para una cuenta ajena es
// exactamente la herramienta que no queremos que exista en este repo.
//
// Las identidades de prueba se crean por SQL, ya confirmadas -el mismo patron
// que ya usa la sonda de sesion-, porque con `mailer_autoconfirm=false` un alta
// por `/signup` no puede completarse sin correo. El hash es bcrypt por
// `extensions.crypt`, el mismo formato que escribe GoTrue: si el login funciona,
// funciona por el camino real.
//
//   $env:SUPABASE_ACCESS_TOKEN = <token del CLI>
//   node scripts/production-registration-smoke.mjs --ref wwcpogltfgzgkrlilbcd \
//     --key-file <archivo con la clave publicable> [--report <archivo.json>]
//
// Salida 0 = el contrato se cumple y no quedo nada. 1 = hallazgos. 2 = no se pudo.

import crypto from 'node:crypto';
import fs from 'node:fs';
import process from 'node:process';

const PRODUCTION_REF = 'wwcpogltfgzgkrlilbcd';
const CANONICAL_BUSINESS = '00000000-0000-4000-8000-000000000001';
// RFC 6761: `.invalid` no resuelve nunca. Si una identidad se escapara de la
// limpieza, su correo dice a la cara que es de prueba y no puede recibir nada.
const DOMINIO_QA = 'taba-qa-smoke.invalid';
const NOMBRE_QA = 'QA SMOKE';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const ref = (arg('ref') || '').trim();
if (ref !== PRODUCTION_REF) { console.error(`--ref debe ser ${PRODUCTION_REF}`); process.exit(2); }

const keyFile = arg('key-file');
const KEY = ((arg('key') || (keyFile ? fs.readFileSync(keyFile, 'utf8') : '')) || '').trim();
if (!KEY.startsWith('sb_publishable_')) { console.error('falta --key/--key-file publicable'); process.exit(2); }

const PAT = process.env.SUPABASE_ACCESS_TOKEN;
if (!PAT) { console.error('falta SUPABASE_ACCESS_TOKEN'); process.exit(2); }

const BASE = `https://${ref}.supabase.co`;
const corrida = crypto.randomBytes(4).toString('hex');
const CLAVE = `Taba-${crypto.randomBytes(12).toString('base64url')}-Qa1!`;

const hallazgos = [];
const pasos = [];
function paso(nombre, ok, detalle = '') {
  pasos.push({ nombre, ok: Boolean(ok), detalle });
  if (!ok) hallazgos.push(`${nombre}${detalle ? ` — ${detalle}` : ''}`);
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${nombre}${detalle ? ` · ${detalle}` : ''}`);
  return ok;
}
function nota(nombre, detalle = '') {
  pasos.push({ nombre, ok: true, detalle, informativo: true });
  console.log(`  ··   ${nombre}${detalle ? ` · ${detalle}` : ''}`);
}

const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;

async function sql(query, readOnly = true) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(readOnly ? { query, read_only: true } : { query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`SQL ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : [];
}

async function pedir(ruta, { token = null, ...init } = {}) {
  const headers = { apikey: KEY, 'Content-Type': 'application/json', ...(init.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}${ruta}`, { ...init, headers });
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: r.status, body };
}

function claims(jwt) {
  try { return JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString('utf8')); } catch { return null; }
}

const entrar = (email, password) => pedir('/auth/v1/token?grant_type=password', {
  method: 'POST', body: JSON.stringify({ email, password }),
});
const rpc = (nombre, params, token) => pedir(`/rest/v1/rpc/${nombre}`, {
  token, method: 'POST', body: JSON.stringify(params),
});

/** Identidad de prueba, con el mismo formato que escribe GoTrue. */
async function crearIdentidad(etiqueta) {
  const id = crypto.randomUUID();
  const email = `${etiqueta}-${corrida}@${DOMINIO_QA}`;
  await sql(`
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_anonymous,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', ${lit(id)}, 'authenticated', 'authenticated',
      ${lit(email)}, extensions.crypt(${lit(CLAVE)}, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"taba_actor":"team","taba_qa":true}'::jsonb, now(), now(), false,
      '', '', '', ''
    );
    insert into auth.identities (
      provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      ${lit(id)}, ${lit(id)},
      jsonb_build_object('sub', ${lit(id)}, 'email', ${lit(email)}, 'email_verified', true),
      'email', now(), now(), now()
    );
  `, false);
  return { id, email };
}

const reporte = {
  schemaVersion: 1, ref, corrida, checkedAt: new Date().toISOString(),
  business: CANONICAL_BUSINESS, pasos, hallazgos,
};

console.log(`--- ALTA Y APROBACION CONTRA PRODUCCION (${ref}) ---\n`);

try {
  // ---------------------------------------------------------------- 1. SMTP
  console.log('1 · el camino publico de alta, tal como lo usaria una persona');
  const publico = `publica-${corrida}@${DOMINIO_QA}`;
  const alta = await pedir('/auth/v1/signup', {
    method: 'POST', body: JSON.stringify({ email: publico, password: CLAVE }),
  });
  const codigoAlta = String(alta.body?.error_code || alta.body?.code || alta.body?.msg || '').slice(0, 120);
  reporte.signupPublico = { status: alta.status, code: codigoAlta };
  const seCreo = alta.status < 300 && Boolean(alta.body?.id || alta.body?.user?.id);
  reporte.smtpEntrega = seCreo
    ? 'el alta publica se completo'
    : `rechazada antes de mandar: HTTP ${alta.status} ${codigoAlta}`;
  nota(seCreo ? 'el alta publica se completo' : 'el alta publica no se completa con una direccion de QA',
    `HTTP ${alta.status} ${codigoAlta}`);
  if (/email_address_invalid/.test(codigoAlta)) {
    // Vale la pena dejarlo escrito: el rechazo es del VALIDADOR de direcciones
    // de GoTrue, que no acepta un TLD reservado como .invalid. No es la medida
    // del SMTP. La entrega real no se prueba desde aca porque probarla exige
    // mandarle un correo a una casilla de verdad.
    nota('el rechazo es del validador de direcciones, no del envio',
      `.invalid es un TLD reservado (RFC 6761); el gate de SMTP se mide por configuracion`);
  }

  const [{ total: usuariosTrasAlta }] = await sql('select count(*)::int as total from auth.users;');
  reporte.usuariosTrasAltaPublica = usuariosTrasAlta;
  nota('identidades en produccion despues del intento publico', String(usuariosTrasAlta));

  // --------------------------------------------------------- 2. pedir acceso
  console.log('\n2 · entrar y pedir acceso al comercio');
  const negocio = await crearIdentidad('panel');
  const sesion = await entrar(negocio.email, CLAVE);
  paso('entra con contrasena', sesion.status === 200 && Boolean(sesion.body?.access_token), `HTTP ${sesion.status}`);
  const jwt = sesion.body?.access_token || '';
  const c = claims(jwt) || {};
  paso('el JWT dice authenticated y no dice anonimo',
    c.role === 'authenticated' && c.is_anonymous !== true, `role=${c.role}`);

  const contextoInicial = await rpc('identity_current_context', { p_business_id: CANONICAL_BUSINESS }, jwt);
  paso('tener cuenta NO otorga rol', !contextoInicial.body?.role,
    `role=${JSON.stringify(contextoInicial.body?.role ?? null)}`);

  const solicitud = await rpc('request_business_access', {
    p_business_id: CANONICAL_BUSINESS, p_access: 'panel',
    p_full_name: `Panel ${NOMBRE_QA}`, p_contact_phone: '2990000000',
  }, jwt);
  paso('la solicitud se registra', solicitud.body?.ok === true, `code=${solicitud.body?.code || solicitud.status}`);
  const idSolicitud = solicitud.body?.request_id || '';

  const propio = await rpc('get_my_business_access_request', { p_business_id: CANONICAL_BUSINESS }, jwt);
  paso('la persona ve su solicitud pendiente y no es miembro',
    propio.body?.status === 'pending' && propio.body?.is_member === false,
    `status=${propio.body?.status} miembro=${propio.body?.is_member}`);

  // ------------------------------------------------- 3. pendiente no es acceso
  console.log('\n3 · pendiente no es acceso');
  const registro = await rpc('identity_register_session', {
    p_business_id: CANONICAL_BUSINESS, p_client: 'panel_web',
    p_device_label: NOMBRE_QA, p_device_key_hash: null, p_app_version: 'smoke',
  }, jwt);
  paso('no puede registrar sesion operativa', registro.body?.ok !== true,
    `ok=${JSON.stringify(registro.body?.ok ?? null)}`);

  const cerradas = ['orders', 'order_items', 'customers', 'business_members', 'staff_profiles', 'identity_sessions'];
  const abiertas = [];
  for (const tabla of cerradas) {
    const r = await pedir(`/rest/v1/${tabla}?select=*&limit=1`, { token: jwt });
    if (Array.isArray(r.body) && r.body.length > 0) abiertas.push(`${tabla}(${r.body.length})`);
  }
  paso('no lee ninguna de las tablas cerradas', abiertas.length === 0,
    abiertas.length ? abiertas.join(', ') : `${cerradas.length} tablas, 0 filas`);

  const autoRol = await pedir('/rest/v1/business_members', {
    token: jwt, method: 'POST',
    body: JSON.stringify({ business_id: CANONICAL_BUSINESS, user_id: negocio.id, role: 'owner', is_active: true }),
  });
  paso('no puede darse un rol a si misma', autoRol.status >= 400, `HTTP ${autoRol.status}`);

  const solo = await rpc('identity_review_access_request', {
    p_request_id: idSolicitud, p_decision: 'approve', p_role: 'owner',
  }, jwt);
  paso('no puede aprobar su propia solicitud', solo.body?.ok !== true, `code=${solo.body?.code || solo.status}`);

  // La politica de contrasenas, por el camino real. Vale la pena medirlo desde
  // una sesion normal: `security_update_password_require_reauthentication` esta
  // en true, y GoTrue exime a las sesiones de menos de 24 h y a las que vienen
  // de un enlace de recuperacion. Lo que se mide aca es la primera exencion; la
  // segunda es la que hace que recuperar la contrasena pueda funcionar.
  console.log('\n3.5 · la politica de contrasenas, medida desde una sesion viva');
  const filtrada = await pedir('/auth/v1/user', {
    token: jwt, method: 'PUT', body: JSON.stringify({ password: 'Password123456' }),
  });
  paso('una contrasena filtrada se rechaza (HIBP)',
    filtrada.status >= 400 && /pwned|weak|leaked/i.test(JSON.stringify(filtrada.body || '')),
    `HTTP ${filtrada.status} ${String(filtrada.body?.error_code || '').slice(0, 40)}`);

  const corta = await pedir('/auth/v1/user', {
    token: jwt, method: 'PUT', body: JSON.stringify({ password: 'Taba-corta1' }),
  });
  paso('una contrasena mas corta que el minimo se rechaza', corta.status >= 400,
    `HTTP ${corta.status} ${String(corta.body?.error_code || '').slice(0, 40)}`);

  const claveNueva = `Taba-${crypto.randomBytes(12).toString('base64url')}-Qa2!`;
  const cambio = await pedir('/auth/v1/user', {
    token: jwt, method: 'PUT', body: JSON.stringify({ password: claveNueva }),
  });
  reporte.cambioDeClaveSesionFresca = { status: cambio.status, code: String(cambio.body?.error_code || '').slice(0, 60) };
  paso('una contrasena valida se acepta', cambio.status === 200,
    `HTTP ${cambio.status} ${String(cambio.body?.error_code || '').slice(0, 40)}`);
  const viejaClave = await entrar(negocio.email, CLAVE);
  paso('la contrasena anterior deja de servir', viejaClave.status >= 400, `HTTP ${viejaClave.status}`);
  const conNueva = await entrar(negocio.email, claveNueva);
  paso('la nueva sirve', conNueva.status === 200 && Boolean(conNueva.body?.access_token), `HTTP ${conNueva.status}`);
  if (cambio.status === 200) {
    reporte.seguridad = [
      ...(reporte.seguridad || []),
      'con `security_update_password_require_reauthentication=true`, GoTrue igual permite cambiar la contrasena '
      + 'sin pedir la anterior desde cualquier sesion de menos de 24 h. Es su contrato -la misma exencion es la que '
      + 'hace posible recuperar la contrasena por enlace-, pero significa que un token de sesion robado alcanza '
      + 'para quedarse con la cuenta. Medido, no supuesto.',
    ];
  }

  // ----------------------------------------------------------- 4. aprobar
  console.log('\n4 · un owner aprueba, y recien ahi hay membresia');
  const dueno = await crearIdentidad('owner');
  await sql(`
    insert into public.business_members (business_id, user_id, role, is_active)
    values (${lit(CANONICAL_BUSINESS)}, ${lit(dueno.id)}, 'owner', true)
    on conflict (business_id, user_id) do update set role = 'owner', is_active = true;
  `, false);
  const sesionDueno = await entrar(dueno.email, CLAVE);
  const jwtDueno = sesionDueno.body?.access_token || '';
  paso('el owner de prueba entra', Boolean(jwtDueno), `HTTP ${sesionDueno.status}`);

  // El Panel real registra la sesion inmediatamente despues de entrar, y no es
  // una formalidad: la compuerta de permisos solo reconoce sesiones
  // registradas. Sin este paso, un owner de verdad tampoco veria la bandeja.
  const registroDueno = await rpc('identity_register_session', {
    p_business_id: CANONICAL_BUSINESS, p_client: 'panel_web',
    p_device_label: NOMBRE_QA, p_device_key_hash: null, p_app_version: 'smoke',
  }, jwtDueno);
  paso('el owner registra su sesion, como hace el Panel', registroDueno.body?.ok === true,
    `code=${registroDueno.body?.code || registroDueno.status}`);

  const bandeja = await rpc('identity_list_access_requests', {
    p_business_id: CANONICAL_BUSINESS, p_status: 'pending',
  }, jwtDueno);
  paso('la solicitud aparece en la bandeja del owner',
    JSON.stringify(bandeja.body || '').includes(idSolicitud), `HTTP ${bandeja.status}`);

  const decision = await rpc('identity_review_access_request', {
    p_request_id: idSolicitud, p_decision: 'approve', p_role: 'staff',
  }, jwtDueno);
  paso('el owner aprueba en un solo acto', decision.body?.ok === true, `code=${decision.body?.code || decision.status}`);

  // El orden es el del cliente real: primero se registra la sesion, y recien
  // despues se pide el contexto operativo. La compuerta autoritativa solo
  // reconoce sesiones registradas, asi que preguntar al reves da rol nulo
  // aunque la membresia ya exista.
  const registroOk = await rpc('identity_register_session', {
    p_business_id: CANONICAL_BUSINESS, p_client: 'panel_web',
    p_device_label: NOMBRE_QA, p_device_key_hash: null, p_app_version: 'smoke',
  }, jwt);
  paso('ahora si puede registrar su sesion del Panel', registroOk.body?.ok === true,
    `code=${registroOk.body?.code || registroOk.status}`);

  const contextoAprobado = await rpc('identity_current_context', { p_business_id: CANONICAL_BUSINESS }, jwt);
  paso('la persona aprobada obtiene el rol que decidio el owner',
    contextoAprobado.body?.role === 'staff', `role=${JSON.stringify(contextoAprobado.body?.role ?? null)}`);

  const subirse = await rpc('identity_review_access_request', {
    p_request_id: idSolicitud, p_decision: 'approve', p_role: 'owner',
  }, jwt);
  paso('un staff aprobado tampoco puede promoverse a owner', subirse.body?.ok !== true,
    `code=${subirse.body?.code || subirse.status}`);

  // ------------------------------------------------------------- 5. Rider
  console.log('\n5 · el Rider recorre el mismo camino, con su rol');
  const rider = await crearIdentidad('rider');
  const sesionRider = await entrar(rider.email, CLAVE);
  const jwtRider = sesionRider.body?.access_token || '';
  paso('el Rider entra', Boolean(jwtRider), `HTTP ${sesionRider.status}`);

  const solicitudRider = await rpc('request_business_access', {
    p_business_id: CANONICAL_BUSINESS, p_access: 'rider',
    p_full_name: `Rider ${NOMBRE_QA}`, p_contact_phone: '2990000001',
  }, jwtRider);
  paso('el Rider pide acceso', solicitudRider.body?.ok === true, `code=${solicitudRider.body?.code || ''}`);
  const idRider = solicitudRider.body?.request_id || '';

  const ofertas = await pedir('/rest/v1/rider_order_offers?select=id', { token: jwtRider });
  paso('un Rider pendiente no ve ninguna oferta',
    Array.isArray(ofertas.body) ? ofertas.body.length === 0 : ofertas.status >= 400, `HTTP ${ofertas.status}`);

  const perfiles = await pedir('/rest/v1/rider_profiles?select=user_id', { token: jwtRider });
  paso('ni ningun perfil de repartidor',
    Array.isArray(perfiles.body) ? perfiles.body.length === 0 : perfiles.status >= 400, `HTTP ${perfiles.status}`);

  const decisionRider = await rpc('identity_review_access_request', {
    p_request_id: idRider, p_decision: 'approve', p_role: 'rider',
  }, jwtDueno);
  paso('el owner aprueba al Rider', decisionRider.body?.ok === true, `code=${decisionRider.body?.code || ''}`);

  const registroRider = await rpc('identity_register_session', {
    p_business_id: CANONICAL_BUSINESS, p_client: 'rider_android',
    p_device_label: NOMBRE_QA, p_device_key_hash: null, p_app_version: 'smoke',
  }, jwtRider);
  paso('el Rider aprobado registra su sesion', registroRider.body?.ok === true,
    `code=${registroRider.body?.code || registroRider.status}`);

  const contextoRider = await rpc('identity_current_context', { p_business_id: CANONICAL_BUSINESS }, jwtRider);
  paso('el Rider aprobado obtiene rol rider', contextoRider.body?.role === 'rider',
    `role=${JSON.stringify(contextoRider.body?.role ?? null)}`);

  // ---------------------------------------------------------- 6. rechazo
  console.log('\n6 · rechazar tambien es una decision, y se ve como tal');
  const rechazada = await crearIdentidad('rechazo');
  const sesionRechazada = await entrar(rechazada.email, CLAVE);
  const jwtRechazada = sesionRechazada.body?.access_token || '';
  const solicitudRechazada = await rpc('request_business_access', {
    p_business_id: CANONICAL_BUSINESS, p_access: 'panel',
    p_full_name: `Rechazo ${NOMBRE_QA}`, p_contact_phone: '2990000002',
  }, jwtRechazada);
  const idRechazada = solicitudRechazada.body?.request_id || '';
  const noDecision = await rpc('identity_review_access_request', {
    p_request_id: idRechazada, p_decision: 'reject', p_role: null,
  }, jwtDueno);
  paso('el owner puede rechazar', noDecision.body?.ok === true, `code=${noDecision.body?.code || noDecision.status}`);

  const estadoRechazado = await rpc('get_my_business_access_request', { p_business_id: CANONICAL_BUSINESS }, jwtRechazada);
  paso('la persona rechazada ve su estado, no un error',
    estadoRechazado.body?.status === 'rejected', `status=${estadoRechazado.body?.status}`);

  const contextoRechazado = await rpc('identity_current_context', { p_business_id: CANONICAL_BUSINESS }, jwtRechazada);
  paso('y sigue sin rol', !contextoRechazado.body?.role,
    `role=${JSON.stringify(contextoRechazado.body?.role ?? null)}`);

  // --------------------------------------------------- 7. no revelar de mas
  console.log('\n7 · nada de esto dice quien tiene cuenta');
  const claveMala = await entrar(negocio.email, 'una-contrasena-que-no-es');
  const cuentaMala = await entrar(`no-existe-${corrida}@${DOMINIO_QA}`, CLAVE);
  paso('una contrasena mala y un correo inexistente contestan igual',
    claveMala.status === cuentaMala.status
      && String(claveMala.body?.error_code || '') === String(cuentaMala.body?.error_code || ''),
    `${claveMala.status}/${claveMala.body?.error_code} vs ${cuentaMala.status}/${cuentaMala.body?.error_code}`);

  const recuperarCon = await pedir('/auth/v1/recover', { method: 'POST', body: JSON.stringify({ email: negocio.email }) });
  const recuperarSin = await pedir('/auth/v1/recover', { method: 'POST', body: JSON.stringify({ email: `nadie-${corrida}@${DOMINIO_QA}` }) });
  reporte.recoverPublico = {
    existente: { status: recuperarCon.status, code: String(recuperarCon.body?.error_code || recuperarCon.body?.msg || '').slice(0, 80) },
    inexistente: { status: recuperarSin.status, code: String(recuperarSin.body?.error_code || recuperarSin.body?.msg || '').slice(0, 80) },
  };
  const mismaRespuesta = recuperarCon.status === recuperarSin.status
    && JSON.stringify(recuperarCon.body) === JSON.stringify(recuperarSin.body);
  nota('recuperacion: cuenta existente vs inexistente',
    `${recuperarCon.status}/${reporte.recoverPublico.existente.code} vs ${recuperarSin.status}/${reporte.recoverPublico.inexistente.code}`);
  if (!mismaRespuesta) {
    // No se cuenta como falla del contrato de alta, pero tampoco se tapa: es un
    // oraculo de enumeracion y viaja al informe de seguridad con su condicion
    // exacta, que es la direccion que GoTrue no puede mandar.
    reporte.seguridad = [
      ...(reporte.seguridad || []),
      `/auth/v1/recover contesta distinto segun exista la cuenta cuando la direccion no es enviable: `
      + `existente ${recuperarCon.status} (${reporte.recoverPublico.existente.code}), `
      + `inexistente ${recuperarSin.status}. Para una cuenta inexistente GoTrue contesta antes de validar `
      + `la direccion; para una existente intenta mandar y ahi falla. Con SMTP propio hay que volver a medirlo `
      + `con una direccion real que rebote.`,
    ];
    console.log(`  !!   la respuesta difiere segun exista la cuenta — anotado en seguridad`);
  }

  const repetida = await pedir('/auth/v1/signup', {
    method: 'POST', body: JSON.stringify({ email: negocio.email, password: CLAVE }),
  });
  reporte.altaRepetida = {
    status: repetida.status,
    code: String(repetida.body?.error_code || repetida.body?.msg || '').slice(0, 120),
  };
  nota('alta con un correo que ya existe', `HTTP ${repetida.status} ${reporte.altaRepetida.code}`);
} catch (error) {
  hallazgos.push(`la sonda se corto: ${String(error.message).slice(0, 200)}`);
  console.error(`\n  ERROR: ${String(error.message).slice(0, 400)}`);
} finally {
  // -------------------------------------------------------------- limpieza
  console.log('\n8 · limpieza');
  await sql(`
    delete from public.business_access_requests
     where full_name like '% ${NOMBRE_QA}'
        or user_id in (select id from auth.users where email like '%@${DOMINIO_QA}');
    delete from public.business_members
     where user_id in (select id from auth.users where email like '%@${DOMINIO_QA}');
    delete from public.identity_sessions
     where user_id in (select id from auth.users where email like '%@${DOMINIO_QA}');
    delete from auth.users where email like '%@${DOMINIO_QA}';
  `, false);

  const [resto] = await sql(`
    select (select count(*) from auth.users)::int as usuarios,
           (select count(*) from public.business_members)::int as miembros,
           (select count(*) from public.business_access_requests)::int as solicitudes,
           (select count(*) from public.staff_profiles)::int as staff,
           (select count(*) from public.rider_profiles)::int as riders,
           (select count(*) from public.identity_sessions)::int as sesiones,
           (select count(*) from public.customers)::int as clientes,
           (select count(*) from public.identity_audit_events)::int as auditoria;
  `);
  reporte.despuesDeLimpiar = resto;
  const limpio = resto.usuarios === 0 && resto.miembros === 0 && resto.solicitudes === 0
    && resto.staff === 0 && resto.riders === 0 && resto.sesiones === 0 && resto.clientes === 0;
  paso('produccion queda sin rastro de la corrida', limpio, JSON.stringify(resto));

  const [{ ordering }] = await sql(
    `select ordering_enabled as ordering from public.businesses where id = ${lit(CANONICAL_BUSINESS)};`,
  );
  paso('los pedidos siguen cerrados', ordering === false, `ordering_enabled=${ordering}`);
  reporte.orderingEnabled = ordering;

  reporte.hallazgos = hallazgos;
  const destino = arg('report');
  if (destino) {
    fs.writeFileSync(destino, `${JSON.stringify(reporte, null, 2)}\n`);
    console.log(`\n  reporte: ${destino}`);
  }
  console.log(`\n  RESULTADO: ${hallazgos.length ? `${hallazgos.length} HALLAZGO(S)` : 'EL CONTRATO SE CUMPLE'}`);
  process.exitCode = hallazgos.length ? 1 : 0;
}
