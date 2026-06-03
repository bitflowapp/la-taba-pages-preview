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
import { buildDraftMessageFromCart, getActiveOrder } from './orders.js';
import { getRealtimeStatus } from './realtime.js';
import { normalizeAddressDetails, normalizeOrderAddressDetails } from './core/address.js';
import { chooseRiderLocation, hasLiveRiderLocation } from './map/route_geometry.js';

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function renderWithStableRealMap(container, html, { rolePrefix = '', orderId = '' } = {}) {
  const stableMap = captureStableRealMap(container, rolePrefix, orderId);
  container.innerHTML = html;
  restoreStableRealMap(container, stableMap);
}

function captureStableRealMap(container, rolePrefix, orderId) {
  if (!container || !rolePrefix) return null;
  const shell = container.querySelector('[data-real-map]');
  if (!shell) return null;
  const role = shell.dataset.mapRole || '';
  const shellOrderId = shell.dataset.orderId || '';
  if (!role.startsWith(rolePrefix) || shellOrderId !== String(orderId || '')) return null;
  return shell;
}

function restoreStableRealMap(container, shell) {
  if (!container || !shell) return;
  const role = shell.dataset.mapRole || '';
  const orderId = shell.dataset.orderId || '';
  const replacement = [...container.querySelectorAll('[data-real-map]')]
    .find((candidate) => (
      (candidate.dataset.mapRole || '') === role
      && (candidate.dataset.orderId || '') === orderId
    ));
  if (replacement && replacement !== shell) replacement.replaceWith(shell);
}

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
    status.textContent = isOpen ? 'Abierto ahora' : 'Tomamos pedidos';
    status.classList.toggle('is-closed', false);
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
  renderCatalogOffers();
  renderCatalogMeta();
  renderProducts();
}

export function discountPercent(product) {
  if (!product || !product.oldPrice || product.oldPrice <= product.price) return 0;
  return Math.round(((product.oldPrice - product.price) / product.oldPrice) * 100);
}

function unitText(product) {
  return product.unitLabel || product.unit || '';
}

const PRODUCT_IMAGE_BY_ID = Object.freeze({
  'p-viernes-parrilla': 'assets/hero/parrilla-real.webp',
  'p-combo-familiar': 'assets/hero/parrilla-real.webp',
  'p-combo-parrillero': 'assets/products/chorizos-parrilla.webp',
  'p-promo-milanesas': 'assets/products/milanesas.webp',
  'p-combo-milanesas': 'assets/products/milanesas.webp',
  'p-milanesa-carne': 'assets/products/milanesas.webp',
  'p-carne-picada-especial': 'assets/products/hamburguesa.webp',
  'p-chorizo-parrillero': 'assets/products/chorizos-parrilla.webp',
  'p-chorizo-colorado': 'assets/products/chorizos-parrilla.webp',
  'p-salchicha-parrillera': 'assets/products/chorizos-parrilla.webp',
});

const PRODUCT_IMAGE_BY_TONE = Object.freeze({
  promo: 'assets/hero/parrilla-real.webp',
  combo: 'assets/hero/parrilla-real.webp',
  beef: 'assets/products/cortes-crudos.webp',
  mila: 'assets/products/milanesas.webp',
  chicken: 'assets/products/pollo-fresco.webp',
  sausage: 'assets/products/chorizos-parrilla.webp',
  achura: 'assets/hero/parrilla-real.webp',
});

function productImage(product) {
  return product?.image || PRODUCT_IMAGE_BY_ID[product?.id] || PRODUCT_IMAGE_BY_TONE[product?.tone] || '';
}

