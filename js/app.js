import {
  addToCart,
  clearCart,
  decrementCartItem,
  incrementCartItem,
  removeCartItem,
  repeatCustomerOrder,
} from './cart.js';
import {
  applyBusinessConfig,
  closeProductModal,
  copyDraftOrderToClipboard,
  getCheckoutFormValues,
  renderAdminVisibility,
  renderCart,
  renderCartTotals,
  renderCatalog,
  renderCustomerHome,
  renderHomeActiveOrder,
  renderNavigation,
  renderOrderSummary,
  renderTracking,
  setCategory,
  setSearchQuery,
  setSortBy,
  showProductModal,
  showToast,
  updateAddressFieldVisibility,
  $,
} from './ui.js';
import { buildWhatsAppMessage, buildWhatsAppUrl, buildWhatsAppUrlFromDraft, getActiveOrder, getLastOrder } from './orders.js';
import { getState, subscribe } from './state.js';
import { STORAGE_KEYS } from './config.js';
import { handleBusinessAction, handleBusinessInput, lockAdmin, renderBusinessDashboard, unlockAdmin } from './business.js';
import { handleDeliveryAction, handleDeliveryChange, renderDeliveryPanel } from './delivery.js';
import { disableGpsTracking, handleViewChangeForSimulation, resumeSimulationIfNeeded } from './simulation.js';
import { getRealtimeStatus, initRealtime, onRealtimeStatusChange, retryRelayConnection } from './realtime.js';
import { renderMapViews } from './map/map_view.js';
import { activeTrackingLiveness } from './map/route_geometry.js';
import { getOrderRepository, getRepositoryDiagnostic, startOrderRepositorySync } from './repositories/repository_factory.js';
import { toggleFavoriteProduct } from './core/customer-preferences.js';

const VIEWS = ['home', 'catalog', 'cart', 'tracking', 'business', 'rider', 'profile'];
const RELAY_ROOM_STORAGE_KEY = 'la_taba_rt_room';
const RESET_RELAY_TIMEOUT_MS = 1200;
// Cada cuánto revisamos si el GPS real del pedido activo se enfrió. Es bien por
// debajo del umbral de "stale" (30 s) para volver a un fallback honesto a tiempo.
const FRESHNESS_TICK_MS = 5000;
const VIEW_ALIASES = {
  catalogo: 'catalog',
  catalog: 'catalog',
  inicio: 'home',
  home: 'home',
  carrito: 'cart',
  pedido: 'cart',
  cart: 'cart',
  seguimiento: 'tracking',
  seguir: 'tracking',
  tracking: 'tracking',
  negocio: 'business',
  admin: 'business',
  business: 'business',
  delivery: 'rider',
  repartidor: 'rider',
  rider: 'rider',
  perfil: 'profile',
  local: 'profile',
  profile: 'profile',
};

let activeView = viewFromHash();
let lastLivenessSignature = '';
let freshnessTimer = null;
// Pedido pendiente de confirmación al repetir con carrito no vacío.
let pendingRepeatOrderId = null;

function openRepeatModal(orderId) {
  pendingRepeatOrderId = orderId || null;
  const modal = document.querySelector('[data-repeat-modal]');
  if (modal && typeof modal.showModal === 'function' && !modal.open) modal.showModal();
}

function closeRepeatModal() {
  pendingRepeatOrderId = null;
  const modal = document.querySelector('[data-repeat-modal]');
  if (modal?.open) modal.close();
}

// Limpieza segura de la sesión demo: abrir la app con ?reset=1 (o ?demo-reset=1)
// borra pedidos, carrito y acceso del negocio guardados en este equipo y recarga
// limpio. Pensado para empezar una presentación sin pedidos de prueba viejos.
// No corre en el uso normal (sin el parámetro) ni afecta a otros equipos.
async function maybeResetDemoSession() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('reset') && !params.has('demo-reset')) return false;
    await clearRelayRoomOnReset(params);
    [STORAGE_KEYS.state, STORAGE_KEYS.adminUnlocked, STORAGE_KEYS.customerFavorites, STORAGE_KEYS.customerHistory].forEach((key) => {
      try { window.localStorage?.removeItem(key); } catch (_) { /* sin storage: ignorar */ }
      try { window.sessionStorage?.removeItem(key); } catch (_) { /* sin storage: ignorar */ }
    });
    params.delete('reset');
    params.delete('demo-reset');
    const query = params.toString();
    const cleanUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    // Recarga sin el parámetro para arrancar con el estado por defecto.
    window.location.replace(cleanUrl);
    return true;
  } catch (_) {
    return false;
  }
}

