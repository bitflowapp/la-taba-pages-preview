import assert from 'node:assert/strict';
import test from 'node:test';

import {
  containsForbiddenVocabulary, describeOperationalHealth, scheduledTaskName,
} from '../js/business/business-operation-language.js';
import { renderOperationCenterSurface } from '../js/business/business-panel-render.js';

/**
 * La superficie de salud existe para contestar lo que un tablero vacío no
 * contesta: si el sistema se está mirando solo. Estas afirmaciones bloquean las
 * dos formas de mentir que tendría: pintarse de verde sin datos, y publicar un
 * secreto por el camino.
 */

const SANO = Object.freeze({
  generated_at: '2026-08-10T18:00:00.000Z',
  autonomous_evaluation: {
    expected_every_seconds: 60,
    last_run_at: '2026-08-10T17:59:48.000Z',
    seconds_since_last_run: 12,
    last_status: 'ok',
    businesses_evaluated: 1,
    findings: 0,
    failures: [],
    state: 'al día',
  },
  scheduler: [
    { job: 'taba-payment-outbox-worker', schedule: '30 seconds', active: true, last_success_at: '2026-08-10T17:59:50.000Z', seconds_since_success: 10, failures_since_success: 0, state: 'al día' },
    { job: 'taba-checkout-expiry-sweep', schedule: '* * * * *', active: true, last_success_at: '2026-08-10T17:59:40.000Z', seconds_since_success: 20, failures_since_success: 0, state: 'al día' },
    { job: 'taba-operational-alerts-sweep', schedule: '* * * * *', active: true, last_success_at: '2026-08-10T17:59:48.000Z', seconds_since_success: 12, failures_since_success: 0, state: 'al día' },
  ],
  payments: {
    outbox: { pending: 0, retry_wait: 0, in_flight: 0, failed: 0, dead_letter: 0, due_now: 0, oldest_due_seconds: 0 },
    worker: { last_success_at: '2026-08-10T17:58:00.000Z', seconds_since_success: 120, completed_last_hour: 4, last_failure_at: null, failed_last_hour: 0, state: 'al día' },
    reconciliation: { paid_without_order: 0, probes_last_hour: 0, provider_answers_last_hour: 3, in_review: 0 },
  },
  orders_needing_attention: { not_accepted: 0, stalled: 0, ready_without_rider: 0, active_deliveries: 1 },
  riders_without_signal: 0,
  reservations: { active: 2, expired_still_held: 0, oldest_expired_minutes: 0 },
  alerts: { open: 0, critical: 0, action_required: 0, warning: 0, acknowledged: 0, oldest_open_at: null, detected_by_system_last_hour: 0 },
  secrets: [
    { name: 'taba_payment_worker_hmac_secret', configured: true, detail: 'cargada y con el largo mínimo' },
    { name: 'taba_payment_worker_url', configured: true, detail: 'cargada y con la forma esperada' },
  ],
});

function conSalud(cambios) {
  return { ...SANO, ...cambios };
}

test('con todo medido y sano, la superficie dice que el sistema se cuida solo', () => {
  const described = describeOperationalHealth(SANO);
  assert.equal(described.available, true);
  assert.equal(described.tone, 'calm');
  assert.equal(described.rows.find((row) => row.key === 'watch').value, 'Al día');
  assert.match(described.detail, /hace 12 segundos/);
});

test('sin salud en la respuesta NO se pinta de verde', () => {
  for (const vacío of [undefined, null, {}, [], 'nada']) {
    const described = describeOperationalHealth(vacío);
    if (vacío && typeof vacío === 'object' && !Array.isArray(vacío)) {
      // Un objeto vacío sí es una respuesta: se describe con lo que hay, que es nada.
      assert.notEqual(described.tone, 'calm');
      continue;
    }
    assert.equal(described.available, false);
    assert.notEqual(described.tone, 'calm');
    assert.match(described.headline, /Todavía no podemos decirte/);
  }
});

