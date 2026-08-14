import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { addToCart } from '../js/cart.js';
import {
  DEFAULT_STORAGE_KEYS,
  SHOWCASE_STORAGE_KEYS,
  STORAGE_KEYS,
  storageKeysForSearch,
} from '../js/config.js';
import {
  APP_MODE_DEMO,
  APP_MODE_PRODUCTION,
  getAppMode,
  isDemoMode,
  isOperationalView,
  isShowcaseMode,
} from '../js/core/app-mode.js';
import { createOrderFromCheckout, updateOrderStatus } from '../js/orders.js';
import {
  getDataMode,
  getOrderRepository,
  resetRepositoryFactoryForTests,
} from '../js/repositories/repository_factory.js';
import {
  SANDBOX_NAMESPACE_DEMO,
  SANDBOX_NAMESPACE_SHOWCASE,
  createSandboxOrderRepository,
  getSandboxStorageNamespace,
  isSandboxOrderRepository,
} from '../js/repositories/sandbox_order_repository.js';
import { isSandboxToolsEnabled } from '../js/sandbox-tools.js';
import { pauseSimulation, startSimulation } from '../js/simulation.js';
import { getState } from '../js/state.js';
import { CONFIRMED_DELIVERY_POINT, resetState } from './helpers.mjs';

const PRODUCTION_RUNTIME = {
  mode: 'production',
  repository: {
    provider: 'supabase',
    supabaseUrl: 'https://la-taba.supabase.co',
    publishableKey: 'publishable-key',
    businessId: '00000000-0000-4000-8000-000000000001',
  },
};

// B4 · La presentación es legítima en staging y está prohibida en producción.
// Las garantías de aislamiento que este archivo protege —claves de storage
// propias, sandbox forzada, relay ignorado— siguen midiéndose donde la
// presentación existe de verdad.
const STAGING_RUNTIME = {
  ...PRODUCTION_RUNTIME,
  repository: { ...PRODUCTION_RUNTIME.repository, deploymentEnvironment: 'staging' },
};

beforeEach(() => {
  delete globalThis.__LA_TABA_RUNTIME_CONFIG__;
  setLocationSearch('');
  resetRepositoryFactoryForTests();
  resetState();
});

afterEach(() => {
  pauseSimulation();
  delete globalThis.__LA_TABA_RUNTIME_CONFIG__;
  setLocationSearch('');
  resetRepositoryFactoryForTests();
});

test('showcase requiere showcase=1 y conserva el contrato demo existente', () => {
  assert.equal(isShowcaseMode(''), false);
  assert.equal(isShowcaseMode('?showcase=0'), false);
  assert.equal(isShowcaseMode('?showcase=true'), false);
  assert.equal(isShowcaseMode('?demo=1'), false);
  assert.equal(isShowcaseMode('?showcase=1'), true);

  assert.equal(isDemoMode('?demo=1'), true);
  assert.equal(isDemoMode('?showcase=1'), true);
  assert.equal(getAppMode('?showcase=1', STAGING_RUNTIME), APP_MODE_DEMO);
  assert.equal(isOperationalView('business', '?showcase=1', STAGING_RUNTIME), false);
  assert.equal(isOperationalView('rider', '?showcase=1', STAGING_RUNTIME), false);
});

test('B4: en producción la presentación no se puede pedir por URL', () => {
  assert.equal(isShowcaseMode('?showcase=1', PRODUCTION_RUNTIME), false);
  assert.equal(isDemoMode('?showcase=1', PRODUCTION_RUNTIME), false);
  assert.equal(getAppMode('?showcase=1', PRODUCTION_RUNTIME), APP_MODE_PRODUCTION);
});

test('showcase usa claves propias y demo/tests conservan las claves históricas', () => {
  assert.deepEqual(STORAGE_KEYS, DEFAULT_STORAGE_KEYS);
  assert.deepEqual(storageKeysForSearch(''), DEFAULT_STORAGE_KEYS);
  assert.deepEqual(storageKeysForSearch('?demo=1'), DEFAULT_STORAGE_KEYS);
  assert.deepEqual(storageKeysForSearch('?showcase=1'), SHOWCASE_STORAGE_KEYS);

  for (const key of Object.keys(DEFAULT_STORAGE_KEYS)) {
    assert.notEqual(SHOWCASE_STORAGE_KEYS[key], DEFAULT_STORAGE_KEYS[key]);
    assert.match(SHOWCASE_STORAGE_KEYS[key], /showcase/);
  }
});

