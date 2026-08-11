// ─────────────────────────────────────────────────────────────────────────────
// «SEGUIR» ES UN MAPA PERMANENTE
//
// Lo que se protege acá es el cambio de modelo: el mapa del cliente dejó de
// aparecer sólo cuando había un rider que dibujar. Ahora existe siempre y lo
// que cambia entre estados son sus CAPAS. Los dos riesgos que eso introduce
// son los que miden estos tests:
//
//   1. que aparezca algo que no es cierto (un rider sin ubicación real, un
//      destino de un pedido que ya terminó);
//   2. que el mapa se desmonte y se rearme en cada transición, que es
//      exactamente lo que el modelo nuevo promete no hacer.
// ─────────────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAPLIBRE_ACCURACY_SOURCE_ID,
  MAPLIBRE_FALLBACK_COPY,
  areaCenterPoint,
  createMapLibreTrackingMap,
  normalizeAreaBounds,
} from '../js/map/maplibre_tracking_map.js';

const NEUQUEN_AREA = [
  [-38.982, -68.105],
  [-38.904, -67.955],
];

const STORE_POINT = { lat: -38.9460616, lng: -68.0533209, label: 'La Taba 2' };
const DESTINATION_POINT = { lat: -38.9402, lng: -68.0735, label: 'Destino de entrega' };
const RIDER_FIX = {
  lat: -38.9441,
  lng: -68.0602,
  accuracy: 12,
  source: 'gps',
  lastFixAt: new Date('2026-08-11T12:00:00Z').toISOString(),
};

// ── El área operativa ────────────────────────────────────────────────────────

test('el área operativa se traduce del contrato [lat,lng] al [lng,lat] de fitBounds', () => {
  // `defaultMapBounds` está escrito latitud primero; MapLibre espera longitud
  // primero. Invertir esto en silencio mandaría la cámara al océano Índico.
  assert.deepEqual(normalizeAreaBounds(NEUQUEN_AREA), [
    [-68.105, -38.982],
    [-67.955, -38.904],
  ]);
});

test('el área operativa se ordena sola aunque las esquinas vengan cruzadas', () => {
  const cruzada = [
    [-38.904, -67.955],
    [-38.982, -68.105],
  ];
  assert.deepEqual(normalizeAreaBounds(cruzada), normalizeAreaBounds(NEUQUEN_AREA));
});

test('un área degenerada o inválida no es un encuadre', () => {
  // Un punto repetido no delimita nada: encuadrarlo daría un zoom infinito.
  assert.equal(normalizeAreaBounds([[-38.9, -68.0], [-38.9, -68.0]]), null);
  assert.equal(normalizeAreaBounds([[-38.9, -68.0], [-38.9, -67.9]]), null);
  assert.equal(normalizeAreaBounds(null), null);
  assert.equal(normalizeAreaBounds([]), null);
  assert.equal(normalizeAreaBounds([['a', 'b'], [1, 2]]), null);
  assert.equal(normalizeAreaBounds([[-200, -68], [-38.9, -67.9]]), null);
});

test('el centro del área sirve para montar antes de poder encuadrar', () => {
  assert.deepEqual(areaCenterPoint(NEUQUEN_AREA), { lat: -38.943, lng: -68.03 });
  assert.equal(areaCenterPoint(null), null);
});

// ── El mapa sin pedido ───────────────────────────────────────────────────────

test('sin pedido el mapa monta con el local, sin rider, y encuadra la zona', () => {
  const env = installMapLibreStub();
  const { shell, canvas, fallback } = createMapShell({ documentRef: env.document, idle: true });
  const controller = createMapLibreTrackingMap({ root: env.root, documentRef: env.document });
  try {
    controller.mount({
      container: canvas,
      shell,
      fallback,
      store: STORE_POINT,
      area: NEUQUEN_AREA,
      center: STORE_POINT,
      zoom: 13.4,
    });
    env.calls.maps[0].emit('load');

    const estado = controller.getLifecycleState();
    assert.equal(estado.hasStoreMarker, true, 'el local es lo único cierto sin pedido');
    assert.equal(estado.hasRiderMarker, false, 'no hay rider que dibujar');
    assert.equal(estado.hasDestinationMarker, false, 'no hay entrega confirmada');
    assert.equal(estado.measuredLocation, null);
    assert.equal(env.calls.markers.length, 1);
    // El encuadre es el área declarada del comercio, no una posición inventada.
    assert.equal(env.calls.fitBounds.length, 1);
    assert.deepEqual(env.calls.fitBounds[0].bounds, normalizeAreaBounds(NEUQUEN_AREA));
  } finally {
    controller.destroy();
    env.restore();
  }
});

