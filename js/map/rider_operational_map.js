import { normalizeOrderAddressDetails } from '../core/address.js';

const riderMapContexts = new Map();
const IOS_USER_AGENT = /iPad|iPhone|iPod/i;
const IOS_PLATFORM = /^Mac/i;

export function normalizeOperationalMapPoint(point) {
  if (!point || typeof point !== 'object') return null;
  const rawLat = point.lat ?? point.latitude;
  const rawLng = point.lng ?? point.longitude;
  if (rawLat === '' || rawLat === null || rawLat === undefined) return null;
  if (rawLng === '' || rawLng === null || rawLng === undefined) return null;
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (
    !Number.isFinite(lat)
    || !Number.isFinite(lng)
    || lat < -90
    || lat > 90
    || lng < -180
    || lng > 180
    || (lat === 0 && lng === 0)
  ) {
    return null;
  }
  return {
    ...point,
    lat,
    lng,
  };
}

export function customerDestinationForOrder(order = {}) {
  const candidates = [
    order.destinationLocation,
    order.deliveryLocation,
    order.customerLocation,
    order.addressLocation,
    order.addressDetails?.location,
    {
      latitude: order.deliveryLatitude ?? order.delivery_latitude,
      longitude: order.deliveryLongitude ?? order.delivery_longitude,
      accuracy: order.deliveryGeolocationAccuracy ?? order.delivery_geolocation_accuracy,
    },
    {
      latitude: order.addressLatitude ?? order.address_latitude ?? order.address_lat,
      longitude: order.addressLongitude ?? order.address_longitude ?? order.address_lng,
    },
  ];
  for (const candidate of candidates) {
    const point = normalizeOperationalMapPoint(candidate);
    if (point) return { ...point, label: point.label || 'Cliente' };
  }
  return null;
}

export function businessLocationForMap(config = {}) {
  if (config.businessLocationVerified !== true) return null;
  const point = normalizeOperationalMapPoint(config.businessLocation);
  return point ? { ...point, label: point.label || point.name || 'Negocio' } : null;
}

export function riderLocationForMap(location = {}) {
  const point = normalizeOperationalMapPoint(location);
  if (!point) return null;
  return {
    ...point,
    source: point.source || 'gps',
    origin: point.origin || 'local_gps',
    lastFixAt: point.lastFixAt || point.timestamp || new Date().toISOString(),
  };
}

export function buildRiderMapContext(order = {}, {
  businessConfig = {},
  localLocation = null,
} = {}) {
  const persistedLocation = order.tracking?.lastLocation || null;
  const riderLocation = riderLocationForMap(localLocation)
    || riderLocationForMap(persistedLocation);
  const destination = customerDestinationForOrder(order);
  const store = businessLocationForMap(businessConfig);
  return {
    orderId: String(order.id || ''),
    riderLocation,
    destination,
    store,
    priority: isBeforePickup(order) ? 'business' : 'client',
  };
}

export function setRiderMapContext(orderId, context = {}) {
  const key = String(orderId || '');
  if (!key) return null;
  const normalized = {
    ...context,
    orderId: key,
    riderLocation: riderLocationForMap(context.riderLocation),
    destination: normalizeOperationalMapPoint(context.destination),
    store: normalizeOperationalMapPoint(context.store),
  };
  riderMapContexts.set(key, normalized);
  return normalized;
}

export function getRiderMapContext(orderId) {
  return riderMapContexts.get(String(orderId || '')) || null;
}

export function retainRiderMapContexts(orderIds = []) {
  const keep = new Set([...orderIds].map((value) => String(value || '')).filter(Boolean));
  for (const key of riderMapContexts.keys()) {
    if (!keep.has(key)) riderMapContexts.delete(key);
  }
}

export function clearRiderMapContexts() {
  riderMapContexts.clear();
}

