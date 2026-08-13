import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const identitySql = fs.readFileSync(new URL(
  '../supabase/migrations/20260814030000_identity_requires_registered_session.sql',
  import.meta.url,
), 'utf8');
const cancellationSql = fs.readFileSync(new URL(
  '../supabase/migrations/20260814040000_paid_orders_require_payment_refund.sql',
  import.meta.url,
), 'utf8');

test('la autoridad exige una sesión registrada del mismo usuario y comercio', () => {
  const memberGate = identitySql.slice(
    identitySql.indexOf('create or replace function public.identity_member_role'),
    identitySql.indexOf('create or replace function public.identity_register_session'),
  );
  assert.match(memberGate, /if v_session is null then return null/);
  assert.match(memberGate, /from public\.identity_sessions ise[\s\S]*ise\.session_id = v_session[\s\S]*ise\.user_id = v_user[\s\S]*ise\.business_id = target_business_id/);
  assert.match(memberGate, /if not found or v_revoked is not null then return null/);
});

test('el alta es el único bootstrap y no registra tokens sin session_id', () => {
  const registration = identitySql.slice(identitySql.indexOf(
    'create or replace function public.identity_register_session',
  ));
  assert.match(registration, /v_session is null[\s\S]*'not_authorized'/);
  assert.match(registration, /business_members[\s\S]*bm\.is_active = true/);
  assert.match(registration, /identity_user_security[\s\S]*v_disabled is not null/);
  assert.match(registration, /where ise\.user_id = excluded\.user_id[\s\S]*ise\.business_id = excluded\.business_id[\s\S]*ise\.revoked_at is null/);
});

test('cancel_order rechaza Mercado Pago antes de transicionar o emitir receipts', () => {
  const guardAt = cancellationSql.indexOf("lower(btrim(coalesce(v_order.payment_method, ''))) = 'mercadopago'");
  const transitionAt = cancellationSql.indexOf("public.transition_order(p_order_id, p_expected_revision, 'canceled')");
  const receiptAt = cancellationSql.indexOf('insert into public.business_command_receipts');
  assert.ok(guardAt > 0);
  assert.ok(transitionAt > guardAt);
  assert.ok(receiptAt > transitionAt);
  assert.match(cancellationSql, /create or replace function public\.order_payment_is_financially_reversed/);
  assert.match(cancellationSql, /internal_status = 'refunded'[\s\S]*refunded_amount[\s\S]*paid_amount/);
  assert.match(cancellationSql, /internal_status = 'charged_back'/);
  assert.match(cancellationSql, /not public\.order_payment_is_financially_reversed\(v_order\.id\)/);
  assert.match(cancellationSql, /order_payment_is_financially_reversed\(old\.id\)[\s\S]*solo admite cierre operativo/);
  assert.match(cancellationSql, /using errcode = '55000'/);
  assert.match(cancellationSql, /create trigger orders_prevent_paid_generic_cancellation[\s\S]*before update of status/);
  assert.match(cancellationSql, /normalize_order_status_vocabulary\(new\.status\) in \('cancelled', 'rejected'\)/);
  assert.match(cancellationSql, /revoke execute on function public\.change_order_status\(uuid, text, text\) from public, anon, authenticated/);
  assert.match(cancellationSql, /revoke execute on function public\.transition_order\(uuid, bigint, text\) from public, anon, authenticated/);
});