test('sin local ploteable el mapa no inventa un pin: encuadra igual y no marca nada', () => {
  const env = installMapLibreStub();
  const { shell, canvas, fallback } = createMapShell({ documentRef: env.document, idle: true });
  const controller = createMapLibreTrackingMap({ root: env.root, documentRef: env.document });
  try {
    controller.mount({
      container: canvas,
      shell,
      fallback,
      store: null,
      area: NEUQUEN_AREA,
      center: areaCenterPoint(NEUQUEN_AREA),
      zoom: 13.4,
    });
    env.calls.maps[0].emit('load');

    assert.equal(controller.getLifecycleState().hasStoreMarker, false);
    assert.equal(env.calls.markers.length, 0);
    assert.equal(env.calls.fitBounds.length, 1);
  } finally {
    controller.destroy();
    env.restore();
  }
});

// ── La evolución por capas ───────────────────────────────────────────────────

test('el pedido avanza cambiando capas: el mapa se monta UNA vez', () => {
  const env = installMapLibreStub();
  const { shell, canvas, fallback } = createMapShell({ documentRef: env.document, idle: true });
  const controller = createMapLibreTrackingMap({ root: env.root, documentRef: env.document });
  try {
    // Sin pedido: sólo el local.
    controller.mount({
      container: canvas,
      shell,
      fallback,
      store: STORE_POINT,
      area: NEUQUEN_AREA,
      center: STORE_POINT,
    });
    env.calls.maps[0].emit('load');
    assert.equal(env.calls.markers.length, 1);

    // El cliente compra y confirma su punto de entrega: aparece el destino.
    controller.updatePlaces({ store: STORE_POINT, destination: DESTINATION_POINT });
    let estado = controller.getLifecycleState();
    assert.equal(estado.hasStoreMarker, true);
    assert.equal(estado.hasDestinationMarker, true);
    assert.equal(env.calls.markers.length, 2);

    // El rider sale del local: el pin del comercio deja de aportar y se retira.
    controller.updatePlaces({ store: null, destination: DESTINATION_POINT });
    controller.updateRiderLocation(RIDER_FIX, { freshness: 'fresh', status: 'on_the_way' });
    estado = controller.getLifecycleState();
    assert.equal(estado.hasStoreMarker, false);
    assert.equal(estado.hasDestinationMarker, true);
    assert.equal(estado.hasRiderMarker, true);

    // Y todo eso ocurrió sobre EL MISMO mapa: ni uno nuevo ni uno destruido.
    assert.equal(env.calls.maps.length, 1, 'el mapa no se rearma entre estados');
    assert.equal(env.calls.mapRemove, 0);
  } finally {
    controller.destroy();
    env.restore();
  }
});

test('mover un pin existente no lo recrea', () => {
  const env = installMapLibreStub();
  const { shell, canvas, fallback } = createMapShell({ documentRef: env.document });
  const controller = createMapLibreTrackingMap({ root: env.root, documentRef: env.document });
  try {
    controller.mount({ container: canvas, shell, fallback, store: STORE_POINT, center: STORE_POINT });
    env.calls.maps[0].emit('load');
    const creados = env.calls.markers.length;

    const movido = { ...DESTINATION_POINT };
    controller.updatePlaces({ store: STORE_POINT, destination: movido });
    controller.updatePlaces({ store: STORE_POINT, destination: { ...movido, lat: -38.9411 } });

    // Dos actualizaciones del destino, un solo marcador de destino creado: si
    // se recreara, el pin parpadearía en pantalla en cada poll.
    assert.equal(env.calls.markers.length, creados + 1);
    assert.equal(controller.getLifecycleState().hasDestinationMarker, true);
  } finally {
    controller.destroy();
    env.restore();
  }
});

