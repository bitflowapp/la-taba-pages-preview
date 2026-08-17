#!/usr/bin/env node
/**
 * Smoke en vivo del alta autogestionada contra el Supabase PRODUCTIVO.
 *
 *   node scripts/live-registration-smoke.mjs --ref wwcpogltfgzgkrlilbcd --confirm
 *
 * Que hace, y por que asi:
 *
 * Crea identidades QA SINTETICAS, corre el circuito completo por HTTP real
 * —GoTrue de verdad, PostgREST de verdad, roles `anon` y `authenticated` de
 * verdad— y despues las borra. Sin esto, lo unico certificado seria el
 * comportamiento de un stack local: la mision anterior dejo escrito que su
 * verificacion remota fue integramente de catalogo, y esa es exactamente la
 * mitad que falta.
 *
 * Ninguna identidad usa un correo real: todas viven en `example.com`, que la
 * RFC 2606 reserva para documentacion y que por lo tanto no tiene buzones.
 * (El TLD `.invalid`, que seria mas explicito, lo rechaza el validador de
 * GoTrue antes de crear nada.)
 *
 * No toca pedidos, no toca pagos, no habilita ordering y no escribe una sola
 * fila comercial. Al terminar borra los usuarios QA, y el borrado arrastra por
 * FK sus membresias, perfiles, solicitudes, sesiones, perfiles de cliente y
 * direcciones.
 *
 * LO QUE NO SE PUEDE BORRAR, y se informa en vez de esconderse:
 * identity_audit_events es append-only por trigger y, desde la migracion
 * 20260812070000, tampoco tiene claves foraneas hacia auth.users. Las dos cosas
 * son deliberadas: un registro de auditoria tiene que sobrevivir a lo que
 * audita, y si al borrar la cuenta se pusiera su identificador en null la
 * auditoria perderia justamente el dato por el que existe. Los eventos que deje
 * este smoke quedan, con el uuid QA que ya no corresponde a ninguna cuenta. Su
 * metadata no lleva correos completos: solo el dominio.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? '' : String(process.argv[i + 1] || '').trim();
}

const ref = arg('ref');
const confirmed = process.argv.includes('--confirm');
const url = `https://${ref}.supabase.co`;

const results = [];
let failures = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 300) });
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} | ${name}${detail ? ` | ${detail}` : ''}`);
}

function fail(message) {
  console.error(`\nABORTADO. ${message}`);
  process.exit(1);
}

/**
 * Aborta el circuito SIN saltearse la limpieza.
 *
 * `fail` usa process.exit, y process.exit no corre el `finally`: la primera vez
 * que este guion fallo temprano se fue dejando lo que hubiera creado. Un smoke
 * que puede abandonar identidades en produccion es peor que no tenerlo.
 */
function abort(message) {
  throw new Error(message);
}

function guardTarget() {
  if (!ref) fail('Falta --ref.');
  const guard = execFileSync(
    process.execPath,
    [
      path.join(ROOT, 'scripts', 'assert-production-supabase-target.mjs'),
      '--ref', ref, '--url', url, '--category', 'live synthetic smoke',
    ],
    { encoding: 'utf8' },
  );
  console.log(guard.trim());
}

