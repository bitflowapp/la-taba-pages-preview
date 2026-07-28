import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import {
  buildExternalNavigationUrl,
  buildRiderMapContext,
  businessLocationForMap,
  clearRiderMapContexts,
  customerDestinationForOrder,
  formatRiderDeliveryAddress,
  getRiderMapContext,
  normalizeOperationalMapPoint,
  retainRiderMapContexts,
  riderDistanceAndEtaLabel,
  setRiderMapContext,
  shortOrderLabel,
  straightLineDistanceLabel,
} from '../js/map/rider_operational_map.js';
import {
  createOperationalPlaceMarkerElement,
  createOwnLocationMarkerElement,
  createRiderMarkerElement,
  updateOwnLocationMarkerElement,
} from '../js/map/rider_marker.js';
import { createMapLibreTrackingMap } from '../js/map/maplibre_tracking_map.js';

afterEach(() => clearRiderMapContexts());

test('normaliza coordenadas operativas sin aceptar vacíos, rangos inválidos ni el fallback 0,0', () => {
  const normalized = normalizeOperationalMapPoint({
    latitude: '-38.9516',
    longitude: '-68.0591',
    accuracy: 12,
  });

  assert.equal(normalized.lat, -38.9516);
  assert.equal(normalized.lng, -68.0591);
  assert.equal(normalized.accuracy, 12);
  assert.equal(normalizeOperationalMapPoint({ latitude: '', longitude: '-68.05' }), null);
  assert.equal(normalizeOperationalMapPoint({ latitude: '-38.95', longitude: '' }), null);
  assert.equal(normalizeOperationalMapPoint({ lat: 91, lng: -68 }), null);
  assert.equal(normalizeOperationalMapPoint({ lat: -38, lng: 181 }), null);
  assert.equal(normalizeOperationalMapPoint({ lat: 0, lng: 0 }), null);
  assert.equal(normalizeOperationalMapPoint(null), null);
});

test('extrae cliente, negocio verificado y ubicación propia sin inventar puntos', () => {
  const order = {
    id: 'LT-2048',
    status: 'on_the_way',
    deliveryLatitude: -38.9522,
    deliveryLongitude: -68.0611,
    tracking: {
      lastLocation: {
        lat: -38.9518,
        lng: -68.0603,
        source: 'gps',
        timestamp: 2_000,
      },
    },
  };
  const businessConfig = {
    businessLocationVerified: true,
    businessLocation: {
      lat: -38.9501,
      lng: -68.0584,
      name: 'TABA Centro',
    },
  };

  assert.deepEqual(
    customerDestinationForOrder(order),
    {
      latitude: -38.9522,
      longitude: -68.0611,
      accuracy: undefined,
      lat: -38.9522,
      lng: -68.0611,
      label: 'Cliente',
    },
  );
  assert.equal(businessLocationForMap({
    ...businessConfig,
    businessLocationVerified: false,
  }), null);

  const context = buildRiderMapContext(order, {
    businessConfig,
    localLocation: {
      lat: -38.9514,
      lng: -68.0598,
      heading: 37,
      source: 'gps',
      timestamp: 3_000,
    },
  });

  assert.equal(context.orderId, order.id);
  assert.equal(context.priority, 'client');
  assert.equal(context.riderLocation.lat, -38.9514, 'el fix local prevalece sobre el persistido');
  assert.equal(context.riderLocation.heading, 37);
  assert.equal(context.destination.label, 'Cliente');
  assert.equal(context.store.label, 'TABA Centro');
});

test('la prioridad cambia del negocio al cliente en cuanto el pedido fue retirado', () => {
  const base = {
    id: 'LT-PRIORITY',
    deliveryLocation: { lat: -38.9522, lng: -68.0611 },
  };

  assert.equal(buildRiderMapContext({ ...base, status: 'ready' }).priority, 'business');
  assert.equal(buildRiderMapContext({ ...base, status: 'assigned' }).priority, 'business');
  assert.equal(
    buildRiderMapContext({ ...base, status: 'picked_up' }).priority,
    'client',
    'picked_up ya representa un pedido retirado',
  );
  assert.equal(buildRiderMapContext({ ...base, status: 'on_the_way' }).priority, 'client');
  assert.equal(buildRiderMapContext({ ...base, status: 'arrived' }).priority, 'client');
});

