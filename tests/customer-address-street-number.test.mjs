import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { splitStreetAndNumber } from '../js/core/address.js';
import { validateRequiredStreetNumber } from '../js/core/validators.js';
import { createSupabaseCustomerProfileRepository } from '../js/repositories/customer_profile_repository.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260729190000_customer_address_street_number_required.sql'),
  'utf8',
);
const customerAddressMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260728090000_customer_profiles_addresses.sql'),
  'utf8',
);

test('la captura combinada conserva número con letra y S/N explícito', () => {
  assert.deepEqual(splitStreetAndNumber('Roca 1234 A'), {
    street: 'Roca',
    streetNumber: '1234 A',
  });
  assert.deepEqual(splitStreetAndNumber('Roca S/N'), {
    street: 'Roca',
    streetNumber: 'S/N',
  });
});

test('el contrato frontend rechaza ausentes y vacíos sin inventar S/N', () => {
  for (const value of [null, undefined, '', '   ']) {
    const result = validateRequiredStreetNumber(value);
    assert.equal(result.ok, false, String(value));
    assert.match(result.message, /número/i);
  }
  for (const value of [' 1234 ', ' 1234 A ', ' Lote 4 ', ' S/N ']) {
    const result = validateRequiredStreetNumber(value);
    assert.equal(result.ok, true, value);
    assert.equal(result.streetNumber, value.trim());
  }
});

test('el repositorio acepta números explícitos y la migración rechaza sólo vacíos activos', async () => {
  const calls = [];
  const repository = createSupabaseCustomerProfileRepository({
    authService: { async ensureCustomerSession() { return { ok: true }; } },
    client: {
      async rpc(name, args) {
        calls.push({ name, args });
        return { data: { ok: true, address: { id: 'address-1', ...args.p_address } }, error: null };
      },
    },
  });

  for (const streetNumber of ['1234', '1234 A', 'Lote 4', 'S/N']) {
    const result = await repository.saveAddress({
      label: 'Casa',
      street: 'Roca',
      streetNumber,
      city: 'Neuquén',
    });
    assert.equal(result.ok, true, streetNumber);
  }

  assert.equal(calls.length, 4);
  assert.match(migration, /customer_addresses_active_street_number_required/i);
  assert.match(
    migration,
    /deleted_at is not null[\s\S]*char_length\(btrim\(coalesce\(street_number, ''\)\)\) between 1 and 24/i,
  );
  assert.match(migration, /not valid/i);
  assert.doesNotMatch(migration, /create\s+(?:or\s+replace\s+)?function/i);
});

test('el repositorio no invoca la RPC con un número de calle inválido', async () => {
  let calls = 0;
  const repository = createSupabaseCustomerProfileRepository({
    authService: { async ensureCustomerSession() { return { ok: true }; } },
    client: { async rpc() { calls += 1; return { data: null, error: null }; } },
  });
  for (const streetNumber of [null, undefined, '', '   ']) {
    const result = await repository.saveAddress({
      label: 'Casa', street: 'Roca', streetNumber, city: 'Neuquén',
    });
    assert.equal(result.ok, false, String(streetNumber));
    assert.equal(result.code, 'validation');
  }
  assert.equal(calls, 0);
});

test('la corrección conserva la RPC autenticada y el aislamiento de direcciones', () => {
  assert.match(customerAddressMigration, /create or replace function public\.upsert_current_customer_address/i);
  assert.match(customerAddressMigration, /v_customer_id uuid := auth\.uid\(\)/i);
  assert.match(customerAddressMigration, /set search_path = pg_catalog, public, extensions, pg_temp/i);
  assert.match(customerAddressMigration, /where a\.id = v_address_id[\s\S]*and a\.customer_id = v_customer_id/i);
  assert.match(customerAddressMigration, /enable row level security/i);
  assert.doesNotMatch(migration, /\bdelete\s+from\b|\bupdate\s+public\.customer_addresses\b/i);
});
