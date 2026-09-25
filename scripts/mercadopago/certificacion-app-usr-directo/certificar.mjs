#!/usr/bin/env node
/*
 * CERTIFICACIÓN DE CHECKOUT PRO DE PRUEBA CON EL APP_USR DIRECTO — SÓLO STAGING.
 *
 * Es lo que pidió soporte de Mercado Pago en WCS-51579: crear la preferencia con
 * el Access Token APP_USR de «Credenciales de prueba» de la aplicación de
 * Staging —no con el token OAuth del vendedor—, abrir exactamente
 * `response.init_point` y pagar con un comprador de prueba distinto, en una
 * sesión limpia.
 *
 * ESTO NO ES LA ARQUITECTURA PRODUCTIVA. En producción cada comercio conecta su
 * cuenta por OAuth y la preferencia la crea `mercadopago-create-preference` con
 * el token de ESE vendedor. Este script aísla una variable del proveedor y no
 * puede correr fuera de Staging:
 *   - el proyecto está fijo y las claves se comparan contra la Management API;
 *   - el token directo tiene que ser del vendedor de prueba (`/users/me`:
 *     test_user, MLA) y ese vendedor tiene que ser el mismo que está conectado
 *     por OAuth al negocio de prueba, que es el que lee el pago de vuelta;
 *   - el pedido nace por el camino normal (`mercadopago-create-checkout-session`
 *     con la sesión del cliente QA), la preferencia se arma con
 *     `preferenceRequest()` —el constructor del Edge Function— y se registra con
 *     `record_mercadopago_preference_created_v2`. El pago vuelve por el
 *     circuito de siempre: webhook firmado, cola, worker, pedido.
 *
 * Ningún secreto se imprime ni se escribe. Los valores viven en el Credential
 * Manager de Windows; la evidencia (fuera del repositorio) guarda sólo
 * identificadores de recursos de prueba, request IDs y huellas.
 *
 *   node scripts/mercadopago/certificacion-app-usr-directo/certificar.mjs preparar [--nuevo]
 *   node scripts/mercadopago/certificacion-app-usr-directo/certificar.mjs verificar
 *   node scripts/mercadopago/certificacion-app-usr-directo/certificar.mjs reembolsar
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { leerSecreto } from '../../e2e-production-sale/secretos-windows.mjs';
import { buildMercadoPagoCheckoutPayload } from '../../../js/payments/mercadopago-checkout.js';

const REF = 'ucbtjcurawxjwjdvvcvj';
const BASE = `https://${REF}.supabase.co`;
const PANEL = 'https://taba2-staging.pages.dev';
const NEGOCIO = 'a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0';
const PRODUCTO = 'e00468cb-8693-4ed5-ace7-42c945a80a11';
const APP_INTEGRADORA = '2691240967769590';
const VENDEDOR = '3594962708';
const COMPRADOR = '3594962710';
const API = 'https://api.mercadopago.com';
const DIR = path.join(os.tmpdir(), 'la-taba-mp-directo');
const FLUJO = process.argv.includes('--flujo=oauth') ? 'oauth' : 'directo';
const ESTADO = path.join(DIR, FLUJO === 'oauth' ? 'estado-oauth.json' : 'estado.json');
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const REFUND_CONFIRMATION = 'I_UNDERSTAND_THIS_REQUESTS_A_MERCADO_PAGO_REFUND';

const huella = (valor) => createHash('sha256').update(valor).digest('hex');
const ahora = () => {
  const utc = new Date();
  const ar = new Date(utc.getTime() - 3 * 3600_000).toISOString().replace('Z', '-03:00');
  return { utc: utc.toISOString(), argentina: ar };
};
const igual = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && timingSafeEqual(x, y);
};
const falla = (codigo) => { throw new Error(codigo); };

function leerEstado() {
  return existsSync(ESTADO) ? JSON.parse(readFileSync(ESTADO, 'utf8')) : null;
}
function guardarEstado(estado) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(ESTADO, `${JSON.stringify(estado, null, 2)}\n`);
}

/** El APP_USR de «Credenciales de prueba», sólo en memoria. */
function tokenDirecto() {
  const credencial = leerSecreto('MP STAGING ACCESS TOKEN');
  const token = credencial?.secreto?.trim() || '';
  const forma = /^APP_USR-(\d+)-(\d{6})-[0-9a-f]+-(\d+)$/.exec(token);
  if (!forma) falla('TOKEN_DIRECTO_AUSENTE_O_CON_OTRA_FORMA');
  if (forma[3] !== VENDEDOR) falla('TOKEN_DIRECTO_DE_OTRO_VENDEDOR');
  return { token, aplicacionDeLaCredencial: forma[1], huella12: huella(token).slice(0, 12) };
}

