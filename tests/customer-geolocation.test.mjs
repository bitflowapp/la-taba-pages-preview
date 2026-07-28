import assert from 'node:assert/strict';
import test from 'node:test';

import { createCustomerGeolocationService } from '../js/services/customer-geolocation.js';

test('no consulta GPS hasta una acción explícita', async () => {
  let calls = 0;
  const service = createCustomerGeolocationService({
    isSecureContextRef: true,
    navigatorRef: {
      geolocation: {
        getCurrentPosition(success) {
          calls += 1;
          success({ coords: { latitude: -38.95, longitude: -68.06, accuracy: 20 } });
        },
      },
    },
  });

  assert.equal(calls, 0);
  const result = await service.requestCurrentLocation();
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.location.source, 'gps');
});

test('informa permiso rechazado, timeout y baja precisión sin bloquear la dirección manual', async () => {
  const denied = createCustomerGeolocationService({
    isSecureContextRef: true,
    navigatorRef: { geolocation: { getCurrentPosition(_success, error) { error({ code: 1 }); } } },
  });
  const timedOut = createCustomerGeolocationService({
    isSecureContextRef: true,
    navigatorRef: { geolocation: { getCurrentPosition(_success, error) { error({ code: 3 }); } } },
  });
  const imprecise = createCustomerGeolocationService({
    isSecureContextRef: true,
    maxAccuracyMeters: 100,
    navigatorRef: {
      geolocation: {
        getCurrentPosition(success) {
          success({ coords: { latitude: -38.95, longitude: -68.06, accuracy: 250 } });
        },
      },
    },
  });

  assert.deepEqual(await denied.requestCurrentLocation(), {
    ok: false,
    code: 'GPS_PERMISSION_DENIED',
    message: 'No autorizaste la ubicación. Podés completar la dirección manualmente.',
  });
  assert.equal((await timedOut.requestCurrentLocation()).code, 'GPS_TIMEOUT');
  assert.equal((await imprecise.requestCurrentLocation()).code, 'GPS_LOW_ACCURACY');
});

test('falla claramente si GPS no está disponible o el contexto no es seguro', async () => {
  const unsupported = createCustomerGeolocationService({ isSecureContextRef: true, navigatorRef: {} });
  const insecure = createCustomerGeolocationService({ isSecureContextRef: false, navigatorRef: {} });

  assert.equal((await unsupported.requestCurrentLocation()).code, 'GPS_UNSUPPORTED');
  assert.equal((await insecure.requestCurrentLocation()).code, 'GPS_REQUIRES_HTTPS');
});
