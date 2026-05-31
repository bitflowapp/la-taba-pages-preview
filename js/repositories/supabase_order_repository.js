import { BUSINESS_CONFIG } from '../config.js';
import { getCartItems, validateCartForCheckout } from '../cart.js';
import {
  normalizeOrderDraft,
  normalizeTrackingLocation,
  toDomainOrder,
} from '../core/domain.js';
import { calculateTotals, normalizeMoneyValue } from '../core/pricing.js';
import {
  getNextWorkflowStatus,
  normalizeWorkflowStatus,
  toDemoOrderStatus,
} from '../core/order-workflow.js';
import { sanitizeNotes, sanitizeText } from '../core/validators.js';
import { getState, paymentLabel, statusLabel, updateState } from '../state.js';
import { repositoryResult } from './order_repository.js';

export const DEFAULT_SUPABASE_BUSINESS_ID = '00000000-0000-4000-8000-000000000001';

export function createSupabaseOrderRepository({
  supabaseUrl,
  anonKey,
  businessId = DEFAULT_SUPABASE_BUSINESS_ID,
  fetchImpl = globalThis.fetch,
  pollMs = 5000,
} = {}) {
  const baseUrl = String(supabaseUrl || '').replace(/\/+$/, '');
  const key = String(anonKey || '');
  if (!baseUrl || !key || typeof fetchImpl !== 'function') {
    throw new Error('Supabase repository requiere supabaseUrl, anonKey y fetch.');
  }

  const restBase = `${baseUrl}/rest/v1`;
  let syncStop = null;

  async function request(path, { method = 'GET', body, prefer = null } = {}) {
    const headers = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(body == null ? {} : { 'Content-Type': 'application/json' }),
      ...(prefer ? { Prefer: prefer } : {}),
    };
    const response = await fetchImpl(`${restBase}${path}`, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
    });
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      return repositoryResult(false, { message: errorMessage(payload, response.status), data: payload, status: response.status });
    }
    return repositoryResult(true, { data: payload, status: response.status });
  }

  async function fetchOrderByPublicId(publicId) {
    const clean = encodeURIComponent(String(publicId || ''));
    if (!clean) return null;
    const filter = isUuid(publicId) ? `id=eq.${clean}` : `code=eq.${clean}`;
    const result = await request(`/orders?${filter}&select=${orderSelect()}&limit=1`);
    if (!result.ok) return null;
    return Array.isArray(result.data) ? result.data[0] || null : null;
  }

  async function fetchOrders() {
    const result = await request(`/orders?business_id=eq.${encodeURIComponent(businessId)}&select=${orderSelect()}&order=created_at.desc&limit=100`);
    if (!result.ok) return result;
    const rows = Array.isArray(result.data) ? result.data : [];
    return repositoryResult(true, { rows, orders: mirrorOrders(rows, { replace: true }) });
  }

  const repository = {
    mode: 'supabase',
    businessId,
    startSync() {
      if (syncStop) return syncStop;
      syncStop = startPolling(async () => { await fetchOrders(); }, pollMs);
      return syncStop;
    },
    stopSync() {
      if (syncStop) syncStop();
      syncStop = null;
    },
    async createOrder(orderDraft = {}) {
      const values = normalizeOrderDraft(orderDraft);
      const validation = validateCartForCheckout(values.deliveryMode);
      if (!validation.ok) return validation;
      if (!values.customerName) return repositoryResult(false, { message: 'Ingresá el nombre del cliente.' });
      if (!values.customerPhone) return repositoryResult(false, { message: 'Ingresá un teléfono de contacto.' });
      if (values.deliveryMode === 'delivery' && !values.customerAddress) {
        return repositoryResult(false, { message: 'Ingresá la dirección para el envío.' });
      }

      const cartItems = getCartItems();
      const items = cartItems.map((item) => ({
        productId: item.product.id,
        name: item.product.name,
        quantity: item.quantity,
        unit: item.product.unit,
        unitPrice: item.product.price,
        subtotal: normalizeMoneyValue(item.quantity * item.product.price, 0),
      }));
      const totals = calculateTotals(items, values.deliveryMode);
      const orderId = newUuid();
      const code = createOrderCode();
      const now = new Date().toISOString();

      const orderPayload = {
        id: orderId,
        business_id: businessId,
        code,
        status: 'submitted',
        fulfillment_type: values.deliveryMode,
        customer_name: values.customerName,
        customer_phone: values.customerPhone,
        customer_whatsapp: values.customerPhone,
        address_label: values.deliveryMode === 'pickup' ? BUSINESS_CONFIG.address : values.customerAddress,
        notes: values.customerNotes || 'Sin notas',
        payment_method: values.paymentMethod,
        subtotal: totals.subtotal,
        delivery_fee: totals.deliveryFee,
        total: totals.total,
        created_at: now,
        items: items.map((item) => ({
          product_id: item.productId,
          name: item.name,
          quantity: item.quantity,
          unit: item.unit,
          unit_price: item.unitPrice,
          subtotal: item.subtotal,
        })),
      };

      // Creación transaccional: order + items + evento en una sola RPC.
      // Evita pedidos parciales si algo falla en el medio.
      const rpcResult = await request('/rpc/create_order_with_items', {
        method: 'POST',
        body: { payload: orderPayload },
      });
      if (!rpcResult.ok) {
        return repositoryResult(false, {
          message: rpcMissing(rpcResult)
            ? 'Falta aplicar la migración del backend (create_order_with_items). Revisá Supabase.'
            : rpcResult.message,
          data: rpcResult.data,
        });
      }

      const row = single(rpcResult.data) || await fetchOrderByPublicId(orderId);
      if (!row || !row.id) {
        return repositoryResult(false, { message: 'El backend no devolvió el pedido creado.' });
      }
      const order = mirrorCreatedOrder(row, items);
      return repositoryResult(true, {
        order,
        domainOrder: toDomainOrder(order),
        message: `Pedido ${order.id} creado.`,
      });
    },
    async getActiveOrder() {
      const result = await fetchOrders();
      if (!result.ok) return null;
      return result.orders.find((order) => !['delivered', 'canceled', 'cancelled'].includes(order.status)) || result.orders[0] || null;
    },
    async listOrders() {
      const result = await fetchOrders();
      return result.ok ? result.orders : [];
    },
    async updateOrderStatus(orderId, status) {
      const row = await fetchOrderByPublicId(orderId);
      if (!row) return repositoryResult(false, { message: 'Pedido no encontrado.' });
      const nextStatus = normalizeWorkflowStatus(status);
      const timestamp = new Date().toISOString();
      const patch = {
        status: nextStatus,
        updated_at: timestamp,
        ...timestampPatch(nextStatus, row, timestamp),
      };
      const result = await request(`/orders?id=eq.${encodeURIComponent(row.id)}&select=*`, {
        method: 'PATCH',
        body: patch,
        prefer: 'return=representation',
      });
      if (!result.ok) return result;
      await insertEvent(row.id, `order.${nextStatus}`, { previousStatus: row.status, nextStatus });
      const fullRow = await fetchOrderByPublicId(row.id) || { ...row, ...patch };
      const order = mirrorOrder(fullRow);
      return repositoryResult(true, {
        order,
        message: `Pedido ${order.id} actualizado a ${statusLabel(order.status)}.`,
      });
    },
    async assignRider(orderId, riderId) {
      const row = await fetchOrderByPublicId(orderId);
      if (!row) return repositoryResult(false, { message: 'Pedido no encontrado.' });
      const cleanRiderId = sanitizeText(riderId, { maxLength: 80 }) || null;
      const result = await request(`/orders?id=eq.${encodeURIComponent(row.id)}&select=*`, {
        method: 'PATCH',
        body: { assigned_rider_id: cleanRiderId },
        prefer: 'return=representation',
      });
      if (!result.ok) return result;
      await insertEvent(row.id, 'order.rider_assigned', { riderId: cleanRiderId });
      const fullRow = await fetchOrderByPublicId(row.id) || single(result.data);
      return repositoryResult(true, {
        order: mirrorOrder(fullRow),
        message: 'Rider asignado.',
      });
    },
    async updateRiderLocation(orderId, location) {
      const normalized = normalizeTrackingLocation(location);
      if (!normalized) return repositoryResult(false, { message: 'Ubicación inválida.' });
      const row = await fetchOrderByPublicId(orderId);
      if (!row) return repositoryResult(false, { message: 'Pedido no encontrado.' });
      const payload = {
        order_id: row.id,
        rider_id: row.assigned_rider_id || null,
        lat: normalized.lat,
        lng: normalized.lng,
        accuracy: normalized.accuracy ?? null,
        heading: normalized.heading ?? null,
        speed: normalized.speed ?? null,
        source: normalized.source,
        created_at: normalized.lastFixAt,
      };
      const result = await request('/rider_locations?select=*', {
        method: 'POST',
        body: payload,
        prefer: 'return=representation',
      });
      if (!result.ok) return result;
      await insertEvent(row.id, 'rider.location', { source: normalized.source });
      const fullRow = await fetchOrderByPublicId(row.id) || {
        ...row,
        rider_locations: [single(result.data), ...(row.rider_locations || [])],
      };
      const order = mirrorOrder(fullRow);
      mirrorSimulationLocation(order, normalized);
      return repositoryResult(true, {
        location: normalized,
        order,
        message: 'Ubicación del rider actualizada.',
      });
    },
    subscribeToOrder(orderId, callback) {
      if (typeof callback !== 'function') return () => {};
      return startPolling(async () => {
        const row = await fetchOrderByPublicId(orderId);
        callback(row ? toDomainOrder(mirrorOrder(row)) : null);
      }, pollMs);
    },
    subscribeToBusinessOrders(callback) {
      if (typeof callback !== 'function') return () => {};
      return startPolling(async () => callback(await repository.listOrders()), pollMs);
    },
  };

  async function insertEvent(orderId, type, payload = {}) {
    await request('/order_events', {
      method: 'POST',
      body: {
        order_id: orderId,
        type,
        actor_type: 'web',
        payload,
      },
    });
  }

  return repository;
}

