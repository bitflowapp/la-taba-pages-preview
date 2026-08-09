import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { normalizeCustomerAddress } from '../js/core/customer-addresses.js';
import {
  confirmDeliveryLocationDraft,
  draftAfterAddressEdit,
  draftFromSavedAddress,
  draftToAddressFields,
  draftWithLocationResult,
  draftWithMapPin,
  emptyDeliveryLocationDraft,
  isDeliveryLocationDraftConfirmed,
} from '../js/core/delivery-location-draft.js';
import { hasConfirmedDeliveryLocation } from '../js/core/delivery-location.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profileView = fs.readFileSync(path.join(root, 'js', 'customer-profile-view.js'), 'utf8');
const locationStep = fs.readFileSync(path.join(root, 'js', 'delivery-location-step.js'), 'utf8');
const profileCss = fs.readFileSync(path.join(root, 'styles', 'profile.css'), 'utf8');

const DIRECCION = Object.freeze({
  street: 'Antártida Argentina',
  streetNumber: '1450',
  city: 'Neuquén',
  province: 'Neuquén',
});

const AHORA = new Date('2026-08-08T18:00:00.000Z');

// Estas pruebas existen por un defecto medido, no por simetría.
//
// El primer pedido humano se creó con modalidad delivery, dirección escrita a
// mano y latitud/longitud NULL. El editor podía capturar la ubicación, pero era
// OPCIONAL: nada obligaba a que existiera un punto, así que el Rider se quedaba
// sin destino y el enlace de Maps dependía de un geocodificador. Lo que sigue
// fija que el punto es obligatorio y que sólo cuenta si la persona lo confirmó.

