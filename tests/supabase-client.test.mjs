import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createConfiguredSupabaseClient,
  getSupabaseClient,
  normalizeSupabaseConfig,
  resetSupabaseClientForTests,
  validateSupabaseConfig,
} from '../js/services/supabase-client.js';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';

function legacyJwt(role) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role })}.test-signature`;
}

test.afterEach(() => {
  resetSupabaseClientForTests();
});

test('normaliza publishableKey y conserva anonKey sólo como alias compatible', () => {
  assert.deepEqual(normalizeSupabaseConfig({
    repository: {
      supabaseUrl: ' https://project.supabase.co/ ',
      publishableKey: ' preferred ',
      anonKey: 'legacy',
      businessId: ` ${BUSINESS_ID} `,
    },
  }), {
    supabaseUrl: 'https://project.supabase.co/',
    publishableKey: 'preferred',
    businessId: BUSINESS_ID,
  });

  assert.equal(normalizeSupabaseConfig({ anonKey: 'legacy' }).publishableKey, 'legacy');
});

test('valida configuración completa, businessId y HTTPS salvo Supabase local', () => {
  assert.throws(() => validateSupabaseConfig({}), /incompleta/i);
  assert.throws(() => validateSupabaseConfig({
    supabaseUrl: 'http://project.supabase.co',
    publishableKey: 'public',
    businessId: BUSINESS_ID,
  }), /HTTPS/i);
  assert.throws(() => validateSupabaseConfig({
    supabaseUrl: 'https://project.supabase.co',
    publishableKey: 'public',
    businessId: 'not-a-uuid',
  }), /businessId/i);

  assert.equal(validateSupabaseConfig({
    supabaseUrl: 'http://127.0.0.1:54321/',
    publishableKey: 'local-public',
    businessId: BUSINESS_ID,
  }).supabaseUrl, 'http://127.0.0.1:54321');
});

test('rechaza secretos y JWT privilegiados antes de crear un cliente de navegador', () => {
  const baseConfig = {
    supabaseUrl: 'https://project.supabase.co',
    businessId: BUSINESS_ID,
  };

  for (const publishableKey of [
    'sb_secret_server-only-test-key',
    'sb_unknown_not-browser-safe',
    legacyJwt('service_role'),
    legacyJwt('supabase_admin'),
    'header.not-valid-base64.signature',
  ]) {
    assert.throws(
      () => validateSupabaseConfig({ ...baseConfig, publishableKey }),
      /no es segura para navegador/i,
      publishableKey,
    );
  }

  for (const publishableKey of [
    'sb_publishable_browser-safe-test-key',
    legacyJwt('anon'),
  ]) {
    assert.equal(
      validateSupabaseConfig({ ...baseConfig, publishableKey }).publishableKey,
      publishableKey,
    );
  }
});

test('crea el cliente con sesión persistente y bundle local inyectable', () => {
  const calls = [];
  const storage = {};
  const client = createConfiguredSupabaseClient({
    supabaseUrl: 'https://project.supabase.co',
    publishableKey: 'public-key',
    businessId: BUSINESS_ID,
  }, {
    storage,
    createClientImpl: (...args) => {
      calls.push(args);
      return { marker: 'client' };
    },
  });

  assert.deepEqual(client, { marker: 'client' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'https://project.supabase.co');
  assert.equal(calls[0][1], 'public-key');
  assert.equal(calls[0][2].auth.persistSession, true);
  assert.equal(calls[0][2].auth.detectSessionInUrl, false);
  assert.equal(calls[0][2].auth.storage, storage);
});

test('cliente de tracking no persiste sesión y agrega sólo el header público', () => {
  const calls = [];
  createConfiguredSupabaseClient({
    supabaseUrl: 'https://project.supabase.co',
    publishableKey: 'public-key',
    businessId: BUSINESS_ID,
  }, {
    storage: null,
    persistSession: false,
    headers: { 'x-order-token': 'safe-public-token' },
    createClientImpl: (...args) => {
      calls.push(args);
      return {};
    },
  });

  assert.equal(calls[0][2].auth.persistSession, false);
  assert.equal('storage' in calls[0][2].auth, false);
  assert.equal(calls[0][2].global.headers['x-order-token'], 'safe-public-token');
});

test('reutiliza un único cliente mientras no cambie la configuración', () => {
  let created = 0;
  const config = {
    supabaseUrl: 'https://project.supabase.co',
    publishableKey: 'public-key',
    businessId: BUSINESS_ID,
  };
  const options = {
    storage: null,
    createClientImpl: () => ({ id: ++created }),
  };

  const first = getSupabaseClient(config, options);
  const second = getSupabaseClient(config, options);

  assert.equal(first, second);
  assert.equal(created, 1);
});
