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
  getCartItems,
  getCartSummary,
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
  renderOffers();
  renderCombos();
  renderCategories();
  renderProducts();
}

export function discountPercent(product) {
  if (!product || !product.oldPrice || product.oldPrice <= product.price) return 0;
  return Math.round(((product.oldPrice - product.price) / product.oldPrice) * 100);
}

function offerBadges(product) {
  const badges = [];
  const off = discountPercent(product);
  if (off > 0) badges.push(`<span class="offer-badge discount">-${off}%</span>`);
  else if (product.popular) badges.push('<span class="offer-badge hot">Más pedido</span>');
  else if (product.featured) badges.push('<span class="offer-badge promo">Destacado</span>');
  if (product.categoryId === 'combos') badges.push('<span class="offer-badge combo">Combo</span>');
  else if (product.categoryId === 'promos') badges.push('<span class="offer-badge day">Promo del día</span>');
  return badges.length ? `<div class="product-badges">${badges.join('')}</div>` : '';
}

function offerCardHtml(product) {
  const off = discountPercent(product);
  const tag = off > 0 ? `<span class="offer-badge discount">-${off}%</span>`
    : product.popular ? '<span class="offer-badge hot">Más pedido</span>'
    : product.categoryId === 'combos' ? '<span class="offer-badge combo">Combo</span>'
    : '<span class="offer-badge promo">Destacado</span>';
  return `
    <article class="offer-card">
      <button class="offer-card-media ${visualToneClass(product)}" type="button" data-product-detail="${product.id}" aria-label="Ver ${escapeHtml(product.name)}">
        <span class="offer-emoji">${product.icon}</span>
        <span class="visual-sheen" aria-hidden="true"></span>
        ${tag}
      </button>
      <div class="offer-card-body">
        <strong>${escapeHtml(product.name)}</strong>
        <div class="offer-price">
          ${off > 0 ? `<s>${money(product.oldPrice)}</s>` : ''}
          <span>${money(product.price)}</span>
        </div>
      </div>
      <button class="primary-button compact offer-add" type="button" data-add-product="${product.id}" aria-label="Agregar ${escapeHtml(product.name)} al pedido">Agregar</button>
    </article>
  `;
}

function visualToneClass(product) {
  return `tone-${escapeHtml(product.categoryId || 'default')}`;
}

function renderCombos() {
  const container = $('[data-combos-rail]');
  if (!container) return;
  const combos = getState().products
    .filter((product) => product.available && product.stock > 0 && product.categoryId === 'combos')
    .slice(0, 8);
  container.innerHTML = combos.map(offerCardHtml).join('');
}

function priceBlock(product) {
  const old = product.oldPrice && product.oldPrice > product.price
    ? `<s>${money(product.oldPrice)}</s>` : '';
  return `
    <div class="price">
      ${old}
      <strong>${money(product.price)}</strong>
      <small>${escapeHtml(product.unit)} · ${product.prepMinutes} min</small>
    </div>`;
}

