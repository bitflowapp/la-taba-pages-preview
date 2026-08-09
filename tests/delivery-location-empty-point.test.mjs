// Una dirección SIN punto no puede llegar a la pantalla como un punto en 0,0.
//
// POR QUÉ EXISTE ESTE ARCHIVO
// ---------------------------
// Medido contra el sitio publicado, en WebKit con forma de iPhone: al editar una
// dirección guardada sin ubicación —todas las anteriores a la confirmación
// obligatoria— el paso «Confirmá dónde te entregamos» abría en `pending`
// mostrando «0.000000, 0.000000» y con el botón «Confirmar ubicación» a la
// vista. Tocarlo guardaba ese punto, y el servidor lo aceptaba: latitud 0,
// longitud 0, `location_source='map_pin'`, HTTP 200.
//
// 0,0 es un lugar real, en el Golfo de Guinea, a unos 10.000 km de Neuquén. Un
// pedido con ese destino tiene punto «confirmado» para todo el sistema: el mapa
// del Rider lo dibuja, el seguimiento del cliente lo dibuja, y nada avisa.
//
// La causa es vieja conocida: `Number(null)` vale 0 y 0 es finito, así que el
// guardián `Number.isFinite` dejaba pasar la ausencia. Es el mismo error que
// 459a2dc cerró en la config del comercio; acá era alcanzable desde el producto.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DELIVERY_LOCATION_STATUS,
  confirmDeliveryLocationDraft,
  draftFromSavedAddress,
  draftOpenedOnMap,
  draftWithLocationResult,
  draftWithMapPin,
  isDeliveryLocationDraftConfirmed,
  draftToAddressFields,
} from '../js/core/delivery-location-draft.js';

const DIRECCION = {
  label: 'Casa', street: 'Rioja', streetNumber: '77', city: 'Neuquén', province: 'Neuquén',
};

test('una dirección sin coordenadas abre el paso VACÍO, no con un pin en 0,0', () => {
  for (const ausente of [
    { latitude: null, longitude: null },
    { latitude: undefined, longitude: undefined },
    { latitude: '', longitude: '' },
    { latitude: '   ', longitude: '   ' },
    { latitude: [], longitude: [] },
    { latitude: false, longitude: false },
    { latitude: null, longitude: -68.06 },
    { latitude: -38.95, longitude: null },
  ]) {
    const draft = draftFromSavedAddress({ ...DIRECCION, ...ausente });
    assert.equal(draft.status, DELIVERY_LOCATION_STATUS.EMPTY,
      `con ${JSON.stringify(ausente)} el paso tendría que arrancar vacío`);
    assert.equal(draft.point, null);
  }
});

test('sin punto no hay nada que confirmar, y confirmar no inventa uno', () => {
  const draft = draftFromSavedAddress({ ...DIRECCION, latitude: null, longitude: null });
  const confirmado = confirmDeliveryLocationDraft(draft, { address: DIRECCION });
  assert.equal(isDeliveryLocationDraftConfirmed(confirmado), false);
  const campos = draftToAddressFields(confirmado, DIRECCION);
  assert.equal(campos.latitude, null);
  assert.equal(campos.longitude, null);
  assert.equal(campos.locationSource, '');
});

test('una dirección CON coordenadas sigue abriendo pendiente sobre su pin', () => {
  const draft = draftFromSavedAddress({ ...DIRECCION, latitude: -38.95, longitude: -68.06 });
  assert.equal(draft.status, DELIVERY_LOCATION_STATUS.PENDING);
  assert.deepEqual(draft.point, { latitude: -38.95, longitude: -68.06, accuracyMeters: null });
});

test('el cero explícito sigue siendo un punto válido: se rechaza la ausencia, no el valor', () => {
  const draft = draftFromSavedAddress({ ...DIRECCION, latitude: 0, longitude: 0 });
  assert.equal(draft.status, DELIVERY_LOCATION_STATUS.PENDING);
  assert.deepEqual(draft.point, { latitude: 0, longitude: 0, accuracyMeters: null });
});

test('abrir el mapa sin punto de partida usable no planta un pin en 0,0', () => {
  const vacio = draftFromSavedAddress({ ...DIRECCION, latitude: null, longitude: null });
  for (const partida of [null, undefined, {}, { latitude: null, longitude: null }, { lat: '', lng: '' }]) {
    const draft = draftOpenedOnMap(vacio, partida);
    assert.equal(draft.status, DELIVERY_LOCATION_STATUS.EMPTY);
    assert.equal(draft.point, null);
    assert.equal(draft.mapOpen, true);
  }
});

test('el pin del mapa rechaza la ausencia y lo que se sale del planeta', () => {
  const vacio = draftFromSavedAddress({ ...DIRECCION, latitude: null, longitude: null });
  for (const malo of [{ lat: null, lng: null }, { lat: '', lng: '' }, { lat: 91, lng: 0 }, { lat: 0, lng: 181 }]) {
    assert.equal(draftWithMapPin(vacio, malo).point, null, `${JSON.stringify(malo)} no debería plantar un pin`);
  }
  assert.deepEqual(draftWithMapPin(vacio, { lat: -38.95, lng: -68.06 }).point,
    { latitude: -38.95, longitude: -68.06, accuracyMeters: null });
});

test('una lectura de GPS sin coordenadas es un error, no el Golfo de Guinea', () => {
  const vacio = draftFromSavedAddress({ ...DIRECCION, latitude: null, longitude: null });
  const draft = draftWithLocationResult(vacio, { ok: true, location: { latitude: null, longitude: null } });
  assert.equal(draft.point, null);
  assert.match(draft.error, /no es v[áa]lida/i);
});
