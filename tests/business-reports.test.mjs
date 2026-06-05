import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBusinessReport,
  filterOrdersByReportPeriod,
  formatBusinessReportSummary,
} from '../js/core/business-reports.js';
import { hydrateState } from '../js/state.js';

const NOW = new Date('2026-06-04T15:00:00.000Z');

function order(overrides = {}) {
  const snapshotSubtotal = overrides.subtotal ?? overrides.total ?? 1000;
  return {
    id: overrides.id || 'LT-1',
    status: overrides.status || 'delivered',
    createdAt: Object.hasOwn(overrides, 'createdAt') ? overrides.createdAt : '2026-06-04T12:00:00.000Z',
    updatedAt: overrides.updatedAt,
    customerName: overrides.customerName || 'Cliente QA',
    customerPhone: overrides.customerPhone || '2995550000',
    address: overrides.address || 'Roca 123',
    paymentMethod: overrides.paymentMethod || 'Efectivo',
    paymentMethodCode: overrides.paymentMethodCode,
    cancelReason: overrides.cancelReason,
    coupon: overrides.coupon,
    items: overrides.items || [{ productId: 'p-vacio', name: 'Vacio snapshot', quantity: 1, unitPrice: snapshotSubtotal }],
    subtotal: overrides.subtotal ?? 1000,
    discountTotal: overrides.discountTotal,
    deliveryFee: overrides.deliveryFee ?? 0,
    total: overrides.total ?? 1000,
    statusHistory: overrides.statusHistory,
  };
}

test('business report: reporte vacio devuelve ceros sin romper', () => {
  const report = buildBusinessReport([], { now: NOW });

  assert.equal(report.totalOrders, 0);
  assert.equal(report.deliveredOrders, 0);
  assert.equal(report.cancelledOrders, 0);
  assert.equal(report.activeOrders, 0);
  assert.equal(report.netSales, 0);
  assert.equal(report.ticketAverage, 0);
  assert.deepEqual(report.topProducts, []);
  assert.equal(report.latestOrder, null);
});

test('business report: pedidos entregados suman ventas netas y ticket promedio', () => {
  const report = buildBusinessReport([
    order({ id: 'LT-1', total: 1200, subtotal: 1200 }),
    order({ id: 'LT-2', total: 1800, subtotal: 1800, paymentMethodCode: 'transfer', paymentMethod: 'Transferencia' }),
  ], { now: NOW });

  assert.equal(report.deliveredOrders, 2);
  assert.equal(report.netSales, 3000);
  assert.equal(report.ticketAverage, 1500);
});

test('business report: pedidos cancelados no suman ventas netas', () => {
  const report = buildBusinessReport([
    order({ id: 'LT-OK', total: 1000 }),
    order({ id: 'LT-CXL', status: 'cancelled', total: 5000, cancelReason: 'Sin stock' }),
  ], { now: NOW });

  assert.equal(report.totalOrders, 2);
  assert.equal(report.cancelledOrders, 1);
  assert.equal(report.netSales, 1000);
  assert.equal(report.grossSales, 1000);
});

test('business report: descuento y cupon se descuentan una sola vez', () => {
  const report = buildBusinessReport([
    order({
      subtotal: 2000,
      discountTotal: 200,
      coupon: { code: 'TABA10', discountAmount: 200 },
      total: 1800,
    }),
  ], { now: NOW });

  assert.equal(report.grossSales, 2000);
  assert.equal(report.totalDiscounts, 200);
  assert.equal(report.netSales, 1800);
});

test('business report: total inconsistente se recalcula desde snapshots del pedido', () => {
  const report = buildBusinessReport([
    order({
      items: [{ productId: 'p-vacio', name: 'Vacio snapshot', quantity: 2, unitPrice: 1000 }],
      subtotal: 2000,
      discountTotal: 200,
      deliveryFee: 300,
      total: 9999,
    }),
  ], { now: NOW });

  assert.equal(report.grossSales, 2000);
  assert.equal(report.totalDiscounts, 200);
  assert.equal(report.deliveryFees, 300);
  assert.equal(report.netSales, 2100);
});

