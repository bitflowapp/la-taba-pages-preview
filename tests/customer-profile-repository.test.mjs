import assert from 'node:assert/strict';
import test from 'node:test';

import { createSupabaseCustomerProfileRepository } from '../js/repositories/customer_profile_repository.js';

test('perfil y direcciones usan RPCs del usuario autenticado, sin customer_id del navegador', async () => {
  const calls = [];
  const repository = createSupabaseCustomerProfileRepository({
    authService: { async ensureCustomerSession() { return { ok: true, user: { id: 'auth-user' } }; } },
    client: {
      async rpc(name, args) {
        calls.push({ name, args });
        if (name === 'get_current_customer_profile') {
          return { data: { profile: { id: 'auth-user', name: 'Ana', phone: '299 555 0000' }, addresses: [] }, error: null };
        }
        if (name === 'upsert_current_customer_profile') return { data: { id: 'auth-user', name: 'Ana', phone: '299 555 0000' }, error: null };
        if (name === 'upsert_current_customer_address') return { data: { ok: true, address: { id: 'address-1', label: 'Casa', street: 'Roca', streetNumber: '123', city: 'Neuquén', formattedAddress: 'Roca 123, Neuquén' } }, error: null };
        return { data: { id: 'address-1' }, error: null };
      },
    },
  });

  const loaded = await repository.load();
  const profile = await repository.saveProfile({ name: 'Ana', phone: '299 555 0000' });
  const address = await repository.saveAddress({
    label: 'Casa', street: 'Roca', streetNumber: '123', city: 'Neuquén', formattedAddress: 'Roca 123, Neuquén', lastUsedAt: '2026-07-01T00:00:00Z',
  });

  assert.equal(loaded.profile.name, 'Ana');
  assert.equal(profile.ok, true);
  assert.equal(address.address.id, 'address-1');
  assert.deepEqual(calls.map((call) => call.name), [
    'get_current_customer_profile',
    'upsert_current_customer_profile',
    'upsert_current_customer_address',
  ]);
  assert.equal('customer_id' in calls[2].args.p_address, false);
  assert.equal('lastUsedAt' in calls[2].args.p_address, false);
});

test('una dirección duplicada ofrece una decisión y no se guarda silenciosamente', async () => {
  const repository = createSupabaseCustomerProfileRepository({
    authService: { async ensureCustomerSession() { return { ok: true }; } },
    client: {
      async rpc() {
        return { data: { ok: false, code: 'duplicate', address: { id: 'home', label: 'Casa', street: 'Roca', streetNumber: '123', city: 'Neuquén' } }, error: null };
      },
    },
  });

  const result = await repository.saveAddress({ label: 'Otro', street: 'Roca', streetNumber: '123', city: 'Neuquén' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'duplicate');
  assert.equal(result.duplicate.label, 'Casa');
});

test('el repositorio rechaza streetNumber vacío antes de invocar la RPC', async () => {
  let rpcCalls = 0;
  const repository = createSupabaseCustomerProfileRepository({
    authService: { async ensureCustomerSession() { return { ok: true }; } },
    client: {
      async rpc() {
        rpcCalls += 1;
        return { data: null, error: null };
      },
    },
  });

  const result = await repository.saveAddress({
    label: 'Casa',
    street: 'Roca',
    streetNumber: '   ',
    city: 'Neuquén',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'validation');
  assert.match(result.message, /número/i);
  assert.equal(rpcCalls, 0);
});
