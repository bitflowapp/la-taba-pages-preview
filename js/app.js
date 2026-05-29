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
  renderNavigation();
  renderAdminVisibility();
  renderCatalog();
  renderCart();
  renderTracking();
  renderBusinessDashboard();
  renderDeliveryPanel();
  updateAddressFieldVisibility();
}

function bindEvents() {
  window.addEventListener('hashchange', renderNavigation);

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const categoryId = target.closest('[data-category-id]')?.dataset.categoryId;
    if (categoryId) {
      setCategory(categoryId);
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
      window.location.hash = 'carrito';
      return;
    }

    if (target.closest('[data-close-modal]')) {
      closeProductModal();
      return;
    }

    if (target.closest('[data-admin-toggle], [data-admin-toggle-secondary]')) {
      toggleAdminMode();
      return;
    }

    if (target.closest('[data-lock-admin]')) {
      lockAdmin();
      showToast('Modo negocio cerrado.');
      window.location.hash = 'catalogo';
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
    window.location.hash = 'seguimiento';
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
    showToast('Modo negocio activado.');
    setTimeout(() => { window.location.hash = 'negocio'; }, 80);
  });

  $('[data-product-modal]')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeProductModal();
  });

  $('[data-pin-modal]')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closePinModal();
  });
}

function toggleAdminMode() {
  if (getState().adminUnlocked) {
    lockAdmin();
    showToast('Modo negocio cerrado.');
    window.location.hash = 'catalogo';
    return;
  }
  openPinModal();
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
