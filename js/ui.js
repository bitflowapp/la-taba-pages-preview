import { getBusinessConfig } from './core/business-config-store.js';
import { BRAND } from './config.js';
import { categories } from './data.js';
import { getCustomerCatalogProducts, isProductVisibleToCustomer } from './core/catalog-store.js';
import { getCustomerOrderHistory, getLatestCustomerOrder } from './core/customer-history.js';
import {
  getCustomerProfile,
  getRememberedCheckoutValues,
} from './core/customer-profile.js';
import { getFavoriteProductIds, isFavoriteProduct } from './core/customer-preferences.js';
import { buildReorderPreview } from './core/reorder.js';
import {
  deliveryModeLabel,
  dateTime,
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
import {
  formatDeliveryCode,
  formatDeliveryCodeTime,
  isDeliveryCodeConfirmed,
  normalizeDeliveryCode,
} from './core/delivery-code.js';
import { chooseRiderLocation, hasLiveRiderLocation } from './map/route_geometry.js';
import { renderPublicOrderTimeline } from './core/order-timeline.js';
import { isDemoMode } from './core/app-mode.js';
import { getOrderRepository, isSandboxOrderRepository } from './repositories/repository_factory.js';

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const PRODUCT_PLACEHOLDER_IMAGE = 'assets/products/beverage-placeholder.svg';

export function handleProductImageError(event) {
  const image = event?.target;
  if (!image?.classList?.contains('thumb-img')) return false;

  const shell = image.closest?.('.thumb');
  if (image.dataset?.fallbackApplied === 'true') {
    image.hidden = true;
    shell?.classList?.add('image-unavailable');
    return true;
  }

  image.dataset.fallbackApplied = 'true';
  image.removeAttribute?.('srcset');
  image.removeAttribute?.('sizes');
  image.src = PRODUCT_PLACEHOLDER_IMAGE;
  image.classList.add('is-placeholder');
  shell?.classList?.remove('has-photo');
  shell?.classList?.add('uses-placeholder');
  if (shell) {
    shell.setAttribute(
      'aria-label',
      `Producto sin imagen oficial: ${image.dataset.productName || 'bebida'}`,
    );
  }
  return true;
}

if (typeof document !== 'undefined') {
  document.addEventListener('error', handleProductImageError, true);
}

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
  const demo = isDemoMode();
  const config = getBusinessConfig();
  const detailsVerified = Boolean(config.orderingDetailsVerified);
  setText('[data-business-name]', config.businessName);
  setText('[data-business-subtitle]', config.subtitle);
  setText('.app-home .eyebrow', config.subtitle || 'Tienda de bebidas');
  setText('.app-home .home-lead', demo
    ? `${BRAND.demoBusinessClaim || 'Tus bebidas, ahora a un toque.'} ${BRAND.demoBusinessClaimSecondary || 'Pedí. Seguí. Disfrutá.'}`
    : 'Bebidas con catálogo y disponibilidad publicados por el comercio.');
  setText('[data-min-order]', demo || detailsVerified ? money(config.minDeliveryOrder) : 'A confirmar');
  setText('[data-delivery-fee]', demo || detailsVerified ? money(config.deliveryFee) : 'A confirmar');
  setText('[data-business-profile-name]', config.businessName);
  setText('[data-business-whatsapp]', formatWhatsappDisplay(config.whatsappNumber) || 'A confirmar con el local');
  setText('[data-business-address]', config.address);
  setText('[data-business-hours]', config.openingHoursLabel);
  setText('[data-business-zone]', config.deliveryZone);
  setText('[data-rider-business-name]', config.businessName);
  setText('[data-admin-pin]', config.adminPin);
  applyFulfillmentAvailability({
    delivery: demo || (detailsVerified && config.deliveryEnabled === true),
    pickup: demo || (detailsVerified && config.pickupEnabled === true),
  });

  // Marca del PRODUCTO (PedidoPropio): superficie comercial e intro del home.
  // Fuente única en BRAND (config.js); el HTML sólo lleva un fallback de primer pintado.
  setText('[data-product-name]', BRAND.productName);
  setText('[data-product-tagline]', BRAND.tagline);
  setText('[data-product-short-tagline]', BRAND.shortTagline);

  // Producción usa el estado autoritativo de pedidos. No se muestran horarios
  // heredados de la demo porque todavía no forman parte del contrato remoto.
  const status = $('[data-open-status]');
  if (status) {
    status.textContent = demo
      ? 'Pedidos disponibles'
      : detailsVerified
        ? 'Pedidos online habilitados'
        : 'Pedidos online no habilitados';
    status.classList.toggle('is-closed', !demo && !detailsVerified);
    status.classList.toggle('is-soon', !demo && !detailsVerified);
  }
  const statusItems = $$('.app-home .status-item');
  const seps = $$('.app-home .status-sep');
  const enabledModes = [
    config.deliveryEnabled ? 'delivery' : '',
    config.pickupEnabled ? 'retiro' : '',
  ].filter(Boolean).join(' y ');
  const chips = demo
    ? ['Delivery y retiro', 'Zona y horarios a confirmar']
    : detailsVerified
      ? ['Configuración verificada por el comercio', enabledModes]
      : ['Catálogo productivo bloqueado', 'Configuración pendiente'];
  statusItems.forEach((item, index) => {
    const label = chips[index] || '';
    item.textContent = label;
    item.hidden = !label;
    if (seps[index]) seps[index].hidden = !label;
  });
}

function applyFulfillmentAvailability(availability) {
  const options = [...document.querySelectorAll('[data-fulfillment-option]')];
  let firstEnabled = null;
  for (const label of options) {
    const mode = label.dataset.fulfillmentOption;
    const input = label.querySelector(`input[name="deliveryMode"][value="${mode}"]`);
    const enabled = availability[mode] === true;
    label.hidden = !enabled;
    label.setAttribute('aria-hidden', String(!enabled));
    if (input) {
      input.disabled = !enabled;
      if (enabled && !firstEnabled) firstEnabled = input;
    }
  }
  const selected = document.querySelector('input[name="deliveryMode"]:checked');
  if ((!selected || selected.disabled) && firstEnabled) firstEnabled.checked = true;
}

// Versión corta de la zona para el chip del home ("Neuquén centro, barrios..." es muy largo).
function shortZoneLabel(zone) {
  const text = String(zone || '').trim();
  if (!text) return 'Zona de entrega configurada';
  const firstPart = text.split(/[,·]/)[0].trim();
  return firstPart.length > 34 ? `${firstPart.slice(0, 31)}…` : firstPart || text;
}

function setText(selector, value) {
  $$(selector).forEach((node) => { node.textContent = value; });
}

function formatWhatsappDisplay(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits ? `+${digits}` : '';
}

export function renderNavigation(activeView = 'home') {
  document.body.dataset.activeView = activeView;
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
  renderSearchControls();
  renderProducts();
}

export function discountPercent(product) {
  if (!product || !product.oldPrice || product.oldPrice <= product.price) return 0;
  return Math.round(((product.oldPrice - product.price) / product.oldPrice) * 100);
}

function unitText(product) {
  return product.unitLabel || product.unit || '';
}

function productImage(product) {
  return product?.image || '';
}

