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
  subscribe,
  updateState,
} from '../js/state.js';
import { CONFIRMED_DELIVERY_POINT, resetState } from './helpers.mjs';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';
const CUSTOMER_ID = '44444444-4444-4444-8444-444444444444';
const RIDER_ID = '55555555-5555-4555-8555-555555555555';
const SECOND_RIDER_ID = '88888888-8888-4888-8888-888888888888';

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

test('habilita contacto productivo sólo con número válido y autoridad verificada', async () => {
  const verifiedMock = createSupabaseClientMock({
    businessOverrides: {
      whatsapp_phone: '5492995551234',
      whatsapp_verified: true,
    },
  });
  const verified = makeRepository(verifiedMock);
  await verified.loadBusinessConfiguration();
  assert.equal(getBusinessConfig().whatsappNumber, '5492995551234');
  assert.equal(getBusinessConfig().whatsappVerified, true);
  assert.doesNotMatch(
    verifiedMock.calls.from.find((call) => call.table === 'businesses')?.columns || '',
    /whatsapp/i,
  );
  assert.ok(
    verifiedMock.calls.rpc.some((call) => call.name === 'get_public_business_contact'),
  );

  const unverified = makeRepository(createSupabaseClientMock({
    businessOverrides: {
      whatsapp_phone: '5492995551234',
      whatsapp_verified: false,
    },
  }));
  await unverified.loadBusinessConfiguration();
  assert.equal(getBusinessConfig().whatsappVerified, false);

  const malformed = makeRepository(createSupabaseClientMock({
    businessOverrides: {
      whatsapp_phone: '123',
      whatsapp_verified: true,
    },
  }));
  await malformed.loadBusinessConfiguration();
  assert.equal(getBusinessConfig().whatsappVerified, false);

  const unavailable = makeRepository(createSupabaseClientMock({
    publicContactRpcError: true,
    businessOverrides: {
      whatsapp_phone: '5492995551234',
      whatsapp_verified: true,
    },
  }));
  await unavailable.loadBusinessConfiguration();
  assert.equal(getBusinessConfig().whatsappNumber, '');
  assert.equal(getBusinessConfig().whatsappVerified, false);
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
  assert.equal(createCall.args.payload.customer_address_label, 'Casa');
  assert.equal(createCall.args.payload.delivery_street, 'Roca');
  assert.equal(createCall.args.payload.delivery_street_number, '321');
  assert.equal(createCall.args.payload.delivery_floor, '2');
  assert.equal(createCall.args.payload.delivery_apartment, 'B');
  assert.equal(createCall.args.payload.delivery_province, 'Neuquén');
  assert.equal(result.order.addressDetails.savedLabel, 'Casa');
  assert.equal(result.order.addressDetails.floor, '2');
  assert.equal(result.order.addressDetails.province, 'Neuquén');
  assert.ok(result.order.addressDetails.snapshotCreatedAt);
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

test('doble confirmación del cliente comparte una sola creación en vuelo', async () => {
  const mock = createSupabaseClientMock();
  const repository = makeRepository(mock);
  addToCart(PRODUCT_ID, 1);

  const [first, second] = await Promise.all([
    repository.createOrder(checkoutDraft()),
    repository.createOrder(checkoutDraft()),
  ]);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.order.backendId, second.order.backendId);
  assert.equal(
    mock.calls.rpc.filter((call) => call.name === 'create_order_with_items').length,
    1,
  );
  assert.equal(mock.db.orders.length, 1);
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

  const result = await repository.updateOrderStatus(row.public_code, 'accepted', {
    idempotencyKey: 'transition:test-order:revision-1',
  });

  assert.equal(result.ok, true);
  assert.equal(result.order.workflowStatus, 'accepted');
  const change = mock.calls.rpc.find((call) => call.name === 'transition_order');
  // La clave viaja saneada al alfabeto del servidor (`^[A-Za-z0-9_-]{8,128}$`):
  // con dos puntos, el RPC la rechaza con 22023 y el pedido nunca cambia.
  assert.deepEqual(change.args, {
    p_order_id: row.id,
    p_expected_revision: 1,
    p_new_status: 'accepted',
    p_idempotency_key: 'transition-test-order-revision-1',
  });
  assert.match(change.args.p_idempotency_key, /^[A-Za-z0-9_-]{8,128}$/);
  assert.equal(mock.calls.from.some((call) => call.action === 'update'), false);
});

test('snapshot de Negocio exige business_id, revision e ítems completos sin espejar parciales', async () => {
  const mock = createSupabaseClientMock();
  const valid = mock.seedOrder({ status: 'submitted', revision: 7 });
  const repository = makeRepository(mock);

  const complete = await repository.fetchBusinessOrderSnapshot();
  assert.equal(complete.ok, true);
  assert.equal(complete.orders.length, 1);
  assert.equal(complete.orders[0].backendId, valid.id);
  assert.equal(complete.orders[0].revision, 7);
  assert.equal(getState().orders.length, 0, 'la consulta no debe mutar antes del coordinador');

  valid.customer_name = '';
  const partial = await repository.fetchBusinessOrderSnapshot();
  assert.equal(partial.ok, false);
  assert.equal(partial.code, 'BUSINESS_ORDER_INCOMPLETE');
  assert.equal(getState().orders.length, 0);
});

test('la bandeja mapea combos y descuento del backend sin recalcular dinero', async () => {
  const mock = createSupabaseClientMock();
  const row = mock.seedOrder({
    status: 'submitted',
    revision: 1,
    subtotal: 11700,
    discount_total: 1200,
    delivery_fee: 150,
    total: 10650,
    order_combos: [{
      combo_id: 'cuatro-para-arrancar',
      name: 'Cuatro para arrancar',
      quantity: 1,
      list_price: 11700,
      promotional_price: 10500,
      discount_amount: 1200,
    }],
  });
  const repository = makeRepository(mock);

  const snapshot = await repository.fetchBusinessOrderSnapshot();

  assert.equal(snapshot.ok, true);
  const order = snapshot.orders.find((candidate) => candidate.backendId === row.id);
  // La invariante del backend: total = subtotal - discount_total + delivery_fee.
  // El Panel muestra las mismas cuatro cifras, no un recálculo propio.
  assert.equal(order.subtotal, 11700);
  assert.equal(order.discountTotal, 1200);
  assert.equal(order.deliveryFee, 150);
  assert.equal(order.total, 10650);
  assert.deepEqual(order.combos, [{
    comboId: 'cuatro-para-arrancar',
    name: 'Cuatro para arrancar',
    quantity: 1,
    listPrice: 11700,
    promotionalPrice: 10500,
    discountAmount: 1200,
  }]);
  // La consulta se lo pide al backend: order_combos viene en el select.
  const query = mock.calls.from.filter((call) => call.table === 'orders').at(-1);
  assert.match(String(query.columns || ''), /order_combos/);
});

test('la bandeja del Negocio deja los pedidos QA fuera de la operación real', async () => {
  const mock = createSupabaseClientMock();
  const real = mock.seedOrder({ status: 'submitted', revision: 2 });
  mock.seedOrder({ status: 'submitted', revision: 2, origin: 'qa', origin_reason: 'qa_fixture_product' });
  const repository = makeRepository(mock);

  const snapshot = await repository.fetchBusinessOrderSnapshot();

  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.orders.length, 1, 'el pedido QA no debe entrar a la bandeja');
  assert.equal(snapshot.orders[0].backendId, real.id);
  // La exclusión se pide al backend, no se filtra después de traer todo.
  const query = mock.calls.from.filter((call) => call.table === 'orders').at(-1);
  assert.ok(
    query.filters.some(([field, value]) => field === 'origin' && value === 'production'),
    'la consulta debería filtrar por origin=production',
  );
});

test('snapshot de Negocio reproduce order_events por sequence aunque created_at empate', async () => {
  const mock = createSupabaseClientMock();
  const row = mock.seedOrder({ status: 'on_the_way', revision: 3 });
  const sameInstant = row.created_at;
  row.order_events = [
    {
      id: 'event-sequence-3',
      sequence: 3,
      event_type: 'order.status_changed',
      metadata: { next_status: 'on_the_way' },
      created_at: sameInstant,
    },
    {
      id: 'event-sequence-1',
      sequence: 1,
      event_type: 'order.received',
      metadata: {},
      created_at: sameInstant,
    },
    {
      id: 'event-sequence-2',
      sequence: 2,
      event_type: 'order.status_changed',
      metadata: { next_status: 'ready' },
      created_at: sameInstant,
    },
  ];
  const repository = makeRepository(mock);

  const snapshot = await repository.fetchBusinessOrderSnapshot();

  assert.equal(snapshot.ok, true);
  assert.deepEqual(
    snapshot.orders[0].statusHistory.map((event) => event.status),
    ['received', 'ready', 'on_the_way'],
  );
  assert.equal(snapshot.orders[0].lastEventSequence, 3);
});

