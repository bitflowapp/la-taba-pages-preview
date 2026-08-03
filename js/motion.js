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

export function initMotion(documentRef = globalThis.document, windowRef = globalThis.window) {
  if (!documentRef?.body) return { destroy() {}, getDiagnostics: () => ({ active: false }) };
  activeController?.destroy?.();

  const preference = setMotionPreference(documentRef, windowRef);
  let rafId = 0;
  let scrollPending = false;
  let pressTimer = 0;
  let targets = [];
  let observedCount = 0;

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
  };

  const setScrolled = () => {
    scrollPending = false;
    documentRef.body.dataset.motionScrolled = String((windowRef?.scrollY || 0) > 8);
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
