import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { addToCart } from '../js/cart.js';
import { createHttpOrderRepository } from '../js/repositories/http_order_repository.js';
import { createDemoOrderRepository } from '../js/repositories/demo_order_repository.js';
import {
  PROFILE_CHECKOUT_AUTHORITY_SANDBOX,
  profileCheckoutAuthority,
} from '../js/core/profile-checkout.js';
import {
  getDataMode,
  getOrderRepository,
  getRepositoryDiagnostic,
  resetRepositoryFactoryForTests,
} from '../js/repositories/repository_factory.js';
import { getState } from '../js/state.js';
import { CONFIRMED_DELIVERY_POINT, resetState } from './helpers.mjs';

beforeEach(() => {
  delete globalThis.__LA_TABA_RUNTIME_CONFIG__;
  resetState();
  resetRepositoryFactoryForTests();
  setLocationSearch('');
});

test('repository factory keeps GitHub Pages in local preview mode by default', () => {
  const repository = getOrderRepository();
  assert.equal(getDataMode(), 'preview');
  assert.equal(repository.mode, 'preview');
});

test('relay query is ignored outside explicit demo mode', () => {
  setLocationSearch('?relay=http://localhost:8787&room=qa');
  resetRepositoryFactoryForTests();

  const repository = getOrderRepository();
  assert.equal(getDataMode(), 'preview');
  assert.equal(repository.mode, 'preview');
  assert.equal('getTransportStatus' in repository, false);
});

test('repository factory exposes relay only with demo=1', () => {
  setLocationSearch('?demo=1&relay=http://localhost:8787&room=qa');
  resetRepositoryFactoryForTests();

  const repository = getOrderRepository();
  assert.equal(getDataMode(), 'demo-realtime');
  assert.equal(repository.mode, 'demo-realtime');
  assert.equal(typeof repository.getTransportStatus, 'function');
  assert.equal(profileCheckoutAuthority(), PROFILE_CHECKOUT_AUTHORITY_SANDBOX);
  assert.equal(typeof repository.customerProfiles?.load, 'function');
  assert.equal(typeof repository.customerProfiles?.saveProfile, 'function');
  assert.equal(typeof repository.customerProfiles?.saveAddress, 'function');
});

test('query strings no activan Supabase ni producen fallback técnico', () => {
  setLocationSearch('?data=supabase&supabaseUrl=https://attacker.example&supabaseAnonKey=stolen-key');
  resetRepositoryFactoryForTests();

  const repository = getOrderRepository();
  assert.equal(getDataMode(), 'preview');
  assert.equal(repository.mode, 'preview');
  assert.equal(getRepositoryDiagnostic(), null);
});

test('preview default no deja diagnóstico de fallback', () => {
  const repository = getOrderRepository();
  assert.equal(repository.mode, 'preview');
  assert.equal(getRepositoryDiagnostic(), null);
});

test('supabaseUrl en la URL sin data=supabase tampoco activa red', () => {
  setLocationSearch('?supabaseUrl=https://la-taba.supabase.co&supabaseAnonKey=anon-public-key');
  resetRepositoryFactoryForTests();

  const repository = getOrderRepository();
  assert.equal(getDataMode(), 'preview');
  assert.equal(repository.mode, 'preview');
  assert.equal(getRepositoryDiagnostic(), null);
});

test('data=demo no reemplaza la bandera explícita demo=1', () => {
  setLocationSearch('?data=demo');
  resetRepositoryFactoryForTests();

  const repository = getOrderRepository();
  assert.equal(getDataMode(), 'preview');
  assert.equal(repository.mode, 'preview');
  assert.equal(getRepositoryDiagnostic(), null);
});

test('runtime productivo completo activa Supabase y usa publishableKey', () => {
  globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
    mode: 'production',
    repository: {
      provider: 'supabase',
      supabaseUrl: 'https://la-taba.supabase.co',
      publishableKey: 'publishable-key',
      businessId: '00000000-0000-4000-8000-000000000001',
    },
  };
  setLocationSearch('?data=http&api=https://attacker.example');
  resetRepositoryFactoryForTests();

  const repository = getOrderRepository();
  assert.equal(getDataMode(), 'supabase');
  assert.equal(repository.mode, 'supabase');
  assert.equal(getRepositoryDiagnostic(), null);
});