async function clearRelayRoomOnReset(params) {
  const relay = params.get('relay');
  if (!relay || typeof fetch !== 'function') return;
  const room = sanitizeResetRoom(params.get('room') || safeStorageGet(RELAY_ROOM_STORAGE_KEY) || 'demo');
  const base = relay.replace(/\/+$/, '');
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), RESET_RELAY_TIMEOUT_MS)
    : null;
  try {
    await fetch(`${base}/reset?room=${encodeURIComponent(room)}`, {
      method: 'POST',
      keepalive: true,
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch (_) {
    // Si el relay no responde, el reset local igual debe continuar.
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function safeStorageGet(key) {
  try { return window.localStorage?.getItem(key) || ''; } catch (_) { return ''; }
}

function sanitizeResetRoom(value) {
  return String(value || 'demo').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60) || 'demo';
}

async function bootstrap() {
  // Si se pidió limpiar la demo, recargamos limpio y no seguimos inicializando.
  if (await maybeResetDemoSession()) return;
  try {
    applyBusinessConfig();
    bindEvents();
    subscribe(renderAll);
    initRealtime();
    // La conexión con la sala (relay) cambia fuera del flujo de estado: cuando
    // conecta/cae, refrescamos las superficies de seguimiento para que el chip
    // de conexión sea honesto sin esperar otro cambio de pedido.
    onRealtimeStatusChange(renderLiveSurfaces);
    startOrderRepositorySync();
    renderAll();
    playViewEnter(activeView);
    resumeSimulationIfNeeded();
    startFreshnessTick();
    // Aviso discreto si se pidió un backend y la app tuvo que seguir local.
    const diagnostic = getRepositoryDiagnostic();
    if (diagnostic) {
      console.warn(`[La Taba] ${diagnostic.message}`);
      setTimeout(() => showToast('No se pudo conectar al servidor de pedidos. La app sigue funcionando en este equipo.'), 600);
    }
  } catch (error) {
    // Evita pantalla en blanco si algo falla en el primer render.
    showToast('Hubo un problema al iniciar. Recargá la página.');
  }
  registerServiceWorker();
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  throw new Error('clipboard unavailable');
}

function renderAll() {
  renderActiveView();
  renderNavigation(activeView);
  renderAdminVisibility();
  renderCatalog();
  renderHomeActiveOrder();
  renderCustomerHome();
  renderCart();
  renderTracking();
  renderBusinessDashboard();
  renderDeliveryPanel();
  updateAddressFieldVisibility();
  renderMapViews();
  // Un render completo ya refleja la vivacidad actual; mantener la firma en
  // sincronía hace que el tick sólo actúe cuando cambia por el paso del tiempo.
  lastLivenessSignature = trackingLivenessSignature();
}

// Superficies sensibles a la "vivacidad" del GPS y al estado de la conexión. Se
// re-renderan cuando el rider deja de compartir / pierde señal o cuando cae el
// relay, para volver a un fallback honesto (sin mapa ni marker fantasma) y con
// el chip de conexión correcto, sin re-renderizar catálogo/carrito.
function renderLiveSurfaces() {
  renderHomeActiveOrder();
  renderTracking();
  renderBusinessDashboard();
  renderDeliveryPanel();
  renderMapViews();
  lastLivenessSignature = trackingLivenessSignature();
}

// Firma de vivacidad del pedido activo: id + estado live/idle del GPS real. Si
// cambia entre ticks (p. ej. el último fix cruzó el umbral de stale sin que
// llegara un nuevo evento), refrescamos para mostrar "Sin GPS en vivo".
function trackingLivenessSignature() {
  const order = getActiveOrder();
  if (!order) return 'none';
  return `${order.id}:${activeTrackingLiveness(order, getState().simulation)}`;
}

// Intervalo liviano: sólo re-renderiza cuando la vivacidad cambió por el tiempo.
// En reposo (sin pedido o sin GPS) la firma es estable y no hace trabajo de DOM.
function startFreshnessTick() {
  if (freshnessTimer !== null || typeof setInterval !== 'function') return;
  lastLivenessSignature = trackingLivenessSignature();
  freshnessTimer = setInterval(() => {
    if (trackingLivenessSignature() === lastLivenessSignature) return;
    renderLiveSurfaces();
  }, FRESHNESS_TICK_MS);
}

function bindEvents() {
  window.addEventListener('popstate', syncViewFromLocation);
  window.addEventListener('hashchange', syncViewFromLocation);
  window.addEventListener('pagehide', () => disableGpsTracking({ silent: true }));

  document.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const navView = target.closest('[data-nav-view]')?.dataset.navView;
    if (navView) {
      event.preventDefault();
      setActiveView(navView);
      return;
    }

    const categoryId = target.closest('[data-category-id]')?.dataset.categoryId;
    if (categoryId) {
      setCategory(categoryId);
      if (activeView !== 'catalog') setActiveView('catalog');
      return;
    }

    const detailId = target.closest('[data-product-detail]')?.dataset.productDetail;
    if (detailId) {
      showProductModal(detailId);
      return;
    }

    const favoriteId = target.closest('[data-favorite-toggle]')?.dataset.favoriteToggle;
    if (favoriteId) {
      const result = toggleFavoriteProduct(favoriteId);
      showToast(result.message);
      renderAll();
      const modal = $('[data-product-modal]');
      if (modal?.open) showProductModal(favoriteId);
      return;
    }

    const repeatId = target.closest('[data-repeat-order]')?.dataset.repeatOrder;
    if (repeatId) {
      const result = repeatCustomerOrder(repeatId);
      // Carrito no vacío: abrimos confirmación en vez de reemplazar en silencio.
      if (result.needsConfirmation) {
        openRepeatModal(result.orderId);
        return;
      }
      showToast(result.message);
      if (result.ok) setActiveView('cart');
      else renderAll();
      return;
    }

    if (target.closest('[data-repeat-confirm]')) {
      const confirmId = pendingRepeatOrderId;
      closeRepeatModal();
      if (!confirmId) return;
      const result = repeatCustomerOrder(confirmId, { force: true });
      showToast(result.message);
      if (result.ok) setActiveView('cart');
      else renderAll();
      return;
    }

    if (target.closest('[data-repeat-dismiss]')) {
      closeRepeatModal();
      return;
    }

    if (target.closest('[data-apply-coupon]')) {
      renderOrderSummary();
      return;
    }

    const addId = target.closest('[data-add-product]')?.dataset.addProduct;
    if (addId) {
      const result = addToCart(addId);
      showToast(result.message);
      if (result.ok) {
        closeProductModal();
        pulseCartFeedback();
      }
      return;
    }

    const incId = target.closest('[data-cart-inc]')?.dataset.cartInc;
    if (incId) {
      const result = incrementCartItem(incId);
      if (result.ok) pulseCartFeedback();
      showToast(result.message);
      return;
    }

    const decId = target.closest('[data-cart-dec]')?.dataset.cartDec;
    if (decId) {
      decrementCartItem(decId);
      return;
    }

    const removeId = target.closest('[data-cart-remove]')?.dataset.cartRemove;
    if (removeId) {
      removeCartItem(removeId);
      showToast('Producto quitado del pedido.');
      return;
    }

    if (target.closest('[data-clear-cart]')) {
      clearCart();
      showToast('Carrito vaciado.');
      return;
    }

    if (target.closest('[data-open-cart]')) {
      setActiveView('cart');
      return;
    }

    if (target.closest('[data-close-modal]')) {
      closeProductModal();
      return;
    }

    const demoTarget = target.closest('[data-demo-open]')?.dataset.demoOpen;
    if (demoTarget) {
      openAdminArea(normalizeView(demoTarget));
      return;
    }

    const adminView = target.closest('[data-open-admin-view]')?.dataset.openAdminView;
    if (adminView) {
      openAdminArea(adminView);
      return;
    }

    const pinTarget = target.closest('[data-open-pin]')?.dataset.adminTarget;
    if (pinTarget) {
      pendingAdminTarget = normalizeView(pinTarget);
      openPinModal();
      return;
    }

    if (target.closest('[data-admin-toggle]')) {
      toggleAdminMode();
      return;
    }

    if (target.closest('[data-lock-admin]')) {
      lockAdmin();
      showToast('Acceso del negocio cerrado.');
      setActiveView('home');
      return;
    }

    if (target.closest('[data-close-pin]')) {
      closePinModal();
      return;
    }

    const businessResult = await Promise.resolve(handleBusinessAction(target));
    if (businessResult.handled) {
      if (businessResult.message) showToast(businessResult.message);
      if (businessResult.navigate) setActiveView(businessResult.navigate);
      return;
    }

    const deliveryResult = await Promise.resolve(handleDeliveryAction(target));
    if (deliveryResult.handled) {
      showToast(deliveryResult.message);
    }
  });

  // Búsqueda: hay un buscador en Home y otro en Catálogo (ambos data-search-input).
  document.addEventListener('input', (event) => {
    const businessInput = handleBusinessInput(event.target);
    if (businessInput.handled) return;

    if (event.target?.matches?.('[name="couponCode"]')) {
      renderOrderSummary();
      return;
    }

    const input = event.target.closest?.('[data-search-input]');
    if (!input) return;
    setSearchQuery(input.value || '');
    // El buscador del Home lleva al Catálogo para mostrar resultados.
    if (input.hasAttribute('data-search-jump') && activeView !== 'catalog') {
      setActiveView('catalog', { scroll: false });
      // Mantener el foco en el buscador del catálogo tras cambiar de vista.
      setTimeout(() => $('[data-view="catalog"] [data-search-input]')?.focus(), 0);
    }
  });

  document.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    if (target.name === 'deliveryMode') {
      updateAddressFieldVisibility();
      renderOrderSummary();
      renderCartTotals();
    }
    if (target.name === 'paymentMethod') {
      renderOrderSummary();
    }
    if (target.matches('[data-sort-select]')) {
      setSortBy(target.value || 'recommended');
    }
    const deliveryChange = handleDeliveryChange(target);
    if (deliveryChange.handled) {
      showToast(deliveryChange.message);
    }
  });

  // CTA principal: confirma el pedido interno y lleva a Tracking. NO abre WhatsApp.
  let confirming = false;
  $('[data-checkout-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (confirming) return; // evita doble confirmación / doble pedido
    confirming = true;
    const button = event.currentTarget.querySelector('[type="submit"]');
    const originalLabel = button?.textContent;
    if (button) {
      button.disabled = true;
      button.textContent = 'Creando pedido…';
    }
    try {
      const values = getCheckoutFormValues();
      const result = await Promise.resolve(getOrderRepository().createOrder(values));

      if (!result.ok) {
        showToast(result.message);
        return;
      }

      showToast('Pedido creado. Ya podés seguirlo en tiempo real.');
      setActiveView('tracking');
    } catch (_) {
      showToast('No se pudo crear el pedido. Reintentá.');
    } finally {
      confirming = false;
      if (button) {
        button.disabled = false;
        button.textContent = originalLabel || 'Confirmar pedido';
      }
    }
  });

  // Acción secundaria: enviar una copia por WhatsApp (no crea otro pedido).
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('[data-retry-relay]')) {
      const result = retryRelayConnection();
      showToast(result.message);
      renderLiveSurfaces();
      return;
    }
    if (target.closest('[data-whatsapp-copy]')) {
      const values = getCheckoutFormValues();
      window.open(buildWhatsAppUrlFromDraft(values), '_blank', 'noopener,noreferrer');
      showToast('Abriendo WhatsApp con la copia del pedido.');
      return;
    }
    if (target.closest('[data-whatsapp-order]')) {
      const order = getLastOrder();
      if (order) {
        window.open(buildWhatsAppUrl(order), '_blank', 'noopener,noreferrer');
        showToast('Abriendo WhatsApp con la copia del pedido.');
      }
      return;
    }
    if (target.closest('[data-copy-last-order]')) {
      const order = getLastOrder();
      if (!order) return;
      copyTextToClipboard(buildWhatsAppMessage(order))
        .then(() => showToast('Pedido copiado al portapapeles.'))
        .catch(() => showToast('No se pudo copiar automáticamente. Probá desde un navegador actualizado.'));
      return;
    }
    const addressButton = target.closest('[data-copy-address]');
    if (addressButton) {
      const text = addressButton.dataset.copyAddress || '';
      copyTextToClipboard(text)
        .then(() => showToast('Direccion copiada para el rider.'))
        .catch(() => showToast('No se pudo copiar la direccion.'));
      return;
    }
    const clientLink = target.closest('[data-copy-client-link]');
    const riderLink = target.closest('[data-copy-rider-link]');
    if (clientLink || riderLink) {
      const status = getRealtimeStatus();
      if (!status.relayEnabled || !status.relayBase) {
        showToast('Abrí la app con ?relay=…&room=… para compartir links.');
        return;
      }
      const base = `${status.relayBase}/?relay=${encodeURIComponent(status.relayBase)}&room=${encodeURIComponent(status.room)}`;
      const link = riderLink ? `${base}#rider` : base;
      copyTextToClipboard(link)
        .then(() => showToast(riderLink ? 'Link del rider copiado.' : 'Link del cliente copiado.'))
        .catch(() => showToast('No se pudo copiar el link.'));
    }
  });

  $('[data-copy-order]')?.addEventListener('click', async () => {
    try {
      await copyDraftOrderToClipboard();
      showToast('Pedido copiado al portapapeles.');
    } catch (_) {
      showToast('No se pudo copiar automáticamente. Probá desde un navegador actualizado.');
    }
  });

  $('[data-pin-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const pin = String(formData.get('pin') || '').trim();
    const ok = unlockAdmin(pin);
    const error = $('[data-pin-error]');

    if (!ok) {
      error?.classList.remove('hidden');
      return;
    }

    error?.classList.add('hidden');
    form.reset();
    closePinModal();
    showToast('Acceso del negocio activado.');
    const target = pendingAdminTarget || 'business';
    pendingAdminTarget = null;
    setActiveView(target);
  });

  $('[data-product-modal]')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeProductModal();
  });

  $('[data-pin-modal]')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closePinModal();
  });
}

