import {
  addComboToCart,
  addToCart,
  clearCart,
  decrementCartItem,
  decrementComboItem,
  incrementCartItem,
  removeCartItem,
  removeComboItem,
  repeatCustomerOrder,
  setCartItemQuantity,
} from './cart.js';
import {
  applyBusinessConfig,
  closeCheckoutSuggestions,
  closeComboModal,
  closeProductModal,
  clearAddedFlash,
  closeStoriesModal,
  copyDraftOrderToClipboard,
  flashAddedProduct,
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
  setComboCheckoutAvailability,
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
import { onBrowserResume } from './core/browser-resume.js';
import { relayStatusLabel } from './core/realtime-sync.js';
// El back office —negocio, reparto, producción y sandbox— entra recién cuando
// hace falta. Para un cliente eran 759 KB de descarga que nunca se renderizaban.
// La trampa que costó encontrar está explicada en js/back-office.js.
import {
  alEntrarBackOffice,
  backOfficePresente,
  handleBusinessAction,
  handleBusinessInput,
  handleDeliveryAction,
  handleDeliveryChange,
  handleProductionAuthSubmit,
  handleProductionOperationsAction,
  handleProductionOperationsInput,
  handleProductionOperationsPageHide,
  handleProductionOperationsViewChange,
  handleSandboxToolsAction,
  handleSandboxToolsChange,
  initProductionOperations,
  lockAdmin,
  renderBusinessDashboard,
  renderDeliveryPanel,
  renderProductionOperations,
  renderSandboxTools,
  sincronizarBackOffice,
  submitBusinessSetupForm,
  unlockAdmin,
} from './back-office.js';
import {
  disableGpsTracking,
  handleGpsVisibilityChange,
  handleViewChangeForSimulation,
  resumeSimulationIfNeeded,
} from './simulation.js';
import {
  getRealtimeStatus,
  initRealtime,
  onRealtimeStatusChange,
  resolveRelayBase,
  retryRelayConnection,
} from './realtime.js';
import { recenterMapViews, renderMapViews } from './map/map_view.js';
import { activeTrackingLiveness } from './map/route_geometry.js';
import {
  getOrderRepository,
  getRepositoryDiagnostic,
  isSandboxOrderRepository,
  startOrderRepositorySync,
} from './repositories/repository_factory.js';
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
import { hapticFeedback } from './core/haptics.js';
import {
  initializeCustomerDeliveryCheckout,
  persistCustomerProfileAfterOrder,
  consumeProfileReturnTarget,
} from './customer-delivery.js';
import { initializeCustomerProfileView } from './customer-profile-view.js';
import { isStandaloneDisplay } from './core/pwa-install.js';
import { initPwaInstall } from './pwa-install-ui.js';
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

// La ruta con la que se abrió la pestaña, con su motivo. Se guarda acá porque
// el arranque necesita saber si el inicio es el que se pidió o el que quedó
// después de no poder servir el link, y para cuando pueda avisarlo la vista ya
// está resuelta.
const initialRoute = resolveRoute(window.location.hash.slice(1));
let activeView = initialRoute.view;
let lastLivenessSignature = '';
let freshnessTimer = null;
// El controlador de la invitación a instalar. Vive fuera de `bootstrap()`
// porque se cablea temprano —para no perderse `beforeinstallprompt`— y recién
// se le avisa que puede invitar cuando la tienda terminó de armarse.
let pwaInstall = null;
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
  const resultado = callback();
  /*
   * Poner algo en el carrito es el momento en que la invitación a instalar deja
   * de ser un favor y pasa a ser útil: la persona ya sabe qué es esta tienda.
   * Antes se abría sola 2,5 s después de cargar, o sea antes del primer precio.
   */
  if (action === 'add' && resultado?.ok) pwaInstall?.notifyPurchaseIntent();
  return resultado;
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
  // El valor CRUDO de la URL no se toca: esta función hacía `fetch` contra
  // `params.get('relay')` sin pasar por ninguna compuerta, así que un enlace
  // preparado conseguía por acá lo mismo que por el canal del relay. Ahora usa
  // la misma resolución que el transporte —mismo origen, o loopback sólo en
  // desarrollo— y si el valor no la pasa, no se llama a nadie.
  const relay = resolveRelayBase(params.get('relay'));
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
    markDisplayMode();
    initConnectivityNotice();
    // Se cablea acá, con la tienda recién pintada, porque `beforeinstallprompt`
    // llega temprano y perdérselo es perder la instalación de esa visita. La
    // invitación en sí no se abre todavía: espera a `notifyAppReady()`.
    pwaInstall = initPwaInstall({ showToast });
    // Diagnóstico local para QA, igual que `TABA2_MOTION`: no forma parte de
    // ningún contrato ni cambia el estado de la tienda.
    window.TABA_PWA_INSTALL = pwaInstall;
    if (resetRequested) {
      if (await maybeResetDemoSession()) return;
    }
    // Recién acá: la tienda ya está pintada, así que el aviso llega sobre algo
    // usable y no sobre una pantalla a medio armar.
    recoverFromUnservedRoute(initialRoute.status);
    // Cuando el panel entra —siempre tarde, porque se difiere— hay que darle su
    // primer pintado: su superficie estuvo vacía mientras no estaba. Se pinta
    // SÓLO ella. Un renderAll() acá vuelve a dibujar la góndola y el carrito
    // encima de lo que la persona esté haciendo en ese instante, y eso se ve
    // —y se rompe— como un parpadeo que reordena la lista bajo el dedo.
    alEntrarBackOffice(() => {
      if (isDemoMode()) {
        renderBusinessDashboard();
        renderDeliveryPanel();
      }
      renderProductionOperations();
      renderSandboxTools();
      renderMapViews();
    });
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
      // La tienda YA pintó y se puede usar. Abrir acá el panel de recuperación
      // ponía "No pudimos abrir la tienda" encima de una tienda abierta, y al
      // mismo tiempo un aviso que decía que se podía seguir. Se avisa por el
      // canal que corresponde y se deja seguir comprando.
      console.warn('[TABA] sincronización de pedidos no disponible en el arranque', error);
      showToast('No pudimos recuperar tus pedidos anteriores. Podés seguir comprando.');
    }
    // Antes se preguntaba acá si Mercado Pago está disponible, y esa pregunta
    // pide una sesión: o sea que abrir la home creaba una identidad anónima.
    // Ahora se pregunta al entrar al carrito, que es cuando la respuesta se usa.
    await initializeCustomerDeliveryCheckout();
    await initializeCustomerProfileView();
    initializeShowcase();
    // Si la pestaña se abrió DIRECTO en el carrito, `setActiveView` no llegó a
    // correr y la pregunta no se hizo. Es el único caso donde el arranque sí
    // tiene que hacerla: ahí ya hay alguien mirando su pedido.
    if (activeView === 'cart') await refreshMercadoPagoCheckoutAvailability();
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
    // Recién ahora: la tienda está armada y usable. Si el arranque hubiera
    // fallado, esta línea no se alcanza y nadie recibe una invitación encima de
    // una pantalla rota.
    pwaInstall?.notifyAppReady();
  } catch (error) {
    setAppBootstrapState('error');
    window.TABA_STARTUP_RECOVERY?.show({
      reason: /storage|indexeddb|base sandbox/i.test(error?.message || '') ? 'storage' : 'startup',
    });
    // Evita pantalla en blanco si algo falla en el primer render.
    showToast('Hubo un problema al iniciar. Recargá la página.');
  }
}

