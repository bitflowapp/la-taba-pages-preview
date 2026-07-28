import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findLikelyDuplicateAddress,
  findNearbySavedAddress,
  haversineDistanceMeters,
  locationMatchThresholdMeters,
  normalizedAddressKey,
} from '../js/core/customer-addresses.js';

test('normaliza abreviaturas, acentos y espacios sin modificar el texto visible', () => {
  const key = normalizedAddressKey({
    street: ' Av.  San Martín ',
    streetNumber: ' 123 ',
    city: 'Neuquén',
    apartment: 'Dpto. A',
  });

  assert.match(key, /avenida san martin/);
  assert.match(key, /neuquen/);
  assert.match(key, /departamento a/);
});

test('detecta duplicados por dirección normalizada y no por una coincidencia textual débil', () => {
  const duplicate = findLikelyDuplicateAddress({
    street: 'Av. San Martín', streetNumber: '123', city: 'Neuquén', label: 'Otro',
  }, [{
    id: 'address-home', street: 'Avenida San Martin', streetNumber: '123', city: 'Neuquen', label: 'Casa',
  }]);

  assert.equal(duplicate?.address.id, 'address-home');
  assert.equal(duplicate?.reason, 'normalized-address');
});

test('compara GPS con Haversine y amplía el umbral según la precisión', () => {
  const home = { id: 'home', label: 'Casa', latitude: -38.9516, longitude: -68.0591, geolocationAccuracy: 12 };
  const location = { latitude: -38.9518, longitude: -68.0590, accuracy: 35 };
  const distance = haversineDistanceMeters(location, home);

  assert.ok(distance > 0 && distance < 60);
  assert.equal(locationMatchThresholdMeters(location, home), 77);
  assert.equal(findNearbySavedAddress(location, [home])?.address.id, 'home');
});

test('no fuerza una coincidencia si las coordenadas están lejos', () => {
  const nearby = findNearbySavedAddress(
    { latitude: -38.9516, longitude: -68.0591, accuracy: 10 },
    [{ id: 'work', label: 'Trabajo', latitude: -38.973, longitude: -68.09, geolocationAccuracy: 10 }],
  );

  assert.equal(nearby, null);
});
