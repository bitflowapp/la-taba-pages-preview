// Preflight del gate humano final: todo lo que tiene que estar en su lugar
// ANTES de que una persona toque el telefono. Solo lectura.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { REF, URL_BASE, SITIO, SUPABASE_CLI, BUSINESS_ID, evidencia, secreto } from './entorno.mjs';

const SERIAL = process.env.TABA_MOTO_SERIAL || 'ZY32LHS6PS';
const EV = evidencia('gate-cliente');

const keys = JSON.parse(execFileSync(SUPABASE_CLI,
  ['projects', 'api-keys', '--project-ref', REF, '--output', 'json'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const SERVICE = keys.filter((k) => k.name === 'service_role')[0].api_key;
const ANON = keys.filter((k) => k.name === 'anon')[0].api_key;
const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const rest = async (p) => (await fetch(`${URL_BASE}/rest/v1/${p}`, { headers: H })).json();
const adb = (cmd) => {
  try { return execFileSync('adb', ['-s', SERIAL, 'shell', cmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return ''; }
};

const chequeos = {};
const nota = {};

// 1. storefront vivo y sin errores de arranque
const r = await fetch(`${SITIO}/`);
chequeos.storefront_vivo = r.ok;
nota.storefront_vivo = `HTTP ${r.status}`;

// 2. el bundle desplegado trae los tres gestos
const ui = await (await fetch(`${SITIO}/js/ui.js`)).text();
const app = await (await fetch(`${SITIO}/js/app.js`)).text();
chequeos.gestos_desplegados = ui.includes('Volver al Rider')
  && ui.includes('data-map-follow-cta') && ui.includes('data-map-recenter')
  && app.includes('data-map-follow-cta');
nota.gestos_desplegados = 'Volver al Rider + follow-cta + recenter en el bundle publicado';

// 3. catalogo comprable
const productos = await rest('products?is_active=eq.true&stock=gt.0&is_alcoholic=eq.false&select=name,price,stock&order=price.asc');
chequeos.catalogo_comprable = Array.isArray(productos) && productos.length > 0;
nota.catalogo_comprable = `${productos.length} sin alcohol; el mas barato ${productos[0]?.name} $${productos[0]?.price} (stock ${productos[0]?.stock})`;

// 4. el negocio acepta delivery y el pago no mueve dinero real
const [b] = await rest(`businesses?id=eq.${BUSINESS_ID}&select=is_active,delivery_enabled,delivery_fee,minimum_delivery_subtotal`);
const [mp] = await rest(`business_payment_settings?business_id=eq.${BUSINESS_ID}&select=provider,enabled,environment,checkout_mode`);
chequeos.negocio_abierto = b.is_active && b.delivery_enabled;
nota.negocio_abierto = `envio $${b.delivery_fee}, minimo $${b.minimum_delivery_subtotal}`;
chequeos.mercadopago_es_TEST = !mp || mp.environment === 'test';
nota.mercadopago_es_TEST = mp ? `${mp.provider} ${mp.checkout_mode} environment=${mp.environment}` : 'sin proveedor';

// 5. Rider libre y con cuenta viva
const cred = fs.readFileSync(secreto('rider-map-qa-login.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
const rEmail = (cred.find((l) => l.startsWith('email=')) || '').slice(6).trim();
const rPass = (cred.find((l) => !l.includes('=')) || '').trim();
const login = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: rEmail, password: rPass }),
});
const sesion = login.ok ? await login.json() : null;
chequeos.rider_cuenta_viva = login.ok;
nota.rider_cuenta_viva = `HTTP ${login.status} · user ${sesion?.user?.id?.slice(0, 8) || '-'}`;

const RIDER = sesion?.user?.id || 'aab5bc54-c07d-4c6b-9580-5ae20c4787a0';
const enVuelo = await rest(`orders?assigned_rider_user_id=eq.${RIDER}&status=in.(assigned,picked_up,on_the_way,arrived)&select=code,status`);
chequeos.rider_libre = enVuelo.length === 0;
nota.rider_libre = enVuelo.length ? `OCUPADO con ${enVuelo.map((o) => `${o.code}:${o.status}`).join(', ')}` : 'sin entrega activa';

// lo mismo, pero preguntandoselo al backend como se lo pregunta la app
const activa = await fetch(`${URL_BASE}/rest/v1/rpc/get_active_rider_delivery`, {
  method: 'POST',
  headers: { apikey: ANON, Authorization: `Bearer ${sesion?.access_token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
});
const activaJson = activa.ok ? await activa.json() : null;
chequeos.rider_sin_entrega_activa_segun_la_app = activa.ok && (!activaJson || (Array.isArray(activaJson) ? activaJson.length === 0 : !activaJson?.id));
nota.rider_sin_entrega_activa_segun_la_app = `HTTP ${activa.status} · ${JSON.stringify(activaJson).slice(0, 120)}`;

// 6. el Moto
const dispositivos = (() => { try { return execFileSync('adb', ['devices'], { encoding: 'utf8' }); } catch { return ''; } })();
chequeos.moto_conectado = dispositivos.includes(`${SERIAL}\tdevice`);
const pkg = adb('dumpsys package com.lataba.rider.staging');
chequeos.rider_app_instalada = /versionName=/.test(pkg);
nota.rider_app_instalada = (pkg.match(/versionName=(\S+)/) || [])[1] || '-';
chequeos.permiso_ubicacion_fina = /ACCESS_FINE_LOCATION: granted=true/.test(pkg);
const modo = adb('settings get secure location_mode').trim();
chequeos.gps_en_alta_precision = modo === '3';
nota.gps_en_alta_precision = `location_mode=${modo}`;
const foreground = adb('dumpsys activity activities | grep topResumedActivity');
nota.app_en_pantalla = /com\.lataba\.rider\.staging/.test(foreground) ? 'la app del Rider esta al frente' : foreground.trim().slice(0, 90);
const bateria = adb('dumpsys battery | grep level').trim();
nota.bateria = bateria.replace(/\s+/g, ' ');
const red = adb('dumpsys connectivity | grep -m1 "SSID:"');
const ssid = (red.match(/SSID: "([^"]+)"/) || [])[1] || '?';
chequeos.moto_con_red = Boolean(ssid && ssid !== '?');
nota.moto_con_red = `wifi «${ssid}»`;

// 7. linea base de alertas y testigos
const abiertas = await rest('operational_alerts?status=neq.resolved&select=alert_code,subject_id,occurrence_count');
nota.alertas_abiertas = abiertas.map((a) => `${a.alert_code}(${String(a.subject_id).slice(0, 8)})`).join(', ') || 'ninguna';
const [lt30] = await rest('orders?code=eq.LT-0030&select=code,status,revision,total');
chequeos.lt0030_intacto = lt30.status === 'arrived' && lt30.revision === 11 && Number(lt30.total) === 550;
const vivos = await rest('orders?status=not.in.(delivered,cancelled,rejected)&origin=eq.production&select=code,status,created_at');
nota.production_vivos = vivos.map((v) => `${v.code}:${v.status}`).join(', ') || 'ninguno';
const fisc = await rest('fiscal_documents?select=id&limit=5');
const pos = await rest('pos_sales?select=id&limit=5');
chequeos.arca_en_cero = fisc.length === 0 && pos.length === 0;

// 8. el reloj de afuera
const barrido = await rest('operational_sweep_runs?select=started_at,finished_at,status,open_alerts,failures&order=started_at.desc&limit=1');
const ultimo = Array.isArray(barrido) ? barrido[0] : null;
const edad = ultimo ? Math.round((Date.now() - new Date(ultimo.started_at).getTime()) / 1000) : null;
chequeos.barrido_al_dia = edad !== null && edad < 600;
nota.barrido_al_dia = ultimo
  ? `hace ${edad}s · status=${ultimo.status} · alertas abiertas=${ultimo.open_alerts} · fallas=${ultimo.failures}`
  : `sin corridas (${JSON.stringify(barrido).slice(0, 90)})`;

console.log('=== PREFLIGHT DEL GATE HUMANO FINAL ===\n');
for (const [k, v] of Object.entries(chequeos)) {
  console.log(`${v ? 'OK   ' : 'FALLA'} ${k.padEnd(38)} ${nota[k] || ''}`);
}
console.log('\n--- contexto (no son chequeos) ---');
for (const [k, v] of Object.entries(nota)) if (!(k in chequeos)) console.log(`     ${k.padEnd(38)} ${v}`);

const linea_base = { at: new Date().toISOString(), alertas_abiertas: abiertas, lt30, production_vivos: vivos, arca: { fiscal_documents: fisc.length, pos_sales: pos.length }, productos: productos.slice(0, 8) };
fs.writeFileSync(`${EV}\\m2-preflight.json`, JSON.stringify({ chequeos, nota, linea_base }, null, 2), 'utf8');
console.log(`\nlinea base guardada en ${EV}\\m2-preflight.json`);
process.exitCode = Object.values(chequeos).every(Boolean) ? 0 : 1;