function orderSelect() {
  return encodeURIComponent('*,order_items(*),rider_locations(*)');
}

function mirrorOrders(rows, { replace = false } = {}) {
  const orders = rows.map(rowToDemoOrder).filter(Boolean);
  updateState((draft) => {
    const currentLastOrderId = draft.lastOrderId;
    if (replace) {
      draft.orders = orders;
    } else {
      const keys = new Set(orders.flatMap((order) => [order.id, order.backendId]).filter(Boolean));
      draft.orders = [
        ...orders,
        ...draft.orders.filter((order) => !keys.has(order.id) && !keys.has(order.backendId)),
      ];
    }
    const currentOrder = draft.orders.find((order) => order.id === currentLastOrderId || order.backendId === currentLastOrderId);
    draft.lastOrderId = currentOrder
      ? currentOrder.id
      : null;
  });
  return orders.map(toDomainOrder).filter(Boolean);
}

function mirrorCreatedOrder(row, cartItems) {
  const order = rowToDemoOrder(row);
  updateState((draft) => {
    draft.orders = [
      order,
      ...draft.orders.filter((candidate) => candidate.id !== order.id && candidate.backendId !== order.backendId),
    ];
    draft.lastOrderId = order.id;
    for (const item of cartItems) {
      const product = draft.products.find((candidate) => candidate.id === item.productId);
      if (product) product.stock = Math.max(0, product.stock - item.quantity);
    }
    draft.cart = [];
  });
  return order;
}

