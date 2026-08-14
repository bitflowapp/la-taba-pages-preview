// ─────────────────────────────────────────────────────────────────────────────
// Growth engine · EVENTOS FIRST-PARTY.
// -----------------------------------------------------------------------------
// Cola local acotada de eventos comerciales con una interfaz de transporte
// para el día que exista backend de analytics. Hoy: sirve para depurar el
// funnel (impresión → click → agregado → checkout → compra) por campaña en la
// misma sesión, sin mandar nada a ningún lado.
//
// Privacidad: los payloads llevan SOLO campos de la lista blanca (ids de
// campaña/producto/categoría, placement, timestamps). Nunca nombre, teléfono,
// dirección, ni texto libre del cliente. La query de búsqueda tampoco viaja:
// como señal alcanza con las categorías que matcheó.
import { ANALYTICS } from './growth-config.js';
import {
  getStorageArea,
  safeJsonParse,
  safeStorageGet,
  safeStorageSet,
} from '../core/storage.js';

export const GROWTH_EVENT_TYPES = Object.freeze([
  'promo_impression',
  'promo_click',
  'promo_dismiss',
  'product_view',
  'add_to_cart',
  'checkout_start',
  'purchase',
]);

const EVENT_TYPE_SET = new Set(GROWTH_EVENT_TYPES);

// Lista blanca de campos de payload. Todo lo demás se descarta al registrar.
const ALLOWED_FIELDS = Object.freeze([
  'campaignId',
  'placement',
  'productId',
  'categoryId',
  'comboId',
  'orderItems',
  'quantity',
]);

let transport = null;
let memoryQueue = null;

function text(value, maxLength = 80) {
  const clean = String(value ?? '').trim();
  return clean.length > maxLength ? '' : clean;
}

function sanitizePayload(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const clean = {};
  for (const field of ALLOWED_FIELDS) {
    if (source[field] === undefined || source[field] === null) continue;
    if (field === 'quantity' || field === 'orderItems') {
      const numeric = Math.max(0, Math.floor(Number(source[field]) || 0));
      if (numeric > 0) clean[field] = numeric;
    } else {
      const value = text(source[field]);
      if (value) clean[field] = value;
    }
  }
  return clean;
}

function loadQueue() {
  if (memoryQueue) return memoryQueue;
  const raw = safeStorageGet(getStorageArea('sessionStorage'), ANALYTICS.storageKey);
  const parsed = safeJsonParse(raw, []);
  memoryQueue = Array.isArray(parsed)
    ? parsed.filter((event) => event && EVENT_TYPE_SET.has(event.type)).slice(-ANALYTICS.maxQueuedEvents)
    : [];
  return memoryQueue;
}

function persistQueue(queue) {
  memoryQueue = queue;
  safeStorageSet(getStorageArea('sessionStorage'), ANALYTICS.storageKey, JSON.stringify(queue));
}

/**
 * Registra un evento. `now` viene del llamador (el engine): este módulo
 * tampoco lee el reloj por su cuenta.
 */
export function trackGrowthEvent(type, payload = {}, now = 0) {
  if (!EVENT_TYPE_SET.has(type)) return null;
  const event = {
    type,
    at: Number(now) || 0,
    ...sanitizePayload(payload),
  };
  const queue = [...loadQueue(), event].slice(-ANALYTICS.maxQueuedEvents);
  persistQueue(queue);
  if (typeof transport === 'function') {
    try {
      transport(event);
    } catch (_) {
      // El transporte externo jamás puede romper la tienda.
    }
  }
  return event;
}

/** Interfaz para conectar un backend real después (fase 2). */
export function setGrowthAnalyticsTransport(fn) {
  transport = typeof fn === 'function' ? fn : null;
}

export function getGrowthEvents() {
  return [...loadQueue()];
}

export function clearGrowthEvents() {
  persistQueue([]);
}

/**
 * Funnel por campaña sobre la cola local (alcance: sesión). Honesto sobre su
 * alcance: no afirma conversión histórica, muestra lo que esta sesión vio.
 */
export function getGrowthFunnel() {
  const funnel = {};
  for (const event of loadQueue()) {
    const key = event.campaignId || '(sin campaña)';
    if (!funnel[key]) {
      funnel[key] = {
        promo_impression: 0,
        promo_click: 0,
        promo_dismiss: 0,
        add_to_cart: 0,
        checkout_start: 0,
        purchase: 0,
      };
    }
    if (funnel[key][event.type] !== undefined) funnel[key][event.type] += 1;
  }
  return funnel;
}

export function resetGrowthAnalyticsForTests() {
  memoryQueue = null;
  transport = null;
}
