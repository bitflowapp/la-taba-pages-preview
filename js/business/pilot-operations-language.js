// Traduce la lectura operativa del piloto a algo que Walter pueda leer en
// segundos, sin jerga y sin números sin contexto.
//
// Es una función pura por sección: recibe el payload de
// `get_pilot_operations_dashboard` y devuelve estructuras listas para pintar.
// Ninguna inventa un dato: cuando el servidor dice `null`, acá se dice
// "todavía no hay" y no cero.

export const HEALTH_STATES = Object.freeze({
  healthy: Object.freeze({ label: 'Funcionando', tone: 'calm' }),
  degraded: Object.freeze({ label: 'Con problemas', tone: 'attention' }),
  down: Object.freeze({ label: 'Caído', tone: 'critical' }),
  unknown: Object.freeze({ label: 'Sin señal', tone: 'muted' }),
});

const STAGE_STATES = Object.freeze({
  ok: Object.freeze({ label: 'Pasó', tone: 'calm' }),
  in_progress: Object.freeze({ label: 'En curso', tone: 'info' }),
  pending: Object.freeze({ label: 'Esperando', tone: 'info' }),
  stalled: Object.freeze({ label: 'Trabado', tone: 'attention' }),
  failed: Object.freeze({ label: 'Falló', tone: 'critical' }),
  missing: Object.freeze({ label: 'No ocurrió', tone: 'critical' }),
  reversed: Object.freeze({ label: 'Revertido', tone: 'attention' }),
  not_reached: Object.freeze({ label: 'Todavía no', tone: 'muted' }),
  not_applicable: Object.freeze({ label: 'No aplica', tone: 'muted' }),
  unknown: Object.freeze({ label: 'Sin registro', tone: 'muted' }),
});

const PIPELINE_LABELS = Object.freeze({
  pending: 'Pagando',
  paid: 'Pagado sin pedido',
  received: 'Nuevos',
  accepted: 'Aceptados',
  preparing: 'Preparando',
  ready: 'Listos',
  assigned: 'Con rider',
  picked_up: 'Retirados',
  on_the_way: 'En camino',
  arrived: 'En la puerta',
  delivered: 'Entregados',
  cancelled: 'Cancelados',
  rejected: 'Rechazados',
  expired: 'Vencidos',
});

export function healthState(status) {
  return HEALTH_STATES[String(status || 'unknown')] || HEALTH_STATES.unknown;
}

export function stageState(status) {
  return STAGE_STATES[String(status || 'unknown')] || STAGE_STATES.unknown;
}

export function pipelineLabel(state) {
  return PIPELINE_LABELS[String(state || '')] || String(state || 'Sin estado');
}

// Una sola frase arriba de todo. El orden de prioridad es el orden en que a un
// negocio le duele: primero la plata, después el cliente esperando, después la
// infraestructura.
export function summarizePilotDay(dashboard) {
  if (!dashboard) {
    return { tone: 'muted', headline: 'Todavía no leímos el estado.', detail: 'Actualizá para pedirlo al servidor.' };
  }
  const payments = dashboard.payments || {};
  const attention = dashboard.attention || {};
  const health = dashboard.health || {};
  const today = dashboard.today || {};

  const moneyStuck = count(payments.approved_without_order) + count(payments.paid_checkouts_without_order);
  if (moneyStuck > 0) {
    return {
      tone: 'critical',
      headline: `${moneyStuck} cobro(s) sin pedido.`,
      detail: 'Alguien pagó y no hay nada que preparar. Es lo primero a resolver.',
    };
  }
  if (count(payments.amount_mismatch) > 0) {
    return {
      tone: 'critical',
      headline: 'Un importe cobrado no coincide con el pedido.',
      detail: 'Revisá el pago con el proveedor antes de entregar.',
    };
  }
  const waiting = count(attention.unaccepted_orders) + count(attention.ready_without_rider) + count(attention.delayed_deliveries);
  if (waiting > 0) {
    return {
      tone: 'attention',
      headline: `${waiting} pedido(s) esperando una persona.`,
      detail: 'Sin aceptar, sin rider o demorados más de lo prometido.',
    };
  }
  if (health.overall === 'down') {
    return { tone: 'critical', headline: 'Hay un servicio caído.', detail: 'Mirá el estado de servicios abajo.' };
  }
  if (health.overall === 'degraded') {
    return { tone: 'attention', headline: 'Un servicio viene con problemas.', detail: 'Todavía se puede operar; conviene mirarlo.' };
  }
  const orders = Number(today.orders || 0);
  if (orders === 0) {
    return {
      tone: 'info',
      headline: 'Todavía no entró ningún pedido hoy.',
      detail: describeSilence(dashboard),
    };
  }
  return {
    tone: 'calm',
    headline: `${orders} pedido(s) hoy por ${money(today.revenue_booked)}.`,
    detail: 'Nada pendiente que necesite una persona ahora mismo.',
  };
}

