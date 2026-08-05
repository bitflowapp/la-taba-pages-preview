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
  defaultCatalogFilters,
} from './state.js';
import {
  getCartItems,
  getDeliveryMinimumProgress,
  getCartSummary,
  getRepeatableCustomerOrder,
  validateCartForCheckout,
} from './cart.js';
import { buildDraftMessageFromCart, getActiveOrder } from './orders.js';
import { getRealtimeStatus } from './realtime.js';
import { relayStatusLabel } from './core/realtime-sync.js';
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
import { isDemoMode, isProductionMode, isShowcaseMode } from './core/app-mode.js';
import { getOrderRepository, isSandboxOrderRepository } from './repositories/repository_factory.js';
import { formatPromotionCondition, getActivePromotions, getProductPromotion } from './core/promotions.js';
import { cartNeedsComplementPrompt, getCartRecommendations } from './core/cart-recommendations.js';
import {
  isFernetProduct,
  isPopularProduct,
  isPromotionalProduct,
  isUnitStorefrontProduct,
  uniqueProducts,
} from './core/storefront-filters.js';
import {
  BEVERAGE_HOME_CATEGORY_ORDER,
  buildBeverageHomeSections,
  featuredBeverageProducts,
  getBeverageHomeSection,
  isPurchasableBeverageProduct,
  isVisibleBeverageProduct,
} from './core/beverage-home-sections.js';
import { sandboxTrackingPresentation } from './core/sandbox-tracking-presentation.js';
import { riderAvatarHelmetSvg } from './map/rider_marker.js';
import {
  markStorySeen,
  publishedStories,
  readSeenStoryIds,
  readStoriesSource,
  storyEntryState,
} from './core/stories.js';
import { PREVIEW_STORY_SEED } from './preview-stories-data.js';

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
  applyHomeBrandHeader(config);
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

// Un dato del comercio existe para el cliente sólo si está PUBLICADO. Las
// semillas usan frases explícitas de "todavía no confirmado"; ninguna de ellas
// puede presentarse en el encabezado como si fuera información real. Es la
// misma regla que impide inventar un horario en el código.
const UNPUBLISHED_BUSINESS_VALUE = /(?:a confirmar|no publicad)/i;

export function publishedBusinessValue(value) {
  const text = String(value || '').trim();
  return text && !UNPUBLISHED_BUSINESS_VALUE.test(text) ? text : '';
}

