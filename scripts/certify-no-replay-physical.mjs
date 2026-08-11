/*
 * Certificacion del recorrido FISICO contra el contrato ya desplegado.
 *
 * Toma la traza real de un pedido, le aplica el contrato publico tal como quedo
 * en staging (cuatro decimales, orden por hora de captura) y la hace pasar por
 * el motor de movimiento REAL. Despues mide todo lo que el criterio exige.
 *
 *   node scripts/certify-no-replay-physical.mjs LT-0139
 *   node scripts/certify-no-replay-physical.mjs --archivo <timeline.json>
 *
 * La segunda forma existe porque un estado terminal PURGA las ubicaciones del
 * pedido —es la politica de privacidad, no un accidente—, asi que una traza
 * fisica ya capturada sobrevive en su archivo y no en la base. Los puntos son
 * los mismos que publico el dispositivo: no se inventa ni un metro.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { distanceKm } from '../js/map/route_geometry.js';
import { MOTION_REJECTIONS, createRiderMotion } from '../js/map/rider_motion.js';
import { REF, URL_BASE, SUPABASE_CLI, evidencia } from './primer-pedido-humano/entorno.mjs';

const CODE = process.argv[2] || 'LT-0139';
const EV = evidencia('gate-cliente');
const DECIMALES = 4;          // lo que quedo desplegado
const MIN_METROS = 300;
const MIN_FIXES = 20;

const m = (a, b) => distanceKm(a, b) * 1000;
const mediana = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const iArchivo = process.argv.indexOf('--archivo');
let o;
let F;
let fuente;

if (iArchivo >= 0) {
  const guardada = JSON.parse(fs.readFileSync(process.argv[iArchivo + 1], 'utf8'));
  o = guardada.pedido;
  F = guardada.locs;
  fuente = `traza guardada · ${process.argv[iArchivo + 1]}`;
} else {
  const keys = JSON.parse(execFileSync(SUPABASE_CLI,
    ['projects', 'api-keys', '--project-ref', REF, '--output', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  const SERVICE = keys.filter((k) => k.name === 'service_role')[0].api_key;
  const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` };
  const rest = async (p) => (await fetch(`${URL_BASE}/rest/v1/${p}`, { headers: H })).json();
  [o] = await rest(`orders?code=eq.${CODE}&select=id,status,revision,picked_up_at`);
  if (!o) { console.log(`no existe ${CODE}`); process.exit(1); }
  const cols = 'id,receipt_sequence,order_revision,created_at,captured_at,lat,lng,accuracy,speed,source';
  F = await rest(`rider_locations?order_id=eq.${o.id}&select=${cols}&order=receipt_sequence.asc&limit=5000`);
  fuente = 'base de staging';
}
if (!Array.isArray(F) || !F.length) {
  console.log(`${CODE} no tiene ubicaciones. Si el pedido quedo en estado terminal, las purgo la politica de privacidad: usa --archivo con la traza guardada.`);
  process.exit(1);
}

// ------------------------------------- el contrato publico, tal como quedo ---
const publico = (r) => ({
  lat: Number(Number(r.lat).toFixed(DECIMALES)),
  lng: Number(Number(r.lng).toFixed(DECIMALES)),
  accuracy: Math.max(100, Math.ceil(r.accuracy)),
  capturedAt: r.captured_at || r.created_at,
});
// El servidor elige por hora de CAPTURA: ese es el orden en que el cliente los ve.
const enOrdenDeCaptura = [...F].sort((a, b) => (
  Date.parse(a.captured_at || a.created_at) - Date.parse(b.captured_at || b.created_at)
));

const real = enOrdenDeCaptura.map((r) => ({ lat: r.lat, lng: r.lng }));
const visto = enOrdenDeCaptura.map(publico);
const recorridoReal = real.slice(1).reduce((s, p, i) => s + m(real[i], p), 0);
const errores = enOrdenDeCaptura.map((r, i) => m(real[i], visto[i]));
const precisiones = enOrdenDeCaptura.map((r) => r.accuracy);
const celdas = new Set(visto.map((p) => `${p.lat},${p.lng}`));

// ------------------------------------------------ el motor visual, de verdad ---
/*
 * Que es un retroceso y que NO lo es.
 *
 * Un retroceso del que hay que responder es que el marcador se mueva por un fix
 * capturado ANTES que el ultimo ya aceptado. Volver a una calle por la que el
 * rider realmente volvio a pasar NO es un retroceso: es el recorrido, y el
 * encargo pide expresamente que se siga viendo. Por eso el criterio es
 * TEMPORAL —hora de captura— y no geometrico.
 *
 * La primera version de este arnes contaba «volvio a una celda ya visitada» y
 * marcaba 29 fallas sobre una vuelta de manzana que termina donde empezo. El
 * defecto era del indicador. Queda anotado porque un indicador asi, si nadie lo
 * mira dos veces, empuja a «arreglar» el sistema rompiendo el requisito.
 */
