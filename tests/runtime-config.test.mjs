import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import {
  RUNTIME_CONFIG_GLOBAL_KEY,
  isProductionCatalogReady,
  readRuntimeConfigSource,
  resolveRuntimeConfig,
  setProductionCatalogReady,
} from '../js/core/runtime-config.js';

const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';

function legacyJwt(role) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role })}.test-signature`;
}

afterEach(() => {
  delete globalThis[RUNTIME_CONFIG_GLOBAL_KEY];
  delete globalThis.location;
  setProductionCatalogReady(false);
});

test('runtime config ausente conserva preview y no consulta parámetros de URL', () => {
  globalThis.location = {
    search: '?data=supabase&supabaseUrl=https://attacker.example&supabaseAnonKey=stolen-key',
  };

  const runtime = resolveRuntimeConfig();
  assert.equal(runtime.status, 'absent');
  assert.equal(runtime.productionRequested, false);
  assert.equal(runtime.repository, null);
});

test('runtime config productiva normaliza Supabase y prefiere publishableKey', () => {
  globalThis[RUNTIME_CONFIG_GLOBAL_KEY] = {
    mode: 'production',
    repository: {
      provider: 'supabase',
      supabaseUrl: 'https://la-taba.supabase.co/',
      publishableKey: 'publishable-key',
      anonKey: 'legacy-anon-key',
      businessId: BUSINESS_ID,
      pollMs: 4000,
    },
  };

  const runtime = resolveRuntimeConfig();
  assert.equal(runtime.status, 'ready');
  assert.equal(runtime.isProductionReady, true);
  assert.deepEqual(runtime.repository, {
    provider: 'supabase',
    supabaseUrl: 'https://la-taba.supabase.co',
    publishableKey: 'publishable-key',
    businessId: BUSINESS_ID,
    pollMs: 4000,
    // El entorno viaja siempre, esté declarado o deducido. Acá no se declaró y
    // el host es remoto, así que la deducción es «producción». Antes el campo
    // desaparecía cuando no venía escrito, y eso dejaba a quien preguntara
    // «¿esto es producción?» sin poder distinguir «no lo es» de «no lo dijo».
    deploymentEnvironment: 'production',
  });
  assert.equal(readRuntimeConfigSource(), globalThis[RUNTIME_CONFIG_GLOBAL_KEY]);
});

test('anonKey queda como alias compatible pero la salida siempre es publishableKey', () => {
  const runtime = resolveRuntimeConfig({
    mode: 'production',
    repository: {
      provider: 'supabase',
      supabaseUrl: 'https://la-taba.supabase.co',
      anonKey: 'legacy-anon-key',
      businessId: BUSINESS_ID,
    },
  });

  assert.equal(runtime.isProductionReady, true);
  assert.equal(runtime.repository.publishableKey, 'legacy-anon-key');
  assert.equal('anonKey' in runtime.repository, false);
});

test('producción exige Supabase y toda configuración incompleta falla cerrado', () => {
  const legacyHttp = resolveRuntimeConfig({
    mode: 'production',
    repository: {
      provider: 'http',
      baseUrl: 'https://orders.example.test/api/',
    },
  });
  assert.equal(legacyHttp.isProductionReady, false);
  assert.match(legacyHttp.errors.join(' '), /supabase/i);

  for (const invalid of [
    {},
    { mode: 'demo', repository: { provider: 'http', baseUrl: 'https://orders.example.test' } },
    { mode: 'production', repository: { provider: 'http', baseUrl: 'http://orders.example.test' } },
    { mode: 'production', repository: { provider: 'supabase', supabaseUrl: 'https://la-taba.supabase.co' } },
  ]) {
    const runtime = resolveRuntimeConfig(invalid);
    assert.equal(runtime.status, 'invalid');
    assert.equal(runtime.productionRequested, true);
    assert.equal(runtime.isProductionReady, false);
    assert.equal(runtime.repository, null);
    assert.ok(runtime.errors.length > 0);
  }
});

test('Supabase local admite HTTP sólo sobre loopback', () => {
  for (const supabaseUrl of [
    'http://localhost:54321',
    'http://127.0.0.1:54321/',
    'http://[::1]:54321',
  ]) {
    const runtime = resolveRuntimeConfig({
      mode: 'production',
      repository: {
        provider: 'supabase',
        supabaseUrl,
        publishableKey: 'local-publishable-key',
        businessId: BUSINESS_ID,
      },
    });
    assert.equal(runtime.isProductionReady, true, supabaseUrl);
  }

  const remoteHttp = resolveRuntimeConfig({
    mode: 'production',
    repository: {
      provider: 'supabase',
      supabaseUrl: 'http://supabase.example.test',
      publishableKey: 'publishable-key',
      businessId: BUSINESS_ID,
    },
  });
  assert.equal(remoteHttp.isProductionReady, false);
  assert.match(remoteHttp.errors.join(' '), /HTTPS/);
});

test('deployment productivo nunca puede apuntar a localhost', () => {
  const result = resolveRuntimeConfig({
    mode: 'production',
    repository: {
      provider: 'supabase',
      deploymentEnvironment: 'production',
      supabaseUrl: 'http://localhost:54321',
      publishableKey: 'sb_publishable_12345678',
      businessId: '00000000-0000-4000-8000-000000000001',
    },
  });
  assert.equal(result.isProductionReady, false);
  assert.ok(result.errors.some((error) => /Producción no puede apuntar/.test(error)));
});

test('sólo acepta claves públicas aptas para navegador', () => {
  for (const publishableKey of [
    'sb_publishable_browser-safe-test-key',
    legacyJwt('anon'),
  ]) {
    const runtime = resolveRuntimeConfig({
      mode: 'production',
      repository: {
        provider: 'supabase',
        supabaseUrl: 'https://la-taba.supabase.co',
        publishableKey,
        businessId: BUSINESS_ID,
      },
    });
    assert.equal(runtime.isProductionReady, true, publishableKey);
  }

  for (const publishableKey of [
    'sb_secret_server-only-test-key',
    'sb_unknown_not-browser-safe',
    legacyJwt('service_role'),
    legacyJwt('supabase_admin'),
    'header.not-valid-base64.signature',
  ]) {
    const runtime = resolveRuntimeConfig({
      mode: 'production',
      repository: {
        provider: 'supabase',
        supabaseUrl: 'https://la-taba.supabase.co',
        publishableKey,
        businessId: BUSINESS_ID,
      },
    });
    assert.equal(runtime.isProductionReady, false, publishableKey);
    assert.match(runtime.errors.join(' '), /pública|privilegiada/i);
  }
});

test('catálogo productivo comienza bloqueado y sólo el adapter puede marcarlo listo', () => {
  assert.equal(isProductionCatalogReady(), false);
  assert.equal(setProductionCatalogReady(true), true);
  assert.equal(isProductionCatalogReady(), true);
});
