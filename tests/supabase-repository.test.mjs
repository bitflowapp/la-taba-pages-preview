import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { addToCart } from '../js/cart.js';
import {
  isProductionCatalogReady,
  setProductionCatalogReady,
} from '../js/core/runtime-config.js';
import { createSupabaseOrderRepository } from '../js/repositories/supabase_order_repository.js';
import {
  getBusinessConfig,
  getState,
} from '../js/state.js';
import { resetState } from './helpers.mjs';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';
const CUSTOMER_ID = '44444444-4444-4444-8444-444444444444';
const RIDER_ID = '55555555-5555-4555-8555-555555555555';

const LOCAL_PRODUCT = {
  id: PRODUCT_ID,
  name: 'Agua mineral 1,5 L',
  description: 'Sin gas',
  categoryId: 'aguas',
  categoryName: 'Aguas',
  tone: 'drink',
  image: '',
  price: 2300,
  stock: 8,
  available: true,
  unit: 'botella',
  unitLabel: '1,5 L · PET',
  prepMinutes: 1,
};

beforeEach(() => {
  setProductionCatalogReady(false);
  resetState({
    products: [LOCAL_PRODUCT],
    orders: [],
    cart: [],
    lastOrderId: null,
    simulation: null,
  });
});

test('bloquea catálogo y checkout cuando el comercio no habilitó ordering', async () => {
  const mock = createSupabaseClientMock({
    businessOverrides: { ordering_enabled: false },
  });
  const repository = makeRepository(mock);

  await repository.loadBusinessConfiguration();
  await repository.loadCatalog();

  assert.equal(repository.getCatalogStatus().state, 'blocked');
  assert.equal(isProductionCatalogReady(), false);
  addToCart(PRODUCT_ID, 1);
  const result = await repository.createOrder(checkoutDraft());
  assert.equal(result.ok, false);
  assert.match(result.message, /no habilitó/i);
  assert.equal(mock.calls.rpc.some((call) => call.name === 'create_order_with_items'), false);
});

test('aplica sólo modalidades verificadas por el comercio', async () => {
  const mock = createSupabaseClientMock({
    businessOverrides: {
      delivery_enabled: false,
      pickup_enabled: true,
    },
  });
  const repository = makeRepository(mock);

  await repository.loadBusinessConfiguration();
  await repository.loadCatalog();

  assert.equal(getBusinessConfig().deliveryEnabled, false);
  assert.equal(getBusinessConfig().pickupEnabled, true);
  assert.equal(isProductionCatalogReady(), true);
});

test('crea con intención mínima y acepta sólo importes e IDs del servidor', async () => {
  const mock = createSupabaseClientMock();
  const storage = createStorage();
  const repository = makeRepository(mock, { storage });
  addToCart(PRODUCT_ID, 2);

  const result = await repository.createOrder(checkoutDraft());

  assert.equal(result.ok, true);
  assert.equal(result.order.id, 'LT-1001');
  assert.equal(result.order.workflowStatus, 'submitted');
  assert.equal(result.order.total, 5100);
  assert.deepEqual(getState().cart, []);

  const createCall = mock.calls.rpc.find((call) => call.name === 'create_order_with_items');
  assert.deepEqual(createCall.args.payload.items, [{
    product_id: PRODUCT_ID,
    quantity: 2,
  }]);
  assert.equal(createCall.args.payload.business_id, BUSINESS_ID);
  assert.match(createCall.args.payload.client_request_id, /^[A-Za-z0-9_-]{8,128}$/);
  assert.match(createCall.args.payload.tracking_token, /^[A-Za-z0-9_-]{32,256}$/);
  assert.equal(createCall.args.payload.customer_street_address, 'Roca 321');
  assert.equal(createCall.args.payload.customer_neighborhood, 'Centro');
  assert.equal(createCall.args.payload.customer_reference, 'Portón negro');
  for (const forbidden of ['id', 'code', 'status', 'subtotal', 'delivery_fee', 'total', 'unit_price', 'name']) {
    assert.equal(Object.hasOwn(createCall.args.payload, forbidden), false, forbidden);
  }
  assert.equal(Object.hasOwn(createCall.args.payload.items[0], 'unit_price'), false);
  assert.equal(Object.hasOwn(createCall.args.payload.items[0], 'name'), false);
  assert.equal(mock.calls.from.some((call) => call.action === 'update'), false);

  const access = JSON.parse(storage.getItem(`taba-order-access-v1:${BUSINESS_ID}:last`));
  assert.equal(access.orderId, result.order.backendId);
  assert.equal(access.trackingToken, result.trackingToken);
  assert.equal(storage.getItem(`taba-order-access-v1:${BUSINESS_ID}:pending`), null);
});

