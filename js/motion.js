/*
 * TABA2 motion controller.
 *
 * This module is deliberately small and framework-free. It owns one
 * IntersectionObserver for reveal targets, one MutationObserver for dynamic
 * catalog renders, and a single delegated pointer listener. Every effect is
 * progressive: if the browser cannot animate, content remains immediately
 * visible and usable.
 */

const REVEAL_SELECTORS = [
  '.taba-home-hero',
  '.home-merch-section',
  '.home-section-head',
  '.section-head',
  '.catalog-toolbar',
  '.catalog-search',
  '.catalog-filters',
  '.category-strip',
  '.cart-card',
  '.checkout-form',
  '.profile-grid',
  '.active-order-banner',
];

const CARD_SELECTORS = ['.product-grid', '.home-promotions-rail', '.home-catalog-grid', '.recommendations-rail'];
const INTERACTIVE_SELECTOR = 'button, a, [role="button"], input, select, textarea, summary';

let activeController = null;

function getReducedMotion(windowRef) {
  return Boolean(windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function getLiteMode(windowRef) {
  const connection = windowRef?.navigator?.connection;
  const lowMemory = Number(windowRef?.navigator?.deviceMemory || 0) > 0
    && Number(windowRef.navigator.deviceMemory) <= 2;
  const slowNetwork = connection?.saveData === true
    || ['slow-2g', '2g'].includes(String(connection?.effectiveType || ''));
  return lowMemory || slowNetwork;
}

function setMotionPreference(documentRef, windowRef) {
  const body = documentRef?.body;
  if (!body) return { reduced: false, lite: false };
  const reduced = getReducedMotion(windowRef);
  const lite = getLiteMode(windowRef);
  body.classList.add('motion-ready');
  body.dataset.motionReduced = String(reduced);
  body.dataset.motionLite = String(lite);
  return { reduced, lite };
}

function markRevealTargets(documentRef, observer, reduced) {
  if (!documentRef?.body) return [];
  const targets = new Set();
  REVEAL_SELECTORS.forEach((selector) => {
    documentRef.querySelectorAll(selector).forEach((node) => {
      if (!node.dataset.motionReveal) node.dataset.motionReveal = node.matches('.taba-home-hero') ? 'hero' : 'section';
      targets.add(node);
    });
  });

  CARD_SELECTORS.forEach((selector) => {
    documentRef.querySelectorAll(selector).forEach((container) => {
      [...container.children]
        .filter((child) => child.matches?.('.product-card, .home-catalog-card, .offer-card, .recommendation-card'))
        .slice(0, 4)
        .forEach((node, index) => {
          node.dataset.motionReveal = 'card';
          node.style.setProperty('--motion-index', String(index));
          targets.add(node);
        });
    });
  });

  // El cambio de cantidad recibe feedback numérico sin animar el layout.
  documentRef.querySelectorAll('.qty-stepper strong, .quantity-control strong').forEach((node) => {
    node.classList.add('motion-quantity-pop');
  });

  targets.forEach((node) => {
    if (!node.dataset.motionReveal) node.dataset.motionReveal = 'section';
    if (reduced || !observer) {
      node.classList.add('is-motion-visible');
      return;
    }
    if (!node.classList.contains('is-motion-visible')) observer.observe(node);
  });
  return [...targets];
}

function releasePressed(target) {
  target?.classList?.remove('motion-pressing');
}

/* ============================================================================
   BRILLO DE LA GÓNDOLA — un número por estante, donde ya se escuchaba el scroll
   ----------------------------------------------------------------------------
   Los estantes de producto llevan una capa roja tenue que está encendida
   mientras el estante ocupa la zona alta de la pantalla y se apaga cuando pasa
   de largo. Todo el color vive en CSS; acá sólo se calcula CUÁNTO, y se escribe
   en una propiedad personalizada sobre CADA estante.

   POR QUÉ POR ESTANTE Y NO POR VISTA. La primera versión ató el efecto a
   `body[data-active-view="catalog"]`, y así el rail "Destacados" de la home
   —que es la primera góndola que ve un cliente— se quedaba sin brillo. Quién
   brilla lo declara el marcado con `data-glow-shelf`; cuánto, la geometría.
   Un estante que todavía no entró no brilla, y uno que ya salió por arriba
   tampoco, sin que nadie tenga que preguntar en qué pantalla estamos.

   Tres decisiones que hacen que esto no cueste nada:

   1 · No agrega ningún listener. Se cuelga del `scroll` que este módulo ya
       tenía, que ya está limitado a un cuadro por `requestAnimationFrame`.
   2 · Escribe CUANTIZADO. El valor se redondea a 1/25, así que un scroll
       continuo produce como mucho 25 escrituras por estante en todo el
       recorrido en vez de una por cuadro. Cambiar una propiedad heredada
       invalida el estilo del subárbol: hacerlo 60 veces por segundo para mover
       un alfa que nadie distingue es exactamente el gasto que se quiere evitar.
   3 · Se escribe en el ESTANTE, no en `body`. La invalidación queda contenida
       en el subárbol que de verdad usa el valor.

   Y si nada de esto corre —JavaScript apagado, módulo caído— el token conserva
   su valor por defecto y las tarjetas se ven con un brillo fijo y discreto.
   ========================================================================== */
const GLOW_SHELF = '[data-glow-shelf]';
const GLOW_STEPS = 25;

/*
 * Sube mientras el estante entra desde abajo, satura cuando ya ocupa la mitad
 * alta de la pantalla, y baja a 0 a lo largo de una pantalla mientras sale por
 * arriba. Todo medido contra la altura del viewport y no contra un número de
 * píxeles, para que el recorrido dure lo mismo en un teléfono que en un
 * escritorio.
 *
 * POR QUÉ SATURA A MEDIA PANTALLA Y NO EN EL BORDE SUPERIOR. La primera versión
 * usaba una rampa lineal desde el borde inferior: matemáticamente prolija y
 * visualmente inútil. En la home el rail "Destacados" arranca a 522px de 844,
 * así que daba 0,38 —alfas de 0,047— y eso es INVISIBLE. El efecto existía en
 * el estilo computado y en las pruebas, y no en la pantalla, que es donde tenía
 * que existir. Saturando a media pantalla, ese mismo rail arranca en 0,76 y el
 * catálogo —que empieza más arriba— vuelve a su intensidad de siempre.
 *
 * Devuelve `null` para un estante que no está renderizado —una vista oculta
 * tiene rect en cero— para distinguir "no corresponde" de "cero brillo".
 */
function readShelfGlow(shelf, viewport) {
  const rect = shelf.getBoundingClientRect();
  if (!viewport || (rect.width === 0 && rect.height === 0)) return null;
  if (rect.top >= viewport) return 0;          // todavía no entró
  if (rect.bottom <= 0) return 0;              // ya salió del todo
  const progreso = rect.top >= 0
    ? (viewport - rect.top) / (viewport * 0.5) // entrando: satura a media pantalla
    : 1 - (-rect.top) / viewport;              // saliendo por arriba
  return Math.min(1, Math.max(0, progreso));
}

export function initMotion(documentRef = globalThis.document, windowRef = globalThis.window) {
  if (!documentRef?.body) return { destroy() {}, getDiagnostics: () => ({ active: false }) };
  activeController?.destroy?.();

  const preference = setMotionPreference(documentRef, windowRef);
  let rafId = 0;
  let scrollPending = false;
  let pressTimer = 0;
  let targets = [];
  let observedCount = 0;
  const lastGlow = new WeakMap();
  let glowPending = false;
  let destroyed = false;

  const observer = !preference.reduced && 'IntersectionObserver' in (windowRef || {})
    ? new windowRef.IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-motion-visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 })
    : null;

  const collect = () => {
    targets = markRevealTargets(documentRef, observer, preference.reduced);
    observedCount = observer ? targets.filter((node) => !node.classList.contains('is-motion-visible')).length : 0;
    // La góndola se repinta al entrar a la vista, al filtrar y al buscar. Ese
    // es también el momento en que su geometría cambia, así que el brillo se
    // recalcula acá y no hace falta escuchar el cambio de vista por separado.
    scheduleShelfGlow();
  };

  /*
   * Con movimiento reducido no se modula nada: el token conserva su valor por
   * defecto y el brillo queda fijo. Un adorno que cambia solo mientras alguien
   * scrollea es justo lo que esa preferencia pide no hacer, y apagarlo del todo
   * sería quitarle a esa persona una superficie que el resto sí ve.
   */
  const applyShelfGlow = () => {
    if (destroyed || preference.reduced) return;
    const viewport = windowRef?.innerHeight || 0;
    documentRef.querySelectorAll(GLOW_SHELF).forEach((shelf) => {
      const glow = readShelfGlow(shelf, viewport);
      if (glow === null) return;
      const quantized = Math.round(glow * GLOW_STEPS) / GLOW_STEPS;
      if (quantized === lastGlow.get(shelf)) return;
      lastGlow.set(shelf, quantized);
      shelf.style.setProperty('--card-glow', String(quantized));
    });
  };

  const scheduleShelfGlow = () => {
    if (glowPending || destroyed) return;
    glowPending = true;
    const correr = () => {
      glowPending = false;
      applyShelfGlow();
    };
    if (windowRef?.requestAnimationFrame) windowRef.requestAnimationFrame(correr);
    else correr();
  };

  const setScrolled = () => {
    scrollPending = false;
    documentRef.body.dataset.motionScrolled = String((windowRef?.scrollY || 0) > 8);
    applyShelfGlow();
  };

  const onScroll = () => {
    if (scrollPending) return;
    scrollPending = true;
    rafId = windowRef?.requestAnimationFrame?.(setScrolled) || setTimeout(setScrolled, 0);
  };

  const onPointerDown = (event) => {
    const target = event.target?.closest?.(INTERACTIVE_SELECTOR);
    if (!target || target.disabled || target.getAttribute('aria-disabled') === 'true') return;
    target.classList.add('motion-pressing');
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => releasePressed(target), 220);
  };

  const onPointerUp = (event) => releasePressed(event.target?.closest?.(INTERACTIVE_SELECTOR));
  const onPointerCancel = (event) => releasePressed(event.target?.closest?.(INTERACTIVE_SELECTOR));
  const onKeyDown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target?.closest?.(INTERACTIVE_SELECTOR);
    if (target && !target.disabled) target.classList.add('motion-pressing');
  };
  const onKeyUp = (event) => releasePressed(event.target?.closest?.(INTERACTIVE_SELECTOR));
  const onMotionPreferenceChange = (event) => {
    documentRef.body.dataset.motionReduced = String(event.matches);
    if (event.matches) targets.forEach((node) => node.classList.add('is-motion-visible'));
  };

  const mutationObserver = 'MutationObserver' in (windowRef || {})
    ? new windowRef.MutationObserver((records) => {
      if (records.some((record) => [...record.addedNodes].some((node) => node.nodeType === 1))) collect();
    })
    : null;

  collect();
  mutationObserver?.observe(documentRef.body, { childList: true, subtree: true });
  documentRef.addEventListener('pointerdown', onPointerDown, { passive: true });
  documentRef.addEventListener('pointerup', onPointerUp, { passive: true });
  documentRef.addEventListener('pointercancel', onPointerCancel, { passive: true });
  documentRef.addEventListener('keydown', onKeyDown);
  documentRef.addEventListener('keyup', onKeyUp);
  windowRef?.addEventListener?.('scroll', onScroll, { passive: true });
  const mediaQuery = windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)');
  mediaQuery?.addEventListener?.('change', onMotionPreferenceChange);
  setScrolled();

  const controller = {
    destroy() {
      destroyed = true;
      observer?.disconnect();
      mutationObserver?.disconnect();
      mediaQuery?.removeEventListener?.('change', onMotionPreferenceChange);
      documentRef.removeEventListener('pointerdown', onPointerDown);
      documentRef.removeEventListener('pointerup', onPointerUp);
      documentRef.removeEventListener('pointercancel', onPointerCancel);
      documentRef.removeEventListener('keydown', onKeyDown);
      documentRef.removeEventListener('keyup', onKeyUp);
      windowRef?.removeEventListener?.('scroll', onScroll);
      if (rafId) (windowRef?.cancelAnimationFrame ? windowRef.cancelAnimationFrame(rafId) : clearTimeout(rafId));
      clearTimeout(pressTimer);
      documentRef.querySelectorAll(GLOW_SHELF).forEach((shelf) => shelf.style.removeProperty('--card-glow'));
      documentRef.body.classList.remove('motion-ready');
      delete documentRef.body.dataset.motionReduced;
      delete documentRef.body.dataset.motionLite;
      delete documentRef.body.dataset.motionScrolled;
      targets.forEach((node) => {
        delete node.dataset.motionReveal;
        node.classList.remove('is-motion-visible', 'motion-pressing');
        node.style.removeProperty('--motion-index');
      });
      activeController = null;
    },
    getDiagnostics() {
      return {
        active: true,
        reducedMotion: preference.reduced,
        liteMode: preference.lite,
        glowShelves: documentRef.querySelectorAll(GLOW_SHELF).length,
        observerCount: observer ? 1 : 0,
        mutationObserverCount: mutationObserver ? 1 : 0,
        revealTargets: targets.length,
        pendingRevealTargets: observedCount,
      };
    },
  };
  activeController = controller;
  return controller;
}

export function getMotionDiagnostics() {
  return activeController?.getDiagnostics?.() || { active: false };
}

export function isMotionReduced(windowRef = globalThis.window) {
  return getReducedMotion(windowRef);
}