/*
 * Mercado Pago decide dos cosas, no una.
 *
 * La primera es la opción del selector de pago. La segunda es si se pueden
 * OFRECER combos: en producción el precio de un combo lo calcula Checkout Pro y
 * la ruta directa de pedidos rechaza el carrito que trae uno, así que sin
 * Mercado Pago un combo en góndola es un camino sin salida.
 *
 * Fuera de producción no aplica: el repositorio de demostración arma y cobra el
 * combo por su cuenta, y los combos siguen funcionando como siempre.
 */
async function refreshMercadoPagoCheckoutAvailability() {
  const declarar = (disponible) => {
    setMercadoPagoCheckoutAvailability({ available: disponible });
    setComboCheckoutAvailability({
      available: getAppMode() !== APP_MODE_PRODUCTION || disponible,
    });
  };
  if (getAppMode() !== APP_MODE_PRODUCTION) {
    declarar(false);
    return;
  }
  const repository = getOrderRepository();
  if (typeof repository?.getMercadoPagoCheckoutAvailability !== 'function') {
    declarar(false);
    return;
  }
  try {
    const result = await repository.getMercadoPagoCheckoutAvailability();
    declarar(Boolean(result?.ok && result.available === true));
  } catch (_) {
    declarar(false);
  }
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  throw new Error('clipboard unavailable');
}