test('business report: ranking usa snapshots del pedido', () => {
  const report = buildBusinessReport([
    order({
      id: 'LT-A',
      items: [
        { productId: 'p-old', name: 'Nombre historico A', quantity: 2, unitPrice: 900 },
        { productId: 'p-b', name: 'Nombre historico B', quantity: 1, unitPrice: 100 },
      ],
      subtotal: 1900,
      total: 1900,
    }),
    order({
      id: 'LT-B',
      items: [{ productId: 'p-b', name: 'Nombre historico B', quantity: 4, unitPrice: 100 }],
      subtotal: 400,
      total: 400,
    }),
  ], { now: NOW });

  assert.deepEqual(report.topProducts.map((item) => [item.name, item.quantity]), [
    ['Nombre historico B', 5],
    ['Nombre historico A', 2],
  ]);
  assert.equal(report.productsSoldCount, 7);
});

test('business report: ventas por metodo de pago', () => {
  const report = buildBusinessReport([
    order({ id: 'LT-CASH', paymentMethodCode: 'cash', paymentMethod: 'Efectivo', total: 1000 }),
    order({ id: 'LT-TR', paymentMethodCode: 'transfer', paymentMethod: 'Transferencia', total: 2000 }),
    order({ id: 'LT-MP', paymentMethodCode: 'mercado_pago_future', paymentMethod: 'Mercado Pago', total: 3000 }),
    order({ id: 'LT-UNK', paymentMethod: 'Cheque demo', paymentMethodCode: 'other', total: 4000 }),
  ], { now: NOW });

  assert.deepEqual(report.salesByPaymentMethod, {
    cash: 1000,
    transfer: 2000,
    mercadoPago: 3000,
    unknown: 4000,
  });
  assert.deepEqual(report.paymentMethodCounts, {
    cash: 1,
    transfer: 1,
    mercadoPago: 1,
    unknown: 1,
  });
});

test('business report: metodo de pago legacy desconocido no infla efectivo', () => {
  const hydrated = hydrateState({
    orders: [{
      id: 'LT-LEGACY',
      status: 'delivered',
      createdAt: '2026-06-04T12:00:00.000Z',
      customerName: 'Cliente legacy',
      customerPhone: '2995551111',
      address: 'Roca 123',
      deliveryMode: 'pickup',
      items: [{ productId: 'p-old', name: 'Snapshot viejo', quantity: 1, unitPrice: 1500 }],
      subtotal: 1500,
      total: 1500,
    }],
  });
  const report = buildBusinessReport(hydrated.orders, { now: NOW });

  assert.equal(hydrated.orders[0].paymentMethodCode, 'unknown');
  assert.equal(hydrated.orders[0].paymentMethod, 'Sin especificar');
  assert.equal(report.salesByPaymentMethod.cash, 0);
  assert.equal(report.salesByPaymentMethod.unknown, 1500);
});

test('business report: metodo de pago legacy con label valido conserva su bucket', () => {
  const hydrated = hydrateState({
    orders: [
      {
        id: 'LT-CASH-OLD',
        status: 'delivered',
        createdAt: '2026-06-04T12:00:00.000Z',
        paymentMethodCode: 'unknown',
        paymentMethod: 'Efectivo',
        deliveryMode: 'pickup',
        items: [{ productId: 'p-a', name: 'A', quantity: 1, unitPrice: 1000 }],
        subtotal: 1000,
        total: 1000,
      },
      {
        id: 'LT-TR-OLD',
        status: 'delivered',
        createdAt: '2026-06-04T12:00:00.000Z',
        paymentMethod: 'Transferencia',
        deliveryMode: 'pickup',
        items: [{ productId: 'p-b', name: 'B', quantity: 1, unitPrice: 2000 }],
        subtotal: 2000,
        total: 2000,
      },
      {
        id: 'LT-MP-OLD',
        status: 'delivered',
        createdAt: '2026-06-04T12:00:00.000Z',
        paymentMethod: 'Link externo',
        deliveryMode: 'pickup',
        items: [{ productId: 'p-c', name: 'C', quantity: 1, unitPrice: 3000 }],
        subtotal: 3000,
        total: 3000,
      },
    ],
  });
  const report = buildBusinessReport(hydrated.orders, { now: NOW });

  assert.equal(report.salesByPaymentMethod.cash, 1000);
  assert.equal(report.salesByPaymentMethod.transfer, 2000);
  assert.equal(report.salesByPaymentMethod.mercadoPago, 3000);
  assert.equal(report.salesByPaymentMethod.unknown, 0);
});