test('el registro de contextos descarta pedidos viejos y normaliza sus puntos', () => {
  setRiderMapContext('LT-A', {
    riderLocation: { latitude: '-38.95', longitude: '-68.05' },
    destination: { lat: -38.96, lng: -68.06 },
    store: { lat: -38.94, lng: -68.04 },
  });
  setRiderMapContext('LT-B', {
    riderLocation: { lat: -38.93, lng: -68.03 },
    destination: { lat: 999, lng: 999 },
  });

  assert.equal(getRiderMapContext('LT-A').riderLocation.lat, -38.95);
  assert.equal(getRiderMapContext('LT-B').destination, null);
  retainRiderMapContexts(['LT-B']);
  assert.equal(getRiderMapContext('LT-A'), null);
  assert.equal(getRiderMapContext('LT-B').orderId, 'LT-B');
});

test('formatea la tarjeta de entrega sin null, undefined, duplicados ni líneas vacías', () => {
  const formatted = formatRiderDeliveryAddress({
    address: 'Roca 123, Centro',
    addressDetails: {
      streetLine: 'Roca 123',
      neighborhood: 'Centro',
      floor: '4',
      apartment: 'B',
      reference: 'Portón negro',
    },
    city: 'Neuquén',
    locality: 'undefined',
    notes: 'Tocar timbre',
  });

  assert.equal(formatted.primary, 'Roca 123');
  assert.deepEqual(formatted.secondary, [
    'Centro',
    'Neuquén',
    'Piso 4',
    'Depto. B',
    'Referencia: Portón negro',
    'Tocar timbre',
  ]);
  assert.equal(formatted.hasAddress, true);
  assert.doesNotMatch(
    [formatted.primary, ...formatted.secondary].join('\n'),
    /\b(?:null|undefined|nan)\b/i,
  );

  const empty = formatRiderDeliveryAddress({
    address: 'null',
    notes: 'Sin notas',
  });
  assert.equal(empty.primary, 'Dirección no informada');
  assert.deepEqual(empty.secondary, []);
  assert.equal(empty.hasAddress, false);
});

test('construye navegación externa por coordenadas validadas para Apple y Google Maps', () => {
  const destination = { latitude: -38.9516, longitude: -68.0591 };
  const apple = buildExternalNavigationUrl({
    destination,
    address: 'Roca 123, Neuquén',
    navigatorRef: {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      platform: 'iPhone',
      maxTouchPoints: 5,
    },
  });
  const appleFromIpadDesktopMode = buildExternalNavigationUrl({
    destination,
    navigatorRef: {
      userAgent: 'Mozilla/5.0',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    },
  });
  const google = buildExternalNavigationUrl({
    destination,
    address: 'texto que no debe reemplazar el destino',
    navigatorRef: {
      userAgent: 'Mozilla/5.0 (Linux; Android 15)',
      platform: 'Linux armv8l',
    },
  });

  assert.equal(
    apple,
    'https://maps.apple.com/?daddr=-38.9516%2C-68.0591&q=Roca%20123%2C%20Neuqu%C3%A9n',
  );
  assert.equal(
    appleFromIpadDesktopMode,
    'https://maps.apple.com/?daddr=-38.9516%2C-68.0591',
  );
  assert.equal(
    google,
    'https://www.google.com/maps/dir/?api=1&destination=-38.9516%2C-68.0591',
  );
  assert.equal(buildExternalNavigationUrl({
    destination: { lat: 0, lng: 0 },
    navigatorRef: {},
  }), '');
  assert.equal(buildExternalNavigationUrl({
    destination: null,
    navigatorRef: {},
  }), '');
});

test('muestra distancia recta y sólo agrega ETA cuando existe metadata confiable', () => {
  const rider = { lat: -38.9516, lng: -68.0591 };
  const client = { lat: -38.9591, lng: -68.0671 };
  const distance = straightLineDistanceLabel(rider, client);

  assert.match(distance, /^\d+(?:,\d)? km$/);
  assert.equal(straightLineDistanceLabel(rider, null), '');
  assert.equal(riderDistanceAndEtaLabel({
    delivery: { etaMinutes: 8 },
  }, rider, client), distance);
  assert.equal(riderDistanceAndEtaLabel({
    delivery: { etaMinutes: 8, etaSource: 'routing' },
  }, rider, client), `${distance} · 8 min`);
  assert.equal(riderDistanceAndEtaLabel({
    delivery: { etaMinutes: 8, etaSource: 'routing' },
  }, null, client), '');
});

