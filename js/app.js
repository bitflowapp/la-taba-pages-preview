import {
  addComboToCart,
  addToCart,
  clearCart,
  decrementCartItem,
  decrementComboItem,
  incrementCartItem,
  removeCartItem,
  repeatCustomerOrder,
} from './cart.js';
import {
  applyBusinessConfig,
  closeCheckoutSuggestions,
  closeComboModal,
  closeProductModal,
  closeStoriesModal,
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
  setMercadoPagoCheckoutAvailability,
  setCategory,
  setCatalogFilter,
  setSearchQuery,
  setSortBy,
  resetCatalogFilters,
  showComboModal,
  showProductModal,
  showStoriesModal,
  showToast,
  stepStoriesModal,
  updateAddressFieldVisibility,
  $,
} from './ui.js';
import { buildWhatsAppMessage, buildWhatsAppUrl, buildWhatsAppUrlFromDraft, getActiveOrder, getLastOrder } from './orders.js';
import { getState, subscribe } from './state.js';
import { BRAND, STORAGE_KEYS } from './config.js';
import { getBusinessConfig } from './core/business-config-store.js';
import { relayStatusLabel } from './core/realtime-sync.js';
import { handleBusinessAction, handleBusinessInput, lockAdmin, renderBusinessDashboard, submitBusinessSetupForm, unlockAdmin } from './business.js';
import { handleDeliveryAction, handleDeliveryChange, renderDeliveryPanel } from './delivery.js';
import {
  disableGpsTracking,
  handleGpsVisibilityChange,
  handleViewChangeForSimulation,
  resumeSimulationIfNeeded,
} from './simulation.js';
import { getRealtimeStatus, initRealtime, onRealtimeStatusChange, retryRelayConnection } from './realtime.js';
import { recenterMapViews, renderMapViews } from './map/map_view.js';
import { activeTrackingLiveness } from './map/route_geometry.js';
import {
  getOrderRepository,
  getRepositoryDiagnostic,
  isSandboxOrderRepository,
  startOrderRepositorySync,
} from './repositories/repository_factory.js';
import {
  handleProductionOperationsPageHide,
  handleProductionOperationsViewChange,
  handleProductionAuthSubmit,
  handleProductionOperationsAction,
  handleProductionOperationsInput,
  initProductionOperations,
  renderProductionOperations,
} from './production-operations.js';
import {
  APP_MODE_DEMO,
  APP_MODE_PRODUCTION,
  APP_MODE_PUBLIC,
  APP_MODE_UNAVAILABLE,
  getAppMode,
  isDemoMode,
  isOperationalView,
  isShowcaseMode,
} from './core/app-mode.js';
import { isProductionCatalogReady } from './core/runtime-config.js';
import { handleSandboxToolsAction, handleSandboxToolsChange, renderSandboxTools } from './sandbox-tools.js';
import {
  SHOWCASE_STEPS,
  configureShowcase,
  renderShowcase,
} from './showcase.js';
import {
  SHOWCASE_PENDING_PRODUCT_ID,
  isShowcaseFixtureOrder,
  prepareShowcaseScenario,
} from './showcase-fixtures.js';
import { toggleFavoriteProduct } from './core/customer-preferences.js';
import {
  initializeCustomerDeliveryCheckout,
  persistCustomerProfileAfterOrder,
  consumeProfileReturnTarget,
} from './customer-delivery.js';
import { initializeCustomerProfileView } from './customer-profile-view.js';
import {
  dismissIOSGuide,
  dismissInstallBanner,
  isInstallBannerDismissed,
  isIOSGuideDismissed,
  isStandaloneDisplay,
  shouldShowAndroidInstallCta,
  shouldShowIOSInstallGuide,
} from './core/pwa-install.js';
import { initMotion } from './motion.js';

const VIEWS = ['home', 'catalog', 'cart', 'tracking', 'business', 'rider', 'profile'];
const RELAY_ROOM_STORAGE_KEY = 'la_taba_rt_room';
const RESET_RELAY_TIMEOUT_MS = 1200;
const PROFILE_RETURN_STORAGE_KEY = 'taba:profile-return';
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
const CHECKOUT_SUGGESTIONS_DISMISSED_KEY = 'la_taba_checkout_suggestions_dismissed';
const SHOWCASE_RECOVERY_KEY = 'taba-showcase-recovery-v1';
const recentCartActions = new Map();

function dismissCheckoutSuggestions() {
  try {
    sessionStorage.setItem(CHECKOUT_SUGGESTIONS_DISMISSED_KEY, 'true');
  } catch (_) {
    // Si el navegador bloquea storage, la sugerencia sigue siendo descartable
    // en esta interacción y nunca bloquea la confirmación del pedido.
  }
}

function runCartAction(action, productId, callback) {
  const key = `${action}:${productId}`;
  const now = Date.now();
  const previous = recentCartActions.get(key) || 0;
  // Bloquea la duplicación accidental del mismo evento sin impedir que el
  // cliente vuelva a tocar el control para cambiar la cantidad a propósito.
  if (now - previous < 120) return { ok: false, duplicate: true, message: '' };
  recentCartActions.set(key, now);
  setTimeout(() => recentCartActions.delete(key), 350);
  return callback();
}

function refreshOpenProductModal(productId) {
  const modal = $('[data-product-modal]');
  if (!modal?.open) return;
  const selectedVariant = modal.querySelector('[data-product-variant]:checked')?.value;
  const displayedProductId = modal.querySelector('[data-modal-product-id]')?.dataset.modalProductId;
  if (selectedVariant === productId || displayedProductId === productId) showProductModal(productId);
}

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

function openClearCartModal() {
  const modal = document.querySelector('[data-clear-cart-modal]');
  if (modal && typeof modal.showModal === 'function' && !modal.open) modal.showModal();
}

function closeClearCartModal() {
  const modal = document.querySelector('[data-clear-cart-modal]');
  if (modal?.open) modal.close();
}

// Limpieza segura de la sesión demo: abrir la app con ?reset=1 (o ?demo-reset=1)
// borra pedidos, carrito y acceso del negocio guardados en este equipo y recarga
// limpio. Pensado para empezar una presentación sin pedidos de prueba viejos.
// No corre en el uso normal (sin el parámetro) ni afecta a otros equipos.
function hasDemoResetRequest() {
  if (!isDemoMode()) return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.has('reset') || params.has('demo-reset');
  } catch (_) {
    return false;
  }
}

async function maybeResetDemoSession() {
  if (!hasDemoResetRequest()) return false;
  const params = new URLSearchParams(window.location.search);
  // Showcase is a strictly local namespace: even a crafted relay parameter
  // must never turn its reset flow into an external request.
  if (!isShowcaseMode()) await clearRelayRoomOnReset(params);
  const repository = getOrderRepository();
  if (typeof repository.resetSandbox === 'function') await repository.resetSandbox();
  clearModeStorage();
  params.delete('reset');
  params.delete('demo-reset');
  const query = params.toString();
  const cleanUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  // Recarga sin el parámetro para arrancar con el estado por defecto.
  window.location.replace(cleanUrl);
  return true;
}

