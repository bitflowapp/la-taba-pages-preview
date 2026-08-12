// La ausencia de coordenada no es una coordenada.
//
// POR QUÉ EXISTE ESTE ARCHIVO
// ---------------------------
// Es la tercera vez que aparece el mismo defecto en este repositorio:
//   1. `459a2dc` lo cerró en la configuración del comercio;
//   2. `delivery-location-empty-point.test.mjs` lo cerró en el punto de entrega,
//      donde era alcanzable desde el producto —una persona confirmaba
//      «0.000000, 0.000000» y el servidor lo aceptaba con HTTP 200—;
//   3. seguía abierto en las CUATRO comprobaciones del seguimiento y del mapa.
//
// Todas escribían la validación así:
//
//     const lat = Number(raw.lat);
//     if (!Number.isFinite(lat) || Math.abs(lat) > 90) return null;
//
// y `Number(null)` es `0`, que es finito y está en rango. Medido sobre el código
// anterior a este cambio, `{lat: null, lng: null, source: 'gps'}` producía un
// fix completo en 0,0, `isUsableGpsFix` lo daba por bueno, `chooseRiderLocation`
// lo elegía para dibujar y `distanceKm` contra el local informaba 8.128,5 km.
//
// Por eso este archivo no prueba una función: prueba una REGLA sobre todas las
// puertas de entrada de coordenadas del cliente. Si mañana alguien agrega una
// quinta escrita con `Number()` a secas, la lista de abajo la delata.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  coordinatePair,
  finiteCoordinate,
  finiteLatitude,
  finiteLongitude,
  isGeoPoint,
} from '../js/core/geo-point.js';
import { normalizeTrackingLocation } from '../js/core/domain.js';
import {
  chooseRiderLocation,
  distanceKm,
  isUsableGpsFix,
  isValidLocation,
  normalizeRiderLocation,
} from '../js/map/route_geometry.js';
import { accuracyCircleFeature, isValidMapPoint } from '../js/map/maplibre_tracking_map.js';
import { normalizeDeliveryLocation, plottableDeliveryPoint } from '../js/core/delivery-location.js';

// Lo que NO es una coordenada. Los seis primeros son los que `Number()` convertía
// en un número sin que nadie hubiera medido nada; los cuatro últimos ya se
// rechazaban bien y quedan para que nadie los rompa al arreglar los otros.
const NO_ES_COORDENADA = [
  ['null', null],
  ['undefined', undefined],
  ['cadena vacía', ''],
  ['cadena de espacios', '   '],
  ['array vacío', []],
  ['array con un número', [7]],
  ['false', false],
  ['true', true],
  ['objeto', {}],
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
  ['-Infinity', Number.NEGATIVE_INFINITY],
  ['texto', 'ocho'],
];

const FUERA_DE_RANGO_LAT = [90.0001, -90.0001, 91, -91, 180, 1000];
const FUERA_DE_RANGO_LNG = [180.0001, -180.0001, 181, -181, 360, 1000];

// Coordenadas que SÍ son datos medidos y tienen que seguir pasando.
const SÍ_ES_COORDENADA = [
  ['el local real', -38.9460616, -68.0533209],
  ['cadena numérica (FormData, localStorage)', '-38.9460616', '-68.0533209'],
  ['cadena numérica con espacios', '  -38.94  ', '  -68.05  '],
  ['cero medido', 0, 0],
  ['los bordes exactos del rango', 90, 180],
  ['los bordes exactos negativos', -90, -180],
];

test('finiteCoordinate rechaza todo lo que no es un número medido', () => {
  for (const [etiqueta, valor] of NO_ES_COORDENADA) {
    assert.equal(finiteCoordinate(valor, 90), null, `${etiqueta} no es una latitud`);
    assert.equal(finiteCoordinate(valor, 180), null, `${etiqueta} no es una longitud`);
  }
});

test('finiteCoordinate respeta el rango de cada eje', () => {
  for (const valor of FUERA_DE_RANGO_LAT) {
    assert.equal(finiteLatitude(valor), null, `${valor} no es una latitud`);
  }
  for (const valor of FUERA_DE_RANGO_LNG) {
    assert.equal(finiteLongitude(valor), null, `${valor} no es una longitud`);
  }
  // 180 es longitud válida y latitud inválida: el límite no es el mismo.
  assert.equal(finiteLongitude(180), 180);
  assert.equal(finiteLatitude(180), null);
});

test('finiteCoordinate conserva los datos que sí fueron medidos', () => {
  for (const [etiqueta, lat, lng] of SÍ_ES_COORDENADA) {
    assert.equal(typeof finiteLatitude(lat), 'number', `${etiqueta}: la latitud sobrevive`);
    assert.equal(typeof finiteLongitude(lng), 'number', `${etiqueta}: la longitud sobrevive`);
  }
  // El cero numérico es un valor medido, no una ausencia. Esta capa no decide
  // que un comercio no pueda estar en 0,0; sólo distingue medido de faltante.
  assert.deepEqual(coordinatePair(0, 0), { lat: 0, lng: 0 });
});

test('media coordenada no es medio punto: es ningún punto', () => {
  assert.equal(coordinatePair(-38.94, null), null);
  assert.equal(coordinatePair(null, -68.05), null);
  assert.equal(coordinatePair(-38.94, ''), null);
  assert.deepEqual(coordinatePair(-38.94, -68.05), { lat: -38.94, lng: -68.05 });
});

