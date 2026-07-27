import { getBusinessConfig } from './core/business-config-store.js';
import {
  calculateTotals,
  getDeliveryFeeForMode,
  normalizeDeliveryMode,
  normalizeQuantity,
} from './core/pricing.js';
import { isProductOrderable } from './core/catalog-store.js';
import {
  findCustomerOrder,
  getLatestCustomerOrder,
} from './core/customer-history.js';
import { evaluatePromotions, previewCouponDiscount } from './core/promotions.js';
import { buildPendingReorder, buildReorderPreview } from './core/reorder.js';
import { isDemoMode } from './core/app-mode.js';
import { getProductById, getState, money, setState, updateState } from './state.js';

function productIsOrderable(product) {
  return isProductOrderable(product);
}

function normalizeRequestedQuantity(quantity) {
  const numeric = Number(quantity);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return normalizeQuantity(numeric);
}

export function getCartItems() {
  const state = getState();
  const productsById = new Map(state.products.map((product) => [product.id, product]));
  return state.cart
    .map((item) => {
      const product = productsById.get(item.productId);
      return product ? { ...item, product } : null;
    })
    .filter(Boolean);
}

export function getCartSummary(deliveryMode = 'delivery', options = {}) {
  const items = getCartItems();
  const normalizedDeliveryMode = normalizeDeliveryMode(deliveryMode);
  const pricingItems = items.map((item) => ({
    quantity: item.quantity,
    unitPrice: item.product.price,
  }));
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.product.price, 0);
  const promotion = isDemoMode()
    ? evaluatePromotions(items, getState().promotions)
    : { discountTotal: 0, freeDelivery: false, applied: [], activePromotions: [] };
  const coupon = previewCouponDiscount(options.couponCode, subtotal);
  const discountAmount = promotion.discountTotal + coupon.discountAmount;
  const calculated = items.length
    ? calculateTotals(pricingItems, normalizedDeliveryMode, { discountAmount })
    : { subtotal: 0, discountTotal: 0, deliveryFee: 0, total: 0 };
  const totals = promotion.freeDelivery && normalizedDeliveryMode === 'delivery'
    ? {
      ...calculated,
      deliveryFee: 0,
      total: Math.max(0, calculated.total - calculated.deliveryFee),
    }
    : calculated;
  return {
    items,
    count: items.reduce((sum, item) => sum + item.quantity, 0),
    coupon,
    promotion,
    promotions: promotion.applied,
    ...totals,
  };
}

export function getCartCount() {
  return getCartSummary().count;
}

export function getCartSubtotal() {
  return getCartSummary().subtotal;
}

export function getDeliveryFee(deliveryMode = 'delivery') {
  return getDeliveryFeeForMode(deliveryMode);
}

export function getCartTotal(deliveryMode = 'delivery') {
  return getCartSummary(deliveryMode).total;
}

export function canAddProduct(productId, quantity = 1) {
  const product = getProductById(productId);
  const requestedQuantity = normalizeRequestedQuantity(quantity);
  if (!productIsOrderable(product) || requestedQuantity <= 0) return false;
  const current = getCartItems().find((item) => item.productId === productId)?.quantity || 0;
  return current + requestedQuantity <= product.stock;
}

export function addToCart(productId, quantity = 1) {
  const product = getProductById(productId);
  const requestedQuantity = normalizeRequestedQuantity(quantity);

  if (requestedQuantity <= 0) {
    return { ok: false, message: 'Indicá una cantidad válida.' };
  }

  if (!productIsOrderable(product)) {
    return { ok: false, message: 'Este producto no está disponible.' };
  }

  const current = getCartItems().find((item) => item.productId === productId)?.quantity || 0;
  const nextQuantity = current + requestedQuantity;

  if (nextQuantity > product.stock) {
    return { ok: false, message: `Stock disponible: ${product.stock}.` };
  }

  updateState((draft) => {
    const existing = draft.cart.find((item) => item.productId === productId);
    if (existing) {
      existing.quantity = nextQuantity;
    } else {
      draft.cart.push({ productId, quantity: requestedQuantity });
    }
  });

  return { ok: true, message: `${product.name} agregado al pedido.` };
}

export function incrementCartItem(productId) {
  return addToCart(productId, 1);
}

export function decrementCartItem(productId) {
  const existing = getState().cart.find((item) => item.productId === productId);
  if (!existing) return { ok: false, message: 'El producto ya no está en el carrito.' };

  updateState((draft) => {
    const item = draft.cart.find((candidate) => candidate.productId === productId);
    if (!item) return;
    item.quantity -= 1;
    if (item.quantity <= 0) {
      draft.cart = draft.cart.filter((candidate) => candidate.productId !== productId);
    }
  });

  return { ok: true, message: 'Cantidad actualizada.' };
}

