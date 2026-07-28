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
  getRepeatableCustomerOrder,
  validateCartForCheckout,
} from './cart.js';
import { buildDraftMessageFromCart, getActiveOrder } from './orders.js';
import { getRealtimeStatus } from './realtime.js';
import { normalizeAddressDetails, normalizeOrderAddressDetails } from './core/address.js';
import {
  formatDeliveryCode,
  normalizeDeliveryCode,
} from './core/delivery-code.js';
import {
  chooseRiderLocation,
  hasFreshSharedGpsLocation,
  hasLiveRiderLocation,
  trackingLocationFreshness,
} from './map/route_geometry.js';
import { renderPublicOrderTimeline } from './core/order-timeline.js';
import { isDemoMode } from './core/app-mode.js';
import { getOrderRepository, isSandboxOrderRepository } from './repositories/repository_factory.js';
import { formatPromotionCondition, getActivePromotions, getProductPromotion } from './core/promotions.js';
import { sandboxTrackingPresentation } from './core/sandbox-tracking-presentation.js';
import { riderHelmetSvg } from './map/rider_marker.js';

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
    ? ['Delivery y retiro', 'Confirmamos disponibilidad al preparar']
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
  const pricing = productPricePresentation(product);
  if (!pricing.regularPrice || pricing.regularPrice <= pricing.price) return 0;
  return Math.round(((pricing.regularPrice - pricing.price) / pricing.regularPrice) * 100);
}

function activePromotionForProduct(product) {
  if (!isDemoMode() || !product?.id) return null;
  const promotion = getProductPromotion(product.id, getState().promotions);
  if (!promotion || promotion.regularPrice !== Number(product.price)) return null;
  return promotion;
}