/** Claves publicas y de servicio del proyecto. Se quedan en memoria. */
function apiKeys() {
  const raw = execFileSync('supabase', ['projects', 'api-keys', '--project-ref', ref], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  const parsed = JSON.parse(raw.slice(raw.indexOf('{')));
  const keys = new Map((parsed.keys || []).map((k) => [k.name, k.api_key]));
  const anon = keys.get('anon');
  const service = keys.get('service_role');
  if (!anon || !service) fail('No pudimos leer las claves del proyecto.');
  return { anon, service };
}

async function rest(pathname, { key, token, method = 'POST', body, prefer } = {}) {
  const response = await fetch(`${url}${pathname}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token || key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, ok: response.ok, data };
}

const rpc = (name, args, opts) => rest(`/rest/v1/rpc/${name}`, { ...opts, body: args ?? {} });

/**
 * Crea la identidad QA por la via administrativa, con el correo ya confirmado.
 *
 * NO por `/auth/v1/signup`, y el motivo es un hallazgo de esta corrida que vale
 * la pena dejar escrito: produccion tiene `mailer_autoconfirm = false` y todavia
 * no tiene SMTP propio, asi que cada alta publica intenta mandar un correo de
 * confirmacion por el emisor compartido de Supabase y a la tercera contesta
 * `over_email_send_rate_limit`. Un smoke que necesita tres identidades no cabe
 * en ese limite, y forzarlo mediria el emisor de correo en vez del contrato.
 *
 * Lo que se pierde con esto es UNA sola cosa —que el `signup` publico funcione
 * de punta a punta— y esa es exactamente la que depende del SMTP. Queda como
 * compuerta de lanzamiento, no como resultado del contrato.
 */
async function createConfirmedIdentity(email, password, { key }) {
  return rest('/auth/v1/admin/users', {
    key,
    body: { email, password, email_confirm: true },
  });
}

async function signIn(email, password, { key }) {
  return rest('/auth/v1/token?grant_type=password', { key, body: { email, password } });
}

async function main() {
  guardTarget();
  if (!confirmed) {
    console.log('\nENSAYO. No se creo nada. Volve a correrlo con --confirm.');
    process.exit(2);
  }

  const { anon, service } = apiKeys();
  const stamp = Math.floor(Number(process.env.TABA_SMOKE_STAMP || '0')) || 0;
  const tag = `taba2qa${stamp || String(process.hrtime.bigint()).slice(-10)}`;
  const password = `Qa-${tag}-Xk9`;

  const people = {
    owner: `${tag}-owner@example.com`,
    panel: `${tag}-panel@example.com`,
    rider: `${tag}-rider@example.com`,
  };
  const created = [];
  const anonymousIds = [];

  console.log('\n--- SMOKE SINTETICO EN VIVO ---');
  console.log(`  destino  : ${ref}`);
  console.log(`  negocio  : ${BUSINESS_ID}`);
  console.log(`  etiqueta : ${tag}`);
  console.log('');

  try {
    // ── 0. Como esta configurada la puerta publica ────────────────────────
    const settings = await rest('/auth/v1/settings', { key: anon, method: 'GET' });
    const publicSignup = settings.data?.disable_signup === false;
    const autoconfirm = settings.data?.mailer_autoconfirm === true;
    check('el alta publica esta habilitada en Auth', publicSignup,
      `disable_signup=${settings.data?.disable_signup}`);
    check('la identidad anonima del cliente sigue habilitada',
      settings.data?.external?.anonymous_users === true || settings.data?.external?.anonymous === true,
      `anonymous=${settings.data?.external?.anonymous_users ?? settings.data?.external?.anonymous}`);
    console.log(
      `  NOTA | confirmacion de correo ${autoconfirm ? 'DESACTIVADA' : 'ACTIVADA'}`
      + `${autoconfirm ? '' : ' -> el alta publica depende de SMTP propio (compuerta de lanzamiento)'}`,
    );

    // ── 1. Identidades ────────────────────────────────────────────────────
    for (const [role, email] of Object.entries(people)) {
      const response = await createConfirmedIdentity(email, password, { key: service });
      const id = response.data?.user?.id || response.data?.id;
      if (!id) abort(`No pudimos crear la identidad QA de ${role}: ${JSON.stringify(response.data).slice(0, 200)}`);
      created.push(id);
      people[`${role}Id`] = id;
    }
    check('el harness crea tres identidades QA con correo confirmado', created.length === 3, `${created.length} usuarios`);

    // Crear la cuenta no otorga nada. Se comprueba ANTES de tocar membresias.
    const preTokens = await signIn(people.panel, password, { key: anon });
    const preToken = preTokens.data?.access_token;
    check('la cuenta recien creada puede entrar a Auth', Boolean(preToken));
    const preContext = await rpc('identity_current_context', { p_business_id: BUSINESS_ID }, { key: anon, token: preToken });
    check(
      'y la compuerta le contesta que no tiene rol',
      preContext.ok && preContext.data?.role === null,
      `role=${JSON.stringify(preContext.data?.role)}`,
    );

    // ── 2. Owner sintetico, por la unica via habilitada fuera de las RPC ───
    // service_role tiene una via explicita en el guard de membresias, y existe
    // justamente para el arranque de un entorno. Es el mismo camino que usa
    // scripts/bootstrap-first-business-owner.mjs.
    for (const [table, row] of [
      ['business_members', { business_id: BUSINESS_ID, user_id: people.ownerId, role: 'owner', is_active: true }],
      ['identity_user_security', { business_id: BUSINESS_ID, user_id: people.ownerId }],
      ['staff_profiles', { business_id: BUSINESS_ID, user_id: people.ownerId, full_name: 'QA Owner Sintetico' }],
    ]) {
      const inserted = await rest(`/rest/v1/${table}`, { key: service, body: row, prefer: 'return=minimal' });
      if (!inserted.ok) abort(`No pudimos preparar el owner QA (${table}): ${JSON.stringify(inserted.data).slice(0, 200)}`);
    }

    const ownerSession = await signIn(people.owner, password, { key: anon });
    const ownerToken = ownerSession.data?.access_token;
    const ownerRegister = await rpc('identity_register_session', {
      p_business_id: BUSINESS_ID, p_client: 'panel_web', p_device_label: 'QA smoke', p_device_key_hash: null, p_app_version: 'smoke',
    }, { key: anon, token: ownerToken });
    check('el owner QA registra su sesion y la compuerta lo reconoce',
      ownerRegister.ok && ownerRegister.data?.ok === true && ownerRegister.data?.role === 'owner',
      `code=${ownerRegister.data?.code}`);

    // ── 3. Solicitudes ────────────────────────────────────────────────────
    const panelToken = preToken;
    const panelRequest = await rpc('request_business_access', {
      p_business_id: BUSINESS_ID, p_access: 'panel', p_full_name: 'QA Panel Sintetico', p_contact_phone: '2996000001',
    }, { key: anon, token: panelToken });
    check('pedir acceso al Panel entra como pendiente',
      panelRequest.ok && panelRequest.data?.code === 'pending', `code=${panelRequest.data?.code}`);

    const panelRepeat = await rpc('request_business_access', {
      p_business_id: BUSINESS_ID, p_access: 'panel', p_full_name: 'QA Panel Sintetico', p_contact_phone: '2996000001',
    }, { key: anon, token: panelToken });
    check('insistir devuelve la misma solicitud, no crea otra',
      panelRepeat.data?.code === 'already_pending', `code=${panelRepeat.data?.code}`);

    const riderSession = await signIn(people.rider, password, { key: anon });
    const riderToken = riderSession.data?.access_token;
    const riderNoPhone = await rpc('request_business_access', {
      p_business_id: BUSINESS_ID, p_access: 'rider', p_full_name: 'QA Rider Sintetico', p_contact_phone: null,
    }, { key: anon, token: riderToken });
    check('un Rider sin telefono no entra', riderNoPhone.data?.code === 'phone_required', `code=${riderNoPhone.data?.code}`);

    const riderRequest = await rpc('request_business_access', {
      p_business_id: BUSINESS_ID, p_access: 'rider', p_full_name: 'QA Rider Sintetico', p_contact_phone: '2996000002',
    }, { key: anon, token: riderToken });
    check('pedir ser Rider entra como pendiente',
      riderRequest.ok && riderRequest.data?.code === 'pending', `code=${riderRequest.data?.code}`);

    // ── 4. Lo que el pendiente NO puede ───────────────────────────────────
    const riderBoard = await rpc('get_rider_delivery_board', {}, { key: anon, token: riderToken });
    check('un Rider pendiente no puede pedir el tablero', !riderBoard.ok, `status=${riderBoard.status}`);
    const riderQueue = await rpc('get_rider_queue', { p_business_id: BUSINESS_ID }, { key: anon, token: riderToken });
    check('ni la cola del comercio', !riderQueue.ok, `status=${riderQueue.status}`);
    const riderGps = await rpc('publish_rider_location_fanout', {
      p_lat: -38.95, p_lng: -68.06, p_accuracy: 8, p_heading: null, p_speed: null,
      p_captured_at: '2026-08-17T05:00:00Z', p_idempotency_key: 'qasmokekey000001', p_is_mock: false,
    }, { key: anon, token: riderToken });
    check('ni publicar GPS operativo', !riderGps.ok, `status=${riderGps.status}`);

    const tableRead = await rest('/rest/v1/business_access_requests?select=id', { key: anon, token: panelToken, method: 'GET' });
    check('la tabla de solicitudes no se lee desde el cliente', !tableRead.ok, `status=${tableRead.status}`);
    const memberWrite = await rest('/rest/v1/business_members', {
      key: anon, token: panelToken,
      body: { business_id: BUSINESS_ID, user_id: people.panelId, role: 'owner', is_active: true },
    });
    check('ni se puede insertar una membresia directa', !memberWrite.ok, `status=${memberWrite.status}`);

    const selfApprove = await rpc('identity_list_access_requests', { p_business_id: BUSINESS_ID, p_status: 'pending' },
      { key: anon, token: panelToken });
    check('el solicitante no ve la bandeja', !selfApprove.ok, `status=${selfApprove.status}`);

    // ── 5. La decision ────────────────────────────────────────────────────
    const inbox = await rpc('identity_list_access_requests', { p_business_id: BUSINESS_ID, p_status: 'pending' },
      { key: anon, token: ownerToken });
    const pending = Array.isArray(inbox.data) ? inbox.data : [];
    check('el owner ve las dos solicitudes', inbox.ok && pending.length === 2, `${pending.length} pendientes`);

    const panelRow = pending.find((r) => r.requested_access === 'panel');
    const riderRow = pending.find((r) => r.requested_access === 'rider');
    check('la solicitud de Rider solo ofrece el rol rider',
      JSON.stringify(riderRow?.roles_grantable) === '["rider"]', JSON.stringify(riderRow?.roles_grantable));

    const ownerAttempt = await rpc('identity_review_access_request', {
      p_request_id: panelRow?.request_id, p_decision: 'approve', p_role: 'owner', p_reason: null,
    }, { key: anon, token: ownerToken });
    check('nadie puede otorgar owner por esta via', ownerAttempt.data?.code === 'invalid_role', `code=${ownerAttempt.data?.code}`);

    const panelApproval = await rpc('identity_review_access_request', {
      p_request_id: panelRow?.request_id, p_decision: 'approve', p_role: 'staff', p_reason: null,
    }, { key: anon, token: ownerToken });
    check('el owner aprueba el acceso al Panel como staff',
      panelApproval.data?.code === 'approved' && panelApproval.data?.granted_role === 'staff',
      `code=${panelApproval.data?.code}`);

    const panelTwice = await rpc('identity_review_access_request', {
      p_request_id: panelRow?.request_id, p_decision: 'approve', p_role: 'admin', p_reason: null,
    }, { key: anon, token: ownerToken });
    check('aprobar de nuevo no sube el rol', panelTwice.data?.code === 'already_decided', `code=${panelTwice.data?.code}`);

    const riderApproval = await rpc('identity_review_access_request', {
      p_request_id: riderRow?.request_id, p_decision: 'approve', p_role: null, p_reason: null,
    }, { key: anon, token: ownerToken });
    check('el owner aprueba al Rider', riderApproval.data?.code === 'approved' && riderApproval.data?.granted_role === 'rider',
      `code=${riderApproval.data?.code}`);

    // ── 6. Aprobados, entran ──────────────────────────────────────────────
    const panelAfter = await signIn(people.panel, password, { key: anon });
    const panelAfterToken = panelAfter.data?.access_token;
    const panelRegister = await rpc('identity_register_session', {
      p_business_id: BUSINESS_ID, p_client: 'panel_web', p_device_label: 'QA smoke', p_device_key_hash: null, p_app_version: 'smoke',
    }, { key: anon, token: panelAfterToken });
    check('el aprobado ya registra su sesion como staff',
      panelRegister.data?.ok === true && panelRegister.data?.role === 'staff', `role=${panelRegister.data?.role}`);

    const riderAfter = await signIn(people.rider, password, { key: anon });
    const riderAfterToken = riderAfter.data?.access_token;
    await rpc('identity_register_session', {
      p_business_id: BUSINESS_ID, p_client: 'rider_android', p_device_label: 'QA smoke', p_device_key_hash: null, p_app_version: 'smoke',
    }, { key: anon, token: riderAfterToken });
    const boardAfter = await rpc('get_rider_delivery_board', {}, { key: anon, token: riderAfterToken });
    check('y el Rider aprobado recibe su tablero, vacio pero suyo',
      boardAfter.ok && Array.isArray(boardAfter.data?.orders) && boardAfter.data.orders.length === 0,
      `orders=${JSON.stringify(boardAfter.data?.orders)}`);

    // ── 7. Memoria del cliente, con identidades anonimas reales ───────────
    const customerA = await rest('/auth/v1/signup', { key: anon, body: {} });
    const customerB = await rest('/auth/v1/signup', { key: anon, body: {} });
    const tokenA = customerA.data?.access_token;
    const tokenB = customerB.data?.access_token;
    if (customerA.data?.user?.id) anonymousIds.push(customerA.data.user.id);
    if (customerB.data?.user?.id) anonymousIds.push(customerB.data.user.id);
    check('el cliente entra con identidad anonima real', Boolean(tokenA && tokenB), `status=${customerA.status}`);

    if (tokenA && tokenB) {
      const profileA = await rpc('upsert_current_customer_profile', { p_name: 'QA Cliente A', p_phone: '2996000010' },
        { key: anon, token: tokenA });
      check('el cliente A guarda su perfil', profileA.ok && profileA.data?.name === 'QA Cliente A', `status=${profileA.status}`);
      const addressA = await rpc('upsert_current_customer_address', {
        p_address: { label: 'Casa QA', street: 'San Martin', streetNumber: '100', city: 'Neuquen' },
      }, { key: anon, token: tokenA });
      check('y su direccion queda predeterminada',
        addressA.ok && addressA.data?.address?.isDefault === true, `status=${addressA.status}`);

      const readA = await rpc('get_current_customer_profile', {}, { key: anon, token: tokenA });
      check('el cliente A vuelve y TABA lo recuerda',
        readA.data?.profile?.name === 'QA Cliente A' && (readA.data?.addresses || []).length === 1,
        `addresses=${(readA.data?.addresses || []).length}`);

      const readB = await rpc('get_current_customer_profile', {}, { key: anon, token: tokenB });
      check('el cliente B no ve nada del cliente A',
        readB.ok && readB.data?.profile === null && (readB.data?.addresses || []).length === 0,
        `profile=${JSON.stringify(readB.data?.profile)}`);

      const stealAddress = await rpc('set_current_customer_default_address', {
        p_address_id: addressA.data?.address?.id,
      }, { key: anon, token: tokenB });
      check('y no puede tocar su direccion', !stealAddress.ok, `status=${stealAddress.status}`);

      const tableCustomers = await rest(
        `/rest/v1/customers?select=id,name`, { key: anon, token: tokenB, method: 'GET' },
      );
      check('la tabla de clientes solo devuelve lo propio',
        tableCustomers.ok && Array.isArray(tableCustomers.data) && tableCustomers.data.length === 0,
        `rows=${Array.isArray(tableCustomers.data) ? tableCustomers.data.length : 'n/a'}`);
    }
  } catch (error) {
    // Se anota como una comprobacion fallida y se sigue: lo que no puede pasar
    // es saltear la limpieza de abajo.
    check('el circuito completo corrio sin abortar', false, error?.message || String(error));
  } finally {
    // ── 8. Limpieza ───────────────────────────────────────────────────────
    const toDelete = [...created, ...anonymousIds];
    let deleted = 0;
    for (const id of toDelete) {
      const response = await rest(`/auth/v1/admin/users/${id}`, { key: service, method: 'DELETE' });
      if (response.ok) deleted += 1;
    }
    console.log('');
    check('todas las identidades QA se borraron', deleted === toDelete.length, `${deleted}/${toDelete.length}`);

    const counts = await rest(
      '/rest/v1/business_access_requests?select=id',
      { key: service, method: 'GET' },
    );
    check('no queda ninguna solicitud', Array.isArray(counts.data) && counts.data.length === 0,
      `rows=${Array.isArray(counts.data) ? counts.data.length : JSON.stringify(counts.data).slice(0, 80)}`);
    const members = await rest('/rest/v1/business_members?select=id', { key: service, method: 'GET' });
    check('no queda ninguna membresia', Array.isArray(members.data) && members.data.length === 0,
      `rows=${Array.isArray(members.data) ? members.data.length : 'n/a'}`);
    const customers = await rest('/rest/v1/customers?select=id', { key: service, method: 'GET' });
    check('no queda ningun perfil de cliente', Array.isArray(customers.data) && customers.data.length === 0,
      `rows=${Array.isArray(customers.data) ? customers.data.length : 'n/a'}`);
    const orders = await rest('/rest/v1/orders?select=id', { key: service, method: 'GET' });
    check('y no se creo ni un pedido', Array.isArray(orders.data) && orders.data.length === 0,
      `rows=${Array.isArray(orders.data) ? orders.data.length : 'n/a'}`);

    const audit = await rest('/rest/v1/identity_audit_events?select=event_type,actor_user_id,subject_user_id',
      { key: service, method: 'GET' });
    const rows = Array.isArray(audit.data) ? audit.data : [];
    console.log('');
    console.log('--- AUDITORIA QUE QUEDA, POR DISENIO ---');
    console.log(`  eventos totales                : ${rows.length}`);
    console.log('  identity_audit_events es append-only por trigger y no tiene FK');
    console.log('  hacia auth.users (migracion 20260812070000): no se puede borrar');
    console.log('  ni desde una funcion definer, y conserva el uuid que audito.');
    console.log('  Es lo correcto: una auditoria que se borra con lo que audita no');
    console.log('  es una auditoria. Su metadata no lleva correos completos.');
    for (const row of rows) console.log(`    - ${row.event_type}`);

    console.log('');
    console.log(`--- RESULTADO: ${failures === 0 ? 'PASS' : `FAIL (${failures})`} ---`);
    console.log(JSON.stringify({ tag, checks: results, auditRowsLeft: rows.length }, null, 2));
  }

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => fail(error?.stack || String(error)));
