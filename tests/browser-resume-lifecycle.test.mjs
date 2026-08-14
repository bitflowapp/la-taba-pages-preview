import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BROWSER_RESUME_DOCUMENT_EVENTS,
  BROWSER_RESUME_WINDOW_EVENTS,
  onBrowserResume,
} from '../js/core/browser-resume.js';

function eventTarget({ hidden = false } = {}) {
  const listeners = new Map();
  return {
    hidden,
    get visibilityState() { return this.hidden ? 'hidden' : 'visible'; },
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) {
      listeners.get(type)?.delete(callback);
    },
    emit(type) {
      listeners.get(type)?.forEach((callback) => callback());
    },
    listenerCount(type) {
      return listeners.get(type)?.size || 0;
    },
    totalListeners() {
      let total = 0;
      for (const set of listeners.values()) total += set.size;
      return total;
    },
  };
}

// Ningún navegador emite TODAS estas señales al volver de segundo plano, y
// cuál emite cada uno es justamente lo que no se puede asumir. Por eso se
// escuchan todas: la reconciliación tiene que dispararse con la que llegue.
test('cualquier señal de reanudación reconcilia, en window y en document', () => {
  for (const type of BROWSER_RESUME_WINDOW_EVENTS) {
    const windowRef = eventTarget();
    const documentRef = eventTarget();
    const reasons = [];
    onBrowserResume((reason) => reasons.push(reason), { windowRef, documentRef, coalesceMs: 0 });
    windowRef.emit(type);
    assert.deepEqual(reasons, [type], `window '${type}' debe reconciliar`);
  }

  for (const type of BROWSER_RESUME_DOCUMENT_EVENTS) {
    const windowRef = eventTarget();
    const documentRef = eventTarget();
    const reasons = [];
    onBrowserResume((reason) => reasons.push(reason), { windowRef, documentRef, coalesceMs: 0 });
    documentRef.emit(type);
    assert.deepEqual(reasons, [type], `document '${type}' debe reconciliar`);
  }
});

test('visibilitychange sólo reconcilia al volver VISIBLE, nunca al ocultarse', () => {
  const windowRef = eventTarget();
  const documentRef = eventTarget({ hidden: true });
  let calls = 0;
  onBrowserResume(() => { calls += 1; }, { windowRef, documentRef, coalesceMs: 0 });

  documentRef.emit('visibilitychange');
  assert.equal(calls, 0, 'ocultarse no es volver');

  documentRef.hidden = false;
  documentRef.emit('visibilitychange');
  assert.equal(calls, 1);
});

/*
 * Al volver, iOS despacha pageshow, focus y visibilitychange casi en el mismo
 * turno. Reconciliar tres veces le pega tres consultas al servidor por cada
 * vuelta a la pantalla. El borde de ATAQUE manda —la primera señal reconcilia
 * YA, sin esperar a un debounce— y las que la siguen no repiten el trabajo.
 */
test('una ráfaga de señales reconcilia una sola vez, y de inmediato', () => {
  const windowRef = eventTarget();
  const documentRef = eventTarget();
  let clock = 1_000;
  let calls = 0;
  onBrowserResume(() => { calls += 1; }, {
    windowRef,
    documentRef,
    coalesceMs: 250,
    now: () => clock,
  });

  windowRef.emit('pageshow');
  assert.equal(calls, 1, 'la primera señal no espera nada');
  windowRef.emit('focus');
  documentRef.emit('visibilitychange');
  windowRef.emit('online');
  assert.equal(calls, 1, 'la misma vuelta no se reconcilia cuatro veces');

  clock += 250;
  windowRef.emit('focus');
  assert.equal(calls, 2, 'una vuelta posterior sí reconcilia');
});

test('desarmar quita TODOS los listeners y deja de reconciliar', () => {
  const windowRef = eventTarget();
  const documentRef = eventTarget();
  let calls = 0;
  const stop = onBrowserResume(() => { calls += 1; }, { windowRef, documentRef, coalesceMs: 0 });

  assert.equal(windowRef.totalListeners(), BROWSER_RESUME_WINDOW_EVENTS.length);
  assert.equal(documentRef.totalListeners(), BROWSER_RESUME_DOCUMENT_EVENTS.length);

  stop();
  assert.equal(windowRef.totalListeners(), 0);
  assert.equal(documentRef.totalListeners(), 0);

  windowRef.emit('pageshow');
  documentRef.emit('visibilitychange');
  assert.equal(calls, 0);
});

test('sin window ni document no explota: devuelve un desarmado inerte', () => {
  const stop = onBrowserResume(() => {}, { windowRef: null, documentRef: null });
  assert.equal(typeof stop, 'function');
  stop();
});
