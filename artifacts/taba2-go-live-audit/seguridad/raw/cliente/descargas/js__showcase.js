import { isShowcaseMode } from './core/app-mode.js';

const CALLBACK_NOT_CONFIGURED = Object.freeze({
  ok: false,
  message: 'Esta acción del recorrido todavía no está configurada.',
});

const DEFAULT_CALLBACKS = Object.freeze({
  onSelectStep: async () => CALLBACK_NOT_CONFIGURED,
  onReset: async () => CALLBACK_NOT_CONFIGURED,
  onExit: async () => CALLBACK_NOT_CONFIGURED,
});

export const SHOWCASE_STEPS = Object.freeze([
  showcaseStep({
    id: 'catalog',
    title: 'Catálogo de bebidas',
    description: 'Explorá el catálogo local aprobado, sus categorías, búsqueda e imágenes optimizadas.',
    view: 'catalog',
    scenario: 'catalog',
  }),
  showcaseStep({
    id: 'pending-price',
    title: 'Producto con precio pendiente',
    description: 'Abrí un producto sin precio publicado y comprobá que no pueda agregarse por error.',
    view: 'catalog',
    scenario: 'pending-price',
  }),
  showcaseStep({
    id: 'cart',
    title: 'Carrito',
    description: 'Usá un producto de demostración para recorrer cantidades, resumen y vaciado del pedido.',
    view: 'cart',
    scenario: 'cart-with-items',
  }),
  showcaseStep({
    id: 'checkout',
    title: 'Checkout',
    description: 'Revisá datos, validaciones, confirmaciones y el resumen antes de crear un pedido local.',
    view: 'cart',
    scenario: 'checkout',
  }),
  showcaseStep({
    id: 'delivery-pickup',
    title: 'Envío y retiro',
    description: 'Compará los campos y decisiones reales de delivery y retiro sin prometer costos ni tiempos comerciales.',
    view: 'cart',
    scenario: 'delivery-pickup',
  }),
  showcaseStep({
    id: 'profile',
    title: 'Perfil',
    description: 'Recorré la edición del perfil con una identidad sintética y validación de teléfono argentino.',
    view: 'profile',
    scenario: 'profile',
  }),
  showcaseStep({
    id: 'addresses',
    title: 'Direcciones',
    description: 'Probá alta, edición, número de calle y dirección principal con ubicaciones ficticias.',
    view: 'profile',
    scenario: 'addresses',
  }),
  showcaseStep({
    id: 'business',
    title: 'Panel del negocio',
    description: 'Abrí la central real con un pedido sintético recién recibido y su información operativa.',
    view: 'business',
    scenario: 'business-received',
  }),
  showcaseStep({
    id: 'order-management',
    title: 'Gestión del pedido',
    description: 'Avanzá el flujo real de preparación, pedido listo, asignación y estados terminales.',
    view: 'business',
    scenario: 'business-workflow',
  }),
  showcaseStep({
    id: 'rider',
    title: 'Rider',
    description: 'Tomá una entrega sintética y revisá las acciones protegidas del recorrido de reparto.',
    view: 'rider',
    scenario: 'rider-ready',
  }),
  showcaseStep({
    id: 'tracking-map',
    title: 'Tracking MapLibre',
    description: 'Visualizá el mapa y timeline con un recorrido local de muestra claramente distinto de GPS real.',
    view: 'tracking',
    scenario: 'tracking-simulated',
  }),
  showcaseStep({
    id: 'delivered',
    title: 'Estado entregado',
    description: 'Comprobá el cierre del pedido, el timeline terminal y la desaparición de datos ya innecesarios.',
    view: 'tracking',
    scenario: 'tracking-delivered',
  }),
  showcaseStep({
    id: 'session-recovery',
    title: 'Recuperación de sesión',
    description: 'Recargá la experiencia y verificá que el mismo escenario local reaparezca desde la persistencia.',
    view: 'tracking',
    scenario: 'session-recovery',
  }),
  showcaseStep({
    id: 'privacy-security',
    title: 'Seguridad y privacidad',
    description: 'Revisá límites de datos, tracking terminal y qué protección móvil sigue pendiente de integración.',
    view: 'profile',
    scenario: 'privacy-boundaries',
  }),
]);

