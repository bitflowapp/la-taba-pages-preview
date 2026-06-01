import {
  ASSIGNABLE_DELIVERY_STATUSES,
  canTransitionOrderStatus,
  isTerminalOrderStatus,
} from './order-status.js';
import { normalizeDeliveryMode } from './pricing.js';

const RIDER_STATUS_PRIORITY = Object.freeze({
  on_the_way: 0,
  arriving: 1,
  ready: 2,
});

export function isAssignableDeliveryOrder(order) {
  return Boolean(
    order
      && normalizeDeliveryMode(order.deliveryMode) === 'delivery'
      && !isTerminalOrderStatus(order.status)
      && ASSIGNABLE_DELIVERY_STATUSES.includes(order.status),
  );
}

export function getAssignableDeliveryOrder(orders = []) {
  if (!Array.isArray(orders)) return null;
  return [...orders]
    .filter(isAssignableDeliveryOrder)
    .sort((a, b) => {
      const rankDiff = (RIDER_STATUS_PRIORITY[a.status] ?? 99) - (RIDER_STATUS_PRIORITY[b.status] ?? 99);
      if (rankDiff !== 0) return rankDiff;
      return toSortableTime(a.createdAt) - toSortableTime(b.createdAt);
    })[0] || null;
}

// Cola del rider: incluye pedidos de delivery que todavía no salieron
// (received/preparing) para que el repartidor los vea "esperando preparación".
const RIDER_QUEUE_STATUSES = Object.freeze(['received', 'preparing', 'ready', 'on_the_way', 'arriving']);
const RIDER_IN_PROGRESS = Object.freeze(['on_the_way', 'arriving']);

export function isRiderQueueOrder(order) {
  return Boolean(
    order
      && normalizeDeliveryMode(order.deliveryMode) === 'delivery'
      && !isTerminalOrderStatus(order.status)
      && RIDER_QUEUE_STATUSES.includes(order.status),
  );
}

// Si hay un reparto en curso, ese manda; si no, el pedido más reciente en cola.
export function getRiderQueueOrder(orders = []) {
  if (!Array.isArray(orders)) return null;
  const queue = orders.filter(isRiderQueueOrder);
  if (!queue.length) return null;

  const inProgress = queue
    .filter((order) => RIDER_IN_PROGRESS.includes(order.status))
    .sort((a, b) => toSortableTime(b.createdAt) - toSortableTime(a.createdAt));
  if (inProgress.length) return inProgress[0];

  return [...queue].sort((a, b) => toSortableTime(b.createdAt) - toSortableTime(a.createdAt))[0];
}

export function isAwaitingPreparation(order) {
  return Boolean(order) && (order.status === 'received' || order.status === 'preparing');
}

function toSortableTime(value) {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export function getRiderActionState(order) {
  return {
    canLeave: canTransitionOrderStatus(order, 'on_the_way'),
    canArrive: canTransitionOrderStatus(order, 'arriving'),
    canDeliver: canTransitionOrderStatus(order, 'delivered'),
  };
}

// Distancia/ETA estimadas a partir de minutos fueron eliminadas: sin coordenadas
// reales del cliente no se puede calcular una distancia ni un tiempo de llegada
// honestos, así que no se muestran números inventados (ver tracking y rider).

export function getRouteProgress(order) {
  if (!order) return 0;
  if (order.status === 'delivered') return 1;
  if (order.status === 'arriving') return 0.84;
  if (order.status === 'on_the_way') return 0.62;
  return 0.04;
}

export function getRiderStateLabel(order) {
  if (!order) return 'Sin pedido asignado';
  if (order.status === 'delivered') return 'Entregado';
  if (order.status === 'arriving') return 'Llegando al cliente';
  if (order.status === 'on_the_way') return 'En camino al cliente';
  return 'Esperando salida del local';
}
