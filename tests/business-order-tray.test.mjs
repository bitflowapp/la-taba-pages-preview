// La bandeja de trabajo del Panel: clasificación, urgencia y contacto.
//
// POR QUÉ EXISTE ESTE ARCHIVO
// ---------------------------
// La bandeja decide qué mira primero una persona que está atendiendo. Si
// clasifica mal, el pedido que hay que resolver queda sepultado entre los que
// van solos — y eso no lo detecta ninguna prueba de maquetado.
//
// La prueba que más importa es la primera: los umbrales de demora del Panel se
// comparan contra la MIGRACIÓN que los define en el servidor. Son dos lecturas
// de la misma regla —la tarea automática levanta la alerta, la bandeja la
// pinta— y sin esto se separan la primera vez que alguien ajuste una y no la
// otra, en silencio y sin que falle nada.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  TRAY_ATTENTION,
  TRAY_DELAY_RULES,
  TRAY_SECTIONS,
  buildOrderTray,
  elapsedLabel,
  elapsedMinutes,
  isProductionOrderPaymentReversed,
  orderAttentionSignals,
  orderContactLinks,
  orderItemsSummary,
  trayFlowSection,
  trayHeadline,
  whatsappDigits,
} from '../js/business/business-order-tray.js';

const AHORA = Date.parse('2026-08-28T18:00:00.000Z');
const haceMinutos = (minutos) => new Date(AHORA - minutos * 60_000).toISOString();

