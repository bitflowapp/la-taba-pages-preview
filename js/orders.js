import { BUSINESS_CONFIG } from './config.js';
import {
  canTransitionOrderStatus,
  getNextOrderStatus,
  isValidOrderStatus,
} from './core/order-status.js';
import { normalizePreparationMinutes } from './core/business-ops.js';
import { calculateTotals, normalizeDeliveryMode } from './core/pricing.js';
import {
  getAssignableDeliveryOrder,
  getRiderQueueOrder as selectRiderQueueOrder,
  isRiderQueueOrder,
} from './core/rider.js';
import { chooseActiveLiveOrderId } from './core/realtime-sync.js';
import { normalizePaymentMethod, sanitizeNotes, sanitizeText } from './core/validators.js';
import { recordCustomerOrder, updateCustomerOrderSnapshot } from './core/customer-history.js';
import { buildAppliedCoupon, normalizeCouponCode } from './core/promotions.js';
import {
  formatAddressReference,
  normalizeAddressDetails,
  normalizeOrderAddressDetails,
} from './core/address.js';
import { distanceKm, getStreetTestDestination } from './map/route_geometry.js';
import {
  createOrderId,
  dateTime,
  deliveryModeLabel,
  getState,
  money,
  paymentLabel,
  statusLabel,
  updateState,
} from './state.js';
import {
  getCartItems,
  getCartSummary,
  validateCartForCheckout,
} from './cart.js';

export function createOrderFromCheckout(formValues = {}) {
  const values = normalizeCheckoutValues(formValues);
  const validation = validateCartForCheckout(values.deliveryMode);
  if (!validation.ok) return { ok: false, message: validation.message };

  if (!values.customerName) return { ok: false, message: 'Ingresá el nombre del cliente.' };
  if (!values.customerPhone) return { ok: false, message: 'Ingresá un teléfono de contacto.' };
  if (values.deliveryMode === 'delivery' && !values.customerAddress) {
    return { ok: false, message: 'Ingresá calle y número para el envío.' };
  }
  if (values.deliveryMode === 'delivery' && values.addressDetails.usesStructured && !values.addressDetails.neighborhood) {
    return { ok: false, message: 'Ingresá el barrio o zona para el envío.' };
  }

  const now = new Date().toISOString();
  const cartItems = getCartItems();
  const items = cartItems.map((item) => ({
    productId: item.product.id,
    name: item.product.name,
    icon: item.product.icon,
    quantity: item.quantity,
    unitPrice: item.product.price,
    unit: item.product.unit,
  }));
  const baseTotals = calculateTotals(items, values.deliveryMode);
  const coupon = buildAppliedCoupon(values.couponCode, baseTotals.subtotal);
  const totals = calculateTotals(items, values.deliveryMode, {
    discountAmount: coupon?.discountAmount || 0,
  });

  const order = {
    id: createOrderId(),
    customerName: values.customerName,
    customerPhone: values.customerPhone,
    address: values.deliveryMode === 'pickup' ? BUSINESS_CONFIG.address : values.customerAddress,
    addressDetails: values.deliveryMode === 'pickup' ? null : values.addressDetails,
    deliveryMode: values.deliveryMode,
    paymentMethod: paymentLabel(values.paymentMethod),
    paymentMethodCode: values.paymentMethod,
    notes: values.customerNotes || 'Sin notas',
    cashChange: values.paymentMethod === 'cash' ? values.cashChange : '',
    coupon,
    createdAt: now,
    status: 'received',
    items,
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    deliveryFee: totals.deliveryFee,
    total: totals.total,
    statusHistory: [{ status: 'received', at: now }],
    delivery: {
      // Pedido real recién creado: todavía NO hay repartidor asignado.
      // No inventamos nombre/teléfono de rider (eso confunde al cliente).
      driverName: 'Sin asignar',
      driverPhone: '',
      estimatedMinutes: values.deliveryMode === 'pickup' ? 0 : 25,
      estimatedPreparationMinutes: 0,
      currentLocationLabel: values.deliveryMode === 'pickup' ? 'Pedido para retirar en local' : 'Pedido recibido por el local',
    },
  };

  updateState((draft) => {
    draft.orders.unshift(order);
    draft.lastOrderId = order.id;
    draft.lastCheckoutDraft = values;

    for (const item of items) {
      const product = draft.products.find((candidate) => candidate.id === item.productId);
      if (product) product.stock = Math.max(0, product.stock - item.quantity);
    }

    draft.cart = [];
  });
  recordCustomerOrder(order);

  return { ok: true, order, message: `Pedido ${order.id} creado.` };
}

