import assert from 'node:assert/strict';
import test from 'node:test';
import { BUSINESS_CONFIG } from '../js/config.js';
import { BUSINESS_LOCATION } from '../js/core/business-location.js';

test('BUSINESS_CONFIG exposes the expected business settings', () => {
  // Nombre del COMERCIO, y desde el lanzamiento comercial también el del
  // producto: la tienda se llama «La Taba» en la pestaña, en el manifiesto y en
  // la pantalla. «La Taba 2» era una marca con número de versión, y era lo
  // único legible durante los primeros segundos de la primera visita.
  // El nombre de DIRECTORIO PÚBLICO sigue siendo «La Taba 2» y vive aparte, en
  // el contrato de ubicación: es con lo que Maps encuentra el local.
  assert.equal(BUSINESS_CONFIG.businessName, 'La Taba');
  assert.equal(BUSINESS_CONFIG.name, 'La Taba');
  assert.equal(BUSINESS_CONFIG.subtitle, 'Tienda de bebidas');
  assert.equal(BUSINESS_CONFIG.address, 'Mendoza 827, Neuquén');
  // La coordenada ya está contrastada (ficha de Google Maps + numeración
  // catastral de OSM + Plus Code), así que el mapa del cliente SÍ plotea el
  // marcador del local. No sale de acá: viene del contrato central.
  assert.equal(BUSINESS_CONFIG.businessLocationVerified, true);
  assert.equal(BUSINESS_CONFIG.businessLocation.lat, BUSINESS_LOCATION.latitude);
  assert.equal(BUSINESS_CONFIG.businessLocation.lng, BUSINESS_LOCATION.longitude);
  // El punto anterior caía a 793 m, sobre Av. Argentina junto a Parque Central.
  assert.notEqual(BUSINESS_CONFIG.businessLocation.lat, -38.9516);
  assert.notEqual(BUSINESS_CONFIG.businessLocation.lng, -68.0591);
  // Sigue sin ser una verificación humana: nadie miró el pin contra la puerta.
  assert.equal(BUSINESS_LOCATION.human_verified, false);
  assert.equal(BUSINESS_CONFIG.whatsappNumber, '');
  assert.equal(BUSINESS_CONFIG.whatsappVerified, false);
  assert.equal(BUSINESS_CONFIG.orderingDetailsVerified, false);
  assert.equal(BUSINESS_CONFIG.deliveryFee >= 0, true);
  assert.equal(BUSINESS_CONFIG.minDeliveryOrder >= 0, true);
  assert.ok(BUSINESS_CONFIG.address.length > 0);
  assert.ok(BUSINESS_CONFIG.openingHoursLabel.length > 0);
  assert.ok(BUSINESS_CONFIG.openingHours.length > 0);
  assert.ok(BUSINESS_CONFIG.deliveryZone.length > 0);
  assert.equal(BUSINESS_CONFIG.demoStreetTestDestinations.length, 5);
  assert.deepEqual(
    BUSINESS_CONFIG.demoStreetTestDestinations.map((destination) => destination.id),
    ['neuquen-centro', 'alto-comahue', 'cipolletti-centro', 'parque-norte-bardas', 'la-taba-demo'],
  );
});
