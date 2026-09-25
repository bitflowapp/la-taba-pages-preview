#!/usr/bin/env node
/*
 * Seguridad OAuth del vendedor, medida contra Staging con sesiones reales.
 *
 * No hay consentimiento de ningún vendedor acá: se prueba todo lo que rodea al
 * consentimiento —quién puede iniciar la conexión, qué viaja en la URL de
 * autorización, cómo se guarda el state y el verifier, su vencimiento, que el
 * callback no acepte un state ausente, ajeno, reemplazado ni repetido, que un
 * código inventado no conecte nada, y que ningún token sea legible desde el
 * navegador—. El código OAuth inventado lo rechaza Mercado Pago (invalid_grant);
 * nunca se usa uno real.
 *
 * Deja la conexión del negocio de Staging exactamente como estaba: conectada,
 * con el mismo vendedor y el material cifrado intacto (sólo cambia la
 * generación, que es lo que hace cualquier «Conectar» desde el Panel).
 *
 *   node scripts/mercadopago/certificar-oauth-staging.mjs
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';

const REF = 'ucbtjcurawxjwjdvvcvj';
const BASE = `https://${REF}.supabase.co`;
const NEGOCIO = 'a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0';
const OTRO_NEGOCIO = '00000000-0000-4000-8000-000000000001';
const CLIENT_ID = '2691240967769590';
const CALLBACK = `${BASE}/functions/v1/mercadopago-oauth-callback`;
const PANEL = 'https://taba2-staging.pages.dev/';
const opciones = { auth: { persistSession: false, autoRefreshToken: false } };
const b64url = (bytes) => Buffer.from(bytes).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const digest = (value) => b64url(createHash('sha256').update(value).digest());
const igual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const resultados = [];
const registrar = (gate, pass, detalle = {}) => { resultados.push({ gate, resultado: pass ? 'PASS' : 'FAIL', ...detalle }); };

function claves() {
  const secreta = leerSecreto('STAGING SUPABASE SECRET KEY');
  const publicable = leerSecreto('STAGING SUPABASE PUBLISHABLE KEY');
  if (secreta?.usuario !== REF || publicable?.usuario !== REF) throw new Error('CLAVES_STAGING_NO_LIGADAS');
  return { secreta: secreta.secreto, publicable: publicable.secreto };
}
async function sesion(publicable, credencial, registrarPanel) {
  const cuenta = leerSecreto(credencial);
  const cliente = createClient(BASE, publicable, opciones);
  const { data, error } = await cliente.auth.signInWithPassword({ email: cuenta.usuario, password: cuenta.secreto });
  if (error || !data.session) throw new Error(`LOGIN_QA_FALLIDO:${credencial}`);
  if (registrarPanel) {
    const r = await cliente.rpc('identity_register_session', { p_business_id: NEGOCIO, p_client: 'panel_web',
      p_device_label: 'Certificacion OAuth MP', p_device_key_hash: null, p_app_version: 'mp-oauth-cert' });
    if (r.error || !r.data?.ok) throw new Error(`SESION_PANEL_NO_REGISTRADA:${credencial}`);
  }
  return { cliente, jwt: data.session.access_token, userId: data.user.id };
}
async function connect(jwt, publicable, cuerpo) {
  const r = await fetch(`${BASE}/functions/v1/mercadopago-connect`, {
    method: 'POST', signal: AbortSignal.timeout(30_000),
    headers: { 'content-type': 'application/json', apikey: publicable, ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) },
    body: JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  let json = null; try { json = JSON.parse(texto); } catch { json = null; }
  return { status: r.status, json, texto };
}
async function callback(query) {
  const r = await fetch(`${CALLBACK}?${new URLSearchParams(query)}`, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  const destino = r.headers.get('location') || '';
  let mpConnection = null;
  try { mpConnection = new URL(destino).searchParams.get('mp_connection'); } catch { mpConnection = null; }
  return { status: r.status, mp_connection: mpConnection, al_panel: destino.startsWith(PANEL) };
}

const { secreta, publicable } = claves();
const servicio = createClient(BASE, secreta, opciones);
const conexionAntes = (await servicio.from('mp_seller_connections').select('status,seller_id,application_id,generation,protected_tokens').eq('business_id', NEGOCIO).eq('environment', 'test').single()).data;
if (conexionAntes?.status !== 'connected') throw new Error('LA_CONEXION_DE_STAGING_DEBE_ESTAR_CONECTADA_ANTES');

const dueno = await sesion(publicable, 'STAGING PILOT OWNER QA 20260923', true);
const admin = await sesion(publicable, 'STAGING BUSINESS QA 20260920', true);
const staff = await sesion(publicable, 'STAGING PILOT STAFF QA 20260923', true);
const cliente = await sesion(publicable, 'STAGING CUSTOMER QA 20260920', false);

// Quién puede iniciar la conexión.
let r = await connect(null, publicable, { business_id: NEGOCIO, action: 'status' });
registrar('CONNECT_WITHOUT_SESSION_REJECTED', r.status === 401, { http: r.status, code: r.json?.code });
r = await connect(cliente.jwt, publicable, { business_id: NEGOCIO, action: 'connect' });
registrar('CUSTOMER_CANNOT_CONNECT', r.status === 403 && r.json?.code === 'BUSINESS_FORBIDDEN', { http: r.status, code: r.json?.code });
r = await connect(staff.jwt, publicable, { business_id: NEGOCIO, action: 'connect' });
registrar('STAFF_CANNOT_CONNECT', r.status === 403 && r.json?.code === 'BUSINESS_FORBIDDEN', { http: r.status, code: r.json?.code });
r = await connect(staff.jwt, publicable, { business_id: NEGOCIO, action: 'disconnect', confirmation: 'DISCONNECT_MERCADOPAGO' });
registrar('STAFF_CANNOT_DISCONNECT', r.status === 403 && r.json?.code === 'BUSINESS_FORBIDDEN', { http: r.status, code: r.json?.code });
r = await connect(dueno.jwt, publicable, { business_id: OTRO_NEGOCIO, action: 'connect' });
registrar('OWNER_OF_A_CANNOT_CONNECT_BUSINESS_B', r.status === 403, { http: r.status, code: r.json?.code });
r = await connect(dueno.jwt, publicable, { business_id: NEGOCIO, action: 'disconnect' });
registrar('DISCONNECT_REQUIRES_EXPLICIT_CONFIRMATION', r.status === 409 && r.json?.code === 'CONFIRMATION_REQUIRED', { http: r.status, code: r.json?.code });

// Lo que ve el Panel: estado, nunca material.
r = await connect(dueno.jwt, publicable, { business_id: NEGOCIO, action: 'status' });
const sinMaterial = !/APP_USR|TEST-|access_token|refresh_token|protected|v1\./i.test(r.texto);
registrar('STATUS_EXPOSES_NO_TOKEN_MATERIAL', r.status === 200 && sinMaterial
  && JSON.stringify(Object.keys(r.json?.connection || {}).sort()) === JSON.stringify(['connected_at', 'seller_id', 'status']),
  { http: r.status, claves: Object.keys(r.json?.connection || {}).sort(), estado: r.json?.connection?.status });

// PKCE y state en la URL de autorización.
r = await connect(dueno.jwt, publicable, { business_id: NEGOCIO, action: 'connect' });
const url1 = new URL(r.json?.authorization_url || 'https://invalid.invalid/');
const p1 = Object.fromEntries(url1.searchParams);
registrar('OAUTH_AUTHORIZATION_URL', r.status === 200 && url1.origin === 'https://auth.mercadopago.com.ar' && url1.pathname === '/authorization'
  && p1.client_id === CLIENT_ID && p1.response_type === 'code' && p1.redirect_uri === CALLBACK && p1.platform_id === 'mp'
  && p1.scope === 'read write offline_access', { origin: url1.origin, path: url1.pathname, client_id: p1.client_id, redirect_uri: p1.redirect_uri, scope: p1.scope });
registrar('PKCE_S256_CHALLENGE', p1.code_challenge_method === 'S256' && /^[\w-]{43}$/.test(p1.code_challenge || '') && !('code_verifier' in p1),
  { method: p1.code_challenge_method, challenge_len: (p1.code_challenge || '').length, verifier_in_url: 'code_verifier' in p1 });
registrar('STATE_UNPREDICTABLE_256_BIT', /^[\w-]{43}$/.test(p1.state || ''), { state_len: (p1.state || '').length });
let estados = (await servicio.from('mp_oauth_states').select('state_hash,user_id,environment,generation,protected_verifier,expires_at,created_at').eq('business_id', NEGOCIO)).data || [];
const ttlMin = estados[0] ? (Date.parse(estados[0].expires_at) - Date.parse(estados[0].created_at)) / 60000 : null;
registrar('STATE_STORED_ONLY_AS_DIGEST', estados.length === 1 && igual(estados[0].state_hash, digest(p1.state)) && !JSON.stringify(estados).includes(p1.state),
  { filas: estados.length });
registrar('STATE_BOUND_TO_BUSINESS_USER_ENVIRONMENT', estados[0]?.user_id === dueno.userId && estados[0]?.environment === 'test', { user_ok: estados[0]?.user_id === dueno.userId });
registrar('VERIFIER_ENCRYPTED_SERVER_SIDE', /^v1\.[\w-]+\.[\w-]+$/.test(estados[0]?.protected_verifier || ''), {});
registrar('STATE_TTL_10_MINUTES', ttlMin !== null && Math.abs(ttlMin - 10) < 0.2, { ttl_min: ttlMin && Number(ttlMin.toFixed(2)) });

// Un segundo inicio reemplaza al primero.
r = await connect(dueno.jwt, publicable, { business_id: NEGOCIO, action: 'connect' });
const p2 = Object.fromEntries(new URL(r.json?.authorization_url || 'https://invalid.invalid/').searchParams);
estados = (await servicio.from('mp_oauth_states').select('state_hash').eq('business_id', NEGOCIO)).data || [];
registrar('NEW_CONNECT_REPLACES_PREVIOUS_STATE', estados.length === 1 && igual(estados[0].state_hash, digest(p2.state)) && p2.code_challenge !== p1.code_challenge, { filas: estados.length });

// Callback: todo lo que no es el state vigente termina en error, sin conectar nada.
const codigoInventado = `TG-${b64url(randomBytes(24))}`;
let c = await callback({ code: codigoInventado });
registrar('CALLBACK_MISSING_STATE', c.status === 303 && c.mp_connection === 'error' && c.al_panel, c);
c = await callback({ state: b64url(randomBytes(32)), code: codigoInventado });
registrar('CALLBACK_WRONG_STATE', c.status === 303 && c.mp_connection === 'error', c);
c = await callback({ state: p1.state, code: codigoInventado });
registrar('CALLBACK_SUPERSEDED_STATE', c.status === 303 && c.mp_connection === 'error', c);
c = await callback({ state: p2.state, code: codigoInventado, business_id: OTRO_NEGOCIO });
estados = (await servicio.from('mp_oauth_states').select('state_hash').eq('business_id', NEGOCIO)).data || [];
registrar('CALLBACK_FORGED_CODE_REJECTED_AND_STATE_CONSUMED', c.status === 303 && c.mp_connection === 'error' && estados.length === 0, { ...c, estados_restantes: estados.length });
c = await callback({ state: p2.state, code: codigoInventado });
registrar('CALLBACK_REPLAY_REJECTED', c.status === 303 && c.mp_connection === 'error', c);
// Un state vigente repetido en la URL se rechaza al parsear, antes de consumirlo.
r = await connect(dueno.jwt, publicable, { business_id: NEGOCIO, action: 'connect' });
const p4 = Object.fromEntries(new URL(r.json?.authorization_url || 'https://invalid.invalid/').searchParams);
const duplicado = await fetch(`${CALLBACK}?state=${p4.state}&state=${p4.state}&code=${codigoInventado}`, { redirect: 'manual' });
estados = (await servicio.from('mp_oauth_states').select('state_hash').eq('business_id', NEGOCIO)).data || [];
registrar('CALLBACK_DUPLICATED_PARAMETERS_REJECTED', duplicado.status === 303
  && new URL(duplicado.headers.get('location')).searchParams.get('mp_connection') === 'error'
  && estados.length === 1 && igual(estados[0].state_hash, digest(p4.state)), { http: duplicado.status, state_intacto: estados.length === 1 });

// El consentimiento cancelado también consume el state.
r = await connect(admin.jwt, publicable, { business_id: NEGOCIO, action: 'connect' });
const p3 = Object.fromEntries(new URL(r.json?.authorization_url || 'https://invalid.invalid/').searchParams);
registrar('ADMIN_CAN_START_CONNECTION', r.status === 200 && /^[\w-]{43}$/.test(p3.state || ''), { http: r.status });
c = await callback({ state: p3.state, error: 'access_denied' });
estados = (await servicio.from('mp_oauth_states').select('state_hash').eq('business_id', NEGOCIO)).data || [];
registrar('DENIED_CONSENT_CANCELLED_AND_CONSUMED', c.status === 303 && c.mp_connection === 'cancelled' && estados.length === 0, c);
c = await callback({ state: p3.state, error: 'access_denied' });
registrar('DENIED_CONSENT_REPLAY_REJECTED', c.status === 303 && c.mp_connection === 'error', c);

// Material de tokens: invisible desde el navegador, con cualquier sesión.
for (const [nombre, jwt] of [['anon', null], ['customer', cliente.jwt], ['owner', dueno.jwt]]) {
  for (const tabla of ['mp_seller_connections', 'mp_oauth_states']) {
    const lectura = await fetch(`${BASE}/rest/v1/${tabla}?select=*`, { headers: { apikey: publicable, ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) } });
    const cuerpo = await lectura.text();
    registrar(`RLS_${tabla.toUpperCase()}_${nombre.toUpperCase()}_DENIED`, lectura.status === 401 || lectura.status === 403 || (lectura.status === 200 && cuerpo.trim() === '[]'),
      { http: lectura.status, filas: lectura.status === 200 ? JSON.parse(cuerpo).length : null });
  }
}
for (const [rpc, args] of [['mp_consume_oauth', { p_state_hash: 'x', p_environment: 'test' }], ['mp_finish_oauth', { p_business_id: NEGOCIO, p_environment: 'test', p_generation: NEGOCIO, p_seller_id: '1', p_application_id: '1', p_scopes: 'x', p_protected_tokens: 'x', p_expires_at: new Date().toISOString() }], ['mp_disconnect', { p_business_id: NEGOCIO, p_environment: 'test' }]]) {
  const llamada = await fetch(`${BASE}/rest/v1/rpc/${rpc}`, { method: 'POST', headers: { apikey: publicable, authorization: `Bearer ${dueno.jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(args) });
  registrar(`RPC_${rpc.toUpperCase()}_NOT_CALLABLE_FROM_BROWSER`, [401, 403, 404].includes(llamada.status), { http: llamada.status });
}

// La conexión quedó como estaba.
const conexionDespues = (await servicio.from('mp_seller_connections').select('status,seller_id,application_id,generation,protected_tokens').eq('business_id', NEGOCIO).eq('environment', 'test').single()).data;
registrar('EXISTING_CONNECTION_PRESERVED', conexionDespues.status === 'connected' && conexionDespues.seller_id === conexionAntes.seller_id
  && conexionDespues.application_id === conexionAntes.application_id && igual(conexionDespues.protected_tokens, conexionAntes.protected_tokens),
  { generacion_cambio: conexionDespues.generation !== conexionAntes.generation });

const fallas = resultados.filter((x) => x.resultado !== 'PASS');
console.log(JSON.stringify({ momento: new Date().toISOString(), total: resultados.length, pass: resultados.length - fallas.length, resultados }, null, 2));
if (fallas.length) process.exitCode = 1;
