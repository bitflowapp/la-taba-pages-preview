// Idempotent synthetic QA fixtures for the hosted recovery project (test only).
//  - QA A: the only tenant that may run Mercado Pago TEST flows. Closed until a QA window opens.
//  - QA B: closed isolation tenant for A/B authorization checks.
// The historical "La Taba" business (0000...0001) and its 72 private products are never touched.
// Passwords are generated here and live only in Windows Credential Manager.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { generarContrasena, guardarSecreto, leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { bootstrapFirstOwner, createAccount } from '../controlled-production/accounts.mjs';

import { RECOVERY_QA } from './provision-qa-ids.mjs';
const OPTIONS = { auth: { persistSession: false, autoRefreshToken: false } };
const target = JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--target') + 1], 'utf8'));
const read = name => {
  const stored = leerSecreto(name);
  assert.equal(stored?.usuario, target.projectRef, `${name}: credential not bound to the recovery project`);
  return stored.secreto;
};
const url = `https://${target.projectRef}.supabase.co`;
const admin = createClient(url, read('RECOVERY SUPABASE SERVICE KEY'), OPTIONS);

async function qaIdentity(credentialName, email, fullName, actor) {
  let stored = leerSecreto(credentialName);
  if (stored?.usuario !== email) {
    const password = generarContrasena(32);
    const { user, created } = await createAccount(admin, { email, fullName, actor, qa: true, password });
    if (!created) {
      assert.ok(user.user_metadata?.taba_qa === true, 'QA_EMAIL_NOT_QA');
      const reset = await admin.auth.admin.updateUserById(user.id, { password });
      assert.ifError(reset.error);
    }
    guardarSecreto(credentialName, email, password);
    stored = leerSecreto(credentialName);
  }
  const anon = createClient(url, read('RECOVERY SUPABASE ANON KEY'), OPTIONS);
  const { data, error } = await anon.auth.signInWithPassword({ email: stored.usuario, password: stored.secreto });
  assert.ifError(error);
  return { id: data.user.id };
}

const COMMON = { currency_code: 'ARS', operating_timezone: 'America/Argentina/Buenos_Aires', is_active: true,
  hours_enforced: false, delivery_zone_enforced: false, rider_presence_required: false, alcohol_sales_enabled: false,
  order_rate_limit_per_10_minutes: 20, max_pending_orders_per_customer: 5, qa_fixture: true,
  address: 'QA, no es un comercio real', delivery_enabled: false, pickup_enabled: true };

const ownerA = await qaIdentity('RECOVERY QA OWNER A', 'rec.qa.owner.a@qa.lataba.invalid', 'QA Dueño A', 'team');
const ownerB = await qaIdentity('RECOVERY QA OWNER B', 'rec.qa.owner.b@qa.lataba.invalid', 'QA Dueño B', 'team');
await qaIdentity('RECOVERY QA BUYER', 'rec.qa.buyer@qa.lataba.invalid', 'QA Comprador', 'customer');

const upsert = async row => {
  const { error } = await admin.from('businesses').upsert(row, { onConflict: 'id' });
  if (error) throw Error(`BUSINESS_UPSERT:${row.slug}:${error.code}:${error.message}`);
};
await upsert({ ...COMMON, id: RECOVERY_QA.a, name: 'QA Pagos de prueba, no público', slug: 'qa-pagos-recovery',
  status: 'closed', ordering_enabled: true, ordering_verified: true, ordering_verified_at: new Date().toISOString(),
  ordering_verified_by: ownerA.id });
await upsert({ ...COMMON, id: RECOVERY_QA.b, name: 'QA Aislamiento, no público', slug: 'qa-aislamiento-recovery',
  status: 'closed', ordering_enabled: false, ordering_verified: false });
await bootstrapFirstOwner(admin, { businessId: RECOVERY_QA.a, userId: ownerA.id, fullName: 'QA Dueño A' });
await bootstrapFirstOwner(admin, { businessId: RECOVERY_QA.b, userId: ownerB.id, fullName: 'QA Dueño B' });

// Three synthetic products with obviously fake values: stock is controlled, nothing is sold.
const QA_PRODUCTS = [
  ['QA-REC-001', 'QA Producto de prueba 1', 100, 20],
  ['QA-REC-002', 'QA Producto de prueba 2', 250, 10],
  ['QA-REC-003', 'QA Producto de prueba 3 (último en stock)', 500, 1],
];
for (const [sku, name, price, stock] of QA_PRODUCTS) {
  const existing = await admin.from('products').select('id').eq('business_id', RECOVERY_QA.a).eq('sku', sku).maybeSingle();
  if (existing.data) continue;
  const inserted = await admin.from('products').insert({ business_id: RECOVERY_QA.a, sku, name, price, stock,
    external_id: sku, brand: 'QA', category: 'Almacén', subcategory: 'QA', is_alcoholic: false, minimum_age: null,
    variant: 'unidad', presentation: 'unidad', capacity_value: 1, capacity_unit: 'unidad', capacity: '1 unidad',
    packaging_type: 'unidad', units_per_pack: 1, sort_order: 1,
    description: 'Producto sintético de QA, no es un producto real', is_active: true, available: true,
    merchant_available: true, is_verified: true, verified_at: new Date().toISOString(), verified_by: ownerA.id,
    // The only origin that allows verified products without an image; the tenant is qa_fixture and never public.
    catalog_origin: 'commercial', price_status: 'confirmed' });
  if (inserted.error) throw Error(`PRODUCT_INSERT:${sku}:${inserted.error.code}:${inserted.error.message}`);
}

const count = async (table, id) => (await admin.from(table).select('*', { count: 'exact', head: true }).eq('business_id', id)).count;
const historic = await admin.from('products').select('*', { count: 'exact', head: true }).eq('business_id', '00000000-0000-4000-8000-000000000001');
console.log(JSON.stringify({ projectRef: target.projectRef, qaA: RECOVERY_QA.a, qaB: RECOVERY_QA.b,
  productsA: await count('products', RECOVERY_QA.a), membersA: await count('business_members', RECOVERY_QA.a),
  membersB: await count('business_members', RECOVERY_QA.b), canonicalBusinessProductsUntouched: historic.count }, null, 1));
