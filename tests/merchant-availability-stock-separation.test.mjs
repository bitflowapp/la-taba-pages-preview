import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationSql = fs.readFileSync(new URL(
  '../supabase/migrations/20260918010000_merchant_availability_separate_from_stock.sql',
  import.meta.url,
), 'utf8');

test('merchant_available: la columna existe, tiene default true y es no nula', () => {
  assert.match(migrationSql, /alter table public\.products\s+add column if not exists merchant_available boolean not null default true;/i);
  assert.match(migrationSql, /update public\.products\s+set merchant_available = available;/i);
});

test('merchant_available: el check constraint exige merchant_available cuando available es true', () => {
  const checkSection = migrationSql.slice(
    migrationSql.indexOf('products_available_requires_verification'),
    migrationSql.indexOf('comment on constraint products_available_requires_verification'),
  );
  assert.match(checkSection, /not available/i);
  assert.match(checkSection, /merchant_available/i);
  assert.match(checkSection, /is_verified/i);
  assert.match(checkSection, /is_active/i);
  assert.match(checkSection, /stock > 0/i);
});

test('merchant_available: set_commercial_product_publication persiste la intención del comerciante', () => {
  const func = migrationSql.slice(
    migrationSql.indexOf('create or replace function public.set_commercial_product_publication'),
    migrationSql.indexOf('create or replace function public.unpublish_catalog_product'),
  );
  // Rama ocultar:
  assert.match(func, /set available = false,\s+merchant_available = false/);
  // Rama publicar:
  assert.match(func, /set available = true,\s+merchant_available = true/);
});

test('merchant_available: unpublish_catalog_product apaga merchant_available', () => {
  const func = migrationSql.slice(
    migrationSql.indexOf('create or replace function public.unpublish_catalog_product'),
    migrationSql.indexOf('create or replace function public.release_checkout_session_inventory'),
  );
  assert.match(func, /available = false/);
  assert.match(func, /merchant_available = false/);
});

test('merchant_available: release_checkout_session_inventory no reactiva productos ocultados por el comerciante', () => {
  const releaseFunc = migrationSql.slice(
    migrationSql.indexOf('create or replace function public.release_checkout_session_inventory'),
    migrationSql.indexOf('create or replace function public.release_expired_stock_reservations'),
  );
  assert.match(releaseFunc, /p\.merchant_available\s+and\s+p\.is_active\s+and\s+p\.is_verified/);
});

test('merchant_available: release_expired_stock_reservations no reactiva productos ocultados por el comerciante', () => {
  const expiredFunc = migrationSql.slice(
    migrationSql.indexOf('create or replace function public.release_expired_stock_reservations'),
  );
  assert.match(expiredFunc, /p\.merchant_available\s+and\s+p\.is_verified\s+and\s+p\.is_active/);
});
