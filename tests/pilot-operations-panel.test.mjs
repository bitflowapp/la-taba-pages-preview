import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUSINESS_OPERATION_VIEWS,
  configureBusinessOperations,
  handleBusinessOperationsAction,
  renderBusinessOperations,
  resetBusinessOperationsForTests,
} from '../js/business/business-operations-center.js';
import { createSupabaseOperationsRepository } from '../js/repositories/supabase-operations-repository.js';
import {
  describeAttentionTiles, describeCommercialTiles, describeIncidentTrace,
  describeLastActivity, describeQueues, describeServiceHealth, summarizePilotDay,
} from '../js/business/pilot-operations-language.js';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';

function dashboard(overrides = {}) {
  return {
    generated_at: '2026-08-07T12:00:00Z',
    business_id: BUSINESS_ID,
    timezone: 'America/Argentina/Buenos_Aires',
    commercial_scope: { includes: 'production', excludes: 'qa', note: 'Los pedidos de prueba quedan afuera.' },
    thresholds: { low_stock_units: { value: 6, source: 'default' } },
    today: {
      orders: 5, billable_orders: 4, revenue_booked: 35000, revenue_delivered: 15000,
      ticket_average: 8750, delivered: 1, cancelled: 1, rejected: 0,
      counter_sales: { count: 0, total: 0 }, qa_orders_excluded: 1,
    },
    orders: {
      open_total: 3,
      open_by_state: { received: 1, ready: 1, assigned: 1 },
      today_by_state: { received: 1, ready: 1, assigned: 1, delivered: 1, cancelled: 1 },
      checkouts_open: { paid: 1, pending: 1 },
    },
    payments: {
      approved_today: { count: 3, amount: 27100 },
      pending: { count: 1, oldest_minutes: 255 },
      failed_today: { count: 1 },
      in_review: { count: 0 },
      approved_without_order: { count: 0, amount: 0, oldest_minutes: 0 },
      amount_mismatch: { count: 0 },
      paid_checkouts_without_order: { count: 0, amount: 0, oldest_minutes: 0 },
    },
    attention: {
      unaccepted_orders: { count: 0, threshold_minutes: 10, oldest_minutes: 0 },
      ready_without_rider: { count: 0, threshold_minutes: 10, oldest_minutes: 0 },
      delayed_deliveries: { count: 0, threshold_minutes: 45, oldest_minutes: 0 },
      riders_without_signal: { count: 0, threshold_minutes: 5 },
      manual_review_checkouts: 0,
    },
    queues: {
      payments: { pending: 1, retrying: 1, overdue: 1, expired_leases: 0, failed: 0, dead_letter: 1, max_attempts: 8 },
      fiscal: { pending: 0, retrying: 0, overdue: 0, expired_leases: 0, dead_letter: 0 },
      fiscal_artifacts: { pending: 0, dead_letter: 0 },
      notifications: { pending: 0, retrying: 0, failed: 0, dead_letter: 0 },
      deliveries: { undispatched: 0, stale: 0 },
      webhooks: { received_24h: 2, duplicate_24h: 0, rejected_signature_24h: 1, failed_24h: 0, retrying: 0 },
    },
    stock: {
      threshold_units: 5,
      low: { count: 1, items: [{ product_id: 'p1', name: 'Gaseosa', stock: 2 }] },
      out_of_stock: { count: 1, items: [{ product_id: 'p2', name: 'Agua' }] },
      unknown_stock: 0, published_total: 3,
      expired_reservations: { count: 1, units: 3, oldest_minutes: 10 },
    },
    alerts: {
      open: 1, acknowledged: 0, by_severity: { CRITICAL: 1 },
      top: [{
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', severity: 'CRITICAL',
        code: 'PAYMENT_APPROVED_WITHOUT_ORDER', status: 'open',
        summary: 'Pago aprobado sin pedido operativo.',
        required_action: 'Reconciliar sin cobrar nuevamente.',
        correlation_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      }],
    },
    last_activity: {
      last_order_at: '2026-08-07T11:55:00Z',
      last_payment_approved_at: null,
      last_panel_command_at: '2026-08-07T11:58:00Z',
    },
    health: {
      overall: 'unknown',
      services: [
        {
          service: 'database', label: 'Base de datos', status: 'healthy',
          reason: 'La base respondió esta misma consulta.',
          observed_at: '2026-08-07T12:00:00Z',
          evidence: { in_recovery: false, uptime_seconds: 288 },
        },
        {
          service: 'worker', label: 'Procesador de pagos', status: 'unknown',
          reason: 'La cola de pagos nunca tuvo trabajo: no hay con qué medirlo.',
          observed_at: '2026-08-07T12:00:00Z',
          evidence: { queued_total: 0, last_completion_at: null },
        },
      ],
    },
    ...overrides,
  };
}

