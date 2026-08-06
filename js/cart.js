import { getBusinessConfig } from './core/business-config-store.js';
import {
  calculateTotals,
  getDeliveryFeeForMode,
  normalizeDeliveryMode,
  normalizeQuantity,
} from './core/pricing.js';
import { getCustomerCatalogProducts, isProductOrderable } from './core/catalog-store.js';
import { chargeableCombos, comboSelectionTotals } from './core/combos.js';
import { COMBO_MANIFEST } from './combos-data.js';
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

/*
 * Los combos viven fuera de `cart` a propósito.
 *
 * Un combo no es una línea de producto con descuento: es una composición cuyo
 * precio lo decide el backend a partir de los precios que bloquea al reservar.
 * Guardarlo como producto obligaría a inventarle un `productId` y a que cada
 * lector del carrito —recomendaciones, promociones, recompra— tuviera que
 * saber distinguirlo. Con la lista aparte, el resto del carrito sigue siendo
 * exactamente lo que era.
 *
 * En el total el combo entra igual que en el backend: sus componentes suman al
 * subtotal a precio de LISTA y el ahorro va al descuento. Así la pantalla del
 * cliente y el pedido cuentan la misma historia.
 */
export function getCartCombos() {
  const state = getState();
  const { lines } = comboSelectionTotals(
    state.comboSelections,
    COMBO_MANIFEST,
    getCustomerCatalogProducts(state.products),
  );
  return lines;
}

/** Unidades de un producto ya comprometidas, sueltas y dentro de combos. */
export function committedProductQuantity(productId) {
  const loose = getState().cart.find((item) => item.productId === productId)?.quantity || 0;
  const inCombos = getCartCombos().reduce((sum, line) => {
    const component = line.combo.components.find((candidate) => candidate.sku === productId);
    return component ? sum + component.quantity * line.quantity : sum;
  }, 0);
  return loose + inCombos;
}

export function getCartSummary(deliveryMode = 'delivery', options = {}) {
  const items = getCartItems();
  const comboLines = getCartCombos();
  const normalizedDeliveryMode = normalizeDeliveryMode(deliveryMode);
  const pricingItems = items.map((item) => ({
    quantity: item.quantity,
    unitPrice: item.product.price,
  }));
  const comboListTotal = comboLines.reduce((sum, line) => sum + line.listPrice, 0);
  const comboDiscount = comboLines.reduce((sum, line) => sum + (line.listPrice - line.price), 0);
  if (comboListTotal > 0) pricingItems.push({ quantity: 1, unitPrice: comboListTotal });
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.product.price, 0) + comboListTotal;
  const promotion = isDemoMode()
    ? evaluatePromotions(items, getState().promotions)
    : { discountTotal: 0, freeDelivery: false, applied: [], activePromotions: [] };
  const coupon = previewCouponDiscount(options.couponCode, subtotal);
  const discountAmount = promotion.discountTotal + coupon.discountAmount + comboDiscount;
  const calculated = items.length || comboLines.length
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
    combos: comboLines,
    comboDiscount,
    count: items.reduce((sum, item) => sum + item.quantity, 0)
      + comboLines.reduce((sum, line) => sum + line.quantity, 0),
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

export function getDeliveryMinimumProgress(
  subtotal = getCartSubtotal(),
  minimumOrder = getBusinessConfig().minDeliveryOrder,
) {
  const safeSubtotal = Math.max(0, Number(subtotal) || 0);
  const minimum = Math.max(0, Number(minimumOrder) || 0);
  const missing = Math.max(0, minimum - safeSubtotal);
  return {
    subtotal: safeSubtotal,
    minimum,
    missing,
    reached: minimum === 0 || missing === 0,
    progress: minimum > 0 ? Math.min(100, Math.round((safeSubtotal / minimum) * 100)) : 100,
  };
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
  return committedProductQuantity(productId) + requestedQuantity <= product.stock;
}

/** Combos que hoy se pueden agregar: aprobados, armables enteros y con stock. */
export function getAvailableCombos() {
  const state = getState();
  return chargeableCombos(COMBO_MANIFEST, getCustomerCatalogProducts(state.products));
}

export function getComboById(comboId) {
  return getAvailableCombos().find((combo) => combo.comboId === comboId) || null;
}

export function canAddCombo(comboId, quantity = 1) {
  return addComboToCart(comboId, quantity, { dryRun: true }).ok;
}

