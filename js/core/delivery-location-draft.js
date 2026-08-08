// ─────────────────────────────────────────────────────────────────────────────
// EL BORRADOR DE LA CONFIRMACIÓN
//
// Máquina de estados pura del paso «Confirmá dónde te entregamos». Vive separada
// del DOM y del mapa para que las reglas —cuándo hay pin, cuándo hay
// confirmación y cuándo la confirmación se cae— se puedan probar sin navegador.
//
// Tres estados y nada más:
//
//   empty      no hay punto; no se puede pedir delivery
//   pending    hay un pin puesto, pero la persona todavía no lo confirmó
//   confirmed  la persona apretó CONFIRMAR UBICACIÓN sobre ese pin
//
// El paso de `pending` a `confirmed` es SIEMPRE un acto explícito. Recibir la
// ubicación del GPS no confirma nada por sí solo: el aparato dice dónde está el
// teléfono, no dónde hay que tocar el timbre.
// ─────────────────────────────────────────────────────────────────────────────

import {
  deliveryLocationAddressFingerprint,
  confirmedDeliveryLocationOf,
  isDeliveryLocationSource,
} from './delivery-location.js';

export const DELIVERY_LOCATION_STATUS = Object.freeze({
  EMPTY: 'empty',
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
});

export const ADDRESS_CHANGED_NOTICE =
  'Cambiaste la dirección: revisá el pin y volvé a confirmar dónde te entregamos.';

export function emptyDeliveryLocationDraft() {
  return Object.freeze({
    status: DELIVERY_LOCATION_STATUS.EMPTY,
    method: '',
    point: null,
    confirmedAt: '',
    fingerprint: '',
    mapOpen: false,
    locating: false,
    error: '',
    notice: '',
  });
}

/**
 * Rehidrata el borrador desde una dirección guardada. Si la dirección trae una
 * confirmación vigente, el paso arranca resuelto y la persona no tiene que
 * rehacerlo: esa es la reutilización que pide el contrato.
 */