// Una fotografía sólo se considera oficial si llega con la cadena de hashes y
// thumbnail del catálogo productivo. Todo lo demás usa el mismo placeholder.
export function productThumb(product, variant = 'grid') {
  const tone = product.tone || (product.alcoholic ? 'alcoholic' : 'drink');
  const category = sanitizeCategoryId(product.categoryId) || 'bebidas';
  const image = productImage(product);
  const thumbnail = product.imageThumbnail || product.thumbnail || '';
  const hasAuthoritativeHashes = [
    product.imageSha256,
    product.imageThumbnailSha256,
    product.sourceImageSha256,
  ].every((hash) => /^[a-f0-9]{64}$/i.test(String(hash || '')));
  const official = Boolean(
    image
    && thumbnail
    && (!product.qaFixture || product.previewCatalogApproved === true)
    && hasAuthoritativeHashes,
  );
  const loading = variant === 'modal' ? 'eager' : 'lazy';
  const source = official ? thumbnail : PRODUCT_PLACEHOLDER_IMAGE;
  const responsive = official
    ? ` srcset="${escapeHtml(thumbnail)} 400w, ${escapeHtml(image)} 1000w" sizes="${variant === 'modal' ? '(max-width: 700px) 92vw, 560px' : '(max-width: 700px) 45vw, 260px'}"`
    : '';
  const label = official
    ? `Imagen oficial de ${product.name || 'producto'}`
    : `Producto sin imagen oficial: ${product.name || 'bebida'}`;
  return `
    <span class="thumb ${official ? 'has-photo' : 'uses-placeholder'} tone-${tone} category-${category} thumb-${variant}" role="img" aria-label="${escapeHtml(label)}">
      <img class="thumb-img${official ? '' : ' is-placeholder'}" src="${escapeHtml(source)}"${responsive} alt="" data-product-name="${escapeHtml(product.name || 'bebida')}" loading="${loading}" decoding="async" />
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

// Un solo badge por foto: descuento (con combo fusionado), etiqueta propia,
// "Más pedido" o "Destacado". Evita apilar 3-4 cintas sobre la imagen.
function topBadge(product) {
  const off = discountPercent(product);
  if (product.combo && off > 0) return `<span class="offer-badge combo">Combo · ${off}% OFF</span>`;
  if (off > 0) return `<span class="offer-badge discount">${off}% OFF</span>`;
  if (product.badge) return `<span class="offer-badge promo">${escapeHtml(product.badge)}</span>`;
  if (product.popular) return '<span class="offer-badge promo">Más pedido</span>';
  if (product.featured) return '<span class="offer-badge promo">Destacado</span>';
  return '';
}

function offerBadges(product) {
  const badge = topBadge(product);
  return badge ? `<div class="product-badges">${badge}</div>` : '';
}

function priceBlock(product) {
  const old = product.oldPrice && product.oldPrice > product.price
    ? `<s>${money(product.oldPrice)}</s>` : '';
  return `
    <div class="price">
      <div class="price-amounts"><strong>${money(product.price)}</strong>${old}</div>
    </div>`;
}

// "Las más pedidas" del home: productos populares del catálogo activo.
// primero. Se exporta la lista para que "Combos y promos" no repita productos.
function homeOfferProducts() {
  return getCustomerCatalogProducts(getState().products)
    .filter((product) => product.available && product.stock > 0 && (product.popular || product.featured))
    .filter((product) => !product.combo)
    .sort((a, b) => popularScore(b) - popularScore(a))
    .slice(0, 6);
}

function renderOffers() {
  const container = $('[data-offers-rail]');
  if (!container) return;
  container.innerHTML = homeOfferProducts().map(railCard).join('');
}

function renderCombos() {
  const container = $('[data-combos-rail]');
  if (!container) return;
  const offerIds = new Set(homeOfferProducts().map((product) => product.id));
  const combos = getCustomerCatalogProducts(getState().products)
    .filter((product) => (
      product.available
      && product.stock > 0
      && (product.combo || product.categoryId === 'promos')
    ))
    .filter((product) => !offerIds.has(product.id))
    .slice(0, 8);

  const block = container.closest('.rail-block');
  if (block) block.hidden = !combos.length;
  container.innerHTML = combos.length
    ? combos.map(railCard).join('')
    : '';
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
        <small class="offer-availability">${product.stock > 0 && product.available ? 'Disponible' : 'Agotado'}</small>
        <div class="offer-price">
          <span>${money(product.price)}</span>
          ${old}
        </div>
      </div>
      <button class="rail-add" type="button" data-add-product="${product.id}" aria-label="Agregar ${escapeHtml(product.name)} al pedido" ${product.stock <= 0 || !product.available ? 'disabled' : ''}>
        <span aria-hidden="true">+</span> Agregar
      </button>
    </article>
  `;
}

const CATEGORY_GLYPHS = Object.freeze({
  gaseosas: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <path d="M9.5 3h5v3l1.4 2.3v10.2a2.5 2.5 0 0 1-2.5 2.5h-2.8a2.5 2.5 0 0 1-2.5-2.5V8.3L9.5 6V3Z" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.6"/>
    <path d="M8.1 12h7.8" stroke="currentColor" stroke-width="1.6"/>
  </svg>`,
  energeticas: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <path d="m13.5 2.8-7 10.1h5l-1 8.3 7-10.4h-5l1-8Z" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
  </svg>`,
  promos: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <path d="M12.6 3.6 20 11a2.2 2.2 0 0 1 0 3.1l-5.9 5.9a2.2 2.2 0 0 1-3.1 0L3.6 12.6A2 2 0 0 1 3 11.2V5a2 2 0 0 1 2-2h6.2c.5 0 1 .2 1.4.6Z" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <circle cx="8.2" cy="8.2" r="1.5" fill="currentColor"/>
  </svg>`,
  aguas: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <path d="M9.4 3h5.2v3l1.4 2.2a3 3 0 0 1 .5 1.6V19a2 2 0 0 1-2 2H9.5a2 2 0 0 1-2-2V9.8a3 3 0 0 1 .5-1.6L9.4 6V3Z" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M7.5 12.4h9" stroke="currentColor" stroke-width="1.6"/>
  </svg>`,
  jugos: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <path d="M6 7h12l-1 14H7L6 7Z" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="m9 7 2-4h5M9 12h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`,
  isotonicas: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <path d="M9 3h6v3l1.5 2.2V20H7.5V8.2L9 6V3Z" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.6"/>
    <path d="m13 9-3 4h2l-1 3 3-4h-2l1-3Z" fill="currentColor"/>
  </svg>`,
  cervezas: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <path d="M7 5h9v15H7V5Z" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.6"/>
    <path d="M16 8h1.5a2.5 2.5 0 0 1 0 5H16M7 8h9" stroke="currentColor" stroke-width="1.6"/>
  </svg>`,
  'vinos-y-espumantes': `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <path d="M10 3h4v5l2 3v10H8V11l2-3V3Z" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M8 14h8" stroke="currentColor" stroke-width="1.6"/>
  </svg>`,
  'gins-y-vodkas': `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <path d="M9 3h6v4l2 3v11H7V10l2-3V3Z" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <circle cx="12" cy="14" r="2.5" stroke="currentColor" stroke-width="1.6"/>
  </svg>`,
  'whisky-y-destilados': `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <path d="M8 3h8l1 18H7L8 3Z" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M7.5 14h9M9 7h6" stroke="currentColor" stroke-width="1.6"/>
  </svg>`,
  'picadas-y-deli': `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <rect x="3.5" y="6" width="17" height="13" rx="3" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.6"/>
    <path d="M7 10h10M7 14h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`,
  'hielo-y-extras': `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <path d="m5 8 7-4 7 4v8l-7 4-7-4V8Z" fill="currentColor" fill-opacity="0.12" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="m5 8 7 4 7-4M12 12v8" stroke="currentColor" stroke-width="1.6"/>
  </svg>`,
  favorites: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.4 7.2 18.9l.9-5.4-3.9-3.8 5.4-.8L12 4Z" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
  </svg>`,
  all: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <rect x="4" y="4" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.6"/>
    <rect x="13" y="4" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.6"/>
    <rect x="4" y="13" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.6"/>
    <rect x="13" y="13" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.6"/>
  </svg>`,
});

function categoryGlyph(categoryId) {
  return CATEGORY_GLYPHS[categoryId] || CATEGORY_GLYPHS.all;
}