export function addComboToCart(comboId, quantity = 1, { dryRun = false } = {}) {
  const requestedQuantity = normalizeRequestedQuantity(quantity);
  if (requestedQuantity <= 0) return { ok: false, message: 'Indicá una cantidad válida.' };

  const combo = getComboById(comboId);
  if (!combo) {
    return { ok: false, message: 'Este combo no está disponible para pedir.' };
  }

  const current = getState().comboSelections.find((item) => item.comboId === comboId)?.quantity || 0;
  const nextQuantity = current + requestedQuantity;
  if (nextQuantity > combo.stock) {
    return { ok: false, message: `Alcanza para ${combo.stock} ${combo.stock === 1 ? 'combo' : 'combos'}.` };
  }

  // El stock lo comparte con las líneas sueltas: seis latas en el combo y dos
  // sueltas son ocho latas, y el mostrador tiene las que tiene. Sin este
  // control el carrito arma un pedido que el backend rechaza al reservar.
  for (const component of combo.components) {
    const committed = committedProductQuantity(component.sku);
    const needed = component.quantity * requestedQuantity;
    if (committed + needed > component.product.stock) {
      return {
        ok: false,
        message: `No alcanza el stock de ${component.product.name} para sumar este combo.`,
      };
    }
  }

  if (dryRun) return { ok: true, message: 'Se puede agregar.' };

  updateState((draft) => {
    const existing = draft.comboSelections.find((item) => item.comboId === comboId);
    if (existing) {
      existing.quantity = nextQuantity;
    } else {
      draft.comboSelections.push({ comboId, quantity: requestedQuantity });
    }
  });

  return { ok: true, message: `${combo.name} agregado al pedido.` };
}

export function decrementComboItem(comboId) {
  const existing = getState().comboSelections.find((item) => item.comboId === comboId);
  if (!existing) return { ok: false, message: 'El combo ya no está en el carrito.' };

  updateState((draft) => {
    const item = draft.comboSelections.find((candidate) => candidate.comboId === comboId);
    if (!item) return;
    item.quantity -= 1;
    if (item.quantity <= 0) {
      draft.comboSelections = draft.comboSelections.filter((candidate) => candidate.comboId !== comboId);
    }
  });

  return { ok: true, message: 'Cantidad actualizada.' };
}

export function removeComboItem(comboId) {
  const existed = getState().comboSelections.some((item) => item.comboId === comboId);
  if (!existed) return { ok: false, message: 'El combo ya no está en el carrito.' };

  updateState((draft) => {
    draft.comboSelections = draft.comboSelections.filter((item) => item.comboId !== comboId);
  });

  return { ok: true, message: 'Combo quitado del pedido.' };
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

  if (committedProductQuantity(productId) + requestedQuantity > product.stock) {
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
  const state = getState();
  if (state.cart.length === 0 && state.comboSelections.length === 0) {
    return { ok: true, message: 'El carrito ya estaba vacío.' };
  }
  setState({ cart: [], comboSelections: [], pendingReorder: null });
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

export function validateCartForCheckout(deliveryMode = 'delivery', options = {}) {
  const normalizedDeliveryMode = normalizeDeliveryMode(deliveryMode);
  const { items, combos, subtotal } = getCartSummary(normalizedDeliveryMode);

  if (items.length === 0 && combos.length === 0) {
    return { ok: false, message: 'Agregá al menos un producto para confirmar el pedido.' };
  }

  // El precio de combo lo aplica el checkout autoritativo de Mercado Pago, que
  // deriva el total de los precios que bloquea al reservar. Los otros medios de
  // pago crean el pedido por la ruta directa, que sólo acepta líneas de
  // producto: dejar pasar un combo por ahí lo cobraría a precio de lista, que
  // es exactamente lo que este cambio existe para impedir.
  if (combos.length && options.paymentMethod && options.paymentMethod !== 'mercadopago') {
    return {
      ok: false,
      message: 'Los combos se cobran con Mercado Pago. Elegí Mercado Pago o quitá el combo del carrito.',
    };
  }

  const unavailableCombo = combos.find((line) => !line.combo.chargeable || line.quantity > line.combo.stock);
  if (unavailableCombo) {
    return {
      ok: false,
      message: `${unavailableCombo.combo.name} ya no está disponible como combo. Ajustá el carrito antes de confirmar.`,
    };
  }

  const oversoldComponent = combos
    .flatMap((line) => line.combo.components.map((component) => ({ component, line })))
    .find(({ component }) => committedProductQuantity(component.sku) > component.product.stock);
  if (oversoldComponent) {
    return {
      ok: false,
      message: `${oversoldComponent.component.product.name} no tiene stock suficiente para el combo y las unidades sueltas.`,
    };
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
  const minimumProgress = getDeliveryMinimumProgress(subtotal, config.minDeliveryOrder);
  if (normalizedDeliveryMode === 'delivery' && enforceMinimum && !minimumProgress.reached) {
    const { missing } = minimumProgress;
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
