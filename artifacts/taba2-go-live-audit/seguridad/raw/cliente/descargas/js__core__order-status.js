export const ORDER_STATUSES = Object.freeze([
  'received',
  'preparing',
  'ready',
  'on_the_way',
  'arriving',
  'delivered',
  'cancelled',
]);

export const DELIVERY_STATUS_FLOW = Object.freeze(['received', 'preparing', 'ready', 'on_the_way', 'delivered']);
export const PICKUP_STATUS_FLOW = Object.freeze(['received', 'preparing', 'ready', 'delivered']);
export const TERMINAL_ORDER_STATUSES = Object.freeze(['delivered', 'cancelled']);
export const ASSIGNABLE_DELIVERY_STATUSES = Object.freeze(['ready', 'on_the_way', 'arriving']);

export const ORDER_STATUS_LABELS = Object.freeze({
  received: 'Recibido',
  preparing: 'Preparando',
  ready: 'Listo para enviar',
  on_the_way: 'En camino',
  arriving: 'Llegando',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
});

export const ORDER_STATUS_CLASSES = Object.freeze({
  received: 'received',
  preparing: 'preparing',
  ready: 'ready',
  on_the_way: 'way',
  arriving: 'way',
  delivered: 'done',
  cancelled: 'cancelled',
});

export function isValidOrderStatus(status) {
  return ORDER_STATUSES.includes(status);
}

export function normalizeOrderStatus(status, fallback = 'received') {
  return isValidOrderStatus(status) ? status : fallback;
}

export function isTerminalOrderStatus(status) {
  return TERMINAL_ORDER_STATUSES.includes(status);
}

export function getOrderStatusFlow(deliveryMode = 'delivery') {
  return deliveryMode === 'pickup' ? PICKUP_STATUS_FLOW : DELIVERY_STATUS_FLOW;
}

export function getNextOrderStatus(order) {
  if (!order || isTerminalOrderStatus(order.status)) return null;
  const flow = getOrderStatusFlow(order.deliveryMode);
  const index = flow.indexOf(order.status);
  return index >= 0 ? flow[index + 1] || null : null;
}

export function canTransitionOrderStatus(order, nextStatus) {
  if (!order || !isValidOrderStatus(nextStatus)) return false;
  const current = normalizeOrderStatus(order.status);
  if (isTerminalOrderStatus(current)) return false;
  if (nextStatus === 'cancelled') return true;
  if (nextStatus === current) return false;

  if (order.deliveryMode === 'pickup' && nextStatus === 'on_the_way') return false;
  if (order.deliveryMode === 'pickup' && nextStatus === 'arriving') return false;

  if (current === 'on_the_way' && (nextStatus === 'arriving' || nextStatus === 'delivered')) return true;
  if (current === 'arriving' && nextStatus === 'delivered') return true;

  return getNextOrderStatus({ ...order, status: current }) === nextStatus;
}
