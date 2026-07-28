import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canAssignBusinessRider,
  handleProductionOperationsAction,
  handleProductionOperationsPageHide,
  handleProductionOperationsViewChange,
  initProductionOperations,
  isRoleAuthorizedForView,
  nextBusinessStatus,
  nextRiderStatus,
  resetProductionOperationsForTests,
  riderOperationalOrderMarkup,
  selectPrimaryRiderOrder,
} from '../js/production-operations.js';
import {
  getOrderRepository,
  resetRepositoryFactoryForTests,
} from '../js/repositories/repository_factory.js';
import {
  getSupabaseClient,
  resetSupabaseClientForTests,
} from '../js/services/supabase-client.js';

test('owner/admin/staff y rider sólo habilitan su vista operativa', () => {
  assert.equal(isRoleAuthorizedForView('owner', 'business'), true);
  assert.equal(isRoleAuthorizedForView('admin', 'business'), true);
  assert.equal(isRoleAuthorizedForView('staff', 'business'), true);
  assert.equal(isRoleAuthorizedForView('rider', 'business'), false);
  assert.equal(isRoleAuthorizedForView('rider', 'rider'), true);
  assert.equal(isRoleAuthorizedForView('owner', 'rider'), false);
});

test('negocio avanza sin saltos y deja delivery listo para el rider', () => {
  assert.equal(nextBusinessStatus({ workflowStatus: 'submitted', deliveryMode: 'delivery' }), 'accepted');
  assert.equal(nextBusinessStatus({ workflowStatus: 'accepted', deliveryMode: 'delivery' }), 'preparing');
  assert.equal(nextBusinessStatus({ workflowStatus: 'preparing', deliveryMode: 'delivery' }), 'ready');
  assert.equal(nextBusinessStatus({ workflowStatus: 'ready', deliveryMode: 'delivery' }), null);
  assert.equal(nextBusinessStatus({ workflowStatus: 'ready', deliveryMode: 'pickup' }), 'delivered');
  assert.equal(nextBusinessStatus({ workflowStatus: 'delivered', deliveryMode: 'delivery' }), null);
});

test('negocio asigna o reasigna rider solo antes del retiro', () => {
  assert.equal(canAssignBusinessRider({ workflowStatus: 'ready', deliveryMode: 'delivery' }), true);
  assert.equal(canAssignBusinessRider({ workflowStatus: 'assigned', deliveryMode: 'delivery' }), true);
  assert.equal(canAssignBusinessRider({ workflowStatus: 'picked_up', deliveryMode: 'delivery' }), false);
  assert.equal(canAssignBusinessRider({ workflowStatus: 'ready', deliveryMode: 'pickup' }), false);
});

test('rider reclama, avanza, llega y entrega sin simulaciones', () => {
  assert.equal(nextRiderStatus({ workflowStatus: 'ready' }), 'on_the_way');
  assert.equal(nextRiderStatus({ workflowStatus: 'assigned' }), 'on_the_way');
  assert.equal(nextRiderStatus({ workflowStatus: 'picked_up' }), 'on_the_way');
  assert.equal(nextRiderStatus({ workflowStatus: 'on_the_way' }), 'arrived');
  assert.equal(nextRiderStatus({ workflowStatus: 'arrived' }), 'delivered');
  assert.equal(nextRiderStatus({ workflowStatus: 'delivered' }), null);
});

test('elige una entrega primaria determinística y prioriza la que está en curso', () => {
  const orders = [
    { id: 'LT-READY', workflowStatus: 'ready', updatedAt: '2026-07-28T14:00:00Z' },
    { id: 'LT-ROUTE', workflowStatus: 'on_the_way', updatedAt: '2026-07-28T12:00:00Z' },
    { id: 'LT-ARRIVED-OLD', workflowStatus: 'arrived', updatedAt: '2026-07-28T11:00:00Z' },
    { id: 'LT-ARRIVED-NEW', workflowStatus: 'arrived', updatedAt: '2026-07-28T13:00:00Z' },
  ];

  assert.equal(selectPrimaryRiderOrder(orders).id, 'LT-ARRIVED-NEW');
  assert.equal(selectPrimaryRiderOrder([]), null);
});