test('business report: cancelaciones por motivo', () => {
  const report = buildBusinessReport([
    order({ id: 'LT-C1', status: 'cancelled', cancelReason: 'Sin stock' }),
    order({ id: 'LT-C2', status: 'cancelled', cancelReason: 'Sin stock' }),
    order({ id: 'LT-C3', status: 'cancelled', cancelReason: 'Cliente no responde' }),
  ], { now: NOW });

  assert.deepEqual(report.cancellationsByReason, {
    'Sin stock': 2,
    'Cliente no responde': 1,
  });
  assert.deepEqual(report.topCancellationReason, { reason: 'Sin stock', count: 2 });
});

test('business report: filtro temporal hoy, ultimos 7 dias y todo', () => {
  const today = order({ id: 'LT-TODAY', createdAt: '2026-06-04T10:00:00.000Z' });
  const futureSameDay = order({ id: 'LT-FUTURE', createdAt: '2026-06-04T20:00:00.000Z' });
  const yesterday = order({ id: 'LT-YESTERDAY', createdAt: '2026-06-03T10:00:00.000Z' });
  const sevenDays = order({ id: 'LT-WEEK', createdAt: '2026-05-30T10:00:00.000Z' });
  const old = order({ id: 'LT-OLD', createdAt: '2026-05-20T10:00:00.000Z' });
  const noDate = order({ id: 'LT-NODATE', createdAt: null, updatedAt: null, statusHistory: [] });
  const updatedFallback = order({
    id: 'LT-UPD',
    createdAt: 'fecha rota',
    updatedAt: '2026-06-04T13:00:00.000Z',
  });
  const orders = [today, futureSameDay, yesterday, sevenDays, old, noDate, updatedFallback];

  assert.deepEqual(filterOrdersByReportPeriod(orders, { period: 'today', now: NOW }).map((item) => item.id), ['LT-TODAY', 'LT-FUTURE', 'LT-UPD']);
  assert.deepEqual(filterOrdersByReportPeriod(orders, { period: 'last7', now: NOW }).map((item) => item.id), ['LT-TODAY', 'LT-FUTURE', 'LT-YESTERDAY', 'LT-WEEK', 'LT-UPD']);
  assert.deepEqual(filterOrdersByReportPeriod(orders, { period: 'all', now: NOW }).map((item) => item.id), ['LT-TODAY', 'LT-FUTURE', 'LT-YESTERDAY', 'LT-WEEK', 'LT-OLD', 'LT-NODATE', 'LT-UPD']);
});

test('business report: pedido viejo sin campos nuevos no rompe', () => {
  const report = buildBusinessReport([{
    id: 'LT-OLD',
    status: 'delivered',
    createdAt: '2026-06-04T12:00:00.000Z',
    customerName: 'Cliente viejo',
    items: [{ productId: 'p-old', name: 'Snapshot viejo', quantity: '2', unitPrice: '500' }],
  }], { now: NOW });

  assert.equal(report.totalOrders, 1);
  assert.equal(report.netSales, 1000);
  assert.equal(report.salesByPaymentMethod.unknown, 1000);
  assert.equal(report.topProduct.name, 'Snapshot viejo');
});

test('business report: resumen copiable es legible para WhatsApp', () => {
  const report = buildBusinessReport([
    order({
      total: 1800,
      subtotal: 2000,
      discountTotal: 200,
      coupon: { code: 'TABA10', discountAmount: 200 },
      paymentMethodCode: 'cash',
    }),
  ], { now: NOW });
  const text = formatBusinessReportSummary(report, { businessName: 'La Taba', date: NOW });

  assert.match(text, /Cierre La Taba - 04\/06\/2026/);
  assert.match(text, /Ventas netas: /);
  assert.match(text, /Efectivo: /);
  assert.match(text, /Descuentos: /);
  assert.match(text, /Pedidos entregados: 1/);
  assert.match(text, /Sin especificar: /);
  assert.match(text, /Ticket promedio con delivery: /);
  assert.match(text, /Producto más vendido: Vacio snapshot/);
});