test('las capas pedidas antes de que cargue el estilo se aplican al cargar', () => {
  const env = installMapLibreStub();
  const { shell, canvas, fallback } = createMapShell({ documentRef: env.document });
  const controller = createMapLibreTrackingMap({ root: env.root, documentRef: env.document });
  try {
    controller.mount({ container: canvas, shell, fallback, store: STORE_POINT, center: STORE_POINT });
    // Todavía sin `load`: no hay dónde colgar un marcador.
    assert.equal(controller.updatePlaces({ store: STORE_POINT, destination: DESTINATION_POINT }), false);
    assert.equal(env.calls.markers.length, 0);

    env.calls.maps[0].emit('load');
    const estado = controller.getLifecycleState();
    assert.equal(estado.hasStoreMarker, true);
    assert.equal(estado.hasDestinationMarker, true);
  } finally {
    controller.destroy();
    env.restore();
  }
});

// ── El regreso al estado sin pedido ──────────────────────────────────────────

test('al terminar el pedido el rider se retira y su halo queda vacío', () => {
  const env = installMapLibreStub();
  const { shell, canvas, fallback } = createMapShell({ documentRef: env.document });
  const controller = createMapLibreTrackingMap({ root: env.root, documentRef: env.document });
  try {
    controller.mount({
      container: canvas,
      shell,
      fallback,
      riderLocation: RIDER_FIX,
      freshness: 'fresh',
      status: 'on_the_way',
      store: null,
      destination: DESTINATION_POINT,
      center: RIDER_FIX,
    });
    env.calls.maps[0].emit('load');
    assert.equal(controller.getLifecycleState().hasRiderMarker, true);

    controller.clearRider();

    const estado = controller.getLifecycleState();
    assert.equal(estado.hasRiderMarker, false, 'un rider dibujado tras la entrega afirma un reparto que no existe');
    assert.equal(estado.measuredLocation, null);
    assert.equal(estado.accuracyMeters, null);
    assert.equal(estado.moving, false);
    // El halo de precisión es una capa aparte: si no se vacía, queda un círculo
    // rojo flotando sobre el mapa sin marcador que lo explique.
    const halo = env.calls.maps[0].getSource(MAPLIBRE_ACCURACY_SOURCE_ID);
    assert.deepEqual(halo?.data, { type: 'FeatureCollection', features: [] });
    // Y el mapa sigue siendo el mismo.
    assert.equal(env.calls.mapRemove, 0);
  } finally {
    controller.destroy();
    env.restore();
  }
});

test('volver al estado sin pedido reencuadra la zona operativa', () => {
  const env = installMapLibreStub();
  const { shell, canvas, fallback } = createMapShell({ documentRef: env.document });
  const controller = createMapLibreTrackingMap({ root: env.root, documentRef: env.document });
  try {
    controller.mount({
      container: canvas,
      shell,
      fallback,
      riderLocation: RIDER_FIX,
      freshness: 'fresh',
      status: 'on_the_way',
      destination: DESTINATION_POINT,
      center: RIDER_FIX,
    });
    env.calls.maps[0].emit('load');
    const encuadresPrevios = env.calls.fitBounds.length;

    controller.clearRider();
    controller.updatePlaces({ store: STORE_POINT, destination: null });
    assert.equal(controller.frameArea(NEUQUEN_AREA), true);

    assert.equal(controller.getLifecycleState().hasDestinationMarker, false);
    assert.equal(controller.getLifecycleState().hasStoreMarker, true);
    assert.equal(env.calls.fitBounds.length, encuadresPrevios + 1);
    assert.deepEqual(
      env.calls.fitBounds.at(-1).bounds,
      normalizeAreaBounds(NEUQUEN_AREA),
    );
  } finally {
    controller.destroy();
    env.restore();
  }
});

/*
 * Mientras se prepara el pedido no hay rider, y lo que el cliente necesita ver
 * es de dónde sale y a dónde va. Con el local y el destino se arma un encuadre
 * que contiene a los dos: centrar en el local a zoom fijo dejaba el destino
 * fuera de pantalla —había pin y no se veía—, y por eso el encuadre de este
 * caso admite un zoom más cerrado que el de la zona operativa entera.
 */
