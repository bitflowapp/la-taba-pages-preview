import { BUSINESS_CONFIG } from './config.js';
import { categories } from './data.js';
import {
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
    status.textContent = isOpen ? 'Abierto ahora' : 'Cerrado · pedidos programables';
    status.classList.toggle('is-closed', !isOpen);
  }
}

function setText(selector, value) {
  $$(selector).forEach((node) => { node.textContent = value; });
}

export function renderNavigation(activeView = 'home') {
  $$('[data-nav-view]').forEach((control) => {
    const isActive = control.dataset.navView === activeView;
    control.classList.toggle('active', isActive);
    if (isActive) {
      control.setAttribute('aria-current', 'page');
    } else {
      control.removeAttribute('aria-current');
    }
  });
}

export function renderAdminVisibility() {
  const { adminUnlocked } = getState();
  $$('[data-admin-locked]').forEach((node) => {
    node.hidden = adminUnlocked;
    node.setAttribute('aria-hidden', String(adminUnlocked));
  });
  $$('[data-admin-unlocked]').forEach((node) => {
    node.hidden = !adminUnlocked;
    node.setAttribute('aria-hidden', String(!adminUnlocked));
  });
  $$('[data-admin-toggle]').forEach((button) => {
    button.textContent = adminUnlocked ? 'Panel negocio' : 'Administrar pedidos';
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

function unitText(product) {
  return product.unitLabel || product.unit || '';
}

// Thumbnail tonal de producto sin usar emojis como imagen principal.
export function productThumb(product, variant = 'grid') {
  const tone = product.tone || 'beef';
  return `
    <span class="thumb tone-${tone} thumb-${variant}" aria-hidden="true">
      <span class="thumb-code">${productCode(product)}</span>
      <span class="thumb-cut">${escapeHtml(product.categoryId || '')}</span>
    </span>`;
}

export function productCode(product) {
  const words = String(product?.name || 'LT')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  const first = words[0]?.charAt(0) || 'L';
  const second = words.find((word) => word.length > 2 && word !== words[0])?.charAt(0)
    || words[0]?.charAt(1)
    || 'T';
  return `${first}${second}`.toUpperCase();
}

function topBadge(product) {
  const off = discountPercent(product);
  if (product.combo && off > 0) return `<span class="offer-badge combo">Combo · ${off}% OFF</span>`;
  if (off > 0) return `<span class="offer-badge discount">${off}% OFF</span>`;
  if (product.badge) return `<span class="offer-badge promo">${escapeHtml(product.badge)}</span>`;
  if (product.featured) return '<span class="offer-badge promo">Destacado</span>';
  return '';
}

function offerBadges(product) {
  const badges = [];
  const off = discountPercent(product);
  if (off > 0) badges.push(`<span class="offer-badge discount">${off}% OFF</span>`);
  if (product.combo) badges.push('<span class="offer-badge combo">Combo</span>');
  else if (product.popular) badges.push('<span class="offer-badge promo">Más pedido</span>');
  else if (off === 0 && product.featured) badges.push('<span class="offer-badge promo">Destacado</span>');
  return badges.length ? `<div class="product-badges">${badges.join('')}</div>` : '';
}

function priceBlock(product) {
  const old = product.oldPrice && product.oldPrice > product.price
    ? `<s>${money(product.oldPrice)}</s>` : '';
  return `
    <div class="price">
      <div class="price-amounts"><strong>${money(product.price)}</strong>${old}</div>
      <small>${escapeHtml(unitText(product))}</small>
    </div>`;
}

function renderOffers() {
  const container = $('[data-offers-rail]');
  if (!container) return;
  const offers = getState().products
    .filter((product) => product.available && product.stock > 0 && (discountPercent(product) > 0 || product.featured))
    .sort((a, b) => discountPercent(b) - discountPercent(a))
    .slice(0, 8);

  container.innerHTML = offers.map(railCard).join('');
}

function renderCombos() {
  const container = $('[data-combos-rail]');
  if (!container) return;
  const combos = getState().products
    .filter((product) => product.available && product.stock > 0 && (product.combo || product.categoryId === 'combos'))
    .slice(0, 8);

  container.innerHTML = combos.length
    ? combos.map(railCard).join('')
    : '<div class="empty-state">Pronto sumamos más combos.</div>';
}

function railCard(product) {
  const off = discountPercent(product);
  const old = off > 0 ? `<s>${money(product.oldPrice)}</s>` : '';
  return `
    <article class="offer-card ${product.stock <= 0 || !product.available ? 'out-of-stock' : ''}">
      <button class="offer-card-media" type="button" data-product-detail="${product.id}" aria-label="Ver ${escapeHtml(product.name)}">
        ${productThumb(product, 'rail')}
        <span class="offer-badge-wrap">${topBadge(product)}</span>
      </button>
      <div class="offer-card-body">
        <strong>${escapeHtml(product.name)}</strong>
        <small>${escapeHtml(unitText(product))}</small>
        <div class="offer-price">
          <span>${money(product.price)}</span>
          ${old}
        </div>
      </div>
      <button class="add-round" type="button" data-add-product="${product.id}" aria-label="Agregar ${escapeHtml(product.name)} al pedido" ${product.stock <= 0 || !product.available ? 'disabled' : ''}>+</button>
    </article>
  `;
}

function renderCategories() {
  const container = $('[data-category-strip]');
  if (!container) return;
  const { activeCategory } = getState();

  container.innerHTML = categories.map((category) => `
    <button class="category-button ${activeCategory === category.id ? 'active' : ''}" type="button" data-category-id="${category.id}">
      ${escapeHtml(category.name)}
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
        <button class="product-media" type="button" data-product-detail="${product.id}" aria-label="Ver ${escapeHtml(product.name)}">
          ${productThumb(product, 'grid')}
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
  if (product.stock <= 4) return `<span class="stock-pill low">Quedan ${product.stock}</span>`;
  if (product.badge === 'Retiro') return '<span class="stock-pill featured">Retiro</span>';
  if (product.featured) return '<span class="stock-pill featured">Destacado</span>';
  return `<span class="stock-pill">Disponible</span>`;
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
  $$('[data-cart-count], [data-cart-count-mobile]').forEach((node) => {
    node.classList.toggle('is-empty', summary.count === 0);
  });
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
        <div class="empty-actions">
          <button class="secondary-button compact" type="button" data-nav-view="home">Ver productos</button>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = items.map((item) => `
    <div class="cart-item">
      ${productThumb(item.product, 'cart')}
      <div class="cart-item-info">
        <div class="cart-title">${escapeHtml(item.product.name)}</div>
        <div class="cart-meta">${escapeHtml(unitText(item.product))} · ${money(item.product.price)}</div>
      </div>
      <div class="cart-item-side">
        <div class="quantity-control">
          <button class="icon-button compact" type="button" data-cart-dec="${item.productId}" aria-label="Restar uno de ${escapeHtml(item.product.name)}">−</button>
          <strong>${item.quantity}</strong>
          <button class="icon-button compact" type="button" data-cart-inc="${item.productId}" aria-label="Sumar uno de ${escapeHtml(item.product.name)}">+</button>
        </div>
        <div class="cart-line">${money(item.product.price * item.quantity)}</div>
        <button class="cart-remove" type="button" data-cart-remove="${item.productId}" aria-label="Quitar ${escapeHtml(item.product.name)}">Quitar</button>
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
    <div class="summary-row"><span>${deliveryMode === 'pickup' ? 'Retiro en local' : 'Envío a domicilio'}</span><strong>${money(deliveryFee)}</strong></div>
    ${deliveryMode === 'delivery' ? `<div class="summary-row muted"><span>Pedido mínimo delivery</span><strong>${money(BUSINESS_CONFIG.minDeliveryOrder)}</strong></div>` : ''}
    <div class="summary-row total"><span>Total</span><strong>${money(total)}</strong></div>
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

// ===== Seguimiento del pedido (vista cliente) =====
const customerSteps = [
  { key: 'prep', label: 'Preparando' },
  { key: 'way', label: 'En camino' },
  { key: 'done', label: 'Llegando' },
];

function customerStepIndex(status) {
  if (['received', 'preparing', 'ready'].includes(status)) return 0;
  if (status === 'on_the_way') return 1;
  if (status === 'arriving' || status === 'delivered') return 2;
  return 0;
}

function trackingHeadline(order) {
  const eta = order.delivery.estimatedMinutes;
  if (order.status === 'delivered') {
    return { kicker: 'Pedido entregado', title: '¡Disfrutalo!', sub: 'Gracias por comprar en La Taba.' };
  }
  if (order.status === 'cancelled') {
    return { kicker: 'Pedido cancelado', title: 'Pedido cancelado', sub: 'Escribinos por WhatsApp y lo resolvemos.' };
  }
  if (order.deliveryMode === 'pickup') {
    return { kicker: 'Retiro en local', title: order.status === 'ready' ? 'Listo para retirar' : 'Preparando tu pedido', sub: `Te esperamos en ${escapeHtml(BUSINESS_CONFIG.address)}.` };
  }
  if (order.status === 'arriving') {
    return { kicker: 'Repartidor llegando', title: 'Llegando al domicilio', sub: `${distanceLabel(order)} restantes` };
  }
  if (order.status === 'on_the_way') {
    return { kicker: 'Repartidor en camino', title: eta ? `Llegando en ${eta} min` : 'En camino', sub: `${distanceLabel(order)} restantes` };
  }
  return { kicker: 'Pedido en preparación', title: eta ? `Listo en ~${eta} min` : 'En preparación', sub: 'Te avisamos cuando salga el repartidor.' };
}

function distanceLabel(order) {
  const km = order.delivery.distanceKm
    || Math.min(7.5, Math.max(0.6, (order.delivery.estimatedMinutes || 6) * 0.28));
  return `${km.toFixed(1).replace('.', ',')} km`;
}

function trackingMapSvg(order) {
  const progress = order.status === 'delivered' ? 1
    : order.status === 'arriving' ? 0.9
    : order.status === 'on_the_way' ? 0.6
    : 0.05;
  const path = 'M 44 176 C 96 150, 96 96, 150 92 S 240 70, 276 44';
  return `
    <div class="demo-map track-map" role="img" aria-label="Mapa de demostración del pedido">
      <svg class="demo-map-svg" viewBox="0 0 320 220" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id="trackRoute" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#e0a066"/><stop offset="1" stop-color="#b84f40"/>
          </linearGradient>
        </defs>
        <g class="map-streets" stroke="rgba(255,255,255,0.06)" stroke-width="2">
          <line x1="0" y1="48" x2="320" y2="40"/><line x1="0" y1="104" x2="320" y2="112"/>
          <line x1="0" y1="166" x2="320" y2="158"/><line x1="60" y1="0" x2="48" y2="220"/>
          <line x1="150" y1="0" x2="158" y2="220"/><line x1="244" y1="0" x2="236" y2="220"/>
        </g>
        <path d="${path}" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="8" stroke-linecap="round"/>
        <path class="map-route" d="${path}" fill="none" stroke="url(#trackRoute)" stroke-width="4" stroke-linecap="round" stroke-dasharray="6 7"/>
      </svg>
      <span class="map-marker store" style="left:14%;top:80%"><span>LT</span><small>La Taba</small></span>
      <span class="map-marker client" style="left:86%;top:20%"><span>VO</span><small>Vos</small></span>
      <span class="map-marker rider rider-${order.status}" style="--p:${progress}"><span>R</span></span>
    </div>
  `;
}

function riderProfileCard(order) {
  const d = order.delivery;
  const rating = d.driverRating ? `★ ${d.driverRating}` : '★ 4.9';
  const trips = d.driverTrips ? `${d.driverTrips} pedidos` : 'Repartidor de La Taba';
  const phone = d.driverPhone || BUSINESS_CONFIG.whatsappNumber;
  const wa = `https://wa.me/${onlyDigits(phone)}`;
  return `
    <div class="rider-profile">
      <span class="rider-avatar">${escapeHtml(initials(d.driverName))}</span>
      <div class="rider-profile-text">
        <strong>${escapeHtml(d.driverName || 'Repartidor')}</strong>
        <small>Repartidor · ${rating} · ${trips}</small>
      </div>
      <a class="round-action call" href="tel:${encodeURIComponent(phone)}" aria-label="Llamar al repartidor">Tel</a>
      <a class="round-action whatsapp" href="${wa}" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp del repartidor">WA</a>
    </div>
  `;
}

export function renderTracking() {
  const container = $('[data-tracking-panel]');
  if (!container) return;
  const order = getLastOrder();

  if (!order) {
    container.innerHTML = `
      <div class="empty-state">
        <strong>No hay un pedido activo.</strong><br />
        Cuando confirmes una compra, el estado aparece acá con preparación, reparto y detalle.
        <div class="empty-actions">
          <button class="secondary-button compact" type="button" data-nav-view="home">Ver productos</button>
        </div>
      </div>`;
    return;
  }

  const isCancelled = order.status === 'cancelled';
  const isDelivery = order.deliveryMode !== 'pickup';
  const head = trackingHeadline(order);
  const stepIndex = customerStepIndex(order.status);

  const steps = customerSteps.map((step, index) => {
    let cls = 'pending';
    if (!isCancelled && index < stepIndex) cls = 'done';
    if (!isCancelled && index === stepIndex) cls = 'current';
    return `<div class="track-step ${cls}"><span class="track-dot"></span><small>${step.label}</small></div>`;
  }).join('');

  const itemsHtml = order.items.map((item) => `
    <div class="order-line">
      <span>${item.quantity} × ${escapeHtml(item.name)}</span>
      <strong>${money(item.quantity * item.unitPrice)}</strong>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="track-layout">
      <div class="card track-header ${statusClass(order.status)}">
        <span class="track-head-ico">${isDelivery ? 'REP' : 'RET'}</span>
        <div class="track-head-text">
          <small>${head.kicker}</small>
          <strong>${head.title}</strong>
          <span>${head.sub}</span>
        </div>
        <span class="status-chip ${statusClass(order.status)}">${statusLabel(order.status)}</span>
      </div>

      ${isDelivery && !isCancelled ? `<div class="card track-map-card">${trackingMapSvg(order)}</div>` : ''}

      <div class="card track-progress-card">
        <div class="track-steps">${steps}</div>
        ${isCancelled ? '<div class="warning-box">Este pedido fue cancelado. Si fue un error, escribinos por WhatsApp y lo resolvemos.</div>' : ''}
        ${isDelivery && !isCancelled ? riderProfileCard(order) : ''}
        <details class="order-detail">
          <summary>Ver detalle del pedido · ${order.id}</summary>
          <div class="order-detail-body">
            <div class="order-line head"><span>${deliveryModeLabel(order.deliveryMode)}</span><strong>${escapeHtml(order.address)}</strong></div>
            ${itemsHtml}
            <div class="summary-row"><span>Subtotal</span><strong>${money(order.subtotal)}</strong></div>
            <div class="summary-row"><span>Envío</span><strong>${money(order.deliveryFee)}</strong></div>
            <div class="summary-row total"><span>Total</span><strong>${money(order.total)}</strong></div>
          </div>
        </details>
      </div>
    </div>
  `;
}

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || '?';
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

export function showProductModal(productId) {
  const product = getProductById(productId);
  const modal = $('[data-product-modal]');
  const content = $('[data-modal-content]');
  if (!product || !modal || !content) return;

  const off = discountPercent(product);
  content.innerHTML = `
    <div class="modal-card">
      <div class="modal-media">${productThumb(product, 'modal')}<span class="offer-badge-wrap">${topBadge(product)}</span></div>
      <h2>${escapeHtml(product.name)}</h2>
      <p>${escapeHtml(product.description)}</p>
      <div class="summary-box">
        <div class="summary-row"><span>Precio</span><strong>${off > 0 ? `<s>${money(product.oldPrice)}</s> ` : ''}${money(product.price)}</strong></div>
        <div class="summary-row"><span>Presentación</span><strong>${escapeHtml(unitText(product))}</strong></div>
        <div class="summary-row"><span>Preparación</span><strong>${product.prepMinutes} min</strong></div>
        <div class="summary-row"><span>Disponibilidad</span><strong>${stockPill(product)}</strong></div>
      </div>
      ${product.marketNote ? `<p class="market-note">ℹ️ ${escapeHtml(product.marketNote)}</p>` : ''}
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
