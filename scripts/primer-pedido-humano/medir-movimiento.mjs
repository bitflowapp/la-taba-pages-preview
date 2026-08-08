// Prueba de desplazamiento del GPS del Rider.
//
// Todo lo demas se midio con el equipo QUIETO, y ahi los saltos entre fixes son
// ruido del GPS, no movimiento. Esto mide lo otro: que pasa cuando el telefono
// efectivamente se mueve. No lo puede hacer un script solo; lo tiene que caminar
// una persona.
//
//   node medir-movimiento.mjs LT-0104            # ventana de 4 min
//   MINUTOS=6 node medir-movimiento.mjs LT-0104
//
// Durante la ventana la persona camina una distancia corta en un lugar seguro,
// SIEMPRE detenida para tocar el telefono, nunca conduciendo. El script no pide
// tocar nada: solo mira lo que llega al servidor.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { REF, URL_BASE, SUPABASE_CLI, evidencia } from './entorno.mjs';

const CODE = process.argv[2];
const MINUTOS = Number(process.env.MINUTOS || 4);
if (!CODE) { console.log('uso: node medir-movimiento.mjs LT-XXXX'); process.exit(1); }
const EV = evidencia('movimiento');

const keys = JSON.parse(execFileSync(SUPABASE_CLI,
  ['projects', 'api-keys', '--project-ref', REF, '--output', 'json'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const SERVICE = keys.filter((k) => k.name === 'service_role')[0].api_key;
const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const rest = async (p) => (await fetch(`${URL_BASE}/rest/v1/${p}`, { headers: H })).json();

const metros = (a, b) => {
  const R = 6371008.8, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

const [o] = await rest(`orders?code=eq.${CODE}&select=id,code,status`);
if (!o) { console.log(`no existe ${CODE}`); process.exit(1); }
if (!['on_the_way', 'arrived'].includes(o.status)) {
  console.log(`${CODE} está en ${o.status}: el seguimiento sólo publica en on_the_way o arrived.`);
  process.exit(1);
}

console.log(`\nventana de ${MINUTOS} min sobre ${CODE}. Caminá cuando quieras, dentro de la ventana.`);
console.log('Cada punto nuevo se imprime al llegar.\n');
console.log('  seq   hora        avance   velocidad   precisión   veredicto');

const vistos = new Map();
const pts = [];
const hasta = Date.now() + MINUTOS * 60_000;
while (Date.now() < hasta) {
  const filas = await rest(
    `rider_locations?order_id=eq.${o.id}&select=receipt_sequence,created_at,lat,lng,accuracy,speed&order=receipt_sequence.asc`,
  );
  for (const f of Array.isArray(filas) ? filas : []) {
    if (vistos.has(f.receipt_sequence)) continue;
    vistos.set(f.receipt_sequence, f);
    const prev = pts[pts.length - 1];
    const d = prev ? metros({ lat: prev.lat, lng: prev.lng }, { lat: f.lat, lng: f.lng }) : null;
    const dt = prev ? (new Date(f.created_at) - new Date(prev.created_at)) / 1000 : null;
    pts.push(f);
    // El umbral no es un gusto: por debajo de la precision reportada, un
    // desplazamiento es indistinguible del ruido del propio GPS.
    const umbral = Math.max(Number(f.accuracy) || 0, 10);
    const veredicto = d === null ? '' : d > umbral ? 'SE MOVIÓ' : 'ruido';
    console.log(
      `  ${String(f.receipt_sequence).padStart(4)}  ${f.created_at.slice(11, 19)}  ` +
      `${(d === null ? '  -' : d.toFixed(1)).padStart(7)}m  ` +
      `${(f.speed === null || f.speed === undefined ? '  -' : Number(f.speed).toFixed(2)).padStart(7)}m/s  ` +
      `${Number(f.accuracy).toFixed(1).padStart(7)}m   ${veredicto}`,
    );
  }
  await new Promise((s) => setTimeout(s, 2500));
}

// ------------------------------------------------------------------ resumen -
const saltos = [];
for (let i = 1; i < pts.length; i++) {
  saltos.push({
    d: metros({ lat: pts[i - 1].lat, lng: pts[i - 1].lng }, { lat: pts[i].lat, lng: pts[i].lng }),
    prec: Number(pts[i].accuracy),
    vel: pts[i].speed === null || pts[i].speed === undefined ? null : Number(pts[i].speed),
  });
}
const movidos = saltos.filter((s) => s.d > Math.max(s.prec, 10));
const recorrido = saltos.reduce((a, s) => a + s.d, 0);
const desplazamiento = pts.length > 1
  ? metros({ lat: pts[0].lat, lng: pts[0].lng }, { lat: pts[pts.length - 1].lat, lng: pts[pts.length - 1].lng })
  : 0;
const conVelocidad = saltos.filter((s) => s.vel !== null && s.vel > 0.3);

console.log('\n===== RESUMEN =====');
console.log(`puntos publicados          ${pts.length}`);
console.log(`saltos por encima del ruido ${movidos.length} de ${saltos.length}`);
console.log(`recorrido acumulado        ${recorrido.toFixed(0)} m`);
console.log(`desplazamiento neto        ${desplazamiento.toFixed(0)} m (primer punto contra último)`);
console.log(`saltos con velocidad > 0,3 m/s  ${conVelocidad.length}`);
if (movidos.length > 0) {
  const ds = movidos.map((s) => s.d);
  console.log(`avance por fix cuando se movió: min ${Math.min(...ds).toFixed(1)} m · mediana ${[...ds].sort((a, b) => a - b)[Math.floor(ds.length / 2)].toFixed(1)} m · máx ${Math.max(...ds).toFixed(1)} m`);
}
console.log(movidos.length >= 3 && desplazamiento > 20
  ? '\nVEREDICTO: el seguimiento acompañó un desplazamiento REAL.'
  : '\nVEREDICTO: NO hay desplazamiento demostrado. No se afirma movimiento.');
fs.writeFileSync(`${EV}/movimiento.json`, JSON.stringify({
  code: CODE, minutos: MINUTOS, puntos: pts.length,
  saltos_sobre_ruido: movidos.length, recorrido_m: recorrido, desplazamiento_neto_m: desplazamiento,
  detalle: pts,
}, null, 2));
console.log(`evidencia: ${EV}/movimiento.json`);