function renderOffers() {
  const container = $('[data-offers-rail]');
  if (!container) return;
  const offers = getState().products
    .filter((product) => product.available && product.stock > 0 && (discountPercent(product) > 0 || product.featured))
    .sort((a, b) => discountPercent(b) - discountPercent(a))
    .slice(0, 8);

  if (!offers.length) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = offers.map(offerCardHtml).join('');
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
    const offer = discountPercent(product) > 0;
    return `
      <article class="product-card ${outOfStock ? 'out-of-stock' : ''} ${offer ? 'is-offer' : ''}">
        <button class="product-media ${visualToneClass(product)}" type="button" data-product-detail="${product.id}" aria-label="Ver ${escapeHtml(product.name)}">
          <span class="product-emoji">${product.icon}</span>
          <span class="visual-sheen" aria-hidden="true"></span>
          ${offerBadges(product)}
          <span class="product-stock-tag">${stockPill(product)}</span>
        </button>
        <div class="product-body">
          <h3>${escapeHtml(product.name)}</h3>
          <p>${escapeHtml(product.description)}</p>
        </div>
        <div class="product-bottom">
          ${priceBlock(product)}
          <button class="add-button" type="button" data-add-product="${product.id}" aria-label="Agregar ${escapeHtml(product.name)} al pedido" ${outOfStock ? 'disabled' : ''}>
            <span class="add-plus">+</span><span class="add-text">${outOfStock ? 'Agotado' : 'Agregar'}</span>
          </button>
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
  const summary = getCartSummary(currentDeliveryMode());
  setText('[data-cart-count]', String(summary.count));
  setText('[data-cart-count-mobile]', String(summary.count));
  setText('[data-cart-total-small]', money(summary.total));
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
      <div class="cart-item-main">
        <span class="cart-thumb ${visualToneClass(item.product)}">${item.product.icon}</span>
        <div class="cart-copy">
          <div class="cart-title">${escapeHtml(item.product.name)}</div>
          <div class="cart-meta">${money(item.product.price)} · ${escapeHtml(item.product.unit)} · línea ${money(item.product.price * item.quantity)}</div>
        </div>
      </div>
      <div class="quantity-control cart-controls">
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
  const { items, subtotal, deliveryFee, total } = getCartSummary(deliveryMode);
  const validation = validateCartForCheckout(deliveryMode);

  container.innerHTML = `
    <div class="summary-row"><span>Subtotal</span><strong>${money(subtotal)}</strong></div>
    <div class="summary-row"><span>${deliveryMode === 'pickup' ? 'Retiro en local' : 'Envío'}</span><strong>${money(deliveryFee)}</strong></div>
    <div class="summary-row total"><span>Total</span><strong>${money(total)}</strong></div>
    ${deliveryMode === 'delivery' ? `<div class="summary-row"><span>Pedido mínimo delivery</span><strong>${money(BUSINESS_CONFIG.minDeliveryOrder)}</strong></div>` : ''}
  `;

  const warning = $('[data-checkout-warning]');
  if (warning) {
    const cartIsEmpty = items.length === 0;
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
  const trackingStatus = order.status === 'arriving' ? 'on_the_way' : order.status;
  const currentIndex = trackingSteps.findIndex((step) => step.status === trackingStatus);
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
  const liveMap = order.deliveryMode === 'delivery' ? trackingMapHtml(order) : '';

  container.innerHTML = `
    <div class="card">
      <div class="order-card-head">
        <div>
          <h3>${order.id} · ${escapeHtml(order.customerName)}</h3>
          <p>${deliveryModeLabel(order.deliveryMode)} · ${escapeHtml(order.address)}</p>
        </div>
        <span class="status-chip ${statusClass(order.status)}">${statusLabel(order.status)}</span>
      </div>
      ${liveMap}
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

function trackingMapHtml(order) {
  const minutes = order.delivery.estimatedMinutes || 0;
  const eta = minutes ? `${minutes} min` : 'Sin demora';
  const km = Math.min(7.5, Math.max(0.6, minutes * 0.28)).toFixed(1).replace('.', ',');
  const progress = order.status === 'delivered' ? 1
    : order.status === 'arriving' ? 0.9
    : order.status === 'on_the_way' ? 0.72
    : order.status === 'ready' ? 0.38
    : 0.12;
  return `
    <div class="tracking-live-card">
      <div>
        <small>Repartidor en camino</small>
        <strong>${eta}</strong>
        <span>${km} km restantes · ${escapeHtml(order.delivery.driverName)}</span>
      </div>
      <div class="tracking-mini-map" aria-hidden="true">
        <span class="tracking-pin store">LT</span>
        <span class="tracking-route"></span>
        <span class="tracking-rider" style="--p:${progress}">🛵</span>
        <span class="tracking-pin home">⌂</span>
      </div>
    </div>
  `;
}

export function showProductModal(productId) {
  const product = getProductById(productId);
  const modal = $('[data-product-modal]');
  const content = $('[data-modal-content]');
  if (!product || !modal || !content) return;

  const off = discountPercent(product);
  content.innerHTML = `
    <div class="modal-card">
      <div class="modal-product-icon">${product.icon}${off > 0 ? `<span class="offer-badge discount">-${off}%</span>` : ''}</div>
      <h2>${escapeHtml(product.name)}</h2>
      <p>${escapeHtml(product.description)}</p>
      <div class="summary-box">
        <div class="summary-row"><span>Precio</span><strong>${off > 0 ? `<s>${money(product.oldPrice)}</s> ` : ''}${money(product.price)}</strong></div>
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
  if (getState().activeCategory === categoryId) return;
  setState({ activeCategory: categoryId });
}

export function setSearchQuery(query) {
  const nextQuery = String(query || '');
  if (getState().searchQuery === nextQuery) return;
  setState({ searchQuery: nextQuery });
}