/*
 * ¿Hace falta el back office en esta pantalla? Sólo si la persona está en una
 * vista operativa, o el modo es demo/showcase, o el repositorio es el de
 * sandbox. Un cliente comprando en producción no cae en ninguno de los tres, y
 * por eso no descarga esas pantallas.
 */
function asegurarBackOffice() {
  if (backOfficePresente()) return true;
  // Primero lo barato y sin efectos. `getOrderRepository()` inicializa el
  // repositorio la primera vez que se lo pide, y este punto corre al principio
  // de CADA render: preguntarle de entrada adelantaba esa inicialización a
  // antes de que la demo terminara de sembrar su perfil, y la dirección
  // predeterminada llegaba tarde al encabezado.
  if (['business', 'rider'].includes(activeView) || isDemoMode() || isShowcaseMode()) {
    return sincronizarBackOffice({ vistaOperativa: true });
  }
  let sandbox = false;
  try {
    sandbox = isSandboxOrderRepository(getOrderRepository());
  } catch (_) {
    sandbox = false;
  }
  return sincronizarBackOffice({ sandbox });
}

function renderAll() {
  asegurarBackOffice();
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
  if (submit && !hayHandoffDePagoEnCurso()) submit.textContent = checkoutCopy.submit;
  const trustTitle = document.querySelector('[data-checkout-trust-title]');
  if (trustTitle) trustTitle.textContent = checkoutCopy.title;
  const trustCopy = document.querySelector('[data-checkout-trust-copy]');
  if (trustCopy) trustCopy.textContent = checkoutCopy.copy;
  const modeNote = document.querySelector('[data-checkout-mode-note]');
  if (modeNote) modeNote.textContent = checkoutCopy.note;

  applyProductionCatalogGate(mode);
  if (!production) setMercadoPagoCheckoutAvailability({ available: false });
  // Falla cerrada: en producción los combos arrancan apagados y sólo los
  // enciende la respuesta del proveedor. Al revés, entre el primer render y esa
  // respuesta la góndola ofrecería un combo que todavía no sabe si puede cobrar.
  setComboCheckoutAvailability({ available: !production });
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
      // «El pedido se registra en el sistema del comercio» describe una
      // escritura en una base de datos. Lo que la persona necesita saber antes
      // de tocar el botón es quién lo recibe y qué puede hacer después, que es
      // lo mismo que ya dice el modo demo y es igual de cierto en producción.
      title: 'Tu pedido va directo al local.',
      copy: 'Al confirmar, el local lo recibe y podés seguirlo desde Seguimiento.',
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
  if (submit && !hayHandoffDePagoEnCurso()) submit.disabled = blocked;
}

/*
 * Mientras el checkout está entregado a Mercado Pago, NINGÚN re-render puede
 * devolver el botón a «Confirmar pedido» habilitado.
 *
 * Se descubrió en WebKit: el guardián de la closure aguantaba —no se creaba una
 * segunda sesión de pago— pero a los ~3,3 s un re-render de modo pasaba por acá
 * y devolvía el botón a su estado normal. Funcionalmente estaba protegido y
 * visualmente decía lo contrario: la persona ve un botón disponible, lo toca, y
 * no pasa nada. Es la peor de las dos, porque invita al toque que el guardián
 * después ignora en silencio.
 *
 * El estado vive en el DOM justamente para que lo vea cualquier camino de
 * dibujado, no sólo el que lo puso.
 */
