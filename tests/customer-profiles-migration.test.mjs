import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260728090000_customer_profiles_addresses.sql'),
  'utf8',
);

test('la migración crea perfiles y libreta bajo auth.uid con RLS e índice de principal único', () => {
  assert.match(migration, /create table if not exists public\.customers/i);
  assert.match(migration, /id uuid primary key references auth\.users\(id\)/i);
  assert.match(migration, /create table if not exists public\.customer_addresses/i);
  assert.match(migration, /source in \('manual', 'gps', 'geocoder', 'previous_order'\)/i);
  assert.match(migration, /create unique index if not exists customer_addresses_one_default_idx[\s\S]*where is_default and deleted_at is null/i);
  assert.match(migration, /alter table public\.customers enable row level security/i);
  assert.match(migration, /alter table public\.customer_addresses enable row level security/i);
  assert.match(migration, /v_customer_id uuid := auth\.uid\(\)/i);
  assert.doesNotMatch(migration, /p_customer_id/i);
});

test('los pedidos reciben snapshots inmutables y la RPC valida una dirección propia', () => {
  for (const column of [
    'customer_address_id', 'delivery_address_formatted', 'delivery_street',
    'delivery_latitude', 'delivery_longitude', 'delivery_address_source',
  ]) assert.match(migration, new RegExp(`add column if not exists ${column}`, 'i'));

  assert.match(migration, /alter function public\.create_order_with_items\(jsonb\) rename to create_order_with_items_legacy/i);
  assert.match(migration, /from public\.customer_addresses a[\s\S]*a\.customer_id = v_customer_id/i);
  assert.match(migration, /and delivery_address_formatted is null/i);
  assert.match(migration, /on delete set null/i);
});

test('no expone escrituras directas, secretos ni logs de datos personales', () => {
  assert.match(migration, /revoke all privileges on table public\.customers from public, anon, authenticated/i);
  assert.match(migration, /revoke all privileges on table public\.customer_addresses from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /grant\s+(?:insert|update|delete)[^;]*customer_addresses/i);
  assert.doesNotMatch(migration, /service_role|eyJ[a-zA-Z0-9_-]{20,}|raise notice.*(?:telefono|direccion|latitude|longitude)/i);
});