let pendingAdminTarget = null;

function toggleAdminMode() {
  if (getState().adminUnlocked) {
    setActiveView('business');
    return;
  }
  setActiveView('business');
  pendingAdminTarget = 'business';
  openPinModal();
}

// Abre una vista del negocio. Si no está desbloqueada, muestra PIN y recuerda destino.
function openAdminArea(targetArea) {
  const view = normalizeView(targetArea);
  setActiveView(view);
  if (getState().adminUnlocked) {
    return;
  }
  pendingAdminTarget = view;
  openPinModal();
}

function normalizeView(view) {
  const key = String(view || '').replace(/^#/, '').trim().toLowerCase();
  const normalized = VIEW_ALIASES[key] || key;
  return VIEWS.includes(normalized) ? normalized : 'home';
}

function viewFromHash() {
  return normalizeView(window.location.hash.slice(1));
}

function setActiveView(view, options = {}) {
  const nextView = normalizeView(view);
  const changed = nextView !== activeView;
  activeView = nextView;

  if (options.writeHash !== false) {
    writeViewHash(nextView, options.replace === true);
  }

  handleViewChangeForSimulation(nextView);
  renderAll();
  if (changed) playViewEnter(nextView);

  if (changed && options.scroll !== false) {
    window.scrollTo(0, 0);
  }
}

function syncViewFromLocation() {
  const nextView = viewFromHash();
  if (nextView === activeView) return;
  activeView = nextView;
  handleViewChangeForSimulation(nextView);
  renderAll();
  playViewEnter(nextView);
  window.scrollTo(0, 0);
}

// Motion premium: marca la sección recién activada para que sus cards entren
// con stagger (clase one-shot). Se quita sola; si falla, el contenido queda
// visible igual (las animaciones son aditivas, no condicionan la visibilidad).
let viewEnterTimer = null;
function playViewEnter(view) {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('[data-view].view-enter').forEach((node) => node.classList.remove('view-enter'));
  const section = document.querySelector(`[data-view="${view}"]`);
  if (!section) return;
  // reflow para reiniciar el stagger aunque se reentre rápido a la misma vista
  void section.offsetWidth;
  section.classList.add('view-enter');
  clearTimeout(viewEnterTimer);
  viewEnterTimer = setTimeout(() => section.classList.remove('view-enter'), 620);
}

// Feedback al agregar al carrito: pop del botón flotante y de los badges.
function pulseCartFeedback() {
  if (typeof document === 'undefined') return;
  const bump = (node, cls, ms) => {
    if (!node) return;
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
    setTimeout(() => node.classList.remove(cls), ms);
  };
  bump(document.querySelector('[data-floating-cart]'), 'cart-bump', 480);
  document.querySelectorAll('[data-cart-count], [data-cart-count-mobile]')
    .forEach((badge) => bump(badge, 'badge-pop', 490));
}

function writeViewHash(view, replace = false) {
  const nextHash = `#${view}`;
  if (window.location.hash === nextHash) return;
  const url = `${window.location.pathname}${window.location.search}${nextHash}`;
  const method = replace ? 'replaceState' : 'pushState';
  window.history[method]({ view }, '', url);
}

function renderActiveView() {
  document.querySelectorAll('[data-view]').forEach((section) => {
    const isActive = section.dataset.view === activeView;
    section.hidden = !isActive;
    section.classList.toggle('is-active', isActive);
    section.setAttribute('aria-hidden', String(!isActive));
  });
}

function openPinModal() {
  const modal = $('[data-pin-modal]');
  if (!modal) return;
  $('[data-pin-error]')?.classList.add('hidden');
  modal.showModal();
  setTimeout(() => modal.querySelector('input')?.focus(), 80);
}

function closePinModal() {
  const modal = $('[data-pin-modal]');
  if (modal?.open) modal.close();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((registration) => {
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            installing.postMessage('skip-waiting');
          }
        });
      });
    }).catch(() => {
      // Service worker no disponible (por ejemplo, abierto con file://). La app funciona igual.
    });

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  });
}

bootstrap();