let reloj = Date.parse(enOrdenDeCaptura[0].captured_at || enOrdenDeCaptura[0].created_at);
const motion = createRiderMotion({ now: () => reloj });
const decisiones = [];
const retrocesos = [];
const revisitasReales = [];
let ultimaCapturaAceptada = -Infinity;
let posicionPrevia = null;
const celdasVistas = new Map();

enOrdenDeCaptura.forEach((row, i) => {
  const p = visto[i];
  const captura = Date.parse(p.capturedAt);
  reloj = Math.max(reloj, captura) + 400;
  const veredicto = motion.pushFix({
    lat: p.lat, lng: p.lng, accuracy: p.accuracy, source: 'gps',
    timestamp: captura,
    lastFixAt: new Date(captura).toISOString(),
  });
  const despues = motion.measuredPosition();

  if (veredicto.accepted) {
    // EL contrato: nada capturado antes que lo ya aceptado puede mover al rider.
    if (captura <= ultimaCapturaAceptada) {
      retrocesos.push({
        i,
        recibo: row.receipt_sequence,
        captured_at: p.capturedAt,
        ultima_captura_aceptada: new Date(ultimaCapturaAceptada).toISOString(),
        metros: Math.round(m(posicionPrevia, despues)),
      });
    } else {
      // Un regreso FISICO real: vuelve a una celda ya pisada, pero con captura
      // nueva. Tiene que verse, y por eso se cuenta aparte y no como falla.
      const clave = `${p.lat},${p.lng}`;
      const antesEnFix = celdasVistas.get(clave);
      if (antesEnFix !== undefined && antesEnFix < i - 1) {
        revisitasReales.push({ i, ya_estuvo_en_fix: antesEnFix, metros: Math.round(m(posicionPrevia, despues)) });
      }
      celdasVistas.set(clave, i);
      ultimaCapturaAceptada = captura;
    }
    posicionPrevia = despues;
  }
  decisiones.push({
    i, recibo: row.receipt_sequence, captured_at: p.capturedAt,
    aceptado: veredicto.accepted, razon: veredicto.reason || '', modo: veredicto.mode || '',
  });
});

const rechazos = {};
for (const d of decisiones.filter((x) => !x.aceptado)) rechazos[d.razon] = (rechazos[d.razon] || 0) + 1;

// --------------------------- ¿un regreso fisico real seguiria siendo visible? ---
// Se comprueba con el propio recorrido: se toma un punto ya visitado y se lo
// vuelve a ofrecer con una captura NUEVA, como si el rider hubiera vuelto.
const regreso = (() => {
  const ultimo = motion.measuredPosition();
  if (!ultimo) return { probado: false };
  // Se elige un punto REALMENTE distinto del actual —el mas lejano del
  // recorrido—, si no la prueba no prueba nada: ofrecerle al motor la posicion
  // donde ya esta y ver que no se mueve no dice si un regreso se veria.
  let objetivo = null;
  let lejos = 0;
  for (const p of visto) {
    const d = m(ultimo, p);
    if (d > lejos) { lejos = d; objetivo = p; }
  }
  if (!objetivo || lejos < 20) return { probado: false, motivo: 'el recorrido no tiene dos puntos separados' };
  reloj += 12_000;
  const v = motion.pushFix({
    lat: objetivo.lat, lng: objetivo.lng, accuracy: 12, source: 'gps',
    timestamp: reloj - 400, lastFixAt: new Date(reloj - 400).toISOString(),
  });
  const ahora = motion.measuredPosition();
  return {
    probado: true,
    aceptado: v.accepted,
    se_movio: Math.round(m(ultimo, ahora)),
    distancia_ofrecida: Math.round(lejos),
  };
})();

