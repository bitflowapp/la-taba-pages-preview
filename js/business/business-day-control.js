// Abrir y cerrar el negocio. Un solo botón para arrancar el día y un cierre que no se firma a ciegas.

export const OPENING_CHECKS = Object.freeze([
  'internet', 'backend', 'payments', 'fiscal', 'scanner', 'printers', 'riders', 'queues',
]);

const CHECK_COPY = Object.freeze({
  internet: { label: 'Internet', blocking: true, why: 'Sin internet no entran pedidos ni se cobra.' },
  backend: { label: 'Sistema del negocio', blocking: true, why: 'Es donde viven los pedidos, el stock y los cobros.' },
  payments: { label: 'Cobros por la web', blocking: true, why: 'Si falla, el cliente no puede pagar online.' },
  fiscal: { label: 'Facturación', blocking: false, why: 'Podés vender sin facturar, pero conviene saberlo antes.' },
  scanner: { label: 'Lector de códigos', blocking: false, why: 'Sin lector se puede trabajar, pero más lento.' },
  printers: { label: 'Impresoras', blocking: false, why: 'Sin impresora no entregás ticket ni comprobante en papel.' },
  riders: { label: 'Repartidores', blocking: false, why: 'Los envíos necesitan alguien disponible.' },
  queues: { label: 'Pendientes de ayer', blocking: false, why: 'Lo que quedó abierto se arrastra al día de hoy.' },
});

export const OPENING_VERDICTS = Object.freeze({
  ready: {
    id: 'ready',
    headline: 'Todo listo para vender',
    detail: 'Podés abrir el negocio y cobrar con normalidad.',
    tone: 'calm',
  },
  'fiscal-pending': {
    id: 'fiscal-pending',
    headline: 'Podés vender, facturación pendiente',
    detail: 'Cobrá tranquilo, pero hoy no vas a poder entregar facturas hasta resolverlo.',
    tone: 'attention',
  },
  'hold-payments': {
    id: 'hold-payments',
    headline: 'No habilites cobros',
    detail: 'Falta algo esencial. Si cobrás igual, podés quedarte sin registro de la venta.',
    tone: 'critical',
  },
});

export function evaluateBusinessOpening(signals = {}) {
  const source = signals && typeof signals === 'object' ? signals : {};
  const rows = OPENING_CHECKS.map((id) => {
    const raw = source[id] || {};
    const status = normalizeCheckStatus(raw.status);
    const copy = CHECK_COPY[id];
    return Object.freeze({
      id,
      label: copy.label,
      why: copy.why,
      blocking: copy.blocking,
      status,
      statusLabel: checkStatusLabel(status),
      detail: String(raw.detail || defaultDetail(id, status)),
      tone: status === 'ok' ? 'calm' : status === 'degraded' ? 'attention' : status === 'unknown' ? 'attention' : 'critical',
    });
  });

  const failedBlocking = rows.filter((row) => row.blocking && row.status === 'failed');
  const unknownBlocking = rows.filter((row) => row.blocking && row.status === 'unknown');
  const fiscalRow = rows.find((row) => row.id === 'fiscal');
  const fiscalReady = fiscalRow?.status === 'ok';

  let verdict = OPENING_VERDICTS.ready;
  if (failedBlocking.length || unknownBlocking.length) verdict = OPENING_VERDICTS['hold-payments'];
  else if (!fiscalReady) verdict = OPENING_VERDICTS['fiscal-pending'];

  return Object.freeze({
    checks: Object.freeze(rows),
    verdict: Object.freeze({ ...verdict }),
    canSell: verdict.id !== 'hold-payments',
    canCharge: verdict.id !== 'hold-payments',
    canInvoice: fiscalReady,
    blockers: Object.freeze([...failedBlocking, ...unknownBlocking].map((row) => `${row.label}: ${row.detail}`)),
  });
}

export const CLOSURE_SECTIONS = Object.freeze([
  'sales', 'mercadopago', 'cash', 'refunds', 'orders', 'stock', 'documents', 'differences', 'pending',
]);

const CLOSURE_COPY = Object.freeze({
  sales: 'Ventas del día',
  mercadopago: 'Cobrado por Mercado Pago',
  cash: 'Efectivo',
  refunds: 'Devoluciones',
  orders: 'Pedidos',
  stock: 'Movimientos de stock',
  documents: 'Comprobantes',
  differences: 'Diferencias',
  pending: 'Quedó pendiente',
});

export const CLOSURE_CONFIRMATION_PHRASE = 'CERRAR IGUAL';

