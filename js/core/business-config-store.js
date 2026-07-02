// Business Config Store v1
// -------------------------
// Convierte la identidad/operación del comercio (hoy en la constante congelada
// BUSINESS_CONFIG) en una config de RUNTIME, editable, saneada y versionada.
// La constante BUSINESS_CONFIG queda SOLO como semilla por defecto; deja de ser
// la fuente de verdad en runtime.
//
// Alcance v1 (deliberado):
//  - Editable: identidad y operación del comercio
//    (nombre, subtítulo, dirección, WhatsApp, horarios, zona, costo de envío,
//     pedido mínimo, moneda, prefijo de pedido, PIN, ubicación del local).
//  - NO editable acá (se preserva tal cual desde la semilla): infraestructura de
//    mapa/demo (mapProvider, defaultMapBounds, demoDestinations,
//    demoStreetTestDestinations, demoCategories, defaultDeliveryZones).
//    Mantenerlas fuera del alcance evita tocar el rider/mapa/tracking honesto.
//
// Este módulo es una hoja: solo depende de config.js (semilla) y validators.js
// (saneo de texto). No importa state.js ni pricing.js, así cualquier consumidor
// puede leer la config sin ciclos de import.
import { BUSINESS_CONFIG } from '../config.js';
import { sanitizeText } from './validators.js';

export const BUSINESS_CONFIG_SCHEMA_VERSION = 1;

function deepClone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    deepFreeze(value[key]);
  }
  return value;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

// Snapshot mutable de la semilla (BUSINESS_CONFIG es frozen y poco profundo).
const SEED = deepClone(BUSINESS_CONFIG);

// ----- helpers de saneo (sin dependencias de pricing/state) -----
function sanitizeString(value, fallback, maxLength) {
  return sanitizeText(value, { fallback: fallback ?? '', maxLength });
}

function sanitizeMoney(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : fallback;
}

function sanitizeHour(value, fallback) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 && numeric <= 24 ? numeric : fallback;
}

function sanitizeCurrency(value, fallback) {
  const code = String(value ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  return code.length === 3 ? code : fallback;
}

function sanitizeOrderPrefix(value, fallback) {
  const prefix = String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  return prefix || fallback;
}

function sanitizePin(value, fallback) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 4 && digits.length <= 6 ? digits : fallback;
}

function sanitizeWhatsapp(value, fallback) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 20 ? digits : fallback;
}

function sanitizeBool(value, fallback) {
  return typeof value === 'boolean' ? value : Boolean(fallback);
}

function sanitizeCoordinate(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function sanitizeLocation(value, fallback) {
  const base = isPlainObject(fallback) ? fallback : {};
  if (!isPlainObject(value)) return deepClone(base);
  return {
    ...deepClone(base),
    name: sanitizeString(value.name, base.name ?? '', 120),
    lat: sanitizeCoordinate(value.lat, base.lat),
    lng: sanitizeCoordinate(value.lng, base.lng),
  };
}

// Campos editables (identidad/operación). El resto se preserva desde el fallback.
function sanitizeEditableFields(source, base) {
  const businessName = sanitizeString(
    source.businessName,
    sanitizeString(source.name, base.businessName, 80),
    80,
  );
  const openingHoursLabel = sanitizeString(
    source.openingHoursLabel,
    sanitizeString(source.openingHours, base.openingHoursLabel, 120),
    120,
  );

  return {
    businessName,
    name: businessName,
    subtitle: sanitizeString(source.subtitle, base.subtitle, 80),
    address: sanitizeString(source.address, base.address, 180),
    whatsappNumber: sanitizeWhatsapp(source.whatsappNumber, base.whatsappNumber),
    whatsappVerified: sanitizeBool(source.whatsappVerified, base.whatsappVerified),
    deliveryZone: sanitizeString(source.deliveryZone, base.deliveryZone, 160),
    openingHoursLabel,
    openingHours: openingHoursLabel,
    openHour: sanitizeHour(source.openHour, base.openHour),
    closeHour: sanitizeHour(source.closeHour, base.closeHour),
    deliveryFee: sanitizeMoney(source.deliveryFee, base.deliveryFee),
    minDeliveryOrder: sanitizeMoney(source.minDeliveryOrder, base.minDeliveryOrder),
    orderingDetailsVerified: sanitizeBool(source.orderingDetailsVerified, base.orderingDetailsVerified),
    currency: sanitizeCurrency(source.currency, base.currency),
    orderPrefix: sanitizeOrderPrefix(source.orderPrefix, base.orderPrefix),
    adminPin: sanitizePin(source.adminPin, base.adminPin),
    businessLocationVerified: sanitizeBool(source.businessLocationVerified, base.businessLocationVerified),
    businessLocation: sanitizeLocation(source.businessLocation, base.businessLocation),
  };
}

// Devuelve una config completa: preserva todo lo del fallback (incluida la
// infraestructura mapa/demo) y sobreescribe los campos editables ya saneados.
export function normalizeBusinessConfig(raw, fallback) {
  const base = isPlainObject(fallback) ? fallback : deepClone(SEED);
  const source = isPlainObject(raw) ? raw : {};
  return {
    ...deepClone(base),
    ...sanitizeEditableFields(source, base),
  };
}

export function buildDefaultBusinessConfig() {
  return normalizeBusinessConfig(deepClone(SEED), deepClone(SEED));
}

// Mergea un patch parcial sobre una base, saneando el resultado.
export function mergeBusinessConfig(base, saved) {
  const safeBase = isPlainObject(base) ? base : deepClone(SEED);
  const patch = isPlainObject(saved) ? { ...saved } : {};

  if (Object.prototype.hasOwnProperty.call(patch, 'businessName') || Object.prototype.hasOwnProperty.call(patch, 'name')) {
    const canonicalBusinessName = sanitizeString(patch.businessName, sanitizeString(patch.name, '', 80), 80);
    patch.businessName = canonicalBusinessName;
    patch.name = canonicalBusinessName;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'openingHoursLabel') || Object.prototype.hasOwnProperty.call(patch, 'openingHours')) {
    const canonicalOpeningHours = sanitizeString(patch.openingHoursLabel, sanitizeString(patch.openingHours, '', 120), 120);
    patch.openingHoursLabel = canonicalOpeningHours;
    patch.openingHours = canonicalOpeningHours;
  }

  const merged = { ...safeBase, ...patch };
  return normalizeBusinessConfig(merged, safeBase);
}

// ----- holder runtime (fuente de verdad en memoria) -----
let runtimeConfig = buildDefaultBusinessConfig();
let runtimeSnapshot = deepFreeze(deepClone(runtimeConfig));

export function getBusinessConfig() {
  return runtimeSnapshot;
}

// Sincroniza el holder con la config ya saneada del estado. Idempotente.
// state.js la llama en cada commit para mantener el holder al día.
export function setRuntimeBusinessConfig(config) {
  runtimeConfig = normalizeBusinessConfig(config, runtimeConfig);
  runtimeSnapshot = deepFreeze(deepClone(runtimeConfig));
  return runtimeSnapshot;
}