// Un tablero en cero no dice lo mismo si hubo actividad hace un minuto que si
// no pasa nada hace seis horas. La diferencia es entre un día flojo y una falla.
function describeSilence(dashboard) {
  const last = dashboard?.last_activity?.last_order_at || dashboard?.last_activity?.last_checkout_at;
  if (!last) return 'No hay actividad registrada todavía.';
  const minutes = minutesSince(last);
  if (minutes === null) return 'No hay actividad registrada todavía.';
  if (minutes < 90) return `La última actividad fue hace ${describeMinutes(minutes)}.`;
  return `Hace ${describeMinutes(minutes)} que no pasa nada: conviene confirmar que la web toma pedidos.`;
}

export function describeCommercialTiles(dashboard) {
  const today = dashboard?.today || {};
  const counter = today.counter_sales || {};
  return [
    {
      key: 'orders', label: 'Pedidos de hoy', value: integer(today.orders),
      hint: 'Sólo operación real; los de prueba no cuentan.', tone: 'info', view: 'orders',
    },
    {
      key: 'revenue', label: 'Vendido hoy', value: money(today.revenue_booked),
      hint: 'Pedidos del día sin contar cancelados.', tone: 'info', view: 'orders',
    },
    {
      key: 'ticket', label: 'Ticket promedio', value: today.ticket_average === null || today.ticket_average === undefined
        ? 'sin pedidos' : money(today.ticket_average),
      hint: 'Vendido dividido por pedidos no cancelados.', tone: 'info', view: 'orders',
    },
    {
      key: 'delivered', label: 'Entregados', value: integer(today.delivered),
      hint: 'Llegaron al cliente y se confirmaron.', tone: 'calm', view: 'orders',
    },
    {
      key: 'cancelled', label: 'Cancelados', value: integer(today.cancelled),
      hint: 'No se cobraron o se devolvieron.', tone: integer(today.cancelled) > 0 ? 'attention' : 'calm', view: 'orders',
    },
    {
      key: 'counter', label: 'Mostrador', value: money(counter.total),
      hint: `${integer(counter.count)} venta(s) presenciales, caja aparte.`, tone: 'info', view: 'pos',
    },
  ];
}

export function describeAttentionTiles(dashboard) {
  const attention = dashboard?.attention || {};
  const payments = dashboard?.payments || {};
  const stock = dashboard?.stock || {};
  const entries = [
    {
      key: 'approved_without_order', label: 'Cobrado sin pedido',
      value: count(payments.approved_without_order) + count(payments.paid_checkouts_without_order),
      hint: 'Entró la plata y no hay pedido que preparar.', tone: 'critical', view: 'payments',
    },
    {
      key: 'amount_mismatch', label: 'Importe que no coincide',
      value: count(payments.amount_mismatch),
      hint: 'Lo cobrado no es lo que decía el pedido.', tone: 'critical', view: 'payments',
    },
    {
      key: 'unaccepted', label: 'Sin aceptar',
      value: count(attention.unaccepted_orders),
      hint: thresholdHint(attention.unaccepted_orders, 'El cliente espera hace más de'),
      tone: 'critical', view: 'orders',
    },
    {
      key: 'ready_without_rider', label: 'Listos sin rider',
      value: count(attention.ready_without_rider),
      hint: thresholdHint(attention.ready_without_rider, 'Preparados y sin nadie que los lleve hace más de'),
      tone: 'attention', view: 'orders',
    },
    {
      key: 'delayed_deliveries', label: 'Entregas demoradas',
      value: count(attention.delayed_deliveries),
      hint: thresholdHint(attention.delayed_deliveries, 'Pasaron más de'),
      tone: 'attention', view: 'orders',
    },
    {
      key: 'riders_without_signal', label: 'Rider sin señal',
      value: count(attention.riders_without_signal),
      hint: thresholdHint(attention.riders_without_signal, 'Sin posición hace más de'),
      tone: 'attention', view: 'orders',
    },
    {
      key: 'payments_pending', label: 'Pagos en curso',
      value: count(payments.pending),
      hint: 'El cliente todavía no terminó de pagar.', tone: 'info', view: 'payments',
    },
    {
      key: 'payments_failed', label: 'Pagos rechazados hoy',
      value: count(payments.failed_today),
      hint: 'No se cobraron; el pedido no existe.', tone: 'info', view: 'payments',
    },
    {
      key: 'expired_reservations', label: 'Reservas vencidas',
      value: count(stock.expired_reservations),
      hint: 'Stock comprometido que nadie compró.', tone: 'attention', view: 'inventory-adjust',
    },
    {
      key: 'low_stock', label: 'Stock a reponer',
      value: count(stock.low),
      hint: `Publicados con ${integer(stock.threshold_units)} unidad(es) o menos.`,
      tone: 'attention', view: 'inventory-receive',
    },
    {
      key: 'out_of_stock', label: 'Sin stock',
      value: count(stock.out_of_stock),
      hint: 'Publicados y en cero: se ven y no se pueden comprar.', tone: 'critical', view: 'inventory-receive',
    },
  ];
  // Lo que está en cero no ocupa lugar: el tablero muestra problemas, no una
  // grilla de ceros donde el que importa se pierde.
  return entries.map((entry) => ({ ...entry, tone: entry.value > 0 ? entry.tone : 'calm' }));
}