export function productPricePresentation(product) {
  const basePrice = Number(product?.price || 0);
  const promotion = activePromotionForProduct(product);
  if (!promotion) {
    const oldPrice = Number(product?.oldPrice || 0);
    return { price: basePrice, regularPrice: oldPrice > basePrice ? oldPrice : null, promotion: null, condition: '' };
  }

  let promotionalPrice = null;
  if (promotion.promotionType === 'precio_promocional') promotionalPrice = promotion.promotionalPrice;
  if (promotion.promotionType === 'descuento_porcentaje') {
    promotionalPrice = Math.max(0, Math.round(basePrice * (1 - (promotion.discountPercentage || 0) / 100)));
  }
  if ((promotion.promotionType === 'pack' || promotion.promotionType === 'cantidad_fija')
    && promotion.requiredQuantity === 1) {
    promotionalPrice = promotion.promotionalPrice;
  }
  return {
    price: Number.isFinite(promotionalPrice) ? promotionalPrice : basePrice,
    regularPrice: Number.isFinite(promotionalPrice) ? basePrice : null,
    promotion,
    condition: formatPromotionCondition(promotion),
  };
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
  const pricing = productPricePresentation(product);
  if (pricing.promotion && pricing.condition && off <= 0) {
    return `<span class="offer-badge promo">${escapeHtml(pricing.condition)}</span>`;
  }
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
  const pricing = productPricePresentation(product);
  const old = pricing.regularPrice && pricing.regularPrice > pricing.price
    ? `<s>${money(pricing.regularPrice)}</s>` : '';
  return `
    <div class="price">
      <div class="price-amounts"><strong>${money(pricing.price)}</strong>${old}</div>
      ${pricing.promotion && pricing.condition ? `<small class="price-condition">${escapeHtml(pricing.condition)}</small>` : ''}
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
  const secondaryPromotionSkus = new Set(getActivePromotions(getState().promotions)
    .slice(1, 3)
    .flatMap((promotion) => promotion.includedSkus));
  const combos = getCustomerCatalogProducts(getState().products)
    .filter((product) => (
      product.available
      && product.stock > 0
      && (product.combo || secondaryPromotionSkus.has(product.id))
    ))
    .filter((product) => !offerIds.has(product.id))
    .slice(0, 2);

  const block = container.closest('.rail-block');
  if (block) block.hidden = !combos.length;
  container.innerHTML = combos.length
    ? combos.map(railCard).join('')
    : '';
}

function railCard(product) {
  const pricing = productPricePresentation(product);
  const old = pricing.regularPrice && pricing.regularPrice > pricing.price
    ? `<s>${money(pricing.regularPrice)}</s>` : '';
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
          <span>${money(pricing.price)}</span>
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
  more: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <circle cx="5" cy="12" r="1.7" fill="currentColor"/>
    <circle cx="12" cy="12" r="1.7" fill="currentColor"/>
    <circle cx="19" cy="12" r="1.7" fill="currentColor"/>
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
  const catalogTopIds = ['all', 'favorites', 'gaseosas', 'aguas'];
  const catalogTopList = catalogTopIds
    .map((id) => fullList.find((category) => category.id === id))
    .filter(Boolean);
  const remainingCatalogList = fullList.filter((category) => !catalogTopIds.includes(category.id));

  const markupFor = (list) => list.map((category) => `
    <button class="category-button ${activeCategory === category.id ? 'active' : ''}" type="button" data-category-id="${category.id}">
      <span class="category-ico" aria-hidden="true">${categoryGlyph(category.id)}</span>
      <span class="category-label">${escapeHtml(category.name)}</span>
    </button>
  `).join('');

  const moreButton = `
    <button class="category-button category-more" type="button" data-category-more aria-label="Ver más categorías">
      <span class="category-ico" aria-hidden="true">${categoryGlyph('more')}</span>
      <span class="category-label">Más</span>
    </button>`;

  strips.forEach((strip) => {
    const isHome = strip.dataset.categoryStrip === 'home';
    strip.innerHTML = isHome
      ? markupFor(homeList)
      : `${markupFor(catalogTopList)}${remainingCatalogList.length ? moreButton : ''}${markupFor(remainingCatalogList)}`;
    strip.querySelector('[data-category-more]')?.addEventListener('click', () => {
      strip.scrollBy({ left: Math.max(220, Math.round(strip.clientWidth * 0.85)), behavior: 'smooth' });
    });
  });
}

// Productos filtrados por categoría + búsqueda, ya ordenados.
function getFilteredProducts(state) {
  const query = normalizeSearchText(state.searchQuery);
  const favoriteIds = new Set(getFavoriteProductIds());
  const filtered = getCustomerCatalogProducts(state.products).filter((product) => {
    const promoProductIds = new Set(getActivePromotions(state.promotions).flatMap((promotion) => promotion.includedSkus));
    const matchesCategory = state.activeCategory === 'favorites'
      ? favoriteIds.has(product.id)
      : state.activeCategory === 'promos'
        ? promoProductIds.has(product.id)
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

  const activePromotionSkus = new Set(getActivePromotions(getState().promotions)
    .flatMap((promotion) => promotion.includedSkus));
  if (activePromotionSkus.size) remote.set('promos', 'Promos');

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
  const promoProductIds = new Set(getActivePromotions(state.promotions)
    .flatMap((promotion) => promotion.includedSkus));
  const offers = searching ? [] : getCustomerCatalogProducts(state.products)
    .filter((product) => {
      const inCategory = state.activeCategory === 'all'
        || (state.activeCategory === 'promos'
          ? promoProductIds.has(product.id)
          : product.categoryId === state.activeCategory);
      return inCategory && product.available && product.stock > 0
        && (discountPercent(product) > 0 || product.featured || promoProductIds.has(product.id));
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
    const favorite = isFavoriteProduct(product.id);
    const packMatch = unitText(product).match(/\bx\s?(\d+)\b/i);
    const packBadge = packMatch ? `<span class="product-pack-badge">x${packMatch[1]}</span>` : '';
    const rawPresentation = product.presentation || product.variant || product.unitLabel || product.packageType || '';
    const compactPresentation = normalizeSearchText(rawPresentation).replace(/\bpack\b/g, '').trim();
    const presentation = compactPresentation && normalizeSearchText(product.name).includes(compactPresentation)
      ? ''
      : rawPresentation;
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
          ${packBadge}
        </button>
        <button class="product-favorite ${favorite ? 'is-favorite' : ''}" type="button" data-favorite-toggle="${product.id}" aria-label="${favorite ? 'Quitar' : 'Guardar'} ${escapeHtml(product.name)} de favoritos" aria-pressed="${favorite}">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 20.2s-7.1-4.5-7.1-10.1A4.1 4.1 0 0 1 12 7.3a4.1 4.1 0 0 1 7.1 2.8c0 5.6-7.1 10.1-7.1 10.1Z" fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
        </button>
        <div class="product-body">
          <h3>${escapeHtml(product.name)}</h3>
          <p>${escapeHtml(presentation)}</p>
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

// Banner de promo: sólo representa una entidad activa, vigente y aprobada por
// la administración del sandbox. Los candidatos no se infiltran como oferta.
function renderPromoBanner() {
  const banner = $('[data-promo-banner]');
  if (!banner) return;
  const state = getState();
  const promotion = getActivePromotions(state.promotions)[0] || null;
  const promoProduct = promotion
    ? getCustomerCatalogProducts(state.products).find((product) => (
      promotion.includedSkus.includes(product.id) && product.available && product.stock > 0
    ))
    : null;
  banner.hidden = !promotion || !promoProduct;
  if (!promotion || !promoProduct) return;

  const pricing = productPricePresentation(promoProduct);
  const image = $('[data-promo-banner-image]', banner);
  if (image) image.innerHTML = productThumb(promoProduct, 'promo');
  const price = $('[data-promo-banner-price]', banner);
  if (price) {
    const bundlePrice = ['pack', 'cantidad_fija'].includes(promotion.promotionType)
      ? promotion.promotionalPrice
      : pricing.price;
    price.textContent = money(bundlePrice || promoProduct.price);
  }
  const title = $('[data-promo-banner-title]', banner);
  if (title) title.textContent = promotion.title;
  const includes = $('[data-promo-banner-includes]', banner);
  if (includes) {
    const copy = promotion.subtitle || `${promoProduct.name} · ${formatPromotionCondition(promotion)}`;
    includes.textContent = copy;
    includes.hidden = !copy;
  }
  const save = $('[data-promo-banner-save]', banner);
  if (save) {
    const saving = Number(promotion.regularPrice || 0) - Number(promotion.promotionalPrice || 0);
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
  const latestFromHistory = getCustomerOrderHistory().find((order) => (
    order.status === 'delivered' && order.id !== activeNonTerminalId
  )) || null;
  const latest = latestFromHistory || (
    isSandboxOrderRepository(getOrderRepository())
      ? getRepeatableCustomerOrder()
      : null
  );
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
  setText('[data-cart-total-small]', summary.count > 0 ? money(subtotalSummary.subtotal) : money(0));
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
  const {
    items,
    subtotal,
    deliveryFee,
    total,
    coupon,
    promotions,
    promotion,
  } = getCartSummary(deliveryMode, { couponCode });
  const validation = validateCartForCheckout(deliveryMode);
  renderCheckoutPaymentFields();
  renderCouponMessage(coupon);

  const coordinatedDelivery = deliveryMode === 'delivery'
    && !isDemoMode()
    && !getBusinessConfig().orderingDetailsVerified;
  const appliedPromoIds = new Set(promotions.map((entry) => entry.promoId));
  const pendingPromotions = promotion.activePromotions
    .filter((entry) => !appliedPromoIds.has(entry.promoId))
    .slice(0, 2);
  container.innerHTML = `
    <div class="summary-row"><span>Subtotal</span><strong>${money(subtotal)}</strong></div>
    ${promotions.map((entry) => `<div class="summary-row discount"><span>${escapeHtml(entry.title)}</span><strong>-${money(entry.discountAmount)}</strong></div>`).join('')}
    ${coupon.discountAmount > 0 ? `<div class="summary-row discount"><span>Cupón ${escapeHtml(coupon.code)}</span><strong>-${money(coupon.discountAmount)}</strong></div>` : ''}
    ${promotion.freeDelivery ? '<div class="summary-row discount"><span>Promoción de envío</span><strong>Envío sin cargo</strong></div>' : ''}
    ${pendingPromotions.map((entry) => `<div class="summary-row muted"><span>${escapeHtml(entry.title)}</span><strong>${escapeHtml(formatPromotionCondition(entry))}</strong></div>`).join('')}
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
function getOrderSimulation(order) {
  const sim = getState().simulation;
  return sim && sim.orderId === order.id ? sim : null;
}

function trackingHeadline(order) {
  const status = order?.status || 'received';
  const pickup = order?.deliveryMode === 'pickup';
  if (order.status === 'delivered') {
    return {
      title: 'Pedido entregado',
      sub: `La entrega fue confirmada. Gracias por comprar en ${getBusinessConfig().businessName}.`,
    };
  }
  if (order.status === 'cancelled') {
    return {
      title: 'Pedido cancelado',
      sub: order.cancelReason ? `Motivo: ${order.cancelReason}.` : 'El local canceló este pedido.',
    };
  }
  if (['accepted', 'preparing'].includes(status)) {
    const prepMinutes = Number(order.delivery?.estimatedPreparationMinutes || 0);
    return {
      title: 'Estamos preparando tu pedido',
      sub: prepMinutes > 0
        ? `Tiempo estimado de preparación: ${prepMinutes} min.`
        : 'El local ya está preparando tu pedido.',
    };
  }
  if (['ready', 'assigned'].includes(status)) {
    return {
      title: pickup ? 'Tu pedido está listo' : 'Tu pedido está listo',
      sub: pickup
        ? `Te esperamos en ${getBusinessConfig().address}.`
        : 'Está listo para salir con el repartidor.',
    };
  }
  if (pickup) {
    return {
      title: 'Tu pedido fue confirmado',
      sub: 'Te avisaremos cuando esté listo para retirar.',
    };
  }
  if (['arrived', 'arriving'].includes(status)) {
    return {
      title: 'Tu pedido llegó',
      sub: 'El repartidor está en tu domicilio',
    };
  }
  if (['picked_up', 'on_the_way'].includes(status)) {
    return {
      title: 'Tu pedido está en camino',
      sub: 'El repartidor va hacia tu domicilio.',
    };
  }
  return {
    title: 'Tu pedido fue confirmado',
    sub: 'Recibimos tu pedido y te avisaremos cada avance.',
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

function latestTrackingTimestamp(order, riderLocation = null) {
  const candidates = [
    order?.updatedAt,
    order?.createdAt,
    riderLocation?.lastFixAt,
    riderLocation?.timestamp,
    ...(Array.isArray(order?.statusHistory) ? order.statusHistory.map((entry) => entry?.at) : []),
  ]
    .map((value) => (typeof value === 'number' ? value : new Date(value || '').getTime()))
    .filter((value) => Number.isFinite(value) && value <= Date.now() + 10_000);
  return candidates.length ? Math.max(...candidates) : null;
}

function realMapShell({ order = null, role = 'tracking', fallback, mapSource = '' }) {
  const orderAttr = order?.id ? ` data-order-id="${escapeHtml(order.id)}"` : '';
  const sourceAttr = mapSource ? ` data-map-source="${escapeHtml(mapSource)}"` : '';
  return `
    <div class="real-map-shell" data-real-map data-map-role="${escapeHtml(role)}"${sourceAttr}${orderAttr}>
      <div class="real-map-canvas" data-map-canvas aria-label="Mapa real de seguimiento"></div>
      <div class="real-map-fallback" data-map-fallback>
        ${fallback}
      </div>
      <span class="real-map-tile-error" data-map-tile-error hidden>Mapa base no disponible</span>
      <div class="real-map-meta" data-map-meta role="status" aria-live="polite">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="8.25" fill="none" stroke="currentColor" stroke-width="1.75"></circle>
          <path d="M12 7.5v4.9l3.1 1.8" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
        <span data-map-meta-text>Última ubicación</span>
      </div>
    </div>`;
}

// En producción el mapa del cliente sólo se renderiza con GPS real. La vista
// sandbox usa su escenario geográfico aislado y mantiene la misma shell Leaflet.
function sandboxTrackingStage(order, simulation) {
  const presentation = sandboxTrackingPresentation(order, simulation);
  return `
    <div class="delivery-map-stage tracking-map-stage sandbox-tracking-stage" data-map-shell="tracking" data-sandbox-tracking>
      ${realMapShell({
        order,
        role: 'tracking',
        mapSource: 'sandbox',
        fallback: '<p class="map-fallback-note">El mapa no está disponible en este momento.</p>',
      })}
      ${presentation.showEta ? `<span class="tracking-map-eta" data-sandbox-eta>${escapeHtml(presentation.etaLabel)}</span>` : ''}
      ${trackingRecenterButton()}
    </div>`;
}

function trackingMapStage({ order = null, sandbox = false }) {
  return `
    <div class="delivery-map-stage tracking-map-stage" data-map-shell="tracking">
      ${realMapShell({ order, fallback: '<p class="map-fallback-note">Mapa no disponible en este dispositivo.</p>', role: 'tracking', mapSource: sandbox ? 'sandbox' : '' })}
      ${trackingRecenterButton()}
    </div>`;
}

function trackingRecenterButton() {
  return `
    <button class="tracking-map-recenter" type="button" data-map-recenter aria-label="Recentrar en la ubicación del repartidor">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="2"></circle>
        <path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
      </svg>
    </button>`;
}

// Estado del delivery en la vista cliente. Nunca expone una persona, reputación
// o teléfono inventado: la identidad visual es el servicio de TABA.
function riderTrackingCard(order, riderLocation, presentation = null) {
  const freshness = trackingLocationFreshness(riderLocation);
  const live = freshness === 'fresh' && hasVerifiedLiveRiderLocation(riderLocation);
  const arrived = presentation?.arrived || ['arrived', 'arriving'].includes(order.status);
  const assigned = Boolean(order.assignedRiderId)
    || ['assigned', 'picked_up', 'on_the_way', 'arrived', 'arriving'].includes(order.status);
  const pending = riderPendingCopy(order.status, assigned);
  const title = arrived
    ? 'En la puerta'
    : ['on_the_way', 'picked_up'].includes(order.status)
      ? 'En ruta'
      : pending.title;
  const sub = arrived
    ? 'Prepará el código de entrega'
    : freshness === 'lost'
      ? 'La ubicación no está disponible por el momento.'
      : ['on_the_way', 'picked_up'].includes(order.status)
        ? 'Va hacia tu domicilio.'
        : pending.sub;
  const contact = trackingContactButton({ accessibleLabel: 'Contactar al rider TABA' });
  return `
    <section class="tracking-rider-card ${live ? 'is-live' : ''}" aria-label="Estado del rider">
      <span class="tracking-rider-icon">${riderHelmetSvg({ className: 'tracking-rider-helmet', decorative: true })}</span>
      <div class="tracking-rider-copy">
        <small>${assigned ? 'Rider TABA' : 'Entrega TABA'}</small>
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(sub)}</span>
      </div>
      ${contact ? `<div class="tracking-rider-contact">${contact}</div>` : ''}
    </section>`;
}

function hasVerifiedLiveRiderLocation(location) {
  return hasLiveRiderLocation(location)
    && Number.isFinite(Number(location?.accuracy));
}

function riderPendingCopy(status, assigned = false) {
  if (['picked_up', 'on_the_way', 'arrived', 'arriving'].includes(status)) {
    return { title: 'Seguimiento por iniciar', sub: 'El repartidor todavía no inició el seguimiento.' };
  }
  if (['ready', 'assigned'].includes(status) && assigned) {
    return { title: 'Rider asignado', sub: 'El pedido está listo para que salga del local.' };
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
  if (!value) return 'hace instantes';
  const time = typeof value === 'number' ? value : new Date(value).getTime();
  if (Number.isNaN(time)) return 'hace instantes';
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 60) return `hace ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return `hace ${minutes} min`;
}

function trackingDeliveryCodeCard(order) {
  if (!order || order.deliveryMode !== 'delivery') return '';
  if (!['arrived', 'arriving'].includes(order.status)) return '';
  const deliveryCode = normalizeDeliveryCode(order.deliveryCode);
  if (!deliveryCode) return '';
  return `
    <section class="delivery-code-card" data-delivery-code-card>
      <span class="delivery-code-icon" aria-hidden="true">
        <svg viewBox="0 0 48 52" focusable="false">
          <path d="M24 2.5 43 10v13.4c0 12.1-7.5 21.3-19 26.1C12.5 44.7 5 35.5 5 23.4V10l19-7.5Z" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"></path>
          <rect x="17.5" y="23" width="13" height="11.5" rx="2" fill="none" stroke="currentColor" stroke-width="2.2"></rect>
          <path d="M20.5 23v-3.2a3.5 3.5 0 0 1 7 0V23M24 27.5v3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"></path>
        </svg>
      </span>
      <div class="delivery-code-copy">
        <span>Código de entrega</span>
        <strong data-delivery-code="${escapeHtml(deliveryCode.code)}">${escapeHtml(formatDeliveryCode(deliveryCode.code))}</strong>
        <small>Decile este código al repartidor cuando recibas el pedido</small>
      </div>
    </section>`;
}

function trackingOrderSummaryCard(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const productCount = items.reduce((total, item) => {
    const quantity = Number(item?.quantity);
    return total + (Number.isFinite(quantity) && quantity > 0 ? quantity : 0);
  }, 0);
  const total = Number(order?.total);
  const hasTotal = Number.isFinite(total) && (total > 0 || items.length > 0);
  const compactTotal = hasTotal ? money(total).replace(/\$\s+/, '$') : '';
  const meta = [
    productCount > 0 ? `${productCount} producto${productCount === 1 ? '' : 's'}` : '',
    compactTotal ? `Total ${compactTotal}` : '',
  ].filter(Boolean).join(' · ');
  const orderAddress = normalizeOrderAddressDetails(order);
  const destination = destinationAddressLabel(order);
  const itemRows = items.map((item) => {
    const quantity = Number(item?.quantity) || 0;
    const unitPrice = Number(item?.unitPrice) || 0;
    return `
      <div class="order-line">
        <span>${escapeHtml(quantity)} × ${escapeHtml(item?.name || 'Producto')}</span>
        ${unitPrice > 0 ? `<strong>${money(quantity * unitPrice)}</strong>` : ''}
      </div>`;
  }).join('');
  const detailRows = [
    destination
      ? `<div class="order-line head"><span>${deliveryModeLabel(order.deliveryMode)}</span><strong>${escapeHtml(destination)}</strong></div>`
      : '',
    order.deliveryMode !== 'pickup' && orderAddress.reference
      ? `<p class="tracking-reference"><strong>Referencia:</strong> ${escapeHtml(orderAddress.reference)}</p>`
      : '',
    itemRows,
    Number(order?.subtotal) > 0
      ? `<div class="summary-row"><span>Subtotal</span><strong>${money(order.subtotal)}</strong></div>`
      : '',
    Number(order?.discountTotal) > 0
      ? `<div class="summary-row discount"><span>Cupón ${escapeHtml(order.coupon?.code || 'Promo')}</span><strong>-${money(order.discountTotal)}</strong></div>`
      : '',
    Number(order?.deliveryFee) > 0
      ? `<div class="summary-row"><span>Envío</span><strong>${money(order.deliveryFee)}</strong></div>`
      : '',
    order?.paymentMethod && order.paymentMethod !== 'Sin especificar'
      ? `<div class="summary-row"><span>Pago</span><strong>${escapeHtml(order.paymentMethod)}</strong></div>`
      : '',
    order?.cashChange
      ? `<div class="summary-row"><span>Cambio efectivo</span><strong>${escapeHtml(order.cashChange)}</strong></div>`
      : '',
    hasTotal
      ? `<div class="summary-row total"><span>Total</span><strong>${money(total)}</strong></div>`
      : '',
    order?.notes && order.notes !== 'Sin notas'
      ? `<p><strong>Observaciones:</strong> ${escapeHtml(order.notes)}</p>`
      : '',
  ].filter(Boolean).join('');
  return `
    <details class="tracking-order-summary tracking-order-detail order-detail" data-order-summary-details>
      <summary>
        <span class="tracking-summary-copy">
          <strong title="Pedido ${escapeHtml(order?.id || '')}">Pedido ${escapeHtml(order?.id || '')}</strong>
          ${meta ? `<small>${escapeHtml(meta)}</small>` : ''}
        </span>
        <span class="tracking-summary-action">
          Ver detalles
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="m7.5 4.5 5 5.5-5 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>
        </span>
      </summary>
      <div class="order-detail-body">
        ${detailRows || '<p>No hay detalles adicionales disponibles.</p>'}
      </div>
    </details>`;
}

function trackingWaitingStage(order, freshness = 'none') {
  if (order.deliveryMode === 'pickup' || ['cancelled', 'delivered'].includes(order.status)) return '';
  const isOutForDelivery = ['picked_up', 'on_the_way', 'arrived', 'arriving'].includes(order.status);
  const copy = isOutForDelivery
    ? freshness === 'lost'
      ? 'La ubicación no está disponible en este momento.'
      : 'El rider está en camino. La ubicación aparecerá cuando esté disponible.'
    : order.status === 'ready'
      ? 'El pedido sigue en el local y saldrá cuando se asigne un rider.'
      : 'El pedido sigue en el local. La ubicación aparecerá cuando comience el reparto.';
  return `
    <div class="tracking-map-waiting" data-tracking-map-placeholder>
      <span aria-hidden="true">
        <svg viewBox="0 0 32 32" focusable="false">
          <path d="M16 28s9-7.7 9-16a9 9 0 1 0-18 0c0 8.3 9 16 9 16Z" fill="none" stroke="currentColor" stroke-width="2"></path>
          <circle cx="16" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"></circle>
          <path d="m6 26 20-20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"></path>
        </svg>
      </span>
      <div>
        <strong>${isOutForDelivery ? 'Ubicación no disponible' : 'El pedido sigue en el local'}</strong>
        <p data-tracking-gps-note>${escapeHtml(copy)}</p>
      </div>
    </div>`;
}

function trackingContactButton({
  accessibleLabel = 'Contactar al local',
  text = 'Contactar',
  className = 'secondary-button compact',
} = {}) {
  const config = getBusinessConfig();
  const phone = String(config.whatsappNumber || '').replace(/\D/g, '');
  if (config.whatsappVerified !== true || phone.length < 8 || phone.length > 15) return '';
  return `<a class="${escapeHtml(className)}" href="https://wa.me/${phone}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(accessibleLabel)}">${escapeHtml(text)}</a>`;
}

function trackingHelpCard() {
  const contact = trackingContactButton({
    text: 'Contactar al local',
    className: 'tracking-help-contact',
  });
  if (!contact) return '';
  return `
    <footer class="tracking-help-card">
      <span class="tracking-help-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M4.5 13v-2a7.5 7.5 0 0 1 15 0v2M5 12.5H3.8A1.8 1.8 0 0 0 2 14.3v2.4a1.8 1.8 0 0 0 1.8 1.8H5v-6ZM19 12.5h1.2a1.8 1.8 0 0 1 1.8 1.8v2.4a1.8 1.8 0 0 1-1.8 1.8H19v-6ZM19 18.5c0 1.7-1.8 2.5-4.5 2.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      </span>
      <span>¿Necesitás ayuda?</span>
      ${contact}
    </footer>`;
}

function trackingHeader() {
  return `
    <header class="tracking-brand-row">
      <strong>TABA</strong>
      <button class="tracking-menu-button" type="button" data-nav-view="profile" aria-label="Abrir menú">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M4 6.5h16M4 12h16M4 17.5h16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"></path>
        </svg>
      </button>
    </header>`;
}

export function renderTracking() {
  const container = $('[data-tracking-panel]');
  if (!container) return;
  const order = getActiveOrder();

  if (!order) {
    renderWithStableRealMap(container, `
      <div class="track-layout tracking-premium tracking-map-experience is-empty no-map">
        <section class="delivery-bottom-sheet tracking-sheet track-progress-card" data-bottom-sheet>
          ${trackingHeader()}
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
  const locationFreshness = trackingLocationFreshness(riderLocation);
  const trackableStatus = ['picked_up', 'on_the_way', 'arrived', 'arriving'].includes(order.status);
  const sandboxSimulation = getOrderSimulation(order);
  const sandboxPresentation = sandboxTrackingPresentation(order, sandboxSimulation);
  const sandboxMapActive = isSandboxOrderRepository(getOrderRepository())
    && trackableStatus
    && ((sandboxSimulation?.source === 'simulation' && sandboxSimulation?.userStarted === true)
      || (sandboxSimulation?.source === 'gps' && hasFreshSharedGpsLocation(sandboxSimulation)));
  const hasUsableLastLocation = trackableStatus
    && ['fresh', 'delayed'].includes(locationFreshness);
  const showMap = isDelivery
    && !['delivered', 'cancelled'].includes(order.status)
    && (hasUsableLastLocation || sandboxMapActive);
  const latestUpdate = latestTrackingTimestamp(order, riderLocation);
  const timelineStatus = order.status === 'arriving' ? 'arrived' : order.status;
  const showRiderCard = isDelivery
    && !isCancelled
    && order.status !== 'delivered'
    && (Boolean(order.assignedRiderId)
      || ['assigned', 'picked_up', 'on_the_way', 'arrived', 'arriving'].includes(order.status));
  renderWithStableRealMap(container, `
    <div class="track-layout tracking-premium tracking-map-experience status-${escapeHtml(order.status)} ${showMap ? '' : 'no-map'}">
      <section class="delivery-bottom-sheet tracking-sheet track-progress-card ${showMap ? 'is-live' : 'is-offline'}" data-bottom-sheet>
        ${trackingHeader()}
        <div class="tracking-hero">
          <h1>${escapeHtml(head.title)}</h1>
          <p class="tracking-subtitle">${escapeHtml(head.sub)}</p>
          <p class="tracking-updated">Última actualización ${escapeHtml(relativeAgeLabel(latestUpdate))}</p>
        </div>
        ${renderPublicOrderTimeline(timelineStatus, { className: 'customer-progress' })}
        ${showMap ? (sandboxMapActive ? sandboxTrackingStage(order, sandboxSimulation) : trackingMapStage({ order })) : trackingWaitingStage(order, locationFreshness)}
        ${showRiderCard
          ? riderTrackingCard(order, riderLocation, sandboxPresentation)
          : ''}
        ${trackingDeliveryCodeCard(order)}
        ${trackingOrderSummaryCard(order)}
        ${trackingHelpCard()}
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

  const pricing = productPricePresentation(product);
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
            ${pricing.regularPrice && pricing.regularPrice > pricing.price ? `<s>${money(pricing.regularPrice)}</s>` : ''}
            <strong>${money(pricing.price)}</strong>
            ${pricing.condition ? `<small>${escapeHtml(pricing.condition)}</small>` : ''}
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
