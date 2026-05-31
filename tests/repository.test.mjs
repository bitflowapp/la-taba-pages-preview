import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { addToCart } from '../js/cart.js';
import { createHttpOrderRepository } from '../js/repositories/http_order_repository.js';
import { createDemoOrderRepository } from '../js/repositories/demo_order_repository.js';
import {
  getDataMode,
  getOrderRepository,
  resetRepositoryFactoryForTests,
} from '../js/repositories/repository_factory.js';
import { getState } from '../js/state.js';
import { resetState } from './helpers.mjs';

beforeEach(() => {
  resetState();
  resetRepositoryFactoryForTests();
  setLocationSearch('');
});

test('repository factory keeps GitHub Pages in demo mode by default', () => {
  const repository = getOrderRepository();
  assert.equal(getDataMode(), 'demo');
  assert.equal(repository.mode, 'demo');
});

test('repository factory exposes demo realtime mode when relay is configured', () => {
  setLocationSearch('?relay=http://localhost:8787&room=qa');
  resetRepositoryFactoryForTests();

  const repository = getOrderRepository();
  assert.equal(getDataMode(), 'demo-realtime');
  assert.equal(repository.mode, 'demo-realtime');
  assert.equal(typeof repository.getTransportStatus, 'function');
});

test('demo order repository creates orders through the current checkout flow', () => {
  addToCart('p-vacio', 1);
  const repository = createDemoOrderRepository();
  const before = getState().orders.length;

  const result = repository.createOrder({
    customerName: 'Cliente Repo',
    customerPhone: '2995550000',
    customerAddress: 'Roca 321',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
    customerNotes: '',
  });

  assert.equal(result.ok, true);
  assert.equal(result.order.status, 'received');
  assert.equal(result.domainOrder.status, 'submitted');
  assert.equal(getState().orders.length, before + 1);
  assert.deepEqual(getState().cart, []);
});

test('demo repository updates status, rider and GPS location without bypassing state', () => {
  addToCart('p-vacio', 1);
  const repository = createDemoOrderRepository();
  const created = repository.createOrder({
    customerName: 'Rider Repo',
    customerPhone: '2995550000',
    customerAddress: 'Roca 321',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
    customerNotes: '',
  });
  const orderId = created.order.id;

  const statusResult = repository.updateOrderStatus(orderId, 'accepted');
  assert.equal(statusResult.ok, true);
  assert.equal(getState().orders[0].status, 'preparing');

  const riderResult = repository.assignRider(orderId, 'rider-prod-1');
  assert.equal(riderResult.ok, true);
  assert.equal(riderResult.order.assignedRiderId, 'rider-prod-1');

  const locationResult = repository.updateRiderLocation(orderId, {
    lat: -38.951,
    lng: -68.061,
    accuracy: 9,
    heading: 92,
    speed: 1.4,
    timestamp: Date.now(),
    source: 'gps',
  });
  assert.equal(locationResult.ok, true);
  assert.equal(getState().simulation.source, 'gps');
  assert.equal(getState().simulation.gpsStatus, 'active');
  assert.equal(locationResult.order.tracking.lastLocation.source, 'gps');
});

test('demo repository subscriptions publish business and order snapshots', () => {
  const repository = createDemoOrderRepository();
  const businessSnapshots = [];
  const orderSnapshots = [];

  const stopBusiness = repository.subscribeToBusinessOrders((orders) => businessSnapshots.push(orders.length));
  addToCart('p-vacio', 1);
  const created = repository.createOrder({
    customerName: 'Sub Repo',
    customerPhone: '2995550000',
    customerAddress: 'Roca 321',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
    customerNotes: '',
  });
  const stopOrder = repository.subscribeToOrder(created.order.id, (order) => orderSnapshots.push(order?.status));
  repository.updateOrderStatus(created.order.id, 'accepted');

  stopBusiness();
  stopOrder();

  assert.ok(businessSnapshots.at(-1) >= 2);
  assert.deepEqual(orderSnapshots, ['submitted', 'preparing']);
});

test('http repository speaks the future backend contract with normalized payloads', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        if (url.endsWith('/orders')) {
          return {
            order: {
              id: 'LT-HTTP',
              status: 'received',
              deliveryMode: 'delivery',
              customerName: 'HTTP QA',
              customerPhone: '299',
              address: 'Roca 1',
              items: [{ productId: 'p-vacio', name: 'Vacio', quantity: 1, unitPrice: 1000 }],
              subtotal: 1000,
              deliveryFee: 0,
              total: 1000,
              createdAt: '2026-05-30T12:00:00.000Z',
            },
          };
        }
        return { order: null };
      },
    };
  };
  const repository = createHttpOrderRepository({ baseUrl: 'https://api.example.test', fetchImpl });
  const result = await repository.createOrder({ customerName: 'HTTP QA', deliveryMode: 'delivery' });

  assert.equal(result.ok, true);
  assert.equal(result.order.status, 'submitted');
  assert.equal(calls[0].url, 'https://api.example.test/orders');
  assert.equal(JSON.parse(calls[0].options.body).deliveryMode, 'delivery');
});

function setLocationSearch(search) {
  Object.defineProperty(globalThis, 'location', {
    value: { search },
    configurable: true,
  });
}
