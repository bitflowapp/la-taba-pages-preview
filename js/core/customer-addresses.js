import { formatAddressLabel } from './address.js';
import {
  deliveryLocationAddressFingerprint,
  isDeliveryLocationSource,
} from './delivery-location.js';
import { sanitizeText } from './validators.js';

// Vocabulario HISTÓRICO de la columna `source`. No se amplía: hay un trigger en
// staging, fuera de este repositorio, que copia `delivery_address_source` a una
// tabla con un CHECK sobre este mismo conjunto. Agregarle valores nuevos haría
// abortar el alta del pedido. El origen del contrato nuevo —gps / map_pin /
// geocoded_confirmed— viaja en `locationSource`, que es una columna propia.
export const CUSTOMER_ADDRESS_SOURCES = Object.freeze(['manual', 'gps', 'geocoder', 'previous_order']);

// Cómo se proyecta el origen del contrato sobre la columna histórica.
const LEGACY_SOURCE_BY_LOCATION_SOURCE = Object.freeze({
  gps: 'gps',
  map_pin: 'manual',
  geocoded_confirmed: 'geocoder',
});

const ADDRESS_LABEL_MAX = 60;
const ADDRESS_TEXT_MAX = 180;
const LOCATION_MIN_DUPLICATE_METERS = 55;
const LOCATION_BASE_TOLERANCE_METERS = 30;

export function normalizeCustomerAddress(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const street = sanitizeText(source.street ?? source.streetLine ?? source.customerStreetAddress, {
    fallback: '', maxLength: 120,
  });
  const streetNumber = sanitizeText(source.streetNumber, { fallback: '', maxLength: 24 });
  const city = sanitizeText(source.city ?? source.neighborhood ?? source.customerNeighborhood, {
    fallback: '', maxLength: 100,
  });
  const floor = sanitizeText(source.floor, { fallback: '', maxLength: 24 });
  const apartment = sanitizeText(source.apartment, { fallback: '', maxLength: 24 });
  const reference = sanitizeText(source.reference ?? source.customerReference, {
    fallback: '', maxLength: 180,
  });
  const streetLine = joinStreetLine(street, streetNumber);
  const formattedAddress = sanitizeText(
    source.formattedAddress ?? source.formatted_address ?? formatAddressLabel({ streetLine, neighborhood: city }),
    { fallback: '', maxLength: ADDRESS_TEXT_MAX },
  );
  const coordinates = normalizeCoordinates(source.latitude ?? source.lat, source.longitude ?? source.lng);
  // El origen del contrato manda sobre la columna histórica: si la persona
  // confirmó un pin, `source` describe ESA confirmación y no lo que venga
  // escrito en el payload.
  const locationSource = normalizeLocationSource(source, coordinates);
  const locationConfirmedAt = locationSource
    ? sanitizeText(source.locationConfirmedAt ?? source.location_confirmed_at, { fallback: '', maxLength: 40 })
    : '';
  const sourceValue = locationSource && locationConfirmedAt
    ? LEGACY_SOURCE_BY_LOCATION_SOURCE[locationSource]
    : CUSTOMER_ADDRESS_SOURCES.includes(source.source)
      ? source.source
      : coordinates ? 'gps' : 'manual';

  return {
    id: sanitizeText(source.id, { fallback: '', maxLength: 80 }),
    label: sanitizeText(source.label, { fallback: '', maxLength: ADDRESS_LABEL_MAX }) || 'Otro',
    formattedAddress,
    street,
    streetNumber,
    floor,
    apartment,
    reference,
    city,
    // El barrio declarado, aparte de la localidad. Es la entrada con la que el
    // backend resuelve la cobertura: la persona lo elige de la lista que el
    // propio comercio publica, así que no es texto libre aunque se guarde como
    // tal. Vacío es un valor legítimo: una dirección vieja no lo tiene y no deja
    // de funcionar por eso.
    neighborhood: sanitizeText(source.neighborhood ?? source.customerNeighborhood, {
      fallback: '', maxLength: 100,
    }),
    province: sanitizeText(source.province, { fallback: '', maxLength: 100 }),
    postalCode: sanitizeText(source.postalCode ?? source.postal_code, { fallback: '', maxLength: 20 }),
    latitude: coordinates?.latitude ?? null,
    longitude: coordinates?.longitude ?? null,
    geolocationAccuracy: normalizeAccuracy(source.geolocationAccuracy ?? source.geolocation_accuracy),
    locationSource,
    locationConfirmedAt,
    // La huella se CONSERVA tal como vino; nunca se recalcula acá. Recalcularla
    // sobre el texto actual haría que siempre coincida, y entonces editar la
    // calle jamás invalidaría el pin, que es justo lo que tiene que pasar.
    locationConfirmedAddress: sanitizeText(
      source.locationConfirmedAddress ?? source.location_confirmed_address,
      { fallback: '', maxLength: 200 },
    ),
    source: sourceValue,
    isDefault: source.isDefault === true || source.is_default === true,
    lastUsedAt: sanitizeText(source.lastUsedAt ?? source.last_used_at, { fallback: '', maxLength: 40 }),
  };
}

