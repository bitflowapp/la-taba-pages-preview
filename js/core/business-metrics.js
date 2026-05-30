import { ORDER_STATUSES, isTerminalOrderStatus } from './order-status.js';
import { normalizeMoneyValue, normalizeStock } from './pricing.js';

export function getActiveOrders(orders = []) {
  if (!Array.isArray(orders)) return [];
  return orders.filter((order) => order && !isTerminalOrderStatus(order.status));
}

export function getOrdersByStatus(orders = []) {
  const counts = Object.fromEntries(ORDER_STATUSES.map((status) => [status, 0]));
  if (!Array.isArray(orders)) return counts;
  for (const order of orders) {
    if (order?.status in counts) counts[order.status] += 1;
  }
  return counts;
}

export function getLowStockProducts(products = [], threshold = 4) {
  if (!Array.isArray(products)) return [];
  return products.filter((product) => (
    product?.available
      && normalizeStock(product.stock) > 0
      && normalizeStock(product.stock) <= threshold
  ));
}

export function getBusinessMetrics(orders = [], products = [], now = new Date()) {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const activeOrders = getActiveOrders(orders);
  const ordersByStatus = getOrdersByStatus(orders);
  const lowStock = getLowStockProducts(products);
  let todayOrderCount = 0;
  let todayTotal = 0;
  let todayDeliveryCount = 0;
  let todayPickupCount = 0;
  const productTally = new Map();

  if (Array.isArray(orders)) {
    for (const order of orders) {
      const created = new Date(order?.createdAt);
      const isToday = !Number.isNaN(created.getTime()) && created >= startOfToday;
      if (!isToday || order.status === 'cancelled') continue;

      todayOrderCount += 1;
      todayTotal += normalizeMoneyValue(order.total, 0);
      if (order.deliveryMode === 'pickup') todayPickupCount += 1;
      else todayDeliveryCount += 1;

      if (Array.isArray(order.items)) {
        for (const item of order.items) {
          if (!item || typeof item.productId !== 'string') continue;
          const quantity = Math.max(0, Math.floor(Number(item.quantity) || 0));
          if (quantity <= 0) continue;
          const current = productTally.get(item.productId) || { productId: item.productId, name: item.name || item.productId, quantity: 0 };
          current.quantity += quantity;
          productTally.set(item.productId, current);
        }
      }
    }
  }

  const topProducts = [...productTally.values()]
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 3);

  return {
    activeOrders,
    lowStock,
    ordersByStatus,
    todayOrderCount,
    todayTotal,
    avgTicket: todayOrderCount > 0 ? Math.round(todayTotal / todayOrderCount) : 0,
    todayDeliveryCount,
    todayPickupCount,
    topProducts,
    ordersToHandle: ordersByStatus.received + ordersByStatus.preparing + ordersByStatus.ready + ordersByStatus.on_the_way + ordersByStatus.arriving,
  };
}
