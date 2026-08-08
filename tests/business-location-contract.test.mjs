import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  BUSINESS_LOCATION,
  BUSINESS_POINT,
  DEMO_CUSTOMER_DESTINATION,
  businessGeoUri,
  businessMapsDirectionsUrl,
  businessMapsSearchUrl,
  mapsSearchUrl,
} from '../js/core/business-location.js';
import {
  buildDefaultBusinessConfig,
  getBusinessConfig,
  setRuntimeBusinessConfig,
} from '../js/core/business-config-store.js';
import { SANDBOX_MAP_SCENARIO } from '../js/sandbox/sandbox_map_scenario.js';
import { applyBusinessConfig } from '../js/ui.js';

const contrato = JSON.parse(
  readFileSync(new URL('../data/business-location.json', import.meta.url), 'utf8'),
);

// Distancia en metros. Alcanza con la fórmula del haversine: las magnitudes que
// se comparan acá son de cientos de metros, no de centímetros.
function metros(a, b) {
  const R = 6371008.8;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

test('el contrato central declara los diez campos y el JSON dice lo mismo', () => {
  for (const campo of [
    'business_id', 'name', 'address', 'latitude', 'longitude',
    'source', 'confidence', 'verified_at', 'human_verified', 'accuracy_meters',
  ]) {
    assert.ok(BUSINESS_LOCATION[campo] !== undefined, `falta ${campo}`);
    assert.equal(BUSINESS_LOCATION[campo], contrato[campo], `${campo} difiere del JSON`);
  }
  assert.equal(BUSINESS_LOCATION.name, 'La Taba 2');
  assert.equal(BUSINESS_LOCATION.address, 'Mendoza 827, Neuquén');
});

test('human_verified sólo puede ser verdadero con business_verified', () => {
  // Es el mismo CHECK que impone la base. Si alguien sube la afirmación sin
  // subir el origen, esto lo frena antes de que llegue a staging.
  if (BUSINESS_LOCATION.human_verified === true) {
    assert.equal(BUSINESS_LOCATION.source, 'business_verified');
  }
  assert.ok(['low', 'medium', 'high'].includes(BUSINESS_LOCATION.confidence));
  assert.ok(['business_verified', 'public_directory_cross_checked', 'qa_fixture']
    .includes(BUSINESS_LOCATION.source));
});

test('el punto cae en Neuquén Capital y no en ninguno de los descartados', () => {
  const { lat, lng } = BUSINESS_POINT;
  assert.ok(lat > -38.982 && lat < -38.904, 'latitud fuera de Neuquén Capital');
  assert.ok(lng > -68.105 && lng < -67.955, 'longitud fuera de Neuquén Capital');

  // Zapala: es lo que devuelve un geocodificador público para «Mendoza 827» si
  // no se le acota la ciudad. Está a 175 km.
  assert.ok(metros(BUSINESS_POINT, { lat: -38.8929996, lng: -70.0750531 }) > 100_000);
  // El punto viejo del repositorio, junto a Parque Central.
  assert.ok(metros(BUSINESS_POINT, { lat: -38.9516, lng: -68.0591 }) > 700);
  // El propio Parque Central.
  assert.ok(metros(BUSINESS_POINT, { lat: -38.952, lng: -68.061 }) > 700);
});

test('Google Maps se abre por coordenadas y no por el texto de la dirección', () => {
  // Medido sobre el Moto G15 el 2026-08-07: buscar «La Taba 2, Mendoza 827» en
  // Maps abre la vista genérica de Neuquén, sin resultado. Una coordenada no se
  // busca: se abre.
  const par = `${BUSINESS_LOCATION.latitude.toFixed(7)},${BUSINESS_LOCATION.longitude.toFixed(7)}`;
  for (const url of [businessMapsSearchUrl(), businessMapsDirectionsUrl()]) {
    assert.ok(url.includes(encodeURIComponent(par)), `no lleva la coordenada: ${url}`);
    assert.ok(!/Mendoza|827/.test(url), `abre por texto: ${url}`);
    assert.ok(url.startsWith('https://www.google.com/maps/'));
  }
  assert.ok(businessGeoUri().startsWith(`geo:${par}?q=`));
});

test('el escenario demo sale del contrato y su ruta es coherente', () => {
  const { store, destination, route } = SANDBOX_MAP_SCENARIO;
  assert.equal(store.lat, BUSINESS_LOCATION.latitude);
  assert.equal(store.lng, BUSINESS_LOCATION.longitude);
  assert.equal(destination.lat, DEMO_CUSTOMER_DESTINATION.lat);
  assert.equal(destination.lng, DEMO_CUSTOMER_DESTINATION.lng);

  // La ruta empieza en el local y termina en el destino, sin saltos: ningún
  // tramo suelto de más de 600 m, que es lo que delataría una recta inventada
  // por encima de las manzanas.
  assert.equal(route[0].lat, store.lat);
  assert.equal(route.at(-1).lng, destination.lng);
  let largo = 0;
  for (let i = 1; i < route.length; i += 1) {
    const tramo = metros(route[i - 1], route[i]);
    assert.ok(tramo < 600, `tramo ${i} de ${Math.round(tramo)} m: demasiado largo para una calle`);
    largo += tramo;
  }
  // Un reparto de barrio: ni un punto pegado al local ni uno en otra ciudad.
  assert.ok(largo > 700 && largo < 3000, `la ruta demo mide ${Math.round(largo)} m`);

  // El destino del cliente es un espacio público declarado, nunca un domicilio.
  assert.match(contrato.demo.destination_kind, /espacio público/);
  assert.match(destination.label, /Destino demo/);
});

// El enlace «Cómo llegar» de la ficha del comercio era la única superficie de
// esta corrección sin una prueba que la sostuviera, y es justo el patrón que
// causó el problema: código que nadie obliga a coincidir con nada. Se ejercita
// a través de `applyBusinessConfig`, con un documento mínimo: todo lo demás de
// esa función está guardado contra nodos ausentes.
function documentoConFichaDelComercio() {
  const item = { hidden: null };
  const link = {
    attrs: {},
    href: '#',
    setAttribute(nombre, valor) { this.attrs[nombre] = valor; },
    removeAttribute(nombre) {
      if (nombre === 'href') this.href = undefined;
      delete this.attrs[nombre];
    },
  };
  globalThis.document = {
    querySelector(selector) {
      if (selector === '[data-business-maps-item]') return item;
      if (selector === '[data-business-maps-link]') return link;
      return null;
    },
    querySelectorAll() { return []; },
  };
  return { item, link };
}

test('el enlace «Cómo llegar» sigue al punto configurado, y desaparece sin verificación', () => {
  const base = buildDefaultBusinessConfig();
  const { item, link } = documentoConFichaDelComercio();
  try {
    // 1. la semilla del contrato: visible y apuntando al local.
    setRuntimeBusinessConfig(base);
    applyBusinessConfig();
    assert.equal(item.hidden, false);
    assert.equal(link.href, businessMapsSearchUrl());
    assert.match(link.attrs['aria-label'], /La Taba 2/);

    // 2. sin verificar no se ofrece: mandar al cliente a una coordenada que
    //    nadie contrastó es peor que no ofrecer el enlace.
    setRuntimeBusinessConfig({ ...base, businessLocationVerified: false });
    applyBusinessConfig();
    assert.equal(item.hidden, true);
    assert.equal(link.href, undefined);

    // 3. si el comercio movió su punto desde el Panel, manda el suyo. El
    //    contrato es la semilla, no una jaula.
    const propio = { ...base.businessLocation, lat: -38.9455, lng: -68.0521 };
    setRuntimeBusinessConfig({ ...base, businessLocation: propio });
    applyBusinessConfig();
    assert.equal(item.hidden, false);
    assert.equal(link.href, mapsSearchUrl(propio.lat, propio.lng));
    assert.notEqual(link.href, businessMapsSearchUrl());

    // 4. un patch sin coordenada conserva la que había. `Number(null)` vale 0,
    //    y 0 es finito: sin descartarlo antes, esto quedaba en 0,0 —el Golfo de
    //    Guinea— y el enlace lo ofrecía como si fuera el local.
    setRuntimeBusinessConfig({ ...base, businessLocation: { lat: null, lng: '' } });
    applyBusinessConfig();
    const conservado = getBusinessConfig().businessLocation;
    assert.equal(conservado.lat, propio.lat);
    assert.equal(conservado.lng, propio.lng);
    assert.notEqual(conservado.lat, 0);
    assert.notEqual(conservado.lng, 0);
    assert.equal(item.hidden, false);
    assert.equal(link.href, mapsSearchUrl(propio.lat, propio.lng));
  } finally {
    delete globalThis.document;
  }
});
