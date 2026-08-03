import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  PAYMENT_ACTION_OUTCOMES,
  PAYMENT_RECOVERY_STATES,
  PAYMENT_WORKER_STATES,
  buildPaymentSupportDiagnostic,
  paymentActionOutcome,
  paymentRecoveryActions,
  paymentRecoveryCopy,
  paymentRecoveryState,
  paymentWorkerState,
  serializePaymentSupportDiagnostic,
} from '../js/payments/payment-recovery.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260803140000_payment_recovery_p0.sql'),
  'utf8',
);
const operations = fs.readFileSync(path.join(root, 'js/production-operations.js'), 'utf8');

test('approved payment without order has the exact human recovery contract', () => {
  const payment = {
    internal_status: 'approved_order_pending',
    provider_status: 'approved',
    amount: 1200,
    currency: 'ARS',
  };
  assert.equal(paymentRecoveryState(payment), PAYMENT_RECOVERY_STATES.PAYMENT_APPROVED);
  assert.deepEqual(paymentRecoveryCopy(payment), {
    label: 'Pago aprobado',
    title: 'Pago aprobado, pedido pendiente',
    message: 'El dinero está registrado y no se perdió. Estamos intentando completar el pedido de forma segura.',
  });
  assert.deepEqual(paymentRecoveryActions(payment).map((action) => action.label), [
    'Reintentar ahora', 'Actualizar estado', 'Contactar soporte',
  ]);
});

test('expired reservation never becomes an automatic order or stock action', () => {
  const payment = {
    internal_status: 'security_review_required',
    security_review_reason: 'approved_after_reservation_expired',
    provider_status: 'approved',
    reservation_state: 'expired',
    can_refund: true,
  };
  assert.equal(paymentRecoveryState(payment), PAYMENT_RECOVERY_STATES.RESERVATION_REVIEW);
  assert.equal(paymentRecoveryCopy(payment).title, 'Pago recibido, stock por revisar');
  assert.deepEqual(paymentRecoveryActions(payment).map((action) => action.label), [
    'Revisar stock', 'Preparar devolución', 'Ver pago', 'Preparar diagnóstico para soporte',
  ]);
  assert.equal(paymentActionOutcome(payment), PAYMENT_ACTION_OUTCOMES.OWNER_REVIEW);
});

test('security mismatch keeps the alert visible and blocks fulfillment actions', () => {
  const payment = {
    internal_status: 'security_review_required',
    security_review_reason: 'amount_mismatch',
    provider_status: 'approved',
    reservation_state: 'active',
  };
  assert.equal(paymentRecoveryState(payment), PAYMENT_RECOVERY_STATES.NEEDS_REVIEW);
  assert.equal(paymentRecoveryCopy(payment).title, 'Pago en revisión de seguridad');
  assert.deepEqual(paymentRecoveryActions(payment).map((action) => action.label), [
    'Ver pago', 'Preparar diagnóstico para soporte',
  ]);
  assert.equal(paymentActionOutcome(payment), PAYMENT_ACTION_OUTCOMES.OWNER_REVIEW);
  assert.equal(paymentRecoveryState({ ...payment, reservation_state: 'expired' }), PAYMENT_RECOVERY_STATES.NEEDS_REVIEW);
});

test('worker states use only the five human operational labels', () => {
  const now = Date.parse('2026-08-03T15:00:00.000Z');
  assert.equal(paymentWorkerState({ worker_status: 'processing', worker_lease_expires_at: '2026-08-03T15:01:00.000Z' }, now), PAYMENT_WORKER_STATES.NORMAL);
  assert.equal(paymentWorkerState({ worker_status: 'retry_wait', worker_next_attempt_at: '2026-08-03T15:05:00.000Z' }, now), PAYMENT_WORKER_STATES.SCHEDULED);
  assert.equal(paymentWorkerState({ worker_status: 'pending', worker_next_attempt_at: '2026-08-03T14:59:00.000Z' }, now), PAYMENT_WORKER_STATES.DELAYED);
  assert.equal(paymentWorkerState({ worker_status: 'dead_letter' }, now), PAYMENT_WORKER_STATES.ATTENTION);
  assert.equal(paymentWorkerState({ worker_status: 'processing', worker_lease_expires_at: '2026-08-03T14:59:00.000Z' }, now), PAYMENT_WORKER_STATES.NO_PROGRESS);
});

test('support diagnostic is useful and excludes secrets, cards, customer PII and raw payloads', () => {
  const payment = {
    payment_intent_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    checkout_session_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    order_id: null,
    internal_status: 'security_review_required',
    provider_status: 'approved',
    provider_status_detail: 'authorization=Bearer abc123 token=hidden',
    created_at: '2026-08-03T14:00:00.000Z',
    approved_at: '2026-08-03T14:01:00.000Z',
    last_update_at: '2026-08-03T14:02:00.000Z',
    attempt_count: 3,
    correlation_id: 'pay_abcdef123456',
    worker_status: 'failed',
    worker_attempts: 2,
    worker_last_error: 'authorization=Bearer abc123 raw_payload={"card":"4111"}',
  };
  const diagnostic = buildPaymentSupportDiagnostic(payment);
  const serialized = serializePaymentSupportDiagnostic(payment);
  assert.equal(diagnostic.payment_intent_id, payment.payment_intent_id);
  assert.equal(diagnostic.checkout_session_id, payment.checkout_session_id);
  assert.equal(diagnostic.attempt_count, 3);
  assert.equal(diagnostic.order_id, null);
  assert.doesNotMatch(serialized, /Bearer|abc123|4111|raw_payload|customer_name|phone|email/i);
  assert.match(serialized, /sanitized_error/);
});

test('P0 migration preserves exactly-once and permission boundaries', () => {
  assert.match(migration, /select \* into v_intent[\s\S]*for update/);
  assert.match(migration, /payment_outbox_reconciliation_active_key/);
  assert.match(migration, /'terminal', true/);
  assert.match(migration, /has_business_role\(p_business_id, array\['owner', 'admin', 'staff'\]\)/);
  assert.match(migration, /v_can_operate := public\.has_business_role\(p_business_id, array\['owner', 'admin'\]\)/);
  assert.match(migration, /sanitize_payment_diagnostic/);
  assert.match(migration, /approved_after_reservation_expired/);
  assert.match(migration, /payment_intent_id, topic/);
  assert.match(operations, /data-production-payment-reactivate/);
  assert.match(operations, /data-production-payment-support/);
  assert.match(operations, /<details>/);
  assert.match(operations, /Ver información técnica/);
  assert.doesNotMatch(operations, /Estado Mercado Pago/);
  assert.doesNotMatch(operations, /Solicitar refund/);
});