function renderCategories() {
  const strips = $$('[data-category-strip]');
  if (!strips.length) return;
  const { activeCategory } = getState();
  const catalogCategories = categoriesForCurrentCatalog();
  const fullList = [
    catalogCategories[0],
    { id: 'favorites', name: 'Favoritos' },
    ...catalogCategories.slice(1),
  ];
  const homeList = catalogCategories.filter((category) => category.id !== 'all');

  const markupFor = (list) => list.map((category) => `
    <button class="category-button ${activeCategory === category.id ? 'active' : ''}" type="button" data-category-id="${category.id}">
      <span class="category-ico" aria-hidden="true">${categoryGlyph(category.id)}</span>
      <span class="category-label">${escapeHtml(category.name)}</span>
    </button>
  `).join('');

  strips.forEach((strip) => {
    strip.innerHTML = markupFor(strip.dataset.categoryStrip === 'home' ? homeList : fullList);
  });
}

// Productos filtrados por categoría + búsqueda, ya ordenados.
function getFilteredProducts(state) {
  const query = normalizeSearchText(state.searchQuery);
  const favoriteIds = new Set(getFavoriteProductIds());
  const filtered = getCustomerCatalogProducts(state.products).filter((product) => {
    const matchesCategory = state.activeCategory === 'favorites'
      ? favoriteIds.has(product.id)
      : state.activeCategory === 'all' || product.categoryId === state.activeCategory;
    const searchable = [
      product.brand,
      product.name,
      product.variant,
      product.presentation,
      product.unitLabel,
      product.capacity,
      product.subcategory,
      product.categoryName,
      product.categoryId,
      ...(Array.isArray(product.tags) ? product.tags : []),
    ].filter(Boolean).join(' ');
    const matchesQuery = !query || normalizeSearchText(searchable).includes(query);
    return matchesCategory && matchesQuery;
  });
  return sortProducts(filtered, state.sortBy);
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
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
  if (activeCategory === 'favorites') return 'Favoritos';
  return categoriesForCurrentCatalog().find((category) => category.id === activeCategory)?.name || 'Todos';
}

function categoriesForCurrentCatalog() {
  const remote = new Map();
  for (const product of getState().products) {
    const id = sanitizeCategoryId(product?.categoryId);
    const name = String(product?.categoryName || '').trim();
    if (id && name && !remote.has(id)) remote.set(id, name);
  }
  if (!remote.size) return categories;

  const preferredOrder = [
    'promos',
    'gaseosas',
    'aguas',
    'jugos',
    'energeticas',
    'isotonicas',
    'cervezas',
    'vinos-y-espumantes',
    'gins-y-vodkas',
    'whisky-y-destilados',
    'picadas-y-deli',
    'hielo-y-extras',
  ];
  const rank = new Map(preferredOrder.map((id, index) => [id, index]));
  const dynamic = [...remote.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => (
      (rank.get(a.id) ?? preferredOrder.length) - (rank.get(b.id) ?? preferredOrder.length)
      || a.name.localeCompare(b.name, 'es')
    ));
  return [{ id: 'all', name: 'Todos' }, ...dynamic];
}

function sanitizeCategoryId(value) {
  const id = String(value || '').trim();
  return /^[a-z0-9][a-z0-9-]{0,39}$/.test(id) ? id : '';
}

