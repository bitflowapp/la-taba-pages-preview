// ─────────────────────────────────────────────────────────────────────────────
// CONTRATO DEL PUNTO DE ENTREGA CONFIRMADO
//
// POR QUÉ EXISTE
// --------------
// El primer pedido humano se creó con modalidad DELIVERY, dirección escrita a
// mano y `latitude`/`longitude` NULL. Aguas abajo eso significa: el Panel sólo
// conoce texto, el Rider no tiene destino, el seguimiento no puede dibujar la
// entrega y el enlace de Google Maps queda a merced de un geocodificador que ya
// nos mandó a Zapala una vez, a 175 km. Nada estaba roto: el dato nunca existió.
//
// Este módulo es la ÚNICA definición de qué cuenta como punto confirmado. La
// base de datos impone lo mismo del lado del servidor; acá vive la versión que
// consume el navegador, para que el checkout no ofrezca continuar con algo que
// el backend va a rechazar.
//
// ESCRIBIR UNA DIRECCIÓN NO ES CONFIRMAR UNA UBICACIÓN
// ----------------------------------------------------
// Una confirmación exige tres cosas juntas: coordenadas, un origen que declare
// CÓMO se obtuvieron, y el momento en que la persona apretó «Confirmar
// ubicación». Sin las tres, no hay confirmación. Y si después cambia el texto de
// la dirección, la confirmación se invalida: el pin dejó de describir esa
// puerta.
// ─────────────────────────────────────────────────────────────────────────────

import { mapsDirectionsUrl, mapsSearchUrl } from './business-location.js';

// Los tres orígenes del contrato. `gps` y `map_pin` tienen productor hoy; el
// tercero queda declarado para cuando exista un geocodificador configurado, y
// se acepta desde ya para que agregarlo no obligue a migrar el contrato.
// `geocoded_confirmed` es un resultado de geocodificación que la persona miró
// en el mapa y aceptó: nunca el centroide de una calle aplicado en silencio.
export const DELIVERY_LOCATION_SOURCES = Object.freeze(['gps', 'map_pin', 'geocoded_confirmed']);

export const DELIVERY_LOCATION_REQUIRED = 'DELIVERY_LOCATION_REQUIRED';

export const DELIVERY_LOCATION_REQUIRED_MESSAGE =
  'Confirmá en el mapa dónde te entregamos antes de continuar.';

export const DELIVERY_LOCATION_SOURCE_LABELS = Object.freeze({
  gps: 'Ubicación del dispositivo',
  map_pin: 'Punto marcado en el mapa',
  geocoded_confirmed: 'Dirección geocodificada y confirmada',
});

// Precisión por encima de la cual el punto ya no describe una puerta sino una
// manzana entera. No bloquea —una persona puede confirmar igual desde el mapa—
// pero se dice en pantalla en vez de presentarlo como exacto.
export const DELIVERY_LOCATION_COARSE_ACCURACY_METERS = 150;

export function isDeliveryLocationSource(value) {
  return DELIVERY_LOCATION_SOURCES.includes(String(value || ''));
}

/**
 * Normaliza un punto confirmado. Devuelve null si le falta cualquiera de las
 * tres piezas del contrato: coordenadas válidas, origen declarado y momento de
 * confirmación. Nunca "completa" lo que falta.
 */
export function normalizeDeliveryLocation(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const latitude = finiteCoordinate(source.latitude ?? source.lat, 90);
  const longitude = finiteCoordinate(source.longitude ?? source.lng, 180);
  if (latitude == null || longitude == null) return null;

  const locationSource = String(
    source.locationSource ?? source.location_source ?? source.source ?? '',
  ).trim();
  if (!isDeliveryLocationSource(locationSource)) return null;

  const confirmedAt = normalizeInstant(
    source.confirmedAt ?? source.locationConfirmedAt ?? source.location_confirmed_at,
  );
  if (!confirmedAt) return null;

  return {
    latitude,
    longitude,
    locationSource,
    accuracyMeters: nonNegativeNumber(
      source.accuracyMeters ?? source.accuracy ?? source.geolocationAccuracy ?? source.geolocation_accuracy,
    ),
    confirmedAt,
    addressFingerprint: String(
      source.addressFingerprint ?? source.locationConfirmedAddress ?? source.location_confirmed_address ?? '',
    ).trim(),
  };
}

/**
 * Huella del texto de dirección que determina el punto.
 *
 * Piso y departamento quedan deliberadamente afuera: nombran una unidad DENTRO
 * del mismo edificio, no otro lugar en el mundo. Cambiar «Piso 3» por «Piso 4»
 * no mueve el pin y no debería obligar a rehacer la confirmación; cambiar la
 * calle, el número, la ciudad o la provincia sí.
 *
 * Espeja exactamente `public.delivery_location_address_fingerprint` en la base:
 * si las dos se separan, el servidor invalidaría confirmaciones que el
 * navegador da por buenas y el cliente vería un rechazo sin explicación.
 */