export const SHOWCASE_RELEASE_STATUS = Object.freeze({
  auditedBase: '0e1fed1',
  definition: '“Integrado” significa presente en esta base local auditada; no significa listo para producción.',
  groups: Object.freeze([
    releaseGroup({
      id: 'integrated',
      label: 'Integrado en esta base',
      summary: 'Disponible para recorrer con componentes reales y datos sintéticos.',
      items: [
        'Catálogo de bebidas, imágenes optimizadas y tratamiento de precio pendiente.',
        'Perfil, direcciones, checkout, envío y retiro.',
        'Tracking base, MapLibre, timeline, rider, estados sin GPS y recuperación local.',
        'Visibilidad terminal acotada y revalidación local incorporadas mediante 86e9ed0 y 0e1fed1.',
      ],
    }),
    releaseGroup({
      id: 'pending-fix',
      label: 'Corrección pendiente',
      summary: 'Se informa, pero no se integra ni se presenta como resuelta.',
      items: [
        'La eliminación inmediata del deliveryCode cacheado al pasar a estado terminal sigue pendiente.',
      ],
    }),
    releaseGroup({
      id: 'certified-pending',
      label: 'Certificado, pendiente de integración',
      summary: 'No se presenta como activo en esta base.',
      items: [
        'La protección táctil móvil y preservación de gestos MapLibre de 71bb08b sigue fuera de este HEAD.',
      ],
    }),
    releaseGroup({
      id: 'rejected',
      label: 'Rechazado o excluido',
      summary: 'No forma parte del recorrido ni se recupera como funcionalidad.',
      items: [
        'La línea 413b702 y la migración 20260729210000_tracking_terminal_visibility.sql permanecen excluidas.',
      ],
    }),
  ]),
  limitations: Object.freeze([
    'No usa datos personales, pedidos, stock, GPS ni condiciones comerciales reales.',
    'Los datos y la persistencia son locales; MapLibre y sus mosaicos cartográficos públicos pueden requerir Internet.',
    'No acredita staging, piloto, prueba física, producción ni certificación remota.',
    'Mercado Pago no se presenta como implementado o terminado.',
  ]),
});

let callbacks = { ...DEFAULT_CALLBACKS };
let root = null;
let uiState = {
  activeStepId: '',
  busy: false,
  message: '',
  messageTone: 'info',
};

/**
 * Configura los límites de integración de la capa visual.
 * El módulo no conoce repositorios, fixtures ni navegación: cada acción se
 * delega y la aplicación decide cómo preparar y abrir la vista real.
 */
export function configureShowcase({
  onSelectStep,
  onReset,
  onExit,
} = {}) {
  callbacks = {
    onSelectStep: typeof onSelectStep === 'function' ? onSelectStep : DEFAULT_CALLBACKS.onSelectStep,
    onReset: typeof onReset === 'function' ? onReset : DEFAULT_CALLBACKS.onReset,
    onExit: typeof onExit === 'function' ? onExit : DEFAULT_CALLBACKS.onExit,
  };

  renderShowcase();

  return () => {
    callbacks = { ...DEFAULT_CALLBACKS };
    removeShowcase();
  };
}

export function renderShowcase(nextState = {}) {
  if (typeof document === 'undefined' || !document.body) return null;
  if (!isShowcaseMode()) {
    removeShowcase();
    return null;
  }

  uiState = normalizeUiState({ ...uiState, ...definedState(nextState) });
  const showcaseRoot = ensureRoot();
  showcaseRoot.setAttribute('aria-busy', String(uiState.busy));

  const activeIndex = SHOWCASE_STEPS.findIndex((step) => step.id === uiState.activeStepId);
  const completedCount = activeIndex >= 0 ? activeIndex + 1 : 0;
  const progress = showcaseRoot.querySelector('[data-showcase-progress]');
  if (progress) {
    progress.textContent = completedCount
      ? `Parada ${completedCount} de ${SHOWCASE_STEPS.length}`
      : `${SHOWCASE_STEPS.length} funciones para recorrer`;
  }

  showcaseRoot.querySelectorAll('[data-showcase-step]').forEach((button) => {
    const active = button.dataset.showcaseStep === uiState.activeStepId;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
    button.disabled = uiState.busy;
  });

  showcaseRoot.querySelectorAll('[data-showcase-disable-when-busy]').forEach((control) => {
    control.disabled = uiState.busy;
  });

  const nextButton = showcaseRoot.querySelector('[data-showcase-action="next"]');
  if (nextButton) {
    const atEnd = activeIndex === SHOWCASE_STEPS.length - 1;
    nextButton.disabled = uiState.busy || atEnd;
    nextButton.textContent = activeIndex < 0
      ? 'Comenzar recorrido'
      : atEnd
        ? 'Última parada'
        : 'Siguiente parada';
  }

  const message = showcaseRoot.querySelector('[data-showcase-message]');
  if (message) {
    message.textContent = uiState.message;
    message.hidden = !uiState.message;
    message.dataset.tone = uiState.messageTone;
  }

  return showcaseRoot;
}

