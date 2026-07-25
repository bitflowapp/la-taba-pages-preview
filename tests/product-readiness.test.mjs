import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { STORAGE_KEYS } from '../js/config.js';
import {
  buildDefaultBusinessConfig,
  getBusinessConfig,
} from '../js/core/business-config-store.js';
import { restoreBusinessSetupDemo } from '../js/core/business-setup.js';
import { upsertCatalogProduct } from '../js/core/catalog-store.js';
import { buildBusinessReport } from '../js/core/business-reports.js';
import {
  activeTrackingLiveness,
  chooseRiderLocation,
  hasLiveRiderLocation,
  shouldPublishGpsFix,
} from '../js/map/route_geometry.js';
import {
  getDataMode,
  getOrderRepository,
  getRepositoryDiagnostic,
  isPersistentOrderRepository,
  resetRepositoryFactoryForTests,
} from '../js/repositories/repository_factory.js';
import {
  disableGpsTracking,
  enableGpsTracking,
  isGpsActive,
  syncSimulationOnStatus,
} from '../js/simulation.js';
import {
  getState,
  setState,
  updateBusinessConfig,
} from '../js/state.js';
import { clone, resetState } from './helpers.mjs';

const NOW = 1_800_000_000_000;

const PRODUCT_READINESS_COVERAGE = Object.freeze([
  {
    invariant: 'supabase-opt-in',
    coveredBy: ['tests/product-readiness.test.mjs', 'tests/repository.test.mjs', 'tests/supabase-repository.test.mjs'],
  },
  {
    invariant: 'honest-tracking-no-gps',
    coveredBy: ['tests/product-readiness.test.mjs', 'tests/e2e/honest-map.spec.mjs', 'tests/e2e/realtime.spec.mjs'],
  },
  {
    invariant: 'business-config-safe-update',
    coveredBy: ['tests/product-readiness.test.mjs', 'tests/business-config-store.test.mjs'],
  },
  {
    invariant: 'setup-restore-preserves-operational-state',
    coveredBy: ['tests/product-readiness.test.mjs', 'tests/business-setup.test.mjs'],
  },
  {
    invariant: 'catalog-edits-keep-order-snapshots',
    coveredBy: ['tests/product-readiness.test.mjs', 'tests/catalog.test.mjs', 'tests/business-reports.test.mjs'],
  },
  {
    invariant: 'reports-count-only-delivered-sales',
    coveredBy: ['tests/product-readiness.test.mjs', 'tests/business-reports.test.mjs'],
  },
  {
    invariant: 'gps-single-watch-and-terminal-stop',
    coveredBy: ['tests/product-readiness.test.mjs', 'tests/simulation.test.mjs'],
  },
  {
    invariant: 'mobile-390-no-horizontal-overflow',
    coveredBy: ['tests/e2e/la-taba.spec.mjs', 'tests/e2e/realtime.spec.mjs'],
  },
]);

beforeEach(() => {
  delete globalThis.__LA_TABA_RUNTIME_CONFIG__;
  installStorage();
  setLocationSearch('');
  resetRepositoryFactoryForTests();
  resetState({ orders: [], cart: [] });
  updateBusinessConfig(buildDefaultBusinessConfig());
  disableGpsTracking({ silent: true });
});