// El cierre se bloquea cuando hay algo que, si se firma sin mirar, deja al negocio sin respaldo.
export function evaluateDailyClosure(run = {}, { alerts = [] } = {}) {
  const source = run && typeof run === 'object' ? run : {};
  const difference = round2(Number(source.cash_difference || 0));
  const note = String(source.difference_note || '').trim();
  const criticalAlerts = Array.isArray(alerts)
    ? alerts.filter((alert) => String(alert?.severity || '').toUpperCase() === 'CRITICAL').length
    : Math.max(0, Number(source.critical_alerts || 0));
  const openAlerts = Array.isArray(alerts) && alerts.length
    ? alerts.filter((alert) => String(alert?.status || 'open') !== 'resolved').length
    : Math.max(0, Number(source.open_alerts || 0));

  const blockers = [];
  if (difference !== 0 && note.length < 5) {
    blockers.push({
      id: 'cash-difference',
      title: 'La caja no coincide',
      detail: `Faltan o sobran ${formatMoney(Math.abs(difference))}. Escribí qué pasó antes de cerrar.`,
    });
  }
  if (criticalAlerts > 0) {
    blockers.push({
      id: 'critical-alerts',
      title: criticalAlerts === 1 ? 'Hay 1 problema sin resolver' : `Hay ${criticalAlerts} problemas sin resolver`,
      detail: 'Son cosas que afectan cobros o comprobantes. Resolvelas o dejá escrito por qué cerrás igual.',
    });
  }

  return Object.freeze({
    sections: Object.freeze(buildClosureSections(source, { difference, openAlerts, criticalAlerts })),
    difference,
    hasDifference: difference !== 0,
    criticalAlerts,
    openAlerts,
    blockers: Object.freeze(blockers.map((blocker) => Object.freeze(blocker))),
    canClose: blockers.length === 0,
    requiresOverride: criticalAlerts > 0 && difference === 0 ? false : criticalAlerts > 0,
    closed: String(source.status || '') === 'closed',
  });
}

export function validateClosureOverride({ note, confirmation, criticalAlerts = 0 } = {}) {
  if (Number(criticalAlerts || 0) <= 0) return Object.freeze({ ok: true, message: '' });
  const trimmed = String(note || '').trim();
  if (trimmed.length < 10) {
    return Object.freeze({
      ok: false,
      message: 'Explicá en una frase por qué cerrás el día con problemas sin resolver.',
    });
  }
  if (String(confirmation || '').trim().toUpperCase() !== CLOSURE_CONFIRMATION_PHRASE) {
    return Object.freeze({
      ok: false,
      message: `Escribí ${CLOSURE_CONFIRMATION_PHRASE} para confirmar que cerrás con problemas abiertos.`,
    });
  }
  return Object.freeze({ ok: true, message: '' });
}

function buildClosureSections(run, { difference, openAlerts, criticalAlerts }) {
  const snapshot = run.snapshot && typeof run.snapshot === 'object' ? run.snapshot : {};
  const value = (path, fallback = 0) => {
    const found = path.split('.').reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), snapshot);
    return found === undefined || found === null ? fallback : found;
  };
  return CLOSURE_SECTIONS.map((id) => {
    switch (id) {
      case 'sales':
        return section(id, formatMoney(value('sales.total')), `${Number(value('sales.count'))} venta(s) registradas`);
      case 'mercadopago':
        return section(id, formatMoney(value('payments.approved_total')), `${Number(value('payments.approved_count'))} cobro(s) aprobados`);
      case 'cash':
        return section(id, formatMoney(value('cash.expected')), `Declaraste ${formatMoney(run.declared_cash)}`);
      case 'refunds':
        return section(id, formatMoney(value('payments.refunded_total')), `${Number(value('payments.refunded_count'))} devolución(es)`);
      case 'orders':
        return section(id, String(Number(value('orders.total'))), `${Number(value('orders.open'))} sin cerrar`);
      case 'stock':
        return section(id, String(Number(value('inventory.movements'))), `${Number(value('inventory.negative'))} producto(s) en negativo`);
      case 'documents':
        return section(id, String(Number(value('fiscal.authorized'))), `${Number(value('fiscal.pending'))} pendiente(s)`);
      case 'differences':
        return section(id, formatMoney(difference), difference === 0 ? 'La caja coincide' : 'Necesita explicación', difference === 0 ? 'calm' : 'critical');
      case 'pending':
        return section(id, String(openAlerts), criticalAlerts ? `${criticalAlerts} sin resolver que frenan la operación` : 'Nada que frene la operación', criticalAlerts ? 'critical' : 'calm');
      default:
        return section(id, '—', '');
    }
  });
}

function section(id, value, detail, tone = 'calm') {
  return Object.freeze({ id, label: CLOSURE_COPY[id], value: String(value), detail: String(detail || ''), tone });
}

function normalizeCheckStatus(value) {
  const status = String(value || 'unknown').toLowerCase();
  return ['ok', 'degraded', 'failed', 'unknown'].includes(status) ? status : 'unknown';
}

function checkStatusLabel(status) {
  return ({ ok: 'Listo', degraded: 'Funciona a medias', failed: 'No funciona', unknown: 'Sin verificar' })[status];
}

function defaultDetail(id, status) {
  if (status === 'ok') return 'Verificado recién.';
  if (status === 'unknown') return 'No se pudo verificar ahora.';
  return `Revisá ${CHECK_COPY[id].label.toLowerCase()} antes de abrir.`;
}

function round2(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function formatMoney(value) {
  const amount = Number(value);
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })
    .format(Number.isFinite(amount) ? amount : 0);
}
