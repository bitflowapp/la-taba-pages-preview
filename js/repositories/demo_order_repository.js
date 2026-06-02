import {
  createOrderFromCheckout,
  getLastOrder,
  updateOrderStatus as updateDemoOrderStatus,
} from '../orders.js';
import { getState, subscribe, updateState } from '../state.js';
import {
  normalizeOrderDraft,
  normalizeTrackingLocation,
  toDomainOrder,
} from '../core/domain.js';
import { toDemoOrderStatus } from '../core/order-workflow.js';
import { sanitizeText } from '../core/validators.js';
import { repositoryResult } from './order_repository.js';

export function createDemoOrderRepository() {
  return {
    mode: 'demo',
    createOrder(orderDraft = {}) {
      const result = createOrderFromCheckout(normalizeOrderDraft(orderDraft));
      if (!result.ok) return result;
      return {
        ...result,
        order: result.order,
        domainOrder: toDomainOrder(result.order),
      };
    },
    getActiveOrder() {
      return toDomainOrder(getLastOrder());
    },
    listOrders() {
      return getState().orders.map(toDomainOrder).filter(Boolean);
    },
    updateOrderStatus(orderId, status) {
      const result = updateDemoOrderStatus(orderId, toDemoOrderStatus(status));
      if (!result.ok) return result;
      return {
        ...result,
        order: toDomainOrder(findOrder(orderId)),
      };
    },
    assignRider(orderId, riderId) {
      const cleanRiderId = sanitizeText(riderId || 'demo-rider', { fallback: 'demo-rider', maxLength: 80 });
      if (!findOrder(orderId)) return repositoryResult(false, { message: 'Pedido no encontrado.' });
      const now = new Date().toISOString();
      updateState((draft) => {
        const order = draft.orders.find((candidate) => candidate.id === orderId);
        if (!order) return;
        order.assignedRiderId = cleanRiderId;
        order.updatedAt = now;
      });
      return repositoryResult(true, {
        message: 'Rider asignado.',
        order: toDomainOrder(findOrder(orderId)),
      });
    },
    updateRiderLocation(orderId, location) {
      const normalized = normalizeTrackingLocation(location);
      const order = findOrder(orderId);
      if (!order) return repositoryResult(false, { message: 'Pedido no encontrado.' });
      if (!normalized) return repositoryResult(false, { message: 'Ubicacion invalida.' });
      const now = new Date().toISOString();
      updateState((draft) => {
        const target = draft.orders.find((candidate) => candidate.id === orderId);
        if (target) {
          draft.lastOrderId = orderId;
          target.tracking = {
            ...(target.tracking || {}),
            lastLocation: normalized,
            source: normalized.source,
            updatedAt: normalized.lastFixAt,
          };
          target.updatedAt = now;
        }
        if (target?.deliveryMode === 'delivery' && !['delivered', 'cancelled'].includes(target.status)) {
          const current = draft.simulation && draft.simulation.orderId === orderId ? draft.simulation : {};
          draft.simulation = {
            ...current,
            orderId,
            running: false,
            mode: normalized.source === 'gps' ? 'gps' : 'demo',
            source: normalized.source === 'gps' ? 'gps' : 'simulation',
            routeId: current.routeId || target.delivery?.demoDestinationId || 'neuquen',
            progress: Number.isFinite(Number(current.progress)) ? current.progress : 0,
            baseEta: Number.isFinite(Number(current.baseEta)) ? current.baseEta : target.delivery?.estimatedMinutes || 0,
            etaMinutes: Number.isFinite(Number(current.etaMinutes)) ? current.etaMinutes : target.delivery?.estimatedMinutes || 0,
            timestamp: normalized.timestamp,
            lastFixAt: normalized.lastFixAt,
            ...(normalized.source === 'gps' ? { gpsStatus: 'active', lastGpsFixAt: normalized.lastFixAt, lastSentSource: 'gps' } : {}),
            ...(Number.isFinite(Number(normalized.lat)) ? { lat: normalized.lat } : {}),
            ...(Number.isFinite(Number(normalized.lng)) ? { lng: normalized.lng } : {}),
            ...(Number.isFinite(Number(normalized.accuracy)) ? { accuracy: normalized.accuracy } : {}),
            ...(Number.isFinite(Number(normalized.heading)) ? { heading: normalized.heading } : {}),
            ...(Number.isFinite(Number(normalized.speed)) ? { speed: normalized.speed } : {}),
          };
        }
      });
      return repositoryResult(true, {
        message: 'Ubicacion del rider actualizada.',
        location: normalized,
        order: toDomainOrder(findOrder(orderId)),
      });
    },
    subscribeToOrder(orderId, callback) {
      if (typeof callback !== 'function') return () => {};
      callback(toDomainOrder(findOrder(orderId)));
      return subscribe((state) => {
        callback(toDomainOrder(state.orders.find((order) => order.id === orderId)));
      });
    },
    subscribeToBusinessOrders(callback) {
      if (typeof callback !== 'function') return () => {};
      callback(getState().orders.map(toDomainOrder).filter(Boolean));
      return subscribe((state) => {
        callback(state.orders.map(toDomainOrder).filter(Boolean));
      });
    },
  };
}

function findOrder(orderId) {
  return getState().orders.find((order) => order.id === orderId) || null;
}