async function mp(token, ruta, init = {}) {
  const respuesta = await fetch(`${API}${ruta}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const texto = await respuesta.text();
  let cuerpo = null;
  try { cuerpo = JSON.parse(texto); } catch { cuerpo = null; }
  return { status: respuesta.status, cuerpo, texto, requestId: respuesta.headers.get('x-request-id') || '' };
}

async function identidadVendedor(token) {
  const r = await mp(token, '/users/me');
  if (r.status !== 200 || String(r.cuerpo?.id) !== VENDEDOR || r.cuerpo?.site_id !== 'MLA'
    || !Array.isArray(r.cuerpo?.tags) || !r.cuerpo.tags.includes('test_user')) falla('VENDEDOR_DE_PRUEBA_NO_VERIFICADO');
  return { user_id: VENDEDOR, site_id: 'MLA', test_user: true, request_id: r.requestId };
}

/** Claves de Staging ligadas al proyecto y comparadas contra la Management API. */
async function clavesStaging() {
  const secreta = leerSecreto('STAGING SUPABASE SECRET KEY');
  const publicable = leerSecreto('STAGING SUPABASE PUBLISHABLE KEY');
  if (secreta?.usuario !== REF || publicable?.usuario !== REF
    || !secreta.secreto.startsWith('sb_secret_') || !publicable.secreto.startsWith('sb_publishable_')) falla('CLAVES_STAGING_NO_LIGADAS');
  const pat = process.env.SUPABASE_ACCESS_TOKEN?.trim() || leerSecreto('CP SUPABASE ACCESS TOKEN')?.secreto?.trim();
  if (!pat) falla('SIN_TOKEN_DE_GESTION_PARA_VERIFICAR_CLAVES');
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${pat}` }, signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) falla(`CLAVES_STAGING_HTTP_${r.status}`);
  const claves = await r.json();
  if (!claves.some((k) => k.type === 'secret' && igual(k.api_key, secreta.secreto))
    || !claves.some((k) => k.type === 'publishable' && igual(k.api_key, publicable.secreto))) falla('CLAVES_STAGING_NO_COINCIDEN');
  return { secreta: secreta.secreto, publicable: publicable.secreto };
}

const opciones = { auth: { persistSession: false, autoRefreshToken: false } };

async function sesion(publicable, credencial) {
  const cuenta = leerSecreto(credencial);
  if (!cuenta?.usuario || !cuenta?.secreto) falla(`CUENTA_QA_AUSENTE:${credencial}`);
  const cliente = createClient(BASE, publicable, opciones);
  const { data, error } = await cliente.auth.signInWithPassword({ email: cuenta.usuario, password: cuenta.secreto });
  if (error || !data.session) falla(`LOGIN_QA_FALLIDO:${credencial}`);
  return { cliente, jwt: data.session.access_token, userId: data.user.id };
}

async function edge(nombre, jwt, publicable, cuerpo) {
  const r = await fetch(`${BASE}/functions/v1/${nombre}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}`, apikey: publicable, 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(45_000),
  });
  return { status: r.status, cuerpo: await r.json().catch(() => null) };
}

