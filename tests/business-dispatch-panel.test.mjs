import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeBusinessDispatchControl,
  renderBusinessDispatchPanel,
} from '../js/business/business-dispatch-panel.js';
import {
  allowedBusinessOperationViews,
  businessOperationViewLabel,
  configureBusinessOperations,
  handleBusinessOperationsAction,
  resetBusinessOperationsForTests,
} from '../js/business/business-operations-center.js';
import { createSupabaseDispatchRepository } from '../js/repositories/supabase-dispatch-repository.js';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '33333333-3333-4333-8333-333333333333';
const RIDER_ID = '44444444-4444-4444-8444-444444444444';

test('renderer muestra Riders, timeline, bloqueo y métricas sin filtrar GPS ni PII', () => {
  const markup = renderBusinessDispatchPanel({
    role: 'staff',
    status: { phase: 'ready', message: '' },
    snapshot: dispatchSnapshot(),
  });

  assert.match(markup, /Riders ahora/);
  assert.match(markup, /Rider · 444444/);
  assert.match(markup, /Turno activo/);
  assert.match(markup, /Señal vigente/);
  assert.match(markup, /Trabajos en cola/);
  assert.match(markup, /1\.3 s/);
  assert.match(markup, /Pedido TABA-2042/);
  assert.match(markup, /Sin Rider disponible/);
  assert.match(markup, /La señal de actividad del Rider está vencida/);
  assert.match(markup, /Pedido listo: se creó el trabajo de asignación/);
  assert.match(markup, /Override manual/);
  assert.match(markup, /minlength="8"/);
  assert.match(markup, /maxlength="500"/);

  for (const forbidden of [
    'rider@example.com', '+54 11 5555 5555', 'Calle Privada 123',
    'Persona Cliente', '-34.6037', '-58.3816', 'nota privada de puerta',
  ]) assert.doesNotMatch(markup, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(markup, /customer_phone|latitude|longitude|exact_address/i);
});

test('panel no infiere elegibilidad a partir de turno, señal o capacidad', () => {
  const control = normalizeBusinessDispatchControl({
    riders: [{
      rider_user_id: RIDER_ID,
      shift_status: 'active',
      availability: 'available',
      heartbeat_status: 'fresh',
      current_active_orders: 0,
      max_concurrent_orders: 1,
    }],
    jobs: [{
      job_id: JOB_ID,
      order_id: ORDER_ID,
      status: 'queued',
      revision: 1,
    }],
  });
  assert.equal(control.riders[0].eligibility, null);

  const markup = renderBusinessDispatchPanel({
    role: 'staff',
    status: { phase: 'ready' },
    snapshot: {
      riders: [{
        rider_user_id: RIDER_ID,
        shift_status: 'active', availability: 'available', heartbeat_status: 'fresh',
        current_active_orders: 0, max_concurrent_orders: 1,
      }],
      jobs: [{ job_id: JOB_ID, order_id: ORDER_ID, status: 'queued', revision: 1 }],
      metrics: { backlog_jobs: null },
    },
  });
  assert.match(markup, /Sin evaluación/);
  assert.match(markup, /No hay candidatos autorizados por el servidor/);
  assert.match(markup, /data-dispatch-manual-override[^>]+disabled/);
  assert.match(markup, /data-dispatch-metric="backlog"><strong>—<\/strong>/);
});

test('repositorio dispatch usa sólo los dos RPC autoritativos y argumentos allowlist', async () => {
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: { server_now: '2026-08-11T12:00:00Z' }, error: null, status: 200 };
    },
  };
  const repository = createSupabaseDispatchRepository({ client, businessId: BUSINESS_ID });
  await repository.getControl();
  await repository.manualOverride({
    orderId: ORDER_ID,
    riderUserId: RIDER_ID,
    reason: 'El Rider confirmó por canal operativo.',
    idempotencyKey: 'dispatch-override-stable-0001',
    expectedJobRevision: 7,
    latitude: -34.6037,
    customerPhone: '+54 11 5555 5555',
  });

  assert.deepEqual(calls, [{
    name: 'get_business_dispatch_control',
    args: { p_business_id: BUSINESS_ID },
  }, {
    name: 'manual_override_dispatch',
    args: {
      p_business_id: BUSINESS_ID,
      p_order_id: ORDER_ID,
      p_rider_user_id: RIDER_ID,
      p_reason: 'El Rider confirmó por canal operativo.',
      p_idempotency_key: 'dispatch-override-stable-0001',
      p_expected_job_revision: 7,
    },
  }]);
});