function normalizeCheckoutValues(formValues) {
  const deliveryMode = normalizeDeliveryMode(formValues.deliveryMode);
  const addressDetails = normalizeAddressDetails(formValues);
  return {
    customerName: sanitizeText(formValues.customerName, { maxLength: 80 }),
    customerPhone: sanitizeText(formValues.customerPhone, { maxLength: 40 }),
    customerStreetAddress: addressDetails.streetLine,
    customerNeighborhood: addressDetails.neighborhood,
    customerReference: addressDetails.reference,
    customerAddress: addressDetails.label,
    addressDetails,
    deliveryMode,
    paymentMethod: normalizePaymentMethod(formValues.paymentMethod),
    customerNotes: sanitizeNotes(formValues.customerNotes, ''),
    cashChange: sanitizeText(formValues.cashChange, { maxLength: 80 }),
    couponCode: normalizeCouponCode(formValues.couponCode),
  };
}

export function getLastOrder() {
  return getActiveOrder();
}

export function getActiveOrderId(sourceState = getState()) {
  const orders = Array.isArray(sourceState.orders) ? sourceState.orders : [];
  if (typeof sourceState.lastOrderId === 'string' && orders.some((order) => order.id === sourceState.lastOrderId)) {
    return sourceState.lastOrderId;
  }
  return chooseActiveLiveOrderId(orders);
}

export function getActiveOrder() {
  const state = getState();
  const activeOrderId = getActiveOrderId(state);
  return activeOrderId ? state.orders.find((order) => order.id === activeOrderId) || null : null;
}

export function persistActiveOrderId(orderId) {
  if (!orderId) return false;
  let persisted = false;
  updateState((draft) => {
    if (draft.orders.some((order) => order.id === orderId)) {
      draft.lastOrderId = orderId;
      persisted = true;
    }
  });
  return persisted;
}

export function clearActiveOrderStateOnReset() {
  updateState((draft) => {
    draft.lastOrderId = null;
    draft.simulation = null;
  });
}

export function getActiveDeliveryOrder() {
  return getAssignableDeliveryOrder(getState().orders);
}

// Incluye pedidos received/preparing para que el rider los vea en cola.
export function getRiderQueueOrder() {
  const state = getState();
  const activeOrderId = getActiveOrderId(state);
  const activeOrder = activeOrderId
    ? state.orders.find((order) => order.id === activeOrderId)
    : null;
  if (isRiderQueueOrder(activeOrder)) return activeOrder;
  return selectRiderQueueOrder(state.orders);
}

// Atajo del rider: lleva un pedido hasta "listo para reparto"
// respetando el flujo de estados (received -> preparing -> ready).
export function advanceOrderToReady(orderId) {
  for (let step = 0; step < 4; step += 1) {
    const order = getState().orders.find((candidate) => candidate.id === orderId);
    if (!order) return { ok: false, message: 'Pedido no encontrado.' };
    if (['ready', 'on_the_way', 'arriving', 'delivered'].includes(order.status)) {
      return { ok: true, message: 'Pedido listo para reparto.' };
    }
    const result = advanceOrderStatus(orderId);
    if (!result.ok) return result;
  }
  return { ok: true, message: 'Pedido listo para reparto.' };
}

export function advanceOrderStatus(orderId, options = {}) {
  const order = getState().orders.find((candidate) => candidate.id === orderId);
  return updateOrderStatus(orderId, getNextOrderStatus(order), options);
}

export function cancelOrder(orderId, reason = '') {
  const result = updateOrderStatus(orderId, 'cancelled');
  if (result.ok) {
    const clean = sanitizeText(reason, { maxLength: 120 });
    if (clean) {
      updateState((draft) => {
        const order = draft.orders.find((candidate) => candidate.id === orderId);
        if (order) order.cancelReason = clean;
      });
      updateCustomerOrderSnapshot(getState().orders.find((candidate) => candidate.id === orderId));
    }
  }
  return result;
}