test('asigna rider con CAS y publica GPS sólo por las RPC autorizadas', async () => {
  const mock = createSupabaseClientMock({ userId: RIDER_ID });
  const row = mock.seedOrder({
    status: 'ready',
    assigned_rider_user_id: null,
  });
  const repository = makeRepository(mock);

  const assignment = await repository.assignRider(row.public_code, RIDER_ID);
  const simulation = await repository.updateRiderLocation(row.public_code, {
    lat: -38.95,
    lng: -68.06,
    source: 'simulation',
    timestamp: Date.now(),
  });
  // El receipt canónico sólo acepta ubicación en camino o al llegar: publicar
  // con el pedido recién asignado es rechazado por el servidor, no por la UI.
  const early = await repository.updateRiderLocation(row.public_code, {
    lat: -38.951,
    lng: -68.061,
    accuracy: 8,
    heading: 91,
    speed: 1.2,
    source: 'gps',
    timestamp: Date.now(),
  });
  row.status = 'on_the_way';
  const gps = await repository.updateRiderLocation(row.public_code, {
    lat: -38.951,
    lng: -68.061,
    accuracy: 8,
    heading: 91,
    speed: 1.2,
    source: 'gps',
    timestamp: Date.now(),
  });

  assert.equal(assignment.ok, true);
  const assignCall = mock.calls.rpc.find((call) => call.name === 'assign_order_rider');
  assert.deepEqual(assignCall.args, {
    p_order_id: row.id,
    p_expected_status: 'ready',
    p_expected_rider_user_id: null,
    p_new_rider_user_id: RIDER_ID,
  });
  assert.equal(simulation.ok, false);
  assert.match(simulation.message, /GPS real/i);
  assert.equal(early.ok, false);
  assert.equal(early.code, 'not_active');
  assert.equal(gps.ok, true);
  assert.equal(mock.db.locations.length, 1);
  assert.equal(mock.db.locations[0].source, 'gps');
  assert.equal(mock.db.locations[0].rider_user_id, RIDER_ID);
  assert.equal(typeof mock.db.locations[0].created_at, 'string');
  const gpsCall = mock.calls.rpc.find((call) => call.name === 'publish_rider_location_receipt');
  assert.equal(gpsCall.args.p_order_id, row.id);
  assert.equal(gpsCall.args.p_accuracy, 8);
  assert.match(gpsCall.args.p_idempotency_key, /^[A-Za-z0-9_-]{8,128}$/);
  assert.equal(typeof gpsCall.args.p_expected_revision, 'number');
  assert.equal(mock.calls.from.some(
    (call) => call.table === 'rider_locations' && call.action === 'insert',
  ), false);
});

test('lista un directorio minimo de riders activos para asignacion de negocio', async () => {
  const mock = createSupabaseClientMock();
  const repository = makeRepository(mock);

  const result = await repository.listActiveRiders();

  assert.equal(result.ok, true);
  assert.deepEqual(result.riders, [
    { id: RIDER_ID, displayName: 'Rider Norte' },
    { id: SECOND_RIDER_ID, displayName: 'Rider Sur' },
  ]);
  assert.deepEqual(
    mock.calls.rpc.find((call) => call.name === 'list_active_business_riders').args,
    { p_business_id: BUSINESS_ID },
  );
  assert.equal(Object.hasOwn(result.riders[0], 'email'), false);
  assert.equal(Object.hasOwn(result.riders[0], 'phone'), false);
});

test('lista una cola minimizada y el claim concurrente tiene un solo ganador', async () => {
  const mock = createSupabaseClientMock({ userId: RIDER_ID });
  const row = mock.seedOrder({
    status: 'ready',
    assigned_rider_user_id: null,
  });
  const repository = makeRepository(mock);

  const queue = await repository.listAvailableRiderOrders();
  const queuedRevision = queue.orders?.[0]?.revision;
  const first = await repository.claimRiderOrder(row.public_code, { expectedRevision: queuedRevision });
  // Mismo rider, misma clave determinística: el segundo claim es un replay
  // idempotente (no-op), exactamente lo certificado en el circuito vivo.
  const second = await repository.claimRiderOrder(row.public_code, { expectedRevision: queuedRevision });
  // Una revisión vieja de OTRO estado de la cola no asigna: el servidor
  // contesta con la revisión fresca en vez de pisar la asignación.
  const stale = await repository.claimRiderOrder(row.public_code, {
    expectedRevision: queuedRevision,
    idempotencyKey: `claim-otro-intento-${queuedRevision}`,
  });

  assert.equal(queue.ok, true);
  assert.deepEqual(queue.orders, [{
    publicCode: row.public_code,
    generalZone: 'Centro',
    pickupBranch: 'Dirección verificada',
    approximatePackages: 1,
    paymentMethod: 'cash',
    collectionAmount: row.total,
    estimatedMinutes: null,
    operationalRestrictions: '',
    revision: 1,
    expectedStatus: 'ready',
    expectedRiderId: null,
  }]);
  assert.equal(first.ok, true);
  assert.equal(mock.db.orders[0].assigned_rider_user_id, RIDER_ID);
  assert.equal(second.ok, true);
  assert.equal(second.idempotentNoOp, true);
  assert.equal(stale.ok, false);
  assert.equal(stale.conflict, true);
  assert.equal(stale.code, 'stale_revision');
  assert.equal(mock.calls.rpc.filter(
    (call) => call.name === 'claim_delivery_order',
  ).length, 3);
});

test('reasigna rider comparando estado y rider actuales', async () => {
  const mock = createSupabaseClientMock();
  const row = mock.seedOrder({
    status: 'assigned',
    assigned_rider_user_id: RIDER_ID,
  });
  const repository = makeRepository(mock);

  const result = await repository.reassignRider(row.public_code, SECOND_RIDER_ID);

  assert.equal(result.ok, true);
  assert.equal(result.order.assignedRiderId, SECOND_RIDER_ID);
  assert.deepEqual(
    mock.calls.rpc.find((call) => call.name === 'assign_order_rider').args,
    {
      p_order_id: row.id,
      p_expected_status: 'assigned',
      p_expected_rider_user_id: RIDER_ID,
      p_new_rider_user_id: SECOND_RIDER_ID,
    },
  );
});

test('confirma la entrega con código sin devolver datos sensibles al rider', async () => {
  const mock = createSupabaseClientMock({ userId: RIDER_ID });
  const row = mock.seedOrder({
    status: 'arrived',
    assigned_rider_user_id: RIDER_ID,
  });
  mock.db.handoffs.set(row.id, {
    code: '4821',
    failedAttempts: 0,
    lockedUntil: null,
    confirmedAt: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  const repository = makeRepository(mock);
  await repository.listOrders();

  const mismatch = await repository.confirmDelivery(row.public_code, '1111');
  const confirmed = await repository.confirmDelivery(row.public_code, '4821');
  const retried = await repository.confirmDelivery(row.public_code, '4821');

  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.code, 'incorrect_code');
  assert.match(mismatch.message, /incorrecto/i);
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.order, null);
  assert.equal(confirmed.publicCode, row.public_code);
  assert.equal(confirmed.status, 'delivered');
  assert.equal(retried.ok, true);
  assert.equal(retried.status, 'delivered');
  assert.equal(mock.db.orders[0].status, 'delivered');
  const confirmCalls = mock.calls.rpc.filter((call) => call.name === 'confirm_delivery_code');
  assert.equal(confirmCalls.length, 3);
  for (const call of confirmCalls) {
    assert.match(call.args.p_idempotency_key, /^[A-Za-z0-9_-]{8,128}$/);
    assert.equal(typeof call.args.p_expected_revision, 'number');
  }
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
      'externalId',
      'sku',
      'brand',
      'categoryId',
      'categoryName',
      'variant',
      'presentation',
      'capacityValue',
      'capacityUnit',
      'capacity',
      'packagingType',
      'unitsPerPack',
      'chilled',
      'price',
      'stock',
      'alcoholic',
      'minimumAge',
      'imageThumbnail',
    ].map((key) => [key, result.products[0][key]])),
    {
      id: PRODUCT_ID,
      externalId: 'agua-mineral-15',
      sku: 'AGUA-MINERAL-15',
      brand: 'Marca verificada',
      categoryId: 'aguas',
      categoryName: 'Aguas',
      variant: 'Botella',
      presentation: 'Botella',
      capacityValue: 1.5,
      capacityUnit: 'l',
      capacity: '1.5 l',
      packagingType: 'PET',
      unitsPerPack: 1,
      chilled: true,
      price: 2300,
      stock: 8,
      alcoholic: false,
      minimumAge: null,
      imageThumbnail: 'assets/products/agua-mineral-thumb-cccccccccccc.webp',
    },
  );
  assert.equal(repository.getCatalogStatus().state, 'ready');
  assert.equal(isProductionCatalogReady(), true);
});