function mirrorOrder(row) {
  const order = rowToDemoOrder(row);
  updateState((draft) => {
    const index = draft.orders.findIndex((candidate) => candidate.id === order.id || candidate.backendId === order.backendId);
    if (index >= 0) draft.orders[index] = order;
    else draft.orders.unshift(order);
  });
  return order;
}

function mirrorSimulationLocation(order, location) {
  if (!order || order.deliveryMode !== 'delivery') return;
  if (['delivered', 'cancelled'].includes(order.status)) return;
  updateState((draft) => {
    const current = draft.simulation && draft.simulation.orderId === order.id ? draft.simulation : {};
    draft.simulation = {
      ...current,
      orderId: order.id,
      running: false,
      mode: location.source === 'gps' ? 'gps' : 'demo',
      source: location.source === 'gps' ? 'gps' : 'simulation',
      routeId: current.routeId || order.delivery?.demoDestinationId || 'neuquen',
      progress: Number.isFinite(Number(current.progress)) ? current.progress : 0,
      baseEta: Number.isFinite(Number(current.baseEta)) ? current.baseEta : order.delivery?.estimatedMinutes || 0,
      etaMinutes: Number.isFinite(Number(current.etaMinutes)) ? current.etaMinutes : order.delivery?.estimatedMinutes || 0,
      timestamp: location.timestamp,
      lastFixAt: location.lastFixAt,
      ...(location.source === 'gps' ? { gpsStatus: 'active', lastGpsFixAt: location.lastFixAt, lastSentSource: 'gps' } : {}),
      lat: location.lat,
      lng: location.lng,
      ...(Number.isFinite(Number(location.accuracy)) ? { accuracy: location.accuracy } : {}),
      ...(Number.isFinite(Number(location.heading)) ? { heading: location.heading } : {}),
      ...(Number.isFinite(Number(location.speed)) ? { speed: location.speed } : {}),
    };
  });
}