export function draftFromSavedAddress(address = {}) {
  const confirmed = confirmedDeliveryLocationOf(address);
  if (!confirmed) {
    // Una dirección vieja puede traer coordenadas sin confirmación. El pin se
    // conserva como punto de partida —ahorra trabajo— pero el paso queda
    // pendiente: nadie confirmó nunca ese punto.
    const latitude = Number(address?.latitude);
    const longitude = Number(address?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return emptyDeliveryLocationDraft();
    return {
      ...emptyDeliveryLocationDraft(),
      status: DELIVERY_LOCATION_STATUS.PENDING,
      method: 'map_pin',
      point: { latitude, longitude, accuracyMeters: null },
      mapOpen: true,
    };
  }
  return {
    ...emptyDeliveryLocationDraft(),
    status: DELIVERY_LOCATION_STATUS.CONFIRMED,
    method: confirmed.locationSource,
    point: {
      latitude: confirmed.latitude,
      longitude: confirmed.longitude,
      accuracyMeters: confirmed.accuracyMeters,
    },
    confirmedAt: confirmed.confirmedAt,
    fingerprint: confirmed.addressFingerprint,
  };
}

export function draftLocating(draft) {
  return { ...draft, locating: true, error: '', notice: '' };
}

/**
 * Resultado del servicio de geolocalización. Un rechazo de permiso NO es un
 * error del que haya que salir: deja el camino del mapa abierto y lo dice.
 */
export function draftWithLocationResult(draft, result = {}) {
  if (!result?.ok) {
    return {
      ...draft,
      locating: false,
      mapOpen: true,
      error: String(result?.message || 'No pudimos obtener tu ubicación.'),
      notice: '',
    };
  }
  const latitude = Number(result.location?.latitude);
  const longitude = Number(result.location?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { ...draft, locating: false, error: 'La ubicación recibida no es válida.' };
  }
  const accuracy = Number(result.location?.accuracy);
  return {
    ...draft,
    locating: false,
    status: DELIVERY_LOCATION_STATUS.PENDING,
    method: 'gps',
    point: {
      latitude,
      longitude,
      accuracyMeters: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null,
    },
    confirmedAt: '',
    fingerprint: '',
    mapOpen: true,
    error: '',
    notice: '',
  };
}

/**
 * Abre el mapa sin pedir GPS. Si todavía no hay pin, arranca en el punto de
 * partida que le pase la vista —el local— y lo dice: es un lugar desde el que
 * mover el pin, no una afirmación sobre dónde vive nadie.
 */
export function draftOpenedOnMap(draft, startPoint = null) {
  if (draft.point) return { ...draft, mapOpen: true, error: '', notice: '' };
  const latitude = Number(startPoint?.latitude ?? startPoint?.lat);
  const longitude = Number(startPoint?.longitude ?? startPoint?.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { ...draft, mapOpen: true, error: '', notice: '' };
  }
  return {
    ...draft,
    status: DELIVERY_LOCATION_STATUS.PENDING,
    method: 'map_pin',
    point: { latitude, longitude, accuracyMeters: null },
    confirmedAt: '',
    fingerprint: '',
    mapOpen: true,
    error: '',
    notice: '',
  };
}

/**
 * Mover el pin a mano descarta la precisión del GPS: ese número describía la
 * medición del aparato, no el lugar nuevo que eligió la persona. Y vuelve a
 * dejar el paso pendiente de confirmación.
 */
export function draftWithMapPin(draft, point = {}) {
  const latitude = Number(point?.latitude ?? point?.lat);
  const longitude = Number(point?.longitude ?? point?.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return draft;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return draft;
  return {
    ...draft,
    status: DELIVERY_LOCATION_STATUS.PENDING,
    method: 'map_pin',
    point: { latitude, longitude, accuracyMeters: null },
    confirmedAt: '',
    fingerprint: '',
    mapOpen: true,
    error: '',
    notice: '',
  };
}

export function confirmDeliveryLocationDraft(draft, { address = {}, now = new Date() } = {}) {
  if (!draft?.point) return draft;
  const method = isDeliveryLocationSource(draft.method) ? draft.method : 'map_pin';
  return {
    ...draft,
    status: DELIVERY_LOCATION_STATUS.CONFIRMED,
    method,
    confirmedAt: new Date(now).toISOString(),
    fingerprint: deliveryLocationAddressFingerprint(address),
    error: '',
    notice: '',
  };
}

export function discardDeliveryLocationDraft() {
  return emptyDeliveryLocationDraft();
}

/**
 * La regla de invalidación. Si el texto que determina el punto cambió, la
 * confirmación deja de valer: el pin sigue en pantalla —no se pierde el
 * trabajo— pero hay que volver a apretar CONFIRMAR UBICACIÓN.
 */
export function draftAfterAddressEdit(draft, address = {}) {
  if (draft?.status !== DELIVERY_LOCATION_STATUS.CONFIRMED) return draft;
  const current = deliveryLocationAddressFingerprint(address);
  if (!current || current === draft.fingerprint) return draft;
  return {
    ...draft,
    status: DELIVERY_LOCATION_STATUS.PENDING,
    confirmedAt: '',
    fingerprint: '',
    notice: ADDRESS_CHANGED_NOTICE,
  };
}

export function isDeliveryLocationDraftConfirmed(draft) {
  return draft?.status === DELIVERY_LOCATION_STATUS.CONFIRMED
    && Boolean(draft.point)
    && Boolean(draft.confirmedAt);
}

/**
 * Los campos que se persisten. Sin confirmación viajan en null: una dirección a
 * medio confirmar se guarda como lo que es, sin punto.
 */
export function draftToAddressFields(draft) {
  if (!isDeliveryLocationDraftConfirmed(draft)) {
    return {
      latitude: null,
      longitude: null,
      geolocationAccuracy: null,
      locationSource: '',
      locationConfirmedAt: '',
      locationConfirmedAddress: '',
    };
  }
  return {
    latitude: draft.point.latitude,
    longitude: draft.point.longitude,
    geolocationAccuracy: draft.point.accuracyMeters ?? null,
    locationSource: draft.method,
    locationConfirmedAt: draft.confirmedAt,
    locationConfirmedAddress: draft.fingerprint,
  };
}
