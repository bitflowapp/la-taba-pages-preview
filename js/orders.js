import { BUSINESS_CONFIG } from './config.js';
import {
  canTransitionOrderStatus,
  getNextOrderStatus,
  isValidOrderStatus,
} from './core/order-status.js';
import { calculateTotals, normalizeDeliveryMode } from './core/pricing.js';
import { getAssignableDeliveryOrder } from './core/rider.js';
import { normalizePaymentMethod, sanitizeNotes, sanitizeText } from './core/validators.js';
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
    return { ok: false, message: 'Ingresá la dirección para el envío.' };
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
  const totals = calculateTotals(items, values.deliveryMode);

  const order = {
    id: createOrderId(),
    customerName: values.customerName,
    customerPhone: values.customerPhone,
    address: values.deliveryMode === 'pickup' ? BUSINESS_CONFIG.address : values.customerAddress,
    deliveryMode: values.deliveryMode,
    paymentMethod: paymentLabel(values.paymentMethod),
    notes: values.customerNotes || 'Sin notas',
    createdAt: now,
    status: 'received',
    items,
    subtotal: totals.subtotal,
    deliveryFee: totals.deliveryFee,
    total: totals.total,
    statusHistory: [{ status: 'received', at: now }],
    delivery: {
      driverName: values.deliveryMode === 'pickup' ? 'Sin asignar' : 'Juli',
      driverPhone: values.deliveryMode === 'pickup' ? '' : '2991112233',
      estimatedMinutes: values.deliveryMode === 'pickup' ? 0 : 25,
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

  return { ok: true, order, message: `Pedido ${order.id} creado.` };
}

function normalizeCheckoutValues(formValues) {
  const deliveryMode = normalizeDeliveryMode(formValues.deliveryMode);
  return {
    customerName: sanitizeText(formValues.customerName, { maxLength: 80 }),
    customerPhone: sanitizeText(formValues.customerPhone, { maxLength: 40 }),
    customerAddress: sanitizeText(formValues.customerAddress, { maxLength: 180 }),
    deliveryMode,
    paymentMethod: normalizePaymentMethod(formValues.paymentMethod),
    customerNotes: sanitizeNotes(formValues.customerNotes, ''),
  };
}

export function getLastOrder() {
  const state = getState();
  return state.orders.find((order) => order.id === state.lastOrderId) || state.orders[0] || null;
}

export function getActiveDeliveryOrder() {
  return getAssignableDeliveryOrder(getState().orders);
}

export function advanceOrderStatus(orderId) {
  const order = getState().orders.find((candidate) => candidate.id === orderId);
  return updateOrderStatus(orderId, getNextOrderStatus(order));
}

export function cancelOrder(orderId) {
  return updateOrderStatus(orderId, 'cancelled');
}

export function updateOrderStatus(orderId, status) {
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

  return { ok: true, message: `Pedido ${orderId} actualizado a ${statusLabel(status)}.` };
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
    ready: 'Marcar listo para enviar',
    on_the_way: 'Enviar con repartidor',
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
    '',
    'Productos:',
    ...safeOrder.items.map((item) => `• ${item.quantity} x ${item.name} — ${money(item.unitPrice * item.quantity)}`),
    '',
    `Subtotal: ${money(safeOrder.subtotal)}`,
    `Envío: ${money(safeOrder.deliveryFee)}`,
    `Total: ${money(safeOrder.total)}`,
    '',
    `Pago: ${safeOrder.paymentMethod}`,
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
  const totals = calculateTotals(safeItems, deliveryMode);

  return {
    id: sanitizeText(order.id, { fallback: 'Sin ID', maxLength: 40 }),
    createdAt: order.createdAt,
    customerName: sanitizeText(order.customerName, { fallback: 'Sin cargar', maxLength: 80 }),
    customerPhone: sanitizeText(order.customerPhone, { fallback: 'Sin cargar', maxLength: 40 }),
    deliveryMode,
    address: deliveryMode === 'pickup'
      ? BUSINESS_CONFIG.address
      : sanitizeText(order.address, { fallback: 'Sin cargar', maxLength: 180 }),
    items: safeItems,
    subtotal: totals.subtotal,
    deliveryFee: totals.deliveryFee,
    total: totals.total,
    paymentMethod: sanitizeText(order.paymentMethod, { fallback: 'Efectivo', maxLength: 80 }),
    notes: sanitizeNotes(order.notes),
  };
}

export function buildWhatsAppUrl(order) {
  return `https://wa.me/${BUSINESS_CONFIG.whatsappNumber}?text=${encodeURIComponent(buildWhatsAppMessage(order))}`;
}

export function buildDraftMessageFromCart(formValues = {}) {
  const values = normalizeCheckoutValues(formValues);
  const { items, subtotal, deliveryFee, total } = getCartSummary(values.deliveryMode);

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
    '',
    'Productos:',
    ...(items.length ? items.map((item) => `• ${item.quantity} x ${item.product.name} — ${money(item.quantity * item.product.price)}`) : ['• Sin productos cargados']),
    '',
    `Subtotal: ${money(subtotal)}`,
    `Envío: ${money(deliveryFee)}`,
    `Total: ${money(total)}`,
    '',
    `Pago: ${paymentLabel(values.paymentMethod)}`,
    `Notas: ${values.customerNotes || 'Sin notas'}`,
  ];

  return lines.join('\n');
}