test('reintenta una falla con la misma clave y usa otra después de un éxito', async () => {
  const mock = createSupabaseClientMock({ failFirstCreate: true });
  const storage = createStorage();
  const repository = makeRepository(mock, { storage });
  addToCart(PRODUCT_ID, 1);

  const failed = await repository.createOrder(checkoutDraft());
  const retried = await repository.createOrder(checkoutDraft());
  addToCart(PRODUCT_ID, 1);
  const nextOrder = await repository.createOrder(checkoutDraft());

  assert.equal(failed.ok, false);
  assert.equal(retried.ok, true);
  assert.equal(nextOrder.ok, true);
  const attempts = mock.calls.rpc.filter((call) => call.name === 'create_order_with_items');
  assert.equal(attempts.length, 3);
  assert.equal(
    attempts[0].args.payload.client_request_id,
    attempts[1].args.payload.client_request_id,
  );
  assert.equal(
    attempts[0].args.payload.tracking_token,
    attempts[1].args.payload.tracking_token,
  );
  assert.notEqual(
    attempts[1].args.payload.client_request_id,
    attempts[2].args.payload.client_request_id,
  );
  assert.notEqual(
    attempts[1].args.payload.tracking_token,
    attempts[2].args.payload.tracking_token,
  );
});

test('una RPC productiva ausente no crea un pedido local falso', async () => {
  const mock = createSupabaseClientMock({ missingCreateRpc: true });
  const repository = makeRepository(mock);
  addToCart(PRODUCT_ID, 1);

  const result = await repository.createOrder(checkoutDraft());

  assert.equal(result.ok, false);
  assert.match(result.message, /migración productiva/i);
  assert.equal(getState().orders.length, 0);
  assert.equal(getState().cart.length, 1);
});

test('cambia estados sólo por RPC con compare-and-swap', async () => {
  const mock = createSupabaseClientMock();
  const row = mock.seedOrder({ status: 'received' });
  const repository = makeRepository(mock);

  const result = await repository.updateOrderStatus(row.public_code, 'accepted');

  assert.equal(result.ok, true);
  assert.equal(result.order.workflowStatus, 'accepted');
  const change = mock.calls.rpc.find((call) => call.name === 'change_order_status');
  assert.deepEqual(change.args, {
    p_order_id: row.id,
    p_expected_status: 'submitted',
    p_new_status: 'accepted',
  });
  assert.equal(mock.calls.from.some((call) => call.action === 'update'), false);
});