test('runtime productivo incompleto queda unavailable y nunca cae a demo/preview', () => {
  globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
    mode: 'production',
    repository: {
      provider: 'supabase',
      supabaseUrl: 'https://la-taba.supabase.co',
    },
  };
  resetRepositoryFactoryForTests();

  const repository = getOrderRepository();
  assert.equal(getDataMode(), 'unavailable');
  assert.equal(repository.mode, 'unavailable');
  assert.equal(repository.createOrder({ customerName: 'No enviar' }).ok, false);
  assert.equal(getRepositoryDiagnostic()?.blocking, true);
  assert.equal(getRepositoryDiagnostic()?.requestedMode, 'production');
});

test('runtime HTTP histórico queda fail-closed y no activa un backend sin Auth', () => {
  globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
    mode: 'production',
    repository: {
      provider: 'http',
      baseUrl: 'https://orders.example.test/api',
    },
  };
  setLocationSearch('?data=supabase&api=https://attacker.example&supabaseUrl=https://attacker.example');
  resetRepositoryFactoryForTests();

  const repository = getOrderRepository();
  assert.equal(getDataMode(), 'unavailable');
  assert.equal(repository.mode, 'unavailable');
  assert.equal(getRepositoryDiagnostic()?.blocking, true);
});

test('demo order repository creates orders through the current checkout flow', () => {
  addToCart('qa-gaseosa-cola', 1);
  const repository = createDemoOrderRepository();
  const before = getState().orders.length;

  const result = repository.createOrder({
    ...CONFIRMED_DELIVERY_POINT,
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
  addToCart('qa-gaseosa-cola', 1);
  const repository = createDemoOrderRepository();
  const created = repository.createOrder({
    ...CONFIRMED_DELIVERY_POINT,
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
  addToCart('qa-gaseosa-cola', 1);
  const created = repository.createOrder({
    ...CONFIRMED_DELIVERY_POINT,
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

test('demo repository propagates the preparation estimate so the customer can see it', () => {
  addToCart('qa-gaseosa-cola', 1);
  const repository = createDemoOrderRepository();
  const created = repository.createOrder({
    ...CONFIRMED_DELIVERY_POINT,
    customerName: 'Prep Repo',
    customerPhone: '2995550000',
    customerAddress: 'Roca 321',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
    customerNotes: '',
  });
  const orderId = created.order.id;

  const accepted = repository.updateOrderStatus(orderId, 'accepted', { estimatedPreparationMinutes: 30 });
  assert.equal(accepted.ok, true);
  assert.equal(getState().orders[0].status, 'preparing');
  assert.equal(
    getState().orders[0].delivery.estimatedPreparationMinutes,
    30,
    'el tiempo estimado debe quedar disponible para la vista del cliente',
  );
});

test('demo repository keeps the legacy two-argument updateOrderStatus working', () => {
  addToCart('qa-gaseosa-cola', 1);
  const repository = createDemoOrderRepository();
  const created = repository.createOrder({
    ...CONFIRMED_DELIVERY_POINT,
    customerName: 'Legacy Repo',
    customerPhone: '2995550000',
    customerAddress: 'Roca 321',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
    customerNotes: '',
  });

  // Llamada vieja sin options: sigue avanzando el estado sin romper.
  const accepted = repository.updateOrderStatus(created.order.id, 'accepted');
  assert.equal(accepted.ok, true);
  assert.equal(getState().orders[0].status, 'preparing');
});

test('http repository forwards the preparation estimate as an optional field', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    return { ok: true, status: 200, async json() { return { order: null }; } };
  };
  const repository = createHttpOrderRepository({ baseUrl: 'https://api.example.test', fetchImpl });

  await repository.updateOrderStatus('LT-1', 'preparing', { estimatedPreparationMinutes: 25 });
  const withPrep = JSON.parse(calls.at(-1).options.body);
  assert.equal(withPrep.status, 'preparing');
  assert.equal(withPrep.estimatedPreparationMinutes, 25);

  // La llamada vieja de dos argumentos no agrega el campo opcional.
  await repository.updateOrderStatus('LT-1', 'ready');
  const withoutPrep = JSON.parse(calls.at(-1).options.body);
  assert.equal(withoutPrep.status, 'ready');
  assert.equal('estimatedPreparationMinutes' in withoutPrep, false);
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
              items: [{ productId: 'qa-gaseosa-cola', name: 'Bebida QA', quantity: 1, unitPrice: 1000 }],
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
