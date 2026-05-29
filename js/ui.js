import { BUSINESS_CONFIG } from './config.js';
import { categories } from './data.js';
import {
  dateTime,
  deliveryModeLabel,
  getProductById,
  getState,
  money,
  setState,
  statusClass,
  statusLabel,
} from './state.js';
import {
  getCartCount,
  getCartItems,
  getCartSubtotal,
  getCartTotal,
  getDeliveryFee,
  validateCartForCheckout,
} from './cart.js';
import { buildDraftMessageFromCart, getLastOrder } from './orders.js';

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const trackingSteps = [
  { status: 'received', label: 'Recibido' },
  { status: 'preparing', label: 'Preparando' },
  { status: 'ready', label: 'Listo' },
  { status: 'on_the_way', label: 'En camino' },
  { status: 'delivered', label: 'Entregado' },
];

export function applyBusinessConfig() {
  setText('[data-business-name]', BUSINESS_CONFIG.businessName);
  setText('[data-business-subtitle]', BUSINESS_CONFIG.subtitle);
  setText('[data-min-order]', money(BUSINESS_CONFIG.minDeliveryOrder));
  setText('[data-delivery-fee]', money(BUSINESS_CONFIG.deliveryFee));
  setText('[data-business-profile-name]', BUSINESS_CONFIG.businessName);
  setText('[data-business-address]', BUSINESS_CONFIG.address);
  setText('[data-business-hours]', BUSINESS_CONFIG.openingHoursLabel);
  setText('[data-business-zone]', BUSINESS_CONFIG.deliveryZone);

  const status = $('[data-open-status]');
  if (status) {
    const hour = new Date().getHours();
    const isOpen = hour >= BUSINESS_CONFIG.openHour && hour < BUSINESS_CONFIG.closeHour;
    status.textContent = isOpen
      ? `Abierto ahora · cierra a las ${BUSINESS_CONFIG.closeHour}:00`
      : `Cerrado ahora · pedidos programables`;
  }
}

function setText(selector, value) {
  $$(selector).forEach((node) => { node.textContent = value; });
}

export function renderNavigation() {
  const hash = window.location.hash.replace('#', '') || 'catalogo';
  $$('[data-nav-link]').forEach((link) => {
    link.classList.toggle('active', link.dataset.navLink === hash);
  });
}

export function renderAdminVisibility() {
  const { adminUnlocked } = getState();
  $$('[data-admin-area]').forEach((node) => node.classList.toggle('hidden', !adminUnlocked));
  $$('[data-admin-toggle], [data-admin-toggle-secondary]').forEach((button) => {
    button.textContent = adminUnlocked ? 'Volver a vista cliente' : 'Administrar pedidos';
  });
}

export function renderCatalog() {
  renderCategories();
  renderProducts();
}

function renderCategories() {
  const container = $('[data-category-strip]');
  if (!container) return;
  const { activeCategory } = getState();

  container.innerHTML = categories.map((category) => `
    <button class="category-button ${activeCategory === category.id ? 'active' : ''}" type="button" data-category-id="${category.id}">
      ${category.icon} ${escapeHtml(category.name)}
    </button>
  `).join('');
}

function renderProducts() {
  const container = $('[data-product-grid]');
  if (!container) return;

  const state = getState();
  const query = state.searchQuery.trim().toLowerCase();
  const filteredProducts = state.products.filter((product) => {
    const matchesCategory = state.activeCategory === 'all' || product.categoryId === state.activeCategory;
    const matchesQuery = !query || [product.name, product.description, product.categoryId].join(' ').toLowerCase().includes(query);
    return matchesCategory && matchesQuery;
  });

  if (!filteredProducts.length) {
    container.innerHTML = '<div class="empty-state">No encontré productos con ese filtro. Probá con otra categoría.</div>';
    return;
  }

  container.innerHTML = filteredProducts.map((product) => {
    const outOfStock = product.stock <= 0 || !product.available;
    return `
      <article class="product-card ${outOfStock ? 'out-of-stock' : ''}">
        <div class="product-top">
          <button class="product-icon" type="button" data-product-detail="${product.id}" aria-label="Ver ${escapeHtml(product.name)}">${product.icon}</button>
          ${stockPill(product)}
        </div>
        <h3>${escapeHtml(product.name)}</h3>
        <p>${escapeHtml(product.description)}</p>
        <div class="product-bottom">
          <div class="price">
            <strong>${money(product.price)}</strong>
            <small>${escapeHtml(product.unit)} · ${product.prepMinutes} min</small>
          </div>
          <button class="icon-button" type="button" data-add-product="${product.id}" aria-label="Agregar ${escapeHtml(product.name)} al pedido" ${outOfStock ? 'disabled' : ''}>+</button>
        </div>
      </article>
    `;
  }).join('');
}

