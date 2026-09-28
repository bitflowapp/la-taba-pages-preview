import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { renderCatalogEditor } from '../js/business/business-catalog-editor.js';

const product = {
  id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  sku: 'coca-cola-original-2250ml-local',
  name: 'Coca-Cola Sabor Original 2,25 L',
  brand: 'Coca-Cola',
  category: 'Gaseosas',
  packaging_type: 'Botella PET',
  capacity: '2250 ml',
  price: 0,
  price_status: 'pending',
  stock: null,
  available: false,
  is_verified: false,
  is_active: true,
  catalog_origin: 'commercial',
  image_url: null,
  catalog_asset_id: null,
};

test('owner/admin catalog editor exposes private upload and explicit image review controls', () => {
  const html = renderCatalogEditor({
    products: [product],
    imageUploads: [{
      id: '11111111-2222-4333-8444-555555555555',
      product_id: product.id,
      source_domain: 'brand.example',
      source_type: 'manufacturer',
      status: 'pending',
      license_status: 'pending',
      upload_completed_at: '2026-09-27T00:00:00Z',
      preview_url: 'https://tkanbadcglszlcyfjvpv.supabase.co/storage/v1/object/sign/private?token=redacted',
      preview_expires_at: '2099-09-27T00:00:00Z',
    }],
    canManageImages: true,
    phase: 'ready',
  });

  assert.match(html, /data-catalog-image-upload=/);
  assert.match(html, /accept="image\/jpeg,image\/png,image\/webp/);
  assert.match(html, /data-catalog-image-rights-status/);
  assert.match(html, /data-catalog-image-rights-reference/);
  assert.match(html, /data-catalog-image-approve=/);
  assert.match(html, /data-catalog-image-reject=/);
  assert.match(html, /La imagen queda privada hasta que un owner\/admin apruebe/);
  assert.match(html, /Precio pendiente/);
  assert.match(html, /Sin contar/);
  assert.doesNotMatch(html, /data-catalog-publication=.*data-publish="true"/);
});

test('staff and non-editor views get no upload or review controls', () => {
  const html = renderCatalogEditor({ products: [product], canManageImages: false, phase: 'ready' });
  assert.doesNotMatch(html, /data-catalog-image-upload=/);
  assert.doesNotMatch(html, /data-catalog-image-approve=/);
  assert.doesNotMatch(html, /data-catalog-image-reject=/);
});

test('browser image repository uploads only to the private staging bucket using signed URLs', () => {
  const source = fs.readFileSync(new URL('../js/repositories/supabase-catalog-image-repository.js', import.meta.url), 'utf8');
  assert.match(source, /uploadToSignedUrl/);
  assert.match(source, /from\('catalog-image-staging'\)/);
  assert.doesNotMatch(source, /from\('catalog-images'\)\s*\.upload/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|service_role|sb_secret_/i);
});

test('Edge Function requires JWT and owner/admin membership; Storage does not grant browser writes', () => {
  const edge = fs.readFileSync(new URL('../supabase/functions/catalog-image-manager/index.ts', import.meta.url), 'utf8');
  const sql = fs.readFileSync(new URL('../supabase/migrations/20260927175058_catalog_image_storage_pipeline.sql', import.meta.url), 'utf8');
  const config = fs.readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  assert.match(config, /\[functions\.catalog-image-manager\]\s*verify_jwt = true/);
  assert.match(edge, /auth\.getUser\(\)/);
  assert.match(edge, /roles: \['owner', 'admin'\]/);
  assert.match(edge, /createSignedUrl\(row\.staging_master_path, SIGNED_PREVIEW_SECONDS\)/);
  assert.match(sql, /review_previewed_by is distinct from p_actor_user_id/);
  assert.match(sql, /review_previewed_at < statement_timestamp\(\) - interval '5 minutes'/);
  assert.match(sql, /catalog_image_uploads_owner_admin_read[\s\S]*has_business_role\(business_id, array\['owner', 'admin'\]\)/);
  assert.match(sql, /create policy catalog_image_staging_service_role_only[\s\S]*to service_role/);
  assert.match(sql, /create policy catalog_images_service_role_only[\s\S]*to service_role/);
  const storagePolicies = [...sql.matchAll(/create policy[\s\S]*?;/gi)].map((match) => match[0]);
  assert.equal(storagePolicies.some((policy) => /catalog-image-(?:staging|images)/i.test(policy) && /\bto\s+anon\b/i.test(policy)), false);
});

test('image approval updates only image metadata and never publishes a product', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20260927175058_catalog_image_storage_pipeline.sql', import.meta.url), 'utf8');
  const edge = fs.readFileSync(new URL('../supabase/functions/catalog-image-manager/index.ts', import.meta.url), 'utf8');
  const body = sql.split('create or replace function public.approve_catalog_image_upload(')[1];
  assert.ok(body);
  const update = body.match(/update public\.products\s+set([\s\S]*?)\s+where id = v_product\.id/i)?.[1];
  const updateStatement = body.match(/update public\.products[\s\S]*?;/i)?.[0] || '';
  assert.ok(update, 'the approval RPC must update the exact catalog product');
  assert.ok(updateStatement);
  const fields = [...update.matchAll(/\b([a-z_][a-z0-9_]*)\s*=/gi)].map((match) => match[1].toLowerCase());
  assert.deepEqual(fields, [
    'catalog_asset_id', 'image_url', 'image_sha256', 'image_thumbnail_url',
    'image_thumbnail_sha256', 'source_image_sha256',
  ]);
  assert.match(updateStatement, /and not available\s+and not is_verified/i);
  assert.doesNotMatch(edge, /publish_catalog_product|set_commercial_product_publication|apply_commercial_catalog_batch/);
});

test('the first approval hands an approved row to the Storage step (no retry needed)', () => {
  const edge = fs.readFileSync(new URL('../supabase/functions/catalog-image-manager/index.ts', import.meta.url), 'utf8');
  const approve = edge.slice(edge.indexOf('async function approveUpload'), edge.indexOf('async function resumeApprovedUpload'));
  const handoff = approve.slice(approve.indexOf('return publishApprovedObjects'));
  assert.ok(handoff.length > 0);
  // publishApprovedObjects rejects any row whose status is not 'approved'. Until
  // 2026-09-28 the merged row kept the pre-RPC 'pending', so every first approval
  // ended in IMAGE_ASSOCIATION_CHANGED without public objects.
  assert.match(handoff, /(?<![a-z_])status:\s*'approved'/);
  assert.match(handoff, /license_status:\s*'approved'/);
  const publish = edge.slice(edge.indexOf('async function publishApprovedObjects'), edge.indexOf('async function rejectUpload'));
  assert.match(publish, /row\.status !== 'approved'/);
});

test('public Storage objects are created only after the approval RPC succeeds and can be retried safely', () => {
  const edge = fs.readFileSync(new URL('../supabase/functions/catalog-image-manager/index.ts', import.meta.url), 'utf8');
  const approve = edge.slice(edge.indexOf('async function approveUpload'), edge.indexOf('async function resumeApprovedUpload'));
  assert.ok(approve.indexOf("rpc('approve_catalog_image_upload'") >= 0);
  assert.ok(approve.indexOf("rpc('approve_catalog_image_upload'") < approve.indexOf('publishApprovedObjects'));
  assert.match(edge, /if \(row\.status === 'approved'\) return resumeApprovedUpload/);
  assert.match(edge, /previous_master_path/);
  assert.match(edge, /cleanup_status: cleanup \? 'complete' : 'retry_needed'/);
});
