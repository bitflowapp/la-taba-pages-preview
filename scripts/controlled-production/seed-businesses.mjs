// Idempotent business setup for CONTROLLED_PRODUCTION (service role: creating a
// business has no RPC; everything after that goes through domain RPCs).
//
//  - REAL "La Taba": closed, not ordering, 0 products. Hours, coverage, fees,
//    catalog and publication are decided by the owner (Walter) in the Panel.
//  - QA CONTROL (never public): the Staging QA operating configuration
//    (hours + declared-area delivery zones, no Mercado Pago settings) so the
//    final environment can be certified without touching the real business.
//  - QA ISOLATION (never public, closed): second tenant for A/B authorization.
//  - The canonical 0000…0001 row seeded by the first migration is deactivated.
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { loadTargetKeys } from './target-keys.mjs';

export const CP_BUSINESSES = Object.freeze({
  real: 'e7850ad2-a447-402c-8375-3fd74e9466ba',
  qaControl: 'e1d2c342-da14-421e-884f-ff38bb55f642',
  qaIsolation: 'dd515bdd-33bc-4a72-9e70-72d2ab8ae1f0',
});
const CANONICAL = '00000000-0000-4000-8000-000000000001';
const STAGING_QA = 'a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0';
const OPTIONS = { auth: { persistSession: false, autoRefreshToken: false } };
const COMMON = { currency_code: 'ARS', operating_timezone: 'America/Argentina/Buenos_Aires', is_active: true,
  hours_enforced: true, delivery_zone_enforced: true, rider_presence_required: true, alcohol_sales_enabled: false,
  order_rate_limit_per_10_minutes: 20, max_pending_orders_per_customer: 5 };

async function upsertBusiness(db, row) {
  const { error } = await db.from('businesses').upsert(row, { onConflict: 'id' });
  if (error) throw Error(`BUSINESS_UPSERT:${row.id}:${error.code}:${error.message}`);
}

export async function seedBusinesses({ verifiedBy }) {
  const cp = await loadTargetKeys('controlled-production');
  const staging = await loadTargetKeys('staging');
  const db = createClient(cp.url, cp.secret, OPTIONS);
  const stg = createClient(staging.url, staging.secret, OPTIONS);
  assert.match(verifiedBy || '', /^[0-9a-f-]{36}$/, 'QA_OWNER_ID_REQUIRED');

  const canonical = await db.from('businesses').update({ is_active: false, status: 'closed', ordering_enabled: false })
    .eq('id', CANONICAL).select('id');
  if (canonical.error) throw Error(`CANONICAL_DEACTIVATE:${canonical.error.code}`);

  await upsertBusiness(db, { ...COMMON, id: CP_BUSINESSES.real, name: 'La Taba', slug: 'la-taba-cp',
    address: 'Mendoza 827, Neuquén Capital', status: 'closed', ordering_enabled: false, ordering_verified: false,
    delivery_enabled: false, pickup_enabled: false });

  const template = (await stg.from('businesses').select('*').eq('id', STAGING_QA).single()).data;
  assert.ok(template, 'STAGING_TEMPLATE_UNAVAILABLE');
  await upsertBusiness(db, { ...COMMON, id: CP_BUSINESSES.qaControl, name: 'QA Control · no público', slug: 'qa-control-cp',
    address: 'QA — no público', status: 'open', ordering_enabled: true, ordering_verified: true,
    ordering_verified_at: new Date().toISOString(), ordering_verified_by: verifiedBy,
    delivery_enabled: true, pickup_enabled: true, delivery_fee: template.delivery_fee,
    minimum_delivery_subtotal: template.minimum_delivery_subtotal,
    delivery_max_radius_meters: template.delivery_max_radius_meters, stock_reservation_minutes: template.stock_reservation_minutes,
    abandoned_order_minutes: template.abandoned_order_minutes });
  await upsertBusiness(db, { ...COMMON, id: CP_BUSINESSES.qaIsolation, name: 'QA Aislamiento · no público',
    slug: 'qa-aislamiento-cp', address: 'QA — no público', status: 'closed', ordering_enabled: false,
    ordering_verified: false, delivery_enabled: false, pickup_enabled: false });

  // Operating template for the QA control business only (idempotent replace).
  for (const table of ['business_service_hours', 'delivery_zones']) {
    const rows = (await stg.from(table).select('*').eq('business_id', STAGING_QA)).data || [];
    const del = await db.from(table).delete().eq('business_id', CP_BUSINESSES.qaControl);
    if (del.error) throw Error(`${table}_CLEAR:${del.error.code}`);
    const copy = rows.map(({ id, created_at, updated_at, ...rest }) => ({ ...rest, business_id: CP_BUSINESSES.qaControl }));
    if (copy.length) {
      const ins = await db.from(table).insert(copy);
      if (ins.error) throw Error(`${table}_COPY:${ins.error.code}:${ins.error.message}`);
    }
  }
  const summary = {};
  for (const [label, id] of Object.entries(CP_BUSINESSES)) {
    const b = (await db.from('businesses').select('name,status,is_active,ordering_enabled').eq('id', id).single()).data;
    const hours = (await db.from('business_service_hours').select('id', { count: 'exact', head: true }).eq('business_id', id)).count;
    const zones = (await db.from('delivery_zones').select('id', { count: 'exact', head: true }).eq('business_id', id)).count;
    const products = (await db.from('products').select('id', { count: 'exact', head: true }).eq('business_id', id)).count;
    const mp = (await db.from('business_payment_settings').select('id', { count: 'exact', head: true }).eq('business_id', id)).count;
    summary[label] = { ...b, hours, zones, products, mercadoPagoSettings: mp };
  }
  return { ref: cp.ref, canonicalDeactivated: canonical.data.length === 1, ...summary };
}
