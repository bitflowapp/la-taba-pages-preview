import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  alertLibrarySnapshot,
  containsForbiddenVocabulary,
  describeMetrics,
  describeOperationalAlert,
  humanizeFailure,
  METRIC_LIBRARY,
  sortAlertsByUrgency,
  summarizeOperation,
} from '../js/business/business-operation-language.js';

function alert(code, overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    code,
    severity: 'CRITICAL',
    status: 'open',
    correlation_id: 'abcdef01-2345-4678-8abc-def012345678',
    last_seen_at: '2026-08-04T12:00:00.000Z',
    occurrence_count: 1,
    ...overrides,
  };
}

test('cada alerta responde qué pasó, qué se conserva, riesgo, acción y botón seguro', () => {
  const described = describeOperationalAlert(alert('PAYMENT_APPROVED_WITHOUT_ORDER'));
  assert.ok(described.happened.length > 10);
  assert.ok(described.preserved.length > 10);
  assert.ok(described.risk.length > 10);
  assert.ok(described.recommendation.length > 10);
  assert.equal(described.action.view, 'payments');
  assert.ok(described.action.label);
  assert.equal(described.severityLabel, 'Frená y resolvé ahora');
});

test('el identificador técnico existe pero queda separado del texto operativo', () => {
  const described = describeOperationalAlert(alert('FISCAL_OUTBOX_STALLED'));
  assert.equal(described.support.reference, 'TABA-ARCA-02');
  assert.equal(described.support.trace, 'ABCDEF01');
  for (const field of [described.happened, described.preserved, described.risk, described.recommendation]) {
    assert.ok(!field.includes('TABA-ARCA-02'));
    assert.ok(!field.includes('ABCDEF01'));
  }
});

test('ningún texto operativo usa el vocabulario interno prohibido', () => {
  const codes = alertLibrarySnapshot().map((entry) => entry.code).concat(['UNKNOWN_CODE']);
  for (const code of codes) {
    const described = describeOperationalAlert(alert(code, { severity: 'ACTION_REQUIRED' }));
    const surfaces = [
      described.happened, described.preserved, described.risk,
      described.recommendation, described.action.label, described.severityLabel, described.statusLabel,
    ];
    for (const surface of surfaces) {
      assert.deepEqual(containsForbiddenVocabulary(surface), [], `${code} filtró jerga en: ${surface}`);
    }
  }
});

test('las tarjetas del centro de operación también hablan en castellano llano', () => {
  const cards = describeMetrics({ new_orders: 3, delayed_orders: 0 });
  for (const card of cards) {
    assert.deepEqual(containsForbiddenVocabulary(card.label), []);
    assert.deepEqual(containsForbiddenVocabulary(card.hint), []);
  }
  assert.equal(cards.find((card) => card.key === 'new_orders').needsAttention, true);
  assert.equal(cards.find((card) => card.key === 'delayed_orders').needsAttention, false);
  assert.equal(cards.length, METRIC_LIBRARY.length);
});

test('una alerta de servicio degradado no cae en el texto genérico', () => {
  const described = describeOperationalAlert(alert('PAYMENT_WORKER_DEGRADED', { subject_type: 'service_health', severity: 'WARNING' }));
  assert.equal(described.support.reference, 'TABA-SERV-01');
  assert.equal(described.action.view, 'day-open');
});

test('las alertas se ordenan por urgencia y no por orden de llegada', () => {
  const sorted = sortAlertsByUrgency([
    alert('RIDER_SIGNAL_STALE', { severity: 'WARNING', last_seen_at: '2026-08-04T13:00:00.000Z' }),
    alert('PRINT_JOB_FAILED', { severity: 'ACTION_REQUIRED', last_seen_at: '2026-08-04T11:00:00.000Z' }),
    alert('PAYMENT_APPROVED_WITHOUT_ORDER', { severity: 'CRITICAL', last_seen_at: '2026-08-04T10:00:00.000Z' }),
  ]);
  assert.deepEqual(sorted.map((entry) => entry.severity), ['CRITICAL', 'ACTION_REQUIRED', 'WARNING']);
});

test('el resumen distingue frenar, atender y estar al día', () => {
  assert.equal(summarizeOperation({ alerts: [alert('PAYMENT_APPROVED_WITHOUT_ORDER')] }).tone, 'critical');
  assert.equal(summarizeOperation({ alerts: [alert('PRINT_JOB_FAILED', { severity: 'ACTION_REQUIRED' })] }).tone, 'attention');
  assert.equal(summarizeOperation({ alerts: [] }).tone, 'calm');
  assert.deepEqual(containsForbiddenVocabulary(summarizeOperation({ alerts: [] }).headline), []);
});