test('falla cerrado al asignar rider y publica sólo GPS del rider asignado', async () => {
  const mock = createSupabaseClientMock({ userId: RIDER_ID });
  const row = mock.seedOrder({
    status: 'on_the_way',
    assigned_rider_user_id: RIDER_ID,
  });
  const repository = makeRepository(mock);

  const assignment = await repository.assignRider(row.public_code, RIDER_ID);
  const simulation = await repository.updateRiderLocation(row.public_code, {
    lat: -38.95,
    lng: -68.06,
    source: 'simulation',
    timestamp: Date.now(),
  });
  const gps = await repository.updateRiderLocation(row.public_code, {
    lat: -38.951,
    lng: -68.061,
    accuracy: 8,
    heading: 91,
    speed: 1.2,
    source: 'gps',
    timestamp: Date.now(),
  });

  assert.equal(assignment.ok, false);
  assert.match(assignment.message, /RPC autorizada/i);
  assert.equal(simulation.ok, false);
  assert.match(simulation.message, /GPS real/i);
  assert.equal(gps.ok, true);
  assert.equal(mock.db.locations.length, 1);
  assert.equal(mock.db.locations[0].source, 'gps');
  assert.equal(mock.db.locations[0].rider_user_id, RIDER_ID);
  assert.equal(Object.hasOwn(mock.db.locations[0], 'created_at'), false);
});

test('carga catálogo remoto verificado con campos maestros de bebidas', async () => {
  const mock = createSupabaseClientMock();
  const repository = makeRepository(mock);

  await repository.loadBusinessConfiguration();
  const result = await repository.loadCatalog();

  assert.equal(result.ok, true);
  assert.equal(result.products.length, 1);
  assert.deepEqual(
    Object.fromEntries([
      'id',
      'brand',
      'categoryId',
      'categoryName',
      'presentation',
      'capacity',
      'packagingType',
      'price',
      'stock',
      'alcoholic',
    ].map((key) => [key, result.products[0][key]])),
    {
      id: PRODUCT_ID,
      brand: 'Marca verificada',
      categoryId: 'aguas',
      categoryName: 'Aguas',
      presentation: 'Botella',
      capacity: '1,5 L',
      packagingType: 'PET',
      price: 2300,
      stock: 8,
      alcoholic: false,
    },
  );
  assert.equal(repository.getCatalogStatus().state, 'ready');
  assert.equal(isProductionCatalogReady(), true);
});

test('tracking con token público mantiene polling y no abre un canal WebSocket sin credenciales', async () => {
  const mock = createSupabaseClientMock();
  const storage = createStorage();
  const trackingTokens = [];
  const repository = makeRepository(mock, {
    storage,
    pollMs: 1000,
    createTrackingClient: (token) => {
      trackingTokens.push(token);
      return mock.client;
    },
  });
  addToCart(PRODUCT_ID, 1);
  const created = await repository.createOrder(checkoutDraft());
  const snapshots = [];

  const stopOrder = repository.subscribeToOrder(
    created.order.id,
    (order) => snapshots.push(order?.status || null),
  );
  try {
    await flushTasks();
    assert.deepEqual(trackingTokens, [created.trackingToken]);
    assert.equal(mock.channels.length, 0);
    assert.deepEqual(snapshots, ['submitted']);

    mock.db.orders[0].status = 'preparing';
    await new Promise((resolve) => setTimeout(resolve, 1150));

    assert.ok(snapshots.length >= 2);
    assert.equal(snapshots.at(-1), 'preparing');
    assert.equal(mock.calls.removeChannel, 0);
  } finally {
    stopOrder();
  }
});

