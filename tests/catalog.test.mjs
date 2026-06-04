import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { addToCart, canAddProduct } from '../js/cart.js';
import { STORAGE_KEYS } from '../js/config.js';
import {
  archiveCatalogProduct,
  getCustomerCatalogProducts,
  restoreDemoCatalog,
  toggleCatalogProductAvailability,
  upsertCatalogProduct,
  validateCatalogProductInput,
} from '../js/core/catalog-store.js';
import { activeTrackingLiveness } from '../js/map/route_geometry.js';
import {
  getDataMode,
  getOrderRepository,
  resetRepositoryFactoryForTests,
} from '../js/repositories/repository_factory.js';
import { setState } from '../js/state.js';
import { confirmCatalogReset, handleBusinessAction } from '../js/business.js';
import { makeTarget, resetState, state } from './helpers.mjs';

beforeEach(() => {
  installStorage();
  setLocationSearch('');
  resetRepositoryFactoryForTests();
  resetState();
});

test('catalog persists created products in local demo storage', () => {
  const created = upsertCatalogProduct(state().products, {
    name: 'Hamburguesa QA',
    description: 'Medallon listo para plancha',
    price: '12345',
    categoryId: 'carnes',
    badge: 'Nuevo',
    available: true,
  }, { now: 1 });

  assert.equal(created.ok, true);
  setState({ products: created.products });

  const saved = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEYS.state));
  const savedProduct = saved.products.find((product) => product.id === created.product.id);
  assert.equal(savedProduct.name, 'Hamburguesa QA');
  assert.equal(savedProduct.price, 12345);
  assert.equal(savedProduct.badge, 'Nuevo');
});

test('catalog rejects invalid product input', () => {
  assert.equal(validateCatalogProductInput({ name: '', price: 1000, categoryId: 'carnes' }).ok, false);
  assert.equal(validateCatalogProductInput({ name: 'Sin precio', price: '', categoryId: 'carnes' }).ok, false);
  assert.equal(validateCatalogProductInput({ name: 'Negativo', price: -10, categoryId: 'carnes' }).ok, false);
  assert.equal(validateCatalogProductInput({ name: 'Texto', price: 'abc', categoryId: 'carnes' }).ok, false);
  assert.equal(validateCatalogProductInput({ name: 'Categoria mala', price: 1000, categoryId: 'fantasma' }).ok, false);
});

test('disabled products stay visible but are not orderable by the customer', () => {
  const created = upsertCatalogProduct(state().products, {
    name: 'Producto Pausado QA',
    description: 'Visible sin venta',
    price: 5000,
    categoryId: 'carnes',
    available: true,
  }, { now: 2 });
  setState({ products: created.products });

  const toggled = toggleCatalogProductAvailability(state().products, created.product.id);
  assert.equal(toggled.ok, true);
  setState({ products: toggled.products });

  const customerProduct = getCustomerCatalogProducts(state().products).find((product) => product.id === created.product.id);
  assert.equal(customerProduct.available, false);
  assert.equal(canAddProduct(created.product.id), false);
  assert.equal(addToCart(created.product.id).ok, false);
});

test('edited product price is reflected in the customer catalog', () => {
  const created = upsertCatalogProduct(state().products, {
    name: 'Precio Editable QA',
    description: 'Cambia en cliente',
    price: 8000,
    categoryId: 'carnes',
    available: true,
  }, { now: 3 });
  setState({ products: created.products });

  const edited = upsertCatalogProduct(state().products, {
    name: 'Precio Editable QA',
    description: 'Cambia en cliente',
    price: '9500',
    categoryId: 'carnes',
    available: true,
  }, { productId: created.product.id });
  assert.equal(edited.ok, true);
  setState({ products: edited.products });

  const customerProduct = getCustomerCatalogProducts(state().products).find((product) => product.id === created.product.id);
  assert.equal(customerProduct.price, 9500);
});

