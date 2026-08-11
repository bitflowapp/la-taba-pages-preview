/*
 * El contrato PUBLICO del seguimiento, aplicado a la traza fisica real.
 *
 * get_public_order_tracking no entrega el fix tal cual: lo redondea a 3
 * decimales y lo ordena/estampa por created_at (hora de LLEGADA al servidor),
 * teniendo en la misma fila captured_at (hora de captura del dispositivo) y
 * receipt_sequence (contador monotono). Este script mide que le hace eso al
 * recorrido real.
 *
 *   node scripts/diagnose-tracking-contract.mjs [timeline.json]
 */
import fs from 'node:fs';
import path from 'node:path';

import { distanceKm } from '../js/map/route_geometry.js';
import { evidencia } from './primer-pedido-humano/entorno.mjs';

const RUTA = process.argv[2] || path.join(evidencia('gate-cliente'), 'replay-timeline-LT-0138.json');
const FIXES = JSON.parse(fs.readFileSync(RUTA, 'utf8')).locs;
const m = (a, b) => distanceKm(a, b) * 1000;

// Exactamente lo que hace el SQL del contrato publico.
const comoLoVeElCliente = (row) => ({
  lat: Number(Number(row.lat).toFixed(3)),
  lng: Number(Number(row.lng).toFixed(3)),
  accuracy: Math.max(100, Math.ceil(row.accuracy)),
});

console.log(`traza: ${FIXES.length} fixes reales\n`);

// ---------------------------------------------- 1. el redondeo a 3 decimales
const real = FIXES.map((r) => ({ lat: r.lat, lng: r.lng }));
const visto = FIXES.map(comoLoVeElCliente);

const recorridoReal = real.slice(1).reduce((s, p, i) => s + m(real[i], p), 0);
const recorridoVisto = visto.slice(1).reduce((s, p, i) => s + m(visto[i], p), 0);
const celdas = new Set(visto.map((p) => `${p.lat},${p.lng}`));
const errores = FIXES.map((r, i) => m(real[i], visto[i]));

console.log('=== 1. REDONDEO A 3 DECIMALES ===');
console.log(`recorrido real:  ${recorridoReal.toFixed(1)} m`);
console.log(`recorrido que ve el cliente: ${recorridoVisto.toFixed(1)} m`);
console.log(`posiciones distintas que ve el cliente: ${celdas.size} sobre ${FIXES.length} fixes`);
console.log(`error de posicion por el redondeo: mediana ${mediana(errores).toFixed(1)} m · maximo ${Math.max(...errores).toFixed(1)} m`);
console.log(`precision informada: siempre >= 100 m (real: ${Math.min(...FIXES.map((f) => f.accuracy)).toFixed(1)}–${Math.max(...FIXES.map((f) => f.accuracy)).toFixed(1)} m)`);

// Saltos entre celdas: cada cambio de celda es un teletransporte del marcador.
const saltos = [];
for (let i = 1; i < visto.length; i += 1) {
  const d = m(visto[i - 1], visto[i]);
  if (d > 0) saltos.push({ i, metros: d, realMetros: m(real[i - 1], real[i]) });
}
console.log(`\nsaltos del marcador del cliente: ${saltos.length}`);
for (const s of saltos.slice(0, 12)) {
  console.log(`  fix ${s.i}: el cliente ve ${s.metros.toFixed(0)} m de salto donde el Rider camino ${s.realMetros.toFixed(1)} m`);
}

// Retrocesos: el marcador vuelve a una celda que ya habia dejado atras.
const vistas = [];
let retrocesosCelda = 0;
const detalle = [];
for (let i = 0; i < visto.length; i += 1) {
  const clave = `${visto[i].lat},${visto[i].lng}`;
  const yaEstuvo = vistas.indexOf(clave);
  if (yaEstuvo >= 0 && yaEstuvo !== vistas.length - 1) {
    retrocesosCelda += 1;
    detalle.push({ fix: i, volvio_a_la_celda_del_fix: yaEstuvo, metros: m(visto[i - 1], visto[i]) });
  }
  vistas.push(clave);
}
console.log(`\nVECES QUE EL MARCADOR VUELVE A UNA CELDA QUE YA HABIA DEJADO: ${retrocesosCelda}`);
for (const d of detalle.slice(0, 12)) {
  console.log(`  fix ${d.fix}: volvio a donde estaba en el fix ${d.volvio_a_la_celda_del_fix} · ${d.metros.toFixed(0)} m hacia atras`);
}

// ------------------------------------- 2. el orden por hora de LLEGADA
console.log('\n=== 2. ORDEN POR created_at (llegada) vs captured_at (captura) ===');
const porLlegada = [...FIXES].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
const porCaptura = [...FIXES].sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at));
const igual = porLlegada.every((f, i) => f.id === porCaptura[i].id);
console.log(`en ESTE recorrido los dos ordenes coinciden: ${igual ? 'SI' : 'NO'}`);
const latencias = FIXES.map((f) => Date.parse(f.created_at) - Date.parse(f.captured_at));
console.log(`latencia de publicacion: mediana ${mediana(latencias)} ms · maxima ${Math.max(...latencias)} ms`);
console.log('cuanta latencia extra hace falta para que un fix viejo pase a ser «el ultimo»:');
let minCruce = Infinity;
for (let i = 1; i < porCaptura.length; i += 1) {
  const hueco = Date.parse(porCaptura[i].captured_at) - Date.parse(porCaptura[i - 1].captured_at);
  minCruce = Math.min(minCruce, hueco);
}
console.log(`  el hueco MAS CHICO entre capturas es ${minCruce} ms.`);
console.log(`  o sea: basta con que una publicacion se demore ${minCruce} ms mas que la siguiente`);
console.log('  para que el fix anterior llegue despues, gane el order by created_at desc,');
console.log('  y se entregue como «el mas nuevo» con un timestamp mas nuevo.');

function mediana(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

fs.writeFileSync(path.join(evidencia('gate-cliente'), 'replay-contrato.json'),
  JSON.stringify({
    recorridoReal, recorridoVisto, celdas: celdas.size, fixes: FIXES.length,
    errorMediano: mediana(errores), errorMaximo: Math.max(...errores),
    saltos, retrocesosCelda, detalle, ordenesCoinciden: igual,
    latenciaMediana: mediana(latencias), latenciaMaxima: Math.max(...latencias), minCruce,
  }, null, 2), 'utf8');