test('tracking público normaliza el DTO mínimo y preserva los detalles locales del pedido', async () => {
  const mock = createSupabaseClientMock();
  const storage = createStorage();
  const repository = makeRepository(mock, {
    storage,
    createTrackingClient: () => mock.client,
  });
  addToCart(PRODUCT_ID, 2);
  const created = await repository.createOrder(checkoutDraft());
  const before = getState().orders.find((order) => order.id === created.order.id);
  const row = mock.db.orders[0];
  row.status = 'on_the_way';
  row.accepted_at = '2026-07-25T12:01:00.000Z';
  row.preparing_at = '2026-07-25T12:05:00.000Z';
  row.ready_at = '2026-07-25T12:12:00.000Z';
  row.dispatched_at = '2026-07-25T12:15:00.000Z';
  mock.db.locations.push({
    id: 'location-public-1',
    order_id: row.id,
    lat: -38.951,
    lng: -68.061,
    accuracy: 100,
    source: 'gps',
    created_at: '2026-07-25T12:16:00.000Z',
  });
  const snapshots = [];

  const stop = repository.subscribeToOrder(
    created.order.id,
    (order) => snapshots.push(order),
  );
  try {
    await flushTasks();
    const current = getState().orders.find((order) => order.id === created.order.id);
    const snapshot = snapshots.at(-1);

    assert.equal(snapshot.status, 'on_the_way');
    assert.equal(snapshot.tracking.lastLocation.source, 'gps');
    assert.equal(snapshot.tracking.lastLocation.lat, -38.951);
    assert.equal(current.status, 'on_the_way');
    assert.equal(current.customerName, before.customerName);
    assert.equal(current.customerPhone, before.customerPhone);
    assert.equal(current.address, before.address);
    assert.deepEqual(current.items, before.items);
    assert.equal(current.subtotal, before.subtotal);
    assert.equal(current.deliveryFee, before.deliveryFee);
    assert.equal(current.total, before.total);
    assert.deepEqual(
      current.statusHistory.map((entry) => entry.status),
      ['received', 'preparing', 'ready', 'on_the_way'],
    );
  } finally {
    stop();
  }
});

test('tracking público crea un shell sin PII cuando no hay copia local', async () => {
  const mock = createSupabaseClientMock({
    publicTrackingOverrides: {
      customer_name: 'No debe filtrarse',
      customer_phone: '2995999999',
      address_label: 'Dirección privada 123',
      total: 999999,
      order_items: [{ product_name: 'Producto privado' }],
    },
  });
  const row = mock.seedOrder({
    status: 'on_the_way',
    accepted_at: '2026-07-25T12:01:00.000Z',
    preparing_at: '2026-07-25T12:05:00.000Z',
    ready_at: '2026-07-25T12:12:00.000Z',
    dispatched_at: '2026-07-25T12:15:00.000Z',
  });
  mock.db.locations.push({
    id: 'location-public-2',
    order_id: row.id,
    lat: -38.952,
    lng: -68.062,
    accuracy: 100,
    source: 'gps',
    created_at: '2026-07-25T12:16:00.000Z',
  });
  const storage = createStorage();
  storage.setItem(`taba-order-access-v1:${BUSINESS_ID}:last`, JSON.stringify({
    orderId: row.id,
    publicCode: row.public_code,
    trackingToken: 'A'.repeat(43),
  }));
  const repository = makeRepository(mock, {
    storage,
    createTrackingClient: () => mock.client,
  });
  const snapshots = [];

  const stop = repository.subscribeToOrder(
    row.public_code,
    (order) => snapshots.push(order),
  );
  try {
    await flushTasks();
    const shell = getState().orders.find((order) => order.id === row.public_code);
    const serialized = JSON.stringify(shell);
    const snapshot = snapshots.at(-1);

    assert.equal(shell.publicTrackingOnly, true);
    assert.equal(shell.backendId, undefined);
    assert.deepEqual(shell.items, []);
    assert.equal(shell.customerName, 'Cliente');
    assert.equal(shell.customerPhone, '');
    assert.equal(snapshot.status, 'on_the_way');
    assert.equal(snapshot.customer.phone, '');
    assert.equal(snapshot.tracking.lastLocation.source, 'gps');
    assert.doesNotMatch(serialized, /No debe filtrarse|2995999999|Dirección privada|999999|Producto privado/);
  } finally {
    stop();
  }
});

