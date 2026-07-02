import assert from 'node:assert/strict';
import test from 'node:test';
import { BUSINESS_CONFIG } from '../js/config.js';

test('BUSINESS_CONFIG exposes the expected business settings', () => {
  assert.equal(BUSINESS_CONFIG.businessName, 'La Taba Pizzería');
  assert.equal(BUSINESS_CONFIG.name, 'La Taba Pizzería');
  assert.equal(BUSINESS_CONFIG.subtitle, 'Catálogo de pizzería · recorrido comercial');
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
