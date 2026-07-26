import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationName = '20260725070000_catalog_category_authority.sql';
const migrationPath = path.join(root, 'supabase', 'migrations', migrationName);
const sql = fs.readFileSync(migrationPath, 'utf8');

const categories = [
  'Promos',
  'Gaseosas',
  'Aguas',
  'Jugos',
  'Energéticas',
  'Isotónicas',
  'Cervezas',
  'Vinos y espumantes',
  'Gins y vodkas',
  'Whisky y destilados',
  'Picadas y deli',
  'Hielo y extras',
];

test('catalog authority migration is ordered after alcohol hardening', () => {
  const names = fs.readdirSync(path.dirname(migrationPath))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  assert.ok(names.indexOf(migrationName) > names.indexOf('20260725060000_alcohol_reservations_abuse.sql'));
});

test('verified products accept exactly the twelve canonical beverage categories', () => {
  assert.match(sql, /products_verified_canonical_beverage_category/i);
  for (const category of categories) assert.match(sql, new RegExp(`'${category}'`, 'u'));
  assert.match(sql, /not is_verified\s+or category in/i);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.products/i);
});

test('verified alcohol metadata is coherent and existing invalid rows fail closed', () => {
  assert.match(
    sql,
    /products_verified_alcohol_coherence[\s\S]*Cervezas[\s\S]*is_alcoholic is true/i,
  );
  assert.match(sql, /category = 'Promos' and is_alcoholic is not null/i);
  assert.match(
    sql,
    /is_alcoholic is true[\s\S]*minimum_age is not null[\s\S]*between 18 and 99/i,
  );
  assert.match(sql, /is_alcoholic is false and minimum_age is null/i);
  assert.match(
    sql,
    /update public\.products[\s\S]*available = false[\s\S]*is_verified = false/i,
  );
});

test('catalog keys support a single atomic PostgREST upsert', () => {
  assert.match(
    sql,
    /create unique index products_business_external_id_key\s+on public\.products\(business_id, external_id\)/i,
  );
  assert.match(
    sql,
    /create unique index products_business_sku_key\s+on public\.products\(business_id, sku\)/i,
  );
  assert.doesNotMatch(sql, /products_business_external_id_key[\s\S]*where external_id is not null/i);
});
