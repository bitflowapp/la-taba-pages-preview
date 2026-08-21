import { normalizeOrderDraft, normalizeTrackingLocation, toDomainOrder } from '../core/domain.js';
import { repositoryResult } from './order_repository.js';

export function createHttpOrderRepository({
  baseUrl,
  fetchImpl = globalThis.fetch,
  pollMs = 5000,
} = {}) {
  const endpoint = String(baseUrl || '').replace(/\/+$/, '');
  if (!endpoint || typeof fetchImpl !== 'function') {
    throw new Error('HTTP order repository requiere baseUrl y fetch.');
  }

  async function request(path, { method = 'GET', body } = {}) {
    const response = await fetchImpl(`${endpoint}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      return repositoryResult(false, { message: `Backend respondio ${response.status}.` });
    }
    const payload = await response.json().catch(() => ({}));
    return repositoryResult(true, payload);
  }

  return {
    mode: 'http',
    async createOrder(orderDraft = {}) {
      const result = await request('/orders', { method: 'POST', body: normalizeOrderDraft(orderDraft) });
      return normalizeOrderPayload(result);
    },
    async getActiveOrder() {
      const result = await request('/orders/active');
      return normalizeOrderPayload(result).order || null;
    },
    async listOrders() {
      const result = await request('/orders');
      if (!result.ok) return [];
      return normalizeOrderList(result.orders || result.data || []);
    },
    async updateOrderStatus(orderId, status, options = {}) {
      // El tiempo estimado de preparación viaja como campo opcional; un backend
      // que no lo conozca simplemente lo ignora (contrato compatible hacia atrás).
      const body = { status };
      const prepMinutes = Number(options?.estimatedPreparationMinutes);
      if (Number.isFinite(prepMinutes) && prepMinutes > 0) {
        body.estimatedPreparationMinutes = Math.round(prepMinutes);
      }
      return normalizeOrderPayload(await request(`/orders/${encodeURIComponent(orderId)}/status`, {
        method: 'PATCH',
        body,
      }));
    },
    async assignRider(orderId, riderId) {
      return normalizeOrderPayload(await request(`/orders/${encodeURIComponent(orderId)}/rider`, {
        method: 'PATCH',
        body: { riderId },
      }));
    },
    async listActiveRiders() {
      return request('/business/riders/active');
    },
    async listAvailableRiderOrders() {
      return request('/rider/orders/available');
    },
    async claimRiderOrder(publicCode, options = {}) {
      return normalizeOrderPayload(await request(`/rider/orders/${encodeURIComponent(publicCode)}/claim`, {
        method: 'POST',
        body: options,
      }));
    },
    async reassignRider(orderId, riderId, options = {}) {
      return normalizeOrderPayload(await request(`/orders/${encodeURIComponent(orderId)}/rider`, {
        method: 'PATCH',
        body: { riderId, ...options },
      }));
    },
    async confirmDelivery(orderId, code) {
      return normalizeOrderPayload(await request(`/orders/${encodeURIComponent(orderId)}/delivery-confirmation`, {
        method: 'POST',
        body: { code },
      }));
    },
    async updateRiderLocation(orderId, location) {
      const normalized = normalizeTrackingLocation(location);
      if (!normalized) return repositoryResult(false, { message: 'Ubicación inválida.' });
      return normalizeOrderPayload(await request(`/orders/${encodeURIComponent(orderId)}/location`, {
        method: 'POST',
        body: normalized,
      }));
    },
    subscribeToOrder(orderId, callback) {
      if (typeof callback !== 'function') return () => {};
      return startPolling(async () => {
        const result = await request(`/orders/${encodeURIComponent(orderId)}`);
        callback(normalizeOrderPayload(result).order || null);
      }, pollMs);
    },
    subscribeToBusinessOrders(callback) {
      if (typeof callback !== 'function') return () => {};
      return startPolling(async () => callback(await this.listOrders()), pollMs);
    },
  };
}

function normalizeOrderPayload(result) {
  if (!result.ok) return result;
  const rawOrder = result.order || result.data || result;
  return {
    ...result,
    order: toDomainOrder(rawOrder),
  };
}

function normalizeOrderList(orders) {
  return Array.isArray(orders) ? orders.map(toDomainOrder).filter(Boolean) : [];
}

function startPolling(task, pollMs) {
  let active = true;
  const run = async () => {
    if (!active) return;
    try { await task(); } catch (_) { /* el consumidor conserva el ultimo estado valido */ }
  };
  run();
  const id = setInterval(run, Math.max(1000, Number(pollMs) || 5000));
  return () => {
    active = false;
    clearInterval(id);
  };
}