export function formatRiderDeliveryAddress(order = {}) {
  const details = normalizeOrderAddressDetails(order);
  const primary = cleanDisplayText(details.streetLine || details.label || order.address);
  const candidates = [
    details.neighborhood,
    order.locality,
    order.city,
    order.addressDetails?.floor ? `Piso ${order.addressDetails.floor}` : '',
    order.addressDetails?.apartment ? `Depto. ${order.addressDetails.apartment}` : '',
    details.reference ? `Referencia: ${details.reference}` : '',
    deliveryInstructions(order),
  ];
  const seen = new Set([primary.toLocaleLowerCase('es-AR')]);
  const secondary = [];
  for (const candidate of candidates) {
    const value = cleanDisplayText(candidate);
    const key = value.toLocaleLowerCase('es-AR');
    if (!value || seen.has(key)) continue;
    seen.add(key);
    secondary.push(value);
  }
  return {
    primary: primary || 'Dirección no informada',
    secondary,
    hasAddress: Boolean(primary),
  };
}

export function buildExternalNavigationUrl({
  destination,
  address = '',
  navigatorRef = globalThis.navigator,
} = {}) {
  const point = normalizeOperationalMapPoint(destination);
  if (!point) return '';
  const coordinateQuery = encodeURIComponent(`${formatCoordinate(point.lat)},${formatCoordinate(point.lng)}`);
  const addressQuery = encodeURIComponent(cleanDisplayText(address));
  if (isAppleMapsDevice(navigatorRef)) {
    const label = addressQuery ? `&q=${addressQuery}` : '';
    return `https://maps.apple.com/?daddr=${coordinateQuery}${label}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${coordinateQuery}`;
}

export function straightLineDistanceLabel(from, to) {
  const origin = normalizeOperationalMapPoint(from);
  const destination = normalizeOperationalMapPoint(to);
  if (!origin || !destination) return '';
  const meters = haversineDistanceMeters(origin, destination);
  if (!Number.isFinite(meters)) return '';
  if (meters < 1_000) return `${Math.max(1, Math.round(meters / 10) * 10)} m`;
  const kilometers = meters / 1_000;
  const digits = kilometers < 10 ? 1 : 0;
  return `${kilometers.toFixed(digits).replace('.', ',')} km`;
}

export function riderDistanceAndEtaLabel(order = {}, riderLocation, destination) {
  const distance = straightLineDistanceLabel(riderLocation, destination);
  const eta = trustedEtaMinutes(order);
  if (distance && eta) return `${distance} · ${eta} min`;
  return distance;
}

export function shortOrderLabel(order = {}) {
  const value = String(order.publicCode || order.code || order.id || '').trim();
  if (!value) return '';
  if (value.length <= 12) return value;
  return `…${value.slice(-8)}`;
}

function isBeforePickup(order = {}) {
  const status = String(order.workflowStatus || order.status || '').toLowerCase();
  return ['ready', 'assigned'].includes(status);
}

function isAppleMapsDevice(navigatorRef) {
  const userAgent = String(navigatorRef?.userAgent || '');
  const platform = String(navigatorRef?.platform || '');
  const touchPoints = Number(navigatorRef?.maxTouchPoints || 0);
  return IOS_USER_AGENT.test(userAgent)
    || (IOS_PLATFORM.test(platform) && touchPoints > 1);
}

function deliveryInstructions(order = {}) {
  const value = cleanDisplayText(
    order.deliveryInstructions
    || order.customerInstructions
    || order.notes,
  );
  return value && !/^sin (notas|indicaciones)/i.test(value)
    ? value
    : '';
}

function trustedEtaMinutes(order = {}) {
  const value = Number(order.delivery?.etaMinutes);
  const source = String(order.delivery?.etaSource || '');
  if (!Number.isFinite(value) || value <= 0 || !source) return null;
  return Math.max(1, Math.round(value));
}

function formatCoordinate(value) {
  return Number(value).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function cleanDisplayText(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text || /^(?:null|undefined|nan)$/i.test(text)) return '';
  return text;
}

function haversineDistanceMeters(from, to) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const lat1 = radians(from.lat);
  const lat2 = radians(to.lat);
  const deltaLat = lat2 - lat1;
  const deltaLng = radians(to.lng - from.lng);
  const a = (Math.sin(deltaLat / 2) ** 2)
    + (Math.cos(lat1) * Math.cos(lat2) * (Math.sin(deltaLng / 2) ** 2));
  const clamped = Math.min(1, Math.max(0, a));
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(clamped), Math.sqrt(1 - clamped));
}