function rowToDemoOrder(row = {}) {
  if (!row.id) return null;
  const status = toDemoOrderStatus(row.status);
  const deliveryMode = row.fulfillment_type === 'pickup' ? 'pickup' : 'delivery';
  const items = Array.isArray(row.order_items) ? row.order_items.map(rowToDemoItem).filter(Boolean) : [];
  const latestLocation = latestRiderLocation(row.rider_locations);
  const createdAt = normalizeIso(row.created_at);
  return {
    id: sanitizeText(row.code || row.id, { maxLength: 80 }),
    backendId: row.id,
    code: sanitizeText(row.code || row.id, { maxLength: 80 }),
    customerName: sanitizeText(row.customer_name, { fallback: 'Cliente', maxLength: 80 }),
    customerPhone: sanitizeText(row.customer_phone, { maxLength: 40 }),
    address: deliveryMode === 'pickup'
      ? BUSINESS_CONFIG.address
      : sanitizeText(row.address_label, { fallback: 'Sin dirección', maxLength: 180 }),
    deliveryMode,
    paymentMethod: paymentLabel(row.payment_method || 'cash'),
    notes: sanitizeNotes(row.notes),
    createdAt,
    updatedAt: normalizeIso(row.updated_at || row.created_at),
    status,
    items,
    subtotal: normalizeMoneyValue(row.subtotal, 0),
    deliveryFee: normalizeMoneyValue(row.delivery_fee, 0),
    total: normalizeMoneyValue(row.total, 0),
    assignedRiderId: sanitizeText(row.assigned_rider_id, { maxLength: 80 }),
    statusHistory: statusHistoryFromRow(row, status, createdAt),
    delivery: {
      driverName: deliveryMode === 'pickup' ? 'Sin asignar' : 'Rider asignado',
      driverPhone: '',
      estimatedMinutes: status === 'delivered' || status === 'cancelled' || deliveryMode === 'pickup' ? 0 : 25,
      currentLocationLabel: locationLabel(status, deliveryMode),
      ...(row.picked_up_at ? { leftStoreAt: normalizeIso(row.picked_up_at) } : {}),
      ...(row.delivered_at ? { deliveredAt: normalizeIso(row.delivered_at) } : {}),
    },
    tracking: latestLocation ? {
      lastLocation: latestLocation,
      source: latestLocation.source,
      updatedAt: latestLocation.lastFixAt,
    } : undefined,
  };
}

function rowToDemoItem(item = {}) {
  const productId = sanitizeText(item.product_id, { maxLength: 80 });
  const name = sanitizeText(item.name, { maxLength: 100 });
  if (!productId || !name) return null;
  return {
    productId,
    name,
    quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)),
    unitPrice: normalizeMoneyValue(item.unit_price, 0),
    unit: sanitizeText(item.unit, { fallback: 'unidad', maxLength: 40 }),
  };
}

function latestRiderLocation(locations) {
  if (!Array.isArray(locations) || !locations.length) return null;
  const latest = [...locations].sort((a, b) => Date.parse(b.created_at || '') - Date.parse(a.created_at || ''))[0];
  return normalizeTrackingLocation({
    lat: latest.lat,
    lng: latest.lng,
    accuracy: latest.accuracy,
    heading: latest.heading,
    speed: latest.speed,
    source: latest.source,
    timestamp: latest.created_at,
  });
}