export async function handleShowcaseAction(target) {
  if (!isShowcaseMode() || !root || !isElement(target)) return { handled: false };
  const control = target.closest('[data-showcase-action]');
  if (!control || !root.contains(control)) return { handled: false };

  const action = control.dataset.showcaseAction;
  if (action === 'open' || action === 'return') {
    openDialog();
    return { handled: true, ok: true };
  }
  if (action === 'close') {
    closeDialog({ restoreFocus: true });
    return { handled: true, ok: true };
  }
  if (uiState.busy) {
    return { handled: true, ok: false, message: 'Esperá a que termine la acción actual.' };
  }
  if (action === 'select') {
    return selectStep(control.dataset.showcaseStep);
  }
  if (action === 'next') {
    return selectStep(nextStepId());
  }
  if (action === 'reset') {
    return runCallbackAction('reset', callbacks.onReset, {
      successMessage: 'El recorrido local quedó listo para empezar de nuevo.',
      resetActiveStep: true,
    });
  }
  if (action === 'exit') {
    const result = await runCallbackAction('exit', callbacks.onExit, {
      successMessage: 'Saliendo del modo demostración local.',
    });
    if (result.ok) closeDialog({ restoreFocus: false });
    return result;
  }

  return { handled: false };
}

function showcaseStep(step) {
  return Object.freeze({
    ...step,
    releaseStatus: step.releaseStatus || 'integrated',
  });
}

function releaseGroup(group) {
  return Object.freeze({
    ...group,
    items: Object.freeze([...(group.items || [])]),
  });
}

function ensureRoot() {
  if (root?.isConnected) return root;

  root = document.createElement('div');
  root.className = 'showcase-root';
  root.dataset.showcaseRoot = '';
  root.innerHTML = showcaseMarkup();
  root.addEventListener('click', (event) => {
    const control = event.target?.closest?.('[data-showcase-action]');
    if (!control) return;
    event.preventDefault();
    event.stopPropagation();
    void handleShowcaseAction(control);
  });

  const dialog = root.querySelector('[data-showcase-dialog]');
  dialog?.addEventListener('close', syncDialogState);
  dialog?.addEventListener('cancel', () => {
    queueMicrotask(() => syncDialogState());
  });

  document.body.appendChild(root);
  return root;
}