export function normalizedAddressKey(address = {}) {
  const normalized = normalizeCustomerAddress(address);
  return [
    normalized.street,
    normalized.streetNumber,
    normalized.floor,
    normalized.apartment,
    normalized.city,
    normalized.province,
    normalized.postalCode,
  ]
    .map(normalizeComparableText)
    .filter(Boolean)
    .join('|');
}

export function haversineDistanceMeters(a = {}, b = {}) {
  const first = normalizeCoordinates(a.latitude ?? a.lat, a.longitude ?? a.lng);
  const second = normalizeCoordinates(b.latitude ?? b.lat, b.longitude ?? b.lng);
  if (!first || !second) return Number.POSITIVE_INFINITY;
  const radians = Math.PI / 180;
  const deltaLat = (second.latitude - first.latitude) * radians;
  const deltaLng = (second.longitude - first.longitude) * radians;
  const originLat = first.latitude * radians;
  const targetLat = second.latitude * radians;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);
  const arc = sinLat ** 2 + Math.cos(originLat) * Math.cos(targetLat) * sinLng ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(1 - arc));
}

export function locationMatchThresholdMeters(location = {}, address = {}) {
  const locationAccuracy = normalizeAccuracy(location.accuracy ?? location.geolocationAccuracy) || 0;
  const addressAccuracy = normalizeAccuracy(address.geolocationAccuracy ?? address.geolocation_accuracy) || 0;
  return Math.max(
    LOCATION_MIN_DUPLICATE_METERS,
    locationAccuracy + addressAccuracy + LOCATION_BASE_TOLERANCE_METERS,
  );
}

export function findLikelyDuplicateAddress(candidate, addresses = []) {
  const normalizedCandidate = normalizeCustomerAddress(candidate);
  const key = normalizedAddressKey(normalizedCandidate);
  for (const rawAddress of addresses) {
    const address = normalizeCustomerAddress(rawAddress);
    if (!address.id && !address.formattedAddress) continue;
    if (candidate.id && address.id === candidate.id) continue;
    const addressKey = normalizedAddressKey(address);
    if (key && key === addressKey) return { address, reason: 'normalized-address', distanceMeters: 0 };
    const distanceMeters = haversineDistanceMeters(normalizedCandidate, address);
    if (Number.isFinite(distanceMeters) && distanceMeters <= locationMatchThresholdMeters(normalizedCandidate, address)) {
      return { address, reason: 'nearby-location', distanceMeters };
    }
  }
  return null;
}

export function findNearbySavedAddress(location, addresses = []) {
  const matches = addresses
    .map((rawAddress) => {
      const address = normalizeCustomerAddress(rawAddress);
      const distanceMeters = haversineDistanceMeters(location, address);
      return {
        address,
        distanceMeters,
        thresholdMeters: locationMatchThresholdMeters(location, address),
      };
    })
    .filter((entry) => Number.isFinite(entry.distanceMeters) && entry.distanceMeters <= entry.thresholdMeters)
    .sort((left, right) => left.distanceMeters - right.distanceMeters);
  return matches[0] || null;
}

export function addressSummary(address = {}) {
  const normalized = normalizeCustomerAddress(address);
  const unit = [normalized.floor && `Piso ${normalized.floor}`, normalized.apartment && `Dpto. ${normalized.apartment}`]
    .filter(Boolean)
    .join(', ');
  return [normalized.formattedAddress, unit].filter(Boolean).join(' · ');
}

function normalizeCoordinates(latitude, longitude) {
  const parsedLatitude = Number(latitude);
  const parsedLongitude = Number(longitude);
  if (!Number.isFinite(parsedLatitude) || !Number.isFinite(parsedLongitude)) return null;
  if (Math.abs(parsedLatitude) > 90 || Math.abs(parsedLongitude) > 180) return null;
  return { latitude: parsedLatitude, longitude: parsedLongitude };
}

function normalizeLocationSource(source, coordinates) {
  if (!coordinates) return '';
  const candidate = String(source.locationSource ?? source.location_source ?? '').trim();
  return isDeliveryLocationSource(candidate) ? candidate : '';
}

/**
 * Huella del texto de dirección de un candidato, para sellarla junto con la
 * confirmación. Se usa al GUARDAR, no al leer.
 */
export function customerAddressLocationFingerprint(address = {}) {
  return deliveryLocationAddressFingerprint(normalizeCustomerAddress(address));
}

function normalizeAccuracy(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function joinStreetLine(street, number) {
  if (!street) return '';
  return sanitizeText([street, number].filter(Boolean).join(' '), { fallback: '', maxLength: 120 });
}

function normalizeComparableText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(av\.?|avda\.?)\b/g, 'avenida')
    .replace(/\b(dpto\.?|depto\.?)\b/g, 'departamento')
    .replace(/\b(nro\.?|no\.?)\b/g, 'numero')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