test('el repositorio del piloto usa exclusivamente RPC autenticadas y pasa el negocio en cada una', async () => {
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: { ok: true }, error: null, status: 200 };
    },
  };
  const repository = createSupabaseOperationsRepository({ client, businessId: BUSINESS_ID });
  await repository.getPilotDashboard('America/Argentina/Buenos_Aires');
  await repository.getPilotServiceHealth();
  await repository.tracePilotOrder('LT-0086');
  await repository.getPilotCommercialReport({ from: '2026-08-01', to: '2026-08-07' });
  await repository.configurePilotThresholds({ low_stock_units: '8' });

  assert.deepEqual(calls.map(({ name }) => name), [
    'get_pilot_operations_dashboard',
    'get_pilot_service_health',
    'trace_pilot_order',
    'get_pilot_commercial_report',
    'configure_pilot_ops_thresholds',
  ]);
  for (const call of calls) assert.equal(call.args.p_business_id, BUSINESS_ID);
  assert.equal(calls[0].args.p_timezone, 'America/Argentina/Buenos_Aires');
  assert.equal(calls[2].args.p_reference, 'LT-0086');
  assert.equal(calls[3].args.p_from, '2026-08-01');
  assert.deepEqual(calls[4].args.p_thresholds, { low_stock_units: '8' });
});

test('el resumen prioriza el dinero trabado por encima de todo lo demás', () => {
  const withMoneyStuck = dashboard();
  withMoneyStuck.payments.approved_without_order = { count: 2, amount: 12000, oldest_minutes: 30 };
  withMoneyStuck.attention.unaccepted_orders = { count: 4, threshold_minutes: 10, oldest_minutes: 60 };
  const summary = summarizePilotDay(withMoneyStuck);
  assert.equal(summary.tone, 'critical');
  assert.match(summary.headline, /2 cobro\(s\) sin pedido/);
});

test('sin dinero trabado manda el cliente esperando, y después la infraestructura', () => {
  const waiting = dashboard();
  waiting.attention.ready_without_rider = { count: 3, threshold_minutes: 10, oldest_minutes: 40 };
  waiting.health.overall = 'down';
  const summary = summarizePilotDay(waiting);
  assert.equal(summary.tone, 'attention');
  assert.match(summary.headline, /3 pedido\(s\) esperando/);

  const onlyInfra = dashboard();
  onlyInfra.health.overall = 'down';
  assert.match(summarizePilotDay(onlyInfra).headline, /servicio caído/);
});

test('un día sin pedidos distingue el silencio nuevo del silencio largo', () => {
  const quiet = dashboard();
  quiet.today.orders = 0;
  quiet.last_activity.last_order_at = new Date(Date.now() - 10 * 60_000).toISOString();
  assert.match(summarizePilotDay(quiet).detail, /última actividad fue hace/);

  const stale = dashboard();
  stale.today.orders = 0;
  stale.last_activity.last_order_at = new Date(Date.now() - 8 * 60 * 60_000).toISOString();
  stale.last_activity.last_checkout_at = null;
  assert.match(summarizePilotDay(stale).detail, /conviene confirmar que la web toma pedidos/);
});

test('el ticket promedio sin pedidos no se inventa en cero', () => {
  const empty = dashboard();
  empty.today.orders = 0;
  empty.today.billable_orders = 0;
  empty.today.revenue_booked = 0;
  empty.today.ticket_average = null;
  const ticket = describeCommercialTiles(empty).find((tile) => tile.key === 'ticket');
  assert.equal(ticket.value, 'sin pedidos');
});

test('las excepciones en cero bajan a tono calmo y las activas conservan su gravedad', () => {
  const calm = describeAttentionTiles(dashboard());
  assert.equal(calm.find((tile) => tile.key === 'unaccepted').tone, 'calm');
  assert.equal(calm.find((tile) => tile.key === 'low_stock').tone, 'attention');

  const hot = dashboard();
  hot.attention.unaccepted_orders = { count: 2, threshold_minutes: 10, oldest_minutes: 30 };
  const tiles = describeAttentionTiles(hot);
  const unaccepted = tiles.find((tile) => tile.key === 'unaccepted');
  assert.equal(unaccepted.tone, 'critical');
  assert.equal(unaccepted.value, 2);
  assert.match(unaccepted.hint, /10 minuto\(s\)/);
});