test('mantiene un número corto de pedido sin perder su sufijo identificable', () => {
  assert.equal(shortOrderLabel({ id: 'LT-2048' }), 'LT-2048');
  assert.equal(
    shortOrderLabel({ id: '33333333-3333-4333-8333-333333333333' }),
    '…33333333',
  );
  assert.equal(shortOrderLabel({}), '');
});

test('el marcador propio es un círculo genérico accesible y el cliente conserva el casco', () => {
  const documentRef = createFakeDocument();
  const own = createOwnLocationMarkerElement(documentRef, {
    source: 'gps',
    heading: 370,
  });
  const customerTrackingRider = createRiderMarkerElement(documentRef, {
    status: 'on_the_way',
    source: 'gps',
  });

  assert.match(own.className, /\brider-self-marker\b/);
  assert.match(own.className, /\bhas-heading\b/);
  assert.equal(own.attributes.get('role'), 'img');
  assert.equal(own.attributes.get('aria-label'), 'Tu ubicación');
  assert.equal(own.style.values.get('--rider-heading'), '10deg');
  assert.match(own.innerHTML, /rider-self-halo/);
  assert.match(own.innerHTML, /rider-self-core/);
  assert.doesNotMatch(own.innerHTML, /casco|helmet|moto|scooter|persona|avatar|<image\b/i);

  updateOwnLocationMarkerElement(own, { source: 'gps', heading: null });
  assert.doesNotMatch(own.className, /\bhas-heading\b/);
  assert.equal(own.style.values.has('--rider-heading'), false);

  assert.match(customerTrackingRider.innerHTML, /lt-rider-helmet-icon/);
  assert.match(customerTrackingRider.innerHTML, /Casco del rider TABA/);
});

test('los lugares operativos distinguen cliente y negocio por semántica, icono y prioridad', () => {
  const documentRef = createFakeDocument();
  const business = createOperationalPlaceMarkerElement(documentRef, {
    kind: 'business',
    label: 'Negocio',
    priority: false,
  });
  const client = createOperationalPlaceMarkerElement(documentRef, {
    kind: 'client',
    label: 'Cliente',
    priority: true,
  });

  assert.match(business.className, /\bis-business\b/);
  assert.match(business.className, /\bis-secondary\b/);
  assert.equal(business.attributes.get('aria-label'), 'Negocio');
  assert.match(business.innerHTML, /rider-place-disc/);
  assert.match(business.innerHTML, /M7 12h18v14H7z/);

  assert.match(client.className, /\bis-client\b/);
  assert.match(client.className, /\bis-primary\b/);
  assert.equal(client.attributes.get('aria-label'), 'Cliente');
  assert.match(client.innerHTML, /circle cx="16" cy="10\.5"/);
  assert.doesNotMatch(client.innerHTML, /helmet|casco/i);
});

