const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_MAXIMUM_AGE_MS = 0;
const DEFAULT_MAX_ACCURACY_METERS = 150;

export function createCustomerGeolocationService({
  navigatorRef = globalThis.navigator,
  isSecureContextRef = globalThis.isSecureContext,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maximumAgeMs = DEFAULT_MAXIMUM_AGE_MS,
  maxAccuracyMeters = DEFAULT_MAX_ACCURACY_METERS,
} = {}) {
  async function requestCurrentLocation() {
    if (!isSecureContextRef) return result(false, 'GPS_REQUIRES_HTTPS', 'La ubicación necesita una conexión segura (HTTPS).');
    const geolocation = navigatorRef?.geolocation;
    if (!geolocation || typeof geolocation.getCurrentPosition !== 'function') {
      return result(false, 'GPS_UNSUPPORTED', 'Este dispositivo no permite obtener la ubicación. Podés completar la dirección manualmente.');
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (next) => {
        if (settled) return;
        settled = true;
        resolve(next);
      };
      try {
        geolocation.getCurrentPosition(
          (position) => {
            const latitude = Number(position?.coords?.latitude);
            const longitude = Number(position?.coords?.longitude);
            const accuracy = Number(position?.coords?.accuracy);
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
              finish(result(false, 'GPS_INVALID', 'No pudimos leer una ubicación válida. Completá la dirección manualmente.'));
              return;
            }
            if (!Number.isFinite(accuracy) || accuracy > maxAccuracyMeters) {
              finish(result(false, 'GPS_LOW_ACCURACY', 'La ubicación no es lo suficientemente precisa. Probá de nuevo o completá la dirección manualmente.'));
              return;
            }
            finish(result(true, '', '', { latitude, longitude, accuracy, source: 'gps' }));
          },
          (error) => finish(readablePositionError(error)),
          {
            enableHighAccuracy: true,
            timeout: Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS),
            maximumAge: Math.max(0, Number(maximumAgeMs) || 0),
          },
        );
      } catch (_) {
        finish(result(false, 'GPS_UNAVAILABLE', 'No pudimos obtener la ubicación. Podés completar la dirección manualmente.'));
      }
    });
  }

  return { requestCurrentLocation };
}

function readablePositionError(error) {
  const code = Number(error?.code || 0);
  if (code === 1) return result(false, 'GPS_PERMISSION_DENIED', 'No autorizaste la ubicación. Podés completar la dirección manualmente.');
  if (code === 3) return result(false, 'GPS_TIMEOUT', 'La ubicación tardó demasiado. Probá otra vez o completá la dirección manualmente.');
  return result(false, 'GPS_UNAVAILABLE', 'No pudimos obtener la ubicación. Podés completar la dirección manualmente.');
}

function result(ok, code, message, location = null) {
  return { ok, code, message, ...(location ? { location } : {}) };
}
