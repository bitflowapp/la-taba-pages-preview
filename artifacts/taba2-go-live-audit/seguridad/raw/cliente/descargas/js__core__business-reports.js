const KNOWN_STATUSES = Object.freeze([
  'received',
  'preparing',
  'ready',
  'on_the_way',
  'arriving',
  'delivered',
  'cancelled',
  'unknown',
]);

const PAYMENT_BUCKETS = Object.freeze(['cash', 'transfer', 'mercadoPago', 'unknown']);
const TERMINAL_CANCELLED = new Set(['cancelled', 'canceled', 'cancelado']);
const TERMINAL_DELIVERED = new Set(['delivered', 'entregado']);
const ACTIVE_STATUSES = new Set(['received', 'preparing', 'ready', 'on_the_way', 'arriving']);
const REPORT_PERIODS = new Set(['today', 'last7', 'all']);

export function normalizeReportPeriod(value) {
  const candidate = String(value || '').trim().toLowerCase();
  if (candidate === '7d' || candidate === 'last_7_days' || candidate === 'week') return 'last7';
  return REPORT_PERIODS.has(candidate) ? candidate : 'today';
}

export function filterOrdersByReportPeriod(orders = [], { period = 'today', now = new Date() } = {}) {
  if (!Array.isArray(orders)) return [];
  const normalizedPeriod = normalizeReportPeriod(period);
  if (normalizedPeriod === 'all') return orders.filter(Boolean);

  const anchor = validDate(now) || new Date();
  const start = startOfLocalDay(anchor);
  const end = endOfLocalDay(anchor);
  if (normalizedPeriod === 'last7') start.setDate(start.getDate() - 6);

  return orders.filter((order) => {
    if (!order) return false;
    const date = orderDate(order);
    return Boolean(date && date >= start && date <= end);
  });
}

export function buildBusinessReport(orders = [], options = {}) {
  const period = normalizeReportPeriod(options.period);
  const now = validDate(options.now) || new Date();
  const filteredOrders = filterOrdersByReportPeriod(orders, { period, now });
  const ordersByStatus = Object.fromEntries(KNOWN_STATUSES.map((status) => [status, 0]));
  const salesByPaymentMethod = emptyPaymentTotals();
  const paymentMethodCounts = emptyPaymentTotals();
  const cancellationsByReason = {};
  const productTally = new Map();
  const customerKeys = new Set();

  let deliveredOrders = 0;
  let cancelledOrders = 0;
  let activeOrders = 0;
  let grossSales = 0;
  let totalDiscounts = 0;
  let netSales = 0;
  let deliveryFees = 0;
  let productsSoldCount = 0;
  let latestOrder = null;
  let latestOrderAt = null;

  for (const rawOrder of filteredOrders) {
    const order = normalizeReportOrder(rawOrder);
    const status = normalizeReportStatus(order.status);
    ordersByStatus[status] = (ordersByStatus[status] || 0) + 1;

    const date = orderDate(order);
    if (date && (!latestOrderAt || date > latestOrderAt)) {
      latestOrder = rawOrder;
      latestOrderAt = date;
    }

    const customerKey = customerIdentity(order);
    if (customerKey) customerKeys.add(customerKey);

    if (isCancelledStatus(status)) {
      cancelledOrders += 1;
      const reason = normalizeCancelReason(order.cancelReason);
      cancellationsByReason[reason] = (cancellationsByReason[reason] || 0) + 1;
      continue;
    }

    if (isActiveStatus(status)) activeOrders += 1;
    if (!isDeliveredStatus(status)) continue;

    deliveredOrders += 1;
    const amounts = orderAmounts(order);
    const net = amounts.total;
    grossSales += amounts.subtotal;
    totalDiscounts += amounts.discountTotal;
    deliveryFees += amounts.deliveryFee;
    netSales += net;

    const paymentBucket = paymentMethodBucket(order);
    salesByPaymentMethod[paymentBucket] += net;
    paymentMethodCounts[paymentBucket] += 1;

    for (const item of order.items) {
      const quantity = normalizeQuantity(item.quantity);
      if (quantity <= 0) continue;
      const productId = String(item.productId || item.name || 'unknown').trim() || 'unknown';
      const current = productTally.get(productId) || {
        productId,
        name: sanitizeLabel(item.name || item.productId || 'Producto'),
        quantity: 0,
        total: 0,
      };
      const unitPrice = moneyValue(item.unitPrice, 0);
      current.quantity += quantity;
      current.total += quantity * unitPrice;
      productTally.set(productId, current);
      productsSoldCount += quantity;
    }
  }

  const topProducts = [...productTally.values()]
    .sort((a, b) => (b.quantity - a.quantity) || (b.total - a.total) || a.name.localeCompare(b.name))
    .map((item, index) => ({ ...item, rank: index + 1 }));
  const cancellationReasons = Object.entries(cancellationsByReason)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => (b.count - a.count) || a.reason.localeCompare(b.reason));

  return {
    period,
    generatedAt: now.toISOString(),
    totalOrders: filteredOrders.length,
    deliveredOrders,
    cancelledOrders,
    activeOrders,
    grossSales,
    totalDiscounts,
    netSales,
    deliveryFees,
    ticketAverage: deliveredOrders > 0 ? Math.round(netSales / deliveredOrders) : 0,
    productsSoldCount,
    topProducts,
    topProduct: topProducts[0] || null,
    salesByPaymentMethod,
    paymentMethodCounts,
    cancellationsByReason,
    cancellationReasons,
    topCancellationReason: cancellationReasons[0] || null,
    ordersByStatus,
    uniqueCustomers: customerKeys.size,
    latestOrder,
    latestOrderAt: latestOrderAt ? latestOrderAt.toISOString() : null,
    latestOrderTime: latestOrderAt ? formatLocalTime(latestOrderAt) : '',
  };
}

