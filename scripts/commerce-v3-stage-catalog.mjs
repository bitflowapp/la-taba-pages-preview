// Replicate verified merchandise into the existing test business only.
// Default: full transactional dry-run followed by ROLLBACK. No payment APIs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { conToken } from './lib/supabase-cli-token.mjs';
import { createSupabaseAuthService } from '../js/services/supabase-auth.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCE = 'wwcpogltfgzgkrlilbcd';
const TARGET = 'ukxqbgswjlibmnjemrzd';
const SOURCE_BUSINESS = '00000000-0000-4000-8000-000000000001';
const TARGET_BUSINESS = '3537d949-d76b-410d-be89-e4f447546e29';
const apply = process.argv.includes('--apply-staging-catalog');
assert.notEqual(SOURCE, TARGET);
const literal = (value) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const pick = (row, keys) => Object.fromEntries(keys.map((key) => [key, row[key]]));

await conToken(async (token) => {
  async function query(project, sql) {
    assert.ok([SOURCE, TARGET].includes(project));
    if (project === SOURCE) assert.match(sql, /^begin read only;/i);
    const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: sql }), signal: AbortSignal.timeout(120000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`Catalog operation rejected (${response.status}): ${String(data.message || data.error || '').slice(0, 1200)}`);
    return data;
  }
  const predicate = `business_id='${SOURCE_BUSINESS}' and available and is_active and is_verified and price>0 and stock>0 and not is_alcoholic`;
  const source = (await query(SOURCE, `begin read only; select jsonb_build_object(
    'products',(select jsonb_agg(to_jsonb(p)) from public.products p where ${predicate}),
    'assets',(select jsonb_agg(to_jsonb(a)) from public.catalog_assets a where id in(select catalog_asset_id from public.products where ${predicate}))) as catalog; commit;`))[0].catalog;
  assert.ok(source.products.length > 0 && source.products.length <= 100);
  const assetById = new Map(source.assets.map((asset) => [asset.id, asset]));
  for (const product of source.products) {
    assert.equal(product.business_id, SOURCE_BUSINESS);
    assert.equal(product.is_alcoholic, false);
    const asset = assetById.get(product.catalog_asset_id);
    assert.ok(asset && asset.sku === product.sku && asset.external_id === product.external_id);
    for (const kind of ['master', 'thumbnail']) {
      const relative = asset[`${kind}_path`];
      assert.match(relative, /^assets\/products\/[a-z0-9_-]+\.webp$/);
      const bytes = fs.readFileSync(path.join(ROOT, relative));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), asset[`${kind}_sha256`], relative);
    }
  }
  const products = source.products.map((product) => pick(product, [
    'external_id', 'sku', 'name', 'brand', 'description', 'category', 'subcategory', 'variant',
    'capacity_value', 'capacity_unit', 'packaging_type', 'units_per_pack', 'price', 'stock',
    'sort_order', 'is_alcoholic', 'minimum_age', 'tags', 'chilled', 'is_active',
  ]));
  const assets = source.assets.map((asset) => pick(asset, [
    'external_id', 'sku', 'safe_sku', 'identity_sha256', 'master_path', 'master_sha256',
    'master_binding_sha256', 'master_width', 'master_height', 'thumbnail_path', 'thumbnail_sha256',
    'thumbnail_binding_sha256', 'thumbnail_width', 'thumbnail_height', 'source_sha256',
    'source_url', 'rights_status', 'rights_reference',
  ]));
  const keysResponse = await fetch(`https://api.supabase.com/v1/projects/${TARGET}/api-keys`, { headers: { Authorization: `Bearer ${token}` } });
  assert.ok(keysResponse.ok, 'staging administrative test setup requires available credentials');
  const keys = await keysResponse.json();
  const adminKey = keys.find((key) => key.name === 'service_role')?.api_key;
  const publicKey = keys.find((key) => key.name === 'anon')?.api_key;
  assert.ok(adminKey && publicKey, 'staging Auth keys unavailable');
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const admin = createClient(`https://${TARGET}.supabase.co`, adminKey, options);
  const client = createClient(`https://${TARGET}.supabase.co`, publicKey, options);
  const email = `commerce-catalog-${randomUUID()}@example.invalid`;
  const password = `Taba-V3!${randomBytes(24).toString('base64url')}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { taba_actor: 'team', test_actor: 'commerce-v3-catalog-replication' } });
  assert.ok(!created.error && created.data.user?.id, 'could not create isolated staging test identity');
  const actor = created.data.user.id;
  let applied = false;
  try {
    await query(TARGET, `begin; insert into public.business_members(business_id,user_id,role,is_active) values('${TARGET_BUSINESS}','${actor}','owner',true); commit;`);
    const auth = createSupabaseAuthService({ client, businessId: TARGET_BUSINESS, deviceLabel: 'Commerce V3 catalog test', appVersion: 'commerce-v3' });
    const access = await auth.signInTeam({ email, password, requiredRole: 'owner' });
    assert.ok(access.ok && access.sessionId, 'real GoTrue and registered business session required');
    const claims = JSON.parse(Buffer.from(access.session.access_token.split('.')[1], 'base64url').toString());
    assert.equal(claims.sub, actor);
    assert.equal(claims.session_id, access.sessionId);
    const sql = `begin;
    set local lock_timeout='5s'; set local statement_timeout='90s';
    create temp table commerce_before as select
      (select count(*) from public.orders) as orders,
      (select md5(coalesce(jsonb_agg(to_jsonb(s) order by business_id)::text,'')) from public.business_payment_settings s) as payments,
      (select count(*) from public.business_members where business_id='${TARGET_BUSINESS}' and is_active) as members;
    -- Claims come from a real GoTrue session, registered by the normal panel flow.
    select set_config('request.jwt.claim.sub','${actor}',true);
    select set_config('request.jwt.claim.role','authenticated',true);
    select set_config('request.jwt.claims',(${literal(claims)})::text,true);
    select * from public.register_catalog_assets('${TARGET_BUSINESS}',${literal(assets)});
    select * from public.stage_catalog_products('${TARGET_BUSINESS}',${literal(products)});
    update public.products set catalog_origin='commercial' where business_id='${TARGET_BUSINESS}'
      and external_id in(select value->>'external_id' from jsonb_array_elements(${literal(products)}));
    do $verify$
    declare item jsonb; actual public.products%rowtype;
    begin
      for item in select value from jsonb_array_elements(${literal(products)}) loop
        perform public.publish_catalog_product('${TARGET_BUSINESS}',item->>'external_id',true);
        select * into actual from public.products where business_id='${TARGET_BUSINESS}' and external_id=item->>'external_id';
        if not actual.available or not actual.is_verified or actual.price <> (item->>'price')::numeric or actual.stock <> (item->>'stock')::integer then
          raise exception 'Replica does not match the verified source';
        end if;
      end loop;
    end;$verify$;
    delete from public.business_members where business_id='${TARGET_BUSINESS}' and user_id='${actor}';
    do $safety$ begin
      if public.has_business_role('${TARGET_BUSINESS}',array['owner','admin','staff']) then raise exception 'Temporary actor retained privileges'; end if;
      if (select count(*) from public.orders) <> (select orders from commerce_before) then raise exception 'Orders changed'; end if;
      if (select md5(coalesce(jsonb_agg(to_jsonb(s) order by business_id)::text,'')) from public.business_payment_settings s) is distinct from (select payments from commerce_before) then raise exception 'Payment settings changed'; end if;
      if (select count(*) from public.business_members where business_id='${TARGET_BUSINESS}' and is_active) <> (select members-1 from commerce_before) then raise exception 'Unexpected memberships changed'; end if;
    end;$safety$;
    select jsonb_build_object('products',${products.length},'assets',${assets.length},'source','verified production catalog, read only','target','staging only','applied',${apply},'orders_changed',false,'payment_settings_changed',false,'temporary_privileges_revoked',true) as result;
    ${apply ? 'commit' : 'rollback'};`;
    const result = await query(TARGET, sql);
    applied = apply;
    console.log(JSON.stringify(result));
  } finally {
    // On a dry-run the role deletion also rolled back. Always revoke it again.
    await query(TARGET, `begin; delete from public.business_members where business_id='${TARGET_BUSINESS}' and user_id='${actor}'; commit;`);
    await client.auth.signOut();
    if (applied) {
      // Asset provenance references this user. Keep the audit identity, with no
      // business privileges and with authentication disabled; never expose it.
      const banned = await admin.auth.admin.updateUserById(actor, { ban_duration: '87600h' });
      assert.ok(!banned.error, 'could not disable the staging provenance actor');
    } else {
      const removed = await admin.auth.admin.deleteUser(actor);
      assert.ok(!removed.error, 'could not clean up the staging test actor');
    }
  }
});