function construirPreferencia(preparation) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const r = spawnSync(npx, ['--yes', 'deno@2.6.1', 'run', '--node-modules-dir=none', '--allow-env', '--allow-read',
    path.join(AQUI, 'construir-preferencia.deno.ts')], {
    input: JSON.stringify({
      env: { MERCADOPAGO_ENVIRONMENT: 'test', SUPABASE_URL: BASE, TABA_CHECKOUT_BASE_URL: PANEL },
      preparation,
    }),
    encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 1 << 20,
  });
  if (r.status !== 0) falla(`CONSTRUCTOR_DE_PREFERENCIA_FALLO:${(r.stderr || '').slice(-300)}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

async function preparar({ nuevo }) {
  const previo = leerEstado();
  if (previo && previo.fase !== 'cerrado' && !nuevo) falla('YA_HAY_UN_INTENTO_ABIERTO_USAR_VERIFICAR_O_--nuevo');
  const inicio = ahora();
  const { token, aplicacionDeLaCredencial, huella12 } = tokenDirecto();
  const vendedor = await identidadVendedor(token);
  const { secreta, publicable } = await clavesStaging();
  const servicio = createClient(BASE, secreta, opciones);

  // El vendedor del token directo tiene que ser el mismo que el negocio tiene
  // conectado por OAuth: es con esa conexión que La Taba lee el pago de vuelta.
  const { data: conexion, error: conexionError } = await servicio.from('mp_seller_connections')
    .select('seller_id,application_id,status,generation').eq('business_id', NEGOCIO).eq('environment', 'test').maybeSingle();
  if (conexionError || conexion?.status !== 'connected' || conexion.seller_id !== VENDEDOR
    || conexion.application_id !== APP_INTEGRADORA) falla('CONEXION_OAUTH_DEL_NEGOCIO_NO_COINCIDE');
  const { data: stockAntes } = await servicio.from('products').select('stock').eq('id', PRODUCTO).single();

  const cliente = await sesion(publicable, 'STAGING CUSTOMER QA 20260920');
  const payload = buildMercadoPagoCheckoutPayload({
    businessId: NEGOCIO,
    clientRequestId: randomUUID(),
    values: { deliveryMode: 'pickup', customerName: 'QA Certificacion Mercado Pago', customerPhone: '2995550147' },
    items: [{ product_id: PRODUCTO, quantity: 1 }],
  });
  const checkout = await edge('mercadopago-create-checkout-session', cliente.jwt, publicable, payload);
  const checkoutSessionId = checkout.cuerpo?.checkout?.checkout_session_id;
  if (checkout.status !== 200 || !checkoutSessionId) falla(`CHECKOUT_SESSION_HTTP_${checkout.status}:${checkout.cuerpo?.code || ''}`);

  const { data: preparation, error: prepError } = await servicio.rpc('prepare_mercadopago_preference_v2', {
    p_checkout_session_id: checkoutSessionId, p_customer_id: cliente.userId, p_new_attempt: false,
  });
  if (prepError || !preparation?.payment_attempt_id || preparation.preference_id) falla(`PREPARACION_FALLIDA:${prepError?.code || ''}`);
  const { data: autoridad, error: autoridadError } = await servicio.rpc('get_mercadopago_payment_authority_v2', {
    p_business_id: NEGOCIO, p_environment: 'test', p_checkout_session_id: checkoutSessionId,
    p_customer_id: cliente.userId, p_payment_attempt_id: preparation.payment_attempt_id,
  });
  if (autoridadError || !/^[a-f0-9]{64}$/.test(autoridad?.authority_version || '')
    || autoridad?.seller?.seller_id !== VENDEDOR) falla('AUTORIDAD_DEL_INTENTO_NO_DISPONIBLE');

  const cuerpo = construirPreferencia(preparation);
  const suma = cuerpo.items.reduce((total, item) => total + Number(item.unit_price) * Number(item.quantity), 0);
  if (cuerpo.external_reference !== preparation.external_reference
    || cuerpo.notification_url !== `${BASE}/functions/v1/mercadopago-webhook`
    || Number(suma.toFixed(2)) !== Number(preparation.total)
    || cuerpo.metadata?.payment_attempt_id !== preparation.payment_attempt_id) falla('CUERPO_DE_PREFERENCIA_INCONSISTENTE');

  const creada = await mp(token, '/checkout/preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': preparation.idempotency_key },
    body: JSON.stringify(cuerpo),
  });
  const pref = creada.cuerpo || {};
  if (creada.status !== 201 && creada.status !== 200) falla(`PREFERENCIA_HTTP_${creada.status}`);
  if (!pref.id || !pref.init_point || new URL(pref.init_point).hostname !== 'www.mercadopago.com.ar'
    || String(pref.collector_id) !== VENDEDOR || pref.external_reference !== preparation.external_reference) falla('PREFERENCIA_NO_COINCIDE');

  const { data: registrada, error: registroError } = await servicio.rpc('record_mercadopago_preference_created_v2', {
    p_business_id: NEGOCIO, p_environment: 'test', p_checkout_session_id: checkoutSessionId,
    p_customer_id: cliente.userId, p_payment_attempt_id: preparation.payment_attempt_id,
    p_expected_authority: autoridad.authority_version, p_preference_id: pref.id, p_init_point: pref.init_point,
    p_sandbox_init_point: pref.sandbox_init_point || null, p_response_hash: huella(creada.texto),
    p_provider_request_id: creada.requestId || null,
  });
  if (registroError || registrada?.attempt?.preference_id !== pref.id) falla(`REGISTRO_DE_PREFERENCIA_FALLIDO:${registroError?.code || ''}`);

  const leida = await mp(token, `/checkout/preferences/${encodeURIComponent(pref.id)}`);
  const releida = leida.cuerpo || {};
  const estado = {
    fase: 'preferencia_creada',
    proyecto: REF,
    negocio: NEGOCIO,
    producto: PRODUCTO,
    stock_antes: stockAntes?.stock ?? null,
    inicio,
    credencial: {
      tipo: 'APP_USR directo de Credenciales de prueba',
      aplicacion_de_la_credencial: aplicacionDeLaCredencial,
      huella_sha256_12: huella12,
      vendedor,
    },
    cliente_qa: cliente.userId,
    checkout_session_id: checkoutSessionId,
    payment_intent_id: preparation.payment_intent_id,
    payment_attempt_id: preparation.payment_attempt_id,
    external_reference: preparation.external_reference,
    total: preparation.total,
    expires_at: preparation.expires_at,
    preferencia: {
      id: pref.id,
      creada: ahora(),
      request_id_creacion: creada.requestId,
      request_id_lectura: leida.requestId,
      collector_id: String(releida.collector_id ?? pref.collector_id),
      client_id: String(releida.client_id ?? pref.client_id ?? ''),
      site_id: releida.site_id ?? pref.site_id ?? null,
      init_point: pref.init_point,
      sandbox_init_point_presente: Boolean(pref.sandbox_init_point),
      notification_url: releida.notification_url ?? cuerpo.notification_url,
      metadata: releida.metadata ?? null,
      auto_return: releida.auto_return ?? null,
      expiration_date_to: releida.expiration_date_to ?? null,
    },
    registro_en_la_taba: {
      attempt_status: registrada.attempt?.status,
      seller_id: registrada.attempt?.seller_id,
      seller_generation: registrada.attempt?.seller_generation,
      checkout_status: registrada.checkout?.status,
    },
  };
  guardarEstado(estado);
  const resumen = {
    DIRECT_APP_USR_USED: 'YES',
    TEST_PREFERENCE_CREATED: 'PASS',
    COLLECTOR_ID: estado.preferencia.collector_id,
    COLLECTOR_MATCH: estado.preferencia.collector_id === VENDEDOR ? 'PASS' : 'FAIL',
    CLIENT_ID: estado.preferencia.client_id,
    APPLICATION_MATCH: estado.preferencia.client_id === APP_INTEGRADORA ? 'PASS'
      : estado.preferencia.client_id === aplicacionDeLaCredencial ? 'CREDENTIAL_TEST_APP' : 'FAIL',
    SITE: estado.preferencia.site_id,
    preference_id: pref.id,
    init_point: pref.init_point,
    checkout_session_id: checkoutSessionId,
    payment_intent_id: preparation.payment_intent_id,
    expires_at: preparation.expires_at,
    creada_utc: estado.preferencia.creada.utc,
    creada_argentina: estado.preferencia.creada.argentina,
    request_id_creacion: creada.requestId,
    estado_local: ESTADO,
  };
  console.log(JSON.stringify(resumen, null, 2));
}

/**
 * La ARQUITECTURA PRODUCTIVA en Staging: el pedido y la preferencia los crean
 * los Edge Functions de siempre (`mercadopago-create-checkout-session` y
 * `mercadopago-create-preference`) con la sesión del cliente, y la preferencia
 * sale firmada por el token OAuth del vendedor conectado al negocio. Ningún
 * APP_USR estático interviene; el token directo sólo se usa para LEER la
 * preferencia, que pertenece al mismo vendedor.
 */
async function prepararOAuth({ nuevo }) {
  const previo = leerEstado();
  if (previo && previo.fase !== 'cerrado' && !nuevo) falla('YA_HAY_UN_INTENTO_ABIERTO_USAR_VERIFICAR_O_--nuevo');
  const inicio = ahora();
  const { secreta, publicable } = await clavesStaging();
  const servicio = createClient(BASE, secreta, opciones);
  const { data: conexion } = await servicio.from('mp_seller_connections')
    .select('seller_id,application_id,status,generation').eq('business_id', NEGOCIO).eq('environment', 'test').maybeSingle();
  if (conexion?.status !== 'connected' || conexion.seller_id !== VENDEDOR || conexion.application_id !== APP_INTEGRADORA) falla('CONEXION_OAUTH_DEL_NEGOCIO_NO_COINCIDE');
  const { data: stockAntes } = await servicio.from('products').select('stock').eq('id', PRODUCTO).single();
  const cliente = await sesion(publicable, 'STAGING CUSTOMER QA 20260920');
  const payload = buildMercadoPagoCheckoutPayload({
    businessId: NEGOCIO,
    clientRequestId: randomUUID(),
    values: { deliveryMode: 'pickup', customerName: 'QA Certificacion Mercado Pago', customerPhone: '2995550147' },
    items: [{ product_id: PRODUCTO, quantity: 1 }],
  });
  const checkout = await edge('mercadopago-create-checkout-session', cliente.jwt, publicable, payload);
  const checkoutSessionId = checkout.cuerpo?.checkout?.checkout_session_id;
  if (checkout.status !== 200 || !checkoutSessionId) falla(`CHECKOUT_SESSION_HTTP_${checkout.status}:${checkout.cuerpo?.code || ''}`);
  const pref = await edge('mercadopago-create-preference', cliente.jwt, publicable, { checkout_session_id: checkoutSessionId });
  if (pref.status !== 200 || !pref.cuerpo?.init_point) falla(`CREATE_PREFERENCE_HTTP_${pref.status}:${pref.cuerpo?.code || ''}`);
  const { data: intent } = await servicio.from('payment_intents').select('id,external_reference,preference_id,current_payment_attempt_id,expected_amount').eq('checkout_session_id', checkoutSessionId).single();
  const { data: intento } = await servicio.from('payment_attempts').select('id,preference_id,init_point,seller_id,seller_generation,status,provider_request_id').eq('id', intent.current_payment_attempt_id).single();
  if (intento.init_point !== pref.cuerpo.init_point || intento.preference_id !== intent.preference_id) falla('INIT_POINT_DISTINTO_AL_REGISTRADO');
  const { token } = tokenDirecto();
  const leida = await mp(token, `/checkout/preferences/${encodeURIComponent(intent.preference_id)}`);
  const estado = {
    fase: 'preferencia_creada', flujo: 'oauth', proyecto: REF, negocio: NEGOCIO, producto: PRODUCTO,
    stock_antes: stockAntes?.stock ?? null, inicio,
    credencial: { tipo: 'token OAuth del vendedor conectado (mp_seller_connections), usado por mercadopago-create-preference', seller_generation: intento.seller_generation },
    cliente_qa: cliente.userId, checkout_session_id: checkoutSessionId, payment_intent_id: intent.id,
    payment_attempt_id: intento.id, external_reference: intent.external_reference, total: intent.expected_amount,
    expires_at: pref.cuerpo.expires_at,
    preferencia: {
      id: intent.preference_id, creada: ahora(), request_id_creacion: intento.provider_request_id,
      request_id_lectura: leida.requestId, lectura_http: leida.status,
      collector_id: String(leida.cuerpo?.collector_id ?? ''), client_id: String(leida.cuerpo?.client_id ?? ''),
      site_id: leida.cuerpo?.site_id ?? null, init_point: pref.cuerpo.init_point,
      notification_url: leida.cuerpo?.notification_url ?? null, metadata: leida.cuerpo?.metadata ?? null,
    },
    registro_en_la_taba: { attempt_status: intento.status, seller_id: intento.seller_id, seller_generation: intento.seller_generation },
  };
  guardarEstado(estado);
  console.log(JSON.stringify({
    FLUJO: 'OAUTH_PRODUCTION_ARCHITECTURE', PREFERENCE_CREATED_BY: 'mercadopago-create-preference (seller OAuth token)',
    preference_id: estado.preferencia.id, COLLECTOR_ID: estado.preferencia.collector_id,
    COLLECTOR_MATCH: estado.preferencia.collector_id === VENDEDOR ? 'PASS' : 'UNVERIFIED',
    CLIENT_ID: estado.preferencia.client_id, APPLICATION_MATCH: estado.preferencia.client_id === APP_INTEGRADORA ? 'PASS' : 'UNVERIFIED',
    SITE: estado.preferencia.site_id, init_point: estado.preferencia.init_point, checkout_session_id: checkoutSessionId,
    payment_intent_id: intent.id, expires_at: estado.expires_at, creada_utc: estado.preferencia.creada.utc,
    creada_argentina: estado.preferencia.creada.argentina, estado_local: ESTADO,
  }, null, 2));
}

async function verificar() {
  const estado = leerEstado() || falla('SIN_INTENTO_PREPARADO');
  const { token } = tokenDirecto();
  const { secreta } = await clavesStaging();
  const servicio = createClient(BASE, secreta, opciones);
  const leer = async (consulta, codigo) => {
    const { data, error } = await consulta;
    if (error) falla(`${codigo}:${error.code || error.message}`);
    return data;
  };
  const intent = await leer(servicio.from('payment_intents').select('id,business_id,environment,internal_status,provider_payment_id,provider_status,provider_status_detail,paid_amount,expected_amount,refunded_amount,order_id,preference_id,external_reference,live_mode,approved_at,current_payment_attempt_id,security_review_reason').eq('id', estado.payment_intent_id).single(), 'INTENT');
  const sesionPago = await leer(servicio.from('checkout_sessions').select('id,status,completed_order_id,expires_at,total,manual_review_reason').eq('id', estado.checkout_session_id).single(), 'SESSION');
  const intento = await leer(servicio.from('payment_attempts').select('id,status,preference_id,init_point,seller_id,seller_generation').eq('id', estado.payment_attempt_id).single(), 'ATTEMPT');
  const eventos = await leer(servicio.from('payment_events').select('event_type,provider_status,webhook_receipt_id,provider_event_id,details,server_recorded_at').eq('payment_intent_id', estado.payment_intent_id).order('server_recorded_at'), 'EVENTS');
  const pagoId = intent.provider_payment_id;
  const recibos = pagoId ? await leer(servicio.from('payment_webhook_receipts').select('id,event_type,resource_id,signature_valid,processing_status,request_id,attempt_count,seller_business_id,received_at,processed_at').eq('resource_id', String(pagoId)).order('received_at'), 'RECEIPTS') : [];
  const trabajos = await leer(servicio.from('payment_outbox').select('id,topic,status,attempts,webhook_receipt_id,payment_intent_id,last_error,completed_at,created_at').or(`payment_intent_id.eq.${estado.payment_intent_id}${recibos.length ? `,webhook_receipt_id.in.(${recibos.map((r) => r.id).join(',')})` : ''}`).order('created_at'), 'OUTBOX');
  // finalize_paid_checkout_session crea el pedido con client_request_id = 'mp_' + la sesión sin guiones.
  const pedidos = await leer(servicio.from('orders').select('id,business_id,status,payment_method,manual_payment_status,total,client_request_id,created_at').eq('client_request_id', `mp_${estado.checkout_session_id.replace(/-/g, '')}`), 'ORDERS');
  const eventosPedido = pedidos[0] ? await leer(servicio.from('order_events').select('event_type,created_at').eq('order_id', pedidos[0].id).order('created_at'), 'ORDER_EVENTS') : [];
  const reservas = await leer(servicio.from('inventory_reservations').select('status,quantity,product_id').eq('checkout_session_id', estado.checkout_session_id), 'RESERVATIONS');
  const producto = await leer(servicio.from('products').select('stock').eq('id', estado.producto).single(), 'PRODUCT');
  const reembolsos = await leer(servicio.from('payment_refunds').select('id,status,amount,provider_refund_id,idempotency_key,requested_at,order_id').eq('payment_intent_id', estado.payment_intent_id), 'REFUNDS');

  let proveedor = null;
  let busqueda = null;
  const buscado = await mp(token, `/v1/payments/search?${new URLSearchParams({ external_reference: estado.external_reference, sort: 'date_created', criteria: 'desc', limit: '10' })}`);
  busqueda = { http: buscado.status, request_id: buscado.requestId, total: buscado.cuerpo?.paging?.total ?? null,
    estados: (buscado.cuerpo?.results || []).map((p) => ({ id: String(p.id), status: p.status, status_detail: p.status_detail })) };
  const idProveedor = pagoId || busqueda.estados.find((p) => p.status === 'approved')?.id || busqueda.estados[0]?.id;
  if (idProveedor) {
    const leido = await mp(token, `/v1/payments/${encodeURIComponent(idProveedor)}`);
    const p = leido.cuerpo || {};
    let preferenceId = p.preference_id || null;
    if (!preferenceId && p.order?.id) {
      const orden = await mp(token, `/merchant_orders/${encodeURIComponent(p.order.id)}`);
      preferenceId = orden.cuerpo?.preference_id || null;
    }
    proveedor = {
      http: leido.status, request_id: leido.requestId, id: String(p.id), status: p.status, status_detail: p.status_detail,
      collector_id: String(p.collector_id ?? ''), payer_id: String(p.payer?.id ?? ''), external_reference: p.external_reference,
      preference_id: preferenceId, merchant_order_id: p.order?.id ? String(p.order.id) : null,
      live_mode: p.live_mode, transaction_amount: p.transaction_amount, currency_id: p.currency_id,
      date_created: p.date_created, date_approved: p.date_approved, payment_method_id: p.payment_method_id,
      metadata_attempt: p.metadata?.payment_attempt_id ?? null,
      refunds: (p.refunds || []).map((r) => ({ id: String(r.id), status: r.status, amount: r.amount })),
    };
  }
  const aprobado = proveedor?.status === 'approved' || proveedor?.status === 'refunded';
  const recibosValidos = recibos.filter((r) => r.signature_valid === true);
  const eventosWebhook = eventos.filter((e) => e.webhook_receipt_id && recibosValidos.some((r) => r.id === e.webhook_receipt_id));
  const pedido = pedidos[0] || null;
  const gates = {
    PAYMENT_EXISTS: proveedor ? 'PASS' : 'FAIL',
    PAYMENT_APPROVED: aprobado && proveedor.collector_id === VENDEDOR && proveedor.payer_id !== VENDEDOR ? 'PASS' : 'FAIL',
    PREFERENCE_MATCH: proveedor?.preference_id === estado.preferencia.id && intent.preference_id === estado.preferencia.id ? 'PASS' : 'FAIL',
    EXTERNAL_REFERENCE_MATCH: proveedor?.external_reference === estado.external_reference ? 'PASS' : 'FAIL',
    BUYER_IS_TEST_BUYER: proveedor?.payer_id === COMPRADOR ? 'PASS' : (proveedor?.payer_id ? `OTHER:${proveedor.payer_id}` : 'UNKNOWN'),
    WEBHOOK_RECEIVED: recibos.length ? 'PASS' : 'FAIL',
    WEBHOOK_SIGNATURE: recibosValidos.length ? 'PASS' : (recibos.length ? 'FAIL' : 'NOT_RECEIVED'),
    WEBHOOK_PROCESSED: eventosWebhook.length ? 'PASS' : 'FAIL',
    ORDER_PAYMENT_CORRELATION: pedido && pedido.business_id === NEGOCIO && intent.order_id === pedido.id
      && sesionPago.completed_order_id === pedido.id && intento.seller_id === VENDEDOR
      && proveedor?.external_reference === intent.external_reference ? 'PASS' : 'FAIL',
    ORDERS_FOR_SESSION: pedidos.length,
  };
  console.log(JSON.stringify({ momento: ahora(), gates, intent, sesion: sesionPago, intento, pedido: pedidos, eventos,
    eventos_pedido: eventosPedido, recibos, trabajos, reservas, stock: { antes: estado.stock_antes, ahora: producto.stock }, reembolsos, proveedor, busqueda }, null, 2));
}

/**
 * Lo que hace la página de retorno de la tienda cuando el comprador vuelve:
 * `mercadopago-checkout-status` con la sesión del cliente. El Edge Function
 * relee el pago en Mercado Pago del lado del servidor y lo pasa por la misma
 * validación que el worker; nada de lo que trae la URL de retorno cuenta.
 */
async function volver() {
  const estado = leerEstado() || falla('SIN_INTENTO_PREPARADO');
  const { publicable } = await clavesStaging();
  const cliente = await sesion(publicable, 'STAGING CUSTOMER QA 20260920');
  if (cliente.userId !== estado.cliente_qa) falla('OTRO_CLIENTE');
  const r = await edge('mercadopago-checkout-status', cliente.jwt, publicable, { checkout_session_id: estado.checkout_session_id });
  const c = r.cuerpo?.checkout || {};
  estado.retorno_tienda = [...(estado.retorno_tienda || []), { momento: ahora(), http: r.status, reconciled: r.cuerpo?.reconciled === true,
    status: c.status ?? null, payment_status: c.payment_status ?? c.internal_status ?? null, order_id: c.completed_order_id ?? c.order_id ?? null }];
  guardarEstado(estado);
  console.log(JSON.stringify({ http: r.status, reconciled: r.cuerpo?.reconciled === true, checkout: c }, null, 2));
}

async function reembolsar() {
  const estado = leerEstado() || falla('SIN_INTENTO_PREPARADO');
  const { secreta, publicable } = await clavesStaging();
  const servicio = createClient(BASE, secreta, opciones);
  const dueno = await sesion(publicable, 'STAGING PILOT OWNER QA 20260923');
  const { data: registro, error } = await dueno.cliente.rpc('identity_register_session', {
    p_business_id: NEGOCIO, p_client: 'panel_web', p_device_label: 'Certificacion MP directo',
    p_device_key_hash: null, p_app_version: 'mp-cert-app-usr-directo',
  });
  if (error || !registro?.ok) falla(`SESION_DEL_DUENO_NO_REGISTRADA:${error?.code || ''}`);
  estado.reembolso ||= { idempotency_key: randomUUID(), intentos: [] };
  guardarEstado(estado);
  const cuerpo = {
    payment_intent_id: estado.payment_intent_id,
    idempotency_key: estado.reembolso.idempotency_key,
    confirmation: REFUND_CONFIRMATION,
    reason: 'Certificacion de prueba Checkout Pro (WCS-51579)',
  };
  for (const vuelta of ['primera', 'repeticion_misma_clave']) {
    const r = await edge('mercadopago-refund', dueno.jwt, publicable, cuerpo);
    estado.reembolso.intentos.push({ vuelta, momento: ahora(), http: r.status, ok: r.cuerpo?.ok ?? null, status: r.cuerpo?.status ?? null, code: r.cuerpo?.code ?? null });
    guardarEstado(estado);
  }
  const { data: filas } = await servicio.from('payment_refunds').select('id,status,amount,provider_refund_id,idempotency_key').eq('payment_intent_id', estado.payment_intent_id);
  console.log(JSON.stringify({ intentos: estado.reembolso.intentos, filas }, null, 2));
}

const [accion, ...resto] = process.argv.slice(2);
const acciones = { preparar: () => preparar({ nuevo: resto.includes('--nuevo') }), 'preparar-oauth': () => prepararOAuth({ nuevo: resto.includes('--nuevo') }), verificar, volver, reembolsar };
if (!acciones[accion]) {
  console.error('uso: certificar.mjs preparar [--nuevo] | preparar-oauth --flujo=oauth [--nuevo] | verificar | volver | reembolsar   (+ --flujo=oauth)');
  process.exit(2);
}
acciones[accion]().catch((error) => {
  console.error(`CERTIFICACION_DIRECTA_FALLO: ${String(error?.message || error).slice(0, 400)}`);
  process.exit(1);
});
