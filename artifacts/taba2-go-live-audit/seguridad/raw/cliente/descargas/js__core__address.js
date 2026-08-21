import { normalizeDeliveryLocation } from './delivery-location.js';
import { sanitizeText } from './validators.js';

const ADDRESS_MAX = 180;
const ADDRESS_PART_MAX = 120;
const REFERENCE_MAX = 180;

export function normalizeAddressDetails(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const streetLine = sanitizeText(source.streetLine ?? source.customerStreetAddress, { maxLength: ADDRESS_PART_MAX });
  const neighborhood = sanitizeText(source.neighborhood ?? source.customerNeighborhood, { maxLength: ADDRESS_PART_MAX });
  const reference = sanitizeText(source.reference ?? source.customerReference ?? source.deliveryReference, { maxLength: REFERENCE_MAX });
  const hasStructuredFields = Boolean(streetLine || neighborhood || reference);
  const legacyAddress = sanitizeText(source.label ?? source.customerAddress ?? source.address, { maxLength: ADDRESS_MAX });
  const label = formatAddressLabel({ streetLine, neighborhood }, legacyAddress);

  const normalized = {
    streetLine,
    neighborhood,
    reference,
    label,
    usesStructured: hasStructuredFields,
  };
  const optionalFields = {
    savedLabel: sanitizeText(source.savedLabel, { maxLength: 60 }),
    street: sanitizeText(source.street, { maxLength: 120 }),
    streetNumber: sanitizeText(source.streetNumber, { maxLength: 24 }),
    floor: sanitizeText(source.floor, { maxLength: 24 }),
    apartment: sanitizeText(source.apartment, { maxLength: 24 }),
    city: sanitizeText(source.city, { maxLength: 100 }),
    province: sanitizeText(source.province, { maxLength: 100 }),
    postalCode: sanitizeText(source.postalCode, { maxLength: 20 }),
    snapshotCreatedAt: sanitizeText(source.snapshotCreatedAt, { maxLength: 40 }),
  };
  for (const [key, value] of Object.entries(optionalFields)) {
    if (value) normalized[key] = value;
  }
  // El punto de entrega viaja CON la dirección. Antes se quedaba en la fila del
  // pedido y no llegaba al dominio, así que el Panel, el Rider y el seguimiento
  // sólo veían texto aunque la coordenada estuviera guardada al lado.
  const location = normalizeDeliveryLocation({
    latitude: source.latitude ?? source.deliveryLatitude ?? source.delivery_latitude,
    longitude: source.longitude ?? source.deliveryLongitude ?? source.delivery_longitude,
    locationSource: source.locationSource ?? source.deliveryLocationSource ?? source.delivery_location_source,
    accuracyMeters: source.geolocationAccuracy ?? source.deliveryGeolocationAccuracy ?? source.delivery_geolocation_accuracy,
    confirmedAt: source.locationConfirmedAt ?? source.deliveryLocationConfirmedAt ?? source.delivery_location_confirmed_at,
  });
  if (location) {
    normalized.latitude = location.latitude;
    normalized.longitude = location.longitude;
    normalized.locationSource = location.locationSource;
    normalized.locationConfirmedAt = location.confirmedAt;
    if (location.accuracyMeters != null) normalized.geolocationAccuracy = location.accuracyMeters;
  } else {
    // Un pedido anterior al contrato puede traer coordenadas sin confirmación.
    // Se propagan igual —son el único destino que existe— pero sin afirmar que
    // alguien las confirmó.
    const latitude = Number(source.latitude ?? source.deliveryLatitude ?? source.delivery_latitude);
    const longitude = Number(source.longitude ?? source.deliveryLongitude ?? source.delivery_longitude);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)
      && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
      normalized.latitude = latitude;
      normalized.longitude = longitude;
    }
  }
  return normalized;
}

export function normalizeOrderAddressDetails(order = {}) {
  if (!order || typeof order !== 'object') return normalizeAddressDetails();
  return normalizeAddressDetails({
    ...(order.addressDetails || {}),
    streetLine: order.addressDetails?.streetLine ?? order.streetLine ?? order.customerStreetAddress,
    neighborhood: order.addressDetails?.neighborhood ?? order.neighborhood ?? order.customerNeighborhood,
    reference: order.addressDetails?.reference ?? order.reference ?? order.customerReference ?? order.deliveryReference,
    label: order.addressDetails?.label ?? order.address ?? order.customerAddress,
    latitude: order.addressDetails?.latitude ?? order.deliveryLatitude ?? order.delivery_latitude,
    longitude: order.addressDetails?.longitude ?? order.deliveryLongitude ?? order.delivery_longitude,
    geolocationAccuracy: order.addressDetails?.geolocationAccuracy
      ?? order.deliveryGeolocationAccuracy ?? order.delivery_geolocation_accuracy,
    locationSource: order.addressDetails?.locationSource
      ?? order.deliveryLocationSource ?? order.delivery_location_source,
    locationConfirmedAt: order.addressDetails?.locationConfirmedAt
      ?? order.deliveryLocationConfirmedAt ?? order.delivery_location_confirmed_at,
  });
}

export function formatAddressLabel(detailsOrText = {}, fallback = '') {
  if (typeof detailsOrText === 'string') {
    return sanitizeText(detailsOrText, { fallback: sanitizeText(fallback, { maxLength: ADDRESS_MAX }), maxLength: ADDRESS_MAX });
  }
  const streetLine = sanitizeText(detailsOrText.streetLine, { maxLength: ADDRESS_PART_MAX });
  const neighborhood = sanitizeText(detailsOrText.neighborhood, { maxLength: ADDRESS_PART_MAX });
  const label = [streetLine, neighborhood].filter(Boolean).join(', ');
  return sanitizeText(label || detailsOrText.label, {
    fallback: sanitizeText(fallback, { maxLength: ADDRESS_MAX }),
    maxLength: ADDRESS_MAX,
  });
}

export function formatAddressReference(detailsOrOrder = {}) {
  const details = detailsOrOrder?.addressDetails
    ? normalizeOrderAddressDetails(detailsOrOrder)
    : normalizeAddressDetails(detailsOrOrder);
  return details.reference;
}

export function appendReferenceToNotes(notes = '', reference = '') {
  const cleanNotes = sanitizeText(notes, { maxLength: 500 });
  const cleanReference = sanitizeText(reference, { maxLength: REFERENCE_MAX });
  if (!cleanReference) return cleanNotes || 'Sin notas';
  if (!cleanNotes || cleanNotes === 'Sin notas') return `Referencia: ${cleanReference}`;
  return `${cleanNotes}\nReferencia: ${cleanReference}`;
}

export function splitStreetAndNumber(value = '') {
  const clean = sanitizeText(value, { maxLength: ADDRESS_PART_MAX });
  const match = clean.match(/^(.*\D)\s+(\d+(?:\s*[A-Za-z])?(?:[/-]\d+(?:\s*[A-Za-z])?)?|S\/N)$/i);
  if (!match) return { street: clean, streetNumber: '' };
  return { street: match[1].trim(), streetNumber: match[2].trim() };
}
