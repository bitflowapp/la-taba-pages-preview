import assert from 'node:assert/strict';
import test from 'node:test';

import { getCustomerCatalogProducts, isProductOrderable, isProductVisibleToCustomer } from '../js/core/catalog-store.js';

// Un despliegue productivo válido (host de 20 caracteres, negocio propio).
const PRODUCCION = Object.freeze({
  mode: 'production',
  repository: {
    provider: 'supabase',
    deploymentEnvironment: 'pilot',
    supabaseUrl: 'https://tabapendingpricefx00.supabase.co',
    publishableKey: 'sb_publishable_pending_price_fixture',
    businessId: '00000000-0000-4000-8000-0000000000e2',
  },
});

function enProduccion(fn) {
  const previo = globalThis.__LA_TABA_RUNTIME_CONFIG__;
  globalThis.__LA_TABA_RUNTIME_CONFIG__ = PRODUCCION;
  try {
    return fn();
  } finally {
    if (previo === undefined) delete globalThis.__LA_TABA_RUNTIME_CONFIG__;
    else globalThis.__LA_TABA_RUNTIME_CONFIG__ = previo;
  }
}

const CON_PRECIO = { id: 'a', name: 'Coca-Cola 2,25 L', price: 3900, priceStatus: 'confirmed', stock: 10, available: true };
const PENDIENTE = { id: 'b', name: 'Sprite 1,5 L', price: null, pricePending: true, priceStatus: 'pending', stock: 10, available: false };
const INCOHERENTE = { id: 'c', name: 'Fila rota', price: 0, priceStatus: 'confirmed', stock: 10, available: true };
const ARCHIVADO = { ...CON_PRECIO, id: 'd', archived: true };

test('la configuración de prueba es de producción de verdad', async () => {
  const { isProductionMode } = await import('../js/core/app-mode.js');
  assert.equal(enProduccion(() => isProductionMode('')), true);
});

test('en producción un producto sin precio confirmado no se publica al cliente', () => {
  enProduccion(() => {
    assert.equal(isProductVisibleToCustomer(CON_PRECIO), true);
    assert.equal(isProductVisibleToCustomer(PENDIENTE), false);
    // «Sin precio» también es un cero con estado «confirmed»: no se inventa.
    assert.equal(isProductVisibleToCustomer(INCOHERENTE), false);
    assert.equal(isProductVisibleToCustomer(ARCHIVADO), false);
    assert.deepEqual(
      getCustomerCatalogProducts([CON_PRECIO, PENDIENTE, INCOHERENTE, ARCHIVADO]).map((p) => p.id),
      ['a'],
    );
    assert.equal(isProductOrderable(PENDIENTE), false);
  });
});

test('fuera de producción la vidriera de precios pendientes se conserva (demo/QA)', () => {
  assert.equal(globalThis.__LA_TABA_RUNTIME_CONFIG__, undefined);
  assert.equal(isProductVisibleToCustomer(PENDIENTE), true);
  // Pero nunca se puede pedir.
  assert.equal(isProductOrderable(PENDIENTE), false);
});
