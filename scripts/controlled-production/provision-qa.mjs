// QA identities and QA catalog of CONTROLLED_PRODUCTION, idempotent.
// Only the two QA businesses receive QA members/products; the real business
// stays with no members, no products and closed. Passwords live only in
// Windows Credential Manager. Roles are granted by request + approval, except
// the first owner of each QA business (nobody exists yet to approve it).
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { generarContrasena, guardarSecreto, leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { loadTargetKeys } from './target-keys.mjs';
import { bootstrapFirstOwner, clients, createAccount, ensureQaMember, signIn } from './accounts.mjs';
import { CP_BUSINESSES, seedBusinesses } from './seed-businesses.mjs';

const OPTIONS = { auth: { persistSession: false, autoRefreshToken: false } };
const keys = await loadTargetKeys('controlled-production');
const { admin, anon } = clients(keys);

async function qaOwner(credentialName, email, fullName, businessId) {
  let stored = leerSecreto(credentialName);
  if (stored?.usuario !== email) {
    const password = generarContrasena(32);
    const { user, created } = await createAccount(admin, { email, fullName, qa: true, password });
    if (!created) {
      assert.ok(user.user_metadata?.taba_qa === true, 'QA_OWNER_EMAIL_NOT_QA');
      const reset = await admin.auth.admin.updateUserById(user.id, { password });
      assert.ifError(reset.error);
    }
    guardarSecreto(credentialName, email, password);
    stored = leerSecreto(credentialName);
  }
  const c = anon();
  const user = await signIn(c, stored.usuario, stored.secreto);
  return { c, id: user.id, businessId };
}

async function panel(owner) {
  const reg = await owner.c.rpc('identity_register_session', { p_business_id: owner.businessId, p_client: 'panel_web',
    p_device_label: 'CP QA provisioning', p_device_key_hash: null, p_app_version: 'cp-qa' });
  assert.ok(reg.data?.ok && ['owner', 'admin'].includes(reg.data.role), `OWNER_PANEL_SESSION:${reg.error?.code || reg.data?.code}`);
}

const ownerA = await qaOwner('CP QA OWNER', 'cp.qa.owner@qa.lataba.invalid', 'QA Dueño control', CP_BUSINESSES.qaControl);
const seeded = await seedBusinesses({ verifiedBy: ownerA.id });
await bootstrapFirstOwner(admin, { businessId: CP_BUSINESSES.qaControl, userId: ownerA.id, fullName: 'QA Dueño control' });
await panel(ownerA);
const staffA = await ensureQaMember({ keys, businessId: CP_BUSINESSES.qaControl, reviewerClient: ownerA.c, credentialName: 'CP QA STAFF',
  email: 'cp.qa.staff@qa.lataba.invalid', fullName: 'QA Personal control', access: 'panel', role: 'staff' });
const riders = [];
for (let n = 1; n <= 3; n += 1) {
  riders.push(await ensureQaMember({ keys, businessId: CP_BUSINESSES.qaControl, reviewerClient: ownerA.c,
    credentialName: `CP QA RIDER ${n}`, email: `cp.qa.rider${n}@qa.lataba.invalid`, fullName: `QA Rider ${n}`,
    access: 'rider', role: 'rider', phone: `29955506${String(n).padStart(2, '0')}` }));
}
const ownerB = await qaOwner('CP QA B OWNER', 'cp.qa.b.owner@qa.lataba.invalid', 'QA Dueño aislamiento', CP_BUSINESSES.qaIsolation);
await bootstrapFirstOwner(admin, { businessId: CP_BUSINESSES.qaIsolation, userId: ownerB.id, fullName: 'QA Dueño aislamiento' });
await panel(ownerB);
const staffB = await ensureQaMember({ keys, businessId: CP_BUSINESSES.qaIsolation, reviewerClient: ownerB.c, credentialName: 'CP QA B STAFF',
  email: 'cp.qa.b.staff@qa.lataba.invalid', fullName: 'QA Personal aislamiento', access: 'panel', role: 'staff' });

// QA catalog (test_only) for the control business through the fixture RPC.
const existing = await admin.from('products').select('id', { count: 'exact', head: true }).eq('business_id', CP_BUSINESSES.qaControl);
let catalog = { imported: 0, published: 0, alreadyPresent: existing.count };
if (!existing.count) {
  // QA products for the never-public control business through the commercial
  // domain path (hidden atomic import -> verification -> publication), with
  // licensed images from the audited manifest. Never the 10 commercial
  // candidates; names, prices and stock are QA values.
  const { readFileSync } = await import('node:fs');
  const { PROPOSED_PILOT_SKUS, applyPilotCatalog } = await import('../import-pilot-catalog.mjs');
  const { mapCatalogProduct } = await import('../import-product-catalog.mjs');
  const { GONDOLA } = await import('../../catalog/gondola-neuquen.mjs');
  const subcategoryOf = new Map(GONDOLA.filter((g) => g?.sku && g.subcategory).map((g) => [g.sku, g.subcategory]));
  const snapshot = JSON.parse(readFileSync('catalog/production-catalog-snapshot.json', 'utf8')).productos;
  const manifest = JSON.parse(readFileSync('docs/catalog/image-manifest.json', 'utf8')).sources;
  const picks = snapshot.filter((p) => !p.isAlcoholic && !PROPOSED_PILOT_SKUS.includes(p.sku) && subcategoryOf.has(p.sku)
    && manifest.some((m) => m.sku === p.sku && m.externalId === p.externalId && m.rightsStatus === 'LICENCIA_COMERCIAL')).slice(0, 8);
  assert.ok(picks.length >= 6, 'QA_FIXTURE_SOURCES_INSUFFICIENT');
  const prices = [1800, 2200, 2600, 3000, 3400, 3800, 4200, 5200];
  const entries = picks.map((p, i) => {
    const asset = manifest.find((x) => x.sku === p.sku && x.externalId === p.externalId);
    const mapped = mapCatalogProduct({ external_id: p.externalId, sku: p.sku, brand: p.brand, name: `QA ${p.name}`,
      variant: p.variant, category: p.category, subcategory: subcategoryOf.get(p.sku), capacity_value: p.capacityValue,
      capacity_unit: p.capacityUnit, package_type: p.packagingType, units_per_pack: p.unitsPerPack,
      price: prices[i], stock: 60, chilled: false, alcoholic: false, minimum_age: '', featured: false,
      tags: '', sort_order: i + 1, available: true }, CP_BUSINESSES.qaControl, asset);
    mapped.row.description = 'Producto QA — no público';
    return mapped;
  });
  const plan = { errors: [], entries, businessId: CP_BUSINESSES.qaControl, approvedSkus: entries.map((e) => e.row.sku) };
  const result = await applyPilotCatalog(ownerA.c, plan);
  catalog = { ...catalog, imported: result.staged, published: result.published };
}
const visible = await createClient(keys.url, keys.publishable, OPTIONS).from('products').select('sku')
  .eq('business_id', CP_BUSINESSES.qaControl).eq('available', true).eq('is_active', true).eq('is_verified', true);
const realVisible = await createClient(keys.url, keys.publishable, OPTIONS).from('products').select('sku').eq('business_id', CP_BUSINESSES.real);
console.log(JSON.stringify({ ref: keys.ref, businesses: seeded, members: { ownerA: 'owner', staffA: Boolean(staffA.userId),
  riders: riders.length, ownerB: 'owner', staffB: Boolean(staffB.userId) }, catalog,
  qaPublicProducts: visible.data?.length, realPublicProducts: realVisible.data?.length }, null, 1));