function statusHistoryFromRow(row, status, createdAt) {
  const history = [{ status: 'received', at: createdAt }];
  if (row.accepted_at || ['preparing', 'ready', 'on_the_way', 'arriving', 'delivered'].includes(status)) {
    history.push({ status: 'preparing', at: normalizeIso(row.accepted_at || row.updated_at || createdAt) });
  }
  if (row.ready_at || ['ready', 'on_the_way', 'arriving', 'delivered'].includes(status)) {
    history.push({ status: 'ready', at: normalizeIso(row.ready_at || row.updated_at || createdAt) });
  }
  if (row.picked_up_at || ['on_the_way', 'arriving', 'delivered'].includes(status)) {
    history.push({ status: 'on_the_way', at: normalizeIso(row.picked_up_at || row.updated_at || createdAt) });
  }
  if (row.arrived_at || ['arriving', 'delivered'].includes(status)) {
    history.push({ status: 'arriving', at: normalizeIso(row.arrived_at || row.updated_at || createdAt) });
  }
  if (row.delivered_at || status === 'delivered') {
    history.push({ status: 'delivered', at: normalizeIso(row.delivered_at || row.updated_at || createdAt) });
  }
  if (row.canceled_at || status === 'cancelled') {
    history.push({ status: 'cancelled', at: normalizeIso(row.canceled_at || row.updated_at || createdAt) });
  }
  return dedupeHistory(history);
}

function dedupeHistory(history) {
  const seen = new Set();
  return history.filter((entry) => {
    if (seen.has(entry.status)) return false;
    seen.add(entry.status);
    return true;
  });
}

function timestampPatch(status, row, timestamp) {
  const patch = {};
  if (['accepted', 'preparing'].includes(status) && !row.accepted_at) patch.accepted_at = timestamp;
  if (status === 'ready' && !row.ready_at) patch.ready_at = timestamp;
  if (['picked_up', 'on_the_way'].includes(status) && !row.picked_up_at) patch.picked_up_at = timestamp;
  if (status === 'arrived' && !row.arrived_at) patch.arrived_at = timestamp;
  if (status === 'delivered' && !row.delivered_at) patch.delivered_at = timestamp;
  if (status === 'canceled' && !row.canceled_at) patch.canceled_at = timestamp;
  return patch;
}

export function nextRepositoryStatusForOrder(order) {
  const domainOrder = toDomainOrder(order);
  if (!domainOrder) return null;
  return getNextWorkflowStatus(domainOrder.status, domainOrder.fulfillmentType);
}

function locationLabel(status, deliveryMode) {
  if (deliveryMode === 'pickup') return 'Pedido para retirar en local';
  if (status === 'ready') return 'Pedido listo en el local';
  if (status === 'on_the_way') return 'El repartidor salió del local';
  if (status === 'arriving') return 'El repartidor está llegando';
  if (status === 'delivered') return 'Pedido entregado';
  if (status === 'cancelled') return 'Pedido cancelado por el negocio';
  return 'Pedido recibido por el local';
}

function startPolling(task, pollMs) {
  let active = true;
  const run = async () => {
    if (!active) return;
    try { await task(); } catch (_) { /* mantiene el ultimo estado local valido */ }
  };
  run();
  const id = setInterval(run, Math.max(1000, Number(pollMs) || 5000));
  return () => {
    active = false;
    clearInterval(id);
  };
}

function createOrderCode() {
  const date = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `LT-${date}-${suffix}`;
}

function newUuid() {
  return globalThis.crypto?.randomUUID?.() || '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (char) => (
    Number(char) ^ (Math.random() * 16 >> (Number(char) / 4))
  ).toString(16));
}

function single(payload) {
  return Array.isArray(payload) ? payload[0] || null : payload;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function normalizeIso(value, fallback = new Date().toISOString()) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

// Detecta el caso "la función RPC no existe" (migración no aplicada) para dar
// un diagnóstico claro en vez de un error genérico de PostgREST.
function rpcMissing(result) {
  if (!result || result.ok) return false;
  if (result.status === 404) return true;
  const text = `${result.data?.message || ''} ${result.data?.code || ''} ${result.message || ''}`.toLowerCase();
  return text.includes('create_order_with_items')
    || text.includes('does not exist')
    || text.includes('pgrst202')
    || text.includes('could not find');
}

function errorMessage(payload, status) {
  return sanitizeText(payload?.message || payload?.error || `Supabase respondió ${status}.`, {
    fallback: `Supabase respondió ${status}.`,
    maxLength: 180,
  });
}