test('archived products leave the customer catalog without touching existing orders', () => {
  const created = upsertCatalogProduct(state().products, {
    name: 'Archivo QA',
    description: 'No se muestra',
    price: 4500,
    categoryId: 'carnes',
    available: true,
  }, { now: 4 });
  const order = {
    id: 'LT-ARCH',
    customerName: 'Cliente',
    customerPhone: '299',
    address: 'Roca 1',
    deliveryMode: 'pickup',
    paymentMethod: 'Efectivo',
    notes: '',
    createdAt: new Date().toISOString(),
    status: 'received',
    items: [{ productId: created.product.id, name: created.product.name, quantity: 1, unitPrice: created.product.price, unit: 'unidad' }],
  };
  setState({ products: created.products, orders: [order] });

  const archived = archiveCatalogProduct(state().products, created.product.id);
  assert.equal(archived.ok, true);
  setState({ products: archived.products });

  assert.equal(getCustomerCatalogProducts(state().products).some((product) => product.id === created.product.id), false);
  assert.equal(state().orders[0].items[0].name, 'Archivo QA');
});

test('demo catalog restoration removes local edits and keeps demo products', () => {
  const created = upsertCatalogProduct(state().products, {
    name: 'Temporal QA',
    description: 'Se restaura',
    price: 7000,
    categoryId: 'carnes',
    available: true,
  }, { now: 5 });
  setState({ products: created.products });

  setState({ products: restoreDemoCatalog(), activeCategory: 'all' });

  assert.equal(state().products.some((product) => product.id === created.product.id), false);
  assert.ok(state().products.some((product) => product.id === 'p-vacio'));
});

test('catalog mutations do not activate Supabase by accident', () => {
  setLocationSearch('?supabaseUrl=https://la-taba.supabase.co&supabaseAnonKey=anon-public-key');
  resetRepositoryFactoryForTests();

  const created = upsertCatalogProduct(state().products, {
    name: 'Local First QA',
    description: 'No cambia repo',
    price: 6200,
    categoryId: 'carnes',
    available: true,
  }, { now: 6 });
  setState({ products: created.products });

  const repository = getOrderRepository();
  assert.equal(getDataMode(), 'demo');
  assert.equal(repository.mode, 'demo');
});

test('tracking without real GPS remains idle for the honest no-map fallback', () => {
  const now = 1_000_000;
  const order = {
    id: 'LT-NOGPS',
    status: 'on_the_way',
    tracking: {
      lastLocation: {
        lat: -38.951,
        lng: -68.061,
        source: 'simulation',
        timestamp: now,
      },
    },
  };

  assert.equal(activeTrackingLiveness(order, null, { now }), 'idle');
});

test('restoring demo catalog requires explicit confirmation', () => {
  const created = upsertCatalogProduct(state().products, {
    name: 'Producto del comercio',
    description: 'Cargado por el negocio',
    price: '9999',
    categoryId: 'carnes',
    available: true,
  }, { now: 1 });
  assert.equal(created.ok, true);
  setState({ products: created.products });
  const customId = created.product.id;

  // Primer tap en "Restaurar catalogo demo": NO restaura (solo abriría el modal).
  const requested = handleBusinessAction(makeTarget({ '[data-catalog-reset-demo]': {} }));
  assert.equal(requested.handled, true);
  assert.ok(
    state().products.some((product) => product.id === customId),
    'el primer tap no debe borrar los productos cargados',
  );

  // Cancelar conserva el catálogo actual.
  const dismissed = handleBusinessAction(makeTarget({ '[data-catalog-reset-dismiss]': {} }));
  assert.equal(dismissed.handled, true);
  assert.ok(
    state().products.some((product) => product.id === customId),
    'cancelar la confirmación conserva los productos cargados',
  );
});

test('confirming demo restore replaces the catalog', () => {
  const created = upsertCatalogProduct(state().products, {
    name: 'Producto del comercio',
    description: 'Cargado por el negocio',
    price: '9999',
    categoryId: 'carnes',
    available: true,
  }, { now: 1 });
  assert.equal(created.ok, true);
  setState({ products: created.products });
  const customId = created.product.id;

  // Recién al confirmar se reemplaza el catálogo por el demo.
  const confirmed = confirmCatalogReset();
  assert.equal(confirmed.ok, true);
  assert.equal(
    state().products.some((product) => product.id === customId),
    false,
    'confirmar restauración elimina los productos cargados',
  );

  const demoIds = new Set(restoreDemoCatalog().map((product) => product.id));
  assert.ok(
    state().products.every((product) => demoIds.has(product.id)),
    'el catálogo restaurado solo contiene productos demo',
  );
});

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
    value: { search },
    configurable: true,
  });
}
