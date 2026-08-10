import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

/**
 * El contrato del aviso de actualización, sin navegador.
 *
 * `tests/e2e/pwa-update-lifecycle.spec.mjs` lo prueba contra un Service Worker
 * real —es la prueba que vale— pero tarda un minuto y necesita Chromium. Estas
 * afirmaciones corren en el gate de siempre y bloquean la regresión concreta que
 * dejó un aviso pegado en el teléfono de una persona: el aviso se muestra sólo
 * mientras hay un worker EN ESPERA, y se retira por todos los caminos por los
 * que ese worker puede desaparecer.
 *
 * El módulo se evalúa tal cual está publicado, en un contexto con lo mínimo que
 * usa. No se reimplementa nada suyo: si el archivo cambia, esto lo mide.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'js', 'pwa-update.js'), 'utf8');

class FakeTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  countListeners(type) {
    return (this.listeners.get(type) || []).length;
  }

  emit(type, event = {}) {
    for (const handler of [...(this.listeners.get(type) || [])]) handler(event);
  }
}

class FakeWorker extends FakeTarget {
  constructor(state = 'installing') {
    super();
    this.state = state;
    this.messages = [];
  }

  postMessage(message) {
    this.messages.push(message);
  }

  becomes(state) {
    this.state = state;
    this.emit('statechange', { target: this });
  }
}

class FakeRegistration extends FakeTarget {
  constructor() {
    super();
    this.installing = null;
    this.waiting = null;
    this.active = new FakeWorker('activated');
    this.updateCalls = 0;
  }

  update() {
    this.updateCalls += 1;
    return Promise.resolve();
  }
}

function boot() {
  const banner = { hidden: true };
  const buttons = new Map();
  const registration = new FakeRegistration();
  const serviceWorker = new FakeTarget();
  serviceWorker.controller = new FakeWorker('activated');
  serviceWorker.register = () => Promise.resolve(registration);
  serviceWorker.getRegistration = () => Promise.resolve(registration);

  const makeButton = (name) => {
    const button = new FakeTarget();
    button.name = name;
    buttons.set(name, button);
    return button;
  };
  const updateButton = makeButton('now');
  const dismissButton = makeButton('dismiss');

  const timers = [];
  const context = {
    navigator: { serviceWorker },
    document: {
      visibilityState: 'visible',
      querySelector: (selector) => {
        if (selector === '[data-app-update-banner]') return banner;
        if (selector === '[data-app-update-now]') return updateButton;
        if (selector === '[data-app-update-dismiss]') return dismissButton;
        return null;
      },
      addEventListener: () => undefined,
    },
    reloads: 0,
  };
  context.window = context;
  context.window.location = { reload: () => { context.reloads += 1; } };
  context.window.setTimeout = (handler, delay) => {
    timers.push({ handler, delay });
    return timers.length;
  };
  context.window.addEventListener = () => undefined;

  vm.createContext(context);
  vm.runInContext(source, context);

  return {
    banner,
    registration,
    serviceWorker,
    updateButton,
    dismissButton,
    context,
    runTimers: (maxDelay = Infinity) => {
      const due = timers.filter((timer) => timer.delay <= maxDelay);
      timers.length = 0;
      for (const timer of due) timer.handler();
    },
    settle: async () => {
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    },
  };
}

async function withWaitingWorker(harness) {
  const waiting = new FakeWorker('installed');
  harness.registration.waiting = waiting;
  harness.registration.emit('updatefound');
  await harness.settle();
  return waiting;
}

test('el aviso aparece sólo cuando hay un worker en espera y ya hay uno controlando', async () => {
  const harness = boot();
  await harness.settle();
  assert.equal(harness.banner.hidden, true, 'sin worker en espera no hay nada que avisar');

  await withWaitingWorker(harness);
  assert.equal(harness.banner.hidden, false);
});

test('primera instalación: sin controlador el aviso no se muestra', async () => {
  const harness = boot();
  harness.serviceWorker.controller = null;
  await harness.settle();
  await withWaitingWorker(harness);
  assert.equal(harness.banner.hidden, true, 'la primera instalación no es una actualización');
});

test('el worker en espera activa solo: el aviso se retira aunque nadie toque nada', async () => {
  const harness = boot();
  await harness.settle();
  const waiting = await withWaitingWorker(harness);
  assert.equal(harness.banner.hidden, false);

  // Activación por su cuenta: `waiting` pasa a activarse y el registro se vacía.
  harness.registration.waiting = null;
  waiting.becomes('activating');
  await harness.settle();

  assert.equal(harness.banner.hidden, true, 'el aviso no puede sobrevivir al worker que anunciaba');
});

test('otra pestaña actualiza: el cambio de control retira el aviso sin recargar esta', async () => {
  const harness = boot();
  await harness.settle();
  await withWaitingWorker(harness);
  assert.equal(harness.banner.hidden, false);

  harness.registration.waiting = null;
  harness.serviceWorker.emit('controllerchange');
  await harness.settle();

  assert.equal(harness.banner.hidden, true);
  assert.equal(harness.context.reloads, 0, 'no se le mueve la pantalla a quien no pidió actualizar');
});

test('«Actualizar ahora» activa el worker y recarga una sola vez', async () => {
  const harness = boot();
  await harness.settle();
  const waiting = await withWaitingWorker(harness);

  harness.updateButton.emit('click');
  await harness.settle();
  assert.deepEqual(waiting.messages, ['skip-waiting']);
  assert.equal(harness.banner.hidden, true);

  harness.registration.waiting = null;
  harness.serviceWorker.emit('controllerchange');
  await harness.settle();
  assert.equal(harness.context.reloads, 1);

  // Un segundo cambio de control no puede volver a recargar: así es como un
  // aviso mal cerrado se convierte en un bucle.
  harness.serviceWorker.emit('controllerchange');
  await harness.settle();
  assert.equal(harness.context.reloads, 1);
});

test('el botón no queda muerto cuando la actualización se activó entre el dibujo y el toque', async () => {
  const harness = boot();
  await harness.settle();
  await withWaitingWorker(harness);
  assert.equal(harness.banner.hidden, false);

  // El worker activó solo, pero nadie sincronizó todavía: es el estado exacto
  // del defecto. Antes, este clic hacía `return` y dejaba el aviso para siempre.
  harness.registration.waiting = null;
  harness.updateButton.emit('click');
  await harness.settle();

  assert.equal(harness.banner.hidden, true, 'tocar el botón nunca puede dejar el aviso pegado');
  assert.equal(harness.context.reloads, 0);
});

test('si la activación no llega, el aviso vuelve en vez de perderse', async () => {
  const harness = boot();
  await harness.settle();
  const waiting = await withWaitingWorker(harness);

  harness.updateButton.emit('click');
  await harness.settle();
  assert.equal(harness.banner.hidden, true);

  // El worker sigue en espera y el control nunca cambió.
  assert.equal(harness.registration.waiting, waiting);
  harness.runTimers();
  await harness.settle();
  assert.equal(harness.banner.hidden, false, 'la actualización pendiente tiene que volver a ofrecerse');
});

test('cerrar el aviso lo silencia para esa versión y no para la siguiente', async () => {
  const harness = boot();
  await harness.settle();
  const first = await withWaitingWorker(harness);

  harness.dismissButton.emit('click');
  assert.equal(harness.banner.hidden, true);

  // Revisar de nuevo no lo resucita: sería el mismo aviso que la persona cerró.
  harness.runTimers();
  await harness.settle();
  assert.equal(harness.banner.hidden, true);
  assert.deepEqual(first.messages, [], 'cerrar no activa nada');

  // La publicación siguiente sí vuelve a avisar.
  harness.registration.waiting = new FakeWorker('installed');
  harness.registration.emit('updatefound');
  await harness.settle();
  assert.equal(harness.banner.hidden, false);
});

test('el mismo worker no acumula escuchas por más veces que se lo revise', async () => {
  const harness = boot();
  await harness.settle();
  const waiting = await withWaitingWorker(harness);

  for (let i = 0; i < 5; i += 1) {
    harness.registration.emit('updatefound');
    harness.runTimers();
    await harness.settle();
  }

  assert.equal(
    waiting.countListeners('statechange'),
    1,
    'una escucha por worker: cada duplicado es una recarga de más el día que cambie de estado',
  );
});

test('el módulo no se enlaza dos veces en el mismo documento', async () => {
  const harness = boot();
  await harness.settle();
  const before = harness.updateButton.countListeners('click');
  vm.runInContext(source, harness.context);
  await harness.settle();
  assert.equal(harness.updateButton.countListeners('click'), before);
});