function hayHandoffDePagoEnCurso() {
  return document.querySelector('[data-checkout-form]')?.dataset.checkoutHandoff === 'mercadopago';
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

/**
 * Pinta el aviso del checkout y DEVUELVE el texto que quedó en pantalla.
 *
 * Devuelve, y no sólo pinta, porque acá adentro el mensaje puede cambiar —ver
 * el bloque de abajo— y el toast que lo acompaña tiene que decir exactamente lo
 * mismo. Dos mensajes distintos para el mismo rechazo es peor que uno malo.
 */
function showCheckoutInlineError(form, message) {
  if (!(form instanceof HTMLFormElement)) return String(message || '');
  clearCheckoutInlineError(form);
  const originalMessage = String(message || 'Revisá los datos del pedido e intentá nuevamente.');

  const fieldName = checkoutErrorFieldName(originalMessage);
  const field = fieldName ? form.elements.namedItem(fieldName) : null;
  const visibleField = field instanceof HTMLElement
    && !field.hidden
    && !field.closest('[hidden]')
    && field.getClientRects().length > 0;

  /*
   * Un mensaje que nombra un campo INVISIBLE no se puede obedecer.
   *
   * En el checkout con Perfil, el nombre, el teléfono y la dirección son campos
   * ocultos que llena el Perfil: la persona no los puede escribir acá. Este
   * bloque ya sabía que el campo no se ve —lo usaba para decidir a dónde llevar
   * el foco— y seguía imprimiendo la instrucción imposible. Ahora, cuando además
   * hay una tarjeta en pantalla que dice qué falta y tiene el botón que lo
   * resuelve, el aviso dice ESO y el foco va a ese botón.
   *
   * La condición es angosta a propósito: sólo cuando el rechazo apunta a un
   * campo que existe y no se ve. Un rechazo por stock, por sesión vencida o
   * porque el pedido cambió durante el envío no apunta a ningún campo y llega
   * intacto — taparlo con «completá tu Perfil» sería cambiar un mensaje
   * imposible por uno falso.
   */
  const bloqueo = fieldName && !visibleField ? bloqueoDePerfilEnCheckout(form) : null;
  const cleanMessage = bloqueo ? bloqueo.mensaje : originalMessage;

  const warning = form.querySelector('[data-checkout-warning]');
  if (warning) {
    warning.textContent = cleanMessage;
    warning.hidden = false;
    warning.classList.remove('hidden');
  }

  if (visibleField) {
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', [
      ...String(field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean),
      'checkout-error',
    ].filter((token, index, values) => values.indexOf(token) === index).join(' '));
    field.focus({ preventScroll: true });
    field.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return cleanMessage;
  }

  if (bloqueo?.accion instanceof HTMLElement) {
    bloqueo.bloque.scrollIntoView({ block: 'center', behavior: 'smooth' });
    bloqueo.accion.focus({ preventScroll: true });
    return cleanMessage;
  }

  warning?.focus({ preventScroll: true });
  warning?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return cleanMessage;
}

/*
 * EL CHECKOUT NO PUEDE PEDIR ALGO QUE ESTA PANTALLA NO SABE RECIBIR.
 *
 * Medido en producción el 2026-08-25, con un visitante nuevo: agregar una
 * bebida, abrir el carrito y tocar «Confirmar pedido» contestaba «Ingresá un
 * nombre de al menos 2 caracteres». En esa pantalla NO HAY ningún campo de
 * nombre: el nombre vive en Perfil. La persona lee una instrucción que no puede
 * obedecer y el pedido se pierde ahí. Es el camino del 100 % de los clientes
 * nuevos, que es exactamente a quien queremos convertir el fin de semana.
 *
 * La pantalla ya dice bien lo que falta —«Completá tu perfil para continuar»,
 * «Agregá una dirección para recibir el pedido»— en tarjetas con su botón. Esto
 * devuelve esa tarjeta; quien decide CUÁNDO usarla es `showCheckoutInlineError`,
 * y sólo lo hace si el rechazo apunta a un campo que la persona no puede ver.
 *
 * NO ES UNA COMPUERTA PREVIA, Y LA PRIMERA VERSIÓN SÍ LO ERA. Cortaba antes de
 * intentar el pedido y rompió el handoff de Mercado Pago: su suite completa el
 * nombre y el teléfono escribiendo los campos ocultos, así que la tarjeta de
 * Perfil seguía diciendo «incompleto» mientras el pedido era perfectamente
 * válido. Una compuerta que mira la TARJETA y un pedido que mira los CAMPOS
 * pueden discrepar —una hidratación a medio camino alcanza— y el precio de
 * discrepar es negarle la compra a alguien que sí podía comprar.
 *
 * Se lee del DOM y no del estado: quien dibuja esas tarjetas es
 * `customer-delivery.js`, que sostiene su propio estado de perfil y direcciones;
 * duplicar acá la regla de «qué falta» es garantizar que algún día las dos
 * digan cosas distintas. La tarjeta que está en pantalla es la verdad.
 */
