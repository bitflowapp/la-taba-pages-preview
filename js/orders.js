import { BUSINESS_CONFIG } from './config.js';
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
  clearCart,
  getCartItems,
  getCartSubtotal,
  getCartTotal,
  getDeliveryFee,
  validateCartForCheckout,
} from './cart.js';

const statusFlow = ['received', 'preparing', 'ready', 'on_the_way', 'delivered'];

export function createOrderFromCheckout(formValues) {
  const deliveryMode = formValues.deliveryMode || 'delivery';
  const validation = validateCartForCheckout(deliveryMode);
  if (!validation.ok) return { ok: false, message: validation.message };

  if (!formValues.customerName?.trim()) return { ok: false, message: 'Ingresá el nombre del cliente.' };
  if (!formValues.customerPhone?.trim()) return { ok: false, message: 'Ingresá un teléfono de contacto.' };
  if (deliveryMode === 'delivery' && !formValues.customerAddress?.trim()) {
    return { ok: false, message: 'Ingresá la dirección para el envío.' };
  }

  const now = new Date().toISOString();
  const items = getCartItems().map((item) => ({
    productId: item.product.id,
    name: item.product.name,
    icon: item.product.icon,
    quantity: item.quantity,
    unitPrice: item.product.price,
    unit: item.product.unit,
  }));

  const order = {
    id: createOrderId(),
    customerName: formValues.customerName.trim(),
    customerPhone: formValues.customerPhone.trim(),
    address: deliveryMode === 'pickup' ? BUSINESS_CONFIG.address : formValues.customerAddress.trim(),
    deliveryMode,
    paymentMethod: paymentLabel(formValues.paymentMethod),
    notes: formValues.customerNotes?.trim() || 'Sin notas',
    createdAt: now,
    status: 'received',
    items,
    subtotal: getCartSubtotal(),
    deliveryFee: getDeliveryFee(deliveryMode),
    total: getCartTotal(deliveryMode),
    statusHistory: [{ status: 'received', at: now }],
    delivery: {
      driverName: 'Juli',
      driverPhone: '2991112233',
      estimatedMinutes: deliveryMode === 'pickup' ? 0 : 25,
      currentLocationLabel: deliveryMode === 'pickup' ? 'Pedido para retirar en local' : 'Pedido recibido por el local',
    },
  };

  updateState((draft) => {
    draft.orders.unshift(order);
    draft.lastOrderId = order.id;
    draft.lastCheckoutDraft = formValues;

    for (const item of items) {
      const product = draft.products.find((candidate) => candidate.id === item.productId);
      if (product) product.stock = Math.max(0, product.stock - item.quantity);
    }
  });

  clearCart();
  return { ok: true, order, message: `Pedido ${order.id} creado.` };
}

export function getLastOrder() {
  const state = getState();
  return state.orders.find((order) => order.id === state.lastOrderId) || state.orders[0] || null;
}

export function getActiveDeliveryOrder() {
  const deliveryOrders = getState().orders.filter((order) => order.deliveryMode !== 'pickup');
  return deliveryOrders.find((order) => ['ready', 'on_the_way'].includes(order.status))
    || deliveryOrders.find((order) => ['received', 'preparing'].includes(order.status))
    || null;
}

export function advanceOrderStatus(orderId) {
  updateOrderStatus(orderId, getNextStatus(orderId));
}

export function cancelOrder(orderId) {
  updateOrderStatus(orderId, 'cancelled');
}