async function clearRelayRoomOnReset(params) {
  const relay = params.get('relay');
  const key = params.get('key');
  if (!relay || !key || typeof fetch !== 'function') return;
  const room = sanitizeResetRoom(params.get('room') || safeStorageGet(RELAY_ROOM_STORAGE_KEY) || 'demo');
  const base = relay.replace(/\/+$/, '');
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), RESET_RELAY_TIMEOUT_MS)
    : null;
  try {
    await fetch(`${base}/reset?room=${encodeURIComponent(room)}&key=${encodeURIComponent(key)}`, {
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

function initializeShowcase() {
  if (!isShowcaseMode()) return;

  configureShowcase({
    onSelectStep: presentShowcaseStep,
    onReset: resetShowcaseTour,
    onExit: exitShowcaseTour,
  });

  const recovery = readShowcaseRecovery();
  if (recovery) {
    const order = getState().orders.find((candidate) => candidate.id === recovery.orderId);
    const recovered = Boolean(
      order
        && order.status === recovery.status
        && isShowcaseFixtureOrder(order),
    );
    removeShowcaseRecovery();
    setActiveView('tracking', {
      replace: true,
      scroll: false,
      focus: false,
    });
    renderShowcase({
      activeStepId: 'session-recovery',
      message: recovered
        ? `Sesión recuperada: el pedido sintético ${order.id} conserva su estado ${order.status}.`
        : 'La sesión local no pudo recuperar el mismo pedido sintético.',
      messageTone: recovered ? 'success' : 'error',
    });
    return;
  }

  renderShowcase();
  queueMicrotask(() => {
    document.querySelector('[data-showcase-action="return"]')?.click();
  });
}

async function presentShowcaseStep(step) {
  if (!isShowcaseMode() || !SHOWCASE_STEPS.some((candidate) => candidate.id === step?.id)) {
    return { ok: false, message: 'La parada solicitada no pertenece al recorrido local.' };
  }

  const scenarioId = showcaseScenarioId(step.id);
  const prepared = await prepareShowcaseScenario(scenarioId);
  if (!prepared.ok) return prepared;

  if (['business', 'order-management', 'rider'].includes(step.id)) {
    unlockAdmin(getBusinessConfig().adminPin);
  }

  if (step.id === 'catalog' || step.id === 'pending-price') {
    setSearchQuery('');
    setCategory('all');
  }

  setActiveView(step.view);

  if (step.id === 'pending-price') {
    requestAnimationFrame(() => showProductModal(SHOWCASE_PENDING_PRODUCT_ID));
  }
  if (step.id === 'checkout') {
    focusShowcaseTarget('[data-checkout-form]');
  }
  if (step.id === 'delivery-pickup') {
    focusShowcaseTarget('.delivery-mode');
  }
  if (step.id === 'addresses') {
    focusShowcaseTarget('.addresses-card');
  }
  if (step.id === 'privacy-security') {
    focusShowcaseTarget('.profile-privacy-card');
  }
  if (step.id === 'session-recovery') {
    const recoveryStored = writeShowcaseRecovery({
      orderId: prepared.orderId,
      status: prepared.status,
    });
    if (!recoveryStored) {
      return {
        ok: false,
        message: 'El navegador bloqueó la sesión local; no se puede demostrar una recuperación real.',
      };
    }
    setTimeout(() => window.location.reload(), 0);
    return {
      ok: true,
      message: 'Recargando la misma sesión local para comprobar su recuperación…',
    };
  }

  return {
    ok: true,
    message: `${step.title}: ${prepared.message || 'vista real preparada con datos sintéticos.'}`,
  };
}

function showcaseScenarioId(stepId) {
  const scenarios = {
    catalog: 'catalog',
    'pending-price': 'catalog',
    cart: 'cart',
    checkout: 'checkout',
    'delivery-pickup': 'delivery-options',
    profile: 'profile',
    addresses: 'addresses',
    business: 'business-new',
    'order-management': 'business-manage',
    rider: 'rider',
    'tracking-map': 'tracking-map',
    delivered: 'delivered',
    'session-recovery': 'recovery',
    'privacy-security': 'security',
  };
  return scenarios[stepId] || 'catalog';
}

function focusShowcaseTarget(selector) {
  requestAnimationFrame(() => {
    const target = document.querySelector(selector);
    if (!(target instanceof HTMLElement)) return;
    target.setAttribute('tabindex', '-1');
    target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    target.focus({ preventScroll: true });
  });
}

function resetShowcaseTour() {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('showcase', '1');
  url.searchParams.set('reset', '1');
  url.hash = '#home';
  window.location.assign(url);
  return { ok: true, message: 'Reiniciando el recorrido local…' };
}

async function exitShowcaseTour() {
  const repository = getOrderRepository();
  if (isSandboxOrderRepository(repository) && repository.sandboxNamespace === 'showcase') {
    await repository.resetSandbox();
  }
  clearModeStorage();
  removeShowcaseRecovery();
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '#home';
  window.location.assign(url);
  return { ok: true, message: 'Saliendo del modo demostración local.' };
}

function clearModeStorage() {
  [
    STORAGE_KEYS.state,
    STORAGE_KEYS.adminUnlocked,
    STORAGE_KEYS.customerFavorites,
    STORAGE_KEYS.customerHistory,
    STORAGE_KEYS.customerProfile,
    STORAGE_KEYS.cashboxClosures,
  ].forEach((key) => {
    try { window.localStorage?.removeItem(key); } catch (_) { /* sin storage: ignorar */ }
    try { window.sessionStorage?.removeItem(key); } catch (_) { /* sin storage: ignorar */ }
  });
}

function clearProfileReturnTarget() {
  try {
    window.sessionStorage?.removeItem(PROFILE_RETURN_STORAGE_KEY);
  } catch (_) {
    // Sin sessionStorage, no hay retorno persistente para limpiar.
  }
}

function writeShowcaseRecovery(value) {
  try {
    window.sessionStorage?.setItem(SHOWCASE_RECOVERY_KEY, JSON.stringify({
      orderId: String(value?.orderId || ''),
      status: String(value?.status || ''),
    }));
    return window.sessionStorage?.getItem(SHOWCASE_RECOVERY_KEY) !== null;
  } catch (_) {
    return false;
  }
}

function readShowcaseRecovery() {
  try {
    const parsed = JSON.parse(window.sessionStorage?.getItem(SHOWCASE_RECOVERY_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    const orderId = String(parsed.orderId || '');
    const status = String(parsed.status || '');
    return orderId && status ? { orderId, status } : null;
  } catch (_) {
    return null;
  }
}

function removeShowcaseRecovery() {
  try {
    window.sessionStorage?.removeItem(SHOWCASE_RECOVERY_KEY);
  } catch (_) {
    // Sin storage no queda un marcador que limpiar.
  }
}

function setAppBootstrapState(status) {
  const main = document.querySelector('main[data-app-main]');
  const pending = status === 'pending';
  main?.toggleAttribute('inert', pending);
  if (pending) main?.setAttribute('aria-busy', 'true');
  else main?.removeAttribute('aria-busy');
  document.documentElement.dataset.appBootstrap = status;
  if (status === 'ready') document.documentElement.dataset.tabaStartup = 'ready';
  else if (status === 'error') document.documentElement.dataset.tabaStartup = 'failed';
}

async function bootstrap() {
  document.documentElement.dataset.tabaStartup = 'starting';
  // Si se pidió limpiar la demo, recargamos limpio y no seguimos inicializando.
  try {
    setAppBootstrapState('pending');
    const resetRequested = hasDemoResetRequest();
    applyBusinessConfig();
    configureViewScrollRestoration();
    const motionController = initMotion();
    // Exponer sólo diagnósticos locales para QA visual/performance; no forma
    // parte de contratos de negocio ni cambia el estado del catálogo.
    window.TABA2_MOTION = motionController;
    bindEvents();
    subscribe(renderAll);
    maybeOpenPitchFromUrl();
    // El primer render no puede depender de IndexedDB: Chrome móvil puede
    // demorar la apertura mientras reanuda una pestaña o actualiza el worker.
    // El estado inicial ya es seguro para pintar y se vuelve a renderizar al
    // hidratar la sesión persistida.
    renderAll();
    window.TABA_STARTUP_RECOVERY?.hide();
    initPwaInstall();
    if (resetRequested) {
      if (await maybeResetDemoSession()) return;
    }
    initProductionOperations({
      onChange: renderAll,
      onOrderAlert: (message) => showToast(message),
    });
    if (isDemoMode()) {
      if (!isSandboxOrderRepository(getOrderRepository())) initRealtime();
      onRealtimeStatusChange(renderLiveSurfaces);
    }
    try {
      await startOrderRepositorySync();
    } catch (error) {
      window.TABA_STARTUP_RECOVERY?.show({ reason: 'storage', resetAvailable: false });
      showToast('La sesion local esta temporalmente limitada. Podes continuar.');
    }
    await refreshMercadoPagoCheckoutAvailability();
    await initializeCustomerDeliveryCheckout();
    await initializeCustomerProfileView();
    initializeShowcase();
    renderAll();
    playViewEnter(activeView);
    resumeSimulationIfNeeded();
    startFreshnessTick();
    // Un runtime productivo inválido nunca cae silenciosamente a datos locales.
    const diagnostic = getRepositoryDiagnostic();
    if (diagnostic) {
      console.warn(`[TABA] ${diagnostic.message}`);
      const message = diagnostic.blocking
        ? 'Los pedidos online no están disponibles por un problema de configuración.'
        : 'No se pudo conectar al servidor de pedidos.';
      setTimeout(() => showToast(message), 600);
    }
    setAppBootstrapState('ready');
  } catch (error) {
    setAppBootstrapState('error');
    window.TABA_STARTUP_RECOVERY?.show({
      reason: /storage|indexeddb|base sandbox/i.test(error?.message || '') ? 'storage' : 'startup',
    });
    // Evita pantalla en blanco si algo falla en el primer render.
    showToast('Hubo un problema al iniciar. Recargá la página.');
  }
}

async function refreshMercadoPagoCheckoutAvailability() {
  if (getAppMode() !== APP_MODE_PRODUCTION) {
    setMercadoPagoCheckoutAvailability({ available: false });
    return;
  }
  const repository = getOrderRepository();
  if (typeof repository?.getMercadoPagoCheckoutAvailability !== 'function') {
    setMercadoPagoCheckoutAvailability({ available: false });
    return;
  }
  try {
    const result = await repository.getMercadoPagoCheckoutAvailability();
    setMercadoPagoCheckoutAvailability({ available: result?.ok && result.available === true });
  } catch (_) {
    setMercadoPagoCheckoutAvailability({ available: false });
  }
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  throw new Error('clipboard unavailable');
}

function renderAll() {
  applyBusinessConfig();
  applyAppMode();
  renderActiveView();
  renderNavigation(activeView);
  renderAdminVisibility();
  renderCatalog();
  renderHomeActiveOrder();
  renderCustomerHome();
  renderCart();
  renderTracking();
  syncCustomerTrackingWithView(activeView);
  if (isDemoMode()) {
    renderBusinessDashboard();
    renderDeliveryPanel();
  } else {
    clearDemoOperationalSurfaces();
  }
  renderProductionOperations();
  renderSandboxTools();
  // Tracking/negocio/rider generan nodos dinámicos después del primer pase.
  applyWhatsappAvailability();
  updateAddressFieldVisibility();
  renderMapViews();
  applyRenderedModeState();
  // Un render completo ya refleja la vivacidad actual; mantener la firma en
  // sincronía hace que el tick sólo actúe cuando cambia por el paso del tiempo.
  lastLivenessSignature = trackingLivenessSignature();
}

function applyAppMode() {
  const mode = getAppMode();
  const demo = mode === APP_MODE_DEMO;
  const production = mode === APP_MODE_PRODUCTION;
  const operational = demo || production;

  document.body.dataset.appMode = mode;
  document.body.classList.toggle('is-demo-mode', demo);
  document.body.classList.toggle('is-public-mode', mode === APP_MODE_PUBLIC);
  document.body.classList.toggle('is-production-mode', production);
  document.body.classList.toggle('is-unavailable-mode', mode === APP_MODE_UNAVAILABLE);
  document.querySelectorAll('[data-demo-only]').forEach((node) => {
    node.hidden = !demo;
    node.setAttribute('aria-hidden', String(!demo));
  });
  document.querySelectorAll('[data-production-only]').forEach((node) => {
    node.hidden = !production;
    node.setAttribute('aria-hidden', String(!production));
  });
  document.querySelectorAll('[data-operational-only]').forEach((node) => {
    node.hidden = !operational;
    node.setAttribute('aria-hidden', String(!operational));
  });
  document.querySelectorAll('[data-admin-pin]').forEach((node) => {
    node.textContent = demo ? getBusinessConfig().adminPin : '';
  });

  const checkoutCopy = checkoutModeCopy(mode);
  const submit = document.querySelector('[data-checkout-submit]');
  if (submit) submit.textContent = checkoutCopy.submit;
  const trustTitle = document.querySelector('[data-checkout-trust-title]');
  if (trustTitle) trustTitle.textContent = checkoutCopy.title;
  const trustCopy = document.querySelector('[data-checkout-trust-copy]');
  if (trustCopy) trustCopy.textContent = checkoutCopy.copy;
  const modeNote = document.querySelector('[data-checkout-mode-note]');
  if (modeNote) modeNote.textContent = checkoutCopy.note;

  applyProductionCatalogGate(mode);
  if (!production) setMercadoPagoCheckoutAvailability({ available: false });
  applyWhatsappAvailability();
}

function checkoutModeCopy(mode) {
  if (mode === APP_MODE_DEMO) {
    return {
      submit: 'Confirmar pedido',
      // «Tu pedido está protegido» no decía nada verificable: no nombraba de
      // qué, ni por quién. Lo que sí es cierto y además es lo que la persona
      // necesita saber en esta pantalla es qué pasa al tocar el botón.
      title: 'Revisá antes de confirmar.',
      copy: 'Al confirmar, el pedido queda tomado y podés seguirlo desde Seguimiento.',
      note: 'El medio de pago se coordina con el local.',
    };
  }
  if (mode === APP_MODE_PRODUCTION) {
    return {
      submit: 'Confirmar pedido',
      title: 'Pedido online al local.',
      copy: 'Al confirmar, el pedido se registra en el sistema del comercio.',
      note: 'El pago se coordina directamente con el local.',
    };
  }
  if (mode === APP_MODE_UNAVAILABLE) {
    return {
      submit: 'Pedidos no disponibles',
      title: 'Pedidos online temporalmente no disponibles.',
      copy: 'La configuración del servicio está incompleta.',
      note: 'No ingreses datos personales hasta que el comercio habilite el servicio.',
    };
  }
  return {
    submit: 'Pedidos no disponibles',
    title: 'Pedidos online temporalmente no disponibles.',
    copy: 'El comercio todavía no habilitó la recepción de pedidos.',
    note: 'No ingreses datos personales hasta que el servicio esté habilitado.',
  };
}

function applyProductionCatalogGate(mode = getAppMode()) {
  const blocked = isProductionOrderingBlocked(mode);
  document.querySelectorAll('[data-catalog-dependent]').forEach((node) => {
    node.hidden = blocked;
    node.setAttribute('aria-hidden', String(blocked));
  });
  document.querySelectorAll('[data-production-catalog-gate]').forEach((node) => {
    node.hidden = !blocked;
    node.setAttribute('aria-hidden', String(!blocked));
    const message = node.querySelector('[data-production-catalog-message]');
    if (message) {
      message.textContent = mode === APP_MODE_UNAVAILABLE
        ? 'La configuración productiva está incompleta. Los pedidos permanecen bloqueados.'
        : mode === APP_MODE_PUBLIC
          ? 'Este despliegue todavía no habilitó pedidos online.'
          : 'El catálogo verificado todavía no está disponible. Los pedidos permanecen bloqueados.';
    }
  });

  const submit = document.querySelector('[data-checkout-submit]');
  if (submit) submit.disabled = blocked;
}

function isProductionOrderingBlocked(mode = getAppMode()) {
  if (mode === APP_MODE_PUBLIC || mode === APP_MODE_UNAVAILABLE) return true;
  return mode === APP_MODE_PRODUCTION && !isProductionCatalogReady();
}

function clearDemoOperationalSurfaces() {
  document.querySelectorAll('[data-business-dashboard], [data-delivery-panel]').forEach((node) => {
    node.replaceChildren();
  });
}

function applyRenderedModeState() {
  const mode = getAppMode();
  if (mode !== APP_MODE_DEMO) {
    document.querySelectorAll('[data-demo-auth-only], [data-admin-unlocked]').forEach((node) => {
      node.hidden = true;
      node.setAttribute('aria-hidden', 'true');
    });
  }
  applyProductionCatalogGate(mode);
  if (mode === APP_MODE_PRODUCTION) applyProductionTrackingCopy();
}

function applyProductionTrackingCopy() {
  const panel = document.querySelector('[data-tracking-panel] [data-public-preview]');
  if (!panel) return;

  panel.removeAttribute('data-public-preview');
  panel.setAttribute('data-production-order', '');
  const head = panel.querySelector('.preview-confirm-head');
  if (head) {
    const small = head.querySelector('small');
    const title = head.querySelector('strong');
    const copy = head.querySelector('span:last-child');
    if (small) small.textContent = 'Pedido confirmado';
    if (title) title.textContent = 'Tu pedido fue registrado';
    if (copy) copy.textContent = 'El local recibió los datos del pedido. Seguí su estado desde esta pantalla.';
  }

  const metrics = [...panel.querySelectorAll('.sheet-metrics > span')];
  if (metrics[1]) {
    const label = metrics[1].querySelector('small');
    if (label) label.textContent = 'Total';
  }
  if (metrics[2]) {
    const value = metrics[2].querySelector('strong');
    if (value) value.textContent = 'A coordinar';
  }

  const notice = panel.querySelector('.public-preview-notice');
  if (notice) notice.textContent = 'El estado se actualizará cuando el comercio procese el pedido.';
  const summary = panel.querySelector('details > summary');
  if (summary) summary.textContent = 'Ver detalle del pedido';
  panel.querySelectorAll('.summary-row').forEach((row) => {
    const label = row.querySelector('span');
    const value = row.querySelector('strong');
    if (label?.textContent.trim() === 'Pago' && value) value.textContent = 'A coordinar';
  });
}

function applyWhatsappAvailability() {
  const config = getBusinessConfig();
  const whatsappReady = Boolean(config.whatsappVerified && String(config.whatsappNumber || '').replace(/\D/g, '').length >= 8);
  document.querySelectorAll('[data-whatsapp-available]').forEach((node) => {
    node.hidden = !whatsappReady;
  });
}

// Superficies sensibles a la "vivacidad" del GPS y al estado de la conexión. Se
// re-renderan cuando el rider deja de compartir / pierde señal o cuando cae el
// relay, para volver a un fallback honesto (sin mapa ni marker fantasma) y con
// el chip de conexión correcto, sin re-renderizar catálogo/carrito.
function renderLiveSurfaces() {
  renderHomeActiveOrder();
  renderTracking();
  if (isDemoMode()) {
    renderBusinessDashboard();
    renderDeliveryPanel();
  } else {
    clearDemoOperationalSurfaces();
  }
  renderProductionOperations();
  renderMapViews();
  renderGlobalRealtimeStatus();
  applyRenderedModeState();
  lastLivenessSignature = trackingLivenessSignature();
}

function renderGlobalRealtimeStatus() {
  const status = getRealtimeStatus();
  renderOperationalSyncChip(status);
  let control = document.querySelector('[data-realtime-sync="global"]');
  if (!status.relayEnabled) {
    control?.remove();
    return;
  }
  if (!control) {
    control = document.createElement('button');
    control.type = 'button';
    control.dataset.retryRelay = '';
    control.dataset.realtimeSync = 'global';
  }
  const host = document.querySelector('.topbar');
  if (host && control.parentElement !== host) host.append(control);
  const synchronized = status.relayState === 'connected' && !status.pendingSnapshot;
  const date = status.lastSyncAt ? new Date(status.lastSyncAt) : null;
  const time = date && !Number.isNaN(date.getTime())
    ? date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
    : '';
  control.className = `rt-chip ${synchronized ? 'live' : 'warn'}`;
  control.textContent = `${relayStatusLabel(status)}${time ? ` · ${time}` : ''}`;
  control.setAttribute('aria-label', `${relayStatusLabel(status)}. Reintentar sincronización`);
}

// Estado de sincronización del app bar operativo. Usa la MISMA fuente que el
// resto de la app (`getRealtimeStatus` + `relayStatusLabel`): sin relay dice
// "Sólo este equipo", que es la verdad, y nunca un genérico "actualizando".
function renderOperationalSyncChip(status) {
  const chip = document.querySelector('[data-realtime-sync="business"]');
  if (!chip) return;
  const label = relayStatusLabel(status);
  const synchronized = status.relayEnabled
    && status.relayState === 'connected'
    && !status.pendingSnapshot;
  const date = status.lastSyncAt ? new Date(status.lastSyncAt) : null;
  const time = date && !Number.isNaN(date.getTime())
    ? date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
    : '';
  chip.className = `rt-chip topbar-ops-sync ${synchronized ? 'live' : 'warn'}`;
  chip.textContent = `${label}${time ? ` · ${time}` : ''}`;
  chip.setAttribute('aria-label', `Sincronización: ${label}. Reintentar sincronización`);
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

const CHECKOUT_ERROR_FIELD_RULES = Object.freeze([
  { pattern: /nombre/i, name: 'customerName' },
  { pattern: /tel[eé]fono/i, name: 'customerPhone' },
  { pattern: /calle|n[uú]mero|direcci[oó]n/i, name: 'customerStreetAddress' },
  { pattern: /localidad|zona/i, name: 'customerNeighborhood' },
  { pattern: /mayor|edad|alcoh[oó]l/i, name: 'ageConfirmed' },
  { pattern: /forma de pago|medio de pago/i, name: 'paymentMethod' },
]);

function checkoutErrorFieldName(message) {
  return CHECKOUT_ERROR_FIELD_RULES.find(({ pattern }) => pattern.test(String(message || '')))?.name || '';
}

function clearCheckoutFieldError(field) {
  if (!(field instanceof HTMLElement)) return;
  field.removeAttribute('aria-invalid');
  const describedBy = String(field.getAttribute('aria-describedby') || '')
    .split(/\s+/)
    .filter((token) => token && token !== 'checkout-error');
  if (describedBy.length) field.setAttribute('aria-describedby', describedBy.join(' '));
  else field.removeAttribute('aria-describedby');
}

function clearCheckoutInlineError(form) {
  if (!(form instanceof HTMLFormElement)) return;
  form.querySelectorAll('[aria-invalid="true"]').forEach(clearCheckoutFieldError);
  const warning = form.querySelector('[data-checkout-warning]');
  if (!warning) return;
  warning.textContent = '';
  warning.hidden = true;
  warning.classList.add('hidden');
}

function showCheckoutInlineError(form, message) {
  if (!(form instanceof HTMLFormElement)) return;
  clearCheckoutInlineError(form);
  const cleanMessage = String(message || 'Revisá los datos del pedido e intentá nuevamente.');
  const warning = form.querySelector('[data-checkout-warning]');
  if (warning) {
    warning.textContent = cleanMessage;
    warning.hidden = false;
    warning.classList.remove('hidden');
  }

  const fieldName = checkoutErrorFieldName(cleanMessage);
  const field = fieldName ? form.elements.namedItem(fieldName) : null;
  const visibleField = field instanceof HTMLElement
    && !field.hidden
    && !field.closest('[hidden]')
    && field.getClientRects().length > 0;

  if (visibleField) {
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', [
      ...String(field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean),
      'checkout-error',
    ].filter((token, index, values) => values.indexOf(token) === index).join(' '));
    field.focus({ preventScroll: true });
    field.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }

  warning?.focus({ preventScroll: true });
  warning?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function bindEvents() {
  window.addEventListener('popstate', syncViewFromLocation);
  window.addEventListener('hashchange', syncViewFromLocation);
  window.addEventListener('taba:navigate-profile', (event) => {
    const requestedReturn = String(event?.detail?.returnTo || 'cart');
    const returnTo = normalizeView(requestedReturn) || 'cart';
    try {
      window.sessionStorage?.setItem(PROFILE_RETURN_STORAGE_KEY, returnTo);
    } catch (_) {
      // Sin sessionStorage, el retorno se pierde pero la navegación a Perfil sigue viva.
    }
    setActiveView('profile');
  });
  window.addEventListener('taba:profile-return', (event) => {
    const requestedReturn = event?.detail?.returnTo || consumeProfileReturnTarget();
    const returnTo = normalizeView(requestedReturn) || 'cart';
    setActiveView(returnTo);
  });
  // El destino de la entrega lo resuelve el checkout de forma asíncrona. El chip
  // «Enviar a» del encabezado se entera acá, para no quedar diciendo «Elegí tu
  // dirección» sobre una dirección que el checkout ya eligió.
  window.addEventListener('taba:delivery-address-changed', () => renderCustomerHome());
  window.addEventListener('pagehide', () => {
    // Al ir a segundo plano Chrome puede descartar la pestaña del rider. Se
    // corta el watcher por privacidad, pero se conserva sólo el último fix
    // fresco como "Última ubicación" para que otra pestaña del mismo navegador
    // no pierda el contexto de golpe.
    disableGpsTracking({ silent: true, preserveLastFix: true });
    handleProductionOperationsPageHide();
    syncCustomerTrackingWithView('');
  });
  window.addEventListener('pageshow', () => syncCustomerTrackingWithView(activeView));
  document.addEventListener('visibilitychange', () => {
    const result = handleGpsVisibilityChange();
    if (result?.changed && !document.hidden) renderLiveSurfaces();
  });

  document.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const externalShowcaseAction = target.closest([
      'a[href^="tel:"]',
      'a[href*="wa.me"]',
      'a[href*="google.com/maps"]',
      '[data-whatsapp-copy]',
      '[data-whatsapp-order]',
      '[data-pitch-go="whatsapp"]',
    ].join(','));
    if (isShowcaseMode() && externalShowcaseAction) {
      event.preventDefault();
      showToast('Contacto y navegación externa desactivados en la demostración local.');
      return;
    }

    // Las herramientas son el único camino que puede requerir I/O asíncrono.
    // Evitar un `await` incondicional acá mantiene atómicas las acciones
    // ordinarias (agregar al carrito, navegar, abrir checkout): WebKit puede
    // despachar el siguiente tap antes de que continúe un listener async.
    if (target.closest('[data-sandbox-action]')) {
      const sandboxResult = await handleSandboxToolsAction(target);
      if (sandboxResult.handled) {
        if (sandboxResult.message) showToast(sandboxResult.message);
        return;
      }
    }

    const clearCatalogFilters = target.closest('[data-clear-catalog-filters]');
    if (clearCatalogFilters) {
      setSearchQuery('');
      setCategory('all');
      resetCatalogFilters();
      if (activeView !== 'catalog') setActiveView('catalog');
      return;
    }

    if (target.closest('[data-reset-catalog-filters]')) {
      resetCatalogFilters();
      return;
    }

    // "Aplicar" cierra el bottom sheet. El filtrado ya ocurrió al cambiar cada
    // <select>: no hay un segundo estado que confirmar, y fabricar uno sería
    // inventar un paso que la lógica no tiene.
    if (target.closest('[data-close-catalog-filters]')) {
      const panel = target.closest('[data-catalog-filters]');
      if (panel) panel.open = false;
      return;
    }

    // "Limpiar búsqueda" deshace exactamente la causa del vacío: la consulta.
    // La categoría elegida se conserva.
    const clearSearch = target.closest('[data-clear-search]');
    if (clearSearch) {
      setSearchQuery('');
      if (activeView !== 'catalog') setActiveView('catalog');
      return;
    }

    // "Buscar en todo" conserva la consulta y suelta el filtro de categoría.
    const searchEverywhere = target.closest('[data-search-everywhere]');
    if (searchEverywhere) {
      setCategory('all');
      if (activeView !== 'catalog') setActiveView('catalog');
      return;
    }

    // ─── Historias comerciales ───────────────────────────────────────────────
    // Todo el bloque es inerte sin historias publicadas: `showStoriesModal`
    // devuelve `false` y no se abre nada.
    const storiesOpen = target.closest('[data-stories-open]');
    if (storiesOpen) {
      event.preventDefault();
      showStoriesModal(0, storiesOpen);
      return;
    }

    if (target.closest('[data-close-stories]')) {
      closeStoriesModal();
      return;
    }

    if (target.closest('[data-story-prev]')) {
      stepStoriesModal(-1);
      return;
    }

    if (target.closest('[data-story-next]')) {
      stepStoriesModal(1);
      return;
    }

    // La CTA de una historia se resuelve contra acciones que YA existen. No hay
    // navegación externa ni destinos nuevos: producto, categoría o alta al
    // carrito, exactamente lo que el contrato admite.
    const storyCta = target.closest('[data-story-cta]');
    if (storyCta) {
      const action = storyCta.dataset.storyAction;
      const storyTarget = storyCta.dataset.storyTarget || '';
      closeStoriesModal();
      if (action === 'category') {
        setCategory(storyTarget);
        setActiveView('catalog');
      } else if (action === 'product') {
        showProductModal(storyTarget);
      } else if (action === 'add') {
        const result = addToCart(storyTarget, 1);
        showToast(result.message);
        renderAll();
      }
      return;
    }

    const navView = target.closest('[data-nav-view]')?.dataset.navView;
    if (navView) {
      event.preventDefault();
      if (normalizeView(navView) === 'profile') {
        clearProfileReturnTarget();
      }
      setActiveView(navView);
      return;
    }

    // Puerta de MARCA (banner editorial). El destino no es una ruta nueva: es
    // exactamente la búsqueda que escribiría el cliente, resuelta contra el
    // catálogo real. La categoría se suelta para que la marca se vea completa
    // aunque tenga productos en más de un rubro.
    const brandQuery = target.closest('[data-brand-query]')?.dataset.brandQuery;
    if (brandQuery) {
      setCategory('all');
      setSearchQuery(brandQuery);
      if (activeView !== 'catalog') setActiveView('catalog');
      return;
    }

    const categoryId = target.closest('[data-category-id]')?.dataset.categoryId;
    if (categoryId) {
      setCategory(categoryId);
      if (activeView !== 'catalog') setActiveView('catalog');
      return;
    }

    // El detalle del combo va ANTES que el de producto: el botón que abre un
    // componente desde el combo cierra primero su propia hoja, y si el orden
    // fuera el inverso quedarían los dos diálogos abiertos a la vez.
    const comboComponentId = target.closest('[data-combo-open-component]')?.dataset.comboOpenComponent;
    if (comboComponentId) {
      closeComboModal();
      showProductModal(comboComponentId);
      return;
    }

    if (target.closest('[data-close-combo-modal]')) {
      closeComboModal();
      return;
    }

    const comboId = target.closest('[data-combo-detail]')?.dataset.comboDetail;
    if (comboId) {
      showComboModal(comboId, target.closest('[data-combo-detail]'));
      return;
    }

    const detailId = target.closest('[data-product-detail]')?.dataset.productDetail;
    if (detailId) {
      showProductModal(detailId, target.closest('[data-product-detail]'));
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

    if (target.closest('[data-checkout-suggestions-dismiss]')) {
      dismissCheckoutSuggestions();
      closeCheckoutSuggestions();
      $('[data-checkout-form]')?.requestSubmit();
      return;
    }

    const addControl = target.closest('[data-add-product]');
    const addId = addControl?.dataset.addProduct;
    if (addId) {
      if (isProductionOrderingBlocked()) {
        showToast('El catálogo verificado todavía no está disponible.');
        return;
      }
      const modal = addControl.closest('[data-product-modal]');
      const selectedVariant = modal?.querySelector('[data-product-variant]:checked')?.value;
      const selectedProductId = selectedVariant || addId;
      const requestedQuantity = modal
        ? Number(modal.querySelector('[data-product-quantity]')?.value || 1)
        : 1;
      const productNote = String(modal?.querySelector('[data-product-note]')?.value || '').trim();
      const result = runCartAction('add', selectedProductId, () => addToCart(selectedProductId, requestedQuantity));
      if (!result.duplicate) showToast(result.message);
      if (result.ok) {
        if (productNote) appendProductObservation(selectedProductId, productNote);
        closeProductModal();
        pulseCartFeedback();
      }
      return;
    }

    // Combos: el botón sólo existe cuando el backend puede cobrar el combo a su
    // precio de combo, así que acá no hace falta volver a decidirlo; lo que sí
    // se revalida es el stock compartido con las líneas sueltas.
    const addComboId = target.closest('[data-add-combo]')?.dataset.addCombo;
    if (addComboId) {
      if (isProductionOrderingBlocked()) {
        showToast('El catálogo verificado todavía no está disponible.');
        return;
      }
      const result = runCartAction('add-combo', addComboId, () => addComboToCart(addComboId, 1));
      if (!result.duplicate) showToast(result.message);
      if (result.ok) {
        closeComboModal();
        pulseCartFeedback();
      }
      return;
    }

    const comboIncId = target.closest('[data-combo-increment]')?.dataset.comboIncrement;
    if (comboIncId) {
      const result = runCartAction('inc-combo', comboIncId, () => addComboToCart(comboIncId, 1));
      if (result.ok) pulseCartFeedback();
      if (!result.duplicate) showToast(result.message);
      return;
    }

    const comboDecId = target.closest('[data-combo-decrement]')?.dataset.comboDecrement;
    if (comboDecId) {
      const result = runCartAction('dec-combo', comboDecId, () => decrementComboItem(comboDecId));
      if (!result.ok && !result.duplicate) showToast(result.message);
      return;
    }

    const incId = target.closest('[data-cart-inc]')?.dataset.cartInc;
    if (incId) {
      const result = runCartAction('inc', incId, () => incrementCartItem(incId));
      if (result.ok) {
        pulseCartFeedback();
        refreshOpenProductModal(incId);
      }
      if (!result.duplicate) showToast(result.message);
      return;
    }

    const decId = target.closest('[data-cart-dec]')?.dataset.cartDec;
    if (decId) {
      const result = runCartAction('dec', decId, () => decrementCartItem(decId));
      if (result.ok) refreshOpenProductModal(decId);
      if (!result.ok && !result.duplicate) showToast(result.message);
      return;
    }

    const removeId = target.closest('[data-cart-remove]')?.dataset.cartRemove;
    if (removeId) {
      removeCartItem(removeId);
      showToast('Producto quitado del pedido.');
      return;
    }

    if (target.closest('[data-clear-cart]')) {
      if (getState().cart.length || getState().comboSelections.length) openClearCartModal();
      return;
    }

    if (target.closest('[data-clear-cart-confirm]')) {
      const result = clearCart();
      closeClearCartModal();
      showToast(result.message || 'Carrito vaciado.');
      return;
    }

    if (target.closest('[data-clear-cart-dismiss]')) {
      closeClearCartModal();
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
      if (!isDemoMode()) return;
      pendingAdminTarget = normalizeView(pinTarget);
      openPinModal();
      return;
    }

    // Accesos directos del home (tarjetas Cliente/Negocio/Rider): atributo propio
    // para no duplicar el selector [data-open-pin][data-admin-target] que ya usan
    // los tests sobre la tarjeta de bloqueo dentro de cada vista de admin.
    const homePinTarget = target.closest('[data-home-open-pin]')?.dataset.homeOpenPin;
    if (homePinTarget) {
      if (!isDemoMode()) return;
      pendingAdminTarget = normalizeView(homePinTarget);
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

    if (target.closest('[data-open-pitch]')) {
      if (getAppMode() === APP_MODE_PRODUCTION || getAppMode() === APP_MODE_UNAVAILABLE) return;
      openPitchModal();
      return;
    }

    if (target.closest('[data-close-pitch]')) {
      closePitchModal();
      return;
    }

    // CTAs de la presentación comercial: cierran el pitch y llevan a la vista
    // pedida (o abren WhatsApp para coordinar la implementación de PedidoPropio).
    const pitchGo = target.closest('[data-pitch-go]')?.dataset.pitchGo;
    if (pitchGo) {
      closePitchModal();
      if (pitchGo === 'whatsapp') {
        const digits = String(getBusinessConfig().whatsappNumber || '').replace(/\D/g, '');
        if (digits) {
          window.open(`https://wa.me/${digits}?text=${encodeURIComponent(BRAND.contactWhatsappMessage)}`, '_blank', 'noopener,noreferrer');
        } else {
          showToast('Configurá el WhatsApp del comercio para habilitar este contacto.');
        }
        return;
      }
      if (pitchGo === 'business' || pitchGo === 'rider') {
        openAdminArea(pitchGo);
        return;
      }
      setActiveView(normalizeView(pitchGo));
      return;
    }

    // Una excepción acá (IndexedDB bloqueada, storage en modo privado) no debe
    // convertirse en un unhandledrejection que pinte el panel de recuperación
    // de arranque encima de un panel sano: se degrada a un toast honesto.
    let productionResult;
    try {
      productionResult = await Promise.resolve(handleProductionOperationsAction(target));
    } catch (error) {
      showToast(error?.message || 'La acción no se pudo completar. Reintentá.');
      return;
    }
    if (productionResult.handled) {
      if (productionResult.message) showToast(productionResult.message);
      return;
    }

    if (isDemoMode()) {
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
    }
  });

  // Búsqueda: hay un buscador en Home y otro en Catálogo (ambos data-search-input).
  document.addEventListener('input', (event) => {
    const checkoutField = event.target?.closest?.('[data-checkout-form] [name]');
    if (checkoutField) {
      clearCheckoutFieldError(checkoutField);
      const warning = checkoutField.closest('[data-checkout-form]')?.querySelector('[data-checkout-warning]');
      if (warning) {
        warning.textContent = '';
        warning.hidden = true;
        warning.classList.add('hidden');
      }
    }

    const businessInput = isDemoMode() ? handleBusinessInput(event.target) : handleProductionOperationsInput(event.target);
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
      setActiveView('catalog', { scroll: false, focus: false });
      // El estado compartido hidrata el buscador del catálogo antes de enfocarlo.
      setTimeout(() => {
        const catalogSearch = $('[data-view="catalog"] [data-search-input]');
        if (!catalogSearch) return;
        catalogSearch.focus();
        catalogSearch.setSelectionRange(catalogSearch.value.length, catalogSearch.value.length);
      }, 0);
    }
  });

  document.addEventListener('change', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    const productionInput = handleProductionOperationsInput(target);
    if (productionInput.handled) return;
    if (target.matches('[data-product-variant]')) {
      showProductModal(target.value);
      return;
    }
    const sandboxResult = await handleSandboxToolsChange(target);
    if (sandboxResult.handled) {
      if (sandboxResult.message) showToast(sandboxResult.message);
      return;
    }
    if (target.closest('[data-checkout-form]')) {
      clearCheckoutFieldError(target);
      const warning = target.closest('[data-checkout-form]')?.querySelector('[data-checkout-warning]');
      if (warning) {
        warning.textContent = '';
        warning.hidden = true;
        warning.classList.add('hidden');
      }
    }
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
    if (target.matches('[data-catalog-filter]')) {
      setCatalogFilter(target.dataset.catalogFilter, target.value || 'all');
    }
    const deliveryChange = isDemoMode()
      ? await Promise.resolve(handleDeliveryChange(target))
      : { handled: false };
    if (deliveryChange.handled) {
      showToast(deliveryChange.message);
    }
  });

  document.addEventListener('submit', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLFormElement)) return;
    if (target.matches('[data-production-auth-form]')) {
      event.preventDefault();
      const result = await handleProductionAuthSubmit(target);
      if (result.message) showToast(result.message);
      return;
    }
    if (!target.matches('[data-business-setup-form]')) return;
    event.preventDefault();
    if (!isDemoMode()) return;
    const result = submitBusinessSetupForm();
    if (result?.ok) {
      showToast(result.message);
    }
  });

  // CTA principal: confirma el pedido interno y lleva a Tracking. NO abre WhatsApp.
  let confirming = false;
  $('[data-checkout-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    clearCheckoutInlineError(form);
    if (isProductionOrderingBlocked()) {
      const message = 'Los pedidos online todavía no están disponibles.';
      showCheckoutInlineError(form, message);
      showToast(message);
      return;
    }
    // P1-3 (auditoría comercial): acá vivía la compuerta del modal de
    // sugerencias, que interceptaba el PRIMER tap de pagar ANTES de validar el
    // pedido — con el carrito bajo el mínimo ofrecía packs y recién después
    // mostraba el error real. El rail "RECOMENDADOS PARA VOS" del carrito ya
    // ofrece las mismas sugerencias a la vista, así que el modal salió del
    // flujo principal: Confirmar valida y confirma; nunca vende antes de
    // validar. El markup del diálogo y sus cierres quedan inertes por si una
    // superficie futura lo reutiliza DESPUÉS de una validación exitosa.
    if (confirming) return; // evita doble confirmación / doble pedido
    confirming = true;
    const button = event.currentTarget.querySelector('[type="submit"]');
    const originalLabel = button?.textContent;
    if (button) {
      button.disabled = true;
      button.textContent = 'Creando pedido…';
    }
    form.dataset.motionBusy = 'true';
    try {
      const values = {
        ...getCheckoutFormValues(),
        previewOnly: getAppMode() === APP_MODE_PUBLIC,
      };
      if (values.paymentMethod === 'mercadopago') {
        if (button) button.textContent = 'Preparando pago…';
        const result = await Promise.resolve(getOrderRepository().createMercadoPagoCheckout?.(values));
        if (!result?.ok || !result.initPoint) {
          const message = result?.message || 'No pudimos preparar Mercado Pago. Conservamos tu carrito para que vuelvas a intentar.';
          showCheckoutInlineError(form, message);
          showToast(message);
          return;
        }
        if (button) button.textContent = 'Te llevamos a Mercado Pago…';
        showToast('Te llevamos a Mercado Pago para completar el pago de forma segura.');
        window.location.assign(result.initPoint);
        return;
      }
      const result = await Promise.resolve(getOrderRepository().createOrder(values));

      if (!result.ok) {
        showCheckoutInlineError(form, result.message);
        showToast(result.message);
        return;
      }

      let profilePersistence = { ok: true };
      try {
        profilePersistence = await persistCustomerProfileAfterOrder(values);
      } catch (_) {
        // La venta ya fue confirmada por la RPC de pedidos; un guardado opcional
        // de perfil nunca puede convertirla en un error de checkout.
        profilePersistence = { ok: false };
      }
      showToast(profilePersistence.ok
        ? 'Pedido confirmado. Seguilo en Seguimiento.'
        : 'Pedido confirmado. No pudimos guardar tus datos para próximos pedidos.');
      setActiveView('tracking');
    } catch (_) {
      const message = 'No se pudo crear el pedido. Reintentá.';
      showCheckoutInlineError(form, message);
      showToast(message);
    } finally {
      confirming = false;
      if (button) {
        button.disabled = isProductionOrderingBlocked();
        button.textContent = originalLabel || checkoutModeCopy(getAppMode()).submit;
      }
      delete form.dataset.motionBusy;
    }
  });

  // Acción secundaria: enviar una copia por WhatsApp (no crea otro pedido).
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('[data-retry-relay]')) {
      if (!isDemoMode()) return;
      const result = retryRelayConnection();
      showToast(result.message);
      renderLiveSurfaces();
      return;
    }
    // Dos controles, la misma acción: el botón de recentrar que está siempre, y
    // el «Volver al Rider» que aparece sólo cuando el cliente exploró el mapa.
    if (target.closest('[data-map-recenter], [data-map-follow-cta]')) {
      recenterMapViews();
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
        .then(() => showToast('Dirección copiada para el rider.'))
        .catch(() => showToast('No se pudo copiar la dirección.'));
      return;
    }
    const clientLink = target.closest('[data-copy-client-link]');
    const riderLink = target.closest('[data-copy-rider-link]');
    if (clientLink || riderLink) {
      const status = getRealtimeStatus();
      if (!status.relayEnabled || !status.relayBase || !status.roomKey) {
        showToast('Abrí la app con ?relay=…&room=…&key=… para compartir links.');
        return;
      }
      const base = `${status.relayBase}/?demo=1&relay=${encodeURIComponent(status.relayBase)}&room=${encodeURIComponent(status.room)}&key=${encodeURIComponent(status.roomKey)}`;
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
    if (!isDemoMode()) {
      closePinModal();
      return;
    }
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

  $('[data-checkout-suggestions-modal]')?.addEventListener('click', (event) => {
    if (event.target !== event.currentTarget) return;
    dismissCheckoutSuggestions();
    closeCheckoutSuggestions();
  });

  $('[data-checkout-suggestions-modal]')?.addEventListener('cancel', () => {
    dismissCheckoutSuggestions();
  });

  $('[data-pin-modal]')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closePinModal();
  });

  $('[data-pitch-modal]')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closePitchModal();
  });

  $('[data-clear-cart-modal]')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeClearCartModal();
  });
}