export function formatBusinessReportSummary(report, options = {}) {
  const safeReport = report && typeof report === 'object' ? report : buildBusinessReport([]);
  const businessName = sanitizeLabel(options.businessName || 'La Taba');
  const date = validDate(options.date || safeReport.generatedAt) || new Date();
  const topProductName = safeReport.topProduct?.name || 'Sin ventas';
  return [
    `Cierre ${businessName} - ${formatLocalDate(date)}`,
    `Ventas netas: ${formatMoney(safeReport.netSales)}`,
    `Pago a coordinar: ${formatMoney(safeReport.salesByPaymentMethod?.unknown)}`,
    `Descuentos: ${formatMoney(safeReport.totalDiscounts)}`,
    `Pedidos entregados: ${safeReport.deliveredOrders || 0}`,
    `Cancelados: ${safeReport.cancelledOrders || 0}`,
    `Ticket promedio con delivery: ${formatMoney(safeReport.ticketAverage)}`,
    `Producto más vendido: ${topProductName}`,
  ].join('\n');
}

export function formatMoney(value) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(moneyValue(value, 0));
}

export function periodLabel(period) {
  const normalized = normalizeReportPeriod(period);
  if (normalized === 'last7') return 'Últimos 7 días';
  if (normalized === 'all') return 'Todo';
  return 'Hoy';
}

function normalizeReportOrder(order) {
  const source = order && typeof order === 'object' ? order : {};
  return {
    ...source,
    status: source.status,
    items: Array.isArray(source.items) ? source.items : [],
  };
}