test('product readiness: backend real requiere runtime completo y preview queda local', () => {
  let repository = getOrderRepository();
  assert.equal(getDataMode(), 'preview');
  assert.equal(repository.mode, 'preview');
  assert.equal(isPersistentOrderRepository(repository), false);
  assert.equal(getRepositoryDiagnostic(), null);

  setLocationSearch('?supabaseUrl=https://la-taba.supabase.co&supabaseAnonKey=anon-public-key');
  resetRepositoryFactoryForTests();
  repository = getOrderRepository();
  assert.equal(getDataMode(), 'preview');
  assert.equal(repository.mode, 'preview');
  assert.equal(isPersistentOrderRepository(repository), false);
  assert.equal(getRepositoryDiagnostic(), null);

  setLocationSearch('?data=supabase');
  resetRepositoryFactoryForTests();
  repository = getOrderRepository();
  assert.equal(getDataMode(), 'preview');
  assert.equal(repository.mode, 'preview');
  assert.equal(isPersistentOrderRepository(repository), false);
  assert.equal(getRepositoryDiagnostic(), null);

  globalThis.__LA_TABA_RUNTIME_CONFIG__ = { mode: 'production', repository: { provider: 'supabase' } };
  resetRepositoryFactoryForTests();
  repository = getOrderRepository();
  assert.equal(getDataMode(), 'unavailable');
  assert.equal(repository.mode, 'unavailable');
  assert.equal(isPersistentOrderRepository(repository), false);
  assert.equal(getRepositoryDiagnostic()?.blocking, true);
});

test('product readiness: tracking without real GPS stays honest', () => {
  const order = makeOrder({
    id: 'LT-NOGPS',
    status: 'on_the_way',
    tracking: {
      lastLocation: {
        lat: -38.951,
        lng: -68.061,
        timestamp: NOW,
        source: 'simulation',
      },
    },
  });
  const sim = {
    orderId: order.id,
    lat: -38.952,
    lng: -68.062,
    timestamp: NOW,
    source: 'simulation',
    gpsStatus: 'inactive',
  };

  const chosen = chooseRiderLocation(sim, order.tracking.lastLocation, { now: NOW });
  assert.equal(chosen.source, 'simulation');
  assert.equal(hasLiveRiderLocation(chosen, { now: NOW }), false);
  assert.equal(activeTrackingLiveness(order, sim, { now: NOW }), 'idle');
  assert.equal(shouldPublishGpsFix(null, chosen, { now: NOW, orderStatus: order.status }), false);
});

test('product readiness: business config snapshots are immutable and updates preserve operational state', () => {
  const snapshot = getBusinessConfig();
  assert.throws(() => {
    snapshot.businessName = 'Mutated Store';
  }, TypeError);
  assert.throws(() => {
    snapshot.businessLocation.lat = 0;
  }, TypeError);

  const order = makeOrder({ id: 'LT-CFG', status: 'received' });
  const product = makeProduct({ id: 'p-cfg', name: 'Producto Config QA', price: 2500, stock: 8 });
  setState({
    orders: [order],
    products: [product],
    cart: [{ productId: product.id, quantity: 2 }],
  });
  const before = clone(pickOperationalState());

  updateBusinessConfig({
    businessName: 'Comercio Config QA',
    whatsappNumber: '5492995551111',
    deliveryFee: 1234,
  });

  assert.equal(getBusinessConfig().businessName, 'Comercio Config QA');
  assert.deepEqual(pickOperationalState(), before);
});

test('product readiness: restoring demo config does not erase orders, products, cart, customer history or cashbox closures', () => {
  const order = makeOrder({ id: 'LT-RESTORE', status: 'received' });
  const product = makeProduct({ id: 'p-restore', name: 'Producto Restore QA', stock: 5 });
  const customerHistory = [{ orderId: order.id, customerPhone: '2995550000' }];
  const cashboxClosures = [{ id: 'close-restore', total: 1000 }];

  setState({
    orders: [order],
    products: [product],
    cart: [{ productId: product.id, quantity: 1 }],
  });
  globalThis.localStorage.setItem(STORAGE_KEYS.customerHistory, JSON.stringify(customerHistory));
  globalThis.localStorage.setItem(STORAGE_KEYS.cashboxClosures, JSON.stringify(cashboxClosures));
  const before = clone(pickOperationalState());
  const historyBefore = globalThis.localStorage.getItem(STORAGE_KEYS.customerHistory);
  const closuresBefore = globalThis.localStorage.getItem(STORAGE_KEYS.cashboxClosures);

  updateBusinessConfig({ businessName: 'Config no demo', adminPin: '654321' });
  const restored = restoreBusinessSetupDemo({ confirmed: true });

  assert.equal(restored.ok, true);
  assert.equal(getBusinessConfig().businessName, buildDefaultBusinessConfig().businessName);
  assert.deepEqual(pickOperationalState(), before);
  assert.equal(globalThis.localStorage.getItem(STORAGE_KEYS.customerHistory), historyBefore);
  assert.equal(globalThis.localStorage.getItem(STORAGE_KEYS.cashboxClosures), closuresBefore);
});

