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

export function estimateDemoDistanceKm(order) {
  if (!order || order.status === 'delivered') return 0;
  const explicitDistance = Number(order.delivery?.distanceKm);
  if (Number.isFinite(explicitDistance) && explicitDistance >= 0) {
    return Math.min(7.5, explicitDistance);
  }
  const minutes = Number(order.delivery?.estimatedMinutes || 0);
  if (order.status === 'ready') return 0.6;
  if (order.status === 'arriving') return 0.4;
  return Math.min(7.5, Math.max(0.6, minutes * 0.28));
}

export function formatDemoDistance(order) {
  return `${estimateDemoDistanceKm(order).toFixed(1).replace('.', ',')} km`;
}

export function formatDemoEta(order) {
  const minutes = Number(order?.delivery?.estimatedMinutes || 0);
  return minutes > 0 ? `${minutes} min` : 'En destino';
}

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
