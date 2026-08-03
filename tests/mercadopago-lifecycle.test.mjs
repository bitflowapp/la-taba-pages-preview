import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const foundation = fs.readFileSync(path.join(root, 'supabase/migrations/20260802090000_mercadopago_checkout_pro_foundation.sql'), 'utf8');
const lifecycle = fs.readFileSync(path.join(root, 'supabase/migrations/20260802093000_mercadopago_checkout_pro_lifecycle.sql'), 'utf8');

test('payment model has non-secret settings, sessions, reservations, intents and audit tables', () => {
  for (const table of [
    'business_payment_settings', 'checkout_sessions', 'checkout_session_items',
    'inventory_reservations', 'payment_intents', 'payment_attempts',
    'payment_events', 'payment_webhook_receipts', 'payment_refunds',
    'payment_disputes', 'payment_outbox',
  ]) {
    assert.match(foundation, new RegExp(`create table if not exists public\\.${table}`));
  }
  for (const table of ['checkout_sessions', 'inventory_reservations', 'payment_intents', 'payment_webhook_receipts', 'payment_outbox']) {
    assert.match(foundation, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.doesNotMatch(foundation, /access_token\s+(?:text|character)/i);
  assert.doesNotMatch(foundation, /webhook_secret\s+(?:text|character)/i);
});

test('lifecycle enforces authoritative stock, monotonic payment state and one paid order', () => {
  assert.match(foundation, /price_status <> 'confirmed'/);
  assert.match(foundation, /set stock = p\.stock - v_item\.quantity/);
  assert.match(lifecycle, /release_checkout_session_inventory/);
  assert.match(lifecycle, /inventory_reservations_session_product_generation_key/);
  assert.match(lifecycle, /payment_internal_status_rank/);
  assert.match(lifecycle, /security_review_required/);
  assert.match(lifecycle, /approved_after_reservation_expired/);
  assert.match(lifecycle, /finalize_paid_checkout_session/);
  assert.match(lifecycle, /insert into public\.orders/);
  assert.match(lifecycle, /insert into public\.order_items/);
  assert.match(lifecycle, /status = 'converted'/);
  assert.match(lifecycle, /completed_order_id/);
});

test('financial mutations reuse persisted idempotency keys and require owner/admin authorization', () => {
  assert.match(lifecycle, /prepare_payment_refund/);
  assert.match(lifecycle, /prepare_payment_cancellation/);
  assert.match(lifecycle, /reconciliation_required/);
  assert.match(lifecycle, /v_refund\.idempotency_key/);
  assert.match(lifecycle, /v_cancellation\.idempotency_key/);
  assert.match(lifecycle, /has_business_role\(v_intent\.business_id, array\['owner', 'admin'\]\)/);
  assert.match(lifecycle, /payment_disputes/);
  assert.match(lifecycle, /charged_back/);
});

test('production payment activation is fail-closed behind review and explicit confirmation', () => {
  const runtime = fs.readFileSync(path.join(root, 'supabase/functions/_shared/payment-runtime.ts'), 'utf8');
  assert.match(runtime, /MERCADOPAGO_PRODUCTION_REVIEW_STATUS/);
  assert.match(runtime, /MERCADOPAGO_PRODUCTION_ENABLE_CONFIRMATION/);
  assert.match(runtime, /I_UNDERSTAND_THIS_ENABLES_REAL_MERCADO_PAGO_PAYMENTS/);
});

test('isolated PostgreSQL lifecycle test certifies duplicate, reservation and payment finalization paths', () => {
  const localTest = fs.readFileSync(path.join(root, 'supabase/tests/mercadopago_checkout_pro.local.sql'), 'utf8');
  for (const wording of [
    'checkout idempotency failed', 'client supplied total was accepted',
    'operational order was created before payment', 'finalization is not idempotent',
    'finalization decremented reserved stock twice', 'duplicate webhook was not deduplicated',
    'invalid webhook entered worker queue',
  ]) {
    assert.match(localTest, new RegExp(wording));
  }
});