function orderAmounts(order) {
  const itemSnapshot = order.items.reduce((result, item) => {
    const quantity = normalizeQuantity(item?.quantity);
    const unitPrice = optionalMoneyValue(item?.unitPrice ?? item?.price ?? item?.product?.price);
    if (quantity <= 0 || unitPrice === null) return result;
    result.subtotal += quantity * unitPrice;
    result.hasSnapshotItems = true;
    return result;
  }, { subtotal: 0, hasSnapshotItems: false });

  const explicitSubtotal = optionalMoneyValue(order.subtotal ?? order.totals?.subtotal);
  const fallbackTotal = optionalMoneyValue(order.total ?? order.totals?.total);
  const subtotal = itemSnapshot.hasSnapshotItems
    ? itemSnapshot.subtotal
    : explicitSubtotal ?? Math.max(0, (fallbackTotal || 0) - moneyValue(order.deliveryFee ?? order.totals?.deliveryFee, 0));
  const canComputeTotal = itemSnapshot.hasSnapshotItems || explicitSubtotal !== null;
  const discountTotal = Math.min(subtotal, moneyValue(
    order.discountTotal ?? order.totals?.discountTotal ?? order.coupon?.discountAmount,
    0,
  ));
  const deliveryFee = moneyValue(order.deliveryFee ?? order.totals?.deliveryFee, 0);
  // Con discountTotal mapeado desde el backend, el recálculo protector coincide
  // con la invariante de la base (total = subtotal - discount_total + delivery_fee)
  // también en pedidos con combo; antes el descuento llegaba en 0 e inflaba.
  const computedTotal = Math.max(0, subtotal - discountTotal) + deliveryFee;
  const total = canComputeTotal ? computedTotal : fallbackTotal ?? computedTotal;
  return { subtotal, discountTotal, deliveryFee, total };
}

function normalizeReportStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'canceled' || status === 'cancelado') return 'cancelled';
  if (KNOWN_STATUSES.includes(status)) return status;
  if (TERMINAL_DELIVERED.has(status)) return 'delivered';
  if (TERMINAL_CANCELLED.has(status)) return 'cancelled';
  return 'unknown';
}

function isDeliveredStatus(status) {
  return TERMINAL_DELIVERED.has(status);
}

function isCancelledStatus(status) {
  return TERMINAL_CANCELLED.has(status);
}

function isActiveStatus(status) {
  return ACTIVE_STATUSES.has(status) || status === 'unknown';
}

function paymentMethodBucket(order) {
  const raw = `${order.paymentMethodCode || ''} ${order.paymentMethod || ''}`.toLowerCase();
  if (!raw.trim()) return 'unknown';
  if (raw.includes('cash') || raw.includes('efectivo')) return 'cash';
  if (raw.includes('transfer')) return 'transfer';
  if (raw.includes('mercado') || raw.includes('mp') || raw.includes('link')) return 'mercadoPago';
  return 'unknown';
}

function customerIdentity(order) {
  const customer = order.customer && typeof order.customer === 'object' ? order.customer : {};
  const parts = [
    customer.phone,
    order.customerPhone,
    customer.whatsapp,
    customer.name,
    order.customerName,
    order.address,
    order.addressDetails?.label,
  ].map((value) => sanitizeLabel(value).toLowerCase()).filter(Boolean);
  return parts.length >= 1 ? parts.join('|') : '';
}

function normalizeCancelReason(value) {
  return sanitizeLabel(value || 'Sin motivo') || 'Sin motivo';
}

function sanitizeLabel(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeQuantity(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
}

function moneyValue(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Math.max(0, Math.round(Number(fallback) || 0));
  return Math.max(0, Math.round(numeric));
}

function optionalMoneyValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.round(numeric));
}

function orderDate(order) {
  return validDate(order?.createdAt) || validDate(order?.updatedAt) || latestHistoryDate(order?.statusHistory);
}

function latestHistoryDate(history) {
  if (!Array.isArray(history)) return null;
  return history
    .map((entry) => validDate(entry?.at))
    .filter(Boolean)
    .sort((a, b) => b.getTime() - a.getTime())[0] || null;
}

function validDate(value) {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfLocalDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfLocalDay(value) {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

function formatLocalDate(value) {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(value);
}

function formatLocalTime(value) {
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
}

function emptyPaymentTotals() {
  return Object.fromEntries(PAYMENT_BUCKETS.map((bucket) => [bucket, 0]));
}
