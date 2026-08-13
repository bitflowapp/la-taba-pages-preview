import { getBusinessConfig } from './business-config-store.js';
import { isDemoMode } from './app-mode.js';
import { serverDeliveryFee } from './commerce-availability-store.js';

export function normalizeDeliveryMode(value) {
  return value === 'pickup' ? 'pickup' : 'delivery';
}

export function normalizeStock(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
}

export function normalizeQuantity(value, fallback = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.floor(numeric));
}

export function normalizeMoneyValue(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.round(numeric));
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRATO DE ESTADO COMERCIAL DEL PRECIO Y DEL STOCK
//
// POR QUÉ EXISTE
// --------------
// «Sin precio» y «vale cero pesos» son cosas distintas, y en JavaScript se
// escriben igual: `Number(null)`, `Number('')` y `Number(undefined)` valen 0.
// La columna de la base tampoco ayuda —`products.price` es `not null check
// (price >= 0)`, así que un producto sin precio se guarda como 0— y el estado
// explícito vive en otra columna, `price_status`.
//
// Estas funciones son el único lugar donde se decide si un producto tiene
// precio. Todo lo demás pregunta acá. La regla vale para las dos direcciones:
//
//   · un `price_status = 'pending'` es pendiente aunque traiga un número;
//   · un precio que no es un número mayor a cero es pendiente aunque el estado
//     diga «confirmed». Si el backend manda una fila incoherente, la tienda
//     falla cerrada en vez de ofrecer algo a $ 0.
// ─────────────────────────────────────────────────────────────────────────────

export const PRICE_PENDING_TITLE = 'Precio próximamente';
export const PRICE_PENDING_DETAIL = 'Este producto todavía no está disponible para compra.';

export function isPricePending(product) {
  if (!product || typeof product !== 'object') return true;
  if (product.pricePending === true) return true;
  // Los dos nombres se miran por separado y CUALQUIERA que diga «pending»
  // gana. Con `??` bastaba que la variante en camelCase dijera «confirmed»
  // para tapar una snake_case que decía lo contrario, y entre dos fuentes que
  // se contradicen sobre si algo se puede vender hay que creerle a la que dice
  // que no.
  const states = [product.priceStatus, product.price_status]
    .map((value) => String(value ?? '').trim().toLowerCase());
  if (states.includes('pending')) return true;
  const amount = Number(product.price);
  return !Number.isFinite(amount) || amount <= 0;
}

/** El precio, o `null` si está pendiente. Nunca devuelve cero por ausencia. */
export function confirmedPrice(product) {
  if (isPricePending(product)) return null;
  return normalizeMoneyValue(product.price, 0);
}

/**
 * El stock se declara ausente con `null`, no con cero: cero es «se agotó» y
 * null es «nadie lo contó todavía». Son estados distintos y la diferencia
 * importa, porque uno se resuelve reponiendo y el otro contando.
 */
export function isStockPending(product) {
  if (!product || typeof product !== 'object') return true;
  const value = product.stock;
  if (value === null || value === undefined || value === '') return true;
  const numeric = Number(value);
  return !Number.isFinite(numeric);
}

export function knownStock(product) {
  if (isStockPending(product)) return null;
  return Math.max(0, Math.floor(Number(product.stock)));
}

/**
 * La compuerta comercial completa, del lado del cliente. El servidor impone la
 * misma en `products_available_requires_commercial_price`; ésta existe para que
 * la tienda no ofrezca lo que el servidor va a rechazar.
 */
export function isCommerciallyPurchasable(product) {
  if (!product || typeof product !== 'object') return false;
  if (isPricePending(product)) return false;
  const stock = knownStock(product);
  if (stock === null || stock <= 0) return false;
  return product.available === true && product.archived !== true;
}

export function getDeliveryFeeForMode(deliveryMode = 'delivery') {
  if (normalizeDeliveryMode(deliveryMode) === 'pickup') return 0;
  // Si el backend ya resolvió la zona de ESTA dirección, ese número manda. La
  // columna del negocio es el valor por defecto de las zonas que no definen el
  // suyo; mostrarla cuando la zona ya dijo otra cosa sería anunciar un precio y
  // cobrar otro. Quien cobra es el backend en las dos rutas de alta.
  const resolved = serverDeliveryFee('delivery');
  if (resolved !== null) return resolved;
  const config = getBusinessConfig();
  if (!isDemoMode() && !config.orderingDetailsVerified) return 0;
  return normalizeMoneyValue(config.deliveryFee);
}

export function calculateItemsSubtotal(items = []) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, item) => {
    const rawQuantity = Number(item?.quantity);
    const quantity = Number.isFinite(rawQuantity) ? Math.max(0, Math.floor(rawQuantity)) : 0;
    const unitPrice = normalizeMoneyValue(item?.unitPrice ?? item?.product?.price, 0);
    return sum + quantity * unitPrice;
  }, 0);
}

export function normalizeDiscountAmount(value, subtotal = 0) {
  const safeSubtotal = normalizeMoneyValue(subtotal, 0);
  const discount = normalizeMoneyValue(value, 0);
  return Math.min(safeSubtotal, discount);
}

export function calculateTotals(itemsOrSubtotal = [], deliveryMode = 'delivery', options = {}) {
  const subtotal = Array.isArray(itemsOrSubtotal)
    ? calculateItemsSubtotal(itemsOrSubtotal)
    : normalizeMoneyValue(itemsOrSubtotal, 0);
  const deliveryFee = getDeliveryFeeForMode(deliveryMode);
  const discountTotal = normalizeDiscountAmount(options.discountAmount ?? options.discountTotal, subtotal);
  return {
    subtotal,
    discountTotal,
    deliveryFee,
    total: Math.max(0, subtotal - discountTotal) + deliveryFee,
  };
}
