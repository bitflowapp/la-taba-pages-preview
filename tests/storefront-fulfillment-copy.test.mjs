/*
 * LO QUE LA TIENDA DICE TIENE QUE SALIR DE LO QUE EL COMERCIO HACE.
 *
 * Tres frases del storefront hablaban siempre como si el comercio hiciera
 * envíos y como si la persona supiera dónde queda el local:
 *
 *   · el bloque de retiro decía «te esperamos en el mostrador» sin decir qué
 *     mostrador: ni dirección, ni horario, ni cómo llegar;
 *   · una tienda que sólo hace retiro mostraba arriba «ENVIAR A · Elegí tu
 *     dirección», en el rojo de advertencia;
 *   · el seguimiento vacío prometía «el recorrido del Rider» también donde no
 *     hay ningún recorrido.
 *
 * Las tres leen la MISMA configuración que decide qué modalidades ofrece el
 * checkout, y las tres callan lo que el comercio no publicó.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDefaultBusinessConfig, setRuntimeBusinessConfig } from '../js/core/business-config-store.js';
import { mapsSearchUrl } from '../js/core/business-location.js';
import { pickupPoint, renderPickupPoint } from '../js/customer-delivery.js';
import { applyBusinessConfig, trackingIdleLead } from '../js/ui.js';

const base = buildDefaultBusinessConfig();

// La configuración con la que arranca la tienda real antes de que el comercio
// publique nada (`buildBaseBusinessConfig`, state.js).
const SIN_PUBLICAR = {
  ...base,
  address: 'Dirección no publicada',
  openingHoursLabel: 'Horarios no publicados',
  openingHours: 'Horarios no publicados',
  businessLocationVerified: false,
};

// ── Dónde se retira ─────────────────────────────────────────────────────────

test('el retiro nombra la dirección, el horario y el enlace a Maps cuando el comercio los publicó', () => {
  const punto = { lat: -38.9460616, lng: -68.0533209 };
  const config = {
    ...base,
    address: 'Mendoza 827, Neuquén',
    openingHoursLabel: 'Todos los días de 10 a 23 h',
    businessLocationVerified: true,
    businessLocation: { ...base.businessLocation, ...punto },
  };
  const retiro = pickupPoint(config);
  assert.equal(retiro.address, 'Mendoza 827, Neuquén');
  assert.equal(retiro.hours, 'Todos los días de 10 a 23 h');
  // Por coordenadas, nunca por texto: «Mendoza 827» a secas resuelve en Zapala.
  assert.equal(retiro.mapsUrl, mapsSearchUrl(punto.lat, punto.lng));
  assert.doesNotMatch(retiro.mapsUrl, /Mendoza/);

  const html = renderPickupPoint(config);
  assert.match(html, /data-pickup-address>Mendoza 827, Neuquén</);
  assert.match(html, /data-pickup-hours>Todos los días de 10 a 23 h</);
  assert.match(html, /data-pickup-maps href="https:\/\/www\.google\.com\/maps\//);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
});

test('lo que el comercio no publicó no se muestra: ni el relleno ni un enlace sin verificar', () => {
  const retiro = pickupPoint(SIN_PUBLICAR);
  assert.deepEqual(retiro, { address: '', hours: '', mapsUrl: '' });
  assert.equal(renderPickupPoint(SIN_PUBLICAR), '');

  // Con la dirección publicada y el punto SIN verificar: dirección sí, enlace no.
  const conDireccion = { ...SIN_PUBLICAR, address: 'Mendoza 827, Neuquén' };
  assert.equal(pickupPoint(conDireccion).mapsUrl, '');
  assert.doesNotMatch(renderPickupPoint(conDireccion), /data-pickup-maps/);
  assert.doesNotMatch(renderPickupPoint(conDireccion), /data-pickup-hours/);

  // «A confirmar» es el relleno de la semilla de demostración, tampoco es dato.
  assert.equal(pickupPoint({ ...base, openingHoursLabel: 'Horarios a confirmar con el local' }).hours, '');
});

test('la dirección del comercio se escapa: es un dato editable', () => {
  const html = renderPickupPoint({ ...SIN_PUBLICAR, address: 'Local <b>2</b> & "Fondo"' });
  assert.match(html, /Local &lt;b&gt;2&lt;\/b&gt; &amp; &quot;Fondo&quot;/);
  assert.doesNotMatch(html, /<b>2<\/b>/);
});

// ── El encabezado de una tienda sólo de retiro ──────────────────────────────

function documentoConEncabezado() {
  const chip = { hidden: false };
  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: (selector) => (selector === '[data-home-address]' ? [chip] : []),
  };
  return chip;
}

test('una tienda verificada que sólo hace retiro no pide dirección en el encabezado', () => {
  const chip = documentoConEncabezado();
  try {
    setRuntimeBusinessConfig({ ...base, orderingDetailsVerified: true, deliveryEnabled: false, pickupEnabled: true });
    applyBusinessConfig();
    assert.equal(chip.hidden, true, 'sin envío, «ENVIAR A» no tiene nada que pedir');

    setRuntimeBusinessConfig({ ...base, orderingDetailsVerified: true, deliveryEnabled: true, pickupEnabled: true });
    applyBusinessConfig();
    assert.equal(chip.hidden, false, 'con envío, el control vuelve');
  } finally {
    setRuntimeBusinessConfig(base);
    delete globalThis.document;
  }
});

test('mientras el comercio no confirmó sus modalidades, el encabezado no afirma nada nuevo', () => {
  const chip = documentoConEncabezado();
  try {
    setRuntimeBusinessConfig({ ...base, orderingDetailsVerified: false, deliveryEnabled: false, pickupEnabled: false });
    applyBusinessConfig();
    assert.equal(chip.hidden, false);
  } finally {
    setRuntimeBusinessConfig(base);
    delete globalThis.document;
  }
});

// ── El seguimiento sin pedido ───────────────────────────────────────────────

test('el seguimiento vacío promete el Rider sólo donde hay envío', () => {
  const verificada = { ...base, orderingDetailsVerified: true };
  const soloRetiro = trackingIdleLead({ ...verificada, deliveryEnabled: false, pickupEnabled: true }, false);
  assert.doesNotMatch(soloRetiro, /Rider|recorrido/);
  assert.match(soloRetiro, /retirar/);

  assert.match(trackingIdleLead({ ...verificada, deliveryEnabled: true, pickupEnabled: false }, false), /recorrido del Rider/);

  const ambas = trackingIdleLead({ ...verificada, deliveryEnabled: true, pickupEnabled: true }, false);
  assert.match(ambas, /si es con envío/);

  // Sin configuración confirmada no se promete ninguna de las dos cosas.
  const sinConfirmar = trackingIdleLead({ ...base, orderingDetailsVerified: false, deliveryEnabled: true }, false);
  assert.doesNotMatch(sinConfirmar, /Rider|retirar/);

  // La demostración ofrece las dos modalidades.
  assert.match(trackingIdleLead(SIN_PUBLICAR, true), /si es con envío/);
});
