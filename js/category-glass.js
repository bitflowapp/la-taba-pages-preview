/* Category material is progressive enhancement. Touch/trackpad momentum stays
 * native; only mouse dragging writes scrollLeft. No touch gesture is cancelled.
 * Geometry is read once per interaction, then frames write transform/opacity.
 * The damped spring stops at rest; there is no idle animation loop. */
const STRIP = '[data-category-strip]';
const PILL = '.category-button, .home-category-card';
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export function initCategoryGlass(documentRef = globalThis.document, windowRef = globalThis.window) {
  const noop = { destroy() {}, getDiagnostics: () => ({ active: false }) };
  if (!documentRef?.body || !windowRef?.requestAnimationFrame) return noop;
  const media = windowRef.matchMedia('(prefers-reduced-motion: reduce)');
  const lite = documentRef.body.dataset.motionLite === 'true';
  const listeners = [];
  let rail = null;
  let items = [];
  let pointer = null;
  let focalX = 0;
  let railWidth = 0;
  let view = null;
  let movingUntil = 0;
  let frame = 0;
  let lastFrame = 0;
  let suppressClick = null;
  let inertia = 0;
  let lastInput = 0;
  let snapQuietUntil = 0;
  let budgetUntil = 0;
  let queuedAt = 0;
  let settleDeadline = 0;
  let destroyed = false;
  let frames = 0;
  let maxFrameMs = 0;

  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  };
  const now = () => windowRef.performance.now();
  const reset = () => {
    if (frame) windowRef.cancelAnimationFrame(frame);
    frame = 0;
    lastFrame = 0;
    inertia = 0;
    items.forEach(({ node }) => {
      node.style.removeProperty('transform');
      node.style.removeProperty('--glass-light');
    });
    rail?.removeAttribute('data-glass-dragging');
    rail?.removeAttribute('data-glass-moving');
    snapQuietUntil = now() + 150;
    items = [];
    rail = null;
  };
  const measure = (strip, clientX) => {
    reset();
    rail = strip;
    const rect = strip.getBoundingClientRect();
    railWidth = rect.width;
    view = strip.closest('[data-view]');
    snapQuietUntil = 0;
    focalX = clientX == null ? rect.width * 0.5 : clientX - rect.left;
    items = [...strip.querySelectorAll(PILL)].map(node => ({
      node, center: node.offsetLeft - (node.offsetParent === strip ? 0 : strip.offsetLeft) + node.offsetWidth * 0.5,
      x: 0, y: 0, scale: 0, vx: 0, vy: 0, vs: 0, light: 0,
    }));
  };
  const schedule = () => {
    if (!frame && !destroyed && !media.matches && !lite && now() >= budgetUntil) {
      if (rail && rail.dataset.glassMoving !== 'true') rail.dataset.glassMoving = 'true';
      queuedAt = now();
      frame = windowRef.requestAnimationFrame(tick);
    }
  };
  const pulse = () => { movingUntil = now() + 105; settleDeadline = now() + 650; schedule(); };

  function tick(time) {
    frame = 0;
    if (destroyed || media.matches || lite || !rail?.isConnected || view?.hidden || documentRef.hidden) { reset(); return; }
    const gap = lastFrame ? time - lastFrame : time - queuedAt;
    maxFrameMs = Math.max(maxFrameMs, gap);
    frames++;
    // Some WebKit/low-power tabs deliver rAF hundreds of milliseconds late.
    // Material motion yields to native scrolling instead of stretching a
    // 200ms response into seconds or keeping a target in motion under a tap.
    if (gap > 90) { budgetUntil = time + 800; reset(); return; }
    if (!pointer?.drag && time > settleDeadline && Math.abs(inertia) <= 0.02) { reset(); return; }
    // Bound integration after an occluded tab or dropped frame.
    const dt = clamp(gap / 1000, 0.001, 0.032);
    lastFrame = time;
    if (Math.abs(inertia) > 0.02) {
      const before = rail.scrollLeft;
      rail.scrollLeft += inertia * dt * 1000;
      inertia *= Math.exp(-dt * 12);
      if (Math.abs(rail.scrollLeft - before) < 0.1) inertia = 0;
      movingUntil = time + 105;
    }
    const engaging = time < movingUntil && !pointer?.vertical;
    const scroll = rail.scrollLeft;
    const width = railWidth;
    let unsettled = false;
    const approach = (item, value, velocity, target) => {
      // Critically damped, integrated in small steps; no elastic overshoot.
      const step = dt / 2;
      for (let i = 0; i < 2; i++) {
        item[velocity] += ((target - item[value]) * 420 - item[velocity] * 38) * step;
        item[value] += item[velocity] * step;
      }
      if (Math.abs(target - item[value]) > 0.0004 || Math.abs(item[velocity]) > 0.004) unsettled = true;
    };
    for (const item of items) {
      const center = item.center - scroll;
      if (center < -180 || center > width + 180) continue;
      const distance = focalX - center;
      const influence = engaging ? Math.exp(-((distance / 132) ** 2)) : 0;
      approach(item, 'x', 'vx', clamp(distance * 0.025, -2.6, 2.6) * influence);
      approach(item, 'y', 'vy', -1.7 * influence);
      approach(item, 'scale', 'vs', 0.038 * influence);
      item.light += (influence * 0.48 - item.light) * Math.min(1, dt * 18);
      const transform = `translate3d(${item.x.toFixed(3)}px,${item.y.toFixed(3)}px,0) scale(${(1 + item.scale).toFixed(4)})`;
      if (item.node.style.transform !== transform) item.node.style.transform = transform;
      const light = item.light.toFixed(3);
      if (item.node.style.getPropertyValue('--glass-light') !== light) item.node.style.setProperty('--glass-light', light);
      if (item.light > 0.002) unsettled = true;
    }
    if (engaging || unsettled || Math.abs(inertia) > 0.02) schedule();
    else reset();
  }

  const onDown = event => {
    if (event.button !== 0 || event.isPrimary === false) return;
    suppressClick = null; // A fresh intentional tap never inherits a drag's guard.
    snapQuietUntil = 0;
    const strip = event.target.closest?.(STRIP);
    if (!strip) return;
    if (rail !== strip || !items.length) measure(strip, event.clientX);
    else focalX = event.clientX - strip.getBoundingClientRect().left;
    inertia = 0;
    pointer = { id: event.pointerId, type: event.pointerType, strip,
      startX: event.clientX, startY: event.clientY, lastX: event.clientX,
      lastAt: now(), speed: 0, drag: false, vertical: false, cancelled: false };
  };
  const onMove = event => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const dx = event.clientX - pointer.startX;
    const dy = event.clientY - pointer.startY;
    if (!pointer.drag && Math.max(Math.abs(dx), Math.abs(dy)) > 6) {
      if (Math.abs(dy) > Math.abs(dx)) { pointer.vertical = true; movingUntil = 0; return; }
      if (Math.abs(dx) > Math.abs(dy) * 1.25) {
        pointer.drag = true;
        pointer.strip.querySelector('.motion-pressing')?.classList.remove('motion-pressing');
        if (pointer.type === 'mouse') {
          pointer.strip.setPointerCapture?.(pointer.id);
          pointer.strip.dataset.glassDragging = 'true';
          pointer.strip.querySelector('.motion-pressing')?.classList.remove('motion-pressing');
        }
      }
    }
    if (pointer.vertical || !pointer.drag) return;
    const at = now();
    focalX = event.clientX - pointer.strip.getBoundingClientRect().left;
    if (pointer.type === 'mouse') {
      if (event.cancelable) event.preventDefault();
      const elapsed = Math.max(8, at - pointer.lastAt);
      const speed = (pointer.lastX - event.clientX) / elapsed;
      pointer.speed = clamp(pointer.speed * 0.45 + speed * 0.55, -1.6, 1.6);
      pointer.strip.scrollLeft += pointer.lastX - event.clientX;
    }
    pointer.lastX = event.clientX;
    pointer.lastAt = at;
    pulse();
  };
  const onUp = event => {
    if (!pointer || event.pointerId !== pointer.id) return;
    if (pointer.drag && !pointer.vertical) {
      suppressClick = { strip: pointer.strip, until: now() + 400 };
      if (pointer.type === 'mouse' && now() - pointer.lastAt < 65) inertia = pointer.speed;
    }
    if (pointer.strip.hasPointerCapture?.(pointer.id)) pointer.strip.releasePointerCapture(pointer.id);
    pointer.strip.removeAttribute('data-glass-dragging');
    pointer = null;
    movingUntil = now();
    schedule();
  };
  const onCancel = event => {
    if (!pointer || event.pointerId !== pointer.id) return;
    // Native pan emits pointercancel. Keep its focus for scroll events, without
    // pretending we still own the pointer. Passive touchend clears this state.
    if (pointer.type === 'touch') pointer.cancelled = true;
    else onUp(event);
  };
  const onTouchMove = event => {
    if (!pointer || pointer.type !== 'touch' || !event.touches.length) return;
    const touch = event.touches[0];
    const dx = touch.clientX - pointer.startX;
    const dy = touch.clientY - pointer.startY;
    if (pointer.vertical || (Math.abs(dy) > 6 && Math.abs(dy) > Math.abs(dx))) {
      pointer.vertical = true;
      movingUntil = 0;
      return;
    }
    if (Math.abs(dx) > 6) {
      pointer.drag = true;
      pointer.strip.querySelector('.motion-pressing')?.classList.remove('motion-pressing');
      if (rail !== pointer.strip) measure(pointer.strip, touch.clientX);
      focalX = touch.clientX - pointer.strip.getBoundingClientRect().left;
      pulse();
    }
  };
  const onTouchEnd = () => { if (pointer?.type === 'touch') onUp({ pointerId: pointer.id }); };
  const onScroll = event => {
    const strip = event.target;
    if (!strip.matches?.(STRIP) || pointer?.vertical) return;
    if (!pointer && now() < snapQuietUntil) return;
    if (rail !== strip) measure(strip);
    pulse();
  };
  const onWheel = event => {
    const strip = event.target.closest?.(STRIP);
    if (!strip || (!event.shiftKey && Math.abs(event.deltaY) >= Math.abs(event.deltaX))) return;
    snapQuietUntil = 0;
    if (rail !== strip) measure(strip, event.clientX);
    focalX = event.clientX - strip.getBoundingClientRect().left;
    lastInput = now();
    pulse(); // Browser owns the wheel deltas, including Shift+wheel.
  };
  const onClick = event => {
    if (event.detail !== 0 && suppressClick && now() < suppressClick.until
      && suppressClick.strip.contains(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressClick = null;
      return;
    }
    const pill = event.target.closest?.(PILL);
    if (pill && !media.matches && !lite && !frame && !pill.disabled) {
      pill.animate?.([{ transform: 'scale(.98)' }, { transform: 'scale(1.012)', offset: .62 },
        { transform: 'none' }], { duration: 190, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  };
  const onKey = event => {
    const button = event.target.closest?.(PILL);
    const strip = button?.closest(STRIP);
    if (!strip || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    const buttons = [...strip.querySelectorAll(PILL)].filter(node => !node.disabled);
    const current = buttons.indexOf(button);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : clamp(current + (event.key === 'ArrowRight' ? 1 : -1), 0, buttons.length - 1);
    event.preventDefault();
    buttons[index]?.focus({ preventScroll: true });
    const destination = buttons[index];
    if (!destination) return;
    const left = destination.offsetLeft - (destination.offsetParent === strip ? 0 : strip.offsetLeft);
    const right = left + destination.offsetWidth;
    const next = left < strip.scrollLeft ? left - 8 : right > strip.scrollLeft + strip.clientWidth
      ? right - strip.clientWidth + 8 : strip.scrollLeft;
    strip.scrollTo({ left: next, behavior: media.matches ? 'instant' : 'smooth' });
  };
  const onPreference = () => { reset(); movingUntil = 0; };
  const onVisibility = () => { if (documentRef.hidden) { pointer = null; reset(); } };
  const onResize = () => { pointer = null; reset(); };
  listen(documentRef, 'pointerdown', onDown, { passive: true });
  listen(documentRef, 'pointermove', onMove, { passive: false });
  listen(documentRef, 'pointerup', onUp, { passive: true });
  listen(documentRef, 'pointercancel', onCancel, { passive: true });
  listen(documentRef, 'touchmove', onTouchMove, { passive: true });
  listen(documentRef, 'touchend', onTouchEnd, { passive: true });
  listen(documentRef, 'touchcancel', onTouchEnd, { passive: true });
  listen(documentRef, 'scroll', onScroll, { capture: true, passive: true });
  listen(documentRef, 'wheel', onWheel, { passive: true });
  listen(documentRef, 'click', onClick, true);
  listen(documentRef, 'keydown', onKey);
  listen(documentRef, 'visibilitychange', onVisibility);
  listen(windowRef, 'resize', onResize, { passive: true });
  listen(media, 'change', onPreference);
  return {
    destroy() { destroyed = true; pointer = null; reset(); listeners.forEach(remove => remove()); },
    getDiagnostics: () => ({ active: true, animating: Boolean(frame), dragging: Boolean(pointer?.drag),
      reduced: media.matches, lite, frameBudgetSuppressed: now() < budgetUntil, frames, maxFrameMs, lastInput }),
  };
}