function appendProductObservation(productId, note) {
  const field = document.querySelector('[name="customerNotes"]');
  if (!field) return;
  const product = getState().products.find((item) => item.id === productId);
  const line = `${product?.name || 'Producto'}: ${String(note).slice(0, 120)}`;
  const current = String(field.value || '').trim();
  field.value = [current, line].filter(Boolean).join('\n').slice(0, Number(field.maxLength || 500));
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

let pendingAdminTarget = null;

function toggleAdminMode() {
  if (!isDemoMode()) {
    setActiveView(getAppMode() === APP_MODE_PRODUCTION ? 'business' : 'home');
    return;
  }
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
  if (!isDemoMode()) return;
  if (getState().adminUnlocked) {
    return;
  }
  pendingAdminTarget = view;
  openPinModal();
}

function normalizeView(view) {
  const key = String(view || '').replace(/^#/, '').trim().toLowerCase();
  const normalized = VIEW_ALIASES[key] || key;
  const safe = VIEWS.includes(normalized) ? normalized : 'home';
  return isOperationalView(safe) ? 'home' : safe;
}

function viewFromHash() {
  return normalizeView(window.location.hash.slice(1));
}

function configureViewScrollRestoration() {
  try {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
  } catch (_) {
    // Un navegador sin esta API sigue usando el reset explícito de cada vista.
  }
}

function resetPageScroll() {
  const reset = () => {
    const scroller = document.scrollingElement || document.documentElement;
    scroller.scrollTop = 0;
    scroller.scrollLeft = 0;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  };
  reset();
  requestAnimationFrame(reset);
}

function setActiveView(view, options = {}) {
  const nextView = normalizeView(view);
  const changed = nextView !== activeView;
  activeView = nextView;
  if (nextView !== 'profile') {
    clearProfileReturnTarget();
  }

  if (options.writeHash !== false) {
    writeViewHash(nextView, options.replace === true);
  }

  syncGpsSharingWithView(nextView);
  renderAll();
  window.dispatchEvent(new CustomEvent('taba:realtime-view-enter', { detail: { view: nextView } }));
  if (changed) playViewEnter(nextView);

  if (changed && options.scroll !== false) {
    resetPageScroll();
  }
  if (changed && options.focus !== false) focusActiveViewHeading(nextView);
}

function syncViewFromLocation() {
  const nextView = viewFromHash();
  if (nextView === activeView) return;
  activeView = nextView;
  syncGpsSharingWithView(nextView);
  renderAll();
  window.dispatchEvent(new CustomEvent('taba:realtime-view-enter', { detail: { view: nextView } }));
  playViewEnter(nextView);
  resetPageScroll();
  focusActiveViewHeading(nextView);
}

function focusActiveViewHeading(view) {
  if (typeof document === 'undefined') return;
  requestAnimationFrame(() => {
    const section = document.querySelector(`[data-view="${view}"]`);
    const heading = section?.querySelector('h1:not(.sr-only), h2:not(.sr-only)')
      || section?.querySelector('h1');
    if (!(heading instanceof HTMLElement) || section.hidden) return;
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  });
}

function syncGpsSharingWithView(view) {
  // La ubicación se comparte sólo mientras el rider conserva su vista activa.
  // Los dos motores (demo y Supabase) mantienen watchers independientes.
  if (view === 'rider') {
    handleViewChangeForSimulation(view);
  } else {
    disableGpsTracking({ silent: true });
  }
  handleProductionOperationsViewChange(view);
  if (view !== 'tracking') syncCustomerTrackingWithView('');
}

function syncCustomerTrackingWithView(view) {
  const repository = getOrderRepository();
  if (typeof repository?.setCustomerTrackingView !== 'function') return;
  if (getAppMode() !== APP_MODE_PRODUCTION || view !== 'tracking') {
    repository.setCustomerTrackingView({ active: false });
    return;
  }
  const order = getActiveOrder();
  if (!order || order.deliveryMode !== 'delivery') {
    repository.setCustomerTrackingView({ active: false });
    return;
  }
  repository.setCustomerTrackingView({
    active: true,
    orderId: order.backendId || order.id || order.code,
    status: order.workflowStatus || order.status,
  });
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

// Presentación comercial de PedidoPropio. Sólo se abre a pedido: con ?pitch=1 en
// la URL (link para mandar a un comercio), desde la franja "Ver cómo funciona" del
// home, o desde "¿Qué es PedidoPropio?" en Local. Nunca aparece sola, así no
// molesta a clientes recurrentes que sólo quieren pedir.
function maybeOpenPitchFromUrl() {
  if ([APP_MODE_PRODUCTION, APP_MODE_UNAVAILABLE].includes(getAppMode())) return;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('pitch') === '1' || params.has('presentacion')) openPitchModal();
  } catch (_) { /* sin URL API: seguimos sin presentación */ }
}

function openPitchModal() {
  const modal = $('[data-pitch-modal]');
  if (modal && typeof modal.showModal === 'function' && !modal.open) modal.showModal();
}

function closePitchModal() {
  const modal = $('[data-pitch-modal]');
  if (modal?.open) modal.close();
}

function openPinModal() {
  if (!isDemoMode()) return;
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

// Onboarding de instalación PWA. No dispara ningún prompt automático: sólo
// reacciona a beforeinstallprompt (que ya decide el navegador si ofrecer) y
// muestra guías propias. Nunca se muestra si la app ya corre en standalone.
function initPwaInstall() {
  let deferredPrompt = null;
  const installBanner = $('[data-pwa-install-banner]');
  const iosBanner = $('[data-pwa-ios-banner]');
  const offlineBanner = $('[data-pwa-offline-banner]');

  const showInstallBanner = () => {
    if (!installBanner || isInstallBannerDismissed()) return;
    if (!shouldShowAndroidInstallCta({ hasDeferredPrompt: deferredPrompt })) return;
    installBanner.hidden = false;
  };
  const hideInstallBanner = () => { if (installBanner) installBanner.hidden = true; };

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
  });

  // No interrumpimos el primer recorrido con un modal de instalación. Queda
  // disponible para una acción explícita de la interfaz si se incorpora luego.
  window.addEventListener('taba:request-install', showInstallBanner);

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hideInstallBanner();
  });

  $('[data-pwa-install-action]')?.addEventListener('click', async () => {
    if (!deferredPrompt) { hideInstallBanner(); return; }
    hideInstallBanner();
    try {
      await deferredPrompt.prompt();
    } catch (_) {
      // El usuario cerró el prompt nativo o el navegador lo bloqueó: no pasa nada.
    }
    deferredPrompt = null;
  });

  $('[data-pwa-install-dismiss]')?.addEventListener('click', () => {
    dismissInstallBanner();
    hideInstallBanner();
  });

  // iPhone/iPad Safari: no hay beforeinstallprompt, así que mostramos una
  // guía propia sólo cuando corresponde (Safari en iOS, no instalada ya).
  window.addEventListener('taba:request-ios-install-guide', () => {
    if (iosBanner && !isIOSGuideDismissed() && shouldShowIOSInstallGuide()) {
      iosBanner.hidden = false;
    }
  });
  $('[data-pwa-ios-dismiss]')?.addEventListener('click', () => {
    dismissIOSGuide();
    if (iosBanner) iosBanner.hidden = true;
  });

  // Aviso honesto de conexión: no promete que pedidos/tracking/GPS sigan
  // funcionando sin internet, sólo informa el estado real de la red.
  if (offlineBanner) {
    const updateOfflineBanner = () => { offlineBanner.hidden = navigator.onLine; };
    updateOfflineBanner();
    window.addEventListener('online', updateOfflineBanner);
    window.addEventListener('offline', updateOfflineBanner);
  }

  // Si ya está instalada (standalone), no mostramos ningún banner de instalación.
  if (isStandaloneDisplay()) {
    hideInstallBanner();
    if (iosBanner) iosBanner.hidden = true;
  }
}

bootstrap();