// ------------------------------------------------------------- el veredicto ---
const metricas = {
  pedido: CODE,
  fuente,
  estado: o.status,
  fixes: F.length,
  recorrido_real_m: Math.round(recorridoReal),
  posiciones_publicas_distintas: celdas.size,
  error_redondeo_mediano_m: Number(mediana(errores).toFixed(2)),
  error_redondeo_maximo_m: Number(Math.max(...errores).toFixed(2)),
  accuracy_gps_mediana_m: Number(mediana(precisiones).toFixed(1)),
  accuracy_gps_mejor_m: Number(Math.min(...precisiones).toFixed(1)),
  accuracy_gps_peor_m: Number(Math.max(...precisiones).toFixed(1)),
  retrocesos_por_fix_viejo: retrocesos.length,
  revisitas_fisicas_reales: revisitasReales.length,
  duplicados_ignorados: rechazos[MOTION_REJECTIONS.DUPLICATE] || 0,
  atrasados_rechazados: rechazos[MOTION_REJECTIONS.BACKWARDS] || 0,
  otros_rechazos: Object.fromEntries(Object.entries(rechazos).filter(([k]) => (
    k !== MOTION_REJECTIONS.DUPLICATE && k !== MOTION_REJECTIONS.BACKWARDS
  ))),
  fixes_recientes_descartados: decisiones.filter((d) => !d.aceptado
    && d.razon !== MOTION_REJECTIONS.DUPLICATE && d.razon !== MOTION_REJECTIONS.BACKWARDS).length,
  regreso_fisico_real_visible: regreso,
};

const criterios = {
  'recorrido >= 300 m': metricas.recorrido_real_m >= MIN_METROS,
  'al menos 20 fixes': metricas.fixes >= MIN_FIXES,
  '0 replay por posiciones historicas': metricas.retrocesos_por_fix_viejo === 0,
  '0 retroceso por llegada tardia': metricas.retrocesos_por_fix_viejo === 0,
  'el regreso fisico real SI se ve': regreso.probado && regreso.aceptado && regreso.se_movio > 0
    && revisitasReales.length > 0,
  'error de redondeo por debajo de la precision del GPS':
    metricas.error_redondeo_mediano_m < metricas.accuracy_gps_mediana_m,
  '0 fixes reales recientes descartados': metricas.fixes_recientes_descartados === 0,
  'tracking visualmente continuo (mas de 10 posiciones publicas)':
    metricas.posiciones_publicas_distintas > 10,
};

console.log(`=== RECORRIDO FISICO · ${CODE} ===\n`);
for (const [k, v] of Object.entries(metricas)) console.log(`  ${k.padEnd(42)} ${JSON.stringify(v)}`);
console.log('\n=== CRITERIOS ===');
let todo = true;
for (const [k, v] of Object.entries(criterios)) { if (!v) todo = false; console.log(`${v ? 'OK   ' : 'FALLA'} ${k}`); }
if (retrocesos.length) {
  console.log('\nretrocesos por fix capturado antes que el ultimo aceptado:');
  for (const r of retrocesos.slice(0, 10)) {
    console.log(`  fix ${r.i} (recibo ${r.recibo}): capturado ${r.captured_at} despues de aceptar ${r.ultima_captura_aceptada} · ${r.metros} m`);
  }
}
if (revisitasReales.length) {
  console.log(`\nregresos fisicos reales (NO son fallas, tienen que verse): ${revisitasReales.length}`);
  for (const r of revisitasReales.slice(0, 6)) {
    console.log(`  fix ${r.i}: vuelve a donde estuvo en el fix ${r.ya_estuvo_en_fix}, moviendose ${r.metros} m, con captura mas nueva`);
  }
}
fs.writeFileSync(path.join(EV, `certificacion-fisica-${CODE}.json`),
  JSON.stringify({ metricas, criterios, retrocesos, revisitasReales, decisiones, traza: enOrdenDeCaptura }, null, 2), 'utf8');
console.log(`\n${todo ? 'RECORRIDO FISICO: CRITERIOS CUMPLIDOS' : 'NO CUMPLE'}`);
process.exitCode = todo ? 0 : 1;
