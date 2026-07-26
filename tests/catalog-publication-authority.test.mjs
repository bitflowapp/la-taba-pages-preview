import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationName = '20260725110000_catalog_publication_authority.sql';
const migrationPath = path.join(root, 'supabase', 'migrations', migrationName);
const sql = fs.readFileSync(migrationPath, 'utf8');

test('catalog publication authority is ordered after the prior hardening migrations', () => {
  const migrations = fs.readdirSync(path.dirname(migrationPath))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  assert.ok(
    migrations.indexOf(migrationName)
      > migrations.indexOf('20260725100000_tracking_handoff_recovery.sql'),
  );
});

test('verified products require stable ids and a complete approved asset binding', () => {
  assert.match(sql, /products_verified_publication_authority/i);
  assert.match(sql, /external_id is not null[\s\S]*sku is not null/i);
  assert.match(sql, /variant is not null[\s\S]*capacity_value is not null[\s\S]*capacity_unit in/i);
  assert.match(sql, /presentation = variant[\s\S]*capacity = capacity_value::text/i);
  assert.match(sql, /catalog_asset_id is not null/i);
  assert.match(sql, /image_sha256 is not null[\s\S]*image_sha256 ~ '\^\[a-f0-9\]\{64\}\$'/i);
  assert.match(sql, /image_thumbnail_url is not null[\s\S]*image_thumbnail_url ~ '\^assets\/products/i);
  assert.match(
    sql,
    /image_thumbnail_sha256 is not null[\s\S]*image_thumbnail_sha256 ~ '\^\[a-f0-9\]\{64\}\$'/i,
  );
  assert.match(
    sql,
    /source_image_sha256 is not null[\s\S]*source_image_sha256 ~ '\^\[a-f0-9\]\{64\}\$'/i,
  );
});

test('asset registry binds identity, rights, HTTPS source, hashes and 400 thumbnail', () => {
  assert.match(sql, /create table if not exists public\.catalog_assets/i);
  assert.match(sql, /unique \(business_id, external_id\)/i);
  assert.match(sql, /unique \(business_id, sku\)/i);
  assert.match(sql, /thumbnail_path text not null/i);
  assert.match(sql, /thumbnail_sha256 text not null/i);
  assert.match(sql, /thumbnail_width integer not null default 400/i);
  assert.match(sql, /thumbnail_height integer not null default 400/i);
  assert.match(sql, /identity_sha256 text not null/i);
  assert.match(sql, /master_binding_sha256 text not null/i);
  assert.match(sql, /thumbnail_binding_sha256 text not null/i);
  assert.match(sql, /catalog_assets_identity_binding_valid/i);
  assert.match(sql, /catalog_image_identity_sha256/i);
  assert.match(sql, /catalog_asset_path/i);
  assert.match(sql, /catalog_asset_binding_sha256/i);
  assert.match(sql, /catalog_assets_dimensions_exact/i);
  assert.match(sql, /lower\(source_url\) ~ '\^https:\/\//i);
  assert.match(sql, /rights_status in \('PROPIO', 'LICENCIA_COMERCIAL', 'PERMISO_DOCUMENTADO'\)/i);
  assert.match(sql, /approved_at timestamptz not null/i);
  assert.match(sql, /approved_by uuid not null references auth\.users/i);
});

test('only owner/admin RPCs stage and publish with authoritative server stamps', () => {
  for (const rpc of [
    'register_catalog_assets',
    'stage_catalog_products',
    'import_catalog_batch',
    'publish_catalog_product',
    'unpublish_catalog_product',
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${rpc}`, 'i'));
  }
  assert.match(
    sql,
    /publish_catalog_product[\s\S]*has_business_role\(p_business_id, array\['owner', 'admin'\]\)/i,
  );
  assert.match(
    sql,
    /set is_verified = true[\s\S]*verified_at = statement_timestamp\(\)[\s\S]*verified_by = auth\.uid\(\)/i,
  );
  assert.match(
    sql,
    /stage_catalog_products[\s\S]*available = false[\s\S]*is_verified = false[\s\S]*verified_at = null[\s\S]*verified_by = null/i,
  );
  assert.match(sql, /revoke insert, update on table public\.products from authenticated/i);
  assert.match(
    sql,
    /grant update \(stock, available, is_active, sort_order\)[\s\S]*to authenticated/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.import_catalog_batch\(uuid, jsonb, jsonb\)[\s\S]*to authenticated/i,
  );
  assert.doesNotMatch(
    sql,
    /grant execute on function public\.(?:register_catalog_assets|stage_catalog_products)/i,
  );
});

test('full catalog import is one atomic RPC with strict non-null cardinality', () => {
  assert.match(
    sql,
    /import_catalog_batch[\s\S]*p_assets is null[\s\S]*p_products is null/i,
  );
  assert.match(
    sql,
    /v_asset_count < 1[\s\S]*v_product_count < 1[\s\S]*v_asset_count <> v_product_count/i,
  );
  assert.match(
    sql,
    /assets and products must have identical identities/i,
  );
  assert.match(
    sql,
    /register_catalog_assets\(p_business_id, p_assets\)[\s\S]*v_registered_count <> v_asset_count/i,
  );
  assert.match(
    sql,
    /return query[\s\S]*stage_catalog_products\(p_business_id, p_products\)[\s\S]*get diagnostics v_staged_count = row_count[\s\S]*v_staged_count <> v_product_count/i,
  );
});

test('master or approved asset changes automatically fail close publication', () => {
  assert.match(sql, /products_fail_close_master_change/i);
  assert.match(
    sql,
    /old\.is_verified[\s\S]*new\.variant is distinct from old\.variant[\s\S]*new\.capacity_value is distinct from old\.capacity_value[\s\S]*new\.minimum_age is distinct from old\.minimum_age/i,
  );
  assert.match(
    sql,
    /new\.available := false[\s\S]*new\.is_verified := false[\s\S]*new\.verified_at := null/i,
  );
  assert.match(
    sql,
    /update public\.products[\s\S]*is_verified = false[\s\S]*where catalog_asset_id = v_existing\.id/i,
  );
  assert.doesNotMatch(sql, /insert\s+into\s+public\.products[\s\S]*Marca QA/i);
});

test('stage and publish preserve structured variant and capacity authority', () => {
  assert.match(sql, /add column if not exists variant text/i);
  assert.match(sql, /add column if not exists capacity_value numeric/i);
  assert.match(sql, /add column if not exists capacity_unit text/i);
  assert.match(sql, /products_catalog_structured_capacity/i);
  assert.match(
    sql,
    /stage_catalog_products[\s\S]*v_variant[\s\S]*v_capacity_value[\s\S]*v_capacity_unit/i,
  );
  assert.match(
    sql,
    /insert into public\.products[\s\S]*variant,[\s\S]*capacity_value,[\s\S]*capacity_unit,/i,
  );
  assert.match(
    sql,
    /publish_catalog_product[\s\S]*invalid structured presentation or capacity/i,
  );
});

test('local numeric limits mirror explicit PostgreSQL publication and staging bounds', () => {
  assert.match(sql, /products_verified_numeric_ranges/i);
  assert.match(sql, /price <= 9999999999\.99/i);
  assert.match(sql, /stock between 0 and 2147483647/i);
  assert.match(sql, /units_per_pack between 1 and 2147483647/i);
  assert.match(sql, /sort_order between 0 and 2147483647/i);
  assert.match(
    sql,
    /stage_catalog_products[\s\S]*Invalid price format[\s\S]*Invalid numeric price[\s\S]*Invalid PostgreSQL integer range/i,
  );
});

test('legacy verified rows fail close before numeric constraints are validated', () => {
  const failCloseUpdate = sql.indexOf('update public.products\n   set available = false');
  const numericConstraint = sql.indexOf('add constraint products_verified_numeric_ranges');
  assert.ok(failCloseUpdate >= 0, 'falta el UPDATE fail-close de legado');
  assert.ok(numericConstraint > failCloseUpdate, 'el constraint no puede validarse antes del fail-close');
  const legacyBlock = sql.slice(failCloseUpdate, numericConstraint);
  assert.match(legacyBlock, /where is_verified/i);
  assert.match(legacyBlock, /sort_order is null[\s\S]*sort_order < 0/i);
  assert.match(legacyBlock, /capacity_value is null/i);
  assert.match(legacyBlock, /catalog_asset_id is null/i);
});