test('MapLibre rider monta tres marcadores estables, ajusta bounds una vez y limpia recursos', async () => {
  const environment = createMapLibreEnvironment();
  const controller = createMapLibreTrackingMap(environment.options);
  const rider = {
    lat: -38.9516,
    lng: -68.0591,
    heading: 45,
    source: 'gps',
  };
  const store = { lat: -38.9499, lng: -68.0578, label: 'Negocio' };
  const destination = { lat: -38.9581, lng: -68.0667, label: 'Cliente' };

  assert.equal(controller.mount({
    container: environment.canvas,
    shell: environment.shell,
    fallback: environment.fallback,
    riderLocation: rider,
    store,
    destination,
    priority: 'client',
    role: 'rider',
    freshness: 'fresh',
    status: 'on_the_way',
  }), true);

  environment.maps[0].emit('load');
  await nextTask();

  assert.equal(environment.maps.length, 1);
  assert.equal(environment.markers.length, 3);
  assert.match(environment.markers[0].element.className, /\brider-self-marker\b/);
  assert.doesNotMatch(environment.markers[0].element.innerHTML, /helmet|casco/i);
  assert.match(environment.markers[1].element.className, /\bis-business\b/);
  assert.match(environment.markers[2].element.className, /\bis-client\b/);
  assert.equal(environment.fitBounds.length, 1);
  assert.deepEqual(environment.fitBounds[0].options.padding, {
    top: 70,
    left: 45,
    right: 45,
    bottom: 220,
  });

  const riderMarker = environment.markers[0];
  const businessMarker = environment.markers[1];
  const clientMarker = environment.markers[2];
  const setLngLatBefore = environment.setLngLat.length;

  controller.updateRiderLocation({
    ...rider,
    lat: -38.952,
    lng: -68.0598,
    heading: 90,
  }, {
    freshness: 'fresh',
    status: 'on_the_way',
    source: 'gps',
    animate: false,
  });
  controller.updatePlaces({
    store: { ...store, lat: -38.9498 },
    destination: { ...destination, lat: -38.9583 },
    priority: 'client',
  });

  assert.equal(environment.maps.length, 1);
  assert.equal(environment.markers.length, 3);
  assert.strictEqual(environment.markers[0], riderMarker);
  assert.strictEqual(environment.markers[1], businessMarker);
  assert.strictEqual(environment.markers[2], clientMarker);
  assert.ok(environment.setLngLat.length >= setLngLatBefore + 3);
  assert.equal(environment.fitBounds.length, 1, 'el GPS no vuelve a ejecutar fitBounds');

  assert.equal(controller.recenter({ animate: false }), true);
  assert.deepEqual(environment.jumpTo.at(-1), {
    center: [-68.0598, -38.952],
    zoom: 16,
  });
  assert.equal(controller.getLifecycleState().initialBoundsFitted, true);

  controller.destroy();
  assert.equal(environment.mapRemove, 1);
  assert.equal(environment.markerRemove, 3);
  assert.equal(environment.observerDisconnect, 1);
  assert.equal(environment.maps[0].listenerCount(), 0);
  assert.equal(environment.canvas.listenerCount(), 0);
  assert.equal(environment.documentRef.listenerCount(), 0);
});

test('el mapa rider sigue operativo sin GPS y omite sólo los puntos ausentes', async () => {
  const environment = createMapLibreEnvironment();
  const controller = createMapLibreTrackingMap(environment.options);
  const store = { lat: -38.9499, lng: -68.0578, label: 'Negocio' };
  const destination = { lat: -38.9581, lng: -68.0667, label: 'Cliente' };

  assert.equal(controller.mount({
    container: environment.canvas,
    shell: environment.shell,
    fallback: environment.fallback,
    riderLocation: null,
    store,
    destination,
    priority: 'business',
    role: 'rider',
    freshness: 'none',
  }), true);
  environment.maps[0].emit('load');
  await nextTask();

  assert.equal(environment.markers.length, 2);
  assert.match(environment.markers[0].element.className, /\bis-business\b/);
  assert.match(environment.markers[1].element.className, /\bis-client\b/);
  assert.equal(controller.getLifecycleState().hasRiderMarker, false);
  assert.equal(controller.getLifecycleState().hasStoreMarker, true);
  assert.equal(controller.getLifecycleState().hasDestinationMarker, true);
  assert.equal(environment.fitBounds.length, 1);
  assert.equal(controller.recenter({ animate: false }), false);

  controller.updatePlaces({
    store: null,
    destination,
    priority: 'client',
  });
  assert.equal(controller.getLifecycleState().hasStoreMarker, false);
  assert.equal(controller.getLifecycleState().hasDestinationMarker, true);

  controller.destroy();
});

