import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { addToCart } from '../js/cart.js';
import { handleBusinessAction } from '../js/business.js';
import { createSupabaseOrderRepository } from '../js/repositories/supabase_order_repository.js';
import {
  getOrderRepository,
  resetRepositoryFactoryForTests,
} from '../js/repositories/repository_factory.js';
import { getState } from '../js/state.js';
import { makeTarget, resetState } from './helpers.mjs';

let originalFetch;
let originalLocation;

beforeEach(() => {
  resetState({ orders: [], lastOrderId: null });
  resetRepositoryFactoryForTests();
  originalFetch = globalThis.fetch;
  originalLocation = globalThis.location;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, 'location', { value: originalLocation, configurable: true });
  resetRepositoryFactoryForTests();
});

test('Supabase repository creates a persistent order and mirrors it locally', async () => {
  const mock = createSupabaseMock();
  addToCart('p-vacio', 1);
  const repository = createSupabaseOrderRepository({
    supabaseUrl: 'https://la-taba.supabase.co',
    anonKey: 'anon-public-key',
    fetchImpl: mock.fetch,
  });

  const result = await repository.createOrder({
    customerName: 'Cliente Supabase',
    customerPhone: '2995550000',
    customerAddress: 'Roca 321',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
    customerNotes: 'Persistente',
  });

  assert.equal(result.ok, true);
  assert.match(result.order.id, /^LT-/);
  assert.equal(result.domainOrder.status, 'submitted');
  assert.equal(getState().orders.length, 1);
  assert.equal(getState().orders[0].backendId, mock.db.orders[0].id);
  assert.equal(getState().orders[0].paymentMethod, 'Efectivo');
  assert.deepEqual(getState().cart, []);
  assert.equal(mock.calls[0].headers.apikey, 'anon-public-key');
  assert.equal(mock.db.orderItems.length, 1);
});

test('Supabase repository persists status and rider GPS updates', async () => {
  const mock = createSupabaseMock();
  addToCart('p-vacio', 1);
  const repository = createSupabaseOrderRepository({
    supabaseUrl: 'https://la-taba.supabase.co',
    anonKey: 'anon-public-key',
    fetchImpl: mock.fetch,
  });
  const created = await repository.createOrder({
    customerName: 'Rider Supabase',
    customerPhone: '2995550000',
    customerAddress: 'Roca 321',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
  });

  const ready = await repository.updateOrderStatus(created.order.id, 'ready');
  assert.equal(ready.ok, true);
  assert.equal(mock.db.orders[0].status, 'ready');
  assert.equal(getState().orders[0].status, 'ready');

  const location = await repository.updateRiderLocation(created.order.id, {
    lat: -38.951,
    lng: -68.061,
    accuracy: 8,
    heading: 91,
    speed: 1.2,
    timestamp: Date.now(),
    source: 'gps',
  });
  assert.equal(location.ok, true);
  assert.equal(mock.db.locations[0].source, 'gps');
  assert.equal(getState().simulation.source, 'gps');
  assert.equal(getState().simulation.gpsStatus, 'active');
});

test('Supabase repository keeps terminal orders out of the active order slot', async () => {
  const mock = createSupabaseMock();
  const repository = createSupabaseOrderRepository({
    supabaseUrl: 'https://la-taba.supabase.co',
    anonKey: 'anon-public-key',
    fetchImpl: mock.fetch,
  });

  addToCart('p-vacio', 1);
  const active = await repository.createOrder({
    customerName: 'Activo Supabase',
    customerPhone: '2995550000',
    customerAddress: 'Roca 321',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
  });

  addToCart('p-vacio', 1);
  const terminal = await repository.createOrder({
    customerName: 'Cancelado Supabase',
    customerPhone: '2995550000',
    customerAddress: 'Roca 321',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
  });
  await repository.updateOrderStatus(terminal.order.id, 'canceled');

  const current = await repository.getActiveOrder();
  assert.equal(current.id, active.order.id);
  assert.equal(current.status, 'submitted');
});

test('repository factory can opt into Supabase without changing demo default', async () => {
  const mock = createSupabaseMock();
  globalThis.fetch = mock.fetch;
  Object.defineProperty(globalThis, 'location', {
    value: { search: '?data=supabase&supabaseUrl=https://la-taba.supabase.co&supabaseAnonKey=anon-public-key' },
    configurable: true,
  });
  resetRepositoryFactoryForTests();

  const repository = getOrderRepository();
  assert.equal(repository.mode, 'supabase');

  addToCart('p-vacio', 1);
  const created = await repository.createOrder({
    customerName: 'Factory Supabase',
    customerPhone: '2995550000',
    customerAddress: 'Roca 321',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
  });

  const action = await handleBusinessAction(makeTarget({
    '[data-order-advance]': { orderAdvance: created.order.id },
  }));

  assert.equal(action.handled, true);
  assert.equal(action.ok, true);
  assert.equal(mock.db.orders[0].status, 'accepted');
});

function createSupabaseMock() {
  const db = { orders: [], orderItems: [], locations: [], events: [] };
  const calls = [];

  async function fetch(url, options = {}) {
    const parsed = new URL(url);
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, method: options.method || 'GET', headers: options.headers || {}, body });

    if (parsed.pathname.endsWith('/orders') && options.method === 'POST') {
      db.orders.unshift({ ...body });
      return ok([{ ...body }]);
    }

    if (parsed.pathname.endsWith('/order_items') && options.method === 'POST') {
      const rows = body.map((item, index) => ({ id: `item-${index + 1}`, ...item }));
      db.orderItems.push(...rows);
      return ok(rows);
    }

    if (parsed.pathname.endsWith('/order_events') && options.method === 'POST') {
      db.events.push(body);
      return ok({ id: `event-${db.events.length}`, ...body });
    }

    if (parsed.pathname.endsWith('/rider_locations') && options.method === 'POST') {
      const row = { id: `loc-${db.locations.length + 1}`, ...body };
      db.locations.push(row);
      return ok([row]);
    }

    if (parsed.pathname.endsWith('/orders') && options.method === 'PATCH') {
      const id = filterValue(parsed.search, 'id');
      const order = db.orders.find((candidate) => candidate.id === id);
      Object.assign(order, body);
      return ok([{ ...order }]);
    }

    if (parsed.pathname.endsWith('/orders')) {
      const row = findOrder(parsed.search, db.orders);
      const rows = row ? [rowWithRelations(row, db)] : db.orders.map((order) => rowWithRelations(order, db));
      return ok(rows);
    }

    return ok([]);
  }

  return { db, calls, fetch };
}

function findOrder(search, orders) {
  const id = filterValue(search, 'id');
  const code = filterValue(search, 'code');
  if (id) return orders.find((order) => order.id === id) || null;
  if (code) return orders.find((order) => order.code === code) || null;
  return null;
}

function rowWithRelations(order, db) {
  return {
    ...order,
    order_items: db.orderItems.filter((item) => item.order_id === order.id),
    rider_locations: db.locations.filter((location) => location.order_id === order.id),
  };
}

function filterValue(search, key) {
  const params = new URLSearchParams(search);
  const raw = params.get(key);
  return raw?.startsWith('eq.') ? raw.slice(3) : null;
}

function ok(payload) {
  return {
    ok: true,
    status: 200,
    async json() {
      return payload;
    },
  };
}