// ─────────────────────────────────────────────────────────────────────────────
// LA REGLA. Toda puerta de entrada de coordenadas del cliente, en una sola lista.
// ─────────────────────────────────────────────────────────────────────────────

const PUERTAS_QUE_VALIDAN = [
  ['route_geometry.isValidLocation', (lat, lng) => isValidLocation({ lat, lng })],
  ['maplibre_tracking_map.isValidMapPoint', (lat, lng) => isValidMapPoint({ lat, lng })],
  ['geo-point.isGeoPoint', (lat, lng) => isGeoPoint({ lat, lng })],
];

const PUERTAS_QUE_NORMALIZAN = [
  ['core/domain.normalizeTrackingLocation', (lat, lng) => normalizeTrackingLocation({ lat, lng })],
  ['route_geometry.normalizeRiderLocation', (lat, lng) => normalizeRiderLocation({ lat, lng })],
  ['core/delivery-location.plottableDeliveryPoint',
    (lat, lng) => plottableDeliveryPoint({ latitude: lat, longitude: lng })],
  ['core/delivery-location.normalizeDeliveryLocation', (lat, lng) => normalizeDeliveryLocation({
    latitude: lat,
    longitude: lng,
    locationSource: 'gps',
    confirmedAt: '2026-08-12T00:00:00.000Z',
  })],
];

test('ninguna comprobación del cliente da por válida la ausencia de coordenada', () => {
  for (const [nombre, comprobar] of PUERTAS_QUE_VALIDAN) {
    for (const [etiqueta, valor] of NO_ES_COORDENADA) {
      assert.equal(comprobar(valor, valor), false, `${nombre} acepta ${etiqueta}`);
      assert.equal(comprobar(-38.94, valor), false, `${nombre} acepta longitud ${etiqueta}`);
      assert.equal(comprobar(valor, -68.05), false, `${nombre} acepta latitud ${etiqueta}`);
    }
  }
});

test('ningún normalizador del cliente inventa un punto a partir de la nada', () => {
  for (const [nombre, normalizar] of PUERTAS_QUE_NORMALIZAN) {
    for (const [etiqueta, valor] of NO_ES_COORDENADA) {
      assert.equal(normalizar(valor, valor), null, `${nombre} inventa un punto con ${etiqueta}`);
      assert.equal(normalizar(-38.94, valor), null, `${nombre} inventa longitud con ${etiqueta}`);
      assert.equal(normalizar(valor, -68.05), null, `${nombre} inventa latitud con ${etiqueta}`);
    }
  }
});

test('las puertas siguen dejando pasar una coordenada real', () => {
  for (const [nombre, comprobar] of PUERTAS_QUE_VALIDAN) {
    assert.equal(comprobar(-38.9460616, -68.0533209), true, `${nombre} rechaza el local real`);
  }
  for (const [nombre, normalizar] of PUERTAS_QUE_NORMALIZAN) {
    assert.notEqual(normalizar(-38.9460616, -68.0533209), null, `${nombre} rechaza el local real`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// LO QUE PASABA AGUAS ABAJO. Cada una de estas afirmaciones fallaba antes.
// ─────────────────────────────────────────────────────────────────────────────

const FIX_SIN_COORDENADA = Object.freeze({
  lat: null,
  lng: null,
  source: 'gps',
  timestamp: Date.now(),
});

test('un fix sin coordenada no es un fix GPS utilizable', () => {
  assert.equal(isUsableGpsFix(FIX_SIN_COORDENADA), false);
});

test('un fix sin coordenada no es lo que se elige para dibujar al rider', () => {
  assert.equal(chooseRiderLocation(null, FIX_SIN_COORDENADA), null);
});

test('sin coordenada no se dibuja el halo de precisión', () => {
  assert.equal(accuracyCircleFeature({ lat: null, lng: null }, 50), null);
  assert.equal(accuracyCircleFeature({ lat: '', lng: '' }, 50), null);
  // Con un punto real sí se dibuja: el arreglo no apaga la función.
  assert.notEqual(accuracyCircleFeature({ lat: -38.9460616, lng: -68.0533209 }, 50), null);
});

test('no se informa una distancia calculada contra una coordenada que no existe', () => {
  const local = { lat: -38.9460616, lng: -68.0533209 };
  // Antes devolvía 8128.5: el resultado de medir contra `null` pasado por
  // `Number()`, es decir la distancia de Neuquén al Golfo de Guinea.
  //
  // Devuelve 0 y no `null` a propósito: 0 ya era el valor que la función usaba
  // para «no se pudo medir» —lo devolvía cuando `isLatLng` fallaba— y los dos
  // llamadores que existen hacen `.toFixed(1)` sobre el resultado
  // (`js/orders.js:519`, `js/simulation.js:109`), así que cambiar el contrato a
  // `null` los rompería. Lo que se corrige es el número inventado, no la firma.
  assert.equal(distanceKm(local, { lat: null, lng: null }), 0);
  assert.equal(distanceKm(local, { lat: '', lng: '' }), 0);
  assert.equal(distanceKm(local, { lat: [], lng: [] }), 0);
  assert.equal(distanceKm(local, { lat: false, lng: false }), 0);
  // Una distancia real se sigue calculando.
  const destino = { lat: -38.945584, lng: -68.040579 };
  const medida = distanceKm(local, destino);
  assert.equal(typeof medida, 'number');
  assert.ok(medida > 0 && medida < 5, `la distancia al destino demo es de barrio, no ${medida}`);
});