test('publica cuatro productos válidos y excluye el verificado sin external_id', async () => {
  const mock = createSupabaseClientMock();
  const validTemplate = mock.db.products[0];
  const validProducts = [
    ['22222222-2222-4222-8222-222222222222', 'agua-1', 'AGUA-1'],
    ['33333333-3333-4333-8333-333333333333', 'agua-2', 'AGUA-2'],
    ['66666666-6666-4666-8666-666666666666', 'agua-3', 'AGUA-3'],
    ['77777777-7777-4777-8777-777777777777', 'agua-4', 'AGUA-4'],
  ].map(([id, externalId, sku], index) => ({
    ...validTemplate,
    id,
    external_id: externalId,
    sku,
    name: `Bebida verificada ${index + 1}`,
    sort_order: index + 1,
  }));
  const invalidProduct = {
    ...validTemplate,
    id: '99999999-9999-4999-8999-999999999999',
    external_id: '',
    sku: 'SIN-EXTERNAL-ID',
    name: 'Bebida inválida sin external_id',
    sort_order: 5,
  };
  mock.db.products = [...validProducts, invalidProduct];
  const repository = makeRepository(mock);

  await repository.loadBusinessConfiguration();
  const result = await repository.loadCatalog();

  assert.equal(result.ok, true);
  assert.equal(result.products.length, 4);
  assert.equal(getState().products.length, 4);
  assert.deepEqual(result.products.map((product) => product.externalId), [
    'agua-1',
    'agua-2',
    'agua-3',
    'agua-4',
  ]);
  assert.equal(invalidProduct.external_id, '');
  assert.equal(
    result.products.some((product) => product.sku === invalidProduct.sku),
    false,
  );
});

