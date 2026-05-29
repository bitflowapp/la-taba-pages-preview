import { BUSINESS_CONFIG, STORAGE_KEYS } from './config.js';
import { products, seedOrders } from './data.js';

const defaultState = () => ({
  activeCategory: 'all',
  searchQuery: '',
  cart: [],
  orders: seedOrders,
  products: products.map((product) => ({ ...product })),
  lastOrderId: seedOrders[0]?.id || null,
  adminUnlocked: readAdminFlag(),
  lastCheckoutDraft: null,
});

function readAdminFlag() {
  try {
    return sessionStorage.getItem(STORAGE_KEYS.adminUnlocked) === 'true';
  } catch (_) {
    return false;
  }
}

let state = loadState();
const listeners = new Set();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.state);
    if (!raw) return defaultState();

    const parsed = JSON.parse(raw);
    const base = defaultState();

    return {
      ...base,
      ...parsed,
      products: mergeProducts(base.products, parsed.products || []),
      orders: Array.isArray(parsed.orders) ? parsed.orders.filter(isValidOrder).map(normalizeOrder) : base.orders,
      cart: sanitizeCart(parsed.cart),
      activeCategory: typeof parsed.activeCategory === 'string' ? parsed.activeCategory : base.activeCategory,
      searchQuery: typeof parsed.searchQuery === 'string' ? parsed.searchQuery : '',
      adminUnlocked: readAdminFlag(),
    };
  } catch (_) {
    return defaultState();
  }
}

function sanitizeCart(rawCart) {
  if (!Array.isArray(rawCart)) return [];
  return rawCart
    .filter((item) => item && typeof item.productId === 'string')
    .map((item) => ({
      productId: item.productId,
      quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)),
    }));
}

function isValidOrder(order) {
  return Boolean(order && typeof order.id === 'string' && Array.isArray(order.items));
}

export function normalizeOrder(order) {
  return {
    ...order,
    statusHistory: Array.isArray(order.statusHistory) ? order.statusHistory : [],
    delivery: order.delivery && typeof order.delivery === 'object'
      ? order.delivery
      : {
          driverName: 'Sin asignar',
          driverPhone: '',
          estimatedMinutes: 0,
          currentLocationLabel: 'Pedido en el local',
        },
  };
}

function mergeProducts(baseProducts, savedProducts) {
  return baseProducts.map((baseProduct) => {
    const saved = savedProducts.find((item) => item.id === baseProduct.id);
    return saved ? { ...baseProduct, ...saved } : baseProduct;
  });
}

function persist() {
  try {
    const serializable = { ...state, adminUnlocked: undefined };
    localStorage.setItem(STORAGE_KEYS.state, JSON.stringify(serializable));
  } catch (_) {
    // Storage lleno o no disponible (modo privado): la app sigue funcionando en memoria.
  }
  try {
    sessionStorage.setItem(STORAGE_KEYS.adminUnlocked, state.adminUnlocked ? 'true' : 'false');
  } catch (_) {
    // Sin sessionStorage el modo negocio no persiste entre recargas, pero no rompe la sesión.
  }
}

export function getState() {
  return state;
}

export function setState(patch) {
  state = { ...state, ...patch };
  persist();
  listeners.forEach((listener) => listener(state));
}

export function updateState(mutator) {
  const draft = structuredCloneSafe(state);
  mutator(draft);
  state = draft;
  persist();
  listeners.forEach((listener) => listener(state));
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function money(value) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: BUSINESS_CONFIG.currency,
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export function dateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function statusLabel(status) {
  const labels = {
    received: 'Recibido',
    preparing: 'Preparando',
    ready: 'Listo para enviar',
    on_the_way: 'En camino',
    delivered: 'Entregado',
    cancelled: 'Cancelado',
  };
  return labels[status] || status;
}

export function statusClass(status) {
  const classes = {
    received: 'received',
    preparing: 'preparing',
    ready: 'ready',
    on_the_way: 'way',
    delivered: 'done',
    cancelled: 'cancelled',
  };
  return classes[status] || 'received';
}

export function paymentLabel(value) {
  const labels = {
    cash: 'Efectivo',
    transfer: 'Transferencia',
    mercado_pago_future: 'Mercado Pago a futuro',
  };
  return labels[value] || value;
}

export function deliveryModeLabel(value) {
  return value === 'pickup' ? 'Retiro en local' : 'Envío a domicilio';
}

export function createOrderId() {
  const prefix = BUSINESS_CONFIG.orderPrefix;
  const highest = getState().orders.reduce((max, order) => {
    const match = typeof order.id === 'string' && order.id.startsWith(`${prefix}-`)
      ? Number.parseInt(order.id.slice(prefix.length + 1), 10)
      : NaN;
    return Number.isFinite(match) && match > max ? match : max;
  }, 0);
  return `${prefix}-${String(highest + 1).padStart(4, '0')}`;
}

export function getProductById(productId) {
  return getState().products.find((product) => product.id === productId) || null;
}