export function deliveryLocationAddressFingerprint(address = {}) {
  const source = address && typeof address === 'object' ? address : {};
  return normalizeFingerprintText([
    source.street ?? source.deliveryStreet,
    source.streetNumber ?? source.street_number ?? source.deliveryStreetNumber,
    source.city ?? source.deliveryCity,
    source.province ?? source.deliveryProvince,
    source.postalCode ?? source.postal_code ?? source.deliveryPostalCode,
  ].filter((part) => String(part ?? '').trim() !== '').join(' '));
}

/**
 * El punto confirmado de una dirección guardada, o null.
 *
 * Si la huella guardada no coincide con el texto actual de la dirección, la
 * confirmación se considera vencida: alguien editó la calle después de marcar
 * el pin y el punto dejó de describir esa puerta.
 */
export function confirmedDeliveryLocationOf(address = {}) {
  const location = normalizeDeliveryLocation({
    latitude: address?.latitude,
    longitude: address?.longitude,
    locationSource: address?.locationSource ?? address?.location_source,
    accuracyMeters: address?.geolocationAccuracy ?? address?.geolocation_accuracy,
    confirmedAt: address?.locationConfirmedAt ?? address?.location_confirmed_at,
    addressFingerprint: address?.locationConfirmedAddress ?? address?.location_confirmed_address,
  });
  if (!location) return null;
  const current = deliveryLocationAddressFingerprint(address);
  if (location.addressFingerprint && current && location.addressFingerprint !== current) return null;
  return location;
}

export function hasConfirmedDeliveryLocation(address = {}) {
  return confirmedDeliveryLocationOf(address) != null;
}

/**
 * La compuerta. Delivery exige punto confirmado; retiro en local no exige nada
 * geográfico, porque el punto de encuentro es el mostrador del comercio.
 */
export function requireConfirmedDeliveryLocation({
  fulfillmentType = 'delivery',
  location = null,
  address = null,
} = {}) {
  const mode = String(fulfillmentType || '').trim().toLowerCase();
  if (mode === 'pickup') return { ok: true, skipped: true };
  const confirmed = location
    ? normalizeDeliveryLocation(location)
    : confirmedDeliveryLocationOf(address || {});
  if (!confirmed) {
    return {
      ok: false,
      code: DELIVERY_LOCATION_REQUIRED,
      message: DELIVERY_LOCATION_REQUIRED_MESSAGE,
    };
  }
  return { ok: true, location: confirmed };
}

export function deliveryLocationAccuracyLabel(location = {}) {
  const accuracy = nonNegativeNumber(location?.accuracyMeters ?? location?.accuracy);
  if (accuracy == null) return '';
  const meters = Math.round(accuracy);
  return meters > DELIVERY_LOCATION_COARSE_ACCURACY_METERS
    ? `Precisión aproximada: ${meters} m (amplia)`
    : `Precisión aproximada: ${meters} m`;
}

export function deliveryLocationSourceLabel(location = {}) {
  const key = String(location?.locationSource ?? location?.source ?? '');
  return DELIVERY_LOCATION_SOURCE_LABELS[key] || '';
}

// Navegar SIEMPRE por coordenadas. Mandar el texto de la dirección a Maps es
// pedirle a un geocodificador que adivine; con «Mendoza 827» eso ya resolvió en
// otra ciudad. La etiqueta viaja aparte, para que la persona lea el nombre.
export function deliveryDestinationDirectionsUrl(location = {}) {
  const point = plottableDeliveryPoint(location);
  return point ? mapsDirectionsUrl(point.latitude, point.longitude) : '';
}

export function deliveryDestinationSearchUrl(location = {}) {
  const point = plottableDeliveryPoint(location);
  return point ? mapsSearchUrl(point.latitude, point.longitude) : '';
}

/**
 * Un punto dibujable: coordenadas válidas. No exige confirmación, porque el
 * Rider y el Panel muestran lo que el pedido TIENE guardado, y un pedido viejo
 * puede traer coordenadas sin la confirmación que hoy es obligatoria.
 */
export function plottableDeliveryPoint(location = {}) {
  const latitude = finiteCoordinate(location?.latitude ?? location?.lat, 90);
  const longitude = finiteCoordinate(location?.longitude ?? location?.lng, 180);
  if (latitude == null || longitude == null) return null;
  return { latitude, longitude };
}

function finiteCoordinate(value, limit) {
  if (value == null || String(value).trim() === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || Math.abs(numeric) > limit) return null;
  return numeric;
}

function nonNegativeNumber(value) {
  if (value == null || String(value).trim() === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function normalizeInstant(value) {
  if (value == null || String(value).trim() === '') return '';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

const ACCENTS = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', ñ: 'n' };

function normalizeFingerprintText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[áéíóúüñ]/g, (character) => ACCENTS[character] || character)
    .replace(/\b(av\.?|avda\.?)\b/g, 'avenida')
    .replace(/\b(dpto\.?|depto\.?)\b/g, 'departamento')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
