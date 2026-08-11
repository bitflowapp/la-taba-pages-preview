/*
 * Reproduce el retroceso/replay del marcador del Rider usando los MODULOS
 * REALES del cliente y la traza FISICA de un recorrido de verdad.
 *
 * No inventa coordenadas: lee el timeline que dejo el recorrido
 * (artifacts/.../replay-timeline-<CODE>.json) y lo hace pasar por la misma
 * cadena que corre en el navegador:
 *
 *   fila de rider_locations
 *     -> normalizeTrackingLocation   (asi la arma el DTO publico: created_at)
 *     -> chooseRiderLocation         (sim local vs ubicacion del pedido)
 *     -> rider_motion.pushFix        (acepta o rechaza, y arma el tramo visual)
 *
 * Para cada fix registra: id/sequence, captured_at del dispositivo, received_at
 * del servidor, revision del pedido, lat/lng, accuracy, de donde vino
 * (realtime/poll/offline-drain), cual era el ultimo fix canonico aceptado, la
 * decision, y el measuredFrom/measuredTo que uso el motor. Sin secretos.
 *
 *   node scripts/diagnose-tracking-replay.mjs [ruta-al-timeline.json]
 */
import fs from 'node:fs';
import path from 'node:path';

import { normalizeTrackingLocation } from '../js/core/domain.js';
import { chooseRiderLocation, distanceKm, locationTimestamp } from '../js/map/route_geometry.js';
import { createRiderMotion } from '../js/map/rider_motion.js';
import { evidencia } from './primer-pedido-humano/entorno.mjs';

const RUTA = process.argv[2] || path.join(evidencia('gate-cliente'), 'replay-timeline-LT-0138.json');
const traza = JSON.parse(fs.readFileSync(RUTA, 'utf8'));
const FIXES = traza.locs;
const metros = (a, b) => (a && b ? distanceKm(a, b) * 1000 : 0);

/* Asi arma el DTO publico la ubicacion: el timestamp que viaja es created_at,
 * o sea la hora del SERVIDOR, no la del dispositivo. */
function comoLoMandaElBackend(row) {
  return normalizeTrackingLocation({
    lat: row.lat,
    lng: row.lng,
    accuracy: row.accuracy,
    heading: row.heading,
    speed: row.speed,
    source: 'gps',
    timestamp: row.created_at,
  });
}

/* Y asi lo tiene el propio telefono del Rider: hora del DISPOSITIVO. */
function comoLoVeElRider(row) {
  return normalizeTrackingLocation({
    lat: row.lat,
    lng: row.lng,
    accuracy: row.accuracy,
    source: 'gps',
    timestamp: row.captured_at || row.recorded_at || row.created_at,
  });
}

const indicePorCoordenada = new Map();
FIXES.forEach((f, i) => indicePorCoordenada.set(`${f.lat},${f.lng}`, i));
const indiceDe = (p) => (p ? indicePorCoordenada.get(`${p.lat},${p.lng}`) ?? -1 : -1);

/**
 * Corre un escenario y devuelve el diario + los retrocesos detectados.
 * `entradas` es una lista de { row, origen } en el orden en que LLEGAN.
 */