test('si la evaluación automática se detuvo, el titular lo dice y no lo esconde', () => {
  const described = describeOperationalHealth(conSalud({
    autonomous_evaluation: {
      ...SANO.autonomous_evaluation, state: 'detenido', seconds_since_last_run: 1800,
    },
  }));
  assert.equal(described.tone, 'critical');
  assert.equal(described.rows.find((row) => row.key === 'watch').value, 'Detenida');
  assert.match(described.headline, /NO se está cuidando solo/);
  assert.match(described.detail, /el tablero esté vacío no significa/);
});

test('una tarea automática caída se nombra por lo que hace, no por su nombre técnico', () => {
  const described = describeOperationalHealth(conSalud({
    scheduler: [
      ...SANO.scheduler.slice(0, 2),
      { job: 'taba-operational-alerts-sweep', schedule: '* * * * *', active: true, last_success_at: null, seconds_since_success: null, failures_since_success: 4, state: 'fallando' },
    ],
  }));
  const tareas = described.rows.find((row) => row.key === 'tasks');
  assert.equal(tareas.tone, 'critical');
  assert.equal(tareas.value, '2 de 3 al día');
  assert.match(tareas.detail, /Vigilar la operación/);
  assert.doesNotMatch(tareas.detail, /taba-operational-alerts-sweep/);
});

test('dinero cobrado sin pedido manda a rojo aunque todo lo demás esté bien', () => {
  const described = describeOperationalHealth(conSalud({
    payments: { ...SANO.payments, reconciliation: { ...SANO.payments.reconciliation, paid_without_order: 2 } },
  }));
  assert.equal(described.tone, 'critical');
  assert.equal(described.rows.find((row) => row.key === 'paid-without-order').value, '2');
});

test('la cola de cobros frenada se dice en castellano llano', () => {
  const described = describeOperationalHealth(conSalud({
    payments: {
      ...SANO.payments,
      outbox: { ...SANO.payments.outbox, pending: 3, due_now: 3 },
      worker: { ...SANO.payments.worker, state: 'no está tomando trabajo' },
    },
  }));
  const cobros = described.rows.find((row) => row.key === 'payments');
  assert.equal(cobros.value, 'Frenados');
  assert.equal(cobros.tone, 'critical');
  assert.match(cobros.detail, /3 esperando/);
});