export function stockPill(product) {
  if (!product.available || product.stock <= 0) return '<span class="stock-pill empty">Agotado</span>';
  if (product.stock <= 4) return `<span class="stock-pill low">Últimas ${product.stock}</span>`;
  if (product.featured) return '<span class="stock-pill featured">Destacado</span>';
  return `<span class="stock-pill">Stock ${product.stock}</span>`;
}

export function renderCart() {
  renderCartTotals();
  renderCartList();
  renderOrderSummary();
}

export function renderCartTotals() {
  const count = getCartCount();
  const total = getCartTotal(currentDeliveryMode());
  setText('[data-cart-count]', String(count));
  setText('[data-cart-count-mobile]', String(count));
  setText('[data-cart-total-small]', money(total));
}

function renderCartList() {
  const container = $('[data-cart-list]');
  if (!container) return;
  const items = getCartItems();

  if (!items.length) {
    container.innerHTML = `
      <div class="empty-state">
        <strong>El carrito está vacío.</strong><br />
        Agregá productos del catálogo para armar el pedido.
      </div>
    `;
    return;
  }

  container.innerHTML = items.map((item) => `
    <div class="cart-item">
      <div>
        <div class="cart-title"><span>${item.product.icon}</span>${escapeHtml(item.product.name)}</div>
        <div class="cart-meta">${money(item.product.price)} · ${escapeHtml(item.product.unit)} · línea ${money(item.product.price * item.quantity)}</div>
      </div>
      <div class="quantity-control">
        <button class="icon-button compact" type="button" data-cart-dec="${item.productId}" aria-label="Restar uno de ${escapeHtml(item.product.name)}">−</button>
        <strong>${item.quantity}</strong>
        <button class="icon-button compact" type="button" data-cart-inc="${item.productId}" aria-label="Sumar uno de ${escapeHtml(item.product.name)}">+</button>
        <button class="ghost-button compact" type="button" data-cart-remove="${item.productId}">Quitar</button>
      </div>
    </div>
  `).join('');
}

export function renderOrderSummary() {
  const container = $('[data-order-summary]');
  if (!container) return;

  const deliveryMode = currentDeliveryMode();
  const subtotal = getCartSubtotal();
  const deliveryFee = getDeliveryFee(deliveryMode);
  const total = getCartTotal(deliveryMode);
  const validation = validateCartForCheckout(deliveryMode);

  container.innerHTML = `
    <div class="summary-row"><span>Subtotal</span><strong>${money(subtotal)}</strong></div>
    <div class="summary-row"><span>${deliveryMode === 'pickup' ? 'Retiro en local' : 'Envío'}</span><strong>${money(deliveryFee)}</strong></div>
    <div class="summary-row total"><span>Total</span><strong>${money(total)}</strong></div>
    ${deliveryMode === 'delivery' ? `<div class="summary-row"><span>Pedido mínimo delivery</span><strong>${money(BUSINESS_CONFIG.minDeliveryOrder)}</strong></div>` : ''}
  `;

  const warning = $('[data-checkout-warning]');
  if (warning) {
    const cartIsEmpty = getCartItems().length === 0;
    const hide = validation.ok || cartIsEmpty;
    warning.classList.toggle('hidden', hide);
    warning.textContent = validation.message;
  }
}

export function currentDeliveryMode() {
  const checked = $('[name="deliveryMode"]:checked');
  return checked?.value || 'delivery';
}

export function getCheckoutFormValues() {
  const form = $('[data-checkout-form]');
  if (!form) return {};
  const formData = new FormData(form);
  return {
    customerName: String(formData.get('customerName') || ''),
    customerPhone: String(formData.get('customerPhone') || ''),
    customerAddress: String(formData.get('customerAddress') || ''),
    deliveryMode: String(formData.get('deliveryMode') || 'delivery'),
    paymentMethod: String(formData.get('paymentMethod') || 'cash'),
    customerNotes: String(formData.get('customerNotes') || ''),
  };
}

