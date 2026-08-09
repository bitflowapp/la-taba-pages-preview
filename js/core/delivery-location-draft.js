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

/**
 * Una coordenada, o nada.
 *
 * `Number(null)`, `Number('')`, `Number([])` y `Number(false)` valen 0, y 0 es
 * finito. Sin este descarte previo, una dirección guardada SIN punto —todas las
 * de antes de la confirmación obligatoria— entraba con latitud y longitud 0, que
 * es un lugar real en el Golfo de Guinea, a unos 10.000 km de Neuquén.
 *
 * Medido contra el sitio publicado: al editar una dirección sin ubicación, el
 * paso abría en `pending` mostrando «0.000000, 0.000000» con «Confirmar
 * ubicación» a la vista, y tocarlo guardaba ese punto con la bendición del
 * servidor. Es el mismo error que 459a2dc cerró del lado del comercio; acá era
 * alcanzable desde el producto.
 */
function coordenada(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/** Un par de coordenadas dentro del planeta, o nada. */
function punto(latitude, longitude) {
  const lat = coordenada(latitude);
  const lng = coordenada(longitude);
  if (lat === null || lng === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { latitude: lat, longitude: lng };
}

export function emptyDeliveryLocationDraft() {
  return Object.freeze({
    status: DELIVERY_LOCATION_STATUS.EMPTY,
    method: '',
    point: null,
    confirmedAt: '',
    fingerprint: '',
    // De dónde viene la confirmación: `saved` si se rehidrató de una dirección
    // ya guardada, `fresh` si la persona acaba de marcar el pin en esta misma
    // edición. La regla de invalidación depende de esto y la explicación está
    // en `draftAfterAddressEdit`.
    origin: '',
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
    const partida = punto(address?.latitude, address?.longitude);
    if (!partida) return emptyDeliveryLocationDraft();
    return {
      ...emptyDeliveryLocationDraft(),
      status: DELIVERY_LOCATION_STATUS.PENDING,
      method: 'map_pin',
      point: { ...partida, accuracyMeters: null },
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
    origin: 'saved',
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
  const medido = punto(result.location?.latitude, result.location?.longitude);
  if (!medido) {
    return { ...draft, locating: false, error: 'La ubicación recibida no es válida.' };
  }
  const accuracy = coordenada(result.location?.accuracy);
  return {
    ...draft,
    locating: false,
    status: DELIVERY_LOCATION_STATUS.PENDING,
    method: 'gps',
    point: {
      ...medido,
      accuracyMeters: accuracy !== null && accuracy >= 0 ? accuracy : null,
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
  const partida = punto(startPoint?.latitude ?? startPoint?.lat, startPoint?.longitude ?? startPoint?.lng);
  if (!partida) {
    return { ...draft, mapOpen: true, error: '', notice: '' };
  }
  return {
    ...draft,
    status: DELIVERY_LOCATION_STATUS.PENDING,
    method: 'map_pin',
    point: { ...partida, accuracyMeters: null },
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
  const marcado = punto(point?.latitude ?? point?.lat, point?.longitude ?? point?.lng);
  if (!marcado) return draft;
  return {
    ...draft,
    status: DELIVERY_LOCATION_STATUS.PENDING,
    method: 'map_pin',
    point: { ...marcado, accuracyMeters: null },
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
    // La huella se sella con el texto que haya en ese momento, pero para una
    // confirmación FRESCA es provisoria: la definitiva se sella al guardar,
    // sobre el texto que la persona termine escribiendo. Ver `draftToAddressFields`.
    fingerprint: deliveryLocationAddressFingerprint(address),
    origin: 'fresh',
    error: '',
    notice: '',
  };
}

export function discardDeliveryLocationDraft() {
  return emptyDeliveryLocationDraft();
}

/**
 * La regla de invalidación, y por qué mira de dónde viene la confirmación.
 *
 * DEFECTO MEDIDO CONTRA LA URL PÚBLICA
 * ------------------------------------
 * Antes esta regla invalidaba CUALQUIER confirmación en cuanto cambiaba el
 * texto. El paso de ubicación está debajo de los campos, así que es normalísimo
 * marcar el pin y después terminar de escribir la dirección: en ese orden, cada
 * tecla posterior tiraba abajo la confirmación recién hecha y la persona no
 * podía guardar nunca. Se reprodujo en el sitio publicado con tres órdenes
 * humanos distintos, y dos de ellos fallaban EN SILENCIO —el re-render se
 * comía el toque sobre «Guardar dirección»—. Esa es la compra que quedó
 * bloqueada.
 *
 * Lo que la regla tiene que proteger es otra cosa: que un pin confirmado para
 * «Mendoza 850» no viaje callado como destino de «Rivadavia 200». Eso sólo
 * puede pasar con una confirmación que YA ESTABA GUARDADA y que se está
 * reutilizando mientras se edita el texto. Una confirmación fresca no arrastra
 * ninguna dirección anterior: la persona acaba de señalar el punto, y el texto
 * que termine escribiendo es el que se sella con él al guardar.
 *
 * Es la misma regla que impone la base —`upsert_current_customer_address`
 * invalida cuando el cliente reenvía LA MISMA confirmación de antes con otro
 * texto— así que las dos capas dicen lo mismo en vez de contradecirse.
 */
export function draftAfterAddressEdit(draft, address = {}) {
  if (draft?.status !== DELIVERY_LOCATION_STATUS.CONFIRMED) return draft;
  if (draft.origin !== 'saved') return draft;
  const current = deliveryLocationAddressFingerprint(address);
  if (!current || current === draft.fingerprint) return draft;
  return {
    ...draft,
    status: DELIVERY_LOCATION_STATUS.PENDING,
    confirmedAt: '',
    fingerprint: '',
    origin: '',
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
 *
 * La huella se sella ACÁ, con el texto que realmente se está guardando. Sellarla
 * al confirmar ataba el pin a un formulario a medio llenar; el pin pertenece a
 * la dirección que la persona termina escribiendo, no a la que había escrito
 * cuando tocó el botón.
 */
export function draftToAddressFields(draft, address = null) {
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
    locationConfirmedAddress: address
      ? deliveryLocationAddressFingerprint(address)
      : draft.fingerprint,
  };
}
