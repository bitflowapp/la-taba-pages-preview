import { STORAGE_KEYS } from '../config.js';
import { buildBusinessReport } from './business-reports.js';
import {
  getStorageArea,
  safeJsonParse,
  safeStorageGet,
  safeStorageSet,
} from './storage.js';

export function readCashboxClosures({ storage = defaultStorage() } = {}) {
  const parsed = safeJsonParse(safeStorageGet(storage, STORAGE_KEYS.cashboxClosures), []);
  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalizeCashboxClosure).filter(Boolean);
}

export function saveCashboxClosure(report, options = {}) {
  const storage = options.storage || defaultStorage();
  const sourceReport = report && typeof report === 'object'
    ? report
    : buildBusinessReport([], { period: 'today', now: options.now });
  const closure = createCashboxClosure(sourceReport, options);
  const closures = [closure, ...readCashboxClosures({ storage })].slice(0, 20);
  const ok = safeStorageSet(storage, STORAGE_KEYS.cashboxClosures, JSON.stringify(closures));
  return { ok, closure, closures };
}

export function createCashboxClosure(report, { now = new Date() } = {}) {
  const closedAt = normalizeDate(now).toISOString();
  return {
    id: `cashbox-${closedAt}`,
    closedAt,
    period: report.period || 'today',
    metrics: {
      netSales: moneyValue(report.netSales),
      grossSales: moneyValue(report.grossSales),
      totalDiscounts: moneyValue(report.totalDiscounts),
      deliveryFees: moneyValue(report.deliveryFees),
      ticketAverage: moneyValue(report.ticketAverage),
      deliveredOrders: Math.max(0, Math.floor(Number(report.deliveredOrders) || 0)),
      cancelledOrders: Math.max(0, Math.floor(Number(report.cancelledOrders) || 0)),
      salesByPaymentMethod: {
        cash: moneyValue(report.salesByPaymentMethod?.cash),
        transfer: moneyValue(report.salesByPaymentMethod?.transfer),
        mercadoPago: moneyValue(report.salesByPaymentMethod?.mercadoPago),
        unknown: moneyValue(report.salesByPaymentMethod?.unknown),
      },
      topProductName: String(report.topProduct?.name || ''),
    },
  };
}

function normalizeCashboxClosure(value) {
  if (!value || typeof value !== 'object') return null;
  const closedAt = normalizeDate(value.closedAt, null);
  if (!closedAt) return null;
  const metrics = value.metrics && typeof value.metrics === 'object' ? value.metrics : {};
  const salesByPaymentMethod = metrics.salesByPaymentMethod && typeof metrics.salesByPaymentMethod === 'object'
    ? metrics.salesByPaymentMethod
    : {};
  return {
    id: String(value.id || `cashbox-${closedAt.toISOString()}`),
    closedAt: closedAt.toISOString(),
    period: String(value.period || 'today'),
    metrics: {
      netSales: moneyValue(metrics.netSales),
      grossSales: moneyValue(metrics.grossSales),
      totalDiscounts: moneyValue(metrics.totalDiscounts),
      deliveryFees: moneyValue(metrics.deliveryFees),
      ticketAverage: moneyValue(metrics.ticketAverage),
      deliveredOrders: Math.max(0, Math.floor(Number(metrics.deliveredOrders) || 0)),
      cancelledOrders: Math.max(0, Math.floor(Number(metrics.cancelledOrders) || 0)),
      salesByPaymentMethod: {
        cash: moneyValue(salesByPaymentMethod.cash),
        transfer: moneyValue(salesByPaymentMethod.transfer),
        mercadoPago: moneyValue(salesByPaymentMethod.mercadoPago),
        unknown: moneyValue(salesByPaymentMethod.unknown),
      },
      topProductName: String(metrics.topProductName || ''),
    },
  };
}

function defaultStorage() {
  return getStorageArea('localStorage');
}

function moneyValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.round(numeric));
}

function normalizeDate(value, fallback = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isNaN(date.getTime())) return date;
  return fallback;
}
