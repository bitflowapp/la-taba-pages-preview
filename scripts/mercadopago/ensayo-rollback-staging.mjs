#!/usr/bin/env node
/*
 * ENSAYO EN VIVO DEL ROLLBACK DE MERCADO PAGO POR NEGOCIO — SÓLO STAGING.
 *
 *   node scripts/mercadopago/ensayo-rollback-staging.mjs [--con-pago-manual]
 *
 * Apaga Mercado Pago para el negocio QA piloto con el mecanismo del producto
 * (el dueño, `configure_mercadopago_settings`, entorno de prueba) y comprueba lo
 * que el rollback promete:
 *   - el checkout deja de ofrecerlo y `mercadopago-create-checkout-session`
 *     contesta 409 sin crear sesión ni reservar stock;
 *   - la conexión del vendedor queda igual: conectada, misma generación, con
 *     su credencial sellada;
 *   - la historia no se toca: intents, pedidos, reembolsos y recibos;
 *   - con `--con-pago-manual`, el piloto de cobro manual corre completo con
 *     Mercado Pago apagado.
 * Después lo vuelve a encender y comprueba que se ofrece otra vez SIN
 * reconectar la cuenta. Si algo falla en el medio, el `finally` deja Mercado
 * Pago como estaba al empezar.
 *
 * Nada de lo que se imprime o guarda es un secreto: estados, conteos, códigos
 * HTTP y huellas. La evidencia queda en %TEMP%\la-taba-mp-directo\.
 */
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { buildMercadoPagoCheckoutPayload } from '../../js/payments/mercadopago-checkout.js';

const REF = 'ucbtjcurawxjwjdvvcvj';
const BASE = `https://${REF}.supabase.co`;
const NEGOCIO = 'a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0';
const PRODUCTO = 'e00468cb-8693-4ed5-ace7-42c945a80a11';
const DIR = path.join(os.tmpdir(), 'la-taba-mp-directo');
const opciones = { auth: { persistSession: false, autoRefreshToken: false } };
const falla = (codigo) => { throw new Error(codigo); };
const igual = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && timingSafeEqual(x, y);
};

function pat() {
  const valor = process.env.SUPABASE_ACCESS_TOKEN?.trim() || leerSecreto('CP SUPABASE ACCESS TOKEN')?.secreto?.trim();
  if (!valor) falla('SIN_TOKEN_DE_GESTION');
  return valor;
}

