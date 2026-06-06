import { getNextOrderStatus, isTerminalOrderStatus } from './order-status.js';
import { normalizeOrderAddressDetails } from './address.js';
import { sanitizeText } from './validators.js';

export const DEFAULT_PREP_MINUTES = 20;
export const PREP_TIME_OPTIONS = Object.freeze([10, 15, 20, 30, 45]);

export const BUSINESS_ORDER_FILTERS = Object.freeze([
  { id: 'all', label: 'Todos' },
  { id: 'new', label: 'Nuevos' },
  { id: 'preparing', label: 'En preparación' },
  { id: 'ready', label: 'Listos' },
  { id: 'delivery', label: 'En reparto' },
  { id: 'done', label: 'Finalizados' },
  { id: 'cancelled', label: 'Cancelados' },
]);

const BUSINESS_FILTER_IDS = new Set(BUSINESS_ORDER_FILTERS.map((filter) => filter.id));

export const BUSINESS_CANCEL_REASONS = Object.freeze([
  'Sin stock',
  'Local cerrado',
  'Cliente no responde',
  'Dirección fuera de zona',
  'Error en el pedido',
  'Otro',
]);

export const BUSINESS_STATUS_META = Object.freeze({
  received: Object.freeze({
    label: 'Nuevo / pendiente',
    shortLabel: 'Nuevo',
    copy: 'Revisar datos, stock y forma de entrega antes de aceptar.',
  }),
  preparing: Object.freeze({
    label: 'Preparando',
    shortLabel: 'Preparando',
    copy: 'Pedido aceptado. Cocina o mostrador lo esta preparando.',
  }),
  ready: Object.freeze({
    label: 'Listo',
    shortLabel: 'Listo',
    copy: 'Listo para entregar. Puede retirarse o salir a reparto.',
  }),
  on_the_way: Object.freeze({
    label: 'En reparto',
    shortLabel: 'En reparto',
    copy: 'El pedido salió del local. Sin GPS real no se muestra mapa.',
  }),
  arriving: Object.freeze({
    label: 'Llegando',
    shortLabel: 'Llegando',
    copy: 'El rider esta llegando al domicilio.',
  }),
  delivered: Object.freeze({
    label: 'Entregado',
    shortLabel: 'Entregado',
    copy: 'Pedido finalizado y guardado en historial.',
  }),
  cancelled: Object.freeze({
    label: 'Cancelado',
    shortLabel: 'Cancelado',
    copy: 'Pedido cerrado con motivo visible para auditoria.',
  }),
});

const ACTION_BY_NEXT_STATUS = Object.freeze({
  preparing: Object.freeze({
    label: 'Aceptar pedido',
    copy: 'Confirmá el pedido y avisá el tiempo de preparación.',
    requiresPrepTime: true,
  }),
  ready: Object.freeze({
    label: 'Marcar como listo',
    copy: 'Listo para entregar.',
    requiresPrepTime: false,
  }),
  on_the_way: Object.freeze({
    label: 'Enviar a reparto',
    copy: 'Sale del local. El tracking sigue siendo honesto.',
    requiresPrepTime: false,
  }),
  delivered: Object.freeze({
    label: 'Marcar como entregado',
    copy: 'Cierra el pedido y lo deja en historial.',
    requiresPrepTime: false,
  }),
});

const ORDER_STATUS_WEIGHT = Object.freeze({
  received: 0,
  preparing: 1,
  ready: 2,
  on_the_way: 3,
  arriving: 4,
  delivered: 5,
  cancelled: 6,
});

export function normalizeBusinessOrderFilter(value) {
  const candidate = sanitizeText(value, { fallback: 'all', maxLength: 24 });
  return BUSINESS_FILTER_IDS.has(candidate) ? candidate : 'all';
}

export function normalizePreparationMinutes(value, fallback = DEFAULT_PREP_MINUTES) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const minutes = Math.round(numeric);
  if (minutes <= 0 || minutes > 240) return fallback;
  return minutes;
}