export function updateAddressFieldVisibility() {
  const field = $('[data-address-field]');
  if (!field) return;
  const isPickup = currentDeliveryMode() === 'pickup';
  field.classList.toggle('hidden', isPickup);
}

export function renderTracking() {
  const container = $('[data-tracking-panel]');
  if (!container) return;
  const order = getLastOrder();

  if (!order) {
    container.innerHTML = '<div class="empty-state">Todavía no hay pedidos. Armá uno desde el catálogo.</div>';
    return;
  }

  const isCancelled = order.status === 'cancelled';
  const currentIndex = trackingSteps.findIndex((step) => step.status === order.status);
  const progress = trackingSteps.map((step, index) => {
    let stateClass = 'pending';
    let stateLabel = 'Pendiente';
    if (!isCancelled && index < currentIndex) { stateClass = 'done'; stateLabel = 'Listo'; }
    if (!isCancelled && index === currentIndex) { stateClass = 'current'; stateLabel = 'En curso'; }
    return `
    <div class="progress-step ${stateClass}">
      <strong>${step.label}</strong><br />
      <span>${stateLabel}</span>
    </div>
  `;
  }).join('');

  container.innerHTML = `
    <div class="card">
      <div class="order-card-head">
        <div>
          <h3>${order.id} · ${escapeHtml(order.customerName)}</h3>
          <p>${deliveryModeLabel(order.deliveryMode)} · ${escapeHtml(order.address)}</p>
        </div>
        <span class="status-chip ${statusClass(order.status)}">${statusLabel(order.status)}</span>
      </div>
      <div class="progress-track">${progress}</div>
      ${isCancelled ? '<div class="warning-box">Este pedido fue cancelado. Si fue un error, escribinos por WhatsApp y lo resolvemos.</div>' : ''}
      <div class="summary-box">
        <div class="summary-row"><span>Repartidor</span><strong>${escapeHtml(order.delivery.driverName)}</strong></div>
        <div class="summary-row"><span>Ubicación</span><strong>${escapeHtml(order.delivery.currentLocationLabel)}</strong></div>
        <div class="summary-row"><span>Tiempo estimado</span><strong>${order.delivery.estimatedMinutes ? `${order.delivery.estimatedMinutes} min` : 'Sin demora'}</strong></div>
        <div class="summary-row total"><span>Total</span><strong>${money(order.total)}</strong></div>
      </div>
    </div>
  `;
}

export function showProductModal(productId) {
  const product = getProductById(productId);
  const modal = $('[data-product-modal]');
  const content = $('[data-modal-content]');
  if (!product || !modal || !content) return;

  content.innerHTML = `
    <div class="modal-card">
      <div class="modal-product-icon">${product.icon}</div>
      <h2>${escapeHtml(product.name)}</h2>
      <p>${escapeHtml(product.description)}</p>
      <div class="summary-box">
        <div class="summary-row"><span>Precio</span><strong>${money(product.price)}</strong></div>
        <div class="summary-row"><span>Unidad</span><strong>${escapeHtml(product.unit)}</strong></div>
        <div class="summary-row"><span>Preparación</span><strong>${product.prepMinutes} min</strong></div>
        <div class="summary-row"><span>Stock</span><strong>${product.stock}</strong></div>
      </div>
      <div class="button-row" style="margin-top:16px">
        <button class="primary-button" type="button" data-add-product="${product.id}" ${product.stock <= 0 || !product.available ? 'disabled' : ''}>Agregar al pedido</button>
        <button class="secondary-button" type="button" data-close-modal>Cerrar</button>
      </div>
    </div>
  `;
  modal.showModal();
}

export function closeProductModal() {
  const modal = $('[data-product-modal]');
  if (modal?.open) modal.close();
}

export async function copyDraftOrderToClipboard() {
  const message = buildDraftMessageFromCart(getCheckoutFormValues());
  await navigator.clipboard.writeText(message);
}

export function showToast(message) {
  const toast = $('[data-toast]');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast.timeoutId);
  showToast.timeoutId = setTimeout(() => toast.classList.add('hidden'), 2900);
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function setCategory(categoryId) {
  setState({ activeCategory: categoryId });
}

export function setSearchQuery(query) {
  setState({ searchQuery: query });
}