test('product readiness: editing catalog products does not rewrite old order snapshots', () => {
  const created = upsertCatalogProduct(getState().products, {
    name: 'Snapshot Original QA',
    description: 'Producto para snapshot',
    price: 4100,
    categoryId: 'gaseosas',
    available: true,
    stock: 10,
  }, { now: NOW });
  assert.equal(created.ok, true);

  setState({
    products: created.products,
    orders: [makeOrder({
      id: 'LT-SNAPSHOT',
      status: 'delivered',
      items: [{
        productId: created.product.id,
        name: created.product.name,
        quantity: 1,
        unitPrice: created.product.price,
        unit: 'unidad',
      }],
      subtotal: created.product.price,
      total: created.product.price,
    })],
  });

  const edited = upsertCatalogProduct(getState().products, {
    name: 'Snapshot Editado QA',
    description: 'Producto editado',
    price: 9900,
    categoryId: 'gaseosas',
    available: true,
    stock: 4,
  }, { productId: created.product.id, now: NOW + 1 });
  assert.equal(edited.ok, true);
  setState({ products: edited.products });

  const item = getState().orders.find((order) => order.id === 'LT-SNAPSHOT').items[0];
  assert.equal(item.name, 'Snapshot Original QA');
  assert.equal(item.unitPrice, 4100);
});

test('product readiness: reports count delivered orders only for sales', () => {
  const report = buildBusinessReport([
    makeOrder({ id: 'LT-DELIVERED', status: 'delivered', total: 2000, subtotal: 2000 }),
    makeOrder({ id: 'LT-CANCELLED', status: 'cancelled', total: 9000, subtotal: 9000, cancelReason: 'Cliente no responde' }),
    makeOrder({ id: 'LT-READY', status: 'ready', total: 3000, subtotal: 3000 }),
  ], { now: new Date('2026-06-05T12:00:00.000Z'), period: 'all' });

  assert.equal(report.deliveredOrders, 1);
  assert.equal(report.cancelledOrders, 1);
  assert.equal(report.activeOrders, 1);
  assert.equal(report.netSales, 2000);
  assert.equal(report.grossSales, 2000);
});

test('product readiness: GPS does not create duplicate watchers and stops on terminal status', () => {
  const originalSecureContext = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const order = makeOrder({ id: 'LT-GPS', status: 'on_the_way' });
  let watchCount = 0;
  let clearCount = 0;

  setState({ orders: [order], lastOrderId: order.id });
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      geolocation: {
        watchPosition() {
          watchCount += 1;
          return watchCount;
        },
        clearWatch() {
          clearCount += 1;
        },
      },
    },
  });

  try {
    assert.equal(enableGpsTracking().ok, true);
    assert.equal(enableGpsTracking().ok, true);
    assert.equal(watchCount, 1);
    assert.equal(isGpsActive(), true);

    syncSimulationOnStatus(order.id, 'delivered');
    assert.equal(isGpsActive(), false);
    assert.equal(clearCount, 1);
  } finally {
    disableGpsTracking({ silent: true });
    if (originalSecureContext) Object.defineProperty(globalThis, 'isSecureContext', originalSecureContext);
    else delete globalThis.isSecureContext;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});

