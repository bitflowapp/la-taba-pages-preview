import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canAssignBusinessRider,
  getBusinessIntakeStatus,
  handleProductionOperationsAction,
  handleProductionOperationsPageHide,
  handleProductionOperationsViewChange,
  initProductionOperations,
  isRoleAuthorizedForView,
  nextBusinessStatus,
  nextRiderStatus,
  resetProductionOperationsForTests,
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

test('rider sigue la cadena canónica del servidor sin saltear estados', () => {
  // ready no ofrece avance: primero hay que reclamar (claim_delivery_order).
  assert.equal(nextRiderStatus({ workflowStatus: 'ready' }), null);
  // assigned → picked_up → on_the_way → arrived: exactamente los RPC
  // mark_delivery_picked_up / start_rider_delivery / mark_rider_arrived.
  assert.equal(nextRiderStatus({ workflowStatus: 'assigned' }), 'picked_up');
  assert.equal(nextRiderStatus({ workflowStatus: 'picked_up' }), 'on_the_way');
  assert.equal(nextRiderStatus({ workflowStatus: 'on_the_way' }), 'arrived');
  // De arrived se sale sólo con el código del cliente (confirm_delivery_code).
  assert.equal(nextRiderStatus({ workflowStatus: 'arrived' }), null);
  assert.equal(nextRiderStatus({ workflowStatus: 'delivered' }), null);
});

test('GPS productivo se corta al salir de rider y en pagehide', async () => {
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
    initProductionOperations();
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

test('dos activaciones de acceso concurrentes no matan el intake del ganador', async () => {
  // Regresión medida contra staging real: el submit del login y el evento
  // SIGNED_IN corrían activateAuthorizedAccess en paralelo; el perdedor
  // ejecutaba stopBusinessIntake() y el Panel quedaba autenticado con la
  // bandeja congelada en "Error recuperable". La cola de activaciones los
  // serializa; acá se dispara la misma carrera con dos eventos de auth.
  const businessId = '11111111-1111-4111-8111-111111111111';
  const staffId = '44444444-4444-4444-8444-444444444444';
  const runtime = {
    mode: 'production',
    repository: {
      provider: 'supabase',
      supabaseUrl: 'https://project.supabase.co',
      publishableKey: 'sb_publishable_access-race-test',
      businessId,
      pollMs: 60_000,
    },
  };
  const membership = { business_id: businessId, user_id: staffId, role: 'staff', is_active: true };
  const session = { user: { id: staffId, is_anonymous: false } };
  const authCallbacks = [];
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const client = {
    auth: {
      getSession: async () => { await delay(5); return { data: { session }, error: null }; },
      getUser: async () => ({ data: { user: session.user }, error: null }),
      onAuthStateChange: (callback) => {
        authCallbacks.push(callback);
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signOut: async () => ({ error: null }),
    },
    from(table) {
      const query = {
        select() { return query; },
        eq() { return query; },
        in() { return query; },
        gte() { return query; },
        order() { return query; },
        limit() { return query; },
        insert() { return query; },
        async maybeSingle() {
          await delay(5);
          if (table === 'business_members') return { data: membership, error: null, status: 200 };
          return { data: null, error: null, status: 200 };
        },
        async single() { return { data: null, error: null, status: 200 }; },
        then(resolve, reject) {
          return delay(5)
            .then(() => ({ data: [], error: null, status: 200 }))
            .then(resolve, reject);
        },
      };
      return query;
    },
    rpc: async () => ({ data: [], error: null, status: 200 }),
    channel() {
      return {
        on() { return this; },
        subscribe(callback) { callback('SUBSCRIBED'); return this; },
        unsubscribe() {},
      };
    },
    removeChannel: async () => {},
  };

  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const originalRuntime = globalThis.__LA_TABA_RUNTIME_CONFIG__;
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: new URL('https://app.example.test/#business'),
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
    initProductionOperations();
    // La carrera: dos eventos de auth casi simultáneos (SIGNED_IN + refresh).
    for (const callback of [...authCallbacks]) callback('SIGNED_IN', { user: session.user });
    for (const callback of [...authCallbacks]) callback('TOKEN_REFRESHED', { user: session.user });
    for (let round = 0; round < 30; round += 1) await delay(6);

    const status = getBusinessIntakeStatus();
    assert.equal(status.phase, 'connected', `el intake debe quedar vivo, no "${status.phase}" (${status.error})`);
    assert.equal(status.error, '');
  } finally {
    resetProductionOperationsForTests();
    resetRepositoryFactoryForTests();
    resetSupabaseClientForTests();
    if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
    globalThis.__LA_TABA_RUNTIME_CONFIG__ = originalRuntime;
  }
});

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