export function describeQueues(dashboard) {
  const queues = dashboard?.queues || {};
  return [
    queueRow('payments', 'Cobros', queues.payments, ['pending', 'retrying', 'overdue', 'expired_leases', 'failed', 'dead_letter']),
    queueRow('fiscal', 'Facturación', queues.fiscal, ['pending', 'retrying', 'overdue', 'expired_leases', 'dead_letter']),
    queueRow('fiscal_artifacts', 'PDF fiscales', queues.fiscal_artifacts, ['pending', 'dead_letter']),
    queueRow('notifications', 'Avisos al negocio', queues.notifications, ['pending', 'retrying', 'failed', 'dead_letter']),
    queueRow('deliveries', 'Entregas por despachar', queues.deliveries, ['undispatched', 'stale']),
    queueRow('webhooks', 'Avisos del proveedor', queues.webhooks, ['received_24h', 'duplicate_24h', 'rejected_signature_24h', 'failed_24h', 'retrying']),
  ].filter(Boolean);
}

const QUEUE_FIELD_LABELS = Object.freeze({
  pending: 'esperando', retrying: 'reintentando', overdue: 'vencidos',
  expired_leases: 'tomados y vencidos', failed: 'fallados', dead_letter: 'abandonados',
  undispatched: 'sin despachar', stale: 'frenados',
  received_24h: 'recibidos 24 h', duplicate_24h: 'repetidos 24 h',
  rejected_signature_24h: 'firma inválida 24 h', failed_24h: 'fallados 24 h',
});

// `dead_letter` y `rejected_signature` no son "un número más": son trabajo que
// nadie va a reintentar y avisos que alguien mandó mal firmados.
const QUEUE_CRITICAL_FIELDS = new Set(['dead_letter', 'failed', 'failed_24h', 'rejected_signature_24h']);
const QUEUE_NEUTRAL_FIELDS = new Set(['received_24h', 'duplicate_24h']);

function queueRow(key, label, data, fields) {
  if (!data || typeof data !== 'object') return null;
  const items = fields
    .filter((field) => Number(data[field] || 0) > 0)
    .map((field) => ({ field, label: QUEUE_FIELD_LABELS[field] || field, value: Number(data[field]) }));
  const blocking = items.some((item) => QUEUE_CRITICAL_FIELDS.has(item.field));
  const moving = items.some((item) => !QUEUE_CRITICAL_FIELDS.has(item.field) && !QUEUE_NEUTRAL_FIELDS.has(item.field));
  return {
    key,
    label,
    items,
    tone: blocking ? 'critical' : moving ? 'attention' : 'calm',
    summary: items.length
      ? items.map((item) => `${item.value} ${item.label}`).join(' · ')
      : 'Sin trabajo pendiente.',
  };
}

export function describeServiceHealth(health) {
  const services = Array.isArray(health?.services) ? health.services : [];
  return services.map((service) => {
    const state = healthState(service.status);
    return {
      key: String(service.service || ''),
      label: String(service.label || service.service || ''),
      status: String(service.status || 'unknown'),
      statusLabel: state.label,
      tone: state.tone,
      reason: String(service.reason || ''),
      observedAt: service.observed_at || null,
      evidence: describeEvidence(service.evidence),
    };
  });
}

// La evidencia se muestra como pares legibles, no como JSON crudo: quien mira
// el tablero tiene que poder discutir el veredicto sin abrir la consola.
function describeEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') return [];
  return Object.entries(evidence)
    .filter(([, value]) => value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0))
    .slice(0, 8)
    .map(([key, value]) => ({
      key,
      label: key.replace(/_/g, ' '),
      value: Array.isArray(value) ? value.map((item) => stringify(item)).join(', ') : stringify(value),
    }));
}

function stringify(value) {
  if (value === true) return 'sí';
  if (value === false) return 'no';
  if (value && typeof value === 'object') return Object.values(value).map((item) => String(item)).join(' ');
  return String(value);
}