test('el cobro sin pedido suma las dos vistas del mismo dinero en una sola tarjeta', () => {
  const data = dashboard();
  data.payments.approved_without_order = { count: 1, amount: 12000, oldest_minutes: 30 };
  data.payments.paid_checkouts_without_order = { count: 1, amount: 4000, oldest_minutes: 30 };
  const tile = describeAttentionTiles(data).find((entry) => entry.key === 'approved_without_order');
  assert.equal(tile.value, 2);
  assert.equal(tile.tone, 'critical');
});

test('una cola con trabajo abandonado es crítica y una que sólo reintenta no lo es', () => {
  const queues = describeQueues(dashboard());
  const payments = queues.find((queue) => queue.key === 'payments');
  assert.equal(payments.tone, 'critical');
  assert.match(payments.summary, /1 abandonados/);

  const soft = dashboard();
  soft.queues.payments = { pending: 2, retrying: 1, overdue: 0, expired_leases: 0, failed: 0, dead_letter: 0, max_attempts: 2 };
  assert.equal(describeQueues(soft).find((queue) => queue.key === 'payments').tone, 'attention');

  const idle = dashboard();
  idle.queues.payments = { pending: 0, retrying: 0, overdue: 0, expired_leases: 0, failed: 0, dead_letter: 0, max_attempts: 0 };
  const idleRow = describeQueues(idle).find((queue) => queue.key === 'payments');
  assert.equal(idleRow.tone, 'calm');
  assert.equal(idleRow.summary, 'Sin trabajo pendiente.');
});

test('los avisos recibidos no alarman por sí solos, pero la firma inválida sí', () => {
  const onlyTraffic = dashboard();
  onlyTraffic.queues.webhooks = { received_24h: 40, duplicate_24h: 3, rejected_signature_24h: 0, failed_24h: 0, retrying: 0 };
  assert.equal(describeQueues(onlyTraffic).find((queue) => queue.key === 'webhooks').tone, 'calm');
  assert.equal(describeQueues(dashboard()).find((queue) => queue.key === 'webhooks').tone, 'critical');
});

test('un servicio sin evidencia se muestra como "sin señal", nunca como funcionando', () => {
  const services = describeServiceHealth(dashboard().health);
  const worker = services.find((service) => service.key === 'worker');
  assert.equal(worker.status, 'unknown');
  assert.equal(worker.statusLabel, 'Sin señal');
  assert.equal(worker.tone, 'muted');
  assert.notEqual(worker.statusLabel, 'Funcionando');
  const database = services.find((service) => service.key === 'database');
  assert.equal(database.statusLabel, 'Funcionando');
  assert.ok(database.evidence.length > 0, 'el veredicto viaja con la evidencia que lo sostiene');
});

test('la última actividad distingue lo que nunca pasó de lo que pasó hace mucho', () => {
  const entries = describeLastActivity(dashboard());
  const never = entries.find((entry) => entry.key === 'last_payment_approved_at');
  assert.equal(never.relative, 'todavía no pasó');
  assert.equal(never.tone, 'muted');
  const recent = entries.find((entry) => entry.key === 'last_order_at');
  assert.match(recent.relative, /^hace /);
});

test('la traza señala una sola etapa rota y no la inventa cuando el circuito está sano', () => {
  const broken = describeIncidentTrace({
    resolved_as: 'order', public_code: 'LT-0086',
    stages: [
      { stage: 'checkout', label: 'Checkout', status: 'ok', detail: 'Estado del checkout: completed.' },
      { stage: 'payment', label: 'Pago', status: 'ok', detail: 'Aprobado.' },
      { stage: 'order', label: 'Pedido', status: 'ok', detail: 'Existe.' },
      { stage: 'rider', label: 'Rider', status: 'stalled', detail: 'Listo hace más de 10 minuto(s) y ningún rider lo tomó.' },
    ],
    break_point: { stage: 'rider', label: 'Rider', status: 'stalled', reason: 'Listo hace más de 10 minuto(s) y ningún rider lo tomó.' },
  });
  assert.equal(broken.found, true);
  assert.match(broken.headline, /Se rompió en: Rider/);
  assert.equal(broken.stages.length, 4);
  assert.equal(broken.stages.at(-1).tone, 'attention');

  const healthy = describeIncidentTrace({
    resolved_as: 'order', public_code: 'LT-0001',
    stages: [{ stage: 'order', label: 'Pedido', status: 'ok', detail: 'Existe.' }],
    break_point: null,
  });
  assert.equal(healthy.breakPoint, null);
  assert.match(healthy.headline, /no muestra ninguna etapa rota/);

  const missing = describeIncidentTrace({ resolved_as: 'not_found', reason: 'No hay pedido con esa referencia.' });
  assert.equal(missing.found, false);
});

