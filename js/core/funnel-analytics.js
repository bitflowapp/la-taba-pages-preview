/*
 * Customer Funnel Instrumentation (Privacy-Preserving Telemetry)
 * --------------------------------------------------------------
 * Tracks aggregate purchasing funnel lifecycle events:
 *   HOME_VIEW, SEARCH_USED, PRODUCT_ADDED, CART_OPENED,
 *   CHECKOUT_STARTED, ADDRESS_COMPLETED, ORDER_SUBMIT_ATTEMPT,
 *   PAYMENT_HANDOFF, ORDER_CREATED, ORDER_FAILED, REPEAT_ORDER_USED
 *
 * ALCANCE — LEER ANTES DE USAR ESTO PARA DECIDIR ALGO:
 *
 * Es un contador LOCAL DEL NAVEGADOR, no analítica centralizada. No hay
 * transporte: ni `fetch`, ni `sendBeacon`, ni escritura a Supabase. Lo que se
 * registra vive en el `localStorage` DEL TELÉFONO DE CADA CLIENTE y no sale de
 * ahí. `TABA_FUNNEL.getSummary()` en la consola devuelve el embudo DE ESE
 * dispositivo, nunca el de la tienda.
 *
 * Para diagnosticar un incidente real de producción la fuente son las tablas
 * del servidor —`order_events`, `payment_events`, `payment_webhook_receipts`,
 * `operational_alerts`—, no este módulo. Ver docs/OPERATIONAL-RUNBOOK.md §5.
 *
 * PRIVACY GUARANTEES:
 * - NO customer name
 * - NO phone number
 * - NO address text or street details
 * - NO payment credentials or card details
 * - NO tokens or secrets
 *
 * El filtro es por NOMBRE DE CLAVE, no por valor: quien mande texto libre en
 * una clave no listada lo persiste igual. Los emisores de este repositorio
 * mandan sólo identificadores, conteos y totales.
 */

import { safeJsonParse, safeStorageGet, safeStorageSet } from './storage.js';

export const FUNNEL_EVENTS = Object.freeze({
  HOME_VIEW: 'HOME_VIEW',
  SEARCH_USED: 'SEARCH_USED',
  PRODUCT_ADDED: 'PRODUCT_ADDED',
  CART_OPENED: 'CART_OPENED',
  CHECKOUT_STARTED: 'CHECKOUT_STARTED',
  ADDRESS_COMPLETED: 'ADDRESS_COMPLETED',
  ORDER_SUBMIT_ATTEMPT: 'ORDER_SUBMIT_ATTEMPT',
  /*
   * El cliente fue entregado a Mercado Pago. NO es un pedido creado: todavía
   * no pagó, y puede abandonar. Separarlo de ORDER_CREATED es lo que evita que
   * el embudo informe 100 % de conversión durante una caída del proveedor.
   */
  PAYMENT_HANDOFF: 'PAYMENT_HANDOFF',
  ORDER_CREATED: 'ORDER_CREATED',
  ORDER_FAILED: 'ORDER_FAILED',
  REPEAT_ORDER_USED: 'REPEAT_ORDER_USED',
});

const STORAGE_KEY = 'taba_customer_funnel_v1';
const MAX_BUFFERED_EVENTS = 50;

const FORBIDDEN_KEY_PATTERN = /(name|phone|address|street|neighborhood|reference|token|secret|password|card|cvv|credential)/i;

/**
 * Strips any potential PII or sensitive keys recursively.
 */
export function sanitizeFunnelMetadata(data) {
  if (!data || typeof data !== 'object') return {};
  if (Array.isArray(data)) {
    return data.slice(0, 10).map((item) => (typeof item === 'object' ? sanitizeFunnelMetadata(item) : item));
  }

  const clean = {};
  for (const [key, value] of Object.entries(data)) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) continue;

    if (value === null || value === undefined) {
      continue;
    } else if (typeof value === 'boolean' || typeof value === 'number') {
      clean[key] = value;
    } else if (typeof value === 'string') {
      clean[key] = value.trim().slice(0, 120);
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      clean[key] = sanitizeFunnelMetadata(value);
    }
  }
  return clean;
}

let inMemoryCounts = {};
let inMemoryRecent = [];

function loadFunnelState() {
  if (typeof window === 'undefined') return;
  try {
    const raw = safeStorageGet(window.localStorage, STORAGE_KEY);
    if (!raw) return;
    const parsed = safeJsonParse(raw, null);
    if (parsed && typeof parsed.counts === 'object') {
      inMemoryCounts = { ...parsed.counts };
      inMemoryRecent = Array.isArray(parsed.recent) ? parsed.recent.slice(-MAX_BUFFERED_EVENTS) : [];
    }
  } catch (_) {
    // Storage fallback
  }
}

function persistFunnelState() {
  if (typeof window === 'undefined') return;
  try {
    safeStorageSet(window.localStorage, STORAGE_KEY, JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      counts: inMemoryCounts,
      recent: inMemoryRecent,
    }));
  } catch (_) {
    // Non-blocking
  }
}

// Initial hydration
loadFunnelState();

/**
 * Records a customer funnel event.
 */
export function recordFunnelEvent(eventName, metadata = {}) {
  if (!Object.values(FUNNEL_EVENTS).includes(eventName)) return null;

  const safeMeta = sanitizeFunnelMetadata(metadata);
  const timestamp = new Date().toISOString();

  inMemoryCounts[eventName] = (inMemoryCounts[eventName] || 0) + 1;

  const record = {
    event: eventName,
    timestamp,
    ...safeMeta,
  };

  inMemoryRecent.push(record);
  if (inMemoryRecent.length > MAX_BUFFERED_EVENTS) {
    inMemoryRecent.shift();
  }

  persistFunnelState();

  if (typeof console !== 'undefined' && typeof console.info === 'function') {
    try {
      console.info(`[TABA_FUNNEL] ${eventName}`, safeMeta);
    } catch (_) {}
  }

  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent('taba:funnel', { detail: record }));
    } catch (_) {}
  }

  return record;
}

/**
 * Returns current aggregate summary of the customer funnel.
 */
export function getFunnelSummary() {
  return {
    counts: { ...inMemoryCounts },
    recentCount: inMemoryRecent.length,
    recentEvents: inMemoryRecent.slice(),
  };
}

/**
 * Resets funnel statistics (useful for tests or sessions).
 */
export function clearFunnelEvents() {
  inMemoryCounts = {};
  inMemoryRecent = [];
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
  }
}