async function clavesStaging() {
  const secreta = leerSecreto('STAGING SUPABASE SECRET KEY');
  const publicable = leerSecreto('STAGING SUPABASE PUBLISHABLE KEY');
  if (secreta?.usuario !== REF || publicable?.usuario !== REF) falla('CLAVES_STAGING_NO_LIGADAS');
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${pat()}` }, signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) falla(`CLAVES_STAGING_HTTP_${r.status}`);
  const claves = await r.json();
  if (!claves.some((k) => k.type === 'secret' && igual(k.api_key, secreta.secreto))
    || !claves.some((k) => k.type === 'publishable' && igual(k.api_key, publicable.secreto))) falla('CLAVES_STAGING_NO_COINCIDEN');
  return { secreta: secreta.secreto, publicable: publicable.secreto };
}

/** Lectura por la Management API en una transacción de sólo lectura. */
async function sql(consulta) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${pat()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: `set transaction read only; ${consulta}` }), signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) falla(`SQL_HTTP_${r.status}`);
  return r.json();
}

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
    method: 'POST', headers: { authorization: `Bearer ${jwt}`, apikey: publicable, 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(45_000),
  });
  return { status: r.status, cuerpo: await r.json().catch(() => null) };
}

async function foto(servicio) {
  const [fila] = await sql(`select
      (select enabled from public.business_payment_settings where business_id='${NEGOCIO}' and provider='mercadopago') as encendido,
      (select environment from public.business_payment_settings where business_id='${NEGOCIO}' and provider='mercadopago') as entorno,
      c.status as conexion, c.generation::text as generacion, (c.protected_tokens is not null) as credencial_sellada,
      (select count(*) from public.payment_intents where business_id='${NEGOCIO}')::int as intents,
      (select count(*) from public.orders where business_id='${NEGOCIO}' and payment_method='mercadopago')::int as pedidos_mp,
      (select count(*) from public.payment_refunds r join public.payment_intents i on i.id=r.payment_intent_id where i.business_id='${NEGOCIO}')::int as reembolsos,
      (select count(*) from public.payment_webhook_receipts where seller_business_id='${NEGOCIO}')::int as recibos,
      (select count(*) from public.checkout_sessions where business_id='${NEGOCIO}')::int as sesiones,
      (select stock from public.products where id='${PRODUCTO}') as stock
    from public.mp_seller_connections c where c.business_id='${NEGOCIO}' and c.environment='test'`);
  const { data, error } = await servicio.rpc('get_mercadopago_checkout_availability', { p_business_id: NEGOCIO });
  if (error) falla(`DISPONIBILIDAD:${error.code}`);
  return { ...fila, ofrecido: data?.available === true, momento: new Date().toISOString() };
}

async function interruptor(dueno, encendido) {
  const { data, error } = await dueno.cliente.rpc('configure_mercadopago_settings', { p_business_id: NEGOCIO, p_settings: { enabled: encendido } });
  if (error || data?.ok !== true || data.enabled !== encendido) falla(`INTERRUPTOR_${encendido ? 'ON' : 'OFF'}:${error?.code || ''}`);
  return data;
}

async function main() {
  const conPagoManual = process.argv.includes('--con-pago-manual');
  const { secreta, publicable } = await clavesStaging();
  const servicio = createClient(BASE, secreta, opciones);
  const dueno = await sesion(publicable, 'STAGING PILOT OWNER QA 20260923');
  const registro = await dueno.cliente.rpc('identity_register_session', {
    p_business_id: NEGOCIO, p_client: 'panel_web', p_device_label: 'Ensayo rollback Mercado Pago',
    p_device_key_hash: null, p_app_version: 'mp-rollback-drill',
  });
  if (registro.error || !registro.data?.ok) falla('SESION_DEL_DUENO_NO_REGISTRADA');
  const cliente = await sesion(publicable, 'STAGING CUSTOMER QA 20260920');
  const evidencia = { inicio: new Date().toISOString(), proyecto: REF, negocio: NEGOCIO, pasos: [] };
  const antes = await foto(servicio);
  evidencia.antes = antes;
  if (!antes.encendido || !antes.ofrecido || antes.conexion !== 'connected' || !antes.credencial_sellada) falla('EL_ENSAYO_EMPIEZA_CON_MERCADO_PAGO_OFRECIDO');
  const gates = {};
  try {
    evidencia.pasos.push({ paso: 'apagar', resultado: await interruptor(dueno, false), momento: new Date().toISOString() });
    const apagado = await foto(servicio);
    evidencia.apagado = apagado;
    const pedido = buildMercadoPagoCheckoutPayload({
      businessId: NEGOCIO, clientRequestId: randomUUID(),
      values: { deliveryMode: 'pickup', customerName: 'QA Ensayo Rollback', customerPhone: '2995550147' },
      items: [{ product_id: PRODUCTO, quantity: 1 }],
    });
    const checkout = await edge('mercadopago-create-checkout-session', cliente.jwt, publicable, pedido);
    const despuesDelCheckout = await foto(servicio);
    evidencia.checkout_con_mp_apagado = { http: checkout.status, code: checkout.cuerpo?.code ?? null };
    gates.MP_NOT_OFFERED = !apagado.ofrecido && !apagado.encendido ? 'PASS' : 'FAIL';
    gates.NO_NEW_PREFERENCE_PATH = checkout.status === 409 && checkout.cuerpo?.code === 'PAYMENTS_NOT_ENABLED'
      && despuesDelCheckout.sesiones === antes.sesiones && despuesDelCheckout.stock === antes.stock ? 'PASS' : 'FAIL';
    gates.SELLER_BINDING_PRESERVED = apagado.conexion === 'connected' && apagado.generacion === antes.generacion
      && apagado.credencial_sellada ? 'PASS' : 'FAIL';
    gates.HISTORY_PRESERVED = ['intents', 'pedidos_mp', 'reembolsos', 'recibos'].every((k) => apagado[k] === antes[k]) ? 'PASS' : 'FAIL';
    if (conPagoManual) {
      const corrida = spawnSync(process.execPath, [fileURLToPath(new URL('../e2e-staging/run-manual-payment-pilot.mjs', import.meta.url))],
        { stdio: 'inherit', windowsHide: true });
      gates.MANUAL_PAYMENT_WHILE_MP_OFF = corrida.status === 0 ? 'PASS' : 'FAIL';
    } else {
      gates.MANUAL_PAYMENT_WHILE_MP_OFF = 'NOT_RUN';
    }
  } finally {
    if (antes.encendido) {
      evidencia.pasos.push({ paso: 'encender', resultado: await interruptor(dueno, true), momento: new Date().toISOString() });
    }
  }
  const despues = await foto(servicio);
  evidencia.despues = despues;
  gates.RE_ENABLED_WITHOUT_RECONNECTING = despues.ofrecido && despues.generacion === antes.generacion ? 'PASS' : 'FAIL';
  evidencia.gates = gates;
  evidencia.fin = new Date().toISOString();
  mkdirSync(DIR, { recursive: true });
  const archivo = path.join(DIR, `ensayo-rollback-${evidencia.inicio.replace(/[:.]/g, '-')}.json`);
  writeFileSync(archivo, `${JSON.stringify(evidencia, null, 2)}\n`);
  console.log(JSON.stringify({ gates, checkout_con_mp_apagado: evidencia.checkout_con_mp_apagado, evidencia: archivo }, null, 2));
  if (Object.values(gates).some((v) => v === 'FAIL')) process.exitCode = 1;
}

main().catch((error) => { console.error(`ENSAYO_ROLLBACK_FALLO:${error.message}`); process.exitCode = 1; });