function pedido(extra = {}) {
  return {
    id: 'LT-2041',
    backendId: '00000000-0000-4000-8000-000000000001',
    workflowStatus: 'submitted',
    status: 'received',
    customerName: 'Lucía Fernández',
    customerPhone: '2995550101',
    deliveryMode: 'delivery',
    createdAt: haceMinutos(2),
    updatedAt: haceMinutos(2),
    total: 14790,
    currencyCode: 'ARS',
    items: [{ productId: 'p1', name: 'Cerveza Patagonia 730 ml', quantity: 4, unitPrice: 2400 }],
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// 1 · Los umbrales son los del servidor, no unos parecidos.
// ---------------------------------------------------------------------------

test('los tres umbrales de demora son EXACTAMENTE los de la migración del servidor', () => {
  const sql = fs.readFileSync(
    new URL('../supabase/migrations/20260810140000_scheduler_stalled_needs_history.sql', import.meta.url),
    'utf8',
  );

  // ORDER_NOT_ACCEPTED: entró y nadie lo aceptó.
  const sinAceptar = sql.match(
    /ORDER_NOT_ACCEPTED[\s\S]*?o\.created_at < clock_timestamp\(\) - interval '(\d+) minutes'/,
  );
  assert.ok(sinAceptar, 'no se encontró la cláusula de ORDER_NOT_ACCEPTED');
  assert.equal(Number(sinAceptar[1]), TRAY_DELAY_RULES.notAcceptedAfterMinutes);

  // ORDER_STALLED: tiempo prometido + margen.
  const demorado = sql.match(
    /ORDER_STALLED[\s\S]*?coalesce\(o\.preparation_estimate_minutes, (\d+)\) \+ (\d+)\)/,
  );
  assert.ok(demorado, 'no se encontró la cláusula de ORDER_STALLED');
  assert.equal(Number(demorado[1]), TRAY_DELAY_RULES.defaultPreparationMinutes);
  assert.equal(Number(demorado[2]), TRAY_DELAY_RULES.stalledGraceMinutes);

  // ORDER_READY_WITHOUT_RIDER: listo, delivery, sin rider.
  const sinRider = sql.match(
    /ORDER_READY_WITHOUT_RIDER[\s\S]*?coalesce\(o\.ready_at, o\.updated_at\) < clock_timestamp\(\) - interval '(\d+) minutes'/,
  );
  assert.ok(sinRider, 'no se encontró la cláusula de ORDER_READY_WITHOUT_RIDER');
  assert.equal(Number(sinRider[1]), TRAY_DELAY_RULES.readyWithoutRiderAfterMinutes);
});

test('el mapeo trae las tres marcas de tiempo que esos umbrales necesitan', () => {
  // Sin `acknowledgedAt`, `readyAt` y `preparationEstimateMinutes` en el objeto
  // de pedido, la bandeja no puede leer la misma regla que el servidor y se
  // queda con «hace cuánto entró», que no es lo mismo.
  const repo = fs.readFileSync(
    new URL('../js/repositories/supabase_order_repository.js', import.meta.url),
    'utf8',
  );
  assert.match(repo, /acknowledgedAt: normalizeOptionalIso\(row\.acknowledged_at\)/);
  assert.match(repo, /readyAt: normalizeOptionalIso\(row\.ready_at\)/);
  assert.match(repo, /preparationEstimateMinutes/);
});

// ---------------------------------------------------------------------------
// 2 · El reloj.
// ---------------------------------------------------------------------------

test('el tiempo transcurrido se dice como lo diría una persona', () => {
  assert.equal(elapsedLabel(haceMinutos(0), AHORA), 'recién');
  assert.equal(elapsedLabel(haceMinutos(1), AHORA), 'hace 1 min');
  assert.equal(elapsedLabel(haceMinutos(59), AHORA), 'hace 59 min');
  assert.equal(elapsedLabel(haceMinutos(60), AHORA), 'hace 1 h');
  assert.equal(elapsedLabel(haceMinutos(100), AHORA), 'hace 1 h 40 min');
  // Una marca ilegible no puede inventar una espera de cincuenta y siete años.
  assert.equal(elapsedLabel('', AHORA), 'sin hora');
  assert.equal(elapsedMinutes('no es una fecha', AHORA), null);
  // Un reloj adelantado en el aparato no produce esperas negativas.
  assert.equal(elapsedMinutes(new Date(AHORA + 90_000).toISOString(), AHORA), 0);
});

// ---------------------------------------------------------------------------
// 3 · Las señales de atención, una por contrato real.
// ---------------------------------------------------------------------------

test('un pedido sin aceptar sólo se marca DESPUÉS del umbral del servidor', () => {
  const justoAntes = pedido({ createdAt: haceMinutos(TRAY_DELAY_RULES.notAcceptedAfterMinutes - 1) });
  assert.deepEqual(orderAttentionSignals(justoAntes, { now: AHORA }), []);

  const justoDespues = pedido({ createdAt: haceMinutos(TRAY_DELAY_RULES.notAcceptedAfterMinutes) });
  assert.deepEqual(
    orderAttentionSignals(justoDespues, { now: AHORA }).map((s) => s.code),
    ['ORDER_NOT_ACCEPTED'],
  );
});

test('un pedido ya aceptado no vuelve a contar como «sin aceptar»', () => {
  // Es la misma condición del servidor: `acknowledged_at is null`. Sin mirarla,
  // un pedido aceptado hace un minuto pero creado hace una hora quedaría
  // marcado como si nadie lo hubiera atendido.
  const aceptado = pedido({ createdAt: haceMinutos(90), acknowledgedAt: haceMinutos(1) });
  assert.deepEqual(orderAttentionSignals(aceptado, { now: AHORA }), []);
});

test('un pedido en preparación se marca cuando pasa el tiempo prometido más el margen', () => {
  const base = { workflowStatus: 'preparing', status: 'preparing' };
  const prometido = 20;
  const limite = prometido + TRAY_DELAY_RULES.stalledGraceMinutes;

  const aTiempo = pedido({
    ...base,
    acknowledgedAt: haceMinutos(limite),
    preparationEstimateMinutes: prometido,
  });
  assert.deepEqual(orderAttentionSignals(aTiempo, { now: AHORA }), []);

  const pasado = pedido({
    ...base,
    acknowledgedAt: haceMinutos(limite + 1),
    preparationEstimateMinutes: prometido,
  });
  assert.deepEqual(orderAttentionSignals(pasado, { now: AHORA }).map((s) => s.code), ['ORDER_STALLED']);
});

test('sin tiempo prometido se usa el mismo defecto que el servidor', () => {
  const limite = TRAY_DELAY_RULES.defaultPreparationMinutes + TRAY_DELAY_RULES.stalledGraceMinutes;
  const sinPromesa = pedido({
    workflowStatus: 'preparing',
    status: 'preparing',
    acknowledgedAt: haceMinutos(limite + 1),
    preparationEstimateMinutes: null,
  });
  assert.deepEqual(orderAttentionSignals(sinPromesa, { now: AHORA }).map((s) => s.code), ['ORDER_STALLED']);
});

test('un pedido listo y sin repartidor se marca; con repartidor, no', () => {
  const listo = (extra) => pedido({
    workflowStatus: 'ready',
    status: 'ready',
    deliveryMode: 'delivery',
    readyAt: haceMinutos(TRAY_DELAY_RULES.readyWithoutRiderAfterMinutes + 5),
    ...extra,
  });
  assert.deepEqual(
    orderAttentionSignals(listo({}), { now: AHORA }).map((s) => s.code),
    ['ORDER_READY_WITHOUT_RIDER'],
  );
  assert.deepEqual(orderAttentionSignals(listo({ assignedRiderId: 'rider-1' }), { now: AHORA }), []);
  // Un retiro no espera a ningún repartidor: marcarlo sería pedir una acción
  // que no existe.
  assert.deepEqual(orderAttentionSignals(listo({ deliveryMode: 'pickup' }), { now: AHORA }), []);
});

test('el rechazo del repartidor se dice en la bandeja y no dentro de la tarjeta', () => {
  const listo = pedido({ workflowStatus: 'ready', status: 'ready', readyAt: haceMinutos(1) });
  const señales = orderAttentionSignals(listo, {
    now: AHORA,
    offer: { status: 'rejected', riderDisplayName: 'Camila' },
  });
  assert.deepEqual(señales.map((s) => s.code), ['RIDER_OFFER_REJECTED']);
  // Una oferta esperando respuesta NO es una alerta: es el curso normal.
  assert.deepEqual(orderAttentionSignals(listo, { now: AHORA, offer: { status: 'pending' } }), []);
});

test('un pedido con la plata devuelta DICE por qué se quedó sin acción', () => {
  // Antes de esto, `canAdvanceProductionBusinessOrder` le sacaba el botón y la
  // tarjeta quedaba muda: un pedido con el que no se puede hacer nada y sin una
  // sola línea que explicara el motivo.
  const orden = pedido({ backendId: 'orden-1' });
  const pagos = [{
    order_id: 'orden-1',
    internal_status: 'refunded',
    amount: 14790,
    refunded_amount: 14790,
  }];
  assert.equal(isProductionOrderPaymentReversed(orden, pagos), true);
  assert.deepEqual(
    orderAttentionSignals(orden, { now: AHORA, payments: pagos }).map((s) => s.code),
    ['PAYMENT_REFUNDED'],
  );
});

test('una devolución en curso avisa que el pedido no se entrega todavía', () => {
  const orden = pedido({ backendId: 'orden-2' });
  const pagos = [{
    order_id: 'orden-2',
    internal_status: 'approved',
    latest_refund_status: 'processing',
    amount: 14790,
  }];
  assert.equal(isProductionOrderPaymentReversed(orden, pagos), false);
  assert.deepEqual(
    orderAttentionSignals(orden, { now: AHORA, payments: pagos }).map((s) => s.code),
    ['PAYMENT_REFUND_IN_PROGRESS'],
  );
});

test('un pago de otro pedido no contamina esta tarjeta', () => {
  const orden = pedido({ backendId: 'orden-3' });
  const pagos = [{ order_id: 'otra-orden', internal_status: 'refunded', amount: 100, refunded_amount: 100 }];
  assert.deepEqual(orderAttentionSignals(orden, { now: AHORA, payments: pagos }), []);
});

test('el texto de las señales es de mostrador, no de base de datos', () => {
  for (const señal of Object.values(TRAY_ATTENTION)) {
    assert.doesNotMatch(señal.label, /_/, `«${señal.label}» parece un enum`);
    assert.doesNotMatch(señal.label, /[A-Z]{3,}/, `«${señal.label}» parece un código`);
    assert.ok(señal.detail.length > 10, `«${señal.code}» no dice qué hacer`);
  }
});

// ---------------------------------------------------------------------------
// 4 · La bandeja completa.
// ---------------------------------------------------------------------------

test('cada estado cae en su carril', () => {
  const carril = (workflowStatus) => trayFlowSection({ workflowStatus });
  assert.equal(carril('submitted'), 'nuevos');
  assert.equal(carril('accepted'), 'preparando');
  assert.equal(carril('preparing'), 'preparando');
  assert.equal(carril('ready'), 'listos');
  assert.equal(carril('assigned'), 'entrega');
  assert.equal(carril('picked_up'), 'entrega');
  assert.equal(carril('on_the_way'), 'entrega');
  assert.equal(carril('arrived'), 'entrega');
});

test('un pedido que requiere atención sube arriba y NO aparece dos veces', () => {
  const orders = [
    pedido({ id: 'LT-1', backendId: 'b1', createdAt: haceMinutos(1) }),
    pedido({ id: 'LT-2', backendId: 'b2', createdAt: haceMinutos(30) }),
    pedido({
      id: 'LT-3', backendId: 'b3', workflowStatus: 'preparing', status: 'preparing',
      acknowledgedAt: haceMinutos(5),
    }),
  ];
  const tray = buildOrderTray(orders, { now: AHORA });
  const ids = tray.sections.flatMap((s) => s.orders.map((o) => o.id));
  assert.equal(ids.length, new Set(ids).size, 'un pedido apareció en dos secciones');
  assert.equal(tray.sections[0].id, 'atencion');
  assert.deepEqual(tray.sections[0].orders.map((o) => o.id), ['LT-2']);
  assert.equal(tray.counts.atencion, 1);
  assert.equal(tray.counts.nuevos, 1);
  assert.equal(tray.counts.preparando, 1);
  assert.equal(tray.total, 3);
});

test('las secciones vacías no se dibujan', () => {
  const tray = buildOrderTray([pedido()], { now: AHORA });
  assert.deepEqual(tray.sections.map((s) => s.id), ['nuevos']);
});

test('el orden que trae el coordinador NO se recalcula dentro de la sección', () => {
  // La lista llega ordenada por estado y antigüedad desde
  // `compareBusinessInboxOrders`. Reordenarla acá sería una segunda autoridad
  // sobre lo mismo, y las dos se separarían.
  const orders = [
    pedido({ id: 'LT-A', backendId: 'a', createdAt: haceMinutos(9) }),
    pedido({ id: 'LT-B', backendId: 'b', createdAt: haceMinutos(3) }),
  ];
  const tray = buildOrderTray(orders, { now: AHORA });
  assert.deepEqual(tray.sections[0].orders.map((o) => o.id), ['LT-A', 'LT-B']);
});

test('dentro de atención manda la señal más grave', () => {
  const orders = [
    pedido({
      id: 'LT-LISTO', backendId: 'l', workflowStatus: 'ready', status: 'ready',
      readyAt: haceMinutos(60),
    }),
    pedido({ id: 'LT-NUEVO', backendId: 'n', createdAt: haceMinutos(20) }),
  ];
  const tray = buildOrderTray(orders, { now: AHORA });
  assert.deepEqual(tray.sections[0].orders.map((o) => o.id), ['LT-NUEVO', 'LT-LISTO']);
});

test('el resumen del turno dice lo que hay, sin inventar', () => {
  assert.equal(trayHeadline(buildOrderTray([], { now: AHORA })), 'Sin pedidos activos');
  const tray = buildOrderTray([
    pedido({ id: 'LT-1', backendId: '1', createdAt: haceMinutos(30) }),
    pedido({ id: 'LT-2', backendId: '2' }),
    pedido({ id: 'LT-3', backendId: '3', workflowStatus: 'preparing', status: 'preparing', acknowledgedAt: haceMinutos(1) }),
  ], { now: AHORA });
  assert.equal(trayHeadline(tray), '1 requiere atención · 1 nuevo · 1 en curso');
});

test('las secciones declaradas y las que la bandeja reparte son las mismas', () => {
  const declaradas = new Set(TRAY_SECTIONS.map((s) => s.id));
  const tray = buildOrderTray([], { now: AHORA });
  assert.deepEqual(new Set(Object.keys(tray.counts)), declaradas);
});

// ---------------------------------------------------------------------------
// 5 · El contacto.
// ---------------------------------------------------------------------------

test('WhatsApp compone el número internacional y no inventa uno cuando no puede', () => {
  // Un número local argentino necesita país 54 y el 9 de celular.
  assert.equal(whatsappDigits('2995550101'), '5492995550101');
  assert.equal(whatsappDigits('299 555 0101'), '5492995550101');
  // El 0 de larga distancia no viaja al formato internacional.
  assert.equal(whatsappDigits('02995550101'), '5492995550101');
  // Ya completo, se respeta.
  assert.equal(whatsappDigits('5492995550101'), '5492995550101');
  // Con país pero sin el 9 de celular, se agrega.
  assert.equal(whatsappDigits('542995550101'), '5492995550101');
  // Lo que no da un número plausible NO produce enlace: un `wa.me` mal armado
  // abre WhatsApp con un error, que es peor que no ofrecerlo.
  assert.equal(whatsappDigits('123'), '');
  assert.equal(whatsappDigits(''), '');
  assert.equal(whatsappDigits(null), '');
});

test('el teléfono siempre se puede marcar, aunque WhatsApp no se pueda armar', () => {
  const conNumeroRaro = orderContactLinks(pedido({ customerPhone: '123' }));
  assert.equal(conNumeroRaro.tel, 'tel:123');
  assert.equal(conNumeroRaro.whatsapp, '');

  const normal = orderContactLinks(pedido());
  assert.equal(normal.display, '2995550101');
  assert.equal(normal.tel, 'tel:2995550101');
  assert.equal(normal.whatsapp, 'https://wa.me/5492995550101');

  // Sin teléfono no se dibuja la fila: no hay número que mostrar.
  assert.deepEqual(orderContactLinks(pedido({ customerPhone: '' })), { display: '', tel: '', whatsapp: '' });
});

test('el resumen de productos cabe en una línea y dice cuántos faltan', () => {
  assert.equal(orderItemsSummary(pedido()), '4 × Cerveza Patagonia 730 ml');
  const varios = pedido({
    items: [
      { name: 'Cerveza', quantity: 4 },
      { name: 'Papas', quantity: 2 },
      { name: 'Hielo', quantity: 1 },
    ],
  });
  assert.equal(orderItemsSummary(varios), '4 × Cerveza +2 más');
  assert.equal(orderItemsSummary(pedido({ items: [] })), '');
});