test('tracking con sesión Auth conserva Realtime oficial y desmonta el canal', async () => {
  const mock = createSupabaseClientMock();
  const row = mock.seedOrder();
  const repository = makeRepository(mock);
  const snapshots = [];

  const stopOrder = repository.subscribeToOrder(
    row.public_code,
    (order) => snapshots.push(order?.id || null),
  );
  await flushTasks();
  assert.equal(mock.channels[0].bindings[0].type, 'postgres_changes');
  assert.equal(mock.channels[0].bindings[0].config.table, 'orders');
  mock.channels[0].emit('orders');
  await flushTasks();
  assert.ok(snapshots.length >= 2);
  stopOrder();
  await flushTasks();
  assert.equal(mock.calls.removeChannel, 1);

  const businessSnapshots = [];
  const stopBusiness = repository.subscribeToBusinessOrders(
    (orders) => businessSnapshots.push(orders.length),
  );
  await flushTasks();
  assert.deepEqual(
    mock.channels[1].bindings.map((binding) => binding.config.table),
    ['orders', 'rider_locations'],
  );
  stopBusiness();
});

function makeRepository(mock, overrides = {}) {
  return createSupabaseOrderRepository({
    client: mock.client,
    businessId: BUSINESS_ID,
    storage: createStorage(),
    ...overrides,
  });
}

function checkoutDraft() {
  return {
    customerName: 'Cliente real',
    customerPhone: '2995550000',
    customerStreetAddress: 'Roca 321',
    customerNeighborhood: 'Centro',
    customerReference: 'Portón negro',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
    customerNotes: 'Tocar timbre',
  };
}