export function getBusinessStatusMeta(status) {
  return BUSINESS_STATUS_META[status] || {
    label: sanitizeText(status, { fallback: 'Estado' }),
    shortLabel: sanitizeText(status, { fallback: 'Estado' }),
    copy: 'Estado del pedido actualizado.',
  };
}

export function getBusinessOrderPrimaryAction(order) {
  if (!order || isTerminalOrderStatus(order.status)) return null;
  const nextStatus = getNextOrderStatus(order);
  if (!nextStatus) return null;
  const action = ACTION_BY_NEXT_STATUS[nextStatus];
  if (!action) return null;
  return {
    nextStatus,
    label: action.label,
    copy: action.copy,
    requiresPrepTime: action.requiresPrepTime,
  };
}

export function canBusinessCancelOrder(order) {
  return Boolean(order && !isTerminalOrderStatus(order.status));
}

export function getBusinessOrderFilterCounts(orders = []) {
  const counts = {
    all: 0,
    new: 0,
    preparing: 0,
    ready: 0,
    delivery: 0,
    done: 0,
    cancelled: 0,
  };
  if (!Array.isArray(orders)) return counts;
  for (const order of orders) {
    if (!order) continue;
    counts.all += 1;
    if (order.status === 'received') counts.new += 1;
    if (order.status === 'preparing') counts.preparing += 1;
    if (order.status === 'ready') counts.ready += 1;
    if (order.status === 'on_the_way' || order.status === 'arriving') counts.delivery += 1;
    if (order.status === 'delivered') counts.done += 1;
    if (order.status === 'cancelled') counts.cancelled += 1;
  }
  return counts;
}

export function matchesBusinessOrderFilter(order, filter = 'all') {
  if (!order) return false;
  const normalized = normalizeBusinessOrderFilter(filter);
  if (normalized === 'all') return true;
  if (normalized === 'new') return order.status === 'received';
  if (normalized === 'preparing') return order.status === 'preparing';
  if (normalized === 'ready') return order.status === 'ready';
  if (normalized === 'delivery') return order.status === 'on_the_way' || order.status === 'arriving';
  if (normalized === 'done') return order.status === 'delivered';
  if (normalized === 'cancelled') return order.status === 'cancelled';
  return true;
}

export function matchesBusinessOrderSearch(order, query = '') {
  const cleanQuery = sanitizeText(query, { fallback: '', maxLength: 100 }).toLowerCase();
  if (!cleanQuery) return true;
  const address = normalizeOrderAddressDetails(order);
  const haystack = [
    order?.id,
    order?.customerName,
    order?.customerPhone,
    order?.address,
    address.label,
    address.streetLine,
    address.neighborhood,
    address.reference,
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(cleanQuery);
}

export function filterBusinessOrders(orders = [], { filter = 'all', query = '' } = {}) {
  if (!Array.isArray(orders)) return [];
  return orders
    .filter((order) => matchesBusinessOrderFilter(order, filter))
    .filter((order) => matchesBusinessOrderSearch(order, query))
    .sort(compareBusinessOrders);
}

export function compareBusinessOrders(a, b) {
  const statusDelta = (ORDER_STATUS_WEIGHT[a?.status] ?? 99) - (ORDER_STATUS_WEIGHT[b?.status] ?? 99);
  if (statusDelta !== 0) return statusDelta;
  return orderTimestamp(b) - orderTimestamp(a);
}

function orderTimestamp(order) {
  const latestHistory = Array.isArray(order?.statusHistory)
    ? Math.max(0, ...order.statusHistory.map((entry) => new Date(entry?.at).getTime()).filter(Number.isFinite))
    : 0;
  const created = new Date(order?.createdAt).getTime();
  return Math.max(latestHistory, Number.isFinite(created) ? created : 0);
}
