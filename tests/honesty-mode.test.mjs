import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APP_DATA_VERSION,
  APP_MODE_DEMO,
  APP_MODE_PRODUCTION,
  APP_MODE_PUBLIC,
  APP_MODE_UNAVAILABLE,
  getAppMode,
  isDemoMode,
  isOperationalView,
} from '../js/core/app-mode.js';
import { validateCouponCode } from '../js/core/promotions.js';
import {
  isPlausibleStreetAddress,
  isValidArgentinePhone,
  isValidDeliveryZone,
} from '../js/core/validators.js';
import { isPersistedStateCompatible, STATE_SCHEMA_VERSION } from '../js/state.js';

const PRODUCTION_RUNTIME = {
  mode: 'production',
  repository: {
    provider: 'supabase',
    supabaseUrl: 'https://la-taba.supabase.co',
    publishableKey: 'publishable-key',
    businessId: '00000000-0000-4000-8000-000000000001',
  },
};

test('demo exige demo=1, producción exige runtime completo y preview no abre vistas operativas', () => {
  assert.equal(isDemoMode(''), false);
  assert.equal(isDemoMode('?demo=0'), false);
  assert.equal(isDemoMode('?demo=1'), true);
  assert.equal(getAppMode(''), APP_MODE_PUBLIC);
  assert.equal(getAppMode('?demo=1'), APP_MODE_DEMO);
  assert.equal(getAppMode('', PRODUCTION_RUNTIME), APP_MODE_PRODUCTION);
  // B4: en un despliegue productivo la bandera de la URL se ignora. Antes acá
  // decía APP_MODE_DEMO, y eso era el defecto: un enlace convertía la tienda
  // real en una simulación que igual dice «pedido confirmado».
  assert.equal(getAppMode('?demo=1', PRODUCTION_RUNTIME), APP_MODE_PRODUCTION);
  // Y la garantía original —que ?demo=1 abre la demo— se conserva donde sigue
  // valiendo: sin configuración, y en un despliegue declarado como staging.
  assert.equal(
    getAppMode('?demo=1', {
      ...PRODUCTION_RUNTIME,
      repository: { ...PRODUCTION_RUNTIME.repository, deploymentEnvironment: 'staging' },
    }),
    APP_MODE_DEMO,
  );
  assert.equal(getAppMode('', { mode: 'production', repository: {} }), APP_MODE_UNAVAILABLE);
  assert.equal(isOperationalView('business', ''), true);
  assert.equal(isOperationalView('rider', ''), true);
  assert.equal(isOperationalView('business', '?demo=1'), false);
  assert.equal(isOperationalView('business', '', PRODUCTION_RUNTIME), false);
  assert.equal(isOperationalView('business', '', { mode: 'production', repository: {} }), true);
});

test('la persistencia anterior o de otro modo se invalida automáticamente', () => {
  const publicBase = {
    schemaVersion: STATE_SCHEMA_VERSION,
    dataVersion: APP_DATA_VERSION,
    appMode: APP_MODE_PUBLIC,
  };
  assert.equal(isPersistedStateCompatible({ ...publicBase }, publicBase), true);
  assert.equal(isPersistedStateCompatible({ ...publicBase, schemaVersion: 2 }, publicBase), false);
  assert.equal(isPersistedStateCompatible({ ...publicBase, dataVersion: 'legacy-retail-v1' }, publicBase), false);
  assert.equal(isPersistedStateCompatible({ ...publicBase, appMode: APP_MODE_DEMO }, publicBase), false);
});

test('checkout rechaza teléfono y dirección absurdos y exige una zona', () => {
  assert.equal(isValidArgentinePhone('1'), false);
  assert.equal(isValidArgentinePhone('1111111111'), false);
  assert.equal(isValidArgentinePhone('299 555-1234'), true);
  assert.equal(isPlausibleStreetAddress('x'), false);
  assert.equal(isPlausibleStreetAddress('Roca'), false);
  assert.equal(isPlausibleStreetAddress('Roca 123'), true);
  assert.equal(isValidDeliveryZone(''), false);
  assert.equal(isValidDeliveryZone('Neuquén Capital'), true);
});

test('TABA10 y cualquier otro cupón público permanecen desactivados', () => {
  assert.deepEqual(validateCouponCode('TABA10'), {
    ok: false,
    code: 'TABA10',
    discountPercent: 0,
    message: 'No hay cupones activos por el momento.',
  });
});