test('el encuadre local–destino contiene a los dos y admite su propio zoom', () => {
  const env = installMapLibreStub();
  const { shell, canvas, fallback } = createMapShell({ documentRef: env.document });
  const controller = createMapLibreTrackingMap({ root: env.root, documentRef: env.document });
  const parDeLugares = [
    [STORE_POINT.lat, STORE_POINT.lng],
    [DESTINATION_POINT.lat, DESTINATION_POINT.lng],
  ];
  try {
    controller.mount({
      container: canvas,
      shell,
      fallback,
      store: STORE_POINT,
      destination: DESTINATION_POINT,
      area: parDeLugares,
      areaMaxZoom: 15.4,
      center: STORE_POINT,
    });
    env.calls.maps[0].emit('load');

    assert.equal(env.calls.fitBounds.length, 1);
    const { bounds, options } = env.calls.fitBounds[0];
    assert.deepEqual(bounds, normalizeAreaBounds(parDeLugares));
    assert.equal(options.maxZoom, 15.4, 'una entrega cercana no debe verse desde lejos');
    // Los dos puntos caen dentro del encuadre, que es lo que se quería.
    const [[west, south], [east, north]] = bounds;
    for (const point of [STORE_POINT, DESTINATION_POINT]) {
      assert.ok(point.lng >= west && point.lng <= east, 'longitud dentro del encuadre');
      assert.ok(point.lat >= south && point.lat <= north, 'latitud dentro del encuadre');
    }
  } finally {
    controller.destroy();
    env.restore();
  }
});

test('frameArea no hace nada con un área que no delimita', () => {
  const env = installMapLibreStub();
  const { shell, canvas, fallback } = createMapShell({ documentRef: env.document });
  const controller = createMapLibreTrackingMap({ root: env.root, documentRef: env.document });
  try {
    controller.mount({ container: canvas, shell, fallback, store: STORE_POINT, center: STORE_POINT });
    env.calls.maps[0].emit('load');
    const previos = env.calls.fitBounds.length;
    assert.equal(controller.frameArea(null), false);
    assert.equal(controller.frameArea([[1, 1], [1, 1]]), false);
    assert.equal(env.calls.fitBounds.length, previos);
  } finally {
    controller.destroy();
    env.restore();
  }
});

// ── Cuando el mapa no puede dibujarse ────────────────────────────────────────

test('el mapa caído dice lo que corresponde a SU estado, no una frase prestada', () => {
  const env = installMapLibreStub();
  const copiaSinPedido = 'Mapa no disponible por ahora. Vas a poder seguir tu pedido igual desde acá.';
  const { shell, canvas, fallback, fallbackCopy } = createMapShell({
    documentRef: env.document,
    idle: true,
    fallbackDataset: { mapFallbackCopy: copiaSinPedido },
  });
  const controller = createMapLibreTrackingMap({
    root: env.root,
    documentRef: env.document,
    // Sin WebGL no hay lienzo posible: es el camino que este test recorre.
    webglSupported: () => false,
  });
  try {
    assert.equal(controller.mount({
      container: canvas, shell, fallback, store: STORE_POINT, center: STORE_POINT,
    }), false);
    assert.equal(controller.getLifecycleState().unavailable, true);
    assert.equal(fallback.hidden, false, 'el respaldo tiene que verse');
    // Sin pedido, prometer «seguimos actualizando el estado de tu pedido» es
    // anunciar un problema sobre algo que ni siquiera existe todavía.
    assert.equal(fallbackCopy.textContent, copiaSinPedido);
    assert.doesNotMatch(fallbackCopy.textContent, /estado de tu pedido/);
  } finally {
    controller.destroy();
    env.restore();
  }
});

test('sin copia declarada, el mapa caído conserva la frase por defecto', () => {
  const env = installMapLibreStub();
  const { shell, canvas, fallback, fallbackCopy } = createMapShell({ documentRef: env.document });
  const controller = createMapLibreTrackingMap({
    root: env.root,
    documentRef: env.document,
    webglSupported: () => false,
  });
  try {
    controller.mount({ container: canvas, shell, fallback, store: STORE_POINT, center: STORE_POINT });
    assert.equal(fallbackCopy.textContent, MAPLIBRE_FALLBACK_COPY);
  } finally {
    controller.destroy();
    env.restore();
  }
});