export function removeCartItem(productId) {
  const existed = getState().cart.some((item) => item.productId === productId);
  if (!existed) return { ok: false, message: 'El producto ya no está en el carrito.' };

  updateState((draft) => {
    draft.cart = draft.cart.filter((item) => item.productId !== productId);
  });

  return { ok: true, message: 'Producto quitado del pedido.' };
}

export function clearCart() {
  if (getState().cart.length === 0) return { ok: true, message: 'El carrito ya estaba vacío.' };
  setState({ cart: [], pendingReorder: null });
  return { ok: true, message: 'Carrito vaciado.' };
}

export function repeatCustomerOrder(orderId = '', { force = false } = {}) {
  const order = getRepeatableCustomerOrder(orderId);
  if (!order) {
    return { ok: false, message: 'No hay pedidos anteriores para repetir.', skipped: [] };
  }

  // Si el carrito tiene productos, no lo reemplazamos en silencio: pedimos
  // confirmación explícita (force) para no perder lo que el cliente ya cargó.
  if (!force && getState().cart.length > 0) {
    return {
      ok: false,
      needsConfirmation: true,
      orderId: order.id,
      order,
      skipped: [],
      message: 'Repetir este pedido reemplazará los productos que ya tenés en el carrito.',
    };
  }

  const preview = buildReorderPreview(order, getState().products);
  const cartItems = preview.items.map((item) => ({ productId: item.productId, quantity: item.quantity }));
  const skipped = preview.skipped;
  if (!cartItems.length) {
    return {
      ok: false,
      skipped,
      message: repeatSkippedMessage(skipped) || 'No se pudo repetir el pedido: los productos ya no están disponibles.',
    };
  }

  setState({
    cart: cartItems,
    pendingReorder: buildPendingReorder(order, preview),
  });
  const skippedMessage = repeatSkippedMessage(skipped);
  const priceMessage = preview.priceChanged ? ' Algunos precios pueden haber cambiado.' : '';
  return {
    ok: true,
    order,
    preview,
    skipped,
    message: skippedMessage
      ? `Carrito armado con precios actuales.${priceMessage} ${skippedMessage}`
      : `Carrito armado con precios actuales.${priceMessage}`,
  };
}

// La recompra normal se apoya en el historial con consentimiento. En la
// sandbox, el pedido ya vive de forma explícita en su estado persistente:
// permitimos rearmar sólo sus productos aun cuando el cliente haya elegido no
// recordar sus datos. Fuera de ?demo=1 no existe este fallback.
export function getRepeatableCustomerOrder(orderId = '') {
  const knownOrder = orderId ? findCustomerOrder(orderId) : getLatestCustomerOrder();
  if (knownOrder) return knownOrder;
  if (!isDemoMode()) return null;

  const orders = getState().orders || [];
  if (orderId) {
    return orders.find((order) => (
      order.id === orderId
      && order.status === 'delivered'
      && !order.internalSeed
    )) || null;
  }
  return orders.find((order) => order.status === 'delivered' && !order.internalSeed) || null;
}

export function validateCartForCheckout(deliveryMode = 'delivery') {
  const normalizedDeliveryMode = normalizeDeliveryMode(deliveryMode);
  const { items, subtotal } = getCartSummary(normalizedDeliveryMode);

  if (items.length === 0) {
    return { ok: false, message: 'Agregá al menos un producto para confirmar el pedido.' };
  }

  const unavailableItem = items.find((item) => (
    !item.product.available
      || item.product.stock <= 0
      || item.quantity <= 0
      || item.quantity > item.product.stock
  ));
  if (unavailableItem) {
    return {
      ok: false,
      message: `${unavailableItem.product.name} no tiene stock suficiente. Ajustá el carrito antes de confirmar.`,
    };
  }

  const config = getBusinessConfig();
  const enforceMinimum = isDemoMode() || config.orderingDetailsVerified;
  if (normalizedDeliveryMode === 'delivery' && enforceMinimum && subtotal < config.minDeliveryOrder) {
    const missing = config.minDeliveryOrder - subtotal;
    return {
      ok: false,
      message: `Te faltan ${money(missing)} para llegar al pedido mínimo de delivery. También podés elegir retiro en local.`,
    };
  }

  return { ok: true, message: 'Pedido listo para confirmar.' };
}

function repeatSkippedMessage(skipped = []) {
  if (!Array.isArray(skipped) || !skipped.length) return '';
  const list = skipped
    .map((item) => `${item.name} (${item.reason})`)
    .join(', ');
  return `No se agregaron: ${list}.`;
}