// Ticket de texto plano para cocina / mostrador (sin dependencias).
export function buildKitchenTicket(order) {
  if (!order) return '';
  const isPickup = normalizeDeliveryMode(order.deliveryMode) === 'pickup';
  const address = normalizeOrderAddressDetails(order);
  const reference = formatAddressReference(order);
  const lines = [
    'LA TABA — TICKET',
    `Pedido: ${order.id}`,
    `Hora: ${dateTime(order.createdAt)}`,
    `Entrega: ${deliveryModeLabel(order.deliveryMode)}`,
    isPickup ? 'Retiro en el local' : `Direccion: ${address.label || order.address}`,
    ...(!isPickup && reference ? [`Referencia: ${reference}`] : []),
    `Cliente: ${order.customerName}`,
    `Telefono: ${order.customerPhone}`,
    '--------------------------------',
    ...order.items.map((item) => `${item.quantity} x ${item.name}`),
    '--------------------------------',
    ...(Number(order.discountTotal || 0) > 0 ? [`Cupon ${order.coupon?.code || ''}: -${money(order.discountTotal)}`] : []),
    `Pago: ${order.paymentMethod}`,
    ...(order.cashChange ? [`Cambio efectivo: ${order.cashChange}`] : []),
    `TOTAL: ${money(order.total)}`,
    `Notas: ${order.notes || 'Sin notas'}`,
    `Estado: ${statusLabel(order.status)}`,
  ];
  return lines.join('\n');
}

export function updateOrderStatus(orderId, status, options = {}) {
  if (!orderId || !isValidOrderStatus(status)) {
    return { ok: false, message: 'Estado de pedido inválido.' };
  }

  const current = getState().orders.find((candidate) => candidate.id === orderId);
  if (!current) return { ok: false, message: 'Pedido no encontrado.' };
  if (!canTransitionOrderStatus(current, status)) {
    return { ok: false, message: 'Transición de estado no permitida.' };
  }

  const now = new Date().toISOString();

  updateState((draft) => {
    const order = draft.orders.find((candidate) => candidate.id === orderId);
    if (!order) return;

    order.status = status;
    order.statusHistory.push({ status, at: now });
    order.delivery = order.delivery || {};
    draft.lastOrderId = orderId;

    if (status === 'preparing') {
      const estimatedPreparationMinutes = normalizePreparationMinutes(
        options.estimatedPreparationMinutes,
        order.delivery.estimatedPreparationMinutes || 20,
      );
      order.delivery.acceptedAt = order.delivery.acceptedAt || now;
      order.delivery.estimatedPreparationMinutes = estimatedPreparationMinutes;
      order.delivery.currentLocationLabel = `Pedido aceptado por el negocio. Preparacion estimada: ${estimatedPreparationMinutes} min`;
      if (order.deliveryMode === 'delivery') {
        order.delivery.estimatedMinutes = Math.max(estimatedPreparationMinutes, Number(order.delivery.estimatedMinutes || 0));
      }
    }
    if (status === 'ready') {
      order.delivery.currentLocationLabel = 'Pedido listo en el local';
      if (order.deliveryMode === 'delivery') order.delivery.estimatedMinutes = Math.max(18, order.delivery.estimatedMinutes || 25);
    }
    if (status === 'on_the_way') {
      order.delivery.leftStoreAt = now;
      order.delivery.currentLocationLabel = 'El repartidor salió del local';
      order.delivery.estimatedMinutes = Math.max(8, Number(order.delivery.estimatedMinutes || 20) - 6);
    }
    if (status === 'arriving') {
      order.delivery.currentLocationLabel = 'El repartidor está llegando';
      order.delivery.estimatedMinutes = Math.min(5, Math.max(1, Number(order.delivery.estimatedMinutes || 5)));
    }
    if (status === 'delivered') {
      order.delivery.deliveredAt = now;
      order.delivery.currentLocationLabel = 'Pedido entregado';
      order.delivery.estimatedMinutes = 0;
    }
    if (status === 'cancelled') {
      order.delivery.currentLocationLabel = 'Pedido cancelado por el negocio';
      order.delivery.estimatedMinutes = 0;
    }
  });

  updateCustomerOrderSnapshot(getState().orders.find((candidate) => candidate.id === orderId));

  return { ok: true, message: `Pedido ${orderId} actualizado a ${statusLabel(status)}.` };
}