test('ningún texto de la superficie usa el vocabulario interno prohibido', () => {
  const casos = [
    SANO,
    conSalud({ autonomous_evaluation: { ...SANO.autonomous_evaluation, state: 'detenido' } }),
    conSalud({ secrets: [{ name: 'taba_payment_worker_url', configured: false, detail: 'falta cargarla' }] }),
    undefined,
    {},
  ];
  for (const caso of casos) {
    const described = describeOperationalHealth(caso);
    const superficies = [described.headline, described.detail,
      ...described.rows.flatMap((row) => [row.label, row.value, row.detail])];
    for (const texto of superficies) {
      assert.deepEqual(containsForbiddenVocabulary(texto), [], `filtró jerga en: ${texto}`);
      assert.doesNotMatch(String(texto), /undefined|NaN|\[object/i, `texto sin formatear: ${texto}`);
    }
  }
});

test('de los secretos se publica el estado, nunca el contenido', () => {
  const secreto = 'ESTE-VALOR-NO-PUEDE-SALIR-JAMAS-0123456789';
  // Un servidor que se equivocara y mandara el valor no debe poder pintarlo:
  // la superficie sólo lee `name`, `configured` y `detail`.
  const described = describeOperationalHealth(conSalud({
    secrets: [{ name: 'taba_payment_worker_hmac_secret', configured: true, detail: 'cargada y con el largo mínimo', decrypted_secret: secreto }],
  }));
  const fila = described.rows.find((row) => row.key === 'secrets');
  assert.equal(fila.value, '1 de 1 cargada');
  assert.equal(JSON.stringify(described).includes(secreto), false);

  const html = renderOperationCenterSurface({
    snapshot: { metrics: {}, alerts: [], recent_closures: [], generated_at: SANO.generated_at, health: conSalud({
      secrets: [{ name: 'taba_payment_worker_hmac_secret', configured: true, detail: 'cargada y con el largo mínimo', decrypted_secret: secreto }],
    }) },
    status: { phase: 'ready' },
    role: 'owner',
  });
  assert.equal(html.includes(secreto), false, 'el Panel no puede pintar un valor de la bóveda');
});

test('el Centro de operación dibuja la salud con los datos que llegaron', () => {
  const html = renderOperationCenterSurface({
    snapshot: { metrics: {}, alerts: [], recent_closures: [], generated_at: SANO.generated_at, health: SANO },
    status: { phase: 'ready' },
    role: 'owner',
  });
  assert.match(html, /data-operation-health-section="medido"/);
  assert.match(html, /Cómo viene el sistema/);
  assert.match(html, /data-operation-health="watch"/);
  assert.match(html, /data-operation-health="paid-without-order"/);
  assert.match(html, /data-operation-health="secrets"/);
});

test('sin salud, el Centro de operación lo dice en vez de callarse', () => {
  const html = renderOperationCenterSurface({
    snapshot: { metrics: {}, alerts: [], recent_closures: [], generated_at: SANO.generated_at },
    status: { phase: 'ready' },
    role: 'owner',
  });
  assert.match(html, /data-operation-health-section="sin-datos"/);
  assert.match(html, /Todavía no podemos decirte cómo viene el sistema/);
});

test('las tareas conocidas tienen nombre de persona y las desconocidas no rompen', () => {
  assert.equal(scheduledTaskName('taba-payment-outbox-worker'), 'Procesar los cobros que entran');
  assert.equal(scheduledTaskName('otra-cosa'), 'Una tarea automática del sistema');
  assert.equal(scheduledTaskName(undefined), 'Una tarea automática del sistema');
});

/*
 * Un comercio que no cobra online no tiene un sistema roto.
 *
 * La Taba vende con efectivo y «a coordinar»: las dos credenciales del
 * despachador de cobros no le hacen falta. Antes eso pintaba la fila de rojo y
 * el titular de la sección —que se calcula desde los rojos— decía «El sistema
 * NO se está cuidando solo» de forma permanente, con la vigilancia corriendo
 * cada 60 segundos. Medido en el Panel de producción el 2026-08-25.
 */
test('sin cobros online esperando, una credencial que falta se mira; no es un incendio', () => {
  const sinCobrar = conSalud({
    secrets: [
      { name: 'taba_payment_worker_hmac_secret', configured: false, detail: 'falta cargarla' },
      { name: 'taba_payment_worker_url', configured: false, detail: 'falta cargarla' },
    ],
  });
  const described = describeOperationalHealth(sinCobrar);
  const fila = described.rows.find((row) => row.key === 'secrets');
  assert.equal(fila.value, '0 de 2 cargadas');
  assert.equal(fila.tone, 'attention', 'una credencial sin uso no puede ser crítica');
  assert.notEqual(described.tone, 'critical');
  assert.equal(described.headline.includes('NO se está cuidando'), false, described.headline);
  // La vigilancia sigue siendo la que manda en el titular, y sigue viéndose.
  assert.equal(described.rows.find((row) => row.key === 'watch').tone, 'calm');
});

test('con cobros esperando, la misma credencial que falta SÍ es crítica', () => {
  const conCola = conSalud({
    payments: {
      ...SANO.payments,
      outbox: { pending: 3, retry_wait: 0, in_flight: 0, failed: 0, dead_letter: 0, due_now: 3, oldest_due_seconds: 400 },
    },
    secrets: [
      { name: 'taba_payment_worker_hmac_secret', configured: false, detail: 'falta cargarla' },
      { name: 'taba_payment_worker_url', configured: false, detail: 'falta cargarla' },
    ],
  });
  const described = describeOperationalHealth(conCola);
  assert.equal(described.rows.find((row) => row.key === 'secrets').tone, 'critical');
  assert.equal(described.tone, 'critical');
  assert.match(described.headline, /NO se está cuidando/);
});

test('dinero cobrado sin pedido también vuelve crítica la credencial que falta', () => {
  const described = describeOperationalHealth(conSalud({
    payments: {
      ...SANO.payments,
      reconciliation: { ...SANO.payments.reconciliation, paid_without_order: 1 },
    },
    secrets: [{ name: 'taba_payment_worker_url', configured: false, detail: 'falta cargarla' }],
  }));
  assert.equal(described.rows.find((row) => row.key === 'secrets').tone, 'critical');
});