test('los errores técnicos se reemplazan por una frase utilizable en el mostrador', () => {
  const fallback = 'No se pudo completar la acción. Volvé a intentar en un momento.';
  assert.equal(humanizeFailure('at Object.<anonymous> (/app/js/x.js:12:3)'), fallback);
  assert.equal(humanizeFailure('permission denied for function rpc_x'), fallback);
  assert.equal(humanizeFailure('El pedido ya fue entregado.'), 'El pedido ya fue entregado.');
  assert.equal(humanizeFailure(''), fallback);
  assert.equal(humanizeFailure('x'.repeat(400)), fallback);
});

test('la referencia de soporte es única por tipo de alerta', () => {
  const references = alertLibrarySnapshot().map((entry) => entry.support);
  assert.equal(new Set(references).size, references.length);
});

test('ninguna gravedad de ninguna alerta filtra vocabulario interno', () => {
  // La prueba de arriba mira una sola gravedad; el texto ahora puede cambiar con la gravedad.
  for (const { code } of alertLibrarySnapshot()) {
    for (const severity of ['INFO', 'WARNING', 'ACTION_REQUIRED', 'CRITICAL']) {
      const described = describeOperationalAlert(alert(code, { severity }));
      for (const surface of [described.happened, described.preserved, described.risk, described.recommendation, described.action.label]) {
        assert.deepEqual(containsForbiddenVocabulary(surface), [], `${code}/${severity} filtró jerga en: ${surface}`);
        assert.ok(surface.length > 5, `${code}/${severity} quedó sin texto`);
      }
    }
  }
});

test('una compra abandonada que Mercado Pago sigue sin registrar se cuenta como información, no como emergencia', () => {
  // 20261024010000: la gravedad INFO significa que la verificación funciona y no hay ningún pago.
  const watching = describeOperationalAlert(alert('CHECKOUT_PROVIDER_UNVERIFIED', { severity: 'INFO' }));
  assert.equal(watching.severityLabel, 'Para tu información');
  assert.match(watching.happened, /no terminó/);
  assert.match(watching.recommendation, /No hace falta/);
  const unverified = describeOperationalAlert(alert('CHECKOUT_PROVIDER_UNVERIFIED', { severity: 'CRITICAL' }));
  assert.match(unverified.recommendation, /conectado/);
  assert.equal(unverified.support.reference, watching.support.reference, 'es la misma alerta para soporte');
  assert.equal(summarizeOperation({ alerts: [alert('CHECKOUT_PROVIDER_UNVERIFIED', { severity: 'INFO' })] }).tone, 'calm');
});

test('un pedido con el pago devuelto pide cancelarlo, no aceptarlo', () => {
  const described = describeOperationalAlert(alert('ORDER_PAYMENT_REVERSED_OPEN', { severity: 'ACTION_REQUIRED' }));
  assert.equal(described.action.view, 'orders');
  assert.match(described.recommendation, /cancelalo/);
  assert.doesNotMatch(described.recommendation, /aceptalo/);
});

test('cada alerta que emite el servidor tiene su propio texto, no el genérico', () => {
  // Lee las migraciones: el código de alerta va seguido de su tipo de sujeto en cada SELECT de la reconciliación
  // (también dentro de los parches que reescriben la función con comillas dobladas).
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const emitted = new Map();
  for (const name of fs.readdirSync(dir).filter((file) => file.endsWith('.sql'))) {
    const sql = fs.readFileSync(new URL(name, dir), 'utf8');
    const pattern = /'{1,2}([A-Z][A-Z0-9_]{5,})'{1,2}(?:::text)?(?:\s+as\s+alert_code)?,\s*'{1,2}(payment_intent|payment_discrepancy|order|checkout_session|fiscal_document|print_job|business|service_health)'{1,2}/g;
    for (const [, code, subject] of sql.matchAll(pattern)) emitted.set(code, subject);
  }
  assert.ok(emitted.has('PAYMENT_DISCREPANCY_OPEN') && emitted.has('ORDER_PAYMENT_REVERSED_OPEN'), 'el lector de migraciones dejó de encontrar alertas');
  const library = new Set(alertLibrarySnapshot().map((entry) => entry.code));
  const generic = [...emitted].filter(([code, subject]) => subject !== 'service_health' && !library.has(code)).map(([code]) => code);
  assert.deepEqual(generic, [], 'alertas del servidor que el Panel mostraría con el texto genérico');
});