export function updateOrderDemoDestination(orderId, destinationId) {
  if (!orderId) return { ok: false, message: 'Pedido no encontrado.' };
  const current = getState().orders.find((candidate) => candidate.id === orderId);
  if (!current || current.deliveryMode !== 'delivery') {
    return { ok: false, message: 'No hay un pedido de delivery para asignar destino.' };
  }

  const destination = getStreetTestDestination(destinationId);
  const now = new Date().toISOString();
  const estimatedDistance = Number(distanceKm(BUSINESS_CONFIG.businessLocation, destination).toFixed(1));

  updateState((draft) => {
    const order = draft.orders.find((candidate) => candidate.id === orderId);
    if (!order) return;
    order.delivery = order.delivery || {};
    order.delivery.demoDestinationId = destination.id;
    order.delivery.demoDestinationLabel = destination.label || destination.name;
    order.delivery.demoDestinationAddressLabel = destination.addressLabel || destination.name || destination.label;
    order.delivery.demoDestinationCity = destination.city || '';
    order.delivery.destinationUpdatedAt = now;
    order.delivery.distanceKm = estimatedDistance;
  });

  return { ok: true, message: `Referencia visual actualizada: ${destination.label || destination.name}.`, destination };
}

export function getNextStatus(orderId) {
  const order = getState().orders.find((candidate) => candidate.id === orderId);
  return getNextOrderStatus(order);
}

export function actionLabelForOrder(order) {
  const next = getNextOrderStatus(order);
  if (!next) return 'Sin acción';
  const labels = {
    preparing: 'Aceptar pedido',
    ready: 'Listo para entregar',
    on_the_way: 'Enviar a reparto',
    delivered: 'Marcar entregado',
  };
  return labels[next] || `Pasar a ${statusLabel(next)}`;
}

export function buildWhatsAppMessage(order) {
  if (!order) return '';
  const safeOrder = normalizeOrderForMessage(order);
  const lines = [
    `Hola ${BUSINESS_CONFIG.businessName}, quiero hacer este pedido:`,
    '',
    `Pedido: ${safeOrder.id}`,
    `Fecha: ${dateTime(safeOrder.createdAt)}`,
    '',
    'Cliente:',
    `Nombre: ${safeOrder.customerName}`,
    `Teléfono: ${safeOrder.customerPhone}`,
    `Entrega: ${deliveryModeLabel(safeOrder.deliveryMode)}`,
    `${safeOrder.deliveryMode === 'pickup' ? 'Retiro en' : 'Dirección'}: ${safeOrder.address}`,
    ...(safeOrder.deliveryMode === 'delivery' && safeOrder.addressDetails.reference
      ? [`Referencia: ${safeOrder.addressDetails.reference}`]
      : []),
    '',
    'Productos:',
    ...safeOrder.items.map((item) => `• ${item.quantity} x ${item.name} — ${money(item.unitPrice * item.quantity)}`),
    '',
    `Subtotal: ${money(safeOrder.subtotal)}`,
    ...(safeOrder.discountTotal > 0 ? [`Cupon ${safeOrder.coupon?.code || ''}: -${money(safeOrder.discountTotal)}`] : []),
    `Envío: ${money(safeOrder.deliveryFee)}`,
    `Total: ${money(safeOrder.total)}`,
    '',
    `Pago: ${safeOrder.paymentMethod}`,
    ...(safeOrder.cashChange ? [`Cambio con efectivo: ${safeOrder.cashChange}`] : []),
    `Notas: ${safeOrder.notes}`,
  ];

  return lines.join('\n');
}

