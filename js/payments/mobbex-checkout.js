/*
 * Mobbex (checkout hosted) — lado navegador. Todo lo que decide dinero vive en el servidor:
 * el total sale de la sesión que arma la base de datos y el navegador NUNCA marca nada como pagado.
 *
 * Este módulo sólo (1) arma el pedido sin importes, (2) acepta una URL de redirección únicamente si es de Mobbex,
 * (3) recuerda en ESTE navegador qué sesión se mandó a pagar para que la página de retorno la consulte.
 * Reutiliza —sin modificarlas— la forma del pedido y la presentación de estados de Mercado Pago, que es el mismo contrato.
 */
import { buildMercadoPagoCheckoutPayload, paymentStatusPresentation } from './mercadopago-checkout.js';

export const MOBBEX_PAYMENT_METHOD = 'mobbex';
export const MOBBEX_RECORD_KEY = 'taba.mobbex.checkout.v1';
const RECORD_TTL_MS = 6 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** La persona sólo es redirigida a un https://*.mobbex.com. Cualquier otra cosa (incluida userinfo) se descarta. */
export function trustedMobbexCheckoutUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    if (!/(^|\.)mobbex\.com$/.test(host)) return '';
    return url.toString();
  } catch (_) {
    return '';
  }
}

/** Igual que Mercado Pago, sin importes; el servidor además fuerza `payment_method: 'mobbex'`. */
export function buildMobbexCheckoutPayload(args = {}) {
  return { ...buildMercadoPagoCheckoutPayload(args), payment_method: MOBBEX_PAYMENT_METHOD };
}

export const mobbexStatusPresentation = paymentStatusPresentation;

export function writeMobbexCheckoutRecord(storage, businessId, checkoutSessionId, { items = [], now = Date.now() } = {}) {
  if (!storage || !UUID.test(String(checkoutSessionId || ''))) return false;
  try {
    storage.setItem(MOBBEX_RECORD_KEY, JSON.stringify({
      v: 1,
      businessId: String(businessId || ''),
      checkoutSessionId: String(checkoutSessionId),
      items: items
        .map((item) => ({ productId: String(item?.productId || item?.product_id || ''), quantity: Math.max(0, Math.floor(Number(item?.quantity) || 0)) }))
        .filter((item) => item.productId && item.quantity > 0)
        .slice(0, 100),
      createdAt: now,
    }));
    return true;
  } catch (_) {
    return false;
  }
}

export function readMobbexCheckoutRecord(storage, { now = Date.now() } = {}) {
  if (!storage) return null;
  try {
    const record = JSON.parse(storage.getItem(MOBBEX_RECORD_KEY) || 'null');
    if (!record || record.v !== 1 || !UUID.test(String(record.checkoutSessionId || ''))) return null;
    if (!Number.isFinite(record.createdAt) || now - record.createdAt > RECORD_TTL_MS) return null;
    return {
      businessId: String(record.businessId || ''),
      checkoutSessionId: String(record.checkoutSessionId),
      items: Array.isArray(record.items) ? record.items : [],
    };
  } catch (_) {
    return null;
  }
}

export function clearMobbexCheckoutRecord(storage) {
  try { storage?.removeItem(MOBBEX_RECORD_KEY); } catch (_) { /* nothing to clear */ }
}