test('acción override valida motivo, envía CAS y conserva idempotencia para el mismo intento', async () => {
  const calls = [];
  configureBusinessOperations({
    role: 'staff',
    getDispatchControl: async () => ({ ok: true, data: dispatchSnapshot() }),
    manualOverrideDispatch: async (input) => {
      calls.push(input);
      return { ok: true, data: { outcome: 'claimed' } };
    },
    onChange() {},
  });

  const target = overrideTarget({ reason: 'Cobertura confirmada por operación.', revision: 7 });
  const first = await handleBusinessOperationsAction(target);
  const second = await handleBusinessOperationsAction(target);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    orderId: ORDER_ID,
    riderUserId: RIDER_ID,
    reason: 'Cobertura confirmada por operación.',
    idempotencyKey: calls[0].idempotencyKey,
    expectedJobRevision: 7,
  });
  assert.match(calls[0].idempotencyKey, /^dispatch-override-/);
  assert.equal(calls[1].idempotencyKey, calls[0].idempotencyKey);
  resetBusinessOperationsForTests();
});

test('acción override bloquea motivo corto antes de invocar el RPC', async () => {
  let called = false;
  configureBusinessOperations({
    role: 'staff',
    manualOverrideDispatch: async () => { called = true; return { ok: true }; },
    onChange() {},
  });
  const response = await handleBusinessOperationsAction(overrideTarget({ reason: 'corto', revision: 1 }));
  assert.equal(response.ok, false);
  assert.match(response.message, /entre 8 y 500/);
  assert.equal(called, false);
  resetBusinessOperationsForTests();
});

test('vista dispatch está disponible sólo para roles del negocio con lectura de pedidos', () => {
  assert.equal(businessOperationViewLabel('dispatch'), 'Riders ahora');
  assert.equal(allowedBusinessOperationViews('staff').includes('dispatch'), true);
  assert.equal(allowedBusinessOperationViews('rider').includes('dispatch'), false);
});

function overrideTarget({ reason, revision }) {
  const controls = {
    dispatchOverrideRider: { value: RIDER_ID },
    dispatchOverrideReason: { value: reason },
  };
  const form = {
    dataset: { dispatchOverrideForm: ORDER_ID },
    querySelector(selector) {
      return controls[selector.match(/name="([^"]+)/)?.[1]] || null;
    },
  };
  const button = {
    dataset: { dispatchManualOverride: ORDER_ID, dispatchJobRevision: String(revision) },
    closest(selector) {
      if (selector === '[data-dispatch-manual-override]') return button;
      if (selector === '[data-dispatch-override-form]') return form;
      return null;
    },
  };
  return button;
}

function dispatchSnapshot() {
  return {
    server_now: '2026-08-11T12:00:00Z',
    generated_at: '2026-08-11T12:00:00Z',
    riders: [{
      rider_user_id: RIDER_ID,
      max_concurrent_orders: 1,
      assignments_last_4h: 2,
      shift: {
        status: 'active', availability: 'available', current_active_orders: 0,
        max_concurrent_orders: 1,
      },
      presence: { heartbeat_state: 'fresh', gps_state: 'fresh', accuracy_state: 'acceptable' },
      email: 'rider@example.com',
      phone: '+54 11 5555 5555',
      latitude: -34.6037,
      longitude: -58.3816,
    }],
    jobs: [{
      job_id: JOB_ID,
      order_id: ORDER_ID,
      order_code: 'TABA-2042',
      state: 'no_rider_available',
      revision: 7,
      round_no: 2,
      queued_at: '2026-08-11T11:55:00Z',
      last_failure_code: 'HEARTBEAT_STALE',
      next_attempt_at: '2026-08-11T12:00:30Z',
      candidates: [{ rider_user_id: RIDER_ID, eligible: true, score: 99800, rank: 1 }],
      timeline: [{
        event_type: 'job_queued',
        occurred_at: '2026-08-11T11:55:00Z',
        payload: { customer_name: 'Persona Cliente', exact_address: 'Calle Privada 123' },
      }, {
        event_type: 'no_rider_available',
        occurred_at: '2026-08-11T11:55:02Z',
        reason_code: 'HEARTBEAT_STALE',
      }],
      customer_name: 'Persona Cliente',
      exact_address: 'Calle Privada 123',
      customer_phone: '+54 11 5555 5555',
      notes: 'nota privada de puerta',
    }],
    metrics: {
      backlog_jobs: 1,
      no_rider_jobs: 1,
      active_riders: 1,
      stale_riders: 1,
      ready_to_job_seconds_p95: 0.1,
      job_to_first_offer_seconds_p95: 1.3,
      offer_to_accept_seconds_p95: 2.7,
      jain_fairness: 0.975,
    },
    alerts: [{
      code: 'NO_ELIGIBLE_RIDER', severity: 'warning', occurrence_count: 2,
      last_seen_at: '2026-08-11T11:55:02Z',
      evidence: { latitude: -34.6037, customer_phone: '+54 11 5555 5555' },
    }],
  };
}