test('el editor ofrece los dos caminos del contrato y un único acto de confirmación', () => {
  assert.match(locationStep, /Confirmá dónde te entregamos/);
  assert.match(locationStep, /data-profile-action="use-location"/);
  assert.match(locationStep, /data-profile-action="open-location-map"/);
  assert.match(locationStep, /data-profile-action="confirm-location"/);
  assert.match(locationStep, /Confirmar ubicación/);
  // El defecto original era una función de render viva pero jamás invocada. Se
  // exige que el paso esté realmente dentro del editor de direcciones.
  const editor = profileView.slice(
    profileView.indexOf('function renderAddressEditor()'),
    profileView.indexOf('function renderDuplicate()'),
  );
  assert.ok(editor.length > 0, 'no encontré el editor de direcciones');
  assert.match(editor, /renderDeliveryLocationStep\(/);
});

test('el permiso de ubicación se pide sólo después de una acción explícita', () => {
  // Nada puede pedir la ubicación al abrir la pantalla: un permiso pedido de la
  // nada se rechaza, y con razón. La única llamada al servicio vive dentro del
  // manejador del botón.
  const llamadas = [...profileView.matchAll(/requestCurrentLocation\(\)/g)];
  assert.equal(llamadas.length, 1, 'la ubicación se pide en un solo lugar');
  const solicitud = profileView.slice(
    profileView.indexOf('async function requestLocation()'),
    profileView.indexOf('function currentAddressValues()'),
  );
  assert.match(solicitud, /requestCurrentLocation\(\)/);
  assert.doesNotMatch(
    profileView.slice(0, profileView.indexOf('async function requestLocation()')),
    /requestCurrentLocation\(\)/,
  );
});

test('recibir la ubicación del dispositivo no la confirma', () => {
  let draft = emptyDeliveryLocationDraft();
  draft = draftWithLocationResult(draft, {
    ok: true,
    location: { latitude: -38.9539, longitude: -68.0596, accuracy: 12 },
  });
  assert.equal(draft.status, 'pending');
  assert.equal(draft.method, 'gps');
  assert.equal(isDeliveryLocationDraftConfirmed(draft), false);
  // Y sin confirmar no viaja nada a la dirección.
  assert.deepEqual(draftToAddressFields(draft), {
    latitude: null,
    longitude: null,
    geolocationAccuracy: null,
    locationSource: '',
    locationConfirmedAt: '',
    locationConfirmedAddress: '',
  });
});

test('permiso rechazado deja el camino del mapa abierto y lo explica', () => {
  let draft = emptyDeliveryLocationDraft();
  draft = draftWithLocationResult(draft, {
    ok: false,
    code: 'GPS_PERMISSION_DENIED',
    message: 'No autorizaste la ubicación. Podés completar la dirección manualmente.',
  });
  assert.equal(draft.status, 'empty');
  assert.equal(draft.mapOpen, true, 'el mapa queda disponible para marcar el pin a mano');
  assert.match(draft.error, /No autorizaste la ubicación/);

  // Y con el pin manual se puede confirmar igual, sin compartir GPS.
  draft = draftWithMapPin(draft, { latitude: -38.9540, longitude: -68.0590 });
  assert.equal(draft.method, 'map_pin');
  draft = confirmDeliveryLocationDraft(draft, { address: DIRECCION, now: AHORA });
  assert.equal(isDeliveryLocationDraftConfirmed(draft), true);
  assert.equal(draftToAddressFields(draft).locationSource, 'map_pin');
});

test('mover el pin descarta la precisión del GPS, que describía otra medición', () => {
  let draft = draftWithLocationResult(emptyDeliveryLocationDraft(), {
    ok: true,
    location: { latitude: -38.9539, longitude: -68.0596, accuracy: 12 },
  });
  assert.equal(draft.point.accuracyMeters, 12);
  draft = draftWithMapPin(draft, { latitude: -38.9541, longitude: -68.0593 });
  assert.equal(draft.point.accuracyMeters, null);
  assert.equal(draft.method, 'map_pin');
});

test('confirmar sella coordenadas, origen, momento y huella del texto', () => {
  let draft = draftWithLocationResult(emptyDeliveryLocationDraft(), {
    ok: true,
    location: { latitude: -38.9539, longitude: -68.0596, accuracy: 12 },
  });
  draft = confirmDeliveryLocationDraft(draft, { address: DIRECCION, now: AHORA });
  const fields = draftToAddressFields(draft);
  assert.equal(fields.latitude, -38.9539);
  assert.equal(fields.longitude, -68.0596);
  assert.equal(fields.geolocationAccuracy, 12);
  assert.equal(fields.locationSource, 'gps');
  assert.equal(fields.locationConfirmedAt, '2026-08-08T18:00:00.000Z');
  assert.equal(fields.locationConfirmedAddress, 'antartida argentina 1450 neuquen neuquen');
});

test('editar una dirección YA GUARDADA invalida su confirmación hasta reconfirmar', () => {
  // La confirmación viene de una dirección guardada: ese pin ya estaba atado a
  // un texto. Cambiar la calle tiene que obligar a volver a confirmarlo, o el
  // punto de «Mendoza 850» viajaría callado como destino de otra dirección.
  const guardada = {
    ...DIRECCION,
    latitude: -38.9539,
    longitude: -68.0596,
    geolocationAccuracy: 12,
    locationSource: 'gps',
    locationConfirmedAt: AHORA.toISOString(),
    locationConfirmedAddress: 'antartida argentina 1450 neuquen neuquen',
  };
  const draft = draftFromSavedAddress(guardada);
  assert.equal(draft.origin, 'saved');
  assert.equal(isDeliveryLocationDraftConfirmed(draft), true);

  // Piso y departamento nombran una unidad del mismo edificio: no mueven el pin.
  const mismoPunto = draftAfterAddressEdit(draft, { ...DIRECCION, floor: '3', apartment: 'B' });
  assert.equal(isDeliveryLocationDraftConfirmed(mismoPunto), true);

  // La calle sí.
  const otroPunto = draftAfterAddressEdit(draft, { ...DIRECCION, streetNumber: '2600' });
  assert.equal(isDeliveryLocationDraftConfirmed(otroPunto), false);
  assert.equal(otroPunto.status, 'pending');
  assert.ok(otroPunto.point, 'el pin se conserva: sólo hay que volver a confirmarlo');
  assert.match(otroPunto.notice, /volvé a confirmar/i);
});

// ── REGRESIÓN DEL FALLO HUMANO ───────────────────────────────────────────────
// La primera compra humana quedó bloqueada acá. El paso de ubicación está
// DEBAJO de los campos, así que la persona marcó el pin y después terminó de
// escribir la dirección; cada tecla posterior tiraba abajo la confirmación
// recién hecha y no podía guardar nunca. Reproducido en la URL pública con tres
// órdenes distintos, dos de ellos fallando en silencio.
test('confirmar el pin y DESPUÉS terminar de escribir la dirección no lo invalida', () => {
  // Se confirma con el formulario todavía vacío, que es lo que pasa cuando
  // alguien ve el botón antes de terminar de tipear.
  let draft = draftWithLocationResult(emptyDeliveryLocationDraft(), {
    ok: true,
    location: { latitude: -38.9539, longitude: -68.0596, accuracy: 12 },
  });
  draft = confirmDeliveryLocationDraft(draft, { address: {}, now: AHORA });
  assert.equal(draft.origin, 'fresh');
  assert.equal(isDeliveryLocationDraftConfirmed(draft), true);

  // Y ahora se escribe la dirección, campo por campo, como una persona.
  for (const parcial of [
    { street: 'Antártida Argentina' },
    { street: 'Antártida Argentina', streetNumber: '1450' },
    { street: 'Antártida Argentina', streetNumber: '1450', city: 'Neuquén' },
    { street: 'Antártida Argentina', streetNumber: '1450', city: 'Neuquén', province: 'Neuquén' },
  ]) {
    draft = draftAfterAddressEdit(draft, parcial);
    assert.equal(
      isDeliveryLocationDraftConfirmed(draft),
      true,
      `escribir ${JSON.stringify(parcial)} no puede tirar abajo un pin recién confirmado`,
    );
  }

  // Y la huella que se persiste es la del texto FINAL, no la del formulario
  // vacío que había cuando se tocó el botón.
  const campos = draftToAddressFields(draft, DIRECCION);
  assert.equal(campos.locationConfirmedAddress, 'antartida argentina 1450 neuquen neuquen');
  assert.equal(campos.locationSource, 'gps');
  assert.equal(campos.latitude, -38.9539);
});

test('retocar un campo después de confirmar tampoco bloquea el guardado', () => {
  let draft = draftWithLocationResult(emptyDeliveryLocationDraft(), {
    ok: true,
    location: { latitude: -38.9539, longitude: -68.0596, accuracy: 12 },
  });
  draft = confirmDeliveryLocationDraft(draft, { address: DIRECCION, now: AHORA });
  const retocada = { ...DIRECCION, province: 'Neuquén Capital' };
  draft = draftAfterAddressEdit(draft, retocada);
  assert.equal(isDeliveryLocationDraftConfirmed(draft), true);
  assert.equal(
    draftToAddressFields(draft, retocada).locationConfirmedAddress,
    'antartida argentina 1450 neuquen neuquen capital',
  );
});

test('el guardado exige la confirmación y persiste el contrato completo', () => {
  const save = profileView.slice(
    profileView.indexOf('async function saveAddress('),
    profileView.indexOf('async function persistAddress('),
  );
  assert.ok(save.length > 0, 'no encontré saveAddress');
  assert.match(save, /draftAfterAddressEdit\(/, 'antes de guardar se revisa si el texto cambió');
  assert.match(save, /isDeliveryLocationDraftConfirmed\(state\.locationDraft\)/);
  assert.match(save, /DELIVERY_LOCATION_REQUIRED_MESSAGE/);
  // La huella se sella con el texto que se guarda, no con el que había al
  // tocar «Confirmar ubicación».
  assert.match(save, /\.\.\.draftToAddressFields\(state\.locationDraft, written\)/);
});

test('el borrador no sobrevive al guardado ni salta entre direcciones', () => {
  const persist = profileView.slice(profileView.indexOf('async function persistAddress('));
  assert.match(
    persist.slice(0, persist.indexOf('\n}\n')),
    /resetLocationDraft\(\)/,
    'tras guardar hay que limpiar el borrador o la próxima dirección hereda la ubicación anterior',
  );
  assert.match(profileView, /hydrateLocationDraft\(findAddress\(addressId\)\)/);
});

test('pedir la ubicación no borra lo que la persona ya escribió', () => {
  // Medido en el navegador contra el sitio publicado: al confirmar la ubicación
  // el editor se volvía a dibujar desde el estado y ciudad y provincia quedaban
  // vacías, porque lo tipeado vivía sólo en el DOM. El borrador lo sostiene.
  assert.match(profileView, /function captureEditorDraft\(\)/);
  const handlers = profileView.slice(
    profileView.indexOf("if (action === 'use-location')"),
    profileView.indexOf("if (action === 'make-default')"),
  );
  assert.ok(handlers.length > 0, 'no encontré los manejadores de ubicación');
  for (const action of ['use-location', 'open-location-map', 'nudge-location', 'confirm-location', 'discard-location']) {
    const desde = handlers.indexOf(`action === '${action}'`);
    assert.ok(desde >= 0, `falta el manejador de ${action}`);
    const siguiente = handlers.indexOf('if (action ===', desde + 10);
    const bloque = handlers.slice(desde, siguiente === -1 ? undefined : siguiente);
    assert.match(
      bloque,
      /captureEditorDraft\(\)/,
      `${action} re-dibuja el editor y tiene que preservar lo escrito`,
    );
  }
  const editor = profileView.slice(
    profileView.indexOf('function renderAddressEditor()'),
    profileView.indexOf('function renderDuplicate()'),
  );
  assert.match(editor, /state\.addressDraft \? \{ \.\.\.saved, \.\.\.state\.addressDraft \} : saved/);
  assert.match(profileView, /state\.addressDraft = null;/);
});

test('una dirección guardada y confirmada se reutiliza sin rehacer el paso', () => {
  const guardada = normalizeCustomerAddress({
    ...DIRECCION,
    label: 'Casa',
    latitude: -38.9539,
    longitude: -68.0596,
    geolocationAccuracy: 12,
    locationSource: 'gps',
    locationConfirmedAt: AHORA.toISOString(),
    locationConfirmedAddress: 'antartida argentina 1450 neuquen neuquen',
  });
  assert.equal(hasConfirmedDeliveryLocation(guardada), true);
  const draft = draftFromSavedAddress(guardada);
  assert.equal(isDeliveryLocationDraftConfirmed(draft), true);
  assert.equal(draft.method, 'gps');
});

test('una dirección vieja con coordenadas pero sin confirmación NO cuenta como confirmada', () => {
  // Es exactamente el estado en que quedaron las direcciones anteriores al
  // contrato: hay un punto, pero nadie lo confirmó nunca.
  const vieja = normalizeCustomerAddress({
    ...DIRECCION,
    label: 'Casa',
    latitude: -38.9539,
    longitude: -68.0596,
    source: 'gps',
  });
  assert.equal(hasConfirmedDeliveryLocation(vieja), false);
  const draft = draftFromSavedAddress(vieja);
  assert.equal(draft.status, 'pending', 'el pin viejo sirve de punto de partida');
  assert.equal(isDeliveryLocationDraftConfirmed(draft), false);
});

test('el normalizador conserva la ubicación confirmada y proyecta el origen histórico', () => {
  const normalized = normalizeCustomerAddress({
    label: 'Casa',
    street: 'Avenida Argentina',
    streetNumber: '450',
    city: 'Neuquén',
    province: 'Neuquén',
    latitude: -38.9516,
    longitude: -68.0591,
    geolocationAccuracy: 12.5,
    locationSource: 'map_pin',
    locationConfirmedAt: AHORA.toISOString(),
  });
  assert.equal(normalized.latitude, -38.9516);
  assert.equal(normalized.longitude, -68.0591);
  assert.equal(normalized.geolocationAccuracy, 12.5);
  assert.equal(normalized.locationSource, 'map_pin');
  // La columna histórica no amplía su vocabulario: `map_pin` se proyecta a
  // `manual` porque un consumidor remoto restringe ese conjunto.
  assert.equal(normalized.source, 'manual');

  const sinUbicacion = normalizeCustomerAddress({
    label: 'Casa', street: 'Avenida Argentina', streetNumber: '450',
    city: 'Neuquén', province: 'Neuquén', source: 'manual',
  });
  assert.equal(sinUbicacion.latitude, null);
  assert.equal(sinUbicacion.longitude, null);
  assert.equal(sinUbicacion.locationSource, '');
  assert.equal(sinUbicacion.source, 'manual');
});

test('el paso de ubicación tiene estilo propio en sus tres estados', () => {
  for (const selector of ['.location-step', '.location-step.is-pending', '.location-step.is-confirmed']) {
    assert.ok(profileCss.includes(selector), `falta la regla ${selector}`);
  }
});