test('el primer fix GPS tardío entra en cámara una sola vez si el rider no movió el mapa', async () => {
  const environment = createMapLibreEnvironment();
  const controller = createMapLibreTrackingMap(environment.options);
  const store = { lat: -38.9499, lng: -68.0578, label: 'Negocio' };
  const destination = { lat: -38.9581, lng: -68.0667, label: 'Cliente' };

  controller.mount({
    container: environment.canvas,
    shell: environment.shell,
    fallback: environment.fallback,
    riderLocation: null,
    store,
    destination,
    role: 'rider',
    freshness: 'none',
  });
  environment.maps[0].emit('load');
  await nextTask();
  assert.equal(environment.fitBounds.length, 1, 'primero encuadra los dos lugares conocidos');

  controller.updateRiderLocation({
    lat: -38.9701,
    lng: -68.0791,
    source: 'gps',
  }, {
    freshness: 'fresh',
    status: 'on_the_way',
    source: 'gps',
    animate: false,
  });
  assert.equal(environment.fitBounds.length, 2, 'incluye el primer fix cuando llega después');
  assert.deepEqual(environment.fitBounds[1].bounds, [
    [-68.0791, -38.9701],
    [-68.0578, -38.9499],
  ]);

  controller.updateRiderLocation({
    lat: -38.971,
    lng: -68.08,
    source: 'gps',
  }, {
    freshness: 'fresh',
    status: 'on_the_way',
    source: 'gps',
    animate: false,
  });
  assert.equal(environment.fitBounds.length, 2, 'no reencuadra en actualizaciones posteriores');
  controller.destroy();
});

test('un mapa sin puntos iniciales puede montar cuando llega el primer fix GPS', async () => {
  const environment = createMapLibreEnvironment();
  const controller = createMapLibreTrackingMap(environment.options);

  assert.equal(controller.mount({
    container: environment.canvas,
    shell: environment.shell,
    fallback: environment.fallback,
    role: 'rider',
  }), false);
  assert.equal(controller.getLifecycleState().unavailable, false);
  assert.equal(controller.getLifecycleState().failureReason, 'missing-location');
  assert.equal(environment.shell.dataset.mapStatus, 'waiting-location');
  assert.equal(environment.maps.length, 0);

  assert.equal(controller.mount({
    container: environment.canvas,
    shell: environment.shell,
    fallback: environment.fallback,
    role: 'rider',
    riderLocation: {
      lat: -38.9516,
      lng: -68.0591,
      source: 'gps',
    },
    freshness: 'fresh',
  }), true);
  environment.maps[0].emit('load');
  await nextTask();

  assert.equal(environment.maps.length, 1);
  assert.equal(environment.markers.length, 1);
  assert.match(environment.markers[0].element.className, /\brider-self-marker\b/);
  assert.equal(controller.getLifecycleState().failureReason, null);
  controller.destroy();
});

test('el tracking del cliente conserva el casco y no adopta los marcadores del rider operativo', async () => {
  const environment = createMapLibreEnvironment();
  const controller = createMapLibreTrackingMap(environment.options);

  controller.mount({
    container: environment.canvas,
    shell: environment.shell,
    fallback: environment.fallback,
    riderLocation: {
      lat: -38.9516,
      lng: -68.0591,
      source: 'gps',
    },
    store: { lat: -38.9499, lng: -68.0578 },
    destination: { lat: -38.9581, lng: -68.0667 },
    role: 'tracking',
    freshness: 'fresh',
    status: 'on_the_way',
  });
  environment.maps[0].emit('load');
  await nextTask();

  assert.equal(environment.markers.length, 1);
  assert.match(environment.markers[0].element.className, /\blt-rider-marker\b/);
  assert.match(environment.markers[0].element.innerHTML, /lt-rider-helmet-icon/);
  assert.doesNotMatch(environment.markers[0].element.className, /\brider-self-marker\b/);
  assert.equal(controller.getLifecycleState().hasStoreMarker, false);
  assert.equal(controller.getLifecycleState().hasDestinationMarker, false);

  controller.destroy();
});

