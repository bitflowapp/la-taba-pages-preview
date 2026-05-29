import { BUSINESS_CONFIG } from './config.js';
import { getProductById, getState, money, setState, updateState } from './state.js';

export function getCartItems() {
  const state = getState();
  return state.cart
    .map((item) => {
      const product = state.products.find((candidate) => candidate.id === item.productId);
      return product ? { ...item, product } : null;
    })
    .filter(Boolean);
}

export function getCartCount() {
  return getCartItems().reduce((sum, item) => sum + item.quantity, 0);
}

export function getCartSubtotal() {
  return getCartItems().reduce((sum, item) => sum + item.quantity * item.product.price, 0);
}

export function getDeliveryFee(deliveryMode = 'delivery') {
  return deliveryMode === 'pickup' ? 0 : BUSINESS_CONFIG.deliveryFee;
}

export function getCartTotal(deliveryMode = 'delivery') {
  return getCartSubtotal() + getDeliveryFee(deliveryMode);
}

export function canAddProduct(productId) {
  const product = getProductById(productId);
  if (!product || !product.available || product.stock <= 0) return false;
  const current = getCartItems().find((item) => item.productId === productId)?.quantity || 0;
  return current < product.stock;
}

export function addToCart(productId, quantity = 1) {
  const product = getProductById(productId);
  if (!product || !product.available || product.stock <= 0) {
    return { ok: false, message: 'Este producto no está disponible.' };
  }

  const current = getCartItems().find((item) => item.productId === productId)?.quantity || 0;
  const nextQuantity = current + quantity;

  if (nextQuantity > product.stock) {
    return { ok: false, message: `Stock disponible: ${product.stock}.` };
  }

  updateState((draft) => {
    const existing = draft.cart.find((item) => item.productId === productId);
    if (existing) {
      existing.quantity = nextQuantity;
    } else {
      draft.cart.push({ productId, quantity });
    }
  });

  return { ok: true, message: `${product.name} agregado al pedido.` };
}

export function incrementCartItem(productId) {
  return addToCart(productId, 1);
}

export function decrementCartItem(productId) {
  updateState((draft) => {
    const existing = draft.cart.find((item) => item.productId === productId);
    if (!existing) return;
    existing.quantity -= 1;
    if (existing.quantity <= 0) {
      draft.cart = draft.cart.filter((item) => item.productId !== productId);
    }
  });
}

export function removeCartItem(productId) {
  updateState((draft) => {
    draft.cart = draft.cart.filter((item) => item.productId !== productId);
  });
}

export function clearCart() {
  setState({ cart: [] });
}

export function validateCartForCheckout(deliveryMode = 'delivery') {
  const subtotal = getCartSubtotal();
  const items = getCartItems();

  if (items.length === 0) {
    return { ok: false, message: 'Agregá al menos un producto para confirmar el pedido.' };
  }

  const unavailableItem = items.find((item) => !item.product.available || item.product.stock <= 0 || item.quantity > item.product.stock);
  if (unavailableItem) {
    return {
      ok: false,
      message: `${unavailableItem.product.name} no tiene stock suficiente. Ajustá el carrito antes de confirmar.`,
    };
  }

  if (deliveryMode === 'delivery' && subtotal < BUSINESS_CONFIG.minDeliveryOrder) {
    const missing = BUSINESS_CONFIG.minDeliveryOrder - subtotal;
    return {
      ok: false,
      message: `Te faltan ${money(missing)} para llegar al pedido mínimo de delivery. También podés elegir retiro en local.`,
    };
  }

  return { ok: true, message: 'Pedido listo para confirmar.' };
}