test('factory showcase ignora relay y runtime Supabase y fuerza sandbox aislada', () => {
  globalThis.__LA_TABA_RUNTIME_CONFIG__ = STAGING_RUNTIME;
  setLocationSearch('?showcase=1&relay=https://attacker.example&room=remote');
  resetRepositoryFactoryForTests();

  const repository = getOrderRepository();
  assert.equal(getDataMode(), 'showcase');
  assert.equal(isSandboxOrderRepository(repository), true);
  assert.equal(repository.mode, 'sandbox');
  assert.equal(repository.sandboxNamespace, SANDBOX_NAMESPACE_SHOWCASE);
  assert.equal('getTransportStatus' in repository, false);
});

test('B4: en producción, ?showcase=1 NO cambia el repositorio por la sandbox', () => {
  globalThis.__LA_TABA_RUNTIME_CONFIG__ = PRODUCTION_RUNTIME;
  setLocationSearch('?showcase=1&relay=https://attacker.example&room=remote');
  resetRepositoryFactoryForTests();

  // Éste es el corazón del defecto: con una configuración productiva cargada, un
  // enlace preparado hacía que la tienda hablara con una sandbox local y
  // confirmara pedidos que nunca existieron.
  const repository = getOrderRepository();
  assert.notEqual(getDataMode(), 'showcase');
  assert.equal(isSandboxOrderRepository(repository), false);
});

test('IndexedDB, canal, tick, rider y memoria usan namespaces separados', () => {
  const demo = getSandboxStorageNamespace(SANDBOX_NAMESPACE_DEMO);
  const showcase = getSandboxStorageNamespace(SANDBOX_NAMESPACE_SHOWCASE);

  assert.deepEqual(demo, {
    namespace: 'demo',
    databaseName: 'taba-sandbox',
    syncKey: 'taba-sandbox-sync-v1',
    riderKey: 'taba-sandbox-rider-id',
    channelName: 'taba-sandbox-state-v1',
    memoryKey: 'demo',
  });
  for (const key of ['databaseName', 'syncKey', 'riderKey', 'channelName', 'memoryKey']) {
    assert.notEqual(showcase[key], demo[key]);
  }

  const demoRepository = createSandboxOrderRepository();
  const showcaseRepository = createSandboxOrderRepository({ namespace: SANDBOX_NAMESPACE_SHOWCASE });
  assert.equal(demoRepository.sandboxNamespace, SANDBOX_NAMESPACE_DEMO);
  assert.equal(showcaseRepository.sandboxNamespace, SANDBOX_NAMESPACE_SHOWCASE);
});

test('herramientas técnicas siguen en demo y quedan ocultas en showcase', () => {
  setLocationSearch('?demo=1&tools=1');
  assert.equal(isSandboxToolsEnabled(), true);

  setLocationSearch('?showcase=1&tools=1');
  assert.equal(isSandboxToolsEnabled(), false);
});

test('la simulación showcase conserva la marca de ruta sandbox', () => {
  setLocationSearch('?showcase=1');
  addToCart('qa-gaseosa-cola', 1);
  const created = createOrderFromCheckout({
    ...CONFIRMED_DELIVERY_POINT,
    customerName: 'Cliente Showcase',
    customerPhone: '2995550101',
    customerAddress: 'Calle de muestra 123',
    customerStreetAddress: 'Calle de muestra 123',
    customerNeighborhood: 'Neuquén',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
    ageConfirmed: true,
  });
  assert.equal(created.ok, true);
  assert.equal(updateOrderStatus(created.order.id, 'preparing').ok, true);
  assert.equal(updateOrderStatus(created.order.id, 'ready').ok, true);
  assert.equal(updateOrderStatus(created.order.id, 'on_the_way').ok, true);

  assert.equal(startSimulation().ok, true);
  assert.equal(getState().simulation.sandboxMode, true);
  assert.equal(getState().simulation.origin, 'sandbox_route');
});

function setLocationSearch(search) {
  Object.defineProperty(globalThis, 'location', {
    value: { search },
    configurable: true,
  });
}
