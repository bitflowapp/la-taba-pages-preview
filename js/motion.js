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
   BRILLO DE LA GÓNDOLA — un número, calculado donde ya se escuchaba el scroll
   ----------------------------------------------------------------------------
   Las tarjetas del catálogo llevan una capa roja tenue que está encendida
   mientras se mira la zona alta de la góndola y se apaga al bajar. Todo el
   color vive en CSS; acá sólo se calcula CUÁNTO, y se escribe en una sola
   propiedad personalizada sobre la sección del catálogo.

   Tres decisiones que hacen que esto no cueste nada:

   1 · No agrega ningún listener. Se cuelga del `scroll` que este módulo ya
       tenía, que ya está limitado a un cuadro por `requestAnimationFrame`.
   2 · Escribe CUANTIZADO. El valor se redondea a 1/25, así que un scroll
       continuo produce como mucho 25 escrituras en todo el desvanecido en vez
       de una por cuadro. Cambiar una propiedad heredada invalida el estilo del
       subárbol: hacerlo 60 veces por segundo para mover un alfa que nadie
       distingue es exactamente el gasto que se quiere evitar.
   3 · Se escribe en la SECCIÓN del catálogo, no en `body`. La invalidación
       queda contenida en el subárbol que de verdad usa el valor.

   Y si nada de esto corre —JavaScript apagado, módulo caído— el token conserva
   su valor por defecto y las tarjetas se ven con un brillo fijo y discreto.
   ========================================================================== */
const GLOW_HOST = '[data-view="catalog"]';
const GLOW_ANCHOR = '[data-product-grid]';
const GLOW_STEPS = 25;

/*
 * 1 mientras el arranque de la góndola sigue a la vista; después baja a 0 a lo
 * largo de una pantalla. Se mide contra la altura del viewport y no contra un
 * número de píxeles para que el recorrido dure lo mismo en un teléfono chico
 * que en un escritorio.
 */
function readCatalogGlow(documentRef, windowRef) {
  const anchor = documentRef.querySelector(`${GLOW_HOST} ${GLOW_ANCHOR}`);
  if (!anchor) return null;
  const viewport = windowRef?.innerHeight || 0;
  if (!viewport) return null;
  // `top` es positivo mientras la góndola no llegó al borde superior y se
  // vuelve negativo cuando empieza a salir: ese negativo ES el recorrido.
  const recorrido = Math.max(0, -anchor.getBoundingClientRect().top);
  return Math.max(0, 1 - recorrido / viewport);
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
  let lastGlow = null;
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
    scheduleCatalogGlow();
  };

  /*
   * Con movimiento reducido no se modula nada: el token conserva su valor por
   * defecto y el brillo queda fijo. Un adorno que cambia solo mientras alguien
   * scrollea es justo lo que esa preferencia pide no hacer, y apagarlo del todo
   * sería quitarle a esa persona una superficie que el resto sí ve.
   */
  const applyCatalogGlow = () => {
    if (destroyed || preference.reduced) return;
    const host = documentRef.querySelector(GLOW_HOST);
    if (!host) return;
    const glow = readCatalogGlow(documentRef, windowRef);
    if (glow === null) return;
    const quantized = Math.round(glow * GLOW_STEPS) / GLOW_STEPS;
    if (quantized === lastGlow) return;
    lastGlow = quantized;
    host.style.setProperty('--card-glow', String(quantized));
  };

  /*
   * Desde el observador de mutaciones el cálculo NO puede ser inmediato:
   * `applyCatalogGlow` lee geometría, y leer geometría dentro del callback de un
   * MutationObserver fuerza un layout sincrónico en medio del repintado. La
   * góndola muta en lote —ochenta tarjetas al filtrar o buscar—, así que sería
   * un layout forzado por lote y encima repetido.
   * Aplazarlo al próximo cuadro resuelve las dos cosas: se lee cuando el layout
   * ya está limpio, y varias mutaciones seguidas colapsan en un solo cálculo.
   * El camino del scroll no necesita esto: `setScrolled` YA corre dentro de un
   * `requestAnimationFrame`.
   */
  const scheduleCatalogGlow = () => {
    if (glowPending || destroyed) return;
    glowPending = true;
    const correr = () => {
      glowPending = false;
      applyCatalogGlow();
    };
    if (windowRef?.requestAnimationFrame) windowRef.requestAnimationFrame(correr);
    else correr();
  };

  const setScrolled = () => {
    scrollPending = false;
    documentRef.body.dataset.motionScrolled = String((windowRef?.scrollY || 0) > 8);
    applyCatalogGlow();
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
      documentRef.querySelector(GLOW_HOST)?.style.removeProperty('--card-glow');
      lastGlow = null;
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
        catalogGlow: lastGlow,
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