function showcaseMarkup() {
  return `
    <div class="showcase-launcher" data-showcase-launcher>
      <span class="showcase-mode-badge">
        <span class="showcase-mode-dot" aria-hidden="true"></span>
        Modo demostración local
      </span>
      <button
        class="showcase-return-button"
        type="button"
        data-showcase-action="return"
        aria-haspopup="dialog"
        aria-expanded="false"
        aria-controls="taba-showcase-dialog"
      >Volver al recorrido</button>
    </div>

    <dialog
      class="showcase-dialog"
      id="taba-showcase-dialog"
      data-showcase-dialog
      aria-labelledby="taba-showcase-title"
      aria-describedby="taba-showcase-disclaimer"
    >
      <div class="showcase-dialog-shell">
        <header class="showcase-dialog-header">
          <div>
            <span class="showcase-kicker">Recorrido guiado</span>
            <h2 id="taba-showcase-title">Conocé TABA de punta a punta</h2>
            <p data-showcase-progress>${SHOWCASE_STEPS.length} funciones para recorrer</p>
          </div>
          <button
            class="showcase-icon-button"
            type="button"
            data-showcase-action="close"
            aria-label="Cerrar recorrido"
          >×</button>
        </header>

        <div class="showcase-dialog-scroll">
          <aside class="showcase-disclaimer" id="taba-showcase-disclaimer">
            <strong>Todos los datos y la persistencia de esta recorrida son locales y sintéticos.</strong>
            <p>No usa Supabase remoto ni datos reales. MapLibre y sus mosaicos cartográficos públicos pueden requerir Internet. Los importes, stock, ubicaciones y tiempos no representan condiciones comerciales. Este recorrido no acredita que producción esté lista.</p>
          </aside>

          <section class="showcase-tour-section" aria-labelledby="taba-showcase-steps-title">
            <div class="showcase-section-heading">
              <span class="showcase-kicker">Recorrido</span>
              <h3 id="taba-showcase-steps-title">Elegí qué querés ver</h3>
            </div>
            <ol class="showcase-step-list">
              ${SHOWCASE_STEPS.map((step, index) => `
                <li>
                  <button
                    class="showcase-step-button"
                    type="button"
                    data-showcase-action="select"
                    data-showcase-step="${escapeHtml(step.id)}"
                  >
                    <span class="showcase-step-number" aria-hidden="true">${index + 1}</span>
                    <span class="showcase-step-copy">
                      <strong>${escapeHtml(step.title)}</strong>
                      <small>${escapeHtml(step.description)}</small>
                    </span>
                    <span class="showcase-step-arrow" aria-hidden="true">›</span>
                  </button>
                </li>`).join('')}
            </ol>
          </section>

          <section class="showcase-release-section" aria-labelledby="taba-showcase-release-title">
            <div class="showcase-section-heading">
              <span class="showcase-kicker">Estado de esta base</span>
              <h3 id="taba-showcase-release-title">Qué mejoró en TABA</h3>
              <p>${escapeHtml(SHOWCASE_RELEASE_STATUS.definition)}</p>
            </div>
            <div class="showcase-release-grid">
              ${SHOWCASE_RELEASE_STATUS.groups.map((group) => `
                <article class="showcase-release-card is-${escapeHtml(group.id)}" data-release-status="${escapeHtml(group.id)}">
                  <span class="showcase-release-label">${escapeHtml(group.label)}</span>
                  <p>${escapeHtml(group.summary)}</p>
                  <ul>
                    ${group.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
                  </ul>
                </article>`).join('')}
            </div>
            <aside class="showcase-limitations">
              <strong>Límites honestos</strong>
              <ul>
                ${SHOWCASE_RELEASE_STATUS.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
              </ul>
            </aside>
          </section>
        </div>

        <p class="showcase-message" data-showcase-message data-tone="info" role="status" aria-live="polite" hidden></p>

        <footer class="showcase-dialog-footer">
          <button
            class="showcase-text-button"
            type="button"
            data-showcase-action="exit"
            data-showcase-disable-when-busy
          >Salir del modo</button>
          <div class="showcase-footer-actions">
            <button
              class="showcase-secondary-button"
              type="button"
              data-showcase-action="reset"
              data-showcase-disable-when-busy
            >Reiniciar</button>
            <button
              class="showcase-secondary-button"
              type="button"
              data-showcase-action="close"
            >Volver a la vista</button>
            <button
              class="showcase-primary-button"
              type="button"
              data-showcase-action="next"
              data-showcase-disable-when-busy
            >Comenzar recorrido</button>
          </div>
        </footer>
      </div>
    </dialog>
  `;
}

async function selectStep(stepId) {
  const step = SHOWCASE_STEPS.find((candidate) => candidate.id === stepId);
  if (!step) return setMessageResult(false, 'No encontramos esa parada del recorrido.');

  uiState = {
    ...uiState,
    busy: true,
    message: `Preparando: ${step.title}…`,
    messageTone: 'info',
  };
  renderShowcase();

  try {
    const callbackResult = normalizeCallbackResult(
      await callbacks.onSelectStep(step),
      `Mostrando: ${step.title}.`,
    );
    uiState = {
      ...uiState,
      busy: false,
      message: callbackResult.message,
      messageTone: callbackResult.ok ? 'success' : 'error',
      ...(callbackResult.ok ? { activeStepId: step.id } : {}),
    };
    renderShowcase();
    if (callbackResult.ok) closeDialog({ restoreFocus: false });
    return { handled: true, ...callbackResult, step };
  } catch (_) {
    return setMessageResult(false, 'No pudimos preparar esta parada. Reiniciá el recorrido e intentá de nuevo.');
  }
}

async function runCallbackAction(action, callback, {
  successMessage,
  resetActiveStep = false,
} = {}) {
  uiState = {
    ...uiState,
    busy: true,
    message: action === 'reset' ? 'Reiniciando el escenario local…' : 'Cerrando el recorrido…',
    messageTone: 'info',
  };
  renderShowcase();

  try {
    const callbackResult = normalizeCallbackResult(await callback(), successMessage);
    uiState = {
      ...uiState,
      busy: false,
      message: callbackResult.message,
      messageTone: callbackResult.ok ? 'success' : 'error',
      ...(callbackResult.ok && resetActiveStep ? { activeStepId: '' } : {}),
    };
    renderShowcase();
    return { handled: true, ...callbackResult };
  } catch (_) {
    return setMessageResult(false, action === 'reset'
      ? 'No pudimos reiniciar el escenario local.'
      : 'No pudimos salir del modo demostración.');
  }
}

function setMessageResult(ok, message) {
  uiState = {
    ...uiState,
    busy: false,
    message,
    messageTone: ok ? 'success' : 'error',
  };
  renderShowcase();
  return { handled: true, ok, message };
}

function normalizeCallbackResult(result, fallbackMessage) {
  if (result === false) return { ok: false, message: 'La acción no pudo completarse.' };
  if (typeof result === 'string') return { ok: true, message: result || fallbackMessage };
  if (result && typeof result === 'object') {
    return {
      ...result,
      ok: result.ok !== false,
      message: String(result.message || fallbackMessage || ''),
    };
  }
  return { ok: true, message: fallbackMessage || '' };
}

function nextStepId() {
  const currentIndex = SHOWCASE_STEPS.findIndex((step) => step.id === uiState.activeStepId);
  return SHOWCASE_STEPS[Math.min(currentIndex + 1, SHOWCASE_STEPS.length - 1)]?.id || SHOWCASE_STEPS[0].id;
}

function openDialog() {
  const dialog = root?.querySelector('[data-showcase-dialog]');
  if (!dialog) return;
  if (!dialog.open) {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }
  syncDialogState();
  const active = dialog.querySelector('[data-showcase-step][aria-current="step"]')
    || dialog.querySelector('[data-showcase-step]');
  active?.focus({ preventScroll: true });
}

function closeDialog({ restoreFocus = false } = {}) {
  const dialog = root?.querySelector('[data-showcase-dialog]');
  if (!dialog?.open) return;
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
  syncDialogState();
  if (restoreFocus) root?.querySelector('[data-showcase-action="return"]')?.focus({ preventScroll: true });
}

function syncDialogState() {
  const dialog = root?.querySelector('[data-showcase-dialog]');
  const launcher = root?.querySelector('[data-showcase-action="return"]');
  launcher?.setAttribute('aria-expanded', String(Boolean(dialog?.open)));
}

function removeShowcase() {
  if (!root) return;
  const dialog = root.querySelector('[data-showcase-dialog]');
  if (dialog?.open && typeof dialog.close === 'function') dialog.close();
  root.remove();
  root = null;
}

function normalizeUiState(state) {
  const activeStepId = SHOWCASE_STEPS.some((step) => step.id === state.activeStepId)
    ? state.activeStepId
    : '';
  const messageTone = ['info', 'success', 'error'].includes(state.messageTone)
    ? state.messageTone
    : 'info';
  return {
    activeStepId,
    busy: Boolean(state.busy),
    message: String(state.message || ''),
    messageTone,
  };
}

function definedState(state) {
  return Object.fromEntries(
    Object.entries(state).filter(([, value]) => value !== undefined),
  );
}

function isElement(value) {
  return typeof Element !== 'undefined' && value instanceof Element;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[character]));
}