// Rail de ofertas de la categoría activa, arriba del grid del catálogo.
// Con una búsqueda activa se oculta: si el grid dice "0 productos", no puede
// quedar un rail mostrando ofertas que no coinciden con lo buscado.
function renderCatalogOffers() {
  const container = $('[data-catalog-offers]');
  if (!container) return;
  const state = getState();
  const searching = Boolean(state.searchQuery.trim());
  const offers = searching ? [] : getCustomerCatalogProducts(state.products)
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

function renderSearchControls() {
  const query = getState().searchQuery;
  $$('[data-search-input]').forEach((input) => {
    if (input.value !== query) input.value = query;
  });
}

function renderProducts() {
  const container = $('[data-product-grid]');
  if (!container) return;

  const state = getState();
  const filteredProducts = getFilteredProducts(state);

  if (!filteredProducts.length) {
    const isFavorites = state.activeCategory === 'favorites';
    const isSearch = Boolean(state.searchQuery.trim());
    const emptyTitle = isFavorites
      ? 'Todavía no guardaste favoritos.'
      : isSearch
        ? 'No encontramos esa bebida.'
        : 'No hay productos disponibles en esta categoría.';
    const emptyCopy = isFavorites
      ? 'Tocá Guardar en un producto para encontrarlo acá.'
      : isSearch
        ? 'Probá con la marca, la presentación o limpiá el buscador.'
        : 'Volvé a ver el catálogo completo o elegí otra categoría.';
    container.innerHTML = `
      <div class="empty-state">
        <strong>${emptyTitle}</strong>
        <p class="empty-state-copy">${emptyCopy}</p>
        <div class="empty-actions">
          <button class="secondary-button compact" type="button" data-clear-catalog-filters>Ver todo el catálogo</button>
        </div>
      </div>`;
    return;
  }

  const cartQuantities = new Map(getCartItems().map((item) => [item.productId, item.quantity]));

  container.innerHTML = filteredProducts.map((product) => {
    const outOfStock = product.stock <= 0 || !product.available;
    const unavailableLabel = !product.available ? 'No disponible' : 'Agotado';
    const offer = discountPercent(product) > 0;
    const inCart = cartQuantities.get(product.id) || 0;
    const control = inCart > 0
      ? `<div class="qty-stepper" aria-label="Cantidad de ${escapeHtml(product.name)} en el pedido">
          <button class="icon-button compact" type="button" data-cart-dec="${product.id}" aria-label="Restar uno de ${escapeHtml(product.name)}">−</button>
          <strong>${inCart}</strong>
          <button class="icon-button compact" type="button" data-cart-inc="${product.id}" aria-label="Sumar uno de ${escapeHtml(product.name)}" ${inCart >= product.stock ? 'disabled' : ''}>+</button>
        </div>`
      : `<button class="add-button" type="button" data-add-product="${product.id}" aria-label="Agregar ${escapeHtml(product.name)} al pedido" ${outOfStock ? 'disabled' : ''}>
          <span class="add-plus">+</span><span class="add-text">${outOfStock ? unavailableLabel : 'Agregar'}</span>
        </button>`;
    return `
      <article class="product-card ${outOfStock ? 'out-of-stock' : ''} ${offer ? 'is-offer' : ''} ${inCart > 0 ? 'in-cart' : ''}">
        <button class="product-media" type="button" data-product-detail="${product.id}" aria-label="Ver ${escapeHtml(product.name)}">
          ${productThumb(product, 'grid')}
          <span class="product-stock-tag">${stockPill(product)}</span>
        </button>
        <div class="product-body">
          <h3>${escapeHtml(product.name)}</h3>
          <p>${escapeHtml(product.unitLabel || product.variant || product.packageType || '')}</p>
          <small class="product-availability ${outOfStock ? 'is-unavailable' : ''}">${escapeHtml(cardAvailabilityLabel(product))}</small>
        </div>
        <div class="product-bottom">
          ${priceBlock(product)}
          ${control}
        </div>
      </article>
    `;
  }).join('');
}

// Pill de disponibilidad: sólo aparece cuando hay algo que avisar (agotado,
// pausado, últimas unidades). Lo normal —estar disponible— no se etiqueta.
export function stockPill(product) {
  if (product.archived) return '<span class="stock-pill empty">Archivado</span>';
  if (!product.available) return '<span class="stock-pill empty">No disponible</span>';
  if (product.stock <= 0) return '<span class="stock-pill empty">Agotado</span>';
  if (product.stock <= 4) return `<span class="stock-pill low">Quedan ${product.stock}</span>`;
  return '';
}

// Texto plano de disponibilidad para el detalle del producto.
export function availabilityLabel(product) {
  if (product.archived || !product.available) return 'No disponible por ahora';
  if (product.stock <= 0) return 'Agotado';
  if (product.stock <= 4) return `Quedan ${product.stock}`;
  return 'Disponible hoy';
}

function cardAvailabilityLabel(product) {
  if (product.archived || !product.available) return 'No disponible';
  if (product.stock <= 0) return 'Agotado';
  if (product.stock <= 4) return `Últimas ${product.stock}`;
  return 'Disponible';
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

export function renderCustomerHome() {
  renderHomeAddressChip();
  renderPromoBanner();
  renderDirectOrderingCustomerActions();
  renderCustomerHistory();
}

// Chip "Enviar a" del home (referencia visual de la maqueta). Es honesto:
// muestra la dirección recordada del cliente si existe; si no, invita a
// cargarla al confirmar. Nunca inventa una dirección.
function renderHomeAddressChip() {
  const label = $('[data-home-address-label]');
  if (!label) return;
  const remembered = getRememberedCheckoutValues();
  const street = remembered?.customerStreetAddress?.trim();
  if (street) {
    const neighborhood = remembered?.customerNeighborhood?.trim();
    label.textContent = neighborhood ? `${street} · ${neighborhood}` : street;
  } else {
    label.textContent = 'Elegí tu dirección al confirmar el pedido';
  }
}

// Banner de promo del día: lee el producto real del catálogo para que precio,
// composición y ahorro nunca queden desactualizados respecto del panel.
function renderPromoBanner() {
  const banner = $('[data-promo-banner]');
  if (!banner) return;
  const promo = getCustomerCatalogProducts(getState().products)
    .find((product) => product.categoryId === 'promos' && product.available && product.stock > 0);
  banner.hidden = !promo;
  if (!promo) return;
  const price = $('[data-promo-banner-price]', banner);
  if (price) price.textContent = money(promo.price);
  const title = $('[data-promo-banner-title]', banner);
  if (title) title.textContent = promo.name;
  const includes = $('[data-promo-banner-includes]', banner);
  if (includes) {
    const composition = String(promo.description || '').replace(/\.$/, '');
    includes.textContent = composition ? `Incluye ${composition.charAt(0).toLowerCase()}${composition.slice(1)}` : '';
    includes.hidden = !composition;
  }
  const save = $('[data-promo-banner-save]', banner);
  if (save) {
    const saving = Number(promo.oldPrice || 0) - Number(promo.price || 0);
    save.hidden = !(saving > 0);
    if (saving > 0) save.textContent = `Ahorrás ${money(saving)}`;
  }
}

function renderCustomerActions() {
  const container = $('[data-customer-actions]');
  if (!container) return;
  const latest = getLatestCustomerOrder();
  if (!latest) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <section class="customer-action-panel" aria-label="Acciones del cliente">
      <div>
        <strong>Tu pedido de siempre</strong>
        <span>${escapeHtml(latest.id)} · ${latest.items.length} ${latest.items.length === 1 ? 'producto' : 'productos'} · ${money(latest.total)}</span>
      </div>
      <button class="primary-button compact" type="button" data-repeat-order="${escapeHtml(latest.id)}">Repetir último pedido</button>
    </section>`;
}

function renderDirectOrderingCustomerActions() {
  const container = $('[data-customer-actions]');
  if (!container) return;
  const activeOrder = getActiveOrder();
  const activeNonTerminalId = activeOrder
    && !['delivered', 'cancelled'].includes(activeOrder.status)
    ? activeOrder.id
    : '';
  const latest = getCustomerOrderHistory().find((order) => (
    order.status === 'delivered' && order.id !== activeNonTerminalId
  )) || null;
  if (!latest) {
    container.innerHTML = '';
    container.closest('.app-home')?.classList.remove('has-reorder');
    return;
  }
  container.closest('.app-home')?.classList.add('has-reorder');
  const promo = $('[data-promo-banner]');
  if (promo && container.nextElementSibling !== promo) promo.before(container);

  const preview = buildReorderPreview(latest, getState().products);
  const itemNames = preview.items.slice(0, 2).map((item) => `${item.quantity}× ${item.name}`);
  const extra = Math.max(0, preview.items.length - itemNames.length);
  const summary = itemNames.length
    ? `${itemNames.join(' · ')}${extra ? ` · +${extra}` : ''}`
    : 'Los productos del pedido anterior ya no están disponibles';
  const notice = [
    preview.priceChanged ? 'Total actualizado con precios actuales.' : '',
    preview.skipped.length ? `${preview.skipped.length} producto(s) no disponible(s).` : '',
  ].filter(Boolean).join(' ');

  container.innerHTML = `
    <section class="customer-action-panel reorder-card" aria-label="Volver a pedir">
      <span class="reorder-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none">
          <path d="M5 8a8 8 0 1 1-1 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          <path d="M5 3v5h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
      <div class="reorder-card-copy">
        <span class="reorder-kicker">Volver a pedir</span>
        <strong>${escapeHtml(summary)}</strong>
        <small>${notice ? escapeHtml(notice) : 'Revisá el pedido antes de confirmar.'}</small>
      </div>
      <div class="reorder-card-side">
        <strong>${money(preview.totals.total)}</strong>
        <button class="primary-button compact" type="button" data-repeat-order="${escapeHtml(latest.id)}" ${preview.canRepeat ? '' : 'disabled'}>Agregar de nuevo</button>
      </div>
    </section>`;
}

function renderCustomerHistory() {
  const container = $('[data-customer-history]');
  if (!container) return;
  const history = customerHistoryWithLiveState();
  if (!history.length) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <section class="customer-history-panel" aria-label="Mis últimos pedidos">
      <div class="rail-head">
        <h2>Mis últimos pedidos</h2>
      </div>
      <div class="customer-history-list">
        ${history.slice(0, 4).map(customerHistoryRow).join('')}
      </div>
    </section>`;
}

function customerHistoryWithLiveState() {
  const liveById = new Map(getState().orders.map((order) => [order.id, order]));
  return getCustomerOrderHistory().map((entry) => {
    const live = liveById.get(entry.id);
    return live ? { ...entry, ...live } : entry;
  });
}

function customerHistoryRow(order) {
  const coupon = Number(order.discountTotal || 0) > 0 ? ` · ${escapeHtml(order.coupon?.code || 'Promo')}` : '';
  return `
    <article class="customer-history-row">
      <div>
        <strong>${escapeHtml(order.id)}</strong>
        <span>${escapeHtml(dateTime(order.createdAt))} · ${escapeHtml(statusLabel(order.status))}${coupon}</span>
        <small>${escapeHtml(order.paymentMethod || 'Efectivo')}</small>
      </div>
      <div class="customer-history-side">
        <strong>${money(order.total)}</strong>
        <button class="secondary-button compact" type="button" data-repeat-order="${escapeHtml(order.id)}">Repetir</button>
      </div>
    </article>`;
}

export function renderCart() {
  renderCartTotals();
  renderCartList();
  hydrateCheckoutFromProfile();
  renderOrderSummary();
  renderCheckoutVisibility();
}

// Con el carrito vacío no tiene sentido mostrar el formulario "Datos para finalizar"
// (campos y totales en $0) ni el botón de vaciar: dejamos solo el estado vacío con
// el acceso a productos, para que la vista del pedido se sienta limpia.
function renderCheckoutVisibility() {
  const cartItems = getCartItems();
  const isEmpty = cartItems.length === 0;
  const form = $('[data-checkout-form]');
  if (form) form.hidden = isEmpty;
  $$('[data-clear-cart]').forEach((button) => { button.hidden = isEmpty; });
  const requiresAgeConfirmation = cartItems.some((item) => item.product.alcoholic);
  const requiredAge = Math.max(
    18,
    ...cartItems
      .filter((item) => item.product.alcoholic)
      .map((item) => Number(item.product.minimumAge || item.product.minimum_age || 18)),
  );
  const ageRow = $('[data-age-confirmation]');
  const ageInput = $('[name="ageConfirmed"]');
  const ageTitle = $('[data-age-confirmation-title]');
  if (ageRow) {
    ageRow.hidden = !requiresAgeConfirmation;
    ageRow.setAttribute('aria-hidden', String(!requiresAgeConfirmation));
  }
  if (ageInput) {
    ageInput.required = requiresAgeConfirmation;
    if (!requiresAgeConfirmation) ageInput.checked = false;
  }
  if (ageTitle) ageTitle.textContent = `Confirmo que soy mayor de ${requiredAge} años`;
}

export function renderCartTotals() {
  const summary = getCartSummary(currentDeliveryMode());
  const subtotalSummary = getCartSummary('pickup');
  const floatingAllowed = ['home', 'catalog'].includes(
    document.body.dataset.activeView || 'home',
  );
  const floatingText = `Ver pedido · ${money(subtotalSummary.subtotal)}`;
  setText('[data-cart-count]', String(summary.count));
  setText('[data-cart-count-mobile]', String(summary.count));
  setText('[data-cart-total-small]', summary.count > 0 ? money(subtotalSummary.subtotal) : 'Pedido');
  setText('[data-floating-cart-summary]', floatingText);
  $$('[data-cart-count], [data-cart-count-mobile]').forEach((node) => {
    node.classList.toggle('is-empty', summary.count === 0);
  });
  $$('[data-floating-cart]').forEach((node) => {
    node.classList.toggle('hidden', summary.count === 0 || !floatingAllowed);
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
    const activeNonTerminalId = hasActiveOrder ? activeOrder.id : '';
    const latestOrder = getCustomerOrderHistory().find((order) => (
      order.status === 'delivered' && order.id !== activeNonTerminalId
    )) || null;
    container.innerHTML = `
      <div class="empty-state cart-empty-state">
        <span class="empty-state-ico" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none">
            <path d="M5.5 8h13l-1.1 11.5H6.6L5.5 8Z" fill="currentColor" fill-opacity="0.12" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
            <path d="M9 8V6.5a3 3 0 0 1 6 0V8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </span>
        <strong>Tu pedido está vacío</strong>
        <p class="empty-state-copy">Sumá un producto del catálogo y seguí desde acá.</p>
        ${hasActiveOrder ? `
        <div class="cart-active-order">
          <small>Pedido en curso</small>
          <strong>${escapeHtml(activeOrder.id)} · ${escapeHtml(statusLabel(activeOrder.status))}</strong>
          <button class="secondary-button compact" type="button" data-nav-view="tracking">Ver seguimiento</button>
        </div>` : ''}
        ${latestOrder ? `
        <div class="cart-active-order">
          <small>Pedido anterior</small>
          <strong>${escapeHtml(latestOrder.id)} · ${money(latestOrder.total)}</strong>
          <button class="secondary-button compact" type="button" data-repeat-order="${escapeHtml(latestOrder.id)}">Repetir último pedido</button>
        </div>` : ''}
        <div class="empty-actions">
          <button class="primary-button compact" type="button" data-nav-view="catalog">Ver el catálogo</button>
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
  const couponCode = currentCouponCode();
  const { items, subtotal, discountTotal, deliveryFee, total, coupon } = getCartSummary(deliveryMode, { couponCode });
  const validation = validateCartForCheckout(deliveryMode);
  renderCheckoutPaymentFields();
  renderCouponMessage(coupon);

  const coordinatedDelivery = deliveryMode === 'delivery'
    && !isDemoMode()
    && !getBusinessConfig().orderingDetailsVerified;
  container.innerHTML = `
    <div class="summary-row"><span>Subtotal</span><strong>${money(subtotal)}</strong></div>
    ${discountTotal > 0 ? `<div class="summary-row discount"><span>Cupón ${escapeHtml(coupon.code)}</span><strong>-${money(discountTotal)}</strong></div>` : ''}
    <div class="summary-row"><span>${deliveryMode === 'pickup' ? 'Retiro en local' : 'Envío a domicilio'}</span><strong>${coordinatedDelivery ? 'A coordinar' : money(deliveryFee)}</strong></div>
    ${deliveryMode === 'delivery' && !coordinatedDelivery ? `<div class="summary-row muted"><span>Pedido mínimo delivery</span><strong>${money(getBusinessConfig().minDeliveryOrder)}</strong></div>` : ''}
    <div class="summary-row total"><span>${coordinatedDelivery ? 'Total estimado de productos' : 'Total'}</span><strong>${money(total)}</strong></div>
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

function currentPaymentMethod() {
  const field = $('[name="paymentMethod"]');
  return field?.value || 'coordinate';
}

function currentCouponCode() {
  const field = $('[name="couponCode"]');
  return field?.value || '';
}

function renderCheckoutPaymentFields() {
  const paymentMethod = currentPaymentMethod();
  const isCash = paymentMethod === 'cash';
  const cashField = $('[data-cash-change-field]');
  if (cashField) {
    cashField.classList.toggle('hidden', !isCash);
    if (!isCash) {
      const input = cashField.querySelector('[name="cashChange"]');
      if (input) input.value = '';
    }
  }

  const note = $('[data-payment-note]');
  if (!note) return;
  note.classList.remove('hidden');
  note.textContent = 'El pago se coordina con el local antes de preparar el pedido.';
}

function renderCouponMessage(coupon) {
  const node = $('[data-coupon-message]');
  if (!node) return;
  const code = currentCouponCode().trim();
  if (!code) {
    node.textContent = '';
    node.classList.add('hidden');
    node.classList.remove('is-error', 'is-success');
    return;
  }
  node.textContent = coupon.message;
  node.classList.toggle('hidden', !coupon.message);
  node.classList.toggle('is-error', !coupon.ok);
  node.classList.toggle('is-success', coupon.ok);
}

function hydrateCheckoutFromProfile() {
  const form = $('[data-checkout-form]');
  if (!form || form.dataset.profileHydrated === 'true') return;
  const remembered = getRememberedCheckoutValues();
  if (!remembered) return;
  const setIfEmpty = (name, value) => {
    const field = form.elements?.[name];
    if (!field || field.value) return;
    field.value = value || '';
  };
  setIfEmpty('customerName', remembered.customerName);
  setIfEmpty('customerPhone', remembered.customerPhone);
  setIfEmpty('customerStreetAddress', remembered.customerStreetAddress);
  setIfEmpty('customerNeighborhood', remembered.customerNeighborhood);
  setIfEmpty('customerReference', remembered.customerReference);
  const remember = form.elements?.rememberCustomer;
  if (remember) remember.checked = true;
  form.dataset.profileHydrated = 'true';
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
    cashChange: String(formData.get('cashChange') || ''),
    couponCode: String(formData.get('couponCode') || ''),
    rememberCustomer: formData.get('rememberCustomer') === 'on',
    ageConfirmed: formData.get('ageConfirmed') === 'on',
  };
}

export function updateAddressFieldVisibility() {
  const field = $('[data-address-field]');
  if (!field) return;
  const isPickup = currentDeliveryMode() === 'pickup';
  field.classList.toggle('hidden', isPickup);
  const title = $('[data-checkout-details-title]');
  if (title) title.textContent = isPickup ? 'Datos para retirar' : 'Datos de entrega';
}

// ===== Seguimiento del pedido (vista cliente) =====
// El cliente ve cuatro etapas comerciales; los estados internos siguen
// disponibles en Negocio/Rider, pero no se filtran a esta superficie.
const TRACKING_STATUS_LABELS = Object.freeze({
  draft: 'Confirmado',
  submitted: 'Confirmado',
  received: 'Confirmado',
  accepted: 'Preparando',
  preparing: 'Preparando',
  ready: 'Preparando',
  assigned: 'Preparando',
  picked_up: 'En camino',
  on_the_way: 'En camino',
  arrived: 'En camino',
  arriving: 'En camino',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
});

function trackingStatusLabel(status) {
  return TRACKING_STATUS_LABELS[status] || statusLabel(status);
}

function getOrderSimulation(order) {
  const sim = getState().simulation;
  return sim && sim.orderId === order.id ? sim : null;
}

function trackingHeadline(order) {
  if (order.status === 'delivered') {
    return { kicker: 'Pedido entregado', title: '¡Disfrutalo!', sub: `Gracias por comprar en ${getBusinessConfig().businessName}.` };
  }
  if (order.status === 'cancelled') {
    return {
      kicker: 'Pedido cancelado',
      title: 'Pedido cancelado',
      sub: order.cancelReason ? `Motivo: ${order.cancelReason}.` : 'Contactá al local por un canal verificado.',
    };
  }
  if (order.status === 'preparing') {
    const prepMinutes = Number(order.delivery?.estimatedPreparationMinutes || 0);
    return {
      kicker: 'Pedido aceptado',
      title: 'Aceptado y en preparación',
      sub: prepMinutes > 0
        ? `Tu pedido fue aceptado. Tiempo estimado de preparación: ${prepMinutes} min.`
        : 'El negocio está preparando tu pedido.',
    };
  }
  if (order.status === 'ready') {
    return {
      kicker: 'Pedido listo',
      title: order.deliveryMode === 'pickup' ? 'Listo para retirar' : 'Listo para reparto',
      sub: order.deliveryMode === 'pickup'
        ? `Te esperamos en ${getBusinessConfig().address}.`
        : 'El pedido está listo en el local. Falta asignar o iniciar el reparto.',
    };
  }
  if (order.deliveryMode === 'pickup') {
    return { kicker: 'Retiro en local', title: order.status === 'ready' ? 'Listo para retirar' : 'Preparando tu pedido', sub: `Te esperamos en ${getBusinessConfig().address}.` };
  }
  if (order.status === 'arriving') {
    return { kicker: 'En reparto', title: 'Llegando al domicilio', sub: 'El repartidor va hacia tu dirección.' };
  }
  if (order.status === 'on_the_way') {
    return { kicker: 'En reparto', title: 'Pedido en reparto', sub: 'Tu pedido salió del local y va camino a tu dirección.' };
  }
  return {
    kicker: 'Pedido confirmado',
    title: 'Pedido confirmado',
    sub: 'Guardamos tu pedido. Acá vas a ver cada cambio de estado.',
  };
}

function destinationAddressLabel(order) {
  return displayDestinationLabel(order?.address || order?.delivery?.demoDestinationAddressLabel);
}

function displayDestinationLabel(value) {
  return String(value || '')
    .replace(/^Destino demo\s*·\s*/i, 'Destino · ')
    .replace(/^Local demo\s*·\s*/i, 'Local · ');
}

function trackingPrimaryMetric(order) {
  const sandboxSimulation = getOrderSimulation(order);
  if (isSandboxOrderRepository(getOrderRepository())
    && sandboxSimulation
    && ['on_the_way', 'arriving'].includes(order.status)
    && Number.isFinite(Number(sandboxSimulation.etaMinutes))) {
    return { label: 'Llega en', value: `${Math.max(0, Math.round(Number(sandboxSimulation.etaMinutes)))} min` };
  }
  if (!order) return { label: 'Estado', value: 'Sin información' };
  if (order.status === 'delivered') return { label: 'Estado', value: 'Entregado' };
  const etaMinutes = Number(order.delivery?.etaMinutes);
  const calculatedAt = new Date(order.delivery?.etaCalculatedAt || '').getTime();
  const expiresAt = new Date(order.delivery?.etaExpiresAt || '').getTime();
  const reliableEta = Number.isFinite(etaMinutes)
    && etaMinutes > 0
    && etaMinutes <= 1440
    && Number.isFinite(calculatedAt)
    && Number.isFinite(expiresAt)
    && expiresAt > calculatedAt
    && expiresAt > Date.now()
    && Boolean(String(order.delivery?.etaSource || '').trim());
  if (reliableEta) {
    return {
      label: 'Llega en',
      value: `${Math.round(etaMinutes)} min`,
    };
  }
  return {
    label: 'Estado',
    value: trackingStatusLabel(order.status),
  };
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
function sandboxTrackingStage(order, simulation) {
  const progress = Math.max(0, Math.min(1, Number(simulation?.progress) || 0));
  const percent = Math.round(progress * 100);
  const eta = Number.isFinite(Number(simulation?.etaMinutes))
    ? Math.max(0, Math.round(Number(simulation.etaMinutes)))
    : null;
  const cx = Math.max(18, Math.min(302, 18 + (284 * progress)));
  const cy = Math.max(20, 76 - (56 * progress));
  return `
    <div class="delivery-map-stage tracking-map-stage sandbox-tracking-stage" data-map-shell="tracking" data-sandbox-tracking>
      <div class="sandbox-tracking-map" aria-label="Ruta de entrega">
        <svg viewBox="0 0 320 96" role="img" aria-label="Ruta de entrega">
          <path d="M18 76 C80 76 78 20 142 25 S206 78 302 20" class="sandbox-route-line" />
          <circle cx="18" cy="76" r="6" class="sandbox-route-store" />
          <circle cx="302" cy="20" r="6" class="sandbox-route-destination" />
          <circle cx="${cx}" cy="${cy}" r="8" class="sandbox-route-rider" data-sandbox-rider-marker />
        </svg>
      </div>
      <div class="sandbox-tracking-top">
        <span><small>Seguimiento</small><strong>En camino</strong></span>
        <span><small>Avance</small><strong data-sandbox-progress>${percent}%</strong></span>
        <span><small>ETA</small><strong data-sandbox-eta>${eta == null ? 'Calculando' : String(eta) + ' min'}</strong></span>
      </div>
      <p class="sandbox-tracking-destination">Entrega en el domicilio indicado</p>
    </div>`;
}

function trackingMapStage({ order = null, live = false }) {
  return `
    <div class="delivery-map-stage tracking-map-stage" data-map-shell="tracking">
      ${realMapShell({ order, fallback: '<p class="map-fallback-note">Mapa no disponible en este dispositivo.</p>', role: 'tracking' })}
      <div class="map-floating-top">
        <span class="map-status-pill ${statusClass(order.status)}"><small>Delivery TABA</small><strong>${escapeHtml(trackingStatusLabel(order.status))}</strong></span>
        <span class="map-connection-pill">${realtimeChip(order)}</span>
      </div>
    </div>`;
}

// Estado del delivery en la vista cliente. Nunca expone una persona, reputación
// o teléfono inventado: la identidad visual es el servicio de TABA.
function riderTrackingCard(order, riderLocation) {
  if (hasVerifiedLiveRiderLocation(riderLocation)) {
    const age = relativeAgeLabel(riderLocation.lastFixAt || riderLocation.timestamp);
    return `
      <div class="delivery-status-card is-live">
        <span class="delivery-status-icon" aria-hidden="true">${deliveryGlyph()}</span>
        <div>
          <small>Entrega TABA</small>
          <strong>Ubicación actualizada ${escapeHtml(age)}</strong>
        </div>
      </div>
    `;
  }

  if (order.status === 'delivered') {
    return `
      <div class="delivery-status-card is-delivered">
        <span class="delivery-status-icon" aria-hidden="true">${deliveryGlyph()}</span>
        <div><small>Entrega TABA</small><strong>Pedido entregado</strong></div>
      </div>`;
  }

  const { title, sub } = riderPendingCopy(order.status);
  return `
    <div class="delivery-status-card rider-pending" role="status">
      <span class="delivery-status-icon" aria-hidden="true">${deliveryGlyph()}</span>
      <div>
        <small>Entrega TABA</small>
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(sub)}</span>
      </div>
    </div>
  `;
}

function hasVerifiedLiveRiderLocation(location) {
  return hasLiveRiderLocation(location)
    && Number.isFinite(Number(location?.accuracy));
}

function riderPendingCopy(status) {
  if (status === 'on_the_way' || status === 'arriving') {
    return { title: 'Seguimiento por iniciar', sub: 'El repartidor todavía no inició el seguimiento.' };
  }
  if (status === 'ready') {
    return { title: 'Listo para salir', sub: 'El delivery comenzará cuando el pedido salga del local.' };
  }
  if (status === 'preparing') {
    return { title: 'Preparando el envío', sub: 'La ubicación aparecerá cuando comience el reparto.' };
  }
  return { title: 'Pedido confirmado', sub: 'La ubicación aparecerá cuando comience el reparto.' };
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

function trackingDeliveryCodeCard(order) {
  if (!order || order.status === 'cancelled') return '';
  if (order.deliveryMode !== 'delivery') return '';
  if (!['arriving', 'delivered'].includes(order.status)) return '';
  const deliveryCode = normalizeDeliveryCode(order.deliveryCode);
  if (!deliveryCode) return '';
  const confirmed = isDeliveryCodeConfirmed(deliveryCode);
  const confirmedTime = formatDeliveryCodeTime(deliveryCode);
  if (order.status === 'delivered' && !confirmed) return '';
  if (order.status === 'delivered') {
    return `
      <section class="delivery-code-card is-confirmed" data-delivery-code-card>
        <div class="delivery-code-copy">
          <span>Entrega validada</span>
          <strong class="delivery-code-success">Código confirmado</strong>
          <small>${confirmedTime ? `Confirmado a las ${escapeHtml(confirmedTime)}.` : 'Recepción confirmada.'}</small>
        </div>
      </section>`;
  }
  const copy = order.deliveryMode === 'pickup'
    ? 'Mostralo en mostrador para retirar tu pedido.'
    : 'Dáselo al repartidor cuando recibas el pedido.';
  return `
    <section class="delivery-code-card ${confirmed ? 'is-confirmed' : ''}" data-delivery-code-card>
      <div class="delivery-code-copy">
        <span>${confirmed ? 'Código confirmado' : 'Código de entrega'}</span>
        <strong data-delivery-code="${escapeHtml(deliveryCode.code)}">${escapeHtml(formatDeliveryCode(deliveryCode.code))}</strong>
        <small>${confirmed ? `Confirmado${confirmedTime ? ` a las ${escapeHtml(confirmedTime)}` : ''}.` : escapeHtml(copy)}</small>
      </div>
    </section>`;
}

function trackingOrderSummaryCard(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  if (!items.length) {
    return `
      <section class="tracking-order-summary is-minimized">
        <div>
          <small>Pedido ${escapeHtml(order?.id || '')}</small>
          <strong>Resumen protegido</strong>
        </div>
        <p>El detalle se mantiene en el dispositivo donde confirmaste el pedido.</p>
      </section>`;
  }
  const preview = items.slice(0, 3).map((item) => `
    <li><span>${escapeHtml(item.quantity)}× ${escapeHtml(item.name)}</span></li>
  `).join('');
  const remaining = Math.max(0, items.length - 3);
  return `
    <section class="tracking-order-summary">
      <div class="tracking-summary-head">
        <span>
          <small>Tu pedido</small>
          <strong>${escapeHtml(order.id)}</strong>
        </span>
        <strong class="tracking-summary-total">${money(order.total)}</strong>
      </div>
      <ul>${preview}${remaining ? `<li class="tracking-summary-more">+ ${remaining} producto${remaining === 1 ? '' : 's'}</li>` : ''}</ul>
    </section>`;
}

function trackingWaitingStage(order) {
  if (order.deliveryMode === 'pickup' || ['cancelled', 'delivered'].includes(order.status)) return '';
  return `
    <div class="tracking-map-waiting" data-tracking-map-placeholder>
      <span aria-hidden="true">${deliveryGlyph()}</span>
      <div>
        <strong>Ubicación no disponible</strong>
        <p data-tracking-gps-note>Seguimiento por estados, sin GPS ni ubicación en vivo.</p>
      </div>
    </div>`;
}

function trackingContactButton() {
  const config = getBusinessConfig();
  const phone = String(config.whatsappNumber || '').replace(/\D/g, '');
  if (config.whatsappVerified !== true || phone.length < 8 || phone.length > 15) return '';
  return `<a class="secondary-button compact" href="https://wa.me/${phone}" target="_blank" rel="noopener noreferrer">Contactar al local</a>`;
}

function trackingHelpCard() {
  const contact = trackingContactButton();
  if (!contact) return '';
  return `
    <section class="tracking-help-card">
      <span class="tracking-help-icon" aria-hidden="true">?</span>
      <div><strong>¿Necesitás ayuda?</strong><small>Escribile al canal verificado del local.</small></div>
      ${contact}
    </section>`;
}

export function renderTracking() {
  const container = $('[data-tracking-panel]');
  if (!container) return;
  const order = getActiveOrder();

  if (!order) {
    renderWithStableRealMap(container, `
      <div class="track-layout tracking-map-experience is-empty no-map">
        <section class="delivery-bottom-sheet tracking-sheet track-progress-card" data-bottom-sheet>
          <div class="empty-state sheet-empty">
          <h1 class="empty-title">Todavía no hay un pedido en curso</h1>
          <p class="empty-state-copy">Cuando armes tu pedido, acá vas a ver cada avance hasta la entrega.</p>
          <div class="empty-actions">
            <button class="primary-button compact" type="button" data-nav-view="catalog">Ver el catálogo</button>
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
  const liveRider = ['on_the_way', 'arriving'].includes(order.status)
    && hasVerifiedLiveRiderLocation(riderLocation);
  const sandboxSimulation = getOrderSimulation(order);
  const sandboxRouteActive = isSandboxOrderRepository(getOrderRepository())
    && ['on_the_way', 'arriving'].includes(order.status)
    && sandboxSimulation?.source === 'simulation'
    && sandboxSimulation?.userStarted === true;

  const itemsHtml = (Array.isArray(order.items) ? order.items : []).map((item) => `
    <div class="order-line">
      <span>${item.quantity} × ${escapeHtml(item.name)}</span>
      <strong>${money(item.quantity * item.unitPrice)}</strong>
    </div>
  `).join('');
  const orderAddress = normalizeOrderAddressDetails(order);

  const showMap = isDelivery && !isCancelled && (liveRider || sandboxRouteActive);
  const primaryMetric = trackingPrimaryMetric(order);
  renderWithStableRealMap(container, `
    <div class="track-layout tracking-map-experience ${showMap ? '' : 'no-map'}">
      ${liveRider ? trackingMapStage({ order, live: true }) : sandboxRouteActive ? sandboxTrackingStage(order, sandboxSimulation) : ''}

      <section class="delivery-bottom-sheet tracking-sheet track-progress-card ${showMap ? 'is-live' : 'is-offline'}" data-bottom-sheet>
        <div class="tracking-brand-row">
          <strong>TABA</strong>
          <span>${showMap ? 'Seguimiento en vivo' : 'Seguimiento del pedido'}</span>
          ${trackingConnectionPill(order)}
        </div>
        <div class="tracking-hero">
          <div>
            <small>${escapeHtml(head.kicker)} · ${escapeHtml(order.id)}</small>
            <h1>${escapeHtml(head.title)}</h1>
            <p>${escapeHtml(head.sub)}</p>
          </div>
          <div class="tracking-eta">
            <span>${escapeHtml(primaryMetric.label)}</span>
            <strong>${escapeHtml(primaryMetric.value)}</strong>
          </div>
        </div>
        ${renderPublicOrderTimeline(order.status, { className: 'customer-progress' })}
        ${isCancelled ? `<div class="warning-box">Este pedido fue cancelado.${order.cancelReason ? ` Motivo: ${escapeHtml(order.cancelReason)}.` : ''} Si fue un error, contactá al local por un canal verificado.</div>` : ''}
        ${isDelivery && !isCancelled
          ? (liveRider
            ? riderTrackingCard(order, riderLocation)
            : sandboxRouteActive
              ? `<div class="delivery-status-card is-live sandbox-status-card"><span class="delivery-status-icon" aria-hidden="true">${deliveryGlyph()}</span><div><small>Entrega TABA</small><strong>Seguimiento activo</strong><span>La ruta avanza y el ETA se actualiza en este dispositivo.</span></div></div>`
              : trackingWaitingStage(order))
          : ''}
        ${trackingOrderSummaryCard(order)}
        ${trackingDeliveryCodeCard(order)}
        ${trackingHelpCard()}
        <details class="order-detail tracking-order-detail">
          <summary>Ver detalle</summary>
          <div class="order-detail-body">
            <div class="order-line head"><span>${deliveryModeLabel(order.deliveryMode)}</span><strong>${escapeHtml(destinationAddressLabel(order))}</strong></div>
            ${isDelivery && orderAddress.reference
              ? `<p class="tracking-reference"><strong>Referencia:</strong> ${escapeHtml(orderAddress.reference)}</p>`
              : ''}
            ${itemsHtml}
            <div class="summary-row"><span>Subtotal</span><strong>${money(order.subtotal)}</strong></div>
            ${Number(order.discountTotal || 0) > 0 ? `<div class="summary-row discount"><span>Cupón ${escapeHtml(order.coupon?.code || 'Promo')}</span><strong>-${money(order.discountTotal)}</strong></div>` : ''}
            <div class="summary-row"><span>Envío</span><strong>${money(order.deliveryFee)}</strong></div>
            <div class="summary-row"><span>Pago</span><strong>${escapeHtml(order.paymentMethod || 'Pago a coordinar con el local')}</strong></div>
            ${order.cashChange ? `<div class="summary-row"><span>Cambio efectivo</span><strong>${escapeHtml(order.cashChange)}</strong></div>` : ''}
            <div class="summary-row total"><span>Total</span><strong>${money(order.total)}</strong></div>
            ${order.notes && order.notes !== 'Sin notas' ? `<p><strong>Observaciones:</strong> ${escapeHtml(order.notes)}</p>` : ''}
          </div>
        </details>
        ${isCancelled ? '' : `
        <div class="button-row track-actions">
          <button class="secondary-button compact" type="button" data-whatsapp-order data-whatsapp-available hidden>WhatsApp del local</button>
        </div>`}
      </section>
    </div>
  `, { rolePrefix: 'tracking', orderId: showMap ? order.id : '' });
}

// Estado de la conexión con la sala, en el seguimiento sin mapa (sólo con
// relay y pedido en curso). Habla de la CONEXIÓN entre equipos, no del GPS:
// por eso dice "Conectado" y nunca "En vivo" (eso queda para GPS real).
// Sin esto, si la sala se cae el cliente ve un estado viejo sin enterarse.
function trackingConnectionPill(order) {
  if (isDemoMode()) return '';
  const status = getRealtimeStatus();
  if (!status.relayEnabled) return '';
  if (!order || order.status === 'delivered' || order.status === 'cancelled') return '';
  const chip = status.relayConnected
    ? '<span class="rt-chip live">Conectado</span>'
    : status.relayState === 'offline'
      ? '<span class="rt-chip warn">Sin conexión</span>'
      : '<span class="rt-chip warn">Reconectando</span>';
  return `<span class="sheet-connection-pill">${chip}</span>`;
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
  if (!product || !isProductVisibleToCustomer(product) || !modal || !content) return;

  const off = discountPercent(product);
  const favorite = isFavoriteProduct(product.id);
  const variants = Array.isArray(product.variants)
    ? product.variants.filter((variant) => (
      variant
      && typeof variant.id === 'string'
      && getProductById(variant.id)
      && isProductVisibleToCustomer(getProductById(variant.id))
    ))
    : [];
  const minimumAge = Math.max(18, Number(product.minimumAge || product.minimum_age || 18));
  content.innerHTML = `
    <div class="modal-card" role="document">
      <button class="modal-close" type="button" data-close-modal aria-label="Cerrar detalle">×</button>
      <div class="modal-media">
        ${productThumb(product, 'modal')}
        <span class="offer-badge-wrap">${topBadge(product)}</span>
      </div>
      <div class="modal-product-copy">
        <span class="modal-presentation">${escapeHtml(unitText(product))}</span>
        <h2>${escapeHtml(product.name)}</h2>
        ${product.description ? `<p>${escapeHtml(product.description)}</p>` : ''}
        <div class="modal-commerce-row">
          <div class="modal-price">
            ${off > 0 ? `<s>${money(product.oldPrice)}</s>` : ''}
            <strong>${money(product.price)}</strong>
          </div>
          <span class="modal-availability ${product.stock <= 0 || !product.available ? 'is-unavailable' : ''}">${escapeHtml(availabilityLabel(product))}</span>
        </div>
        ${variants.length ? `
          <label class="modal-variant-field">
            Presentación
            <select data-product-variant aria-label="Elegir presentación">
              <option value="${escapeHtml(product.id)}">${escapeHtml(unitText(product) || product.name)}</option>
              ${variants.map((variant) => {
                const item = getProductById(variant.id);
                return `<option value="${escapeHtml(item.id)}">${escapeHtml(unitText(item) || item.name)} · ${money(item.price)}</option>`;
              }).join('')}
            </select>
          </label>` : ''}
        <div class="modal-order-fields">
          <label class="modal-quantity-field">
            Cantidad
            <input data-product-quantity type="number" inputmode="numeric" min="1" max="${Math.max(1, Number(product.stock) || 1)}" value="1" />
          </label>
          <label class="modal-note-field">
            Observación <span>(opcional)</span>
            <input data-product-note type="text" maxlength="120" placeholder="Ej.: bien fría" />
          </label>
        </div>
        ${product.alcoholic ? `<p class="product-alcohol-notice">Venta exclusiva a mayores de ${minimumAge} años.</p>` : ''}
      </div>
      <div class="modal-actions">
        <button class="primary-button" type="button" data-add-product="${escapeHtml(product.id)}" ${product.stock <= 0 || !product.available ? 'disabled' : ''}>Agregar al pedido</button>
        <button class="secondary-button" type="button" data-favorite-toggle="${product.id}" aria-pressed="${favorite}">${favorite ? 'Guardado' : 'Guardar para después'}</button>
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
  showToast.timeoutId = setTimeout(() => toast.classList.add('hidden'), 2600);
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

export function deliveryGlyph() {
  return `<svg class="lt-glyph" viewBox="0 0 24 24" width="23" height="23" fill="none" aria-hidden="true" focusable="false">
    <circle cx="7" cy="17.5" r="2.2" stroke="currentColor" stroke-width="1.6"/>
    <circle cx="17.5" cy="17.5" r="2.2" stroke="currentColor" stroke-width="1.6"/>
    <path d="M9.2 17.5h5.9l1.8-5.4h-5.2L9.8 8.5H6.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="4.2" y="6" width="6.6" height="5.3" rx="1.4" fill="currentColor" fill-opacity=".14" stroke="currentColor" stroke-width="1.5"/>
    <path d="M15.3 10h3.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
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