test('el ultimo fix con sharing pausado ofrece estado y control para reactivar GPS', () => {
  resetProductionOperationsForTests();
  const order = operationalRiderOrder('LT-GPS-PAUSED');
  const markup = riderOperationalOrderMarkup(order, operationalMapContext(order.id));

  assert.match(markup, /Seguimiento pausado/i);
  assert.match(markup, /data-production-gps-start="LT-GPS-PAUSED"/);
  assert.match(markup, /Reactivar GPS/i);
  assert.doesNotMatch(markup, /data-production-gps-stop/);
});

test('GPS productivo muestra Detener GPS al compartir y se corta al salir de rider', async () => {
  const businessId = '11111111-1111-4111-8111-111111111111';
  const riderId = '22222222-2222-4222-8222-222222222222';
  const orderId = '33333333-3333-4333-8333-333333333333';
  const runtime = {
    mode: 'production',
    repository: {
      provider: 'supabase',
      supabaseUrl: 'https://project.supabase.co',
      publishableKey: 'sb_publishable_browser-lifecycle-test',
      businessId,
      pollMs: 60_000,
    },
  };
  const order = {
    id: orderId,
    public_code: 'LT-GPS-LIFECYCLE',
    business_id: businessId,
    status: 'on_the_way',
    delivery_mode: 'delivery',
    customer_name: 'Cliente GPS',
    customer_phone: '2995550000',
    address_label: 'Roca 123',
    payment_method: 'coordinate',
    subtotal: 1000,
    delivery_fee: 0,
    total: 1000,
    currency_code: 'ARS',
    assigned_rider_user_id: riderId,
    order_items: [],
    rider_locations: [],
    created_at: '2026-07-25T12:00:00.000Z',
    updated_at: '2026-07-25T12:00:00.000Z',
  };
  const membership = {
    business_id: businessId,
    user_id: riderId,
    role: 'rider',
    is_active: true,
  };
  const client = createLifecycleClient({ businessId, riderId, order, membership });
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalRuntime = globalThis.__LA_TABA_RUNTIME_CONFIG__;
  const cleared = [];
  let nextWatchId = 300;
  let latestPositionCallback = null;

  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: new URL('https://app.example.test/#rider'),
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      geolocation: {
        watchPosition: (onPosition) => {
          latestPositionCallback = onPosition;
          return ++nextWatchId;
        },
        clearWatch: (watchId) => cleared.push(watchId),
      },
    },
  });
  globalThis.__LA_TABA_RUNTIME_CONFIG__ = runtime;

  try {
    resetProductionOperationsForTests();
    resetRepositoryFactoryForTests();
    resetSupabaseClientForTests();
    getSupabaseClient(runtime.repository, {
      storage: null,
      createClientImpl: () => client,
    });
    let operationRenders = 0;
    initProductionOperations({
      onChange: () => {
        operationRenders += 1;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const gpsTarget = {
      closest(selector) {
        return selector === '[data-production-gps-start]'
          ? { dataset: { productionGpsStart: orderId } }
          : null;
      },
    };

    let started = await handleProductionOperationsAction(gpsTarget);
    if (!started.ok) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      started = await handleProductionOperationsAction(gpsTarget);
    }
    assert.equal(started.ok, true);

    const activeMarkup = riderOperationalOrderMarkup(
      operationalRiderOrder(order.public_code),
      operationalMapContext(order.public_code),
    );
    assert.match(activeMarkup, /data-production-gps-stop/);
    assert.match(activeMarkup, /Detener GPS/i);
    assert.doesNotMatch(activeMarkup, /data-production-gps-start/);

    let resolveStatusUpdate;
    let statusUpdateAttempts = 0;
    const statusUpdateResult = new Promise((resolve) => {
      resolveStatusUpdate = resolve;
    });
    getOrderRepository().updateOrderStatus = async () => {
      statusUpdateAttempts += 1;
      return statusUpdateResult;
    };
    const arrivalControl = {
      dataset: {
        productionRiderNext: orderId,
        nextStatus: 'arrived',
      },
      disabled: false,
      textContent: 'Llegué',
      setAttribute() {},
      removeAttribute() {},
      get isConnected() { return false; },
      closest(selector) {
        return selector === '[data-production-rider-next]' ? this : null;
      },
    };
    const rendersBeforeArrival = operationRenders;
    const firstArrival = handleProductionOperationsAction(arrivalControl);
    const duplicateArrival = await handleProductionOperationsAction(arrivalControl);
    assert.equal(statusUpdateAttempts, 1);
    assert.equal(duplicateArrival.ok, false);
    assert.match(duplicateArrival.message, /ya está en curso/i);
    assert.equal(arrivalControl.disabled, true);
    resolveStatusUpdate({ ok: false, message: 'Falla de red controlada.' });
    assert.equal((await firstArrival).ok, false);
    assert.ok(
      operationRenders >= rendersBeforeArrival + 2,
      'se vuelve a renderizar después de liberar el guard pendiente',
    );

    let publishAttempts = 0;
    getOrderRepository().updateRiderLocation = async () => {
      publishAttempts += 1;
      throw new Error('network down');
    };
    const position = {
      coords: {
        latitude: -38.95,
        longitude: -68.06,
        accuracy: 12,
        heading: null,
        speed: null,
      },
      timestamp: Date.now(),
    };
    latestPositionCallback(position);
    await new Promise((resolve) => setTimeout(resolve, 0));
    latestPositionCallback(position);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(publishAttempts, 2);
    assert.equal(handleProductionOperationsViewChange('rider'), false);
    assert.deepEqual(cleared, []);

    assert.equal(handleProductionOperationsViewChange('tracking'), true);
    assert.deepEqual(cleared, [301]);
    assert.equal(handleProductionOperationsViewChange('home'), false);

    assert.equal((await handleProductionOperationsAction(gpsTarget)).ok, true);
    assert.equal(handleProductionOperationsPageHide(), true);
    assert.deepEqual(cleared, [301, 302]);
    assert.equal(handleProductionOperationsPageHide(), false);
  } finally {
    getOrderRepository().stopSync?.();
    resetProductionOperationsForTests();
    resetRepositoryFactoryForTests();
    resetSupabaseClientForTests();
    if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
    else delete globalThis.location;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
    if (originalRuntime === undefined) delete globalThis.__LA_TABA_RUNTIME_CONFIG__;
    else globalThis.__LA_TABA_RUNTIME_CONFIG__ = originalRuntime;
  }
});