// ── Dobles ───────────────────────────────────────────────────────────────────

function createFakeDocument() {
  return {
    createElement(tag) {
      if (String(tag).toLowerCase() === 'canvas') {
        return {
          getContext: () => ({ getParameter: () => 1 }),
        };
      }
      return {
        className: '',
        innerHTML: '',
        style: {},
        dataset: {},
        classList: createClassList(),
        setAttribute() {},
        removeAttribute() {},
        appendChild() {},
        querySelector: () => null,
      };
    },
  };
}

function createClassList() {
  const classes = new Set();
  return {
    add(value) { classes.add(value); },
    remove(value) { classes.delete(value); },
    toggle(value, force) {
      if (force) classes.add(value);
      else classes.delete(value);
    },
    contains(value) { return classes.has(value); },
  };
}

function createMapShell({
  documentRef,
  idle = false,
  orderId = '',
  fallbackDataset = {},
} = {}) {
  const metaCopy = { textContent: '' };
  const meta = {
    querySelector: (selector) => (selector === '[data-map-meta-text]' ? metaCopy : null),
  };
  const fallbackCopy = { textContent: '' };
  const fallback = {
    hidden: false,
    dataset: fallbackDataset,
    setAttribute(name) { if (name === 'hidden') this.hidden = true; },
    removeAttribute(name) { if (name === 'hidden') this.hidden = false; },
    querySelector: () => fallbackCopy,
  };
  const canvas = {
    listeners: new Map(),
    clientWidth: 360,
    clientHeight: 340,
    ownerDocument: documentRef,
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    removeAttribute() {},
  };
  const shell = {
    dataset: { mapRole: 'tracking', orderId, ...(idle ? { mapMode: 'idle' } : {}) },
    isConnected: true,
    classList: createClassList(),
    querySelector(selector) {
      if (selector === '[data-map-meta]') return meta;
      if (selector === '[data-map-fallback]') return fallback;
      if (selector === '[data-map-canvas]') return canvas;
      return null;
    },
  };
  canvas.parentElement = shell;
  return { shell, canvas, fallback, fallbackCopy, meta, metaCopy };
}

function installMapLibreStub() {
  const documentRef = createFakeDocument();
  const calls = {
    maps: [],
    markers: [],
    fitBounds: [],
    mapRemove: 0,
    markerRemove: 0,
  };

  class FakeMap {
    constructor(options) {
      this.options = options;
      this.listeners = new Map();
      this.sources = new Map();
      this.layers = new Map();
      calls.maps.push(this);
    }
    on(type, listener) {
      const set = this.listeners.get(type) || new Set();
      set.add(listener);
      this.listeners.set(type, set);
      return this;
    }
    off(type, listener) { this.listeners.get(type)?.delete(listener); return this; }
    emit(type, event = {}) {
      [...(this.listeners.get(type) || [])].forEach((listener) => listener(event));
    }
    addControl() { return this; }
    addSource(id, definition) {
      this.sources.set(id, {
        ...definition,
        setData(data) { this.data = data; },
      });
    }
    getSource(id) { return this.sources.get(id); }
    addLayer(layer) { this.layers.set(layer.id, layer); }
    getLayer(id) { return this.layers.get(id); }
    setLayoutProperty() {}
    fitBounds(bounds, options) { calls.fitBounds.push({ bounds, options }); }
    jumpTo() {}
    easeTo() {}
    setCenter() {}
    setZoom() {}
    getCanvas() { return this.options.container; }
    resize() {}
    remove() { calls.mapRemove += 1; }
  }

  class FakeMarker {
    constructor(options = {}) {
      this.options = options;
      calls.markers.push(this);
    }
    setLngLat(next) { this.lngLat = [...next]; return this; }
    addTo(map) { this.map = map; return this; }
    remove() { calls.markerRemove += 1; this.map = null; return this; }
    getElement() { return this.options.element; }
  }

  const maplibregl = { Map: FakeMap, Marker: FakeMarker };
  const root = {
    document: documentRef,
    maplibregl,
    requestAnimationFrame: (callback) => setTimeout(callback, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (id) => clearTimeout(id),
    matchMedia: () => ({ matches: true }),
  };

  return {
    root,
    document: documentRef,
    calls,
    restore() {},
  };
}