function createMapLibreEnvironment() {
  const documentRef = createFakeDocument();
  const root = createEventTarget();
  root.matchMedia = () => ({ matches: false });
  root.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
  root.cancelAnimationFrame = clearTimeout;
  root.setTimeout = setTimeout;
  root.clearTimeout = clearTimeout;

  const canvas = createEventTarget();
  canvas.ownerDocument = documentRef;
  canvas.dataset = {};
  canvas.classList = createClassList();
  canvas.setAttribute = () => {};
  canvas.removeAttribute = () => {};
  canvas.querySelector = () => null;

  const fallback = {
    hidden: false,
    setAttribute(name) {
      if (name === 'hidden') this.hidden = true;
    },
    removeAttribute(name) {
      if (name === 'hidden') this.hidden = false;
    },
    querySelector() {
      return { textContent: '' };
    },
  };
  const shell = {
    dataset: {},
    classList: createClassList(),
    querySelector(selector) {
      if (selector === '[data-map-fallback]') return fallback;
      if (selector === '[data-map-canvas]') return canvas;
      return null;
    },
  };
  canvas.parentElement = shell;

  const environment = {
    documentRef,
    root,
    canvas,
    fallback,
    shell,
    maps: [],
    markers: [],
    setLngLat: [],
    fitBounds: [],
    jumpTo: [],
    easeTo: [],
    mapRemove: 0,
    markerRemove: 0,
    observerDisconnect: 0,
  };

  class FakeMap {
    constructor(options) {
      this.options = options;
      this.listeners = new Map();
      this.canvas = options.container;
      environment.maps.push(this);
    }

    on(type, listener) {
      const bucket = this.listeners.get(type) || new Set();
      bucket.add(listener);
      this.listeners.set(type, bucket);
      return this;
    }

    off(type, listener) {
      this.listeners.get(type)?.delete(listener);
      return this;
    }

    emit(type, event = {}) {
      [...(this.listeners.get(type) || [])].forEach((listener) => listener(event));
    }

    listenerCount() {
      return [...this.listeners.values()].reduce((total, bucket) => total + bucket.size, 0);
    }

    addControl() {
      return this;
    }

    getSource() {
      return null;
    }

    getLayer() {
      return null;
    }

    getCanvas() {
      return this.canvas;
    }

    getBounds() {
      return { contains: () => true };
    }

    fitBounds(bounds, options) {
      environment.fitBounds.push({ bounds, options });
    }

    jumpTo(options) {
      environment.jumpTo.push(options);
    }

    easeTo(options) {
      environment.easeTo.push(options);
    }

    resize() {}

    remove() {
      environment.mapRemove += 1;
    }

    dragRotate = { disable() {} };

    touchPitch = { disable() {} };
  }

  class FakeMarker {
    constructor(options = {}) {
      this.options = options;
      this.element = options.element;
      environment.markers.push(this);
    }

    setLngLat(coordinate) {
      this.coordinate = [...coordinate];
      environment.setLngLat.push([...coordinate]);
      return this;
    }

    addTo(map) {
      this.map = map;
      return this;
    }

    getElement() {
      return this.element;
    }

    remove() {
      environment.markerRemove += 1;
    }
  }

  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback;
    }

    observe() {}

    disconnect() {
      environment.observerDisconnect += 1;
    }
  }

  environment.options = {
    root,
    documentRef,
    maplibregl: {
      Map: FakeMap,
      Marker: FakeMarker,
      AttributionControl: class {},
    },
    ResizeObserverClass: FakeResizeObserver,
    webglSupported: () => true,
  };
  return environment;
}

function createFakeDocument() {
  const documentRef = createEventTarget();
  documentRef.hidden = false;
  documentRef.createElement = (tagName) => {
    const element = createEventTarget();
    element.tagName = String(tagName || '').toUpperCase();
    element.dataset = {};
    element.className = '';
    element.innerHTML = '';
    element.attributes = new Map();
    element.classList = createClassList();
    element.style = {
      values: new Map(),
      setProperty(name, value) {
        this.values.set(name, value);
      },
      removeProperty(name) {
        this.values.delete(name);
      },
    };
    element.setAttribute = (name, value) => {
      element.attributes.set(name, String(value));
    };
    element.removeAttribute = (name) => {
      element.attributes.delete(name);
    };
    element.querySelector = () => null;
    return element;
  };
  return documentRef;
}

function createClassList() {
  const classes = new Set();
  return {
    add(...values) {
      values.forEach((value) => classes.add(value));
    },
    remove(...values) {
      values.forEach((value) => classes.delete(value));
    },
    toggle(value, force) {
      if (force) classes.add(value);
      else classes.delete(value);
    },
    contains(value) {
      return classes.has(value);
    },
  };
}

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      const bucket = listeners.get(type) || new Set();
      bucket.add(listener);
      listeners.set(type, bucket);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(type, event = {}) {
      [...(listeners.get(type) || [])].forEach((listener) => listener(event));
    },
    listenerCount() {
      return [...listeners.values()].reduce((total, bucket) => total + bucket.size, 0);
    },
  };
}

function nextTask() {
  return new Promise((resolve) => setTimeout(resolve, 5));
}
