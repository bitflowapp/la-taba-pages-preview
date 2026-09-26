#!/usr/bin/env node
/*
 * Desconectar y reconectar el vendedor de prueba en Staging, de verdad.
 *
 * 1. El dueño desconecta desde `mercadopago-connect` (con la confirmación
 *    explícita del Panel). Se verifica que el material cifrado se destruya, que
 *    el binding quede invalidado, que no se pueda cobrar y que el historial
 *    siga entero.
 * 2. El dueño vuelve a conectar: `mercadopago-connect` emite una URL de
 *    autorización nueva y el vendedor de PRUEBA consiente en Mercado Pago en un
 *    navegador limpio. Se verifica que vuelva el mismo vendedor con una
 *    generación nueva, tokens nuevos, un único binding activo y el historial
 *    intacto.
 *
 * Sólo Staging y sólo el vendedor de prueba 3594962708. Ninguna contraseña,
 * código o token se imprime; la evidencia va fuera del repositorio.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';

const REF = 'ucbtjcurawxjwjdvvcvj';
const BASE = `https://${REF}.supabase.co`;
const NEGOCIO = 'a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0';
const VENDEDOR = '3594962708';
const APP = '2691240967769590';
const DIR = path.join(os.tmpdir(), 'la-taba-mp-directo');
const opciones = { auth: { persistSession: false, autoRefreshToken: false } };
const huella = (v) => (v ? createHash('sha256').update(v).digest('hex').slice(0, 12) : null);
const hora = () => new Date().toISOString();
const evidencia = { inicio: hora(), pasos: [], gates: {} };
const gate = (nombre, ok, detalle = {}) => { evidencia.gates[nombre] = { resultado: ok ? 'PASS' : 'FAIL', ...detalle }; };
mkdirSync(DIR, { recursive: true });
const guardar = () => writeFileSync(path.join(DIR, `reconexion-${evidencia.inicio.replace(/[:.]/g, '-')}.json`), `${JSON.stringify(evidencia, null, 2)}\n`);

const secreta = leerSecreto('STAGING SUPABASE SECRET KEY');
const publicable = leerSecreto('STAGING SUPABASE PUBLISHABLE KEY');
if (secreta?.usuario !== REF || publicable?.usuario !== REF) throw new Error('CLAVES_STAGING_NO_LIGADAS');
const servicio = createClient(BASE, secreta.secreto, opciones);

async function login(credencial, registrar) {
  const cuenta = leerSecreto(credencial);
  const cliente = createClient(BASE, publicable.secreto, opciones);
  const { data, error } = await cliente.auth.signInWithPassword({ email: cuenta.usuario, password: cuenta.secreto });
  if (error || !data.session) throw new Error(`LOGIN_QA_FALLIDO:${credencial}`);
  if (registrar) {
    const r = await cliente.rpc('identity_register_session', { p_business_id: NEGOCIO, p_client: 'panel_web',
      p_device_label: 'Certificacion reconexion MP', p_device_key_hash: null, p_app_version: 'mp-reconnect-cert' });
    if (r.error || !r.data?.ok) throw new Error('SESION_PANEL_NO_REGISTRADA');
  }
  return { cliente, jwt: data.session.access_token };
}
async function edge(nombre, jwt, cuerpo) {
  const r = await fetch(`${BASE}/functions/v1/${nombre}`, { method: 'POST', signal: AbortSignal.timeout(30_000),
    headers: { 'content-type': 'application/json', apikey: publicable.secreto, authorization: `Bearer ${jwt}` }, body: JSON.stringify(cuerpo) });
  return { status: r.status, json: await r.json().catch(() => null) };
}
async function foto() {
  const conexion = (await servicio.from('mp_seller_connections').select('status,seller_id,application_id,generation,protected_tokens,connected_at,expires_at').eq('business_id', NEGOCIO).eq('environment', 'test').single()).data;
  const ajuste = (await servicio.from('business_payment_settings').select('enabled,collector_id,application_id').eq('business_id', NEGOCIO).single()).data;
  const cuenta = async (tabla, filtro) => (await servicio.from(tabla).select('*', { count: 'exact', head: true }).match(filtro)).count;
  const intents = await cuenta('payment_intents', { business_id: NEGOCIO });
  const pedidos = await cuenta('orders', { business_id: NEGOCIO });
  const sesiones = await cuenta('checkout_sessions', { business_id: NEGOCIO });
  const estados = await cuenta('mp_oauth_states', { business_id: NEGOCIO });
  const mismoVendedor = await cuenta('mp_seller_connections', { seller_id: VENDEDOR, environment: 'test' });
  return {
    status: conexion?.status, seller_id: conexion?.seller_id, application_id: conexion?.application_id, generation: conexion?.generation,
    tokens: huella(conexion?.protected_tokens), connected_at: conexion?.connected_at, expires_at: conexion?.expires_at,
    settings_enabled: ajuste?.enabled, collector_id: ajuste?.collector_id, historial: { intents, pedidos, sesiones }, estados, conexiones_del_vendedor: mismoVendedor,
  };
}

const dueno = await login('STAGING PILOT OWNER QA 20260923', true);
const clienteQa = await login('STAGING CUSTOMER QA 20260920', false);
const antes = await foto();
evidencia.antes = antes;
if (antes.status !== 'connected' || antes.seller_id !== VENDEDOR) throw new Error('PRECONDICION_CONEXION');

// 1. Desconexión.
let r = await edge('mercadopago-connect', dueno.jwt, { business_id: NEGOCIO, action: 'disconnect', confirmation: 'DISCONNECT_MERCADOPAGO' });
evidencia.pasos.push({ momento: hora(), paso: 'disconnect', http: r.status, estado: r.json?.connection?.status });
const desconectado = await foto();
evidencia.desconectado = desconectado;
gate('DISCONNECT_RESPONSE', r.status === 200 && r.json?.connection?.status === 'disconnected', { http: r.status });
gate('DISCONNECT_DESTROYS_TOKEN_MATERIAL', desconectado.tokens === null);
gate('DISCONNECT_INVALIDATES_BINDING', desconectado.status === 'disconnected' && desconectado.generation !== antes.generation && desconectado.settings_enabled === false);
gate('DISCONNECT_KEEPS_SELLER_IDENTITY_AS_GUARD', desconectado.seller_id === VENDEDOR);
gate('DISCONNECT_PRESERVES_HISTORY', JSON.stringify(desconectado.historial) === JSON.stringify(antes.historial), { antes: antes.historial, despues: desconectado.historial });
const disponibilidad = await clienteQa.cliente.rpc('get_mercadopago_checkout_availability', { p_business_id: NEGOCIO });
gate('DISCONNECTED_NOT_OFFERED', disponibilidad.data?.available === false, { available: disponibilidad.data?.available });
r = await edge('mercadopago-create-checkout-session', clienteQa.jwt, {
  business_id: NEGOCIO, client_request_id: `desconectado-${Date.now()}`, items: [{ product_id: 'e00468cb-8693-4ed5-ace7-42c945a80a11', quantity: 1 }],
  fulfillment_type: 'pickup', contact: { name: 'QA Certificacion Mercado Pago', phone: '2995550147' }, address: {}, age_confirmed: false, payment_method: 'mercadopago',
});
gate('DISCONNECTED_CANNOT_START_CHECKOUT', r.status === 409, { http: r.status, code: r.json?.code });
r = await edge('mercadopago-connect', dueno.jwt, { business_id: NEGOCIO, action: 'verify' });
gate('DISCONNECTED_VERIFY_DOES_NOT_CLAIM_CONNECTED', r.status !== 200 || r.json?.connection?.status !== 'connected', { http: r.status, code: r.json?.code });
guardar();

// 2. Reconexión con consentimiento del vendedor de prueba.
r = await edge('mercadopago-connect', dueno.jwt, { business_id: NEGOCIO, action: 'connect' });
const autorizacion = r.json?.authorization_url;
gate('RECONNECT_ISSUES_NEW_STATE', r.status === 200 && /^https:\/\/auth\.mercadopago\.com\.ar\/authorization\?/.test(autorizacion || ''), { http: r.status });
const vendedor = leerSecreto('MP STAGING SELLER TEST USER');
const datos = JSON.parse(vendedor?.secreto || '{}');
if (datos.id !== VENDEDOR || !datos.password) throw new Error('VENDEDOR_DE_PRUEBA_NO_DISPONIBLE');
const codigo = String(datos.code || VENDEDOR.slice(-6));
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const context = await browser.newContext({ locale: 'es-AR', viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const navegaciones = [];
page.on('framenavigated', (f) => { if (f === page.mainFrame()) { const u = new URL(f.url()); navegaciones.push(`${hora()} ${u.host}${u.pathname}`); } });
let resultado = null;
const visible = (l) => l.isVisible().catch(() => false);
const clic = async (l) => {
  try { await l.click({ timeout: 5_000 }); return; } catch { /* mouse */ }
  const caja = await l.boundingBox({ timeout: 2_000 }).catch(() => null);
  if (caja) await page.mouse.click(caja.x + caja.width / 2, caja.y + caja.height / 2);
};
try {
  await page.goto(autorizacion, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  for (let paso = 0; paso < 45 && !resultado; paso += 1) {
    await page.waitForTimeout(1_500);
    const url = new URL(page.url());
    if (url.host === 'taba2-staging.pages.dev') { resultado = url.searchParams.get('mp_connection') || 'sin_parametro'; break; }
    const cookies = page.getByRole('button', { name: 'Aceptar cookies', exact: true });
    if (await visible(cookies)) { await clic(cookies); continue; }
    const codigoCampo = page.locator('input[autocomplete="one-time-code"],input[inputmode="numeric"][maxlength="6"]').filter({ visible: true });
    if (await codigoCampo.count().catch(() => 0)) { await codigoCampo.first().click(); await page.keyboard.type(codigo, { delay: 60 }); const b = page.getByRole('button', { name: /Continuar|Confirmar|Verificar/i }).first(); if (await visible(b)) await clic(b); continue; }
    if (url.pathname === '/login/identification') {
      const campo = page.getByRole('textbox', { name: /DNI, e-?mail o tel[eé]fono/i }).first();
      if (await visible(campo) && !(await campo.inputValue().catch(() => ''))) {
        await campo.click(); await campo.pressSequentially(vendedor.usuario, { delay: 45 }); await page.waitForTimeout(700);
        await clic(page.getByRole('button', { name: /^Continuar$/ }).first());
        await page.waitForURL((d) => d.pathname !== '/login/identification', { timeout: 15_000 }).catch(() => {});
        continue;
      }
    }
    if (url.pathname === '/login/challenges') {
      const metodo = page.getByText(/^Contraseña$/).first();
      if (await visible(metodo)) { await clic(metodo); await page.waitForURL((d) => d.pathname !== '/login/challenges', { timeout: 15_000 }).catch(() => {}); continue; }
    }
    const clave = page.locator('input[type="password"]').filter({ visible: true }).first();
    if (await visible(clave)) {
      await clave.click(); await clave.pressSequentially(datos.password, { delay: 45 }); await page.waitForTimeout(500);
      const confirmar = page.getByRole('button', { name: /Confirmar|Ingresar|Iniciar sesi[oó]n|Continuar/i }).first();
      if (await visible(confirmar)) await clic(confirmar);
      await page.waitForURL((d) => !/password/.test(d.pathname), { timeout: 20_000 }).catch(() => {});
      continue;
    }
    const autorizar = page.getByRole('button', { name: /^(Autorizar|Permitir|Aceptar|Continuar|Confirmar)$/i }).first();
    if (url.host === 'auth.mercadopago.com.ar' && await visible(autorizar)) {
      evidencia.pasos.push({ momento: hora(), paso: 'consent_clicked', boton: (await autorizar.innerText().catch(() => '')).trim() });
      await clic(autorizar);
      await page.waitForURL((d) => d.host === 'taba2-staging.pages.dev', { timeout: 30_000 }).catch(() => {});
      continue;
    }
  }
  if (!resultado) {
    await page.screenshot({ path: path.join(DIR, 'reconexion-sin-resultado.png'), fullPage: true }).catch(() => {});
    resultado = `SIN_RESULTADO:${new URL(page.url()).host}${new URL(page.url()).pathname}`;
  }
} catch (error) {
  resultado = `EXCEPCION:${String(error?.message || error).slice(0, 160)}`;
} finally {
  evidencia.navegaciones = navegaciones;
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
evidencia.pasos.push({ momento: hora(), paso: 'callback_result', mp_connection: resultado });
const despues = await foto();
evidencia.reconectado = despues;
gate('RECONNECT_CALLBACK_CONNECTED', resultado === 'connected', { mp_connection: resultado });
gate('RECONNECT_SAME_SELLER_NEW_GENERATION', despues.status === 'connected' && despues.seller_id === VENDEDOR && despues.application_id === APP
  && despues.generation !== desconectado.generation && despues.tokens !== null && despues.tokens !== antes.tokens);
gate('RECONNECT_REENABLES_TEST_SETTINGS', despues.settings_enabled === true && despues.collector_id === VENDEDOR);
gate('RECONNECT_SINGLE_ACTIVE_BINDING', despues.conexiones_del_vendedor === 1 && despues.estados === 0, { conexiones_del_vendedor: despues.conexiones_del_vendedor, estados: despues.estados });
gate('RECONNECT_PRESERVES_HISTORY', JSON.stringify(despues.historial) === JSON.stringify(antes.historial), { despues: despues.historial });
const otraVez = await clienteQa.cliente.rpc('get_mercadopago_checkout_availability', { p_business_id: NEGOCIO });
gate('RECONNECTED_OFFERED_AGAIN', otraVez.data?.available === true, { available: otraVez.data?.available });
r = await edge('mercadopago-connect', dueno.jwt, { business_id: NEGOCIO, action: 'verify' });
gate('RECONNECTED_VERIFY_WITH_PROVIDER', r.status === 200 && r.json?.connection?.status === 'connected' && r.json?.connection?.seller_id === VENDEDOR, { http: r.status });
evidencia.fin = hora();
guardar();
const fallas = Object.entries(evidencia.gates).filter(([, v]) => v.resultado !== 'PASS');
console.log(JSON.stringify({ gates: evidencia.gates, navegaciones: evidencia.navegaciones.slice(-12), pasos: evidencia.pasos }, null, 2));
if (fallas.length) process.exitCode = 1;
