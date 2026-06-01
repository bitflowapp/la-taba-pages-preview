import {
  addToCart,
  clearCart,
  decrementCartItem,
  incrementCartItem,
  removeCartItem,
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
import { buildWhatsAppMessage, buildWhatsAppUrl, buildWhatsAppUrlFromDraft, getLastOrder } from './orders.js';
import { getState, subscribe } from './state.js';
import { STORAGE_KEYS } from './config.js';
import { handleBusinessAction, lockAdmin, renderBusinessDashboard, unlockAdmin } from './business.js';
import { handleDeliveryAction, handleDeliveryChange, renderDeliveryPanel } from './delivery.js';
import { disableGpsTracking, handleViewChangeForSimulation, resumeSimulationIfNeeded } from './simulation.js';
import { getRealtimeStatus, initRealtime } from './realtime.js';
import { renderMapViews } from './map/map_view.js';
import { getOrderRepository, getRepositoryDiagnostic, startOrderRepositorySync } from './repositories/repository_factory.js';

const VIEWS = ['home', 'catalog', 'cart', 'tracking', 'business', 'rider', 'profile'];
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

// Limpieza segura de la sesión demo: abrir la app con ?reset=1 (o ?demo-reset=1)
// borra pedidos, carrito y acceso del negocio guardados en este equipo y recarga
// limpio. Pensado para empezar una presentación sin pedidos de prueba viejos.
// No corre en el uso normal (sin el parámetro) ni afecta a otros equipos.
function maybeResetDemoSession() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('reset') && !params.has('demo-reset')) return false;
    [STORAGE_KEYS.state, STORAGE_KEYS.adminUnlocked].forEach((key) => {
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

function bootstrap() {
  // Si se pidió limpiar la demo, recargamos limpio y no seguimos inicializando.
  if (maybeResetDemoSession()) return;
  try {
    applyBusinessConfig();
    bindEvents();
    subscribe(renderAll);
    initRealtime();
    startOrderRepositorySync();
    renderAll();
    playViewEnter(activeView);
    resumeSimulationIfNeeded();
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
  renderCart();
  renderTracking();
  renderBusinessDashboard();
  renderDeliveryPanel();
  updateAddressFieldVisibility();
  renderMapViews();
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