function operationalRiderOrder(id) {
  return {
    id,
    publicCode: id,
    status: 'on_the_way',
    workflowStatus: 'on_the_way',
    deliveryMode: 'delivery',
    assignedRiderId: '22222222-2222-4222-8222-222222222222',
    customerName: 'Cliente GPS',
    customerPhone: '2995550000',
    address: 'Roca 123',
    addressDetails: {
      label: 'Roca 123',
      streetLine: 'Roca 123',
      locality: 'Neuquen',
    },
    paymentMethod: 'coordinate',
    total: 1000,
    currencyCode: 'ARS',
  };
}

function operationalMapContext(orderId) {
  return {
    orderId,
    riderLocation: {
      lat: -38.952,
      lng: -68.059,
      accuracy: 10,
      source: 'gps',
    },
    destination: {
      lat: -38.95,
      lng: -68.05,
      label: 'Cliente',
    },
    store: {
      lat: -38.96,
      lng: -68.07,
      label: 'TABA',
    },
    priority: 'client',
  };
}

function createLifecycleClient({ businessId, riderId, order, membership }) {
  const session = { user: { id: riderId, is_anonymous: false } };
  return {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      getUser: async () => ({ data: { user: session.user }, error: null }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe() {} } },
      }),
      signOut: async () => ({ error: null }),
    },
    from(table) {
      const query = {
        select() { return query; },
        eq() { return query; },
        order() { return query; },
        limit() { return query; },
        insert() { return query; },
        async maybeSingle() {
          if (table === 'business_members') return { data: membership, error: null, status: 200 };
          if (table === 'businesses') {
            return {
              data: {
                id: businessId,
                name: 'TABA',
                address: 'Neuquén',
                currency_code: 'ARS',
                ordering_enabled: true,
                ordering_verified: true,
                delivery_enabled: true,
                pickup_enabled: true,
                is_active: true,
                status: 'active',
              },
              error: null,
              status: 200,
            };
          }
          if (table === 'orders') return { data: order, error: null, status: 200 };
          return { data: null, error: null, status: 200 };
        },
        async single() {
          return { data: null, error: null, status: 200 };
        },
        then(resolve, reject) {
          const data = table === 'orders' ? [order] : [];
          return Promise.resolve({ data, error: null, status: 200 }).then(resolve, reject);
        },
      };
      return query;
    },
    rpc: async () => ({ data: null, error: null, status: 200 }),
    channel() {
      return {
        on() { return this; },
        subscribe(callback) {
          callback('SUBSCRIBED');
          return this;
        },
        unsubscribe() {},
      };
    },
    removeChannel: async () => {},
  };
}