export function describeOrderStates(dashboard) {
  const orders = dashboard?.orders || {};
  const open = orders.open_by_state || {};
  const checkouts = orders.checkouts_open || {};
  const rows = Object.entries(open)
    .map(([state, quantity]) => ({ key: `order:${state}`, label: pipelineLabel(state), value: Number(quantity || 0), kind: 'order' }))
    .concat(Object.entries(checkouts)
      .map(([state, quantity]) => ({ key: `checkout:${state}`, label: `${pipelineLabel(state)} (checkout)`, value: Number(quantity || 0), kind: 'checkout' })));
  return {
    openTotal: Number(orders.open_total || 0),
    rows: rows.sort((left, right) => right.value - left.value),
  };
}

export function describeAlerts(dashboard) {
  const alerts = dashboard?.alerts || {};
  return {
    open: Number(alerts.open || 0),
    acknowledged: Number(alerts.acknowledged || 0),
    bySeverity: alerts.by_severity || {},
    items: Array.isArray(alerts.top) ? alerts.top : [],
  };
}

export function describeLastActivity(dashboard) {
  const activity = dashboard?.last_activity || {};
  const entries = [
    ['last_order_at', 'Último pedido'],
    ['last_checkout_at', 'Último checkout'],
    ['last_payment_approved_at', 'Último pago aprobado'],
    ['last_webhook_at', 'Último aviso del proveedor'],
    ['last_panel_command_at', 'Última acción del Panel'],
    ['last_rider_signal_at', 'Última señal de rider'],
    ['last_delivery_at', 'Última entrega'],
    ['last_counter_sale_at', 'Última venta de mostrador'],
  ];
  return entries.map(([key, label]) => {
    const value = activity[key] || null;
    const minutes = value ? minutesSince(value) : null;
    return {
      key,
      label,
      at: value,
      relative: value === null ? 'todavía no pasó' : minutes === null ? 'sin hora confirmada' : `hace ${describeMinutes(minutes)}`,
      tone: value === null ? 'muted' : minutes !== null && minutes > 360 ? 'attention' : 'calm',
    };
  });
}

// "¿Dónde se rompió LT-XXXX?" — la respuesta es una etapa, no un volcado.
export function describeIncidentTrace(trace) {
  if (!trace) return null;
  if (trace.resolved_as === 'not_found') {
    return {
      found: false,
      headline: 'No encontramos ese pedido ni ese checkout.',
      detail: String(trace.reason || 'Revisá el código e intentá de nuevo.'),
      stages: [],
      breakPoint: null,
    };
  }
  const stages = (Array.isArray(trace.stages) ? trace.stages : []).map((stage) => {
    const state = stageState(stage.status);
    return {
      key: String(stage.stage || ''),
      label: String(stage.label || stage.stage || ''),
      status: String(stage.status || 'unknown'),
      statusLabel: state.label,
      tone: state.tone,
      detail: String(stage.detail || ''),
      at: stage.at || null,
      evidence: describeEvidence(stage.evidence),
    };
  });
  const breakPoint = trace.break_point
    ? {
      stage: String(trace.break_point.stage || ''),
      label: String(trace.break_point.label || ''),
      reason: String(trace.break_point.reason || ''),
      statusLabel: stageState(trace.break_point.status).label,
    }
    : null;
  return {
    found: true,
    reference: String(trace.public_code || trace.reference || ''),
    correlationId: trace.correlation_id || null,
    headline: breakPoint
      ? `Se rompió en: ${breakPoint.label}.`
      : 'El circuito no muestra ninguna etapa rota.',
    detail: breakPoint ? breakPoint.reason : 'Todas las etapas que correspondían ocurrieron.',
    stages,
    breakPoint,
  };
}

function thresholdHint(block, prefix) {
  const threshold = Number(block?.threshold_minutes || 0);
  if (!threshold) return `${prefix} lo esperado.`;
  return `${prefix} ${describeMinutes(threshold)}.`;
}

function count(block) {
  if (typeof block === 'number') return Number.isFinite(block) ? block : 0;
  const value = Number(block?.count || 0);
  return Number.isFinite(value) ? value : 0;
}

function integer(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function money(value, currency = 'ARS') {
  const amount = Number(value);
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: currency || 'ARS' })
    .format(Number.isFinite(amount) ? amount : 0);
}

export function describeMinutes(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  if (value < 1) return 'menos de un minuto';
  if (value < 60) return `${value} minuto(s)`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  if (hours < 24) return rest ? `${hours} h ${rest} min` : `${hours} hora(s)`;
  const days = Math.floor(hours / 24);
  return `${days} día(s)`;
}

function minutesSince(value, now = Date.now()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.round((now - date.getTime()) / 60000));
}