// Encabezado de marca de la home: nombre, rubro, dirección y horario salen de
// `businessConfig`. La dirección se agrega al rubro sólo cuando está publicada;
// el horario tiene su propio nodo y desaparece si no existe.
function applyHomeBrandHeader(config) {
  const rubro = String(config.subtitle || BRAND.shortTagline || '').trim();
  const address = publishedBusinessValue(config.address);
  const hours = publishedBusinessValue(config.openingHoursLabel);

  const place = $('[data-home-business-place]');
  if (place) {
    place.textContent = address && rubro
      ? `${rubro} · ${address}`
      : address || rubro;
    place.hidden = !place.textContent;
  }

  const hoursNode = $('[data-home-business-hours]');
  if (hoursNode) {
    hoursNode.textContent = hours;
    hoursNode.hidden = !hours;
  }
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

// Rótulo del app bar operativo. La variante corta existe para que a 320px el
// texto se acorte por diseño en vez de recortarse con elipsis.
const OPERATIONAL_TOPBAR_LABELS = Object.freeze({
  business: { full: 'OPERACIÓN DEL LOCAL', short: 'OPERACIÓN' },
  rider: { full: 'REPARTO', short: 'REPARTO' },
});

export function renderNavigation(activeView = 'home') {
  document.body.dataset.activeView = activeView;
  // El app bar del panel operativo no habla de la dirección del cliente: dice
  // qué local se opera. El control de dirección se retira por CSS en estas
  // vistas y este bloque toma su lugar.
  const opsLabel = OPERATIONAL_TOPBAR_LABELS[activeView] || null;
  $$('[data-topbar-ops]').forEach((node) => {
    node.hidden = !opsLabel;
  });
  if (opsLabel) {
    setText('[data-topbar-ops-label]', opsLabel.full);
    setText('[data-topbar-ops-label-short]', opsLabel.short);
  }
  // El aviso sonoro pertenece a la cola de pedidos: no aparece en Repartidor.
  $$('.topbar-ops-sound[data-sound-toggle]').forEach((node) => {
    if (activeView !== 'business') node.hidden = true;
  });
  $$('[data-nav-view]').forEach((control) => {
    // Los accesos que no son destinos de navegación (el control de dirección
    // del app bar) no reciben `aria-current`: `page` debe apuntar a uno solo.
    if (control.hasAttribute('data-nav-passive')) return;
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
  renderCatalogFilters();
  renderHomeShowcase();
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
    return { price: basePrice, regularPrice: null, promotion: null, condition: '' };
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
    && product.imageShowsMultipack !== true
    && hasAuthoritativeHashes,
  );
  const loading = variant === 'modal' ? 'eager' : 'lazy';
  const source = official ? thumbnail : PRODUCT_PLACEHOLDER_IMAGE;
  const width = official ? Number(product.thumbnailWidth || 400) : 400;
  const height = official ? Number(product.thumbnailHeight || 400) : 400;
  const responsive = official
    ? ` srcset="${escapeHtml(thumbnail)} 400w, ${escapeHtml(image)} 1000w" sizes="${variant === 'modal' ? '(max-width: 700px) 92vw, 560px' : '(max-width: 700px) 45vw, 260px'}"`
    : '';
  const label = official
    ? `Imagen oficial de ${product.name || 'producto'}`
    : `Producto sin imagen oficial: ${product.name || 'bebida'}`;
  return `
    <span class="thumb ${official ? 'has-photo' : 'uses-placeholder'} tone-${tone} category-${category} thumb-${variant}" role="img" aria-label="${escapeHtml(label)}">
      <img class="thumb-img${official ? '' : ' is-placeholder'}" src="${escapeHtml(source)}"${responsive} width="${width}" height="${height}" alt="" data-product-name="${escapeHtml(product.name || 'bebida')}" loading="${loading}" decoding="async" />
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

const PRICE_PENDING_TITLE = 'Precio próximamente';
const PRICE_PENDING_DETAIL = 'Este producto todavía no está disponible para compra.';

function priceBlock(product) {
  if (product.pricePending) {
    return `<div class="price" data-price-pending-message>
      <div class="price-amounts"><strong>${PRICE_PENDING_TITLE}</strong></div>
      <small class="price-condition">${PRICE_PENDING_DETAIL}</small>
    </div>`;
  }
  const pricing = productPricePresentation(product);
  const old = pricing.regularPrice && pricing.regularPrice > pricing.price
    ? `<s>${money(pricing.regularPrice)}</s>` : '';
  return `
    <div class="price">
      <div class="price-amounts"><strong>${money(pricing.price)}</strong>${old}</div>
      ${pricing.promotion && pricing.condition ? `<small class="price-condition">${escapeHtml(pricing.condition)}</small>` : ''}
    </div>`;
}

function removeGlyph() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 7.5h13M9.2 7.5V5.8h5.6v1.7m-7.8 0 .8 11.1h8.4L17 7.5M10 11v4.2m4-4.2v4.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

// El mismo control se comparte en catálogo, carruseles, recomendaciones y
// carrito para que la cantidad sea una única verdad visual por SKU.
function quantityControl(product, quantity, { className = 'qty-stepper' } = {}) {
  const safeQuantity = Math.max(0, Math.floor(Number(quantity) || 0));
  const reachedStock = safeQuantity >= Number(product.stock || 0);
  const leftLabel = safeQuantity === 1
    ? `Quitar ${product.name} del pedido`
    : `Restar uno de ${product.name}`;
  const leftIcon = safeQuantity === 1 ? removeGlyph() : '<span aria-hidden="true">−</span>';
  return `
    <div class="${className}" aria-label="Cantidad de ${escapeHtml(product.name)} en el pedido">
      <button class="icon-button compact qty-stepper-action qty-stepper-remove" type="button" data-cart-dec="${escapeHtml(product.id)}" aria-label="${escapeHtml(leftLabel)}">${leftIcon}</button>
      <strong aria-live="polite">${safeQuantity}</strong>
      <button class="icon-button compact qty-stepper-action" type="button" data-cart-inc="${escapeHtml(product.id)}" aria-label="Sumar uno de ${escapeHtml(product.name)}" ${reachedStock ? 'disabled' : ''}><span aria-hidden="true">+</span></button>
    </div>`;
}

function quickAddControl(product, quantity, { className = 'add-button' } = {}) {
  const outOfStock = product.stock <= 0 || !product.available || product.pricePending;
  if (quantity > 0) return quantityControl(product, quantity);
  const actionLabel = product.pricePending
    ? `${product.name}: ${PRICE_PENDING_TITLE.toLowerCase()}; ${PRICE_PENDING_DETAIL.toLowerCase()}`
    : `Agregar ${product.name} al pedido`;
  return `<button class="${className}${product.pricePending ? ' is-price-pending' : ''}" type="button" data-add-product="${escapeHtml(product.id)}" aria-label="${escapeHtml(actionLabel)}" ${outOfStock ? 'disabled' : ''}>
    ${product.pricePending ? '' : '<span class="add-plus" aria-hidden="true">+</span>'}<span class="add-text">${product.pricePending ? 'Precio pendiente' : outOfStock ? 'No disponible' : 'Agregar'}</span>
  </button>`;
}

// "Destacados" del home: selección del local marcada en el catálogo. No es una
// métrica de ventas y el copy no la presenta como tal.
function homeOfferProducts() {
  return getBeverageHomeSection(
    'offers',
    getState().products,
    getState().promotions,
    { limit: 6 },
  )?.products || [];
}

function renderOffers() {
  const container = $('[data-offers-rail]');
  if (!container) return;
  container.innerHTML = homeOfferProducts().map(railCard).join('');
}

// Orden comercial de la home: primero aquello por lo que este local es un
// especialista en bebidas. NO es una lista fija de categorías a mostrar: es
// una PRIORIDAD. Sólo entran las que hoy tienen algo efectivamente comprable
// (con precio publicado y stock); las demás siguen accesibles desde "Todas".
// Así la home nunca lleva a una categoría vacía ni promete un rubro que el
// comercio todavía no publicó.
const HOME_CATEGORY_PRIORITY = BEVERAGE_HOME_CATEGORY_ORDER;
const HOME_CATEGORY_LIMIT = BEVERAGE_HOME_CATEGORY_ORDER.length;

function homeProducts(ids) {
  const productsById = new Map(
    getCustomerCatalogProducts(getState().products)
      .filter((product) => !product.pricePending)
      .map((product) => [product.id, product]),
  );
  return ids.map((id) => productsById.get(id)).filter(Boolean);
}

function activePromotionProductIds(state = getState()) {
  return new Set(getActivePromotions(state.promotions)
    .flatMap((promotion) => promotion.includedSkus));
}

function unitStorefrontProducts(state = getState()) {
  return getCustomerCatalogProducts(state.products);
}

function promotionalProducts(state = getState()) {
  const activeIds = activePromotionProductIds(state);
  return uniqueProducts(unitStorefrontProducts(state)
    .filter((product) => isPromotionalProduct(product, activeIds)));
}

function popularProducts(state = getState()) {
  return uniqueProducts(unitStorefrontProducts(state)
    .filter(isPopularProduct));
}

function homePromotionalProducts() {
  return promotionalProducts().slice(0, 6);
}

// Cupo del primer carrusel. Ocho y no tres: con veinte productos comprables un
// rail de tres se lee como una demo a la que le faltan datos, no como la
// vidriera de un local. Ocho llenan el desplazamiento lateral sin volver la
// home un catálogo.
const HOME_BEST_SELLERS_LIMIT = 8;

function homePopularSection() {
  return getBeverageHomeSection(
    'popular',
    getState().products,
    getState().promotions,
    { limit: HOME_BEST_SELLERS_LIMIT },
  );
}

function homeBestSellerProducts() {
  const popular = homePopularSection()?.products || [];
  if (popular.length) return popular.filter((product) => !product.pricePending);
  // La selección heredada se mantiene como "Destacados" cuando todavía no
  // existe una marca popular real. Nunca se presenta como "Lo más pedido".
  // Sale del mismo orden comercial que las secciones de abajo —y con una marca
  // por tarjeta— en vez del orden de carga del catálogo, que abría con tres
  // variantes seguidas de Coca-Cola.
  return featuredBeverageProducts(getState().products, { limit: HOME_BEST_SELLERS_LIMIT });
}

function homeProductImage(product, className) {
  const source = product.imageThumbnail || product.image || PRODUCT_PLACEHOLDER_IMAGE;
  const responsive = product.image && product.imageThumbnail
    ? ` srcset="${escapeHtml(product.imageThumbnail)} 400w, ${escapeHtml(product.image)} 1000w" sizes="(max-width: 700px) 44vw, 260px"`
    : '';
  return `<img class="${className} thumb-img" src="${escapeHtml(source)}"${responsive} width="${Number(product.thumbnailWidth || 400)}" height="${Number(product.thumbnailHeight || 400)}" alt="${escapeHtml(product.name)}" data-product-name="${escapeHtml(product.name)}" loading="lazy" decoding="async" />`;
}

function homeCapacityText(product) {
  const value = Number(product.capacityValue);
  const unit = String(product.capacityUnit || '').toLowerCase();
  if (Number.isFinite(value) && value > 0 && unit) {
    const formatted = Number.isInteger(value) ? String(value) : String(value).replace('.', ',');
    return `${formatted} ${unit === 'l' ? 'L' : unit}`;
  }
  return unitText(product).replace(/^(?:botella|lata)\s+/i, '');
}

// La card compacta mostraba sólo la capacidad de la unidad ("500 ml") mientras
// el precio de al lado es el del pack completo. Un pack x12 a $17.100 leído como
// "500 ml · $17.100" afirma un precio unitario que el negocio no ofrece. La
// capacidad sola es correcta para la unidad suelta y engañosa para el pack, así
// que el multiplicador viaja adelante: es lo que cambia el precio.
function homeUnitText(product) {
  const capacity = homeCapacityText(product);
  const perPack = Number(product.unitsPerPack);
  if (Number.isFinite(perPack) && perPack > 1) {
    return capacity ? `Pack x${perPack} · ${capacity}` : `Pack x${perPack}`;
  }
  return capacity;
}

function renderHomeShowcase() {
  renderHomeCategories();
  renderHomeHeroPromo();
  renderHomePromotions();
  renderHomeBanners();
  renderHomeBestSellers();
  renderHomeSections();
  renderHomeEditorialSelection();
  renderStoryEntry();
}

// ─── Hero promocional ────────────────────────────────────────────────────────
// La pieza de apertura de la vidriera. Es EDITORIAL, no promocional: una
// fotografía curada, un título corto, un subtítulo y una CTA que cae en una
// categoría real con producto comprable. No dice precio, no dice porcentaje y
// no dice "oferta": la promoción comercial, cuando exista, tiene su propio
// bloque y sale del contrato validado de promociones, no de acá.
//
// Fail-closed como todo lo demás: si la categoría de destino no tiene producto
// comprable, el hero NO se pinta. Preferimos abrir con el primer carrusel a
// abrir con una foto grande que lleva a una pantalla vacía.
const HOME_HERO_PROMO = Object.freeze({
  categoryId: 'cervezas',
  eyebrow: 'La vidriera',
  title: 'Bien fría, bien de acá',
  subtitle: 'La selección de cervezas del local, lista para llevar.',
  image: 'assets/promos/cervezas-patagonia.jpg',
});

function renderHomeHeroPromo() {
  const slot = $('[data-home-hero-promo]');
  if (!slot) return;
  const hero = HOME_HERO_PROMO;
  const category = categoriesForCurrentCatalog().find((entry) => entry.id === hero.categoryId);
  if (!category || !purchasableCategoryIds().has(hero.categoryId)) {
    slot.innerHTML = '';
    slot.hidden = true;
    return;
  }
  slot.hidden = false;
  slot.innerHTML = `
    <button class="home-hero-promo" type="button" data-category-id="${escapeHtml(hero.categoryId)}" aria-label="${escapeHtml(`${hero.title}. ${hero.subtitle} Ver ${category.name.toLowerCase()}`)}">
      <span class="home-hero-promo-media" aria-hidden="true" style="background-image:url('${encodeURI(hero.image)}')"></span>
      <span class="home-hero-promo-copy">
        <small>${escapeHtml(hero.eyebrow)}</small>
        <strong>${escapeHtml(hero.title)}</strong>
        <span class="home-hero-promo-sub">${escapeHtml(hero.subtitle)}</span>
        <span class="home-hero-promo-cta">Ver ${escapeHtml(category.name.toLowerCase())} <span aria-hidden="true">→</span></span>
      </span>
    </button>`;
}

// ─── Selección del local (tarjetas con estado honesto) ───────────────────────
// Los rubros premium existen en el catálogo pero todavía no publican precio, así
// que no pueden ser carrusel comprable ni chip de categoría. Acá aparecen con su
// tarjeta real y el estado que corresponde: precio si lo hay, "Precio a
// confirmar" si no. La CTA de una tarjeta sin precio abre la ficha —donde el
// cliente ve el detalle y el aviso— en vez de un "Agregar" que fallaría.
//
// Una tarjeta por rubro como máximo: es una vidriera de cierre, no un segundo
// catálogo. Y sólo entra el rubro que NO tiene carrusel arriba.
const HOME_EDITORIAL_CATEGORIES = Object.freeze(['whisky', 'vinos', 'fernet', 'aperitivos', 'gin', 'espumantes']);
const HOME_EDITORIAL_LIMIT = 6;

// Sólo entra lo que NO se puede comprar todavía. No es un filtro cosmético: es
// lo que hace que este tramo se vacíe solo. El día que el local publique el
// precio de un whisky, ese producto sale de acá y entra al carrusel comprable
// de arriba, sin quedar en los dos lados a la vez. Si todos los rubros premium
// publican precio, la sección entera desaparece.
function homeEditorialProducts() {
  const catalog = getCustomerCatalogProducts(getState().products)
    .filter(isVisibleBeverageProduct)
    .filter((product) => !isPurchasableBeverageProduct(product));
  const picked = [];
  for (const categoryId of HOME_EDITORIAL_CATEGORIES) {
    const product = catalog.find((entry) => entry.categoryId === categoryId);
    if (product) picked.push(product);
    if (picked.length >= HOME_EDITORIAL_LIMIT) break;
  }
  return picked;
}

function renderHomeEditorialSelection() {
  const rail = $('[data-home-editorial-rail]');
  if (!rail) return;
  const section = rail.closest('.home-merch-section');
  const products = homeEditorialProducts();
  if (section) section.hidden = products.length === 0;
  const cartQuantities = new Map(getCartItems().map((item) => [item.productId, item.quantity]));
  rail.innerHTML = products.map((product) => homeSectionCard(product, cartQuantities)).join('');
}

// Banner editorial. NO afirma un descuento: invita a recorrer una categoría que
// existe y tiene productos comprables. Si el comercio publica una promoción
// real, el bloque de ofertas se ocupa de ella y este banner sigue siendo lo que
// es: una puerta, no un precio.
// `image` es fotografía editorial curada (assets/promos), NO una promoción: el
// lote fue vetado con su fuente registrada y el propio reporte de curaduría
// aclara que no implica precio ni oferta vigente. Por eso vive acá, en el banner
// que invita a recorrer una categoría, y no en el bloque de ofertas.
// Las categorías sin pieza vetada quedan sin `image` y el banner se pinta como
// hasta ahora: preferimos un banner sobrio a una imagen prestada de otro rubro.
// Dos clases de puerta, un solo componente:
//
//   · de RUBRO  → `category`, filtra el catálogo por esa categoría.
//   · de MARCA  → `brand`, busca esa marca en el catálogo real.
//
// La de marca existe porque el local tiene marcas que son un motivo de compra
// en sí mismas (Heineken, Andes Origen) y meterlas en el banner de "Cervezas"
// las volvía invisibles. Su destino NO es inventado: es la misma búsqueda que
// escribiría el cliente, así que cae en el catálogo con resultados reales.
// Un banner de marca sin producto en el catálogo NO se pinta: es la misma regla
// fail-closed de las categorías vacías, y es lo que hoy mantiene apagado a
// Andes Origen —la pieza está vetada y registrada, el catálogo todavía no la
// publica—. El día que el local la cargue, aparece sola.
// `focus` es el punto de anclaje del recorte (background-position del panel de
// la derecha). No es decoración: el panel es casi cuadrado y cada botella está
// en un lugar distinto de su escena, así que un `center` genérico deja afuera
// justo el producto —de la escena de Chivas quedaba una banda de mantel—. El
// valor sale de mirar cada pieza, y una sin `focus` cae en `center`.
const HOME_BANNER_COPY = Object.freeze({
  cervezas: { eyebrow: 'Para el finde', title: 'Cervezas bien frías', image: 'assets/promos/cervezas-heineken.jpg', focus: '44% 58%' },
  heineken: { brand: 'Heineken', eyebrow: 'La marca', title: 'Heineken bien tirada', image: 'assets/promos/cervezas-heineken.jpg', focus: '44% 58%' },
  'andes-origen': { brand: 'Andes Origen', eyebrow: 'De la Patagonia', title: 'Andes Origen', image: 'assets/promos/cervezas-andes-origen.webp' },
  fernet: { eyebrow: 'Clásico argentino', title: 'Fernet y amargos', image: 'assets/promos/fernet-brancamenta.jpg', focus: '50% 48%' },
  whisky: { eyebrow: 'Selección premium', title: 'El mejor whisky', image: 'assets/promos/whisky-chivas.webp', focus: '64% 55%' },
  vinos: { eyebrow: 'Bodega', title: 'Vinos para la mesa' },
  gaseosas: { eyebrow: 'Siempre en casa', title: 'Gaseosas y packs' },
  energizantes: { eyebrow: 'Energía', title: 'Energizantes fríos', image: 'assets/promos/energizantes-red-bull.jpg', focus: '48% 55%' },
  aperitivos: { eyebrow: 'La previa', title: 'Aperitivos y vermús', image: 'assets/promos/aperitivos-gancia.webp' },
  gin: { eyebrow: 'Destilados', title: 'Gin y tónicas', image: 'assets/promos/gin-tanqueray.jpg', focus: '62% 52%' },
  mixers: { eyebrow: 'Para mezclar', title: 'Tónicas y mixers', image: 'assets/promos/mixers-schweppes.jpg' },
  aguas: { eyebrow: 'Hidratación', title: 'Aguas y sodas' },
  complementos: { eyebrow: 'Complementos', title: 'Hielo y accesorios' },
});
// CERO en el encabezado: ese lugar es ahora del hero promocional. Antes el
// contenedor de arriba pintaba un banner y, con el hero delante, quedaban dos
// vidrieras fotográficas seguidas antes del segundo producto. Los banners pasan
// a vivir sólo intercalados entre carruseles, que es donde cortan el ritmo.
const HOME_BANNER_LIMIT = 0;

// Prioridad del banner: primero los rubros premium. A diferencia de la fila de
// categorías, acá NO se exige precio publicado, porque el banner es editorial
// ("Explorar la selección") y no promete importe: sólo pide que la categoría
// exista y tenga productos que el cliente pueda mirar. Una categoría vacía sí
// queda afuera: eso sería un link muerto.
// En teléfono se pinta UN solo banner, así que el primero de esta lista es el
// que decide la vidriera. Encabeza cervezas porque es la pieza que la curaduría
// señala con espacio lateral para overlay y alto contraste: las escenas de bar
// (whisky) quedan preciosas en grande pero a 400px de ancho no se distingue el
// producto. Detrás siguen los rubros premium.
const HOME_BANNER_PRIORITY = Object.freeze([
  'cervezas', 'whisky', 'fernet', 'heineken', 'vinos', 'aperitivos', 'gin',
  'andes-origen', 'energizantes', 'mixers', 'espumantes', 'gaseosas', 'aguas',
  'complementos',
]);

function categoriesWithProducts(state = getState()) {
  return new Set(getCustomerCatalogProducts(state.products)
    .map((product) => product.categoryId)
    .filter(Boolean));
}

// Marcas que hoy pueden encabezar un banner: existen en el catálogo del cliente
// con al menos un producto visible. Igualdad exacta de marca tras normalizar
// caja y acentos: acá no se comparan cadenas parecidas sino la misma marca.
function catalogBrandNames(state = getState()) {
  return new Set(getCustomerCatalogProducts(state.products)
    .filter(isVisibleBeverageProduct)
    .map((product) => normalizeSearchText(product.brand || ''))
    .filter(Boolean));
}

// Puertas que hoy pueden pintarse: tienen copy editorial escrito Y un destino
// con producto real. Una categoría vacía o una marca que el local todavía no
// carga quedan afuera: eso sería un link muerto.
function bannerEligibleCategoryIds() {
  const withProducts = categoriesWithProducts();
  const brands = catalogBrandNames();
  const byId = new Map(categoriesForCurrentCatalog().map((category) => [category.id, category]));
  return HOME_BANNER_PRIORITY.filter((id) => {
    const copy = HOME_BANNER_COPY[id];
    if (!copy) return false;
    if (copy.brand) return brands.has(normalizeSearchText(copy.brand));
    return withProducts.has(id) && byId.has(id);
  });
}

function homeBannerMarkup(id) {
  const copy = HOME_BANNER_COPY[id];
  if (!copy) return '';
  // `--banner-focus` sólo se emite si la pieza lo declara; el CSS ya trae el
  // `center` de respaldo. El valor viene de una tabla del código, nunca del
  // catálogo ni de la URL, así que no hay dónde inyectar.
  const focus = /^[\d.]+% [\d.]+%$/.test(copy.focus || '') ? `;--banner-focus:${copy.focus}` : '';
  const media = copy.image
    ? `<span class="home-brand-banner-media" aria-hidden="true" style="background-image:url('${encodeURI(copy.image)}')${focus}"></span>`
    : '';

  // Puerta de MARCA: el destino es la búsqueda real de esa marca en el
  // catálogo. Sin `data-category-id`, así que no compite con el rubro que ya
  // tiene carrusel ni se confunde con él en la composición.
  if (copy.brand) {
    const label = `${copy.title}. Ver ${copy.brand} en el catálogo`;
    return `
      <button class="home-brand-banner ${copy.image ? 'has-media' : ''}" type="button" data-brand-query="${escapeHtml(copy.brand)}" aria-label="${escapeHtml(label)}">
        ${media}
        <small>${escapeHtml(copy.eyebrow)}</small>
        <strong>${escapeHtml(copy.title)}</strong>
        <span>Ver ${escapeHtml(copy.brand)} <span aria-hidden="true">→</span></span>
      </button>`;
  }

  const category = categoriesForCurrentCatalog().find((entry) => entry.id === id);
  if (!category) return '';
  // El verbo distingue lo que se puede comprar de lo que sólo se puede mirar.
  const action = purchasableCategoryIds().has(id) ? 'Ver' : 'Explorar';
  return `
    <button class="home-brand-banner ${copy.image ? 'has-media' : ''}" type="button" data-category-id="${escapeHtml(id)}" aria-label="${escapeHtml(`${copy.title}. ${action} la categoría ${category.name}`)}">
      ${media}
      <small>${escapeHtml(copy.eyebrow)}</small>
      <strong>${escapeHtml(copy.title)}</strong>
      <span>${escapeHtml(action)} ${escapeHtml(category.name.toLowerCase())} <span aria-hidden="true">→</span></span>
    </button>`;
}

function renderHomeBanners() {
  const container = $('[data-home-banners]');
  if (!container) return;
  container.innerHTML = bannerEligibleCategoryIds()
    .slice(0, HOME_BANNER_LIMIT)
    .map(homeBannerMarkup)
    .join('');
}

// ─── Historias comerciales ───────────────────────────────────────────────────
// La home sólo lee el contrato. Sin historias publicadas y vigentes el logo NO
// es un botón, el aro no existe y el acceso permanece oculto: nada promete un
// contenido que no está.
// Sin caché a propósito. La vigencia depende del reloj: una historia que vence
// durante la sesión tiene que desaparecer sola, y un origen que se publica
// después del primer pintado tiene que aparecer sin recargar. Normalizar unos
// pocos registros por render es más barato que sostener invalidación.
export function getHomeStories() {
  // El global publicado por el backend siempre gana; `readStoriesSource` sólo
  // cae en las fixtures cuando NO hay origen real. En producción `demo` y
  // `showcase` son falsos, así que sin backend la lista sigue vacía y el aro
  // sigue apagado: el fail-closed no se toca.
  return publishedStories(readStoriesSource({
    showcase: isDemoMode() || isShowcaseMode(),
    fixtures: PREVIEW_STORY_SEED,
  }));
}

// Pinta TODOS los puntos de entrada a historias —hoy el encabezado de la home y
// el de Perfil— desde el mismo estado. Con un solo `querySelector` el segundo
// slot se quedaba con el `data-stories-state` del marcado inicial: aro apagado
// en una vista y encendido en la otra, y una historia vista en la home que en
// Perfil seguía figurando como nueva.
function renderStoryEntry() {
  const slots = $$('[data-stories-slot]');
  if (!slots.length) return;
  const entry = storyEntryState(getHomeStories(), readSeenStoryIds());
  const businessName = getBusinessConfig().businessName || BRAND.demoBusinessName;
  const actionLabel = entry.unseen
    ? `Ver ${entry.unseen === 1 ? 'la historia nueva' : `las ${entry.unseen} historias nuevas`} de ${businessName}`
    : `Ver las historias de ${businessName}`;

  for (const slot of slots) {
    slot.dataset.storiesState = entry.state;
    const staticLogo = $('[data-stories-static]', slot);
    const actionLogo = $('.brand-logo-action', slot);
    if (staticLogo) staticLogo.hidden = entry.available;
    if (actionLogo) {
      actionLogo.hidden = !entry.available;
      actionLogo.setAttribute('aria-label', actionLabel);
    }
  }

  const cta = $('.brand-stories-cta');
  if (cta) {
    cta.hidden = !entry.available;
    const detail = $('[data-stories-cta-detail]', cta);
    // El estado no viaja sólo en el color del aro: el texto lo dice.
    if (detail) {
      detail.textContent = entry.unseen
        ? `${entry.unseen} ${entry.unseen === 1 ? 'historia nueva' : 'historias nuevas'}`
        : 'Ver historias';
    }
    const thumb = $('[data-stories-cta-thumb]', cta);
    if (thumb) thumb.style.backgroundImage = entry.thumbnail ? `url("${encodeURI(entry.thumbnail)}")` : '';
    cta.setAttribute('aria-label', `Novedades de hoy de ${businessName}. Ver historias.`);
  }
}

let storiesRestoreFocus = null;
let storiesCloseBound = false;
let storiesIndex = 0;

export function closeStoriesModal() {
  const modal = $('[data-stories-modal]');
  if (modal?.open) modal.close();
}

/**
 * Abre el visor. Devuelve `false` cuando no hay historias vigentes: la home
 * nunca abre un diálogo vacío.
 */
export function showStoriesModal(index = 0, restoreTrigger = null) {
  const modal = $('[data-stories-modal]');
  const content = $('[data-stories-content]');
  const stories = getHomeStories();
  if (!modal || !content || !stories.length) return false;

  if (!storiesCloseBound) {
    modal.addEventListener('close', () => {
      const target = storiesRestoreFocus;
      storiesRestoreFocus = null;
      // Al cerrar, el aro y el acceso se recalculan con las vistas nuevas.
      renderStoryEntry();
      if (target?.isConnected && typeof target.focus === 'function') target.focus();
    });
    storiesCloseBound = true;
  }

  if (!modal.open) {
    const active = restoreTrigger || document.activeElement;
    storiesRestoreFocus = active && active !== document.body && typeof active.focus === 'function'
      ? active
      : null;
  }

  storiesIndex = Math.min(Math.max(0, Number(index) || 0), stories.length - 1);
  const story = stories[storiesIndex];
  markStorySeen(story.id);

  const media = story.mediaType === 'video'
    ? `<video src="${escapeHtml(story.mediaUrl)}" controls playsinline preload="metadata"${story.thumbnailUrl ? ` poster="${escapeHtml(story.thumbnailUrl)}"` : ''}></video>`
    : `<img src="${escapeHtml(story.mediaUrl)}" alt="${escapeHtml(story.title || 'Historia del comercio')}" loading="eager" decoding="async" />`;

  // La CTA sólo existe si el contrato la validó (tipo conocido + destino). Sin
  // eso el visor muestra la historia y nada más: no se fabrica un botón.
  const cta = story.cta
    ? `<button class="primary-button" type="button" data-story-cta data-story-action="${escapeHtml(story.cta.action)}" data-story-target="${escapeHtml(story.cta.target)}">${escapeHtml(story.cta.label)}</button>`
    : '';

  content.innerHTML = `
    <div class="stories-card" role="document">
      <button class="modal-close" type="button" data-close-stories aria-label="Cerrar historias">×</button>
      <div class="stories-progress" role="group" aria-label="Historia ${storiesIndex + 1} de ${stories.length}">
        ${stories.map((_, position) => `<span class="${position === storiesIndex ? 'is-active' : ''}"></span>`).join('')}
      </div>
      <div class="stories-media">${media}</div>
      <div class="stories-body">
        ${story.title ? `<h2>${escapeHtml(story.title)}</h2>` : ''}
        ${cta ? `<div class="stories-actions">${cta}</div>` : ''}
        <div class="stories-nav">
          <button type="button" data-story-prev ${storiesIndex === 0 ? 'disabled' : ''}>Anterior</button>
          <button type="button" data-story-next ${storiesIndex >= stories.length - 1 ? 'disabled' : ''}>Siguiente</button>
        </div>
      </div>
    </div>`;

  if (typeof modal.showModal === 'function' && !modal.open) modal.showModal();
  return true;
}

export function stepStoriesModal(delta) {
  return showStoriesModal(storiesIndex + delta);
}

// Categorías con al menos un producto comprable ahora mismo: precio publicado,
// disponible y con stock. Es exactamente el criterio que usa la tarjeta para
// habilitar "Agregar", así que la fila no puede contradecir al catálogo.
function purchasableCategoryIds(state = getState()) {
  return new Set(getCustomerCatalogProducts(state.products)
    .filter((product) => !product.pricePending && product.available && Number(product.stock) > 0)
    .map((product) => product.categoryId)
    .filter(Boolean));
}

function homeCategoryList() {
  const state = getState();
  const purchasable = purchasableCategoryIds(state);
  const byId = new Map(categoriesForCurrentCatalog().map((category) => [category.id, category]));
  const ordered = HOME_CATEGORY_PRIORITY
    .filter((id) => purchasable.has(id) && byId.has(id))
    .map((id) => byId.get(id));
  // Una categoría comprable que todavía no figura en la prioridad no puede
  // quedar invisible sólo por no estar en la lista: se suma al final.
  const rest = [...purchasable]
    .filter((id) => byId.has(id) && !HOME_CATEGORY_PRIORITY.includes(id))
    .map((id) => byId.get(id));
  return [...ordered, ...rest].slice(0, HOME_CATEGORY_LIMIT);
}

function renderHomeCategories() {
  const strip = $('[data-home-category-strip]');
  if (!strip) return;
  const state = getState();
  const activeCategory = state.searchQuery.trim() ? null : state.activeCategory;
  const list = homeCategoryList();
  if (!list.length) {
    strip.innerHTML = '';
    strip.hidden = true;
    return;
  }
  strip.hidden = false;
  // "Todas" abre la fila: es el filtro activo por defecto, así que su marca
  // roja tiene que estar VISIBLE sin scroll. Además deja a un toque el resto
  // del catálogo, incluidas las categorías que aún no publican precio.
  const entries = [{ id: 'all', name: 'Todas' }, ...list];
  strip.innerHTML = entries.map((category) => {
    const isActive = activeCategory === category.id;
    return `
      <button class="home-category-card ${isActive ? 'active' : ''}" type="button" data-category-id="${category.id}"${isActive ? ' aria-current="true"' : ''}>
        <span class="home-category-icon" aria-hidden="true">${categoryGlyph(category.id)}</span>
        <span>${escapeHtml(category.name)}</span>
      </button>`;
  }).join('');
}

function renderHomePromotions() {
  const container = $('[data-home-promotions]');
  if (!container) return;
  const products = homePromotionalProducts();
  const block = container.closest('.home-merch-section');
  if (block) block.hidden = products.length === 0;
  const cartQuantities = new Map(getCartItems().map((item) => [item.productId, item.quantity]));
  container.innerHTML = products.map((product) => {
    const pricing = productPricePresentation(product);
    const old = pricing.regularPrice && pricing.regularPrice > pricing.price
      ? `<s>${money(pricing.regularPrice)}</s>`
      : '';
    const discount = discountPercent(product);
    const badge = discount > 0 ? `${discount}% OFF` : 'Promoción vigente';
    const outOfStock = product.stock <= 0 || !product.available;
    return `
      <article class="home-promo-card ${outOfStock ? 'out-of-stock' : ''}">
        <button class="home-promo-media" type="button" data-product-detail="${product.id}" aria-label="Ver ${escapeHtml(product.name)}">
          <span class="home-promo-badge">${escapeHtml(badge)}</span>
          ${homeProductImage(product, 'home-promo-image')}
        </button>
        <div class="home-promo-copy">
          ${product.brand ? `<span class="home-promo-brand">${escapeHtml(product.brand)}</span>` : ''}
          <strong>${escapeHtml(product.name)}</strong>
          <span class="home-product-price">${money(pricing.price)}</span>
          ${old}
          <small>${escapeHtml(homeUnitText(product))}</small>
          <small class="home-offer-availability">${outOfStock ? 'Agotado' : 'Disponible'}</small>
        </div>
        <div class="home-card-control">${quickAddControl(product, cartQuantities.get(product.id) || 0, { className: 'home-add-button' })}</div>
      </article>`;
  }).join('');
  bindHomePromotionPaging();
}

function renderHomeBestSellers() {
  const container = $('[data-home-best-sellers]');
  if (!container) return;
  const popularSection = homePopularSection();
  const title = document.getElementById('home-best-title');
  if (title) title.textContent = popularSection?.products.length ? popularSection.title : 'Destacados';
  const cartQuantities = new Map(getCartItems().map((item) => [item.productId, item.quantity]));
  // Misma tarjeta que los carruseles de abajo. Antes "Destacados" emitía su
  // propia variante sin el botón de favorito: dos tarjetas distintas en la
  // misma pantalla, y la primera —la más vista— era la que no dejaba guardar.
  container.innerHTML = homeBestSellerProducts()
    .map((product) => homeSectionCard(product, cartQuantities))
    .join('');
}

let homePromotionResizeObserver = null;

function updateHomePromotionPaging() {
  const rail = $('[data-home-promotions]');
  const dots = $('[data-home-paging-dots]');
  if (!rail || !dots) return;
  const cardCount = rail.querySelectorAll('.home-promo-card').length;
  const maxScroll = Math.max(0, rail.scrollWidth - rail.clientWidth);
  const pageCount = maxScroll > 1
    ? Math.min(cardCount, Math.ceil(rail.scrollWidth / rail.clientWidth))
    : 1;
  dots.hidden = pageCount <= 1;
  if (dots.childElementCount !== pageCount) {
    dots.innerHTML = Array.from({ length: pageCount }, () => '<span></span>').join('');
  }
  const activeIndex = pageCount <= 1 || maxScroll <= 0
    ? 0
    : Math.min(pageCount - 1, Math.round((rail.scrollLeft / maxScroll) * (pageCount - 1)));
  [...dots.children].forEach((dot, index) => {
    dot.classList.toggle('is-active', index === activeIndex);
  });
}

function bindHomePromotionPaging() {
  const rail = $('[data-home-promotions]');
  if (!rail) return;
  let frame = 0;
  rail.onscroll = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(updateHomePromotionPaging);
  };
  homePromotionResizeObserver?.disconnect();
  if (typeof ResizeObserver === 'function') {
    homePromotionResizeObserver = new ResizeObserver(updateHomePromotionPaging);
    homePromotionResizeObserver.observe(rail);
  }
  requestAnimationFrame(updateHomePromotionPaging);
}

// Carruseles por sección de bebidas. Reutilizan el rail y la tarjeta de
// "Destacados" para que la home se lea como una sola superficie y no como dos
// sistemas de tarjeta distintos.
//
// Sólo entran secciones de categoría: ofertas y populares ya tienen su bloque
// propio más arriba, y repetirlas acá duplicaría producto sin agregar oferta.
//
// Se filtra por `isPurchasableBeverageProduct`: un precio pendiente sigue vivo
// en el catálogo y en la búsqueda, pero no puede ocupar la home, que es la
// superficie de compra. Una sección sin nada comprable no se renderiza, así que
// no deja un hueco con título y vacío debajo.
const HOME_SECTION_PRODUCT_LIMIT = 8;
// La home es una vidriera, no el catálogo. El tope de secciones existe para que
// agregar rubros al catálogo no alargue la home indefinidamente: lo que no entra
// acá sigue estando a un toque en "Ver catálogo completo".
const HOME_MAX_SECTIONS = 6;

function renderHomeSections() {
  const container = $('[data-home-sections]');
  if (!container) return;
  const sections = buildBeverageHomeSections(
    getState().products,
    getState().promotions,
    { limit: Number.POSITIVE_INFINITY },
  )
    .filter((section) => section.kind === 'category')
    .map((section) => ({
      ...section,
      products: section.products
        .filter(isPurchasableBeverageProduct)
        .slice(0, HOME_SECTION_PRODUCT_LIMIT),
    }))
    .filter((section) => section.products.length > 0)
    .slice(0, HOME_MAX_SECTIONS);

  // Vidriera intercalada. Los rubros premium del local —whisky, fernet, vinos—
  // todavía no publican precio, así que no pueden ser sección ni chip sin
  // afirmar algo que el negocio no dijo. Sí pueden ser puerta: un banner
  // editorial por tramo, con CTA a la categoría real, que rompe la sucesión de
  // carruseles y hace que la home se lea como una tienda y no como una lista.
  //
  // Un banner sólo entra si su rubro NO tiene ya un carrusel propio en la home:
  // repetir "Energizantes" como banner justo debajo del carrusel de
  // energizantes gasta un tramo entero en decir dos veces lo mismo. Por
  // construcción, entonces, los banners cubren exactamente lo que las secciones
  // no pueden cubrir.
  const sectionCategoryIds = new Set(sections.flatMap((section) => section.categoryIds));
  const usedByHeader = new Set(bannerEligibleCategoryIds().slice(0, HOME_BANNER_LIMIT));
  const interleaved = bannerEligibleCategoryIds()
    .filter((id) => !usedByHeader.has(id) && !sectionCategoryIds.has(id));

  const cartQuantities = new Map(getCartItems().map((item) => [item.productId, item.quantity]));
  container.innerHTML = sections.map((section, index) => {
    const headingId = `home-section-${escapeHtml(section.id)}`;
    const target = section.categoryIds[0] || 'all';
    const cards = section.products
      .map((product) => homeSectionCard(product, cartQuantities))
      .join('');
    // El primer tramo va limpio: arriba ya hay un banner y encadenarlos deja al
    // cliente con dos vidrieras seguidas antes del segundo producto.
    const banner = index > 0 && interleaved.length
      ? `<div class="home-brand-banners home-brand-banners-inline">${homeBannerMarkup(interleaved.shift())}</div>`
      : '';
    return `
      <section class="home-merch-section home-category-section" aria-labelledby="${headingId}">
        <div class="home-section-head">
          <div class="home-section-title">
            <h2 id="${headingId}">${escapeHtml(section.title)}</h2>
          </div>
          <button type="button" data-category-id="${escapeHtml(target)}">Ver todos</button>
        </div>
        <div class="home-best-sellers offers-rail">${cards}</div>
      </section>${banner}`;
  }).join('');
}

function homeSectionCard(product, cartQuantities) {
  const pricing = productPricePresentation(product);
  const outOfStock = product.stock <= 0 || !product.available;
  const favorite = isFavoriteProduct(product.id);
  // Sin precio publicado la tarjeta lo DICE. Antes caía en `money(0)` y la
  // vidriera mostraba "$ 0", que es peor que no mostrar nada: afirma un precio
  // que el local nunca ofreció. Y la acción deja de ser un "Agregar" apagado
  // para ser lo único que sí se puede hacer con ese producto hoy: abrir la
  // ficha y leer el detalle.
  const price = product.pricePending
    ? `<span class="home-price-pending">${escapeHtml(PRICE_PENDING_TITLE)}</span>`
    : `<span>${money(pricing.price)}</span>`;
  const control = product.pricePending
    ? `<button class="home-add-button is-price-pending" type="button" data-product-detail="${escapeHtml(product.id)}" aria-label="${escapeHtml(`Ver la ficha de ${product.name}. ${PRICE_PENDING_DETAIL}`)}"><span class="add-text">Ver detalle</span></button>`
    : quickAddControl(product, cartQuantities.get(product.id) || 0, { className: 'home-add-button' });
  return `
    <article class="home-best-card ${outOfStock && !product.pricePending ? 'out-of-stock' : ''}">
      <button class="home-favorite-button ${favorite ? 'is-favorite' : ''}" type="button" data-favorite-toggle="${product.id}" aria-pressed="${favorite}" aria-label="${favorite ? 'Quitar' : 'Guardar'} ${escapeHtml(product.name)} de favoritos">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20.8 4.8a5.3 5.3 0 0 0-7.5 0L12 6.1l-1.3-1.3a5.3 5.3 0 0 0-7.5 7.5L12 21l8.8-8.7a5.3 5.3 0 0 0 0-7.5Z" fill="currentColor" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
        </svg>
      </button>
      <button class="home-best-media" type="button" data-product-detail="${product.id}" aria-label="Ver ${escapeHtml(product.name)}">
        ${homeProductImage(product, 'home-best-image')}
      </button>
      <div class="home-best-copy">
        <strong>${escapeHtml(product.name)}</strong>
        <small>${escapeHtml(homeUnitText(product))}</small>
        ${price}
      </div>
      <div class="home-card-control">${control}</div>
    </article>`;
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
  const quantity = getCartItems().find((item) => item.productId === product.id)?.quantity || 0;
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
      <div class="rail-card-control">${quickAddControl(product, quantity, { className: 'rail-add' })}</div>
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
  fernet: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <path d="M10 3h4v4l1.6 2.1V21H8.4V9.1L10 7V3Z" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M8.4 12.4h7.2" stroke="currentColor" stroke-width="1.6"/>
  </svg>`,
  aperitivos: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <path d="M4.5 5h15l-7.5 8-7.5-8Z" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M12 13v6M9 19h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`,
  mixers: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <path d="M8.5 3h7v3.2l1.4 2.2V20a1 1 0 0 1-1 1H8.1a1 1 0 0 1-1-1V8.4L8.5 6.2V3Z" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M7.4 13.2h9.2" stroke="currentColor" stroke-width="1.6"/>
  </svg>`,
});

// Los ids reales del catálogo no siempre coinciden con la clave del glifo
// (heredada de una taxonomía anterior). El alias evita que media docena de
// categorías caiga en el icono genérico de grilla, que era la principal fuente
// de iconografía inconsistente en la fila.
const CATEGORY_GLYPH_ALIASES = Object.freeze({
  energizantes: 'energeticas',
  vinos: 'vinos-y-espumantes',
  espumantes: 'vinos-y-espumantes',
  whisky: 'whisky-y-destilados',
  gin: 'gins-y-vodkas',
  complementos: 'hielo-y-extras',
  'aguas-saborizadas': 'aguas',
  'jugos-y-saborizadas': 'jugos',
});

function categoryGlyph(categoryId) {
  const key = CATEGORY_GLYPH_ALIASES[categoryId] || categoryId;
  return CATEGORY_GLYPHS[key] || CATEGORY_GLYPHS.all;
}

function renderCategories() {
  const strips = $$('[data-category-strip]');
  if (!strips.length) return;
  const state = getState();
  // Con búsqueda activa ninguna categoría queda marcada: la consulta es el
  // filtro dominante y dos filtros marcados a la vez se contradicen.
  const activeCategory = state.searchQuery.trim() ? null : state.activeCategory;
  const catalogCategories = categoriesForCurrentCatalog();
  const fullList = [
    catalogCategories[0],
    { id: 'favorites', name: 'Favoritos' },
    ...catalogCategories.slice(1),
  ];
  const homeList = catalogCategories.filter((category) => category.id !== 'all');
  const catalogTopIds = ['all', 'favorites', 'gaseosas', 'mixers', 'energizantes', 'cervezas'];
  const catalogTopList = catalogTopIds
    .map((id) => fullList.find((category) => category.id === id))
    .filter(Boolean);
  const remainingCatalogList = fullList.filter((category) => !catalogTopIds.includes(category.id));

  const markupFor = (list) => list.map((category) => `
    <button class="category-button ${activeCategory === category.id ? 'active' : ''}" type="button" data-category-id="${category.id}" aria-pressed="${activeCategory === category.id}">
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

function renderCatalogFilters() {
  const panel = $('[data-catalog-filters]');
  if (!panel) return;
  const state = getState();
  const filters = { ...defaultCatalogFilters(), ...(state.catalogFilters || {}) };
  const products = unitStorefrontProducts(state);
  const options = {
    brand: uniqueFilterValues(products, (product) => product.brand),
    capacity: uniqueFilterValues(products, (product) => product.capacity),
    presentation: uniqueFilterValues(products, (product) => product.packageType),
  };
  const available = products.filter((product) => product.available && Number(product.stock) > 0 && !product.pricePending).length;
  const pending = products.filter((product) => product.pricePending).length;
  const alcohol = products.filter((product) => product.alcoholic).length;
  const packs = products.filter((product) => Number(product.unitsPerPack) > 1).length;
  const promo = activePromotionProductIds(state).size;
  const select = (key, label, values, { all = `Todas las ${label.toLowerCase()}` } = {}) => {
    const field = panel.querySelector(`[data-catalog-filter-field="${key}"]`);
    const control = panel.querySelector(`[data-catalog-filter="${key}"]`);
    if (!field || !control) return;
    field.hidden = values.length < 2;
    control.innerHTML = [
      `<option value="all">${escapeHtml(all)}</option>`,
      ...values.map(({ value, label: optionLabel }) => `<option value="${escapeHtml(value)}">${escapeHtml(optionLabel)}</option>`),
    ].join('');
    control.value = values.some((option) => option.value === filters[key]) ? filters[key] : 'all';
  };
  select('brand', 'marcas', options.brand, { all: 'Todas las marcas' });
  select('capacity', 'capacidades', options.capacity, { all: 'Todas las capacidades' });
  select('presentation', 'presentaciones', options.presentation, { all: 'Todas las presentaciones' });
  select('pack', 'formatos', [
    ...(products.some((product) => Number(product.unitsPerPack) === 1) ? [{ value: 'unit', label: 'Unidad' }] : []),
    ...(packs ? [{ value: 'pack', label: 'Pack' }] : []),
  ], { all: 'Unidad o pack' });
  select('alcohol', 'tipos', [
    ...(alcohol ? [{ value: 'with', label: 'Con alcohol' }] : []),
    ...(products.some((product) => !product.alcoholic) ? [{ value: 'without', label: 'Sin alcohol' }] : []),
  ], { all: 'Con y sin alcohol' });
  select('availability', 'disponibilidad', [
    ...(available ? [{ value: 'available', label: 'Disponible' }] : []),
    ...(products.length - available ? [{ value: 'unavailable', label: 'No disponible' }] : []),
  ], { all: 'Toda disponibilidad' });
  select('price', 'precios', [
    ...(products.some((product) => !product.pricePending) ? [{ value: 'confirmed', label: 'Con precio' }] : []),
    ...(pending ? [{ value: 'pending', label: 'Precio próximamente' }] : []),
  ], { all: 'Todos los precios' });
  select('promotion', 'promociones', promo ? [{ value: 'active', label: 'Promoción activa' }] : [], { all: 'Sin filtro de promoción' });

  const count = Object.values(filters).filter((value) => value !== 'all').length;
  const countNode = panel.querySelector('[data-catalog-filter-count]');
  if (countNode) {
    countNode.textContent = count ? `${count} ${count === 1 ? 'filtro activo' : 'filtros activos'}` : 'Filtros';
  }
  // El botón no desaparece: se apaga. En el bottom sheet un control que se va
  // reacomoda la fila de acciones justo cuando el cliente va a tocarla.
  const reset = panel.querySelector('[data-reset-catalog-filters]');
  if (reset) {
    reset.hidden = false;
    reset.disabled = count === 0;
  }
}

function uniqueFilterValues(products, getter) {
  const values = new Map();
  for (const product of products) {
    const label = String(getter(product) || '').trim();
    const value = normalizeSearchText(label);
    if (label && value && !values.has(value)) values.set(value, label);
  }
  return [...values.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label, 'es'));
}

// Productos filtrados por categoría + búsqueda, ya ordenados.
function getFilteredProducts(state) {
  const query = normalizeSearchText(state.searchQuery);
  const favoriteIds = new Set(getFavoriteProductIds());
  const promoProductIds = activePromotionProductIds(state);
  const filters = { ...defaultCatalogFilters(), ...(state.catalogFilters || {}) };
  const filtered = unitStorefrontProducts(state).filter((product) => {
    const matchesCategory = state.activeCategory === 'favorites'
      ? favoriteIds.has(product.id)
      : state.activeCategory === 'promos'
        ? isPromotionalProduct(product, promoProductIds)
        : state.activeCategory === 'popular'
          ? isPopularProduct(product)
          : state.activeCategory === 'fernet'
            ? isFernetProduct(product)
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
    const searchableText = normalizeSearchText(searchable);
    const matchesQuery = !query || query.split(' ').every((term) => searchableText.includes(term));
    const isAvailable = product.available && Number(product.stock) > 0 && !product.pricePending;
    const matchesFilters = (
      (filters.brand === 'all' || normalizeSearchText(product.brand) === filters.brand)
      && (filters.capacity === 'all' || normalizeSearchText(product.capacity) === filters.capacity)
      && (filters.presentation === 'all' || normalizeSearchText(product.packageType) === filters.presentation)
      && (filters.pack === 'all' || (filters.pack === 'pack' ? Number(product.unitsPerPack) > 1 : Number(product.unitsPerPack) === 1))
      && (filters.alcohol === 'all' || (filters.alcohol === 'with' ? product.alcoholic : !product.alcoholic))
      && (filters.availability === 'all' || (filters.availability === 'available' ? isAvailable : !isAvailable))
      && (filters.price === 'all' || (filters.price === 'pending' ? product.pricePending : !product.pricePending))
      && (filters.promotion === 'all' || isPromotionalProduct(product, promoProductIds))
    );
    return matchesCategory && matchesQuery && matchesFilters;
  });
  return sortProducts(filtered, state.sortBy);
}

function normalizeSearchText(value) {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.,]+/g, ' ');
  const millilitres = normalized.replace(/(\d+(?:[.,]\d+)?)\s*l\b/g, (_, value) => (
    `${Math.round(Number(String(value).replace(',', '.')) * 1000)}ml`
  ));
  return millilitres.replace(/(\d+)\s*ml\b/g, '$1ml').replace(/\s+/g, ' ').trim();
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

  if (promotionalProducts().length) remote.set('promos', 'Promociones');
  if (popularProducts().length) remote.set('popular', 'Destacados');

  const preferredOrder = [
    'promos',
    'popular',
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
  const promoProductIds = activePromotionProductIds(state);
  const offers = searching ? [] : unitStorefrontProducts(state)
    .filter((product) => {
      const inCategory = state.activeCategory === 'all'
        || (state.activeCategory === 'promos'
          ? isPromotionalProduct(product, promoProductIds)
          : state.activeCategory === 'popular'
            ? isPopularProduct(product)
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
  const state = getState();
  const query = state.searchQuery.trim();
  // Con búsqueda activa el título es "Resultados": la consulta vive en el
  // input y, sólo si no hay coincidencias, en el mensaje vacío. No se repite
  // como chip ni como encabezado entre comillas.
  setText('[data-catalog-title]', query ? 'Resultados' : activeCategoryName());
  const count = getFilteredProducts(state).length;
  const catalogLoading = isProductionCatalogLoading();
  // El contador lleva el contexto del filtro: "0 productos en Gaseosas" dice
  // por qué está vacío; "0 productos" a secas, no.
  const context = state.activeCategory === 'all' ? '' : ` en ${activeCategoryName()}`;
  setText(
    '[data-catalog-count]',
    catalogLoading
      ? 'Cargando catálogo…'
      : `${count === 1 ? '1 producto' : `${count} productos`}${context}`,
  );
  // Con 0 resultados el control de orden no tiene nada que ordenar: se retira
  // del árbol de accesibilidad en lugar de quedar inerte.
  const sortField = $('[data-sort-field]');
  if (sortField) sortField.hidden = !catalogLoading && count === 0;
  const select = $('[data-sort-select]');
  if (select && select.value !== state.sortBy) select.value = state.sortBy;
}

function isProductionCatalogLoading() {
  if (!isProductionMode()) return false;
  const state = getOrderRepository()?.getCatalogStatus?.()?.state || 'idle';
  return state === 'idle' || state === 'loading';
}

function renderSearchControls() {
  const query = getState().searchQuery;
  $$('[data-search-input]').forEach((input) => {
    if (input.value !== query) input.value = query;
  });
  // El botón de limpiar sólo existe con contenido: 44×44 y accesible por
  // nombre. No hay control inerte esperando en el campo vacío.
  $$('.search-clear').forEach((button) => {
    button.hidden = !query.trim();
  });
}

function renderProducts() {
  const container = $('[data-product-grid]');
  if (!container) return;

  const state = getState();
  const filteredProducts = getFilteredProducts(state);

  if (!filteredProducts.length) {
    if (isProductionCatalogLoading()) {
      container.innerHTML = `
        <div class="empty-state" data-catalog-loading role="status" aria-live="polite">
          <strong>Cargando catálogo…</strong>
          <p class="empty-state-copy">Estamos buscando los productos disponibles.</p>
        </div>`;
      return;
    }
    const isFavorites = state.activeCategory === 'favorites';
    const query = state.searchQuery.trim();
    const isSearch = Boolean(query);
    const narrowed = state.activeCategory !== 'all';
    // El estado vacío nombra la causa concreta —la consulta— y su acción
    // primaria la deshace. Es el único lugar, junto al input, donde la
    // consulta se repite.
    const emptyTitle = isFavorites && !isSearch
      ? 'Todavía no guardaste favoritos.'
      : isSearch
        ? `No encontramos «${escapeHtml(query)}»`
        : 'No hay productos disponibles en esta categoría.';
    const emptyCopy = isFavorites && !isSearch
      ? 'Tocá Guardar en un producto para encontrarlo acá.'
      : isSearch
        ? 'Probá con la marca o la presentación.'
        : 'Volvé a ver el catálogo completo o elegí otra categoría.';
    container.innerHTML = `
      <div class="empty-state">
        <strong>${emptyTitle}</strong>
        <p class="empty-state-copy">${emptyCopy}</p>
        <div class="empty-actions">
          ${isSearch ? '<button class="primary-button compact" type="button" data-clear-search>Limpiar búsqueda</button>' : ''}
          ${isSearch && narrowed ? '<button class="secondary-button compact" type="button" data-search-everywhere>Buscar en todo</button>' : ''}
          <button class="secondary-button compact" type="button" data-clear-catalog-filters>Ver todo el catálogo</button>
        </div>
      </div>`;
    return;
  }

  const cartQuantities = new Map(getCartItems().map((item) => [item.productId, item.quantity]));

  container.innerHTML = filteredProducts.map((product) => {
    const outOfStock = product.stock <= 0 || !product.available || product.pricePending;
    const offer = discountPercent(product) > 0;
    const inCart = cartQuantities.get(product.id) || 0;
    const favorite = isFavoriteProduct(product.id);
    const rawPresentation = product.presentation || product.variant || product.unitLabel || product.packageType || '';
    const compactPresentation = normalizeSearchText(rawPresentation).replace(/\bpack\b/g, '').trim();
    const presentation = compactPresentation && normalizeSearchText(product.name).includes(compactPresentation)
      ? ''
      : rawPresentation;
    const control = quickAddControl(product, inCart);
    return `
      <article class="product-card ${outOfStock ? 'out-of-stock' : ''} ${offer ? 'is-offer' : ''} ${inCart > 0 ? 'in-cart' : ''}">
        <div class="product-media-frame">
          <button class="product-media" type="button" data-product-detail="${product.id}" aria-label="Ver ${escapeHtml(product.name)}">
            ${productThumb(product, 'grid')}
            <span class="product-stock-tag">${stockPill(product)}</span>
          </button>
          <button class="product-favorite ${favorite ? 'is-favorite' : ''}" type="button" data-favorite-toggle="${product.id}" aria-label="${favorite ? 'Quitar' : 'Guardar'} ${escapeHtml(product.name)} de favoritos" aria-pressed="${favorite}">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 20.2s-7.1-4.5-7.1-10.1A4.1 4.1 0 0 1 12 7.3a4.1 4.1 0 0 1 7.1 2.8c0 5.6-7.1 10.1-7.1 10.1Z" fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
          </button>
        </div>
        <div class="product-body">
          ${product.brand ? `<span class="product-brand">${escapeHtml(product.brand)}</span>` : ''}
          <h3>${escapeHtml(product.name)}</h3>
          <p>${escapeHtml(presentation)}</p>
          ${product.pricePending || !cardAvailabilityLabel(product) ? '' : `<small class="product-availability ${outOfStock ? 'is-unavailable' : ''}">${escapeHtml(cardAvailabilityLabel(product))}</small>`}
          <div class="product-foot">
            ${priceBlock(product)}
            <div class="product-action">${control}</div>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

// Pill de disponibilidad: sólo aparece cuando hay algo que avisar (agotado,
// pausado, últimas unidades). Lo normal —estar disponible— no se etiqueta.
export function stockPill(product) {
  if (product.pricePending) return '';
  if (product.archived) return '<span class="stock-pill empty">Archivado</span>';
  if (!product.available) return '<span class="stock-pill empty">No disponible</span>';
  if (product.stock <= 0) return '<span class="stock-pill empty">Agotado</span>';
  if (product.stock <= 4) return `<span class="stock-pill low">Últimas ${product.stock}</span>`;
  return '';
}

// Texto plano de disponibilidad para el detalle del producto.
export function availabilityLabel(product) {
  if (product.pricePending) return `${PRICE_PENDING_TITLE}; ${PRICE_PENDING_DETAIL.toLowerCase()}`;
  if (product.archived || !product.available) return 'No disponible por ahora';
  if (product.stock <= 0) return 'Agotado';
  if (product.stock <= 4) return `Últimas ${product.stock}`;
  return 'Disponible';
}

// En la tarjeta sólo se rotula lo que hay que avisar. Estar disponible es lo
// normal: etiquetarlo llena la grilla de cintas y no aporta información.
function cardAvailabilityLabel(product) {
  if (product.pricePending) return '';
  if (product.archived || !product.available) return 'No disponible';
  if (product.stock <= 0) return 'Agotado';
  if (product.stock <= 4) return `Últimas ${product.stock}`;
  return '';
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
  const control = label.closest('[data-home-address]');
  if (street) {
    const neighborhood = remembered?.customerNeighborhood?.trim();
    label.textContent = neighborhood ? `${street} · ${neighborhood}` : street;
    control?.classList.remove('is-missing');
  } else {
    // Sin dirección el valor pasa a tono de advertencia y nombra la acción.
    label.textContent = 'Elegí tu dirección';
    control?.classList.add('is-missing');
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
  renderMinimumOrderProgress();
  renderCartRecommendations();
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
  const wasHidden = form?.hidden === true;
  if (form) {
    form.hidden = isEmpty;
    if (wasHidden && !isEmpty) {
      window.dispatchEvent(new CustomEvent('taba:checkout-session-started'));
    }
  }
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
  const floatingText = `Ver carrito · ${money(subtotalSummary.total)}`;
  setText('[data-cart-count]', String(summary.count));
  setText('[data-cart-count-mobile]', String(summary.count));
  setText('[data-cart-total-small]', summary.count > 0 ? money(subtotalSummary.subtotal) : money(0));
  setText('[data-floating-cart-summary]', money(subtotalSummary.total));
  setText('[data-floating-cart-label]', 'Ver carrito');
  setText('[data-floating-cart-count]', summary.count === 1 ? '1 producto' : `${summary.count} productos`);
  setText('[data-floating-cart-saving]', `Ahorrás ${money(subtotalSummary.discountTotal)}`);
  setText('[data-floating-cart-original]', money(subtotalSummary.subtotal));
  $$('[data-floating-cart-saving]').forEach((node) => {
    node.hidden = subtotalSummary.discountTotal <= 0;
  });
  $$('[data-floating-cart-original]').forEach((node) => {
    node.hidden = subtotalSummary.discountTotal <= 0;
  });
  $$('[data-cart-count], [data-cart-count-mobile]').forEach((node) => {
    node.classList.toggle('is-empty', summary.count === 0);
  });
  $$('[data-floating-cart]').forEach((node) => {
    node.classList.toggle('hidden', summary.count === 0 || !floatingAllowed);
    node.setAttribute('aria-label', summary.count > 0 ? `${floatingText}. Ver pedido.` : 'Carrito vacío');
  });
  // Entrada única de la reserva inferior: la barra de carrito existe sólo con
  // productos, y sólo entonces el contenido reserva su altura. El token
  // derivado vive en `body` (styles/tokens.css) para que resuelva con este
  // valor y no con el de `:root`.
  document.body.dataset.cart = summary.count > 0 && floatingAllowed ? 'filled' : 'empty';
}

function renderMinimumOrderProgress() {
  const container = $('[data-cart-minimum-progress]');
  if (!container) return;
  const items = getCartItems();
  const config = getBusinessConfig();
  const canShow = items.length > 0
    && currentDeliveryMode() === 'delivery'
    && (isDemoMode() || config.orderingDetailsVerified)
    && Number(config.minDeliveryOrder) > 0;
  if (!canShow) {
    container.innerHTML = '';
    return;
  }

  const summary = getCartSummary('delivery');
  const { minimum, missing, progress } = getDeliveryMinimumProgress(summary.subtotal, config.minDeliveryOrder);
  container.innerHTML = `
    <aside class="minimum-order-progress ${missing === 0 ? 'is-complete' : ''}" aria-live="polite">
      <div>
        <strong>${missing === 0 ? 'Ya alcanzaste el pedido mínimo' : `Te faltan ${money(missing)} para llegar al mínimo`}</strong>
        <small>El mínimo de delivery es ${money(minimum)}. El costo de envío se informa por separado.</small>
      </div>
      <span class="minimum-order-track" aria-hidden="true"><span style="width:${progress}%"></span></span>
    </aside>`;
}

function recommendationCard(product) {
  return `
    <article class="recommendation-card">
      <button class="recommendation-media" type="button" data-product-detail="${escapeHtml(product.id)}" aria-label="Ver ${escapeHtml(product.name)}">
        ${productThumb(product, 'rail')}
      </button>
      <div class="recommendation-copy">
        <strong>${escapeHtml(product.name)}</strong>
        <small>${escapeHtml(unitText(product))}</small>
        <span>${money(productPricePresentation(product).price)}</span>
      </div>
      <div class="recommendation-control">${quickAddControl(product, 0, { className: 'recommendation-add' })}</div>
    </article>`;
}

function renderCartRecommendations() {
  const container = $('[data-cart-recommendations]');
  if (!container) return;
  const state = getState();
  const recommendation = getCartRecommendations({
    products: state.products,
    cart: state.cart,
    maxItems: 6,
  });
  container.hidden = recommendation.products.length === 0;
  container.innerHTML = recommendation.products.length ? `
    <div class="cart-recommendations-heading">
      <div><p>RECOMENDADOS PARA VOS</p><h3 id="cart-recommendations-title">${escapeHtml(recommendation.title)}</h3></div>
      <small>${escapeHtml(recommendation.copy)}</small>
    </div>
    <div class="recommendations-rail" aria-label="Productos sugeridos">
      ${recommendation.products.map(recommendationCard).join('')}
    </div>` : '';
}

export function shouldShowCheckoutSuggestions() {
  const state = getState();
  return cartNeedsComplementPrompt({ products: state.products, cart: state.cart });
}

export function showCheckoutSuggestions() {
  const modal = $('[data-checkout-suggestions-modal]');
  const content = $('[data-checkout-suggestions-content]');
  const state = getState();
  const recommendation = getCartRecommendations({ products: state.products, cart: state.cart, maxItems: 4 });
  if (!modal || !content || !recommendation.products.length) return false;
  content.innerHTML = `
    <div class="checkout-suggestions-card" role="document">
      <button class="modal-close" type="button" data-checkout-suggestions-dismiss aria-label="Cerrar sugerencias">×</button>
      <p class="eyebrow">ANTES DE PAGAR</p>
      <h2 id="checkout-suggestions-title">${escapeHtml(recommendation.title)}</h2>
      <p>${escapeHtml(recommendation.copy)}</p>
      <div class="checkout-suggestions-list">
        ${recommendation.products.map(recommendationCard).join('')}
      </div>
      <button class="secondary-button checkout-suggestions-continue" type="button" data-checkout-suggestions-dismiss>Continuar sin agregar</button>
    </div>`;
  if (!modal.open) modal.showModal();
  return true;
}

export function closeCheckoutSuggestions() {
  const modal = $('[data-checkout-suggestions-modal]');
  if (modal?.open) modal.close();
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
        ${quantityControl(item.product, item.quantity, { className: 'quantity-control' })}
        <div class="cart-line">${money(item.product.price * item.quantity)}</div>
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

export function setMercadoPagoCheckoutAvailability({ available = false } = {}) {
  const field = $('[name="paymentMethod"]');
  if (!field) return;
  const enabled = available === true;
  let option = field.querySelector('option[value="mercadopago"]');
  if (enabled && !option) {
    option = document.createElement('option');
    option.value = 'mercadopago';
    option.textContent = 'Mercado Pago — Tarjeta, débito o dinero en cuenta';
    field.append(option);
  }
  if (!enabled && option) {
    if (field.value === 'mercadopago') field.value = 'coordinate';
    option.remove();
  }
  field.dataset.mercadopagoAvailable = String(enabled);
}

function currentCouponCode() {
  const field = $('[name="couponCode"]');
  return field?.value || '';
}

function renderCheckoutPaymentFields() {
  const paymentMethod = currentPaymentMethod();
  const isCash = paymentMethod === 'cash';
  const isMercadoPago = paymentMethod === 'mercadopago';
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
  note.textContent = isMercadoPago
    ? 'Vas a pagar en el entorno seguro de Mercado Pago. No guardamos datos de tu tarjeta.'
    : 'El pago se coordina con el local antes de preparar el pedido.';

  const submit = $('[data-checkout-submit]');
  if (submit && !submit.disabled) {
    submit.textContent = isMercadoPago ? 'Pagar con Mercado Pago' : 'Confirmar pedido';
  }
  const modeNote = $('[data-checkout-mode-note]');
  if (modeNote && isMercadoPago) {
    modeNote.textContent = 'Serás redirigido a Mercado Pago y confirmaremos el pedido sólo después de verificar el pago.';
  }
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
  const manualStreet = splitStreetAndNumber(addressDetails.streetLine);
  return {
    customerName: String(formData.get('customerName') || ''),
    customerPhone: String(formData.get('customerPhone') || ''),
    customerStreetAddress: addressDetails.streetLine,
    customerNeighborhood: addressDetails.neighborhood,
    customerReference: addressDetails.reference,
    customerAddress: addressDetails.label,
    addressDetails,
    customerAddressId: String(formData.get('customerAddressId') || ''),
    customerAddressLabel: String(formData.get('customerAddressLabel') || ''),
    deliveryStreet: String(formData.get('deliveryStreet') || manualStreet.street),
    deliveryStreetNumber: String(formData.get('deliveryStreetNumber') || manualStreet.streetNumber),
    deliveryFloor: String(formData.get('deliveryFloor') || ''),
    deliveryApartment: String(formData.get('deliveryApartment') || ''),
    deliveryCity: String(formData.get('deliveryCity') || addressDetails.neighborhood),
    deliveryProvince: String(formData.get('deliveryProvince') || ''),
    deliveryPostalCode: String(formData.get('deliveryPostalCode') || ''),
    deliveryLatitude: optionalNumber(formData.get('deliveryLatitude')),
    deliveryLongitude: optionalNumber(formData.get('deliveryLongitude')),
    deliveryGeolocationAccuracy: optionalNumber(formData.get('deliveryGeolocationAccuracy')),
    deliveryAddressSource: String(formData.get('deliveryAddressSource') || 'manual'),
    deliveryMode: String(formData.get('deliveryMode') || 'delivery'),
    paymentMethod: String(formData.get('paymentMethod') || 'cash'),
    customerNotes: String(formData.get('customerNotes') || ''),
    cashChange: String(formData.get('cashChange') || ''),
    couponCode: String(formData.get('couponCode') || ''),
    rememberCustomer: formData.get('rememberCustomer') === 'on',
    ageConfirmed: formData.get('ageConfirmed') === 'on',
  };
}

function optionalNumber(value) {
  if (value == null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function splitStreetAndNumber(value) {
  const clean = String(value || '').trim();
  const match = clean.match(/^(.*\D)\s+(\d+[A-Za-z]?(?:[/-]\d+[A-Za-z]?)?)$/);
  if (!match) return { street: clean, streetNumber: '' };
  return { street: match[1].trim(), streetNumber: match[2].trim() };
}

export function updateAddressFieldVisibility() {
  const field = $('[data-address-field]');
  if (!field) return;
  const isPickup = currentDeliveryMode() === 'pickup';
  // The address contract is rendered inside this legacy wrapper. Its inputs
  // are hidden fields, but the Profile-owned checkout surface must remain
  // visible for pickup so the user can see why no address is needed.
  field.hidden = false;
  field.classList.remove('hidden');
  const title = $('[data-checkout-details-title]');
  if (title) title.textContent = isPickup ? 'Datos para retirar' : 'Datos de entrega';
}

// ===== Seguimiento del pedido (vista cliente) =====
// El cliente ve cuatro etapas comerciales; los estados internos siguen
// disponibles en Negocio/Rider, pero no se filtran a esta superficie.
const TRUSTED_TRACKING_ETA_SOURCES = new Set(['business', 'routing']);
const TRUSTED_TRACKING_ETA_MAX_AGE_MS = 15 * 60 * 1000;

function getOrderSimulation(order) {
  const sim = getState().simulation;
  return sim && sim.orderId === order.id ? sim : null;
}

export function trustedTrackingEtaMinutes(
  order,
  riderLocation,
  { now = Date.now() } = {},
) {
  if (
    !['picked_up', 'on_the_way'].includes(order?.status)
    || trackingLocationFreshness(riderLocation, { now }) !== 'fresh'
  ) {
    return null;
  }
  const delivery = order?.delivery;
  const source = String(delivery?.etaSource || '').trim().toLowerCase();
  if (!TRUSTED_TRACKING_ETA_SOURCES.has(source)) return null;

  const calculatedAt = Date.parse(delivery?.etaCalculatedAt || '');
  const arrivalAt = Date.parse(delivery?.etaExpiresAt || '');
  if (!Number.isFinite(calculatedAt) || !Number.isFinite(arrivalAt)) return null;
  if (
    calculatedAt > now + 10_000
    || now - calculatedAt > TRUSTED_TRACKING_ETA_MAX_AGE_MS
    || arrivalAt <= now
  ) {
    return null;
  }

  const minutes = Math.ceil((arrivalAt - now) / 60_000);
  return Number.isFinite(minutes) && minutes >= 1 && minutes <= 1440 ? minutes : null;
}

function trackingHeadline(order, { riderLocation = null, locationFreshness = 'none' } = {}) {
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
    const etaMinutes = locationFreshness === 'fresh'
      ? trustedTrackingEtaMinutes(order, riderLocation)
      : null;
    return {
      title: 'Tu pedido está en camino',
      sub: etaMinutes
        ? `Llega en ${etaMinutes} min`
        : 'Calculando llegada',
      etaActive: Boolean(etaMinutes),
      etaMinutes,
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

function realMapShell({
  order = null,
  role = 'tracking',
  mapSource = '',
  freshness = 'none',
}) {
  const orderAttr = order?.id ? ` data-order-id="${escapeHtml(order.id)}"` : '';
  const sourceAttr = mapSource ? ` data-map-source="${escapeHtml(mapSource)}"` : '';
  return `
    <div class="real-map-shell" data-real-map data-map-role="${escapeHtml(role)}" data-map-freshness="${escapeHtml(freshness)}"${sourceAttr}${orderAttr}>
      <div class="real-map-canvas" data-map-canvas role="region" aria-label="Mapa de seguimiento de tu pedido"></div>
      <div class="real-map-fallback" data-map-fallback role="status" aria-live="polite">
        <p class="map-fallback-note">Mapa no disponible. Seguimos actualizando el estado de tu pedido.</p>
      </div>
      <span class="real-map-tile-error" data-map-tile-error hidden>Mapa base no disponible</span>
      <div class="real-map-meta" data-map-meta role="status" aria-live="polite">
        <span class="real-map-meta-indicator" data-map-meta-indicator aria-hidden="true">
          <span class="real-map-live-dot" data-map-live-dot></span>
          <svg data-map-clock-icon viewBox="0 0 24 24" focusable="false">
            <circle cx="12" cy="12" r="8.25" fill="none" stroke="currentColor" stroke-width="1.75"></circle>
            <path d="M12 7.5v4.9l3.1 1.8" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        </span>
        <span data-map-meta-text>Última ubicación</span>
      </div>
    </div>`;
}

// En producción el mapa del cliente sólo se renderiza con GPS real. La vista
// sandbox usa su escenario geográfico aislado y mantiene la misma shell de mapa.
function sandboxTrackingStage(order, simulation) {
  const presentation = sandboxTrackingPresentation(order, simulation);
  return `
    <div class="delivery-map-stage tracking-map-stage sandbox-tracking-stage" data-map-shell="tracking" data-sandbox-tracking>
      ${realMapShell({
        order,
        role: 'tracking',
        mapSource: 'sandbox',
      })}
      ${presentation.showEta ? `<span class="tracking-map-eta" data-sandbox-eta>${escapeHtml(presentation.etaLabel)}</span>` : ''}
      ${trackingRecenterButton()}
    </div>`;
}

function trackingMapStage({ order = null, sandbox = false, freshness = 'none' }) {
  return `
    <div class="delivery-map-stage tracking-map-stage" data-map-shell="tracking" data-tracking-map-freshness="${escapeHtml(freshness)}">
      ${realMapShell({
        order,
        role: 'tracking',
        mapSource: sandbox ? 'sandbox' : '',
        freshness,
      })}
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
      ? 'En camino'
      : pending.title;
  const sub = arrived
    ? 'Prepará el código de entrega'
    : freshness === 'lost'
      ? 'La ubicación no está disponible por el momento.'
      : ['on_the_way', 'picked_up'].includes(order.status)
        ? 'Tu pedido va con él'
        : pending.sub;
  const contact = assigned
    ? trackingContactButton({ accessibleLabel: 'Contactar al local por este pedido' })
    : '';
  return `
    <section class="tracking-rider-card ${live ? 'is-live' : ''}" data-tracking-rider-card data-rider-assigned="${assigned}" data-rider-freshness="${escapeHtml(freshness)}" aria-label="Estado del rider">
      <span class="tracking-rider-icon">${riderAvatarHelmetSvg({
        className: 'tracking-rider-helmet',
        decorative: true,
      })}</span>
      <div class="tracking-rider-copy">
        <small>${assigned ? 'Rider TABA2' : 'Entrega TABA2'}</small>
        <strong data-rider-status>${escapeHtml(title)}</strong>
        <span data-rider-message>${escapeHtml(sub)}</span>
      </div>
      ${contact ? `<div class="tracking-rider-contact">${contact}</div>` : ''}
    </section>`;
}

function hasVerifiedLiveRiderLocation(location) {
  return hasLiveRiderLocation(location)
    && Number.isFinite(Number(location?.accuracy));
}

function riderPendingCopy(status, assigned = false) {
  if (['ready', 'assigned'].includes(status) && assigned) {
    return { title: 'Rider asignado', sub: 'El pedido está listo para que salga del local.' };
  }
  if (status === 'ready') {
    return { title: 'Esperando repartidor', sub: 'Tu pedido está listo para salir.' };
  }
  if (status === 'preparing') {
    return assigned
      ? { title: 'Rider asignado', sub: 'Estamos preparando tu pedido para la entrega.' }
      : { title: 'Repartidor aún no asignado', sub: 'Lo asignaremos cuando el pedido esté listo.' };
  }
  return assigned
    ? { title: 'Rider asignado', sub: 'Te avisaremos cuando salga del local.' }
    : { title: 'Repartidor aún no asignado', sub: 'Te avisaremos cuando sea asignado.' };
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
  const accessibleCode = deliveryCode.code.split('').join(' ');
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
        <strong data-delivery-code="${escapeHtml(deliveryCode.code)}" aria-label="Código de entrega: ${escapeHtml(accessibleCode)}">${escapeHtml(formatDeliveryCode(deliveryCode.code))}</strong>
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
  const thumbnails = order.status === 'arriving' ? '' : trackingOrderThumbnails(items);
  return `
    <details class="tracking-order-summary tracking-order-detail order-detail" data-order-summary-details>
      <summary>
        <span class="tracking-summary-content">
          <span class="tracking-summary-copy">
            <strong title="Pedido ${escapeHtml(order?.id || '')}">Pedido ${escapeHtml(order?.id || '')}</strong>
            ${meta ? `<small>${escapeHtml(meta)}</small>` : ''}
          </span>
          <span class="tracking-summary-action">
            Ver detalles
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="m7.5 4.5 5 5.5-5 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>
          </span>
        </span>
        ${thumbnails}
      </summary>
      <div class="order-detail-body">
        ${detailRows || '<p>No hay detalles adicionales disponibles.</p>'}
      </div>
    </details>`;
}

function trackingOrderThumbnails(items) {
  const candidates = items.map((item) => {
    const product = getProductById(item?.productId);
    if (!hasAuthoritativeTrackingThumbnail(product)) return null;
    return {
      name: product.name || item?.name || 'Bebida',
      thumbnail: product.imageThumbnail || product.thumbnail,
    };
  }).filter(Boolean);
  if (!candidates.length) return '';

  const visible = candidates.slice(0, 3);
  const remaining = Math.max(0, items.length - visible.length);
  return `
    <span class="tracking-summary-thumbnails" data-order-summary-thumbnails aria-label="Productos del pedido">
      ${visible.map((product) => `
        <span class="tracking-summary-thumbnail" data-order-summary-thumbnail>
          <img src="${escapeHtml(product.thumbnail)}" alt="${escapeHtml(product.name)}" width="52" height="52" loading="lazy" decoding="async" />
        </span>`).join('')}
      ${remaining > 0 ? `<span class="tracking-summary-thumbnail-more" data-order-summary-thumbnail-more aria-label="${remaining} productos más">+${remaining}</span>` : ''}
    </span>`;
}

function hasAuthoritativeTrackingThumbnail(product) {
  if (!product || typeof product !== 'object') return false;
  const thumbnail = String(product.imageThumbnail || product.thumbnail || '').trim();
  const image = String(product.image || '').trim();
  const hasAuthoritativeHashes = [
    product.imageSha256,
    product.imageThumbnailSha256,
    product.sourceImageSha256,
  ].every((hash) => /^[a-f0-9]{64}$/i.test(String(hash || '')));
  return Boolean(
    image
    && thumbnail
    && (!product.qaFixture || product.previewCatalogApproved === true)
    && product.imageShowsMultipack !== true
    && hasAuthoritativeHashes
  );
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
  if (isShowcaseMode()) {
    return `<button class="${escapeHtml(className)}" type="button" disabled data-showcase-contact-disabled aria-label="Contacto externo desactivado en demostración">Contacto desactivado</button>`;
  }
  const config = getBusinessConfig();
  const phone = String(config.whatsappNumber || '').replace(/\D/g, '');
  if (config.whatsappVerified !== true || phone.length < 8 || phone.length > 15) return '';
  return `<a class="${escapeHtml(className)}" data-contact-authority="verified-business" href="https://wa.me/${phone}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(accessibleLabel)}">${escapeHtml(text)}</a>`;
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
      <!-- El seguimiento es una superficie del CLIENTE: dice el nombre del
           local, no el de la plataforma. Antes estaba escrito a mano y quedaba
           desalineado con el resto de la app cuando el comercio se renombraba. -->
      <strong data-business-name>${escapeHtml(getBusinessConfig().businessName)}</strong>
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
      <div class="track-layout tracking-premium tracking-map-experience is-empty no-map" data-tracking-status="empty">
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
  const riderLocation = chooseRiderLocation(getOrderSimulation(order), order.tracking?.lastLocation);
  const locationFreshness = trackingLocationFreshness(riderLocation);
  const head = trackingHeadline(order, {
    riderLocation,
    locationFreshness,
  });
  const trackableStatus = ['picked_up', 'on_the_way', 'arrived', 'arriving'].includes(order.status);
  const sandboxSimulation = getOrderSimulation(order);
  const sandboxPresentation = sandboxTrackingPresentation(order, sandboxSimulation);
  const sandboxMapActive = isSandboxOrderRepository(getOrderRepository())
    && trackableStatus
    && ((sandboxSimulation?.source === 'simulation' && sandboxSimulation?.userStarted === true)
      || (sandboxSimulation?.source === 'gps' && hasFreshSharedGpsLocation(sandboxSimulation)));
  const hasUsableLastLocation = trackableStatus
    && ['fresh', 'delayed', 'lost'].includes(locationFreshness);
  const showMap = isDelivery
    && !['delivered', 'cancelled'].includes(order.status)
    && (hasUsableLastLocation || sandboxMapActive);
  const latestUpdate = latestTrackingTimestamp(order, riderLocation);
  const timelineStatus = order.status === 'arriving' ? 'arrived' : order.status;
  const showRiderCard = isDelivery
    && !isCancelled
    && order.status !== 'delivered';
  renderWithStableRealMap(container, `
    <div class="track-layout tracking-premium tracking-map-experience status-${escapeHtml(order.status)} ${showMap ? '' : 'no-map'}" data-tracking-status="${escapeHtml(order.status)}" data-tracking-freshness="${escapeHtml(locationFreshness)}">
      <section class="delivery-bottom-sheet tracking-sheet track-progress-card ${showMap ? 'is-live' : 'is-offline'}" data-bottom-sheet>
        ${trackingHeader()}
        <div class="tracking-hero" data-tracking-hero>
          <h1 data-tracking-title>${escapeHtml(head.title)}</h1>
          <p class="tracking-subtitle ${head.etaActive ? 'is-active-eta' : ''}" data-tracking-arrival data-eta-active="${Boolean(head.etaActive)}">${head.etaActive
            ? `Llega en <strong>${escapeHtml(head.etaMinutes)} min</strong>`
            : escapeHtml(head.sub)}</p>
          <p class="tracking-updated" data-tracking-updated>Última actualización ${escapeHtml(relativeAgeLabel(latestUpdate))}</p>
        </div>
        ${renderPublicOrderTimeline(timelineStatus, { className: 'customer-progress' })}
        ${showMap
          ? (sandboxMapActive
            ? sandboxTrackingStage(order, sandboxSimulation)
            : trackingMapStage({ order, freshness: locationFreshness }))
          : trackingWaitingStage(order, locationFreshness)}
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
  const status = getRealtimeStatus();
  if (!status.relayEnabled) return '';
  if (!order || order.status === 'delivered' || order.status === 'cancelled') return '';
  const label = relayStatusLabel(status);
  const tone = status.relayState === 'connected' && !status.pendingSnapshot ? 'live' : 'warn';
  const time = formatRealtimeTime(status.lastSyncAt);
  const chip = `<button class="rt-chip ${tone}" type="button" data-retry-relay data-realtime-sync="client">${escapeHtml(label)}${time ? ` · ${escapeHtml(time)}` : ''}</button>`;
  return `<span class="sheet-connection-pill">${chip}</span>`;
}

// Indicador de conexión realtime (en vivo entre equipos / en este equipo).
function realtimeChip(order = null) {
  if (order?.status === 'delivered') {
    return '<span class="rt-chip done">Finalizado</span>';
  }
  const status = getRealtimeStatus();
  if (status.relayEnabled) {
    const label = relayStatusLabel(status);
    const tone = status.relayState === 'connected' && !status.pendingSnapshot ? 'live' : 'warn';
    const time = formatRealtimeTime(status.lastSyncAt);
    return `<button class="rt-chip ${tone}" type="button" data-retry-relay data-realtime-sync="client">${escapeHtml(label)}${time ? ` · ${escapeHtml(time)}` : ''}</button>`;
  }
  return '<span class="rt-chip local">En vivo</span>';
}

function formatRealtimeTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
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

function actualProductVariants(product) {
  const rawVariants = Array.isArray(product?.variants) ? product.variants : [];
  const ids = [product?.id, ...rawVariants.map((variant) => (
    typeof variant === 'string' ? variant : variant?.id
  ))].filter(Boolean);
  return [...new Set(ids)]
    .map((id) => getProductById(id))
    .filter((candidate) => candidate && isProductVisibleToCustomer(candidate));
}

let productModalRestoreFocus = null;
let productModalRestoreProductId = '';
let productModalCloseBound = false;
let productModalDocumentBound = false;

function restoreProductModalFocus() {
  const trigger = productModalRestoreFocus?.isConnected
    ? productModalRestoreFocus
    : [...document.querySelectorAll('[data-product-detail]')]
      .find((node) => node.dataset.productDetail === productModalRestoreProductId);
  productModalRestoreFocus = null;
  productModalRestoreProductId = '';
  if (!trigger?.isConnected || trigger.disabled) return;
  // Safari puede ejecutar el cierre nativo del dialog después del handler de
  // click; esperar un frame evita perder el foco restaurado al body.
  setTimeout(() => requestAnimationFrame(() => trigger.focus({ preventScroll: true })), 0);
}

export function showProductModal(productId, restoreTrigger = null) {
  const product = getProductById(productId);
  const modal = $('[data-product-modal]');
  const content = $('[data-modal-content]');
  if (!product || !isProductVisibleToCustomer(product) || !modal || !content) return;
  if (!productModalCloseBound) {
    modal.addEventListener('close', restoreProductModalFocus);
    modal.addEventListener('click', (event) => {
      if (event.target?.closest?.('[data-close-modal]')) restoreProductModalFocus();
    });
    productModalCloseBound = true;
  }
  if (!productModalDocumentBound) {
    document.addEventListener('click', (event) => {
      if (event.target?.closest?.('[data-close-modal]')) restoreProductModalFocus();
    }, true);
    productModalDocumentBound = true;
  }
  if (!modal.open) {
    const active = restoreTrigger || document.activeElement;
    productModalRestoreFocus = active && active !== document.body && typeof active.focus === 'function'
      ? active
      : null;
    productModalRestoreProductId = product.id;
  }

  const pricing = productPricePresentation(product);
  const favorite = isFavoriteProduct(product.id);
  const variants = actualProductVariants(product);
  const cartQuantity = getCartItems()
    .find((item) => item.productId === product.id)?.quantity || 0;
  const modalQuantityControl = cartQuantity > 0
    ? quantityControl(product, cartQuantity, { className: 'qty-stepper modal-cart-control' })
    : quickAddControl(product, 0, { className: 'add-button modal-cart-control' });
  const minimumAge = Math.max(18, Number(product.minimumAge || product.minimum_age || 18));
  content.innerHTML = `
    <div class="modal-card" role="document" data-modal-product-id="${escapeHtml(product.id)}">
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
            ${product.pricePending
              ? `<div data-price-pending-message><strong>${PRICE_PENDING_TITLE}</strong><small>${PRICE_PENDING_DETAIL}</small></div>`
              : `${pricing.regularPrice && pricing.regularPrice > pricing.price ? `<s>${money(pricing.regularPrice)}</s>` : ''}<strong>${money(pricing.price)}</strong>${pricing.condition ? `<small>${escapeHtml(pricing.condition)}</small>` : ''}`}
          </div>
          ${product.pricePending ? '' : `<span class="modal-availability ${product.stock <= 0 || !product.available ? 'is-unavailable' : ''}">${escapeHtml(availabilityLabel(product))}</span>`}
        </div>
        ${variants.length > 1 ? `
          <fieldset class="modal-variant-field">
            <legend>Presentación</legend>
            <div class="modal-variant-grid">
              ${variants.map((item) => {
                const itemPricing = productPricePresentation(item);
                const selected = item.id === product.id;
                const unavailable = item.stock <= 0 || !item.available;
                return `<label class="modal-variant-card ${selected ? 'is-selected' : ''} ${unavailable ? 'is-unavailable' : ''}">
                  <input type="radio" name="productVariant" data-product-variant value="${escapeHtml(item.id)}" ${selected ? 'checked' : ''} ${unavailable ? 'disabled' : ''} />
                  <span><strong>${escapeHtml(unitText(item) || item.name)}</strong><small>${escapeHtml(item.name)}</small></span>
                  <b>${money(itemPricing.price)}</b>
                  ${itemPricing.regularPrice && itemPricing.regularPrice > itemPricing.price ? `<s>${money(itemPricing.regularPrice)}</s>` : ''}
                  ${unavailable ? '<em>Sin stock</em>' : ''}
                </label>`;
              }).join('')}
            </div>
          </fieldset>` : ''}
        <div class="modal-order-fields">
          <div class="modal-quantity-field">
            <span>${product.pricePending ? 'Disponibilidad' : 'Cantidad'}</span>
            ${modalQuantityControl}
          </div>
          ${product.pricePending ? '' : `<label class="modal-note-field">
            Observación <span>(opcional)</span>
            <input data-product-note type="text" maxlength="120" placeholder="Ej.: bien fría" />
          </label>`}
        </div>
        ${product.alcoholic ? `<p class="product-alcohol-notice">Venta exclusiva a mayores de ${minimumAge} años.</p>` : ''}
      </div>
      <div class="modal-actions">
        <button class="secondary-button" type="button" data-favorite-toggle="${product.id}" aria-pressed="${favorite}">${favorite ? 'Guardado' : 'Guardar para después'}</button>
      </div>
    </div>
  `;
  if (!modal.open) modal.showModal();
}

export function closeProductModal() {
  const modal = $('[data-product-modal]');
  if (modal?.open) {
    modal.close();
    // WebKit no siempre entrega el evento close antes de devolver el foco al
    // documento; el cierre explícito conserva el mismo fallback accesible.
    restoreProductModalFocus();
  }
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
  showToast.timeoutId = setTimeout(() => toast.classList.add('hidden'), 2200);
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

export function setCatalogFilter(key, value) {
  const current = { ...defaultCatalogFilters(), ...(getState().catalogFilters || {}) };
  if (!Object.hasOwn(current, key)) return;
  const next = { ...current, [key]: String(value || 'all') };
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  setState({ catalogFilters: next });
}

export function resetCatalogFilters() {
  setState({ catalogFilters: defaultCatalogFilters() });
}
