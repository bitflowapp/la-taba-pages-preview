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
  renderNavigation,
  renderOrderSummary,
  renderTracking,
  setCategory,
  setSearchQuery,
  showProductModal,
  showToast,
  updateAddressFieldVisibility,
  $,
} from './ui.js';
import { buildWhatsAppUrl, createOrderFromCheckout } from './orders.js';
import { getState, subscribe } from './state.js';
import { handleBusinessAction, lockAdmin, renderBusinessDashboard, unlockAdmin } from './business.js';
import { handleDeliveryAction, renderDeliveryPanel } from './delivery.js';

const VIEWS = ['home', 'cart', 'tracking', 'business', 'rider', 'profile'];
const VIEW_ALIASES = {
  catalogo: 'home',
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

function bootstrap() {
  try {
    applyBusinessConfig();
    bindEvents();
    subscribe(renderAll);
    renderAll();
  } catch (error) {
    // Evita pantalla en blanco si algo falla en el primer render.
    showToast('Hubo un problema al iniciar. Recargá la página.');
  }
  registerServiceWorker();
}

function renderAll() {
  renderActiveView();
  renderNavigation(activeView);
  renderAdminVisibility();
  renderCatalog();
  renderCart();
  renderTracking();
  renderBusinessDashboard();
  renderDeliveryPanel();
  updateAddressFieldVisibility();
}

function bindEvents() {
  window.addEventListener('popstate', syncViewFromLocation);
  window.addEventListener('hashchange', syncViewFromLocation);

  document.addEventListener('click', (event) => {
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
      if (activeView !== 'home') setActiveView('home');
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
      if (result.ok) closeProductModal();
      return;
    }

    const incId = target.closest('[data-cart-inc]')?.dataset.cartInc;
    if (incId) {
      const result = incrementCartItem(incId);
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

    const businessResult = handleBusinessAction(target);
    if (businessResult.handled) {
      showToast(businessResult.message);
      return;
    }

    const deliveryResult = handleDeliveryAction(target);
    if (deliveryResult.handled) {
      showToast(deliveryResult.message);
    }
  });

  $('[data-search-input]')?.addEventListener('input', (event) => {
    setSearchQuery(event.target.value || '');
  });

  document.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    if (target.name === 'deliveryMode') {
      updateAddressFieldVisibility();
      renderOrderSummary();
      renderCartTotals();
    }
  });

  $('[data-checkout-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = getCheckoutFormValues();
    const result = createOrderFromCheckout(values);

    if (!result.ok) {
      showToast(result.message);
      return;
    }

    showToast(`${result.order.id} creado. Abriendo WhatsApp...`);
    setActiveView('tracking');
    window.open(buildWhatsAppUrl(result.order), '_blank', 'noopener,noreferrer');
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

  renderAll();

  if (changed && options.scroll !== false) {
    window.scrollTo(0, 0);
  }
}

function syncViewFromLocation() {
  const nextView = viewFromHash();
  if (nextView === activeView) return;
  activeView = nextView;
  renderAll();
  window.scrollTo(0, 0);
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