// Thumbnail de producto con foto real licenciada y fallback tonal para rubros sin foto.
export function productThumb(product, variant = 'grid') {
  const tone = product.tone || 'beef';
  const image = productImage(product);
  if (image) {
    const loading = variant === 'modal' ? 'eager' : 'lazy';
    return `
    <span class="thumb has-photo tone-${tone} thumb-${variant}" aria-hidden="true">
      <img class="thumb-img" src="${escapeHtml(image)}" alt="" loading="${loading}" decoding="async" />
    </span>`;
  }
  // El tile muestra solo arte visual + un monograma corto (no el nombre completo,
  // que ya aparece debajo). Así se evita el texto superpuesto en cards angostas.
  return `
    <span class="thumb tone-${tone} thumb-${variant}" aria-hidden="true">
      <span class="thumb-steak"></span>
      <span class="thumb-code">${escapeHtml(productCode(product))}</span>
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
    : '<div class="empty-state">Consultá por combos armados en el local.</div>';
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
  const strips = $$('[data-category-strip]');
  if (!strips.length) return;
  const { activeCategory } = getState();

  const markup = categories.map((category) => `
    <button class="category-button ${activeCategory === category.id ? 'active' : ''}" type="button" data-category-id="${category.id}">
      ${escapeHtml(category.name)}
    </button>
  `).join('');

  strips.forEach((strip) => { strip.innerHTML = markup; });
}

// Productos filtrados por categoría + búsqueda, ya ordenados.
function getFilteredProducts(state) {
  const query = state.searchQuery.trim().toLowerCase();
  const filtered = state.products.filter((product) => {
    const matchesCategory = state.activeCategory === 'all' || product.categoryId === state.activeCategory;
    const matchesQuery = !query || [product.name, product.description, product.categoryId].join(' ').toLowerCase().includes(query);
    return matchesCategory && matchesQuery;
  });
  return sortProducts(filtered, state.sortBy);
}

function recommendedScore(product) {
  let score = 0;
  if (product.available && product.stock > 0) score += 4;
  if (product.featured) score += 2;
  if (product.popular) score += 1;
  if (discountPercent(product) > 0) score += 1;
  return score;
}

function popularScore(product) {
  let score = 0;
  if (product.popular) score += 3;
  if (product.available && product.stock > 0) score += 2;
  if (product.featured) score += 1;
  return score;
}

function sortProducts(list, sortBy) {
  const arr = [...list];
  if (sortBy === 'price_asc') return arr.sort((a, b) => a.price - b.price);
  if (sortBy === 'popular') return arr.sort((a, b) => popularScore(b) - popularScore(a));
  return arr.sort((a, b) => recommendedScore(b) - recommendedScore(a));
}

function activeCategoryName() {
  const { activeCategory } = getState();
  return categories.find((category) => category.id === activeCategory)?.name || 'Todos';
}

// Rail de ofertas de la categoría activa, arriba del grid del catálogo.
function renderCatalogOffers() {
  const container = $('[data-catalog-offers]');
  if (!container) return;
  const state = getState();
  const offers = state.products
    .filter((product) => {
      const inCategory = state.activeCategory === 'all' || product.categoryId === state.activeCategory;
      return inCategory && product.available && product.stock > 0 && (discountPercent(product) > 0 || product.featured);
    })
    .sort((a, b) => discountPercent(b) - discountPercent(a))
    .slice(0, 8);

  const block = container.closest('[data-catalog-offers-block]') || container;
  if (!offers.length) {
    block.hidden = true;
    container.innerHTML = '';
    return;
  }
  block.hidden = false;
  container.innerHTML = offers.map(railCard).join('');
}

function renderCatalogMeta() {
  setText('[data-catalog-title]', activeCategoryName());
  const count = getFilteredProducts(getState()).length;
  setText('[data-catalog-count]', count === 1 ? '1 producto' : `${count} productos`);
  const select = $('[data-sort-select]');
  if (select && select.value !== getState().sortBy) select.value = getState().sortBy;
}

function renderProducts() {
  const container = $('[data-product-grid]');
  if (!container) return;

  const state = getState();
  const filteredProducts = getFilteredProducts(state);

  if (!filteredProducts.length) {
    container.innerHTML = `
      <div class="empty-state">
        <strong>No hay productos en esta búsqueda.</strong><br />
        Probá con otra categoría o limpiá el buscador.
        <div class="empty-actions">
          <button class="secondary-button compact" type="button" data-category-id="all">Ver todo el catálogo</button>
        </div>
      </div>`;
    return;
  }

  const cartQuantities = new Map(getCartItems().map((item) => [item.productId, item.quantity]));

  container.innerHTML = filteredProducts.map((product) => {
    const outOfStock = product.stock <= 0 || !product.available;
    const offer = discountPercent(product) > 0;
    const inCart = cartQuantities.get(product.id) || 0;
    const control = inCart > 0
      ? `<div class="qty-stepper" aria-label="Cantidad de ${escapeHtml(product.name)} en el pedido">
          <button class="icon-button compact" type="button" data-cart-dec="${product.id}" aria-label="Restar uno de ${escapeHtml(product.name)}">−</button>
          <strong>${inCart}</strong>
          <button class="icon-button compact" type="button" data-cart-inc="${product.id}" aria-label="Sumar uno de ${escapeHtml(product.name)}" ${inCart >= product.stock ? 'disabled' : ''}>+</button>
        </div>`
      : `<button class="add-button" type="button" data-add-product="${product.id}" aria-label="Agregar ${escapeHtml(product.name)} al pedido" ${outOfStock ? 'disabled' : ''}>
          <span class="add-plus">+</span><span class="add-text">${outOfStock ? 'Agotado' : 'Agregar'}</span>
        </button>`;
    return `
      <article class="product-card ${outOfStock ? 'out-of-stock' : ''} ${offer ? 'is-offer' : ''} ${inCart > 0 ? 'in-cart' : ''}">
        <button class="product-media" type="button" data-product-detail="${product.id}" aria-label="Ver ${escapeHtml(product.name)}">
          ${productThumb(product, 'grid')}
          ${offerBadges(product)}
          <span class="product-stock-tag">${stockPill(product)}</span>
          ${inCart > 0 ? `<span class="product-incart-tag">${inCart} en pedido</span>` : ''}
        </button>
        <div class="product-body">
          <h3>${escapeHtml(product.name)}</h3>
          <p>${escapeHtml(product.description)}</p>
        </div>
        <div class="product-bottom">
          ${priceBlock(product)}
          ${control}
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

// Acceso directo a Tracking desde Home cuando hay un pedido en curso.
export function renderHomeActiveOrder() {
  const container = $('[data-home-active-order]');
  if (!container) return;
  const order = getActiveOrder();
  const isActive = order && order.status !== 'delivered' && order.status !== 'cancelled';
  if (!isActive) {
    container.hidden = true;
    container.innerHTML = '';
    return;
  }
  container.hidden = false;
  container.innerHTML = `
    <button class="active-order-banner" type="button" data-nav-view="tracking">
      <span class="active-order-pulse" aria-hidden="true"></span>
      <span class="active-order-text">
        <strong>Tenés un pedido en curso</strong>
        <small>${escapeHtml(order.id)} · ${escapeHtml(statusLabel(order.status))} · tocá para seguirlo</small>
      </span>
      <span class="active-order-go" aria-hidden="true">›</span>
    </button>`;
}

export function renderCart() {
  renderCartTotals();
  renderCartList();
  renderOrderSummary();
  renderCheckoutVisibility();
}

// Con el carrito vacío no tiene sentido mostrar el formulario "Datos para finalizar"
// (campos y totales en $0) ni el botón de vaciar: dejamos solo el estado vacío con
// el acceso a productos, para que la vista del pedido se sienta limpia.
function renderCheckoutVisibility() {
  const isEmpty = getCartItems().length === 0;
  const form = $('[data-checkout-form]');
  if (form) form.hidden = isEmpty;
  $$('[data-clear-cart]').forEach((button) => { button.hidden = isEmpty; });
}

export function renderCartTotals() {
  const summary = getCartSummary(currentDeliveryMode());
  const subtotalSummary = getCartSummary('pickup');
  const floatingText = `${summary.count} ${summary.count === 1 ? 'ítem' : 'ítems'} · ${money(subtotalSummary.subtotal)}`;
  setText('[data-cart-count]', String(summary.count));
  setText('[data-cart-count-mobile]', String(summary.count));
  setText('[data-cart-total-small]', summary.count > 0 ? money(subtotalSummary.subtotal) : 'Pedido');
  setText('[data-floating-cart-summary]', floatingText);
  $$('[data-cart-count], [data-cart-count-mobile]').forEach((node) => {
    node.classList.toggle('is-empty', summary.count === 0);
  });
  $$('[data-floating-cart]').forEach((node) => {
    node.classList.toggle('hidden', summary.count === 0);
    node.setAttribute('aria-label', summary.count > 0 ? `${floatingText}. Ver pedido.` : 'Carrito vacío');
  });
}

function renderCartList() {
  const container = $('[data-cart-list]');
  if (!container) return;
  const items = getCartItems();

  if (!items.length) {
    const activeOrder = getActiveOrder();
    const hasActiveOrder = activeOrder && !['delivered', 'cancelled'].includes(activeOrder.status);
    container.innerHTML = `
      <div class="empty-state">
        <strong>El carrito está vacío.</strong><br />
        Agregá productos del catálogo para armar el pedido.
        ${hasActiveOrder ? `
        <div class="cart-active-order">
          <small>Pedido en curso</small>
          <strong>${escapeHtml(activeOrder.id)} · ${escapeHtml(statusLabel(activeOrder.status))}</strong>
          <button class="secondary-button compact" type="button" data-nav-view="tracking">Ver seguimiento</button>
        </div>` : ''}
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
  const addressDetails = normalizeAddressDetails({
    customerStreetAddress: formData.get('customerStreetAddress'),
    customerNeighborhood: formData.get('customerNeighborhood'),
    customerReference: formData.get('customerReference'),
  });
  const hiddenAddress = form.querySelector('[name="customerAddress"]');
  if (hiddenAddress) hiddenAddress.value = addressDetails.label;
  return {
    customerName: String(formData.get('customerName') || ''),
    customerPhone: String(formData.get('customerPhone') || ''),
    customerStreetAddress: addressDetails.streetLine,
    customerNeighborhood: addressDetails.neighborhood,
    customerReference: addressDetails.reference,
    customerAddress: addressDetails.label,
    addressDetails,
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
  { key: 'delivered', label: 'Entregado' },
];

function customerStepIndex(status) {
  if (['received', 'preparing', 'ready'].includes(status)) return 0;
  if (status === 'on_the_way') return 1;
  if (status === 'arriving') return 2;
  if (status === 'delivered') return 3;
  return 0;
}

function getOrderSimulation(order) {
  const sim = getState().simulation;
  return sim && sim.orderId === order.id ? sim : null;
}

function trackingHeadline(order) {
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
    return { kicker: 'Repartidor llegando', title: 'Llegando al domicilio', sub: 'El repartidor va hacia tu dirección.' };
  }
  if (order.status === 'on_the_way') {
    return { kicker: 'Pedido en camino', title: 'Pedido en camino', sub: 'El repartidor salió hacia tu dirección.' };
  }
  return { kicker: 'Pedido en preparación', title: 'En preparación', sub: 'Te avisamos cuando salga el repartidor.' };
}

function destinationLabel(order) {
  return displayDestinationLabel(order?.address || order?.delivery?.demoDestinationLabel || deliveryModeLabel(order.deliveryMode));
}

function destinationAddressLabel(order) {
  return displayDestinationLabel(order?.address || order?.delivery?.demoDestinationAddressLabel);
}

function displayDestinationLabel(value) {
  return String(value || '')
    .replace(/^Destino demo\s*·\s*/i, 'Destino · ')
    .replace(/^Local demo\s*·\s*/i, 'Local · ');
}

function trackingMapStatusTitle(order) {
  if (order?.status === 'on_the_way') return 'Pedido en camino';
  if (order?.status === 'arriving') return 'Llegando al domicilio';
  return statusLabel(order?.status);
}

function realMapShell({ order = null, role = 'tracking', fallback }) {
  const orderAttr = order?.id ? ` data-order-id="${escapeHtml(order.id)}"` : '';
  return `
    <div class="real-map-shell" data-real-map data-map-role="${escapeHtml(role)}"${orderAttr}>
      <div class="real-map-canvas" data-map-canvas aria-label="Mapa real de seguimiento"></div>
      <div class="real-map-fallback" data-map-fallback>
        <p class="map-fallback-note">Mapa no disponible, usando vista simplificada.</p>
        ${fallback}
      </div>
      <div class="real-map-meta" data-map-meta>Mapa de seguimiento</div>
    </div>`;
}

// El mapa del cliente sólo se renderiza cuando hay GPS real (live=true). Muestra
// únicamente la ubicación real del rider, sin ruta ni marcadores LT/CL falsos.
function trackingMapStage({ order = null, live = false }) {
  return `
    <div class="delivery-map-stage tracking-map-stage" data-map-shell="tracking">
      ${realMapShell({ order, fallback: '<p class="map-fallback-note">Mapa no disponible en este dispositivo.</p>', role: 'tracking' })}
      <div class="map-floating-top">
        <span class="map-status-pill ${statusClass(order.status)}"><small>Estado del pedido</small><strong>${escapeHtml(trackingMapStatusTitle(order))}</strong></span>
        <span class="map-connection-pill">${realtimeChip(order)}</span>
      </div>
      <div class="map-floating-bottom">
        <span class="map-stat-pill map-destination-pill"><small>Destino</small><strong>${escapeHtml(destinationLabel(order))}</strong></span>
        <span class="map-stat-pill live-map-pill"><small>GPS</small><strong>${live ? 'En vivo' : 'Sin GPS'}</strong></span>
      </div>
    </div>`;
}

// Tarjeta del repartidor en el tracking del cliente. Es honesta:
// - Sólo muestra un rider "en vivo" cuando hay ubicación GPS REAL y reciente.
// - Si no, muestra un estado "Repartidor sin asignar" claro según el estado del pedido.
// Nunca inventa nombre, teléfono ni reputación de un repartidor inexistente.
function riderTrackingCard(order, riderLocation) {
  if (order.status === 'delivered') return '';

  if (hasLiveRiderLocation(riderLocation)) {
    const d = order.delivery || {};
    const hasRealName = d.driverName && d.driverName !== 'Sin asignar';
    const name = hasRealName ? d.driverName : 'Repartidor de La Taba';
    const age = relativeAgeLabel(riderLocation.lastFixAt || riderLocation.timestamp);
    const phone = d.driverPhone ? onlyDigits(d.driverPhone) : '';
    const contact = phone
      ? `<a class="round-action call" href="tel:${encodeURIComponent(d.driverPhone)}" aria-label="Llamar al repartidor">Tel</a>
         <a class="round-action whatsapp" href="https://wa.me/${phone}" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp del repartidor">WA</a>`
      : '';
    return `
      <div class="rider-profile is-live">
        <span class="rider-avatar live-helmet" aria-hidden="true">${helmetGlyph()}</span>
        <div class="rider-profile-text">
          <strong>Ubicación del repartidor en vivo</strong>
          <small>${escapeHtml(name)} · actualizado ${escapeHtml(age)}</small>
        </div>
        ${contact}
      </div>
    `;
  }

  const { title, sub } = riderPendingCopy(order.status);
  return `
    <div class="rider-profile rider-pending" role="status">
      <span class="rider-avatar pending" aria-hidden="true">${helmetGlyph()}</span>
      <div class="rider-profile-text">
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(sub)}</small>
      </div>
    </div>
  `;
}

function riderPendingCopy(status) {
  if (status === 'on_the_way' || status === 'arriving') {
    return { title: 'Sin GPS en vivo', sub: 'Seguís el pedido por estado y dirección.' };
  }
  if (status === 'ready') {
    return { title: 'Repartidor sin asignar', sub: 'Tu pedido está listo. En breve sale el repartidor.' };
  }
  if (status === 'preparing') {
    return { title: 'Repartidor sin asignar', sub: 'El negocio está preparando tu pedido.' };
  }
  return { title: 'Repartidor sin asignar', sub: 'El negocio está revisando tu pedido.' };
}

function relativeAgeLabel(value) {
  if (!value) return 'recién';
  const time = typeof value === 'number' ? value : new Date(value).getTime();
  if (Number.isNaN(time)) return 'recién';
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 5) return 'ahora';
  if (seconds < 60) return `hace ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return `hace ${minutes} min`;
}

function trackingAddressCard(order) {
  const address = normalizeOrderAddressDetails(order);
  if (order.deliveryMode === 'pickup' || !address.label) return '';
  return `
    <div class="tracking-address-card" data-tracking-address>
      <span class="tracking-address-icon" aria-hidden="true">${pinGlyph()}</span>
      <small>Entrega en</small>
      <strong>${escapeHtml(address.label)}</strong>
      ${address.reference ? `<p>Referencia: ${escapeHtml(address.reference)}</p>` : ''}
    </div>`;
}

export function renderTracking() {
  const container = $('[data-tracking-panel]');
  if (!container) return;
  const order = getActiveOrder();

  if (!order) {
    renderWithStableRealMap(container, `
      <div class="track-layout tracking-map-experience is-empty no-map">
        <section class="delivery-bottom-sheet tracking-sheet track-progress-card" data-bottom-sheet>
          <span class="sheet-handle" aria-hidden="true"></span>
          <div class="empty-state sheet-empty">
          <strong>No hay un pedido activo.</strong><br />
          Cuando confirmes una compra, vas a seguir acá el estado del pedido y la dirección de entrega.
          <div class="empty-actions">
            <button class="secondary-button compact" type="button" data-nav-view="catalog">Ver catálogo</button>
          </div>
          </div>
        </section>
      </div>`, { rolePrefix: 'tracking' });
    return;
  }

  const isCancelled = order.status === 'cancelled';
  const isDelivery = order.deliveryMode !== 'pickup';
  const head = trackingHeadline(order);
  const riderLocation = chooseRiderLocation(getOrderSimulation(order), order.tracking?.lastLocation);
  const liveRider = hasLiveRiderLocation(riderLocation);
  const liveAge = liveRider ? relativeAgeLabel(riderLocation.lastFixAt || riderLocation.timestamp) : '';
  const headSub = liveRider && order.status === 'on_the_way' ? 'Ubicación del repartidor en vivo.' : head.sub;
  const stepIndex = customerStepIndex(order.status);
  const metricsHtml = order.status === 'delivered'
    ? `
          <span><small>Pedido</small><strong>Finalizado</strong></span>
          <span><small>Código</small><strong>${escapeHtml(order.id)}</strong></span>
          <span><small>Total</small><strong>${money(order.total)}</strong></span>
        `
    : `
          <span><small>Estado</small><strong>${escapeHtml(statusLabel(order.status))}</strong></span>
          <span><small>Código</small><strong>${escapeHtml(order.id)}</strong></span>
          <span><small>Total</small><strong>${money(order.total)}</strong></span>
        `;

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

  const showMap = isDelivery && !isCancelled && liveRider;
  renderWithStableRealMap(container, `
    <div class="track-layout tracking-map-experience ${showMap ? '' : 'no-map'}">
      ${showMap ? trackingMapStage({ order, live: true }) : ''}

      <section class="delivery-bottom-sheet tracking-sheet track-progress-card ${showMap ? 'is-live' : 'is-offline'}" data-bottom-sheet>
        <span class="sheet-handle" aria-hidden="true"></span>
        <div class="sheet-head">
          <span class="track-head-ico">${bagGlyph()}</span>
          <div class="track-head-text">
            <small>${escapeHtml(head.kicker)}</small>
            <strong>${escapeHtml(head.title)}</strong>
            <span>${escapeHtml(headSub)}</span>
          </div>
          <span class="status-chip ${statusClass(order.status)}">${statusLabel(order.status)}</span>
        </div>
        <div class="sheet-metrics">
          ${metricsHtml}
        </div>
        <div class="track-steps">${steps}</div>
        ${isCancelled ? '<div class="warning-box">Este pedido fue cancelado. Si fue un error, escribinos por WhatsApp y lo resolvemos.</div>' : ''}
        ${isDelivery ? trackingAddressCard(order) : ''}
        ${isDelivery && !isCancelled ? riderTrackingCard(order, riderLocation) : ''}
        ${isDelivery && !isCancelled && order.status !== 'delivered'
          ? `<p class="form-hint tracking-gps-note">${liveRider ? `Actualizado ${escapeHtml(liveAge)}.` : 'Sin GPS en vivo. Seguís el pedido por estado y dirección.'}</p>`
          : ''}
        <details class="order-detail">
          <summary>Ver detalle del pedido · ${order.id}</summary>
          <div class="order-detail-body">
            <div class="order-line head"><span>${deliveryModeLabel(order.deliveryMode)}</span><strong>${escapeHtml(destinationAddressLabel(order))}</strong></div>
            ${itemsHtml}
            <div class="summary-row"><span>Subtotal</span><strong>${money(order.subtotal)}</strong></div>
            <div class="summary-row"><span>Envío</span><strong>${money(order.deliveryFee)}</strong></div>
            <div class="summary-row total"><span>Total</span><strong>${money(order.total)}</strong></div>
          </div>
        </details>
        ${isCancelled ? '' : `
        <div class="button-row track-actions">
          <button class="secondary-button compact" type="button" data-whatsapp-order>Enviar copia por WhatsApp</button>
          <button class="ghost-button compact" type="button" data-copy-last-order>Copiar pedido</button>
        </div>`}
      </section>
    </div>
  `, { rolePrefix: 'tracking', orderId: showMap ? order.id : '' });
}

// Indicador de conexión realtime (en vivo entre equipos / en este equipo).
function realtimeChip(order = null) {
  if (order?.status === 'delivered') {
    return '<span class="rt-chip done">Finalizado</span>';
  }
  const status = getRealtimeStatus();
  if (status.relayEnabled) {
    if (status.relayConnected) return '<span class="rt-chip live">En vivo</span>';
    if (status.relayState === 'offline') return '<span class="rt-chip warn">Sin conexión</span>';
    return '<span class="rt-chip warn">Reconectando</span>';
  }
  return '<span class="rt-chip local">En vivo</span>';
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
      ${product.marketNote ? `<p class="market-note">${escapeHtml(product.marketNote)}</p>` : ''}
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
  showToast.timeoutId = setTimeout(() => toast.classList.add('hidden'), 2000);
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// Glyphs SVG livianos (heredan el color del contenedor vía currentColor) que
// reemplazan los placeholders de texto (PED/RET/REP/PIN/GPS) por íconos premium.
export function bagGlyph() {
  return `<svg class="lt-glyph" viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true" focusable="false">
    <path d="M6.4 8.5h11.2l-.9 9.8a2.4 2.4 0 0 1-2.4 2.2H9.7a2.4 2.4 0 0 1-2.4-2.2L6.4 8.5Z" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M9.2 9V7.4a2.8 2.8 0 0 1 5.6 0V9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`;
}

export function helmetGlyph() {
  return `<svg class="lt-glyph" viewBox="0 0 24 24" width="21" height="21" fill="none" aria-hidden="true" focusable="false">
    <path d="M4.6 13C4.6 8.2 7.9 5.3 12 5.3s7.4 2.9 7.4 7.7V15c0 2.1-1.9 3.4-4.3 3.4H8.9C6.5 18.4 4.6 17.1 4.6 15Z" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
    <rect x="7.4" y="10.4" width="9" height="3.7" rx="1.85" fill="currentColor"/>
  </svg>`;
}

export function pinGlyph() {
  return `<svg class="lt-glyph" viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden="true" focusable="false">
    <path d="M12 21.3s-6.6-6.3-6.6-11.1a6.6 6.6 0 0 1 13.2 0c0 4.8-6.6 11.1-6.6 11.1Z" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="12" cy="9.9" r="2.4" fill="currentColor"/>
  </svg>`;
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

export function setSortBy(sortBy) {
  if (getState().sortBy === sortBy) return;
  setState({ sortBy });
}