test('la pantalla del piloto está registrada y dibuja las secciones que el negocio necesita', async () => {
  assert.ok(BUSINESS_OPERATION_VIEWS.includes('pilot-ops'));
  configureBusinessOperations({
    role: 'owner',
    getPilotDashboard: async () => ({ ok: true, data: dashboard() }),
    onChange() {},
  });
  renderBusinessOperations('pilot-ops');
  await new Promise((resolve) => setTimeout(resolve, 0));
  const markup = renderBusinessOperations('pilot-ops');
  for (const section of [
    'Qué necesita una persona', 'Cómo viene el día', 'Pedidos por estado',
    'Salud de servicios', 'Trabajo interno', 'Alertas',
    '¿Dónde se rompió un pedido?', 'Última actividad',
  ]) assert.match(markup, new RegExp(section));
  assert.match(markup, /Ticket promedio/);
  assert.match(markup, /Los pedidos de prueba quedan afuera/);
  assert.match(markup, /Hoy se excluyeron 1 pedido\(s\) de prueba/);
  assert.match(markup, /Sin señal/);
  // El identificador técnico de la alerta queda detrás del detalle para soporte.
  assert.doesNotMatch(markup, /PAYMENT_APPROVED_WITHOUT_ORDER/);
  resetBusinessOperationsForTests();
});

test('si la medición falla el panel no deja pasar una foto vieja por actual', async () => {
  let ok = true;
  configureBusinessOperations({
    role: 'owner',
    getPilotDashboard: async () => (ok
      ? { ok: true, data: dashboard() }
      : { ok: false, message: 'El servidor no respondió.' }),
    onChange() {},
  });
  renderBusinessOperations('pilot-ops');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(renderBusinessOperations('pilot-ops'), /Ticket promedio/);

  ok = false;
  const refresh = { closest: (selector) => (selector === '[data-pilot-ops-refresh]' ? refresh : null) };
  const outcome = await handleBusinessOperationsAction(refresh);
  assert.equal(outcome.ok, false);
  const markup = renderBusinessOperations('pilot-ops');
  assert.match(markup, /El servidor no respondió/);
  assert.doesNotMatch(markup, /Ticket promedio/);
  resetBusinessOperationsForTests();
});

test('seguir un pedido exige un código y devuelve la etapa rota', async () => {
  const asked = [];
  configureBusinessOperations({
    role: 'owner',
    getPilotDashboard: async () => ({ ok: true, data: dashboard() }),
    tracePilotOrder: async (reference) => {
      asked.push(reference);
      return {
        ok: true,
        data: {
          resolved_as: 'order', public_code: 'LT-0086',
          stages: [{ stage: 'rider', label: 'Rider', status: 'stalled', detail: 'Nadie lo tomó.' }],
          break_point: { stage: 'rider', label: 'Rider', status: 'stalled', reason: 'Nadie lo tomó.' },
          privacy: { pii_included: false },
        },
      };
    },
    onChange() {},
  });
  renderBusinessOperations('pilot-ops');
  await new Promise((resolve) => setTimeout(resolve, 0));

  const inputs = { pilotTraceReference: { value: '' } };
  const root = { querySelector: (selector) => inputs[selector.match(/name="([^"]+)/)?.[1]] || null };
  const button = {
    closest(selector) {
      if (selector === '[data-pilot-ops-trace]') return button;
      if (selector === '[data-business-ops-center]') return root;
      return null;
    },
  };
  const empty = await handleBusinessOperationsAction(button);
  assert.equal(empty.ok, false);
  assert.equal(asked.length, 0, 'sin código no se consulta al servidor');

  inputs.pilotTraceReference.value = ' LT-0086 ';
  const found = await handleBusinessOperationsAction(button);
  assert.equal(found.ok, true);
  assert.deepEqual(asked, ['LT-0086']);
  const markup = renderBusinessOperations('pilot-ops');
  assert.match(markup, /Se rompió en: Rider/);
  resetBusinessOperationsForTests();
});