test('el sync productivo recupera el código de entrega con el token público', async () => {
  const mock = createSupabaseClientMock();
  const row = mock.seedOrder({
    status: 'arrived',
    assigned_rider_user_id: RIDER_ID,
    arrived_at: minutesAgoIso(1),
  });
  mock.db.handoffs.set(row.id, {
    code: '4821',
    failedAttempts: 0,
    lockedUntil: null,
    confirmedAt: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  const storage = createStorage();
  storage.setItem(`taba-order-access-v1:${BUSINESS_ID}:last`, JSON.stringify({
    orderId: row.id,
    publicCode: row.public_code,
    trackingToken: 'A'.repeat(43),
  }));
  const repository = makeRepository(mock, {
    storage,
    pollMs: 1000,
    createTrackingClient: () => mock.client,
  });

  const stop = repository.startSync();
  try {
    repository.setCustomerTrackingView({
      active: true,
      orderId: row.id,
      status: 'arrived',
    });
    await flushTasks();
    const current = getState().orders.find((order) => order.id === row.public_code);
    assert.equal(current.deliveryCode.code, '4821');
    assert.equal(mock.calls.rpc.some(
      (call) => call.name === 'get_public_order_tracking',
    ), true);
    assert.equal(repository.getCustomerTrackingPollState().active, true);
  } finally {
    stop();
  }
});

test('una pestaña nueva rota credenciales y recupera el handoff del cliente autenticado', async () => {
  const mock = createSupabaseClientMock();
  const row = mock.seedOrder({
    status: 'arrived',
    assigned_rider_user_id: RIDER_ID,
    arrived_at: minutesAgoIso(1),
  });
  const storage = createStorage();
  const repository = makeRepository(mock, {
    storage,
    pollMs: 1000,
    createTrackingClient: () => mock.client,
  });

  const stop = repository.startSync();
  try {
    await flushTasks();
    const current = getState().orders.find((order) => order.id === row.public_code);
    const access = JSON.parse(storage.getItem(`taba-order-access-v1:${BUSINESS_ID}:last`));
    assert.equal(current.deliveryCode.code, '7392');
    assert.match(access.trackingToken, /^[A-Za-z0-9_-]{32,256}$/);
    assert.equal(mock.calls.rpc.some(
      (call) => call.name === 'recover_order_tracking_access',
    ), true);
  } finally {
    stop();
  }
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

test('un DTO delivered detiene el sync global y no reactiva polling GPS', async () => {
  const mock = createSupabaseClientMock();
  const row = mock.seedOrder({
    status: 'delivered',
    delivered_at: new Date().toISOString(),
    terminal_visible_until: new Date(Date.now() + 30 * 60_000).toISOString(),
  });
  const storage = createStorage();
  storage.setItem(`taba-order-access-v1:${BUSINESS_ID}:last`, JSON.stringify({
    orderId: row.id,
    publicCode: row.public_code,
    trackingToken: 'T'.repeat(43),
  }));
  const repository = makeRepository(mock, {
    storage,
    pollMs: 1000,
    createTrackingClient: () => mock.client,
  });
  const stop = repository.startSync();

  try {
    await flushTasks();
    repository.setCustomerTrackingView({
      active: true,
      orderId: row.id,
      status: 'delivered',
    });
    const publicCalls = () => mock.calls.rpc.filter(
      (call) => call.name === 'get_public_order_tracking',
    ).length;
    const before = publicCalls();
    await new Promise((resolve) => setTimeout(resolve, 1150));

    assert.equal(repository.getCustomerTrackingPollState().active, false);
    assert.equal(repository.getCustomerTrackingPollState().terminal, true);
    assert.equal(publicCalls(), before);
  } finally {
    stop();
  }
});

test('activar tracking es idempotente cuando un render reingresa al seleccionar el pedido', async () => {
  const mock = createSupabaseClientMock();
  const row = mock.seedOrder({
    status: 'on_the_way',
    assigned_rider_user_id: RIDER_ID,
    dispatched_at: minutesAgoIso(1),
  });
  const storage = createStorage();
  storage.setItem(`taba-order-access-v1:${BUSINESS_ID}:last`, JSON.stringify({
    orderId: row.id,
    publicCode: row.public_code,
    trackingToken: 'R'.repeat(43),
  }));
  const repository = makeRepository(mock, {
    storage,
    pollMs: 1000,
    createTrackingClient: () => mock.client,
  });
  const stop = repository.startSync();

  try {
    await flushTasks();
    updateState((draft) => { draft.lastOrderId = null; });
    let renderNotifications = 0;
    const unsubscribe = subscribe(() => {
      renderNotifications += 1;
      repository.setCustomerTrackingView({
        active: true,
        orderId: row.id,
        status: 'on_the_way',
      });
    });
    try {
      repository.setCustomerTrackingView({
        active: true,
        orderId: row.id,
        status: 'on_the_way',
      });
      await flushTasks();
      assert.ok(renderNotifications >= 1 && renderNotifications <= 5);
      assert.equal(repository.getCustomerTrackingPollState().active, true);
      assert.equal(repository.getCustomerTrackingPollState().orderId, row.id);
    } finally {
      unsubscribe();
    }
  } finally {
    stop();
  }
});

test('un handoff tokenizado conserva Pedido A aunque Pedido B sea posterior', async () => {
  const mock = createSupabaseClientMock();
  const orderA = mock.seedOrder({
    status: 'on_the_way',
    assigned_rider_user_id: RIDER_ID,
    dispatched_at: minutesAgoIso(2),
  });
  mock.db.handoffs.set(orderA.id, {
    code: '4821',
    failedAttempts: 0,
    lockedUntil: null,
    confirmedAt: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  mock.db.locations.push({
    id: 'location-token-a',
    order_id: orderA.id,
    rider_user_id: RIDER_ID,
    lat: -38.951,
    lng: -68.061,
    accuracy: 100,
    source: 'gps',
    created_at: minutesAgoIso(1),
  });

  const storage = createStorage();
  const accessKey = `taba-order-access-v1:${BUSINESS_ID}:last`;
  storage.setItem(accessKey, JSON.stringify({
    orderId: orderA.id,
    publicCode: orderA.public_code,
    trackingToken: 'H'.repeat(43),
    tokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    transferredAt: new Date().toISOString(),
  }));
  const repository = makeRepository(mock, {
    storage,
    createTrackingClient: () => mock.client,
  });
  const stop = repository.startSync();

  try {
    await flushTasks();
    addToCart(PRODUCT_ID, 1);
    const orderB = await repository.createOrder(checkoutDraft());
    assert.equal(orderB.ok, true);
    assert.notEqual(orderB.order.backendId, orderA.id);
    assert.equal(getState().lastOrderId, orderA.public_code);

    repository.setCustomerTrackingView({
      active: true,
      orderId: orderA.id,
      status: 'on_the_way',
    });
    await flushTasks();

    const trackingCalls = mock.calls.rpc.filter(
      (call) => call.name === 'get_public_order_tracking',
    );
    assert.ok(trackingCalls.length >= 1);
    assert.ok(trackingCalls.every((call) => call.args.p_public_id === orderA.id));
    assert.equal(repository.getCustomerTrackingPollState().orderId, orderA.id);
    assert.equal(getState().orders.find(
      (order) => order.id === orderA.public_code,
    )?.tracking?.lastLocation?.source, 'gps');

    orderA.status = 'arrived';
    orderA.arrived_at = new Date().toISOString();
    await repository.getActiveOrder();
    const arrived = getState().orders.find((order) => order.id === orderA.public_code);
    assert.equal(arrived.status, 'arriving');
    assert.equal(arrived.deliveryCode.code, '4821');

    stop();
    resetState({
      products: [LOCAL_PRODUCT],
      orders: [],
      cart: [],
      lastOrderId: null,
      simulation: null,
    });
    const reloaded = makeRepository(mock, {
      storage,
      createTrackingClient: () => mock.client,
    });
    const stopReloaded = reloaded.startSync();
    try {
      await flushTasks();
      assert.equal(getState().lastOrderId, orderA.public_code);
      reloaded.setCustomerTrackingView({
        active: true,
        orderId: orderA.id,
        status: 'arrived',
      });
      await flushTasks();

      orderA.status = 'delivered';
      orderA.delivered_at = new Date().toISOString();
      orderA.terminal_visible_until = new Date(Date.now() + 30 * 60_000).toISOString();
      await reloaded.getActiveOrder();
      reloaded.setCustomerTrackingView({
        active: true,
        orderId: orderA.id,
        status: 'delivered',
      });
      await flushTasks();
      assert.equal(reloaded.getCustomerTrackingPollState().active, false);
      assert.equal(reloaded.getCustomerTrackingPollState().terminal, true);
      assert.ok(storage.getItem(accessKey));

      stopReloaded();
      resetState({
        products: [LOCAL_PRODUCT],
        orders: [],
        cart: [],
        lastOrderId: null,
        simulation: null,
      });
      const terminalReload = makeRepository(mock, {
        storage,
        createTrackingClient: () => mock.client,
      });
      const stopTerminalReload = terminalReload.startSync();
      try {
        await flushTasks();
        const delivered = getState().orders.find((order) => order.id === orderA.public_code);
        assert.equal(delivered?.status, 'delivered');
        assert.equal(delivered?.tracking, undefined);
        assert.equal(delivered?.deliveryCode, undefined);
        terminalReload.setCustomerTrackingView({
          active: true,
          orderId: orderA.id,
          status: 'delivered',
        });
        assert.equal(terminalReload.getCustomerTrackingPollState().active, false);
        assert.equal(terminalReload.getCustomerTrackingPollState().terminal, true);
      } finally {
        stopTerminalReload();
      }
    } finally {
      stopReloaded();
    }
  } finally {
    stop();
  }
});

test('tracking terminal resuelve un shell por publicCode cuando el UUID no está espejado', (t) => {
  const backendOrderId = '77777777-7777-4777-8777-777777777771';
  const publicCode = 'LT-IDENTITY-A';
  const activeOrder = trackingIdentityOrder({
    id: 'LT-ACTIVE-B',
    code: 'LT-ACTIVE-B',
    backendId: '88888888-8888-4888-8888-888888888881',
    status: 'preparing',
  });
  const publicShell = trackingIdentityOrder({
    id: publicCode,
    code: publicCode,
    publicTrackingOnly: true,
  });
  const storage = createStorage();
  const accessKey = `taba-order-access-v1:${BUSINESS_ID}:last`;
  const access = {
    orderId: backendOrderId,
    publicCode,
    trackingToken: 'J'.repeat(43),
    tokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  storage.setItem(accessKey, JSON.stringify(access));
  resetState({
    products: [LOCAL_PRODUCT],
    orders: [publicShell, activeOrder],
    cart: [],
    lastOrderId: activeOrder.id,
    simulation: null,
  });
  const repository = makeRepository(createSupabaseClientMock(), { storage });
  t.after(() => repository.setCustomerTrackingView({ active: false }));

  repository.setCustomerTrackingView({
    active: true,
    orderId: publicCode,
    status: 'delivered',
  });

  assert.equal(getState().lastOrderId, publicCode);
  assert.equal(getState().orders.some((order) => order.id === activeOrder.id), true);
  assert.equal(storage.getItem(accessKey), JSON.stringify(access));
  assert.deepEqual(repository.getCustomerTrackingPollState(), {
    active: false,
    terminal: true,
    inFlight: false,
    orderId: backendOrderId,
    status: 'delivered',
  });
});

test('tracking terminal conserva la resolución backend exacta por UUID', (t) => {
  const backendOrderId = '77777777-7777-4777-8777-777777777772';
  const backendOrder = trackingIdentityOrder({
    id: 'LT-BACKEND-A',
    code: 'LT-BACKEND-A',
    backendId: backendOrderId,
  });
  const activeOrder = trackingIdentityOrder({
    id: 'LT-ACTIVE-B',
    code: 'LT-ACTIVE-B',
    backendId: '88888888-8888-4888-8888-888888888882',
    status: 'preparing',
  });
  const storage = createStorage();
  const accessKey = `taba-order-access-v1:${BUSINESS_ID}:last`;
  storage.setItem(accessKey, JSON.stringify({
    orderId: backendOrderId,
    publicCode: 'LT-PUBLIC-NOT-MIRRORED',
    trackingToken: 'K'.repeat(43),
  }));
  resetState({
    products: [LOCAL_PRODUCT],
    orders: [backendOrder, activeOrder],
    cart: [],
    lastOrderId: activeOrder.id,
    simulation: null,
  });
  const repository = makeRepository(createSupabaseClientMock(), { storage });
  t.after(() => repository.setCustomerTrackingView({ active: false }));

  repository.setCustomerTrackingView({
    active: true,
    orderId: backendOrderId,
    status: 'delivered',
  });

  assert.equal(getState().lastOrderId, backendOrder.id);
  assert.ok(storage.getItem(accessKey));
  assert.deepEqual(repository.getCustomerTrackingPollState(), {
    active: false,
    terminal: true,
    inFlight: false,
    orderId: backendOrderId,
    status: 'delivered',
  });
});

test('tracking terminal falla cerrado si UUID y publicCode resuelven pedidos distintos', (t) => {
  const backendOrderId = '77777777-7777-4777-8777-777777777773';
  const publicCode = 'LT-CONFLICT-PUBLIC';
  const backendOrder = trackingIdentityOrder({
    id: 'LT-CONFLICT-BACKEND',
    code: 'LT-CONFLICT-BACKEND',
    backendId: backendOrderId,
  });
  const conflictingShell = trackingIdentityOrder({
    id: publicCode,
    code: publicCode,
    publicTrackingOnly: true,
  });
  const unrelatedActive = trackingIdentityOrder({
    id: 'LT-ACTIVE-C',
    code: 'LT-ACTIVE-C',
    backendId: '88888888-8888-4888-8888-888888888883',
    status: 'preparing',
  });
  const storage = createStorage();
  const accessKey = `taba-order-access-v1:${BUSINESS_ID}:last`;
  storage.setItem(accessKey, JSON.stringify({
    orderId: backendOrderId,
    publicCode,
    trackingToken: 'L'.repeat(43),
  }));
  resetState({
    products: [LOCAL_PRODUCT],
    orders: [backendOrder, conflictingShell, unrelatedActive],
    cart: [],
    lastOrderId: unrelatedActive.id,
    simulation: null,
  });
  const repository = makeRepository(createSupabaseClientMock(), { storage });
  t.after(() => repository.setCustomerTrackingView({ active: false }));

  repository.setCustomerTrackingView({
    active: true,
    orderId: backendOrderId,
    status: 'delivered',
  });

  assert.equal(storage.getItem(accessKey), null);
  assert.equal(getState().lastOrderId, unrelatedActive.id);
  assert.equal(getState().orders.some((order) => order.id === backendOrder.id), true);
  assert.equal(getState().orders.some((order) => order.id === conflictingShell.id), false);
  assert.equal(getState().orders.some((order) => order.id === unrelatedActive.id), true);
  assert.deepEqual(repository.getCustomerTrackingPollState(), {
    active: false,
    terminal: false,
    inFlight: false,
    orderId: '',
    status: '',
  });
});

test('tracking terminal sin coincidencias limpia el acceso sin elegir un pedido reciente', (t) => {
  const backendOrderId = '77777777-7777-4777-8777-777777777774';
  const publicCode = 'LT-MISSING-A';
  const unrelatedShell = trackingIdentityOrder({
    id: 'LT-UNRELATED-SHELL',
    code: 'LT-UNRELATED-SHELL',
    publicTrackingOnly: true,
  });
  const activeOrder = trackingIdentityOrder({
    id: 'LT-ACTIVE-B',
    code: 'LT-ACTIVE-B',
    backendId: '88888888-8888-4888-8888-888888888884',
    status: 'preparing',
  });
  const storage = createStorage();
  const accessKey = `taba-order-access-v1:${BUSINESS_ID}:last`;
  storage.setItem(accessKey, JSON.stringify({
    orderId: backendOrderId,
    publicCode,
    trackingToken: 'M'.repeat(43),
  }));
  resetState({
    products: [LOCAL_PRODUCT],
    orders: [unrelatedShell, activeOrder],
    cart: [],
    lastOrderId: null,
    simulation: null,
  });
  const repository = makeRepository(createSupabaseClientMock(), { storage });
  t.after(() => repository.setCustomerTrackingView({ active: false }));

  repository.setCustomerTrackingView({
    active: true,
    orderId: backendOrderId,
    status: 'delivered',
  });

  assert.equal(storage.getItem(accessKey), null);
  assert.equal(getState().lastOrderId, null);
  assert.equal(getState().orders.some((order) => order.id === unrelatedShell.id), true);
  assert.equal(getState().orders.some((order) => order.id === activeOrder.id), true);
  assert.equal(repository.getCustomerTrackingPollState().terminal, false);
});

test('tracking terminal nunca usa deliveryCode ni códigos operativos como identidad pública', (t) => {
  const backendOrderId = '77777777-7777-4777-8777-777777777775';
  const confusableCode = '4821';
  const activeOrder = trackingIdentityOrder({
    id: 'LT-ACTIVE-B',
    code: 'LT-ACTIVE-B',
    backendId: '88888888-8888-4888-8888-888888888885',
    status: 'preparing',
    deliveryCode: { code: confusableCode },
    riderOperationalCode: confusableCode,
    administrativeId: confusableCode,
  });
  const storage = createStorage();
  const accessKey = `taba-order-access-v1:${BUSINESS_ID}:last`;
  storage.setItem(accessKey, JSON.stringify({
    orderId: backendOrderId,
    publicCode: confusableCode,
    trackingToken: 'N'.repeat(43),
  }));
  resetState({
    products: [LOCAL_PRODUCT],
    orders: [activeOrder],
    cart: [],
    lastOrderId: null,
    simulation: null,
  });
  const repository = makeRepository(createSupabaseClientMock(), { storage });
  t.after(() => repository.setCustomerTrackingView({ active: false }));

  repository.setCustomerTrackingView({
    active: true,
    orderId: backendOrderId,
    status: 'delivered',
  });

  assert.equal(storage.getItem(accessKey), null);
  assert.equal(getState().lastOrderId, null);
  assert.equal(getState().orders[0].id, activeOrder.id);
  assert.equal(getState().orders[0].deliveryCode.code, confusableCode);
  assert.equal(repository.getCustomerTrackingPollState().terminal, false);
});

test('un DTO public terminal sin codigo borra el deliveryCode cacheado del pedido terminal', async () => {
  const publicTrackingOverrides = {};
  const mock = createSupabaseClientMock({ publicTrackingOverrides });
  const orderA = mock.seedOrder({
    status: 'arrived',
    assigned_rider_user_id: RIDER_ID,
    arrived_at: new Date().toISOString(),
  });
  const orderB = mock.seedOrder({
    status: 'on_the_way',
    assigned_rider_user_id: RIDER_ID,
    preparing_at: minutesAgoIso(1),
  });
  mock.db.handoffs.set(orderA.id, {
    code: '4821',
    failedAttempts: 0,
    lockedUntil: null,
    confirmedAt: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  mock.db.handoffs.set(orderB.id, {
    code: '7395',
    failedAttempts: 0,
    lockedUntil: null,
    confirmedAt: new Date(Date.now() - 10_000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });

  const storage = createStorage();
  const accessKey = `taba-order-access-v1:${BUSINESS_ID}:last`;
  storage.setItem(accessKey, JSON.stringify({
    orderId: orderA.id,
    publicCode: orderA.public_code,
    trackingToken: 'Q'.repeat(43),
    tokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    transferredAt: new Date().toISOString(),
  }));

  const repository = makeRepository(mock, {
    storage,
    createTrackingClient: () => mock.client,
  });
  const stop = repository.startSync();

  try {
    await flushTasks();
    repository.setCustomerTrackingView({
      active: true,
      orderId: orderA.id,
      status: 'arrived',
    });
    await flushTasks();

    const preTerminalA = getState().orders.find((order) => order.id === orderA.public_code);
    assert.equal(preTerminalA?.deliveryCode?.code, '4821');
    assert.equal(getState().lastOrderId, orderA.public_code);

    updateState((draft) => {
      const keptB = draft.orders.find((row) => row.id === orderB.public_code);
      if (keptB) {
        keptB.deliveryCode = {
          code: '7395',
          confirmedAt: new Date(Date.now() - 5_000).toISOString(),
          confirmedBy: 'rider',
        };
      }
    });

    const preTerminalB = getState().orders.find((order) => order.id === orderB.public_code);
    assert.equal(preTerminalB?.deliveryCode?.code, '7395');
    assert.equal(preTerminalB?.id, orderB.public_code);

    publicTrackingOverrides.delivery_code = '9999';
    orderA.status = 'delivered';
    orderA.delivered_at = new Date().toISOString();
    orderA.terminal_visible_until = new Date(Date.now() + 30 * 60_000).toISOString();
    await repository.getActiveOrder();

    repository.setCustomerTrackingView({
      active: true,
      orderId: orderA.id,
      status: 'delivered',
    });
    await flushTasks();

    const terminalA = getState().orders.find((order) => order.id === orderA.public_code);
    assert.equal(terminalA?.id, orderA.public_code);
    assert.equal(terminalA?.status, 'delivered');
    assert.equal(terminalA?.deliveryCode, undefined);
    assert.equal(Object.hasOwn(terminalA, 'deliveryCode'), false);
    assert.equal(JSON.stringify(terminalA).includes('4821'), false);
    assert.equal(JSON.stringify(terminalA).includes('9999'), false);
    const persistedAccess = JSON.parse(storage.getItem(accessKey) || '{}');
    assert.equal(persistedAccess.orderId, orderA.id);
    assert.equal(persistedAccess.publicCode, orderA.public_code);
    assert.equal(persistedAccess.deliveryCode, undefined);
    assert.equal(JSON.stringify(persistedAccess).includes('4821'), false);
    assert.equal(JSON.stringify(persistedAccess).includes('9999'), false);
    assert.equal(JSON.stringify(persistedAccess).includes('7395'), false);

    stop();
    resetState({
      products: [LOCAL_PRODUCT],
      orders: preTerminalB ? [preTerminalB] : [],
      cart: [],
      lastOrderId: orderA.public_code,
      simulation: null,
    });

    const reloaded = makeRepository(mock, {
      storage,
      createTrackingClient: () => mock.client,
    });
    const stopReloaded = reloaded.startSync();
    try {
      await flushTasks();
      const reloadedA = getState().orders.find((order) => order.id === orderA.public_code);
      const reloadedB = getState().orders.find((order) => order.id === orderB.public_code);
      assert.equal(Object.hasOwn(reloadedA, 'deliveryCode'), false);
      assert.equal(reloadedA?.deliveryCode, undefined);
      assert.equal(JSON.stringify(reloadedA).includes('4821'), false);
      assert.equal(JSON.stringify(reloadedA).includes('9999'), false);
      assert.equal(reloadedB?.deliveryCode?.code, '7395');
      assert.equal(reloadedB?.id, orderB.public_code);
      assert.equal(reloaded.getCustomerTrackingPollState().terminal, false);
      assert.equal(reloaded.getCustomerTrackingPollState().orderId, '');
      assert.equal(Object.hasOwn(reloadedB, 'deliveryCode'), true);
    } finally {
      stopReloaded();
    }
  } finally {
    stop();
  }
});

test('un token inválido no hace fallback silencioso al Pedido B', async () => {
  const mock = createSupabaseClientMock();
  const orderA = mock.seedOrder({ status: 'on_the_way', assigned_rider_user_id: RIDER_ID });
  const orderB = mock.seedOrder({ status: 'received' });
  const storage = createStorage();
  const accessKey = `taba-order-access-v1:${BUSINESS_ID}:last`;
  storage.setItem(accessKey, JSON.stringify({
    orderId: orderA.id,
    publicCode: orderA.public_code,
    trackingToken: 'I'.repeat(43),
  }));
  const deniedClient = {
    ...mock.client,
    async rpc(name, args) {
      if (name === 'get_public_order_tracking') {
        mock.calls.rpc.push({ name, args });
        return { data: null, error: null, status: 200 };
      }
      return mock.client.rpc(name, args);
    },
  };
  const repository = makeRepository(mock, {
    storage,
    createTrackingClient: () => deniedClient,
  });
  const stop = repository.startSync();

  try {
    await flushTasks();
    assert.equal(getState().lastOrderId, orderA.public_code);
    repository.setCustomerTrackingView({
      active: true,
      orderId: orderA.id,
      status: 'on_the_way',
    });
    await flushTasks();
    assert.equal(repository.getCustomerTrackingPollState().active, false);
    assert.equal(getState().lastOrderId, orderA.public_code);
    assert.notEqual(getState().lastOrderId, orderB.public_code);
    assert.equal(storage.getItem(accessKey), null);
    const trackingCalls = mock.calls.rpc.filter(
      (call) => call.name === 'get_public_order_tracking',
    );
    assert.ok(trackingCalls.every((call) => call.args.p_public_id === orderA.id));
  } finally {
    stop();
  }
});

test('un token vencido o revocado retira sólo el shell público persistido', async () => {
  const mock = createSupabaseClientMock();
  const orderId = '77777777-7777-4777-8777-777777777777';
  const publicCode = 'LT-7777';
  const storage = createStorage();
  const accessKey = `taba-order-access-v1:${BUSINESS_ID}:last`;
  storage.setItem(accessKey, JSON.stringify({
    orderId,
    publicCode,
    trackingToken: 'V'.repeat(43),
  }));
  resetState({
    products: [LOCAL_PRODUCT],
    orders: [{
      id: publicCode,
      code: publicCode,
      backendId: '',
      status: 'on_the_way',
      workflowStatus: 'on_the_way',
      deliveryMode: 'delivery',
      publicTrackingOnly: true,
      customerName: 'Cliente',
      customerPhone: '',
      address: '',
      paymentMethodCode: 'unknown',
      paymentMethod: 'Sin especificar',
      createdAt: new Date().toISOString(),
      items: [],
      delivery: {
        driverName: 'Sin asignar',
        driverPhone: '',
        estimatedMinutes: 0,
        currentLocationLabel: 'En camino',
      },
    }],
    cart: [],
    lastOrderId: publicCode,
    simulation: null,
  });
  updateState((draft) => {
    draft.orders.push({
      id: 'LT-ACTIVE',
      code: 'LT-ACTIVE',
      backendId: '88888888-8888-4888-8888-888888888888',
      status: 'preparing',
      workflowStatus: 'preparing',
      deliveryMode: 'delivery',
      customerName: 'Cliente activo',
      customerPhone: '2995551111',
      address: 'Roca 500, Centro',
      paymentMethodCode: 'cash',
      paymentMethod: 'Efectivo',
      createdAt: new Date().toISOString(),
      items: [{
        productId: PRODUCT_ID,
        name: 'Agua mineral 1,5 L',
        quantity: 1,
        unitPrice: 2300,
        unit: 'Botella',
      }],
      delivery: {
        driverName: 'Sin asignar',
        driverPhone: '',
        estimatedMinutes: 20,
        currentLocationLabel: 'Preparando',
      },
    });
  });
  const deniedClient = {
    ...mock.client,
    async rpc(name, args) {
      if (name === 'get_public_order_tracking') {
        mock.calls.rpc.push({ name, args });
        return { data: null, error: null, status: 200 };
      }
      return mock.client.rpc(name, args);
    },
  };
  const repository = makeRepository(mock, {
    storage,
    createTrackingClient: () => deniedClient,
  });

  repository.setCustomerTrackingView({
    active: true,
    orderId,
    status: 'on_the_way',
  });
  await flushTasks();

  assert.equal(storage.getItem(accessKey), null);
  assert.equal(getState().orders.some((order) => order.publicTrackingOnly), false);
  assert.equal(getState().orders.some((order) => order.id === 'LT-ACTIVE'), true);
  assert.equal(getState().lastOrderId, null);
  assert.equal(repository.getCustomerTrackingPollState().active, false);
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
  row.assigned_rider_user_id = RIDER_ID;
  row.accepted_at = minutesAgoIso(12);
  row.preparing_at = minutesAgoIso(9);
  row.ready_at = minutesAgoIso(6);
  row.dispatched_at = minutesAgoIso(2);
  mock.db.locations.push({
    id: 'location-public-1',
    order_id: row.id,
    rider_user_id: RIDER_ID,
    lat: -38.951,
    lng: -68.061,
    accuracy: 100,
    source: 'gps',
    created_at: minutesAgoIso(1),
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
    assigned_rider_user_id: RIDER_ID,
    accepted_at: minutesAgoIso(12),
    preparing_at: minutesAgoIso(9),
    ready_at: minutesAgoIso(6),
    dispatched_at: minutesAgoIso(2),
  });
  mock.db.locations.push({
    id: 'location-public-2',
    order_id: row.id,
    rider_user_id: RIDER_ID,
    lat: -38.952,
    lng: -68.062,
    accuracy: 100,
    source: 'gps',
    created_at: minutesAgoIso(1),
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
    assert.equal(shell.delivery.estimatedMinutes, 0);
    assert.equal(snapshot.status, 'on_the_way');
    assert.equal(snapshot.customer.phone, '');
    assert.equal(snapshot.tracking.lastLocation.source, 'gps');
    assert.doesNotMatch(serialized, /No debe filtrarse|2995999999|Dirección privada|999999|Producto privado/);
  } finally {
    stop();
  }
});

test('tracking público descarta GPS vencido y acepta ETA sólo con metadata confiable', async () => {
  const now = Date.now();
  const mock = createSupabaseClientMock({
    publicTrackingOverrides: {
      estimated_minutes: 999,
      estimated_arrival_at: new Date(now + 20 * 60 * 1000).toISOString(),
      estimated_arrival_source: 'routing',
      estimated_arrival_updated_at: new Date(now).toISOString(),
      rider_location: {
        lat: -38.952,
        lng: -68.062,
        accuracy: 30,
        source: 'gps',
        created_at: new Date(now - 4 * 60 * 1000).toISOString(),
      },
    },
  });
  const row = mock.seedOrder({
    status: 'on_the_way',
    assigned_rider_user_id: RIDER_ID,
  });
  const storage = createStorage();
  storage.setItem(`taba-order-access-v1:${BUSINESS_ID}:last`, JSON.stringify({
    orderId: row.id,
    publicCode: row.public_code,
    trackingToken: 'B'.repeat(43),
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
    const snapshot = snapshots.at(-1);
    const shell = getState().orders.find((order) => order.id === row.public_code);

    assert.equal(snapshot.tracking.lastLocation, null);
    assert.ok(shell.delivery.estimatedMinutes >= 19);
    assert.ok(shell.delivery.estimatedMinutes <= 20);
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
    ['orders'],
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

function trackingIdentityOrder({
  id,
  code = id,
  backendId = '',
  status = 'delivered',
  publicTrackingOnly = false,
  terminalVisibleUntil = new Date(Date.now() + 30 * 60_000).toISOString(),
  ...overrides
} = {}) {
  return {
    id,
    code,
    ...(backendId ? { backendId } : {}),
    status,
    workflowStatus: status,
    deliveryMode: 'delivery',
    publicTrackingOnly,
    customerName: 'Cliente',
    customerPhone: '',
    address: '',
    paymentMethodCode: 'unknown',
    paymentMethod: 'Sin especificar',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...(status === 'delivered' ? { terminalVisibleUntil } : {}),
    items: [],
    delivery: {
      driverName: 'Sin asignar',
      driverPhone: '',
      estimatedMinutes: 0,
      currentLocationLabel: status === 'delivered' ? 'Pedido entregado' : 'Preparando',
    },
    ...overrides,
  };
}

function checkoutDraft() {
  return {
    // Un delivery sin punto confirmado no llega ni a la RPC: lo frena el
    // repositorio. Ver `requireConfirmedDeliveryLocation`.
    ...CONFIRMED_DELIVERY_POINT,
    customerName: 'Cliente real',
    customerPhone: '2995550000',
    customerStreetAddress: 'Roca 321',
    customerNeighborhood: 'Centro',
    customerReference: 'Portón negro',
    customerAddressLabel: 'Casa',
    deliveryStreet: 'Roca',
    deliveryStreetNumber: '321',
    deliveryFloor: '2',
    deliveryApartment: 'B',
    deliveryCity: 'Centro',
    deliveryProvince: 'Neuquén',
    deliveryPostalCode: 'Q8300',
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
  publicContactRpcError = false,
} = {}) {
  const db = {
    businesses: [{
      id: BUSINESS_ID,
      name: 'TABA',
      address: 'Dirección verificada',
      whatsapp_phone: '',
      whatsapp_verified: false,
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
      external_id: 'agua-mineral-15',
      sku: 'AGUA-MINERAL-15',
      name: 'Agua mineral 1,5 L',
      brand: 'Marca verificada',
      description: 'Sin gas',
      category: 'Aguas',
      subcategory: 'Sin gas',
      variant: 'Botella',
      presentation: 'Botella',
      capacity_value: 1.5,
      capacity_unit: 'l',
      capacity: '1.5 l',
      packaging_type: 'PET',
      units_per_pack: 1,
      price: 2300,
      stock: 8,
      available: true,
      chilled: true,
      is_alcoholic: false,
      minimum_age: null,
      image_url: 'assets/products/agua-mineral-bbbbbbbbbbbb.webp',
      image_sha256: 'b'.repeat(64),
      image_thumbnail_url: 'assets/products/agua-mineral-thumb-cccccccccccc.webp',
      image_thumbnail_sha256: 'c'.repeat(64),
      source_image_sha256: 'a'.repeat(64),
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
    handoffs: new Map(),
    // Replay idempotente de los RPC canónicos del rider, como
    // rider_delivery_operations en el servidor: (orderId, op, key) → resultado.
    riderOps: new Map(),
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
      if (name === 'get_public_business_contact') {
        if (publicContactRpcError) {
          return {
            data: null,
            error: { code: 'PGRST202', message: 'RPC unavailable' },
            status: 404,
          };
        }
        const business = db.businesses.find((row) => row.id === args.p_business_id);
        const digits = String(business?.whatsapp_phone || '').replace(/\D/g, '');
        const verified = Boolean(
          business?.is_active
          && business?.whatsapp_verified === true
          && digits.length >= 8
          && digits.length <= 15,
        );
        return {
          data: verified
            ? [{ whatsapp_phone: digits, whatsapp_verified: true }]
            : [],
          error: null,
          status: 200,
        };
      }
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
        if (existing) {
          const handoff = db.handoffs.get(existing.id);
          return {
            data: {
              ...withRelations(existing, db),
              ...(handoff ? { delivery_code: handoff.code } : {}),
            },
            error: null,
            status: 200,
          };
        }
        const row = buildOrderRow(args.payload, db.orders.length + 1, userId);
        db.orders.unshift(row);
        let deliveryCode = '';
        if (row.delivery_mode === 'delivery') {
          const handoff = {
            code: '4821',
            failedAttempts: 0,
            lockedUntil: null,
            confirmedAt: null,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          };
          db.handoffs.set(row.id, handoff);
          deliveryCode = handoff.code;
        }
        return {
          data: {
            ...withRelations(row, db),
            tracking_token: args.payload.tracking_token,
            ...(deliveryCode ? { delivery_code: deliveryCode } : {}),
          },
          error: null,
          status: 200,
        };
      }
      if (name === 'recover_order_tracking_access') {
        const row = db.orders.find((candidate) => candidate.id === args.p_order_id);
        if (
          !row
          || row.customer_user_id !== userId
          || row.delivery_mode !== 'delivery'
          || ['delivered', 'canceled', 'cancelled', 'rejected'].includes(row.status)
        ) {
          return {
            data: null,
            error: { code: '42501', message: 'pedido no encontrado o acceso denegado' },
            status: 403,
          };
        }
        const handoff = {
          code: '7392',
          failedAttempts: 0,
          lockedUntil: null,
          confirmedAt: null,
          expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        };
        db.handoffs.set(row.id, handoff);
        return {
          data: {
            ok: true,
            public_code: row.public_code,
            delivery_code: handoff.code,
            token_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            code_expires_at: handoff.expiresAt,
          },
          error: null,
          status: 200,
        };
      }
      if (name === 'issue_order_delivery_code') {
        const row = db.orders.find((candidate) => candidate.id === args.p_order_id);
        if (!row || row.customer_user_id !== userId || !args.p_tracking_token) {
          return {
            data: null,
            error: { code: '42501', message: 'token de seguimiento invalido' },
            status: 403,
          };
        }
        const existing = db.handoffs.get(row.id);
        const handoff = existing || {
          code: '4821',
          failedAttempts: 0,
          lockedUntil: null,
          confirmedAt: null,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        };
        db.handoffs.set(row.id, handoff);
        return {
          data: {
            delivery_code: handoff.code,
            expires_at: handoff.expiresAt,
          },
          error: null,
          status: 200,
        };
      }
      if (name === 'transition_order') {
        const row = db.orders.find((candidate) => candidate.id === args.p_order_id);
        if (!row || row.revision !== args.p_expected_revision) {
          return {
            data: null,
            error: { code: '40001', message: 'revision desactualizada' },
            status: 409,
          };
        }
        const previousStatus = row.status;
        row.status = args.p_new_status;
        row.revision += 1;
        row.updated_at = new Date().toISOString();
        row.order_events.push({
          id: `event-${row.id}-${row.revision}`,
          sequence: Math.max(...row.order_events.map((event) => event.sequence), 0) + 1,
          event_type: 'order.status_changed',
          metadata: { previous_status: previousStatus, next_status: row.status },
          payload: { previous_status: previousStatus, next_status: row.status },
          created_at: row.updated_at,
        });
        return { data: withRelations(row, db), error: null, status: 200 };
      }
      if (name === 'list_available_rider_orders') {
        return {
          data: db.orders
            .filter((row) => (
              row.business_id === args.p_business_id
              && row.delivery_mode === 'delivery'
              && row.status === 'ready'
              && !row.assigned_rider_user_id
            ))
            .map((row) => ({
              public_code: row.public_code,
              general_zone: row.customer_neighborhood || null,
              pickup_branch: db.businesses.find(
                (business) => business.id === row.business_id,
              )?.address || null,
              approximate_packages: Math.max(1, Math.ceil((row.items?.length || 1) / 3)),
              payment_method: row.payment_method,
              collection_amount: row.payment_method === 'cash' ? row.total : null,
              estimated_minutes: null,
              operational_restrictions: null,
              revision: row.revision,
            })),
          error: null,
          status: 200,
        };
      }
      if (name === 'list_active_business_riders') {
        return {
          data: [
            { rider_user_id: RIDER_ID, display_name: 'Rider Norte' },
            { rider_user_id: SECOND_RIDER_ID, display_name: 'Rider Sur' },
          ],
          error: null,
          status: 200,
        };
      }
      if (name === 'claim_delivery_order') {
        // Réplica del contrato canónico: jsonb {ok, code}, replay idempotente
        // por clave y refusals con la revisión fresca — nunca un error crudo.
        const row = db.orders.find((candidate) => (
          candidate.business_id === args.p_business_id
          && candidate.public_code === args.p_public_code
        ));
        if (!row || row.origin === 'qa') {
          return { data: { ok: false, code: 'not_available' }, error: null, status: 200 };
        }
        const opKey = `${row.id}:claim:${args.p_idempotency_key}`;
        if (db.riderOps.has(opKey)) {
          return { data: { ...db.riderOps.get(opKey), idempotent_no_op: true }, error: null, status: 200 };
        }
        if (row.revision !== args.p_expected_revision) {
          return { data: { ok: false, code: 'stale_revision', revision: row.revision }, error: null, status: 200 };
        }
        if (row.delivery_mode !== 'delivery' || row.status !== 'ready' || row.assigned_rider_user_id) {
          return { data: { ok: false, code: 'taken_by_other', revision: row.revision }, error: null, status: 200 };
        }
        row.status = 'assigned';
        row.assigned_rider_user_id = userId;
        row.revision += 1;
        row.updated_at = new Date().toISOString();
        const claimResult = { ok: true, outcome: 'claimed', idempotent_no_op: false };
        db.riderOps.set(opKey, claimResult);
        return { data: claimResult, error: null, status: 200 };
      }
      if (['mark_delivery_picked_up', 'start_rider_delivery', 'mark_rider_arrived'].includes(name)) {
        const advance = {
          mark_delivery_picked_up: { op: 'picked_up', from: 'assigned', to: 'picked_up', refusal: 'not_ready_for_pickup' },
          start_rider_delivery: { op: 'start_route', from: 'picked_up', to: 'on_the_way', refusal: 'not_picked_up' },
          mark_rider_arrived: { op: 'arrived', from: 'on_the_way', to: 'arrived', refusal: 'not_on_the_way' },
        }[name];
        const row = db.orders.find((candidate) => candidate.id === args.p_order_id);
        if (!row || row.assigned_rider_user_id !== userId) {
          return { data: { ok: false, code: 'not_assigned' }, error: null, status: 200 };
        }
        const opKey = `${row.id}:${advance.op}:${args.p_idempotency_key}`;
        if (db.riderOps.has(opKey)) {
          return { data: { ...db.riderOps.get(opKey), idempotent_no_op: true }, error: null, status: 200 };
        }
        if (row.revision !== args.p_expected_revision) {
          return { data: { ok: false, code: 'stale_revision', revision: row.revision }, error: null, status: 200 };
        }
        if (row.status !== advance.from) {
          return { data: { ok: false, code: advance.refusal, revision: row.revision }, error: null, status: 200 };
        }
        row.status = advance.to;
        row.revision += 1;
        row.updated_at = new Date().toISOString();
        const advanceResult = { ok: true, outcome: advance.to, idempotent_no_op: false };
        db.riderOps.set(opKey, advanceResult);
        return { data: advanceResult, error: null, status: 200 };
      }
      if (name === 'assign_order_rider') {
        const row = db.orders.find((candidate) => candidate.id === args.p_order_id);
        if (
          !row
          || row.status !== args.p_expected_status
          || (row.assigned_rider_user_id || null) !== (args.p_expected_rider_user_id || null)
        ) {
          return {
            data: null,
            error: { code: '40001', message: 'conflicto de asignacion' },
            status: 409,
          };
        }
        row.status = 'assigned';
        row.assigned_rider_user_id = args.p_new_rider_user_id;
        row.updated_at = new Date().toISOString();
        return { data: withRelations(row, db), error: null, status: 200 };
      }
      if (name === 'confirm_delivery_code') {
        const row = db.orders.find((candidate) => candidate.id === args.p_order_id);
        if (!/^[0-9]{4}$/.test(String(args.p_delivery_code || '').replace(/\D/g, ''))) {
          return { data: { ok: false, code: 'invalid_format' }, error: null, status: 200 };
        }
        if (!row || row.assigned_rider_user_id !== userId) {
          return { data: { ok: false, code: 'not_assigned' }, error: null, status: 200 };
        }
        const opKey = `${row.id}:confirm_code:${args.p_idempotency_key}`;
        if (db.riderOps.has(opKey)) {
          return { data: { ...db.riderOps.get(opKey), idempotent_no_op: true }, error: null, status: 200 };
        }
        const handoff = db.handoffs.get(row.id);
        if (row.status === 'delivered' && handoff?.confirmedAt) {
          const replay = { ok: true, outcome: 'already_delivered', idempotent_no_op: true };
          db.riderOps.set(opKey, replay);
          return { data: replay, error: null, status: 200 };
        }
        if (row.revision !== args.p_expected_revision) {
          return { data: { ok: false, code: 'stale_revision', revision: row.revision }, error: null, status: 200 };
        }
        if (row.status !== 'arrived') {
          return { data: { ok: false, code: 'not_arrived', revision: row.revision }, error: null, status: 200 };
        }
        if (!handoff || (handoff.expiresAt && Date.parse(handoff.expiresAt) <= Date.now())) {
          return { data: { ok: false, code: 'code_unavailable' }, error: null, status: 200 };
        }
        if (args.p_delivery_code !== handoff.code) {
          handoff.failedAttempts += 1;
          return {
            data: {
              ok: false,
              code: handoff.failedAttempts >= 5 ? 'temporarily_locked' : 'incorrect_code',
              remaining_attempts: Math.max(0, 5 - handoff.failedAttempts),
              retry_after_seconds: handoff.failedAttempts >= 5 ? 300 : null,
            },
            error: null,
            status: 200,
          };
        }
        const confirmedAt = new Date().toISOString();
        handoff.confirmedAt = confirmedAt;
        row.status = 'delivered';
        row.revision += 1;
        row.delivered_at = confirmedAt;
        row.updated_at = confirmedAt;
        const confirmResult = { ok: true, outcome: 'confirmed', idempotent_no_op: false };
        db.riderOps.set(opKey, confirmResult);
        return { data: confirmResult, error: null, status: 200 };
      }
      if (name === 'publish_rider_location_receipt') {
        const row = db.orders.find((candidate) => candidate.id === args.p_order_id);
        if (
          !row
          || row.assigned_rider_user_id !== userId
        ) {
          return { data: { ok: false, code: 'not_assigned' }, error: null, status: 200 };
        }
        if (!['on_the_way', 'arrived'].includes(row.status)) {
          return { data: { ok: false, code: 'not_active' }, error: null, status: 200 };
        }
        if (row.revision !== args.p_expected_revision) {
          return { data: { ok: false, code: 'stale', revision: row.revision }, error: null, status: 200 };
        }
        if (args.p_is_mock === true) {
          return { data: { ok: false, code: 'mock_location_rejected' }, error: null, status: 200 };
        }
        const location = {
          id: `location-${db.locations.length + 1}`,
          order_id: row.id,
          business_id: row.business_id,
          rider_user_id: userId,
          lat: args.p_lat,
          lng: args.p_lng,
          accuracy: args.p_accuracy,
          heading: args.p_heading,
          speed: args.p_speed,
          source: 'gps',
          client_request_id: args.p_idempotency_key,
          receipt_sequence: db.locations.length + 1,
          created_at: new Date().toISOString(),
        };
        db.locations.push(location);
        return {
          data: { ok: true, code: 'accepted', idempotent_no_op: false, sequence: location.receipt_sequence, recorded_at: location.created_at },
          error: null,
          status: 200,
        };
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
    inFilters: [],
    insertPayload: null,
  };
  calls.from.push(operation);
  const query = {
    select(columns = '') {
      operation.columns = columns;
      return this;
    },
    eq(field, value) {
      operation.filters.push([field, value]);
      return this;
    },
    in(field, values) {
      operation.inFilters.push([field, Array.isArray(values) ? values : []]);
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
      applyFilters(db.orders, operation.filters, operation.inFilters)
        .map((row) => withRelations(row, db)),
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

function applyFilters(rows, filters, inFilters = []) {
  return rows.filter(
    (row) => (
      filters.every(([field, value]) => row[field] === value)
      && inFilters.every(([field, values]) => values.includes(row[field]))
    ),
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
    delivery_address_label: payload.customer_address_label || '',
    delivery_address_formatted: 'Roca 321, Centro',
    delivery_street: payload.delivery_street || '',
    delivery_street_number: payload.delivery_street_number || '',
    delivery_floor: payload.delivery_floor || '',
    delivery_apartment: payload.delivery_apartment || '',
    delivery_city: payload.delivery_city || '',
    delivery_province: payload.delivery_province || '',
    delivery_postal_code: payload.delivery_postal_code || '',
    delivery_snapshot_created_at: now,
    customer_notes: payload.customer_notes || '',
    address_label: 'Roca 321, Centro',
    // La columna es NOT NULL DEFAULT 'production' desde 20260806160000: un
    // pedido nace en la operación real salvo que el catálogo diga otra cosa.
    origin: payload.origin || 'production',
    payment_method: payload.payment_method || 'cash',
    subtotal: 2300 * quantity,
    delivery_fee: 500,
    total: (2300 * quantity) + 500,
    currency_code: 'ARS',
    revision: 1,
    order_events: [{
      id: `event-${sequence}-1`,
      sequence: sequence,
      event_type: 'order.received',
      metadata: { source: 'test' },
      payload: { source: 'test' },
      created_at: now,
    }],
    created_at: now,
    updated_at: now,
    client_request_id: payload.client_request_id,
    items: payload.items || [],
  };
}

function withRelations(row, db) {
  return {
    ...row,
    order_events: row.order_events || [],
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
    .filter((location) => (
      location.order_id === row.id
      && location.rider_user_id === row.assigned_rider_user_id
      && location.source === 'gps'
      && Number(location.accuracy) <= 250
      && Date.now() - Date.parse(location.created_at || '') <= 3 * 60 * 1000
    ))
    .sort((a, b) => Date.parse(b.created_at || '') - Date.parse(a.created_at || ''))[0];
  const activeDelivery = ['picked_up', 'on_the_way', 'arrived'].includes(row.status);
  const reliableEta = (
    ['business', 'routing'].includes(row.estimated_arrival_source)
    && Date.now() - Date.parse(row.estimated_arrival_updated_at || '') <= 15 * 60 * 1000
    && Date.parse(row.estimated_arrival_at || '') > Date.now()
  );
  return {
    public_code: row.public_code,
    delivery_mode: row.delivery_mode,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    accepted_at: row.accepted_at,
    preparing_at: row.preparing_at,
    ready_at: row.ready_at,
    dispatched_at: row.dispatched_at || row.picked_up_at,
    arrived_at: row.arrived_at,
    delivered_at: row.delivered_at,
    cancelled_at: row.cancelled_at || row.canceled_at,
    rejected_at: row.rejected_at,
    is_delivered: row.status === 'delivered',
    ...(row.status === 'delivered' ? {
      terminal_visible_until: row.terminal_visible_until,
    } : {}),
    ...(reliableEta ? {
      estimated_arrival_at: row.estimated_arrival_at,
      estimated_arrival_source: row.estimated_arrival_source,
      estimated_arrival_updated_at: row.estimated_arrival_updated_at,
      estimated_minutes: Math.ceil(
        (Date.parse(row.estimated_arrival_at) - Date.now()) / 60000,
      ),
    } : {}),
    ...(activeDelivery && latestLocation ? {
      rider_location: {
        lat: latestLocation.lat,
        lng: latestLocation.lng,
        accuracy: Math.max(100, latestLocation.accuracy || 100),
        source: 'gps',
        created_at: latestLocation.created_at,
      },
    } : {}),
    ...(row.status === 'arrived' && db.handoffs.get(row.id)?.confirmedAt == null ? {
      delivery_code: db.handoffs.get(row.id)?.code,
    } : {}),
    ...(db.handoffs.get(row.id)?.confirmedAt ? {
      delivery_code_confirmed_at: db.handoffs.get(row.id).confirmedAt,
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

function minutesAgoIso(minutes) {
  return new Date(Date.now() - (Number(minutes) || 0) * 60 * 1000).toISOString();
}

async function flushTasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