const BLOQUEOS_DE_PERFIL = Object.freeze({
  incomplete: 'Completá tu nombre y teléfono en Perfil para confirmar el pedido.',
  'no-address': 'Agregá una dirección de entrega en Perfil para confirmar el pedido.',
  'no-confirmed-location': 'Confirmá el punto de entrega de tu dirección en Perfil para confirmar el pedido.',
  unsupported: 'Esta tienda todavía no toma pedidos por la app.',
});

function bloqueoDePerfilEnCheckout(form) {
  if (!(form instanceof HTMLFormElement)) return null;
  const bloque = form.querySelector('[data-profile-block]');
  if (!(bloque instanceof HTMLElement)) return null;
  if (bloque.hidden || bloque.closest('[hidden]') || bloque.getClientRects().length === 0) return null;
  const clase = String(bloque.dataset.profileBlock || '');
  const mensaje = BLOQUEOS_DE_PERFIL[clase]
    || String(bloque.querySelector('strong')?.textContent || '').trim()
    || 'Completá tus datos de entrega para confirmar el pedido.';
  return { clase, mensaje, bloque, accion: bloque.querySelector('[data-profile-checkout-action]') };
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
  window.addEventListener('taba:delivery-address-changed', (event) => {
    renderCustomerHome();
    // Y con el destino nuevo se vuelve a preguntar al backend si llegamos ahí y
    // con qué envío. No se calcula acá: se pregunta. Si la consulta falla, el
    // repositorio deja el estado en «no sé» y la tienda no afirma nada; quien
    // decide de verdad es el alta del pedido.
    const address = event?.detail?.address || null;
    const repository = getOrderRepository();
    if (typeof repository?.refreshCommerceAvailability !== 'function') return;
    repository.refreshCommerceAvailability({
      channel: 'delivery',
      latitude: address?.latitude ?? null,
      longitude: address?.longitude ?? null,
      neighborhood: address?.neighborhood || '',
    }).then(() => {
      renderCustomerHome();
      renderCart();
    }).catch(() => { /* el estado ya volvió a «no sé»: no hay nada que deshacer */ });
  });
  window.addEventListener('pagehide', () => {
    // Al ir a segundo plano Chrome puede descartar la pestaña del rider. Se
    // corta el watcher por privacidad, pero se conserva sólo el último fix
    // fresco como "Última ubicación" para que otra pestaña del mismo navegador
    // no pierda el contexto de golpe.
    //
    // El seguimiento del CLIENTE ya NO se apaga acá, y esa línea de menos es el
    // defecto que se veía como «Chrome en iPhone no actualiza».
    //
    // `setCustomerTrackingView({ active: false })` no pausa: destruye la sesión
    // de seguimiento y, de paso, desarma los propios listeners de reanudación
    // del controlador. Lo único que la volvía a armar era `pageshow`. En el
    // navegador que emite `pagehide` al suspenderse pero NO emite `pageshow` al
    // volver —porque no restaura desde la caché de retroceso, sino que sigue
    // con la misma página viva— quedaba apagado sin nada que lo encendiera. Y
    // como lo apagado era justamente lo que traía novedades, tampoco había un
    // cambio de estado que redibujara: se apagaba solo y no se prendía más.
    //
    // El controlador YA sabe estar en segundo plano: con el documento oculto
    // aborta la consulta en vuelo y deja de consultar. No hacía falta destruirlo.
    disableGpsTracking({ silent: true, preserveLastFix: true });
    handleProductionOperationsPageHide();
  });
  /*
   * Y la vuelta se escucha con TODAS las señales, no sólo con `pageshow`. Cuál
   * emite cada navegador es exactamente lo que no se puede asumir; ver
   * js/core/browser-resume.js.
   */
  onBrowserResume(() => syncCustomerTrackingWithView(activeView));
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
      // El emblema no declara índice y abre por la primera; cada círculo de la
      // fila abre EXACTAMENTE la historia que muestra. Un valor que no es un
      // número entero cae en 0 en vez de abrir un índice inventado.
      const requested = Number.parseInt(storiesOpen.dataset.storiesOpen ?? '', 10);
      showStoriesModal(Number.isInteger(requested) && requested >= 0 ? requested : 0, storiesOpen);
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
      // La marca se pone ANTES: `addToCart` repinta la tarjeta de forma
      // síncrona y, si se marcara después, el repintado ya habría pasado sin
      // la confirmación. Si la acción no prospera se retira, para que un
      // repintado posterior no confirme algo que no ocurrió.
      flashAddedProduct(selectedProductId);
      const result = runCartAction('add', selectedProductId, () => addToCart(selectedProductId, requestedQuantity));
      if (!result.ok) clearAddedFlash(selectedProductId);
      if (!result.duplicate) showToast(result.message);
      if (result.ok) {
        // Dentro del gesto: fuera de la activación del usuario el navegador
        // descarta la vibración. Donde no hay háptica no pasa nada.
        hapticFeedback('add');
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

    const comboRemoveId = target.closest('[data-combo-remove]')?.dataset.comboRemove;
    if (comboRemoveId) {
      const result = removeComboItem(comboRemoveId);
      if (!result.duplicate) showToast(result.message);
      return;
    }

    const incId = target.closest('[data-cart-inc]')?.dataset.cartInc;
    if (incId) {
      const result = runCartAction('inc', incId, () => incrementCartItem(incId));
      if (result.ok) {
        hapticFeedback('add');
        pulseCartFeedback();
        refreshOpenProductModal(incId);
      }
      if (!result.duplicate) showToast(result.message);
      return;
    }

    const decId = target.closest('[data-cart-dec]')?.dataset.cartDec;
    if (decId) {
      const result = runCartAction('dec', decId, () => decrementCartItem(decId));
      if (result.ok) {
        hapticFeedback('remove');
        refreshOpenProductModal(decId);
      }
      if (!result.ok && !result.duplicate) showToast(result.message);
      return;
    }

    // Salida del aviso de la línea: quita el producto agotado o recorta la
    // cantidad a lo que realmente queda. La cantidad viaja en el marcado, que
    // la calculó el mismo criterio que pintó el aviso.
    const fitControl = target.closest('[data-cart-fit]');
    if (fitControl) {
      const fitId = fitControl.dataset.cartFit;
      const fitQuantity = Number.parseInt(fitControl.dataset.cartFitQuantity ?? '0', 10);
      const result = setCartItemQuantity(fitId, Number.isInteger(fitQuantity) ? fitQuantity : 0);
      showToast(result.message);
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
    if (target.matches('[data-production-auth-form], [data-panel-signup-form], [data-panel-request-form], [data-panel-recovery-form]')) {
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
  /*
   * El handoff a Mercado Pago no termina este script.
   *
   * `window.location.assign()` PIDE la navegación y sigue: el documento vive
   * hasta que la nueva página compromete, y en un teléfono con red mala eso son
   * segundos. En ese hueco corría el `finally`, que devolvía el botón a
   * «Confirmar pedido» habilitado. Quien no ve reacción vuelve a tocar —es el
   * reflejo, no un error de la persona— y ese segundo toque creaba una SEGUNDA
   * sesión de pago: `createCheckoutClientRequestId()` devuelve un UUID nuevo en
   * cada llamada, así que la deduplicación por `client_request_id` del backend
   * no la ve. El dedo en `mercadoPagoCheckoutInFlight` tampoco: para cuando
   * llega el segundo toque, el primero YA terminó.
   *
   * Lo que dejaba atrás: otra fila en `checkout_sessions`, otra reserva en
   * `inventory_reservations` descontando stock, y —lo peor—
   * `writeMercadoPagoCheckoutRecord` pisando el registro local de recuperación,
   * que deja a la PRIMERA sesión huérfana: con el stock tomado y sin nada del
   * lado del cliente que sepa volver a buscarla.
   *
   * Mientras el checkout está entregado, el botón queda tomado. Se re-arma al
   * volver, con los mismos tres eventos que ya usa `pwa-update.js`: `pageshow`
   * cubre la vuelta con «atrás» —con y sin back-forward cache—, y `focus` y
   * `visibilitychange` cubren la vuelta desde otra aplicación, incluido el
   * navegador embebido que iOS abre encima de la PWA sin ocultar el documento.
   *
   * Y `hashchange`, que cubre la salida que ninguno de los tres ve: si la
   * navegación externa NUNCA salió —el teléfono perdió la red en el peor
   * momento— la persona sigue en el mismo documento, y lo primero que hace es
   * tocar la barra de abajo. Ahí el handoff evidentemente no ocurrió, así que el
   * checkout tiene que volver a estar disponible en vez de quedarse tomado para
   * siempre. Durante un handoff de verdad este evento no puede llegar: el
   * documento ya se fue.
   */
  let entregadoAMercadoPago = false;

  const rearmarCheckoutAlVolver = () => {
    if (!entregadoAMercadoPago) return;
    if (document.visibilityState === 'hidden') return;
    entregadoAMercadoPago = false;
    confirming = false;
    const form = $('[data-checkout-form]');
    if (form) {
      delete form.dataset.checkoutHandoff;
      delete form.dataset.motionBusy;
    }
    const button = form?.querySelector('[type="submit"]');
    if (button) {
      button.disabled = isProductionOrderingBlocked();
      button.textContent = checkoutModeCopy(getAppMode()).submit;
    }
  };
  window.addEventListener('pageshow', rearmarCheckoutAlVolver);
  window.addEventListener('focus', rearmarCheckoutAlVolver);
  window.addEventListener('hashchange', rearmarCheckoutAlVolver);
  document.addEventListener('visibilitychange', rearmarCheckoutAlVolver);

  $('[data-checkout-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    clearCheckoutInlineError(form);
    if (isProductionOrderingBlocked()) {
      const message = 'Los pedidos online todavía no están disponibles.';
      showToast(showCheckoutInlineError(form, message));
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
          showToast(showCheckoutInlineError(form, message));
          return;
        }
        if (button) button.textContent = 'Te llevamos a Mercado Pago…';
        showToast('Te llevamos a Mercado Pago para completar el pago de forma segura.');
        entregadoAMercadoPago = true;
        form.dataset.checkoutHandoff = 'mercadopago';
        window.location.assign(result.initPoint);
        return;
      }
      const result = await Promise.resolve(getOrderRepository().createOrder(values));

      if (!result.ok) {
        showToast(showCheckoutInlineError(form, result.message));
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
      showToast(showCheckoutInlineError(form, message));
    } finally {
      if (entregadoAMercadoPago) {
        // Entregado: el checkout queda tomado hasta que la persona vuelva.
        // Re-armarlo acá es abrirle la puerta al segundo toque.
        form.dataset.motionBusy = 'true';
      } else {
        confirming = false;
        if (button) {
          button.disabled = isProductionOrderingBlocked();
          button.textContent = originalLabel || checkoutModeCopy(getAppMode()).submit;
        }
        delete form.dataset.motionBusy;
      }
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
  return resolveRoute(view).view;
}

/*
 * Qué vista corresponde a un hash, y POR QUÉ.
 *
 * `normalizeView` devolvía 'home' para tres casos distintos —hash vacío, hash
 * de una vista operativa bloqueada por el modo, y hash que no existe— y quien
 * llamaba no podía distinguirlos. El resultado: alguien abría un link viejo o
 * mal copiado, aterrizaba en el inicio sin ninguna explicación y la barra de
 * direcciones seguía mostrando la ruta rota. Parecía que la app había ignorado
 * el link.
 *
 *   ok       la ruta se resolvió tal cual se pidió
 *   blocked  la vista existe pero este modo no la sirve (panel, rider)
 *   unknown  no hay ninguna vista con ese nombre
 */
function resolveRoute(rawView) {
  const key = String(rawView || '').replace(/^#/, '').trim().toLowerCase();
  if (!key) return { view: 'home', status: 'ok' };
  const normalized = VIEW_ALIASES[key] || key;
  if (!VIEWS.includes(normalized)) return { view: 'home', status: 'unknown' };
  if (isOperationalView(normalized)) return { view: 'home', status: 'blocked' };
  return { view: normalized, status: 'ok' };
}

function viewFromHash() {
  return normalizeView(window.location.hash.slice(1));
}

/*
 * Una ruta que no se pudo servir no se tapa: se corrige la barra de
 * direcciones —para que recargar o volver atrás no repita el error— y se dice
 * en criollo qué pasó. Sin códigos, sin "404", sin dejar a la persona
 * preguntándose si tocó mal.
 *
 * Una vista operativa bloqueada por el modo NO se anuncia: no es un error de
 * quien navega y nombrarla sólo publicita una puerta que no le corresponde. Se
 * corrige la URL y listo.
 */
function recoverFromUnservedRoute(status) {
  if (status === 'ok') return;
  writeViewHash('home', true);
  if (status !== 'unknown') return;
  showToast('No encontramos esa página. Te dejamos en el inicio.');
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
  // Entrar al carrito es el primer momento en que importa si Mercado Pago está
  // disponible, y también el primero en que hay una persona decidiendo algo. En
  // el arranque no se pregunta: preguntarlo creaba una identidad anónima por
  // cada visita, robots incluidos.
  if (nextView === 'cart') refreshMercadoPagoCheckoutAvailability();
  renderAll();
  window.dispatchEvent(new CustomEvent('taba:realtime-view-enter', { detail: { view: nextView } }));
  if (changed) playViewEnter(nextView);

  if (changed && options.scroll !== false) {
    resetPageScroll();
  }
  if (changed && options.focus !== false) focusActiveViewHeading(nextView);
}

function syncViewFromLocation() {
  const route = resolveRoute(window.location.hash.slice(1));
  const nextView = route.view;
  // La corrección va ANTES del corte por "no cambió la vista": escribir
  // `#no-existe` estando ya en el inicio no cambia de vista y aun así hay que
  // arreglar la URL y avisar.
  recoverFromUnservedRoute(route.status);
  if (nextView === activeView) return;
  activeView = nextView;
  syncGpsSharingWithView(nextView);
  // Entrar al carrito es el primer momento en que importa si Mercado Pago está
  // disponible, y también el primero en que hay una persona decidiendo algo. En
  // el arranque no se pregunta: preguntarlo creaba una identidad anónima por
  // cada visita, robots incluidos.
  if (nextView === 'cart') refreshMercadoPagoCheckoutAvailability();
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

// Aviso honesto de conexión: no promete que pedidos/tracking/GPS sigan
// funcionando sin internet, sólo informa el estado real de la red.
function initConnectivityNotice() {
  const offlineBanner = $('[data-pwa-offline-banner]');
  if (!offlineBanner) return;
  const updateOfflineBanner = () => { offlineBanner.hidden = navigator.onLine; };
  updateOfflineBanner();
  window.addEventListener('online', updateOfflineBanner);
  window.addEventListener('offline', updateOfflineBanner);
}

/*
 * Abierta desde el icono: la tienda se comporta igual, pero deja de ser una
 * pestaña y hay que decírselo a la hoja de estilos.
 *
 * El único ajuste real es el borde superior. Con `viewport-fit=cover` y la barra
 * de estado translúcida de iOS, el contenido sube hasta el borde físico de la
 * pantalla: en una pestaña de Safari eso no se nota porque la barra del
 * navegador ocupa esa franja, pero instalada la app queda con el reloj y la
 * batería encima del nombre del comercio. `styles/common.css` le suma
 * `env(safe-area-inset-top)` a la barra SÓLO en este modo, así que la pestaña
 * conserva exactamente la geometría que ya estaba certificada.
 */
function markDisplayMode() {
  document.documentElement.dataset.tabaDisplayMode = isStandaloneDisplay() ? 'standalone' : 'browser';
}

bootstrap();
