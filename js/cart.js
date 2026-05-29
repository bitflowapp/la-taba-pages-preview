import { BUSINESS_CONFIG } from './config.js';
import {
  calculateTotals,
  getDeliveryFeeForMode,
  normalizeDeliveryMode,
  normalizeQuantity,
} from './core/pricing.js';
import { getProductById, getState, money, setState, updateState } from './state.js';

function productIsOrderable(product) {
  return Boolean(product && product.available && Number(product.stock) > 0);
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

export function getCartSummary(deliveryMode = 'delivery') {
  const items = getCartItems();
  const pricingItems = items.map((item) => ({
    quantity: item.quantity,
    unitPrice: item.product.price,
  }));
  const totals = items.length
    ? calculateTotals(pricingItems, deliveryMode)
    : { subtotal: 0, deliveryFee: 0, total: 0 };
  return {
    items,
    count: items.reduce((sum, item) => sum + item.quantity, 0),
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
  setState({ cart: [] });
  return { ok: true, message: 'Carrito vaciado.' };
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

  if (normalizedDeliveryMode === 'delivery' && subtotal < BUSINESS_CONFIG.minDeliveryOrder) {
    const missing = BUSINESS_CONFIG.minDeliveryOrder - subtotal;
    return {
      ok: false,
      message: `Te faltan ${money(missing)} para llegar al pedido mínimo de delivery. También podés elegir retiro en local.`,
    };
  }

  return { ok: true, message: 'Pedido listo para confirmar.' };
}