export function updateOrderStatus(orderId, status) {
  if (!status) return;
  const now = new Date().toISOString();

  updateState((draft) => {
    const order = draft.orders.find((candidate) => candidate.id === orderId);
    if (!order) return;
    if (order.status === 'delivered' || order.status === 'cancelled') return;

    order.status = status;
    order.statusHistory.push({ status, at: now });

    if (status === 'ready') {
      order.delivery.currentLocationLabel = 'Pedido listo en el local';
    }
    if (status === 'on_the_way') {
      order.delivery.leftStoreAt = now;
      order.delivery.currentLocationLabel = 'El repartidor salió del local';
      order.delivery.estimatedMinutes = Math.max(8, order.delivery.estimatedMinutes - 6);
    }
    if (status === 'delivered') {
      order.delivery.deliveredAt = now;
      order.delivery.currentLocationLabel = 'Pedido entregado';
      order.delivery.estimatedMinutes = 0;
    }
    if (status === 'cancelled') {
      order.delivery.currentLocationLabel = 'Pedido cancelado por el negocio';
    }
  });
}

export function getNextStatus(orderId) {
  const order = getState().orders.find((candidate) => candidate.id === orderId);
  if (!order) return null;
  if (order.status === 'cancelled' || order.status === 'delivered') return null;
  const index = statusFlow.indexOf(order.status);
  return statusFlow[index + 1] || null;
}

export function actionLabelForOrder(order) {
  const next = getNextStatus(order.id);
  if (!next) return 'Sin acción';
  const labels = {
    preparing: 'Aceptar pedido',
    ready: 'Listo para enviar',
    on_the_way: 'Enviar con repartidor',
    delivered: 'Marcar entregado',
  };
  return labels[next] || `Pasar a ${statusLabel(next)}`;
}

export function buildWhatsAppMessage(order) {
  if (!order) return '';
  const lines = [
    `Hola ${BUSINESS_CONFIG.businessName}, quiero hacer este pedido:`,
    '',
    `Pedido: ${order.id}`,
    `Fecha: ${dateTime(order.createdAt)}`,
    '',
    'Cliente:',
    `Nombre: ${order.customerName}`,
    `Teléfono: ${order.customerPhone}`,
    `Entrega: ${deliveryModeLabel(order.deliveryMode)}`,
    `Dirección: ${order.address}`,
    '',
    'Productos:',
    ...order.items.map((item) => `• ${item.quantity} x ${item.name} — ${money(item.unitPrice * item.quantity)}`),
    '',
    `Subtotal: ${money(order.subtotal)}`,
    `Envío: ${money(order.deliveryFee)}`,
    `Total: ${money(order.total)}`,
    '',
    `Pago: ${order.paymentMethod}`,
    `Notas: ${order.notes}`,
  ];

  return lines.join('\n');
}

export function buildWhatsAppUrl(order) {
  return `https://wa.me/${BUSINESS_CONFIG.whatsappNumber}?text=${encodeURIComponent(buildWhatsAppMessage(order))}`;
}

export function buildDraftMessageFromCart(formValues = {}) {
  const deliveryMode = formValues.deliveryMode || 'delivery';
  const items = getCartItems();
  const subtotal = getCartSubtotal();
  const deliveryFee = getDeliveryFee(deliveryMode);
  const total = subtotal + deliveryFee;

  const lines = [
    `Hola ${BUSINESS_CONFIG.businessName}, quiero consultar este pedido:`,
    '',
    `Fecha: ${dateTime(new Date().toISOString())}`,
    '',
    'Cliente:',
    `Nombre: ${formValues.customerName || 'Sin cargar'}`,
    `Teléfono: ${formValues.customerPhone || 'Sin cargar'}`,
    `Entrega: ${deliveryModeLabel(deliveryMode)}`,
    `Dirección: ${deliveryMode === 'pickup' ? BUSINESS_CONFIG.address : formValues.customerAddress || 'Sin cargar'}`,
    '',
    'Productos:',
    ...(items.length ? items.map((item) => `• ${item.quantity} x ${item.product.name} — ${money(item.quantity * item.product.price)}`) : ['• Sin productos cargados']),
    '',
    `Subtotal: ${money(subtotal)}`,
    `Envío: ${money(deliveryFee)}`,
    `Total: ${money(total)}`,
    '',
    `Pago: ${paymentLabel(formValues.paymentMethod || 'cash')}`,
    `Notas: ${formValues.customerNotes || 'Sin notas'}`,
  ];

  return lines.join('\n');
}
