import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { normalizeCustomerAddress } from '../js/core/customer-addresses.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profileView = fs.readFileSync(path.join(root, 'js', 'customer-profile-view.js'), 'utf8');
const profileCss = fs.readFileSync(path.join(root, 'styles', 'profile.css'), 'utf8');

// Estas pruebas existen por un defecto medido, no por simetría.
//
// El editor de direcciones guardaba `source: 'manual'` fijo y nunca mandaba
// latitud ni longitud. El resto de la cadena SÍ estaba listo: el normalizador
// acepta coordenadas, `upsert_current_customer_address` las valida y el
// contrato del mapa del Rider fotografía la ubicación al crear el pedido. Con
// el editor mudo, toda dirección nacía sin coordenadas y la app del Rider
// mostraba —con razón— «No hay coordenadas autorizadas»: no había punto que
// mostrar. Lo que sigue es el cable que faltaba.

test('el editor de direcciones ofrece capturar la ubicación', () => {
  assert.match(
    profileView,
    /data-profile-action="use-location"/,
    'el editor tiene que ofrecer el control para capturar la ubicación',
  );
  assert.match(
    profileView,
    /renderLocationCapture\(\)/,
    'el bloque de ubicación tiene que estar realmente renderizado, no sólo definido',
  );
  // El defecto original era exactamente este: una función de render viva en el
  // archivo pero jamás invocada. Se exige que la invocación exista dentro del
  // editor, no en cualquier lado.
  const editor = profileView.slice(
    profileView.indexOf('function renderAddressEditor()'),
    profileView.indexOf('function renderDuplicate()'),
  );
  assert.ok(editor.length > 0, 'no encontré el editor de direcciones');
  assert.match(editor, /renderLocationCapture\(\)/);
});

test('la ubicación sólo viaja después de una confirmación explícita', () => {
  assert.match(profileView, /data-profile-action="confirm-location"/);
  assert.match(profileView, /data-profile-action="discard-location"/);
  // `pendingLocation` es lo que devolvió el dispositivo; `confirmedLocation` es
  // lo único que se guarda. Si el guardado leyera el pendiente, una ubicación
  // que la persona todavía no aceptó terminaría en la base.
  const save = profileView.slice(
    profileView.indexOf('async function saveAddress('),
    profileView.indexOf('async function persistAddress('),
  );
  assert.ok(save.length > 0, 'no encontré saveAddress');
  assert.match(save, /state\.confirmedLocation/);
  assert.doesNotMatch(save, /state\.pendingLocation/);
});

test('el guardado ya no clava source manual: lleva las coordenadas confirmadas', () => {
  const save = profileView.slice(
    profileView.indexOf('async function saveAddress('),
    profileView.indexOf('async function persistAddress('),
  );
  assert.match(save, /latitude: location\?\.latitude/);
  assert.match(save, /longitude: location\?\.longitude/);
  assert.match(save, /geolocationAccuracy: location\?\.accuracy/);
  assert.match(save, /source: location\?\.source \|\| 'manual'/);
  // Sin ubicación confirmada el comportamiento anterior se conserva intacto.
  assert.doesNotMatch(save, /source: 'manual',/);
});

test('el borrador de ubicación no sobrevive al guardado ni salta entre direcciones', () => {
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
  for (const action of ['use-location', 'confirm-location', 'discard-location']) {
    const desde = handlers.indexOf(`action === '${action}'`);
    const siguiente = handlers.indexOf('if (action ===', desde + 10);
    const bloque = handlers.slice(desde, siguiente === -1 ? undefined : siguiente);
    assert.match(
      bloque,
      /captureEditorDraft\(\)/,
      `${action} re-dibuja el editor y tiene que preservar lo escrito`,
    );
  }
  // El editor tiene que dibujarse desde el borrador cuando existe.
  const editor = profileView.slice(
    profileView.indexOf('function renderAddressEditor()'),
    profileView.indexOf('function renderDuplicate()'),
  );
  assert.match(editor, /state\.addressDraft \? \{ \.\.\.saved, \.\.\.state\.addressDraft \} : saved/);
  // Y no puede sobrevivir a cerrar o guardar.
  assert.match(profileView, /state\.addressDraft = null;/);
});

test('el normalizador conserva la ubicación confirmada y marca el origen', () => {
  const normalized = normalizeCustomerAddress({
    label: 'Casa',
    street: 'Avenida Argentina',
    streetNumber: '450',
    city: 'Neuquén',
    province: 'Neuquén',
    latitude: -38.9516,
    longitude: -68.0591,
    geolocationAccuracy: 12.5,
    source: 'gps',
  });
  assert.equal(normalized.latitude, -38.9516);
  assert.equal(normalized.longitude, -68.0591);
  assert.equal(normalized.geolocationAccuracy, 12.5);
  assert.equal(normalized.source, 'gps');

  // Sin coordenadas la dirección sigue siendo manual, que es el estado válido
  // para quien no quiere compartir su ubicación.
  const sinUbicacion = normalizeCustomerAddress({
    label: 'Casa', street: 'Avenida Argentina', streetNumber: '450',
    city: 'Neuquén', province: 'Neuquén', source: 'manual',
  });
  assert.equal(sinUbicacion.latitude, null);
  assert.equal(sinUbicacion.longitude, null);
  assert.equal(sinUbicacion.source, 'manual');
});

test('el bloque de ubicación tiene estilo propio en los tres estados', () => {
  for (const selector of ['.profile-location', '.profile-location.is-pending', '.profile-location.is-confirmed']) {
    assert.ok(profileCss.includes(selector), `falta la regla ${selector}`);
  }
});