function normalizeOrderForMessage(order) {
  const deliveryMode = normalizeDeliveryMode(order.deliveryMode);
  const items = Array.isArray(order.items) ? order.items : [];
  const safeItems = items.map((item) => ({
    name: sanitizeText(item.name, { fallback: 'Producto', maxLength: 100 }),
    quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)),
    unitPrice: Math.max(0, Number(item.unitPrice) || 0),
  }));
  const discountTotal = Math.max(0, Number(order.discountTotal || order.coupon?.discountAmount || 0));
  const totals = calculateTotals(safeItems, deliveryMode, { discountAmount: discountTotal });
  const coupon = order.coupon && totals.discountTotal > 0
    ? {
      code: sanitizeText(order.coupon.code, { fallback: 'TABA10', maxLength: 24 }),
      discountPercent: Math.max(0, Math.floor(Number(order.coupon.discountPercent) || 0)),
      discountAmount: totals.discountTotal,
    }
    : null;

  return {
    id: sanitizeText(order.id, { fallback: 'Sin ID', maxLength: 40 }),
    createdAt: order.createdAt,
    customerName: sanitizeText(order.customerName, { fallback: 'Sin cargar', maxLength: 80 }),
    customerPhone: sanitizeText(order.customerPhone, { fallback: 'Sin cargar', maxLength: 40 }),
    deliveryMode,
    address: deliveryMode === 'pickup'
      ? BUSINESS_CONFIG.address
      : normalizeOrderAddressDetails(order).label || sanitizeText(order.address, { fallback: 'Sin cargar', maxLength: 180 }),
    addressDetails: deliveryMode === 'pickup' ? normalizeAddressDetails() : normalizeOrderAddressDetails(order),
    items: safeItems,
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    deliveryFee: totals.deliveryFee,
    total: totals.total,
    coupon,
    paymentMethod: sanitizeText(order.paymentMethod, { fallback: 'Efectivo', maxLength: 80 }),
    cashChange: sanitizeText(order.cashChange, { fallback: '', maxLength: 80 }),
    notes: sanitizeNotes(order.notes),
  };
}

export function buildWhatsAppUrl(order) {
  return `https://wa.me/${BUSINESS_CONFIG.whatsappNumber}?text=${encodeURIComponent(buildWhatsAppMessage(order))}`;
}

// Copia opcional por WhatsApp del borrador del carrito (no crea pedido interno).
export function buildWhatsAppUrlFromDraft(formValues = {}) {
  return `https://wa.me/${BUSINESS_CONFIG.whatsappNumber}?text=${encodeURIComponent(buildDraftMessageFromCart(formValues))}`;
}

export function buildDraftMessageFromCart(formValues = {}) {
  const values = normalizeCheckoutValues(formValues);
  const { items, subtotal, discountTotal, deliveryFee, total, coupon } = getCartSummary(values.deliveryMode, {
    couponCode: values.couponCode,
  });

  const lines = [
    `Hola ${BUSINESS_CONFIG.businessName}, quiero consultar este pedido:`,
    '',
    `Fecha: ${dateTime(new Date().toISOString())}`,
    '',
    'Cliente:',
    `Nombre: ${values.customerName || 'Sin cargar'}`,
    `Teléfono: ${values.customerPhone || 'Sin cargar'}`,
    `Entrega: ${deliveryModeLabel(values.deliveryMode)}`,
    `${values.deliveryMode === 'pickup' ? 'Retiro en' : 'Dirección'}: ${values.deliveryMode === 'pickup' ? BUSINESS_CONFIG.address : values.customerAddress || 'Sin cargar'}`,
    ...(values.deliveryMode === 'delivery' && values.addressDetails.reference ? [`Referencia: ${values.addressDetails.reference}`] : []),
    '',
    'Productos:',
    ...(items.length ? items.map((item) => `• ${item.quantity} x ${item.product.name} — ${money(item.quantity * item.product.price)}`) : ['• Sin productos cargados']),
    '',
    `Subtotal: ${money(subtotal)}`,
    ...(discountTotal > 0 ? [`Cupon ${coupon.code}: -${money(discountTotal)}`] : []),
    `Envío: ${money(deliveryFee)}`,
    `Total: ${money(total)}`,
    '',
    `Pago: ${paymentLabel(values.paymentMethod)}`,
    ...(values.paymentMethod === 'cash' && values.cashChange ? [`Cambio con efectivo: ${values.cashChange}`] : []),
    `Notas: ${values.customerNotes || 'Sin notas'}`,
  ];

  return lines.join('\n');
}