function createSupabaseClientMock({
  failFirstCreate = false,
  missingCreateRpc = false,
  userId = CUSTOMER_ID,
  businessOverrides = {},
  publicTrackingOverrides = {},
} = {}) {
  const db = {
    businesses: [{
      id: BUSINESS_ID,
      name: 'TABA',
      address: 'Dirección verificada',
      whatsapp_phone: '',
      currency_code: 'ARS',
      ordering_enabled: true,
      ordering_verified: true,
      delivery_enabled: true,
      pickup_enabled: true,
      delivery_fee: 500,
      minimum_delivery_subtotal: 0,
      is_active: true,
      status: 'open',
      ...businessOverrides,
    }],
    products: [{
      id: PRODUCT_ID,
      business_id: BUSINESS_ID,
      name: 'Agua mineral 1,5 L',
      brand: 'Marca verificada',
      description: 'Sin gas',
      category: 'Aguas',
      subcategory: 'Sin gas',
      presentation: 'Botella',
      capacity: '1,5 L',
      packaging_type: 'PET',
      price: 2300,
      stock: 8,
      available: true,
      is_alcoholic: false,
      image_url: '',
      tags: ['popular'],
      sort_order: 1,
      is_active: true,
      is_verified: true,
    }, {
      id: '66666666-6666-4666-8666-666666666666',
      business_id: BUSINESS_ID,
      name: 'Producto pendiente',
      category: 'Aguas',
      price: 1,
      stock: 1,
      available: true,
      is_active: true,
      is_verified: false,
    }],
    orders: [],
    locations: [],
  };
  const calls = { from: [], rpc: [], removeChannel: 0 };
  const channels = [];
  let createAttempts = 0;

  const client = {
    auth: {
      async getSession() {
        return {
          data: {
            session: { user: { id: userId, is_anonymous: userId === CUSTOMER_ID } },
          },
          error: null,
        };
      },
      async signInAnonymously() {
        return {
          data: {
            session: { user: { id: CUSTOMER_ID, is_anonymous: true } },
          },
          error: null,
        };
      },
      async getUser() {
        return { data: { user: { id: userId } }, error: null };
      },
    },
    from(table) {
      return createQuery({ table, db, calls });
    },
    async rpc(name, args) {
      calls.rpc.push({ name, args });
      if (name === 'create_order_with_items') {
        createAttempts += 1;
        if (missingCreateRpc) {
          return {
            data: null,
            error: {
              code: 'PGRST202',
              message: 'Could not find function public.create_order_with_items',
            },
            status: 404,
          };
        }
        if (failFirstCreate && createAttempts === 1) {
          return {
            data: null,
            error: { code: '08006', message: 'network connection lost' },
            status: 0,
          };
        }
        const existing = db.orders.find(
          (row) => row.client_request_id === args.payload.client_request_id,
        );
        if (existing) return { data: withRelations(existing, db), error: null, status: 200 };
        const row = buildOrderRow(args.payload, db.orders.length + 1, userId);
        db.orders.unshift(row);
        return {
          data: {
            ...withRelations(row, db),
            tracking_token: args.payload.tracking_token,
          },
          error: null,
          status: 200,
        };
      }
      if (name === 'change_order_status') {
        const row = db.orders.find((candidate) => candidate.id === args.p_order_id);
        const current = normalizeDbStatus(row?.status);
        if (!row || current !== args.p_expected_status) {
          return {
            data: null,
            error: { code: '40001', message: 'conflicto de estado esperado' },
            status: 409,
          };
        }
        row.status = args.p_new_status;
        row.updated_at = new Date().toISOString();
        return { data: withRelations(row, db), error: null, status: 200 };
      }
      if (name === 'get_public_order_tracking') {
        const row = db.orders.find((candidate) => (
          candidate.id === args.p_public_id || candidate.public_code === args.p_public_id
        ));
        return {
          data: row ? {
            ...publicTrackingDto(row, db),
            ...publicTrackingOverrides,
          } : null,
          error: null,
          status: 200,
        };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    },
    channel(name) {
      const channel = {
        name,
        bindings: [],
        on(type, config, handler) {
          this.bindings.push({ type, config, handler });
          return this;
        },
        subscribe(callback) {
          this.statusCallback = callback;
          callback('SUBSCRIBED');
          return this;
        },
        emit(table) {
          for (const binding of this.bindings.filter(
            (candidate) => candidate.config.table === table,
          )) {
            binding.handler({});
          }
        },
      };
      channels.push(channel);
      return channel;
    },
    async removeChannel() {
      calls.removeChannel += 1;
      return 'ok';
    },
  };

  return {
    calls,
    channels,
    client,
    db,
    seedOrder(overrides = {}) {
      const row = {
        ...buildOrderRow({
          business_id: BUSINESS_ID,
          items: [{ product_id: PRODUCT_ID, quantity: 1 }],
          customer_name: 'Cliente real',
          customer_phone: '2995550000',
          delivery_mode: 'delivery',
          customer_street_address: 'Roca 321',
          customer_neighborhood: 'Centro',
          payment_method: 'cash',
          client_request_id: `seed_${db.orders.length + 1000}`,
        }, db.orders.length + 1, userId),
        ...overrides,
      };
      db.orders.unshift(row);
      return row;
    },
  };
}

function createQuery({ table, db, calls }) {
  const operation = {
    table,
    action: 'select',
    filters: [],
    insertPayload: null,
  };
  calls.from.push(operation);
  const query = {
    select() {
      return this;
    },
    eq(field, value) {
      operation.filters.push([field, value]);
      return this;
    },
    order() {
      return this;
    },
    limit() {
      return this;
    },
    insert(payload) {
      operation.action = 'insert';
      operation.insertPayload = payload;
      return this;
    },
    update(payload) {
      operation.action = 'update';
      operation.updatePayload = payload;
      return this;
    },
    async maybeSingle() {
      const result = executeQuery(operation, db);
      return {
        ...result,
        data: Array.isArray(result.data) ? result.data[0] || null : result.data,
      };
    },
    async single() {
      const result = executeQuery(operation, db);
      return {
        ...result,
        data: Array.isArray(result.data) ? result.data[0] || null : result.data,
      };
    },
    then(resolve, reject) {
      return Promise.resolve(executeQuery(operation, db)).then(resolve, reject);
    },
  };
  return query;
}

function executeQuery(operation, db) {
  if (operation.table === 'businesses') {
    return ok(applyFilters(db.businesses, operation.filters));
  }
  if (operation.table === 'products') {
    return ok(applyFilters(db.products, operation.filters));
  }
  if (operation.table === 'orders') {
    return ok(
      applyFilters(db.orders, operation.filters).map((row) => withRelations(row, db)),
    );
  }
  if (operation.table === 'rider_locations' && operation.action === 'insert') {
    const row = {
      id: `location-${db.locations.length + 1}`,
      ...operation.insertPayload,
    };
    db.locations.push(row);
    return { data: [row], error: null, status: 201 };
  }
  if (operation.table === 'business_members') return ok([]);
  return ok([]);
}

function ok(data) {
  return { data, error: null, status: 200 };
}

function applyFilters(rows, filters) {
  return rows.filter(
    (row) => filters.every(([field, value]) => row[field] === value),
  );
}

function buildOrderRow(payload, sequence, userId) {
  const now = new Date().toISOString();
  const quantity = Number(payload.items?.[0]?.quantity || 1);
  return {
    id: `33333333-3333-4333-8333-${String(sequence).padStart(12, '0')}`,
    business_id: BUSINESS_ID,
    public_code: `LT-${String(1000 + sequence)}`,
    code: `LT-${String(1000 + sequence)}`,
    status: 'received',
    delivery_mode: payload.delivery_mode || 'delivery',
    fulfillment_type: payload.delivery_mode || 'delivery',
    customer_user_id: userId,
    customer_name: payload.customer_name || 'Cliente real',
    customer_phone: payload.customer_phone || '2995550000',
    customer_street_address: payload.customer_street_address || 'Roca 321',
    customer_neighborhood: payload.customer_neighborhood || 'Centro',
    customer_reference: payload.customer_reference || '',
    customer_notes: payload.customer_notes || '',
    address_label: 'Roca 321, Centro',
    payment_method: payload.payment_method || 'cash',
    subtotal: 2300 * quantity,
    delivery_fee: 500,
    total: (2300 * quantity) + 500,
    currency_code: 'ARS',
    created_at: now,
    updated_at: now,
    client_request_id: payload.client_request_id,
    items: payload.items || [],
  };
}

function withRelations(row, db) {
  return {
    ...row,
    order_items: (row.items || []).map((item, index) => ({
      id: `77777777-7777-4777-8777-${String(index + 1).padStart(12, '0')}`,
      order_id: row.id,
      product_uuid: item.product_id,
      product_id: item.product_id,
      name: 'Agua mineral 1,5 L',
      quantity: item.quantity,
      unit: 'Botella',
      unit_price: 2300,
      subtotal: 2300 * item.quantity,
      created_at: row.created_at,
    })),
    rider_locations: db.locations.filter((location) => location.order_id === row.id),
  };
}

function publicTrackingDto(row, db) {
  const latestLocation = db.locations
    .filter((location) => location.order_id === row.id && location.source === 'gps')
    .sort((a, b) => Date.parse(b.created_at || '') - Date.parse(a.created_at || ''))[0];
  const activeDelivery = ['picked_up', 'on_the_way', 'arrived'].includes(row.status);
  return {
    public_code: row.public_code,
    status: row.status,
    created_at: row.created_at,
    accepted_at: row.accepted_at,
    preparing_at: row.preparing_at,
    ready_at: row.ready_at,
    dispatched_at: row.dispatched_at || row.picked_up_at,
    arrived_at: row.arrived_at,
    delivered_at: row.delivered_at,
    is_delivered: row.status === 'delivered',
    estimated_minutes: ['delivered', 'canceled', 'cancelled', 'rejected'].includes(row.status)
      ? 0
      : 25,
    ...(activeDelivery && latestLocation ? {
      rider_location: {
        lat: latestLocation.lat,
        lng: latestLocation.lng,
        accuracy: Math.max(100, latestLocation.accuracy || 100),
        source: 'gps',
        created_at: latestLocation.created_at,
      },
    } : {}),
  };
}

function normalizeDbStatus(value) {
  if (value === 'received') return 'submitted';
  if (value === 'canceled') return 'cancelled';
  return value;
}

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

async function flushTasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