function correr(nombre, entradas, { remountEn = null } = {}) {
  let reloj = Date.parse(FIXES[0].created_at);
  let motion = createRiderMotion({ now: () => reloj });
  const diario = [];
  const retrocesos = [];
  let maxIndiceMostrado = -1;
  let ultimoAceptado = null;

  entradas.forEach((entrada, paso) => {
    const { row, origen, comoRider = false } = entrada;
    reloj = Math.max(reloj, Date.parse(row.created_at)) + 1;

    if (remountEn === paso) {
      motion = createRiderMotion({ now: () => reloj });
      ultimoAceptado = null;
      diario.push({ paso, evento: 'REMOUNT del mapa: motor de movimiento nuevo' });
    }

    const delBackend = comoLoMandaElBackend(row);
    const elegido = comoRider
      ? chooseRiderLocation(comoLoVeElRider(row), delBackend, { now: reloj })
      : delBackend;

    const desde = motion.visualPositionAt(reloj);
    const antesMedido = motion.measuredPosition();
    const veredicto = motion.pushFix(elegido, { instant: false });
    const despuesMedido = motion.measuredPosition();

    const idx = indiceDe(despuesMedido);
    const retrocedio = veredicto.accepted && idx >= 0 && idx < maxIndiceMostrado;
    if (retrocedio) {
      retrocesos.push({
        paso,
        origen,
        volvio_al_fix: idx,
        estaba_en_fix: maxIndiceMostrado,
        metros_atras: Math.round(metros(antesMedido, despuesMedido)),
        captured_at: row.captured_at,
        created_at: row.created_at,
      });
    }
    if (veredicto.accepted && idx > maxIndiceMostrado) maxIndiceMostrado = idx;
    if (veredicto.accepted) ultimoAceptado = despuesMedido;

    diario.push({
      paso,
      seq: row.sequence,
      recibo: row.receipt_sequence,
      revision: row.order_revision,
      captured_at: row.captured_at,
      received_at: row.created_at,
      lat: row.lat,
      lng: row.lng,
      accuracy: row.accuracy,
      origen,
      ultimo_canonico: ultimoAceptado ? `${ultimoAceptado.lat},${ultimoAceptado.lng}` : null,
      decision: veredicto.accepted ? 'accepted' : `rejected:${veredicto.reason}`,
      modo: veredicto.mode || '',
      measuredFrom: desde ? `${desde.lat.toFixed(6)},${desde.lng.toFixed(6)}` : null,
      measuredTo: despuesMedido ? `${despuesMedido.lat},${despuesMedido.lng}` : null,
      retrocedio,
    });
  });

  const rechazados = diario.filter((d) => d.decision?.startsWith('rejected'));
  console.log(`\n=== ${nombre} ===`);
  console.log(`entradas: ${entradas.length} · aceptados: ${diario.filter((d) => d.decision === 'accepted').length} · rechazados: ${rechazados.length}`);
  if (rechazados.length) {
    const porRazon = {};
    for (const r of rechazados) porRazon[r.decision] = (porRazon[r.decision] || 0) + 1;
    console.log(`  razones: ${JSON.stringify(porRazon)}`);
  }
  console.log(`RETROCESOS: ${retrocesos.length}`);
  for (const r of retrocesos.slice(0, 8)) {
    console.log(`  paso ${r.paso} (${r.origen}): estaba en el fix #${r.estaba_en_fix} y volvio al #${r.volvio_al_fix} · ${r.metros_atras} m atras`);
  }
  return { nombre, diario, retrocesos, rechazados: rechazados.length };
}

// --------------------------------------------------------- los escenarios ---
const resultados = [];

// 1. El cliente, camino limpio: un poll por fix, en orden.
resultados.push(correr('CLIENTE · un poll por fix, en orden',
  FIXES.map((row) => ({ row, origen: 'poll' }))));

// 2. El cliente, con el poll repitiendo el fix anterior (5 s de cadencia contra
//    ~12 s de GPS: el poll devuelve el MISMO fix varias veces, y a veces uno
//    viejo llega despues de que realtime ya entrego el nuevo).
const conRepeticion = [];
FIXES.forEach((row, i) => {
  conRepeticion.push({ row, origen: 'realtime' });
  if (i > 0) conRepeticion.push({ row: FIXES[i - 1], origen: 'poll(atrasado)' });
});
resultados.push(correr('CLIENTE · realtime nuevo + poll devolviendo el anterior', conRepeticion));

// 3. El telefono del RIDER: su GPS local (hora del dispositivo) compitiendo con
//    la ubicacion del pedido que vuelve del servidor (hora del servidor).
resultados.push(correr('RIDER · GPS local vs ubicacion del pedido (dos relojes)',
  FIXES.map((row) => ({ row, origen: 'sim+tracked', comoRider: true }))));

// 4. Cola offline: se drenan 12 fixes viejos DESPUES de uno reciente.
const corte = 40;
const offline = [
  ...FIXES.slice(0, corte).map((row) => ({ row, origen: 'poll' })),
  { row: FIXES[corte + 12], origen: 'realtime(reciente)' },
  ...FIXES.slice(corte, corte + 12).map((row) => ({ row, origen: 'offline-drain' })),
  ...FIXES.slice(corte + 13).map((row) => ({ row, origen: 'poll' })),
];
resultados.push(correr('OFFLINE · drenaje de 12 puntos viejos despues de uno reciente', offline));

// 5. Remount del mapa a mitad del recorrido.
resultados.push(correr('REMOUNT · el mapa se vuelve a montar en el paso 45',
  FIXES.map((row) => ({ row, origen: 'poll' })), { remountEn: 45 }));

// 6. Duplicados exactos.
const dupes = [];
for (const row of FIXES) { dupes.push({ row, origen: 'realtime' }); dupes.push({ row, origen: 'poll(duplicado)' }); }
resultados.push(correr('DUPLICADOS · cada fix entregado dos veces', dupes));

const total = resultados.reduce((n, r) => n + r.retrocesos.length, 0);
console.log(`\n================ TOTAL DE RETROCESOS: ${total} ================`);
const salida = path.join(evidencia('gate-cliente'), 'replay-diagnostico.json');
fs.writeFileSync(salida, JSON.stringify(resultados, null, 2), 'utf8');
console.log(`diario completo en ${salida}`);