test('product readiness: guardrail coverage matrix stays explicit', () => {
  const required = [
    'supabase-opt-in',
    'honest-tracking-no-gps',
    'business-config-safe-update',
    'setup-restore-preserves-operational-state',
    'catalog-edits-keep-order-snapshots',
    'reports-count-only-delivered-sales',
    'gps-single-watch-and-terminal-stop',
    'mobile-390-no-horizontal-overflow',
  ];
  const byInvariant = new Map(PRODUCT_READINESS_COVERAGE.map((entry) => [entry.invariant, entry]));

  for (const invariant of required) {
    const entry = byInvariant.get(invariant);
    assert.ok(entry, `${invariant} debe estar mapeado`);
    assert.ok(entry.coveredBy.length >= 1, `${invariant} debe apuntar a tests existentes o nuevos`);
  }
});

function pickOperationalState() {
  const state = getState();
  return {
    orders: state.orders.map((order) => ({
      id: order.id,
      status: order.status,
      deliveryMode: order.deliveryMode,
      subtotal: order.subtotal,
      deliveryFee: order.deliveryFee,
      discountTotal: order.discountTotal,
      total: order.total,
      items: order.items.map((item) => ({
        productId: item.productId,
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        unit: item.unit,
      })),
    })),
    products: state.products.map((product) => ({
      id: product.id,
      name: product.name,
      price: product.price,
      stock: product.stock,
      available: product.available,
      archived: product.archived,
    })),
    cart: state.cart.map((item) => ({ productId: item.productId, quantity: item.quantity })),
  };
}

function makeOrder(overrides = {}) {
  const item = overrides.items?.[0] || {
    productId: 'p-product-readiness',
    name: 'Producto Readiness',
    quantity: 1,
    unitPrice: overrides.subtotal ?? overrides.total ?? 1000,
    unit: 'unidad',
  };
  const subtotal = overrides.subtotal ?? item.quantity * item.unitPrice;
  const total = overrides.total ?? subtotal;

  return {
    id: overrides.id || 'LT-READINESS',
    customerName: 'Cliente Readiness',
    customerPhone: '2995550000',
    address: 'Roca 123',
    deliveryMode: 'delivery',
    paymentMethod: 'Efectivo',
    paymentMethodCode: 'cash',
    notes: '',
    createdAt: overrides.createdAt || '2026-06-05T12:00:00.000Z',
    status: overrides.status || 'received',
    items: overrides.items || [item],
    subtotal,
    deliveryFee: overrides.deliveryFee ?? 0,
    discountTotal: overrides.discountTotal ?? 0,
    total,
    statusHistory: overrides.statusHistory || [{ status: 'received', at: '2026-06-05T12:00:00.000Z' }],
    delivery: {
      driverName: 'Sin asignar',
      driverPhone: '',
      estimatedMinutes: 0,
      ...overrides.delivery,
    },
    ...overrides,
  };
}

function makeProduct(overrides = {}) {
  return {
    id: overrides.id || 'p-product-readiness',
    name: overrides.name || 'Producto Readiness',
    description: overrides.description || 'Producto para invariantes',
    price: overrides.price ?? 1000,
    unit: overrides.unit || 'unidad',
    categoryId: overrides.categoryId || 'carnes',
    available: overrides.available ?? true,
    stock: overrides.stock ?? 10,
    image: '',
    badge: '',
    archived: overrides.archived ?? false,
    createdAt: overrides.createdAt || '2026-06-05T12:00:00.000Z',
    updatedAt: overrides.updatedAt || '2026-06-05T12:00:00.000Z',
  };
}

function installStorage() {
  globalThis.localStorage = memoryStorage();
  globalThis.sessionStorage = memoryStorage();
}

function memoryStorage() {
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
    clear() {
      values.clear();
    },
  };
}

function setLocationSearch(search) {
  Object.defineProperty(globalThis, 'location', {
    value: { search, protocol: 'http:', hostname: 'localhost' },
    configurable: true,
  });
}
