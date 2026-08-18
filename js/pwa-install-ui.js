/*
 * LA INVITACIÓN A INSTALAR — la parte que toca el DOM.
 *
 * Todo lo que decide (qué plataforma es, si corresponde invitar, qué se guardó)
 * vive en `js/core/pwa-install.js` y se prueba sin navegador. Acá sólo queda
 * abrir y cerrar una hoja, conectar cuatro botones y recordar la decisión.
 *
 * TRES REGLAS QUE ESTÁN ESCRITAS EN EL CÓDIGO Y NO EN UN COMENTARIO SUELTO:
 *
 *  1. `prompt()` se llama SÓLO desde el gesto de la persona. Capturar
 *     `beforeinstallprompt` y llamarlo solo no instala nada: el navegador lo
 *     rechaza por falta de activación del usuario, y de paso quema el evento.
 *  2. El evento diferido es de UN SOLO USO. Se suelta la referencia antes de
 *     esperar el resultado, así una segunda pulsación no reusa un evento muerto.
 *  3. La hoja se abre en un momento libre y se vuelve a comprobar JUSTO ANTES
 *     de abrir. Entre que se programa y que llega, alguien pudo entrar al
 *     checkout o abrir la ficha de un producto.
 */
import {
  INSTALL_DECISION,
  detectPlatform,
  hasResolvedInstallDecision,
  installInvitationKind,
  isInvitationMomentClear,
  manualInstallEntryKind,
  readInstallDecision,
  shouldInviteInstall,
  writeInstallDecision,
} from './core/pwa-install.js';

/*
 * Cuánto se espera desde que la tienda quedó lista.
 *
 * No es un número de gusto: la home reemplaza el esqueleto por los carruseles
 * definitivos ~350 ms después del primer pintado, y el catálogo hidrata detrás.
 * Abrir una hoja sobre una pantalla que todavía se está armando se ve como un
 * error de la app. Dos segundos y medio dejan ver la tienda antes de pedir nada.
 */
const INVITATION_DELAY_MS = 2500;

/*
 * Cuánto se insiste cuando el momento no estaba libre, y cada cuánto.
 *
 * Hay dos motivos distintos para no abrir y necesitan dos disparadores
 * distintos: si la persona está en el checkout, lo que cambia el momento es que
 * NAVEGUE —y eso llega por el observador de la vista—; si está tocando la
 * góndola, lo que cambia el momento es que PARE, y parar no dispara ningún
 * evento, así que hay que volver a mirar solo.
 *
 * La paciencia se mide en TIEMPO y no en cantidad de intentos: los dos
 * disparadores se pisan entre sí —una navegación puede caer justo sobre un
 * reintento— y un contador convertía eso en un presupuesto impredecible.
 * Veinte segundos son veinte segundos, se llegue por donde se llegue. Pasados,
 * se abandona por esta visita: la invitación no es obligatoria y quien siga
 * ocupado la tiene siempre en el Perfil.
 */
const INVITATION_PATIENCE_MS = 20_000;
const INVITATION_RETRY_MS = 2000;

const $ = (selector) => document.querySelector(selector);

export function initPwaInstall({ showToast = () => {} } = {}) {
  const sheet = $('[data-install-sheet]');
  const entry = $('[data-install-entry]');

  let deferredPrompt = null;
  // Mientras se resuelve el prompt nativo, el cierre de la hoja NO significa
  // "no quiero": lo cerramos nosotros para dejar ver el diálogo del sistema.
  let resolvingNative = false;
  let invited = false;
  // Cuándo se deja de insistir. Se fija en el PRIMER intento, no al arrancar:
  // la paciencia empieza a correr cuando la invitación está lista para abrirse.
  let giveUpAt = Number.POSITIVE_INFINITY;
  let viewObserver = null;
  let retryTimer = 0;
  /*
   * Cuándo tocó o tecleó por última vez. Arranca en el pasado remoto para que
   * quien abre la tienda y no toca nada reciba la invitación sin esperar de más.
   *
   * Se escucha en fase de CAPTURA y en pasivo: nada de lo que pase acá puede
   * llegar antes que el manejador de la tienda ni frenar un scroll.
   */
  let lastInteractionAt = 0;
  for (const evento of ['pointerdown', 'keydown', 'touchstart', 'wheel']) {
    window.addEventListener(evento, () => { lastInteractionAt = Date.now(); }, { capture: true, passive: true });
  }

  const platform = () => detectPlatform();

  /* ── Estado guardado ──────────────────────────────────────────────────── */

  const remember = (decision) => {
    const snapshot = platform();
    writeInstallDecision(decision, {
      platform: snapshot.isIOS ? 'ios' : (snapshot.isAndroid ? 'android' : 'desktop'),
    });
  };

  /* ── La hoja ──────────────────────────────────────────────────────────── */

  const views = () => (sheet ? [...sheet.querySelectorAll('[data-install-view]')] : []);

  const showView = (name) => {
    for (const view of views()) view.hidden = view.dataset.installView !== name;
  };

  const openSheet = (kind) => {
    if (!sheet || sheet.open) return false;
    if (kind === 'ios') prepareIOSCopy();
    showView(kind);
    if (typeof sheet.showModal !== 'function') return false;
    try {
      sheet.showModal();
    } catch (_) {
      return false;
    }
    return true;
  };

  const closeSheet = () => {
    if (sheet?.open) sheet.close();
  };

  /*
   * La guía de iOS se adapta al navegador REAL, que es lo que pidió el pedido:
   * el Compartir de Safari está en la barra de abajo, el de Chrome/Edge/Firefox
   * para iOS está en su propio menú, y dentro del navegador embebido de otra
   * app la opción directamente no existe.
   */
  const prepareIOSCopy = () => {
    const capability = platform().iosCapability;
    const lead = sheet?.querySelector('[data-install-steps-lead]');
    const where = sheet?.querySelector('[data-install-steps-where]');
    if (lead) lead.hidden = capability !== 'webview';
    if (where) {
      where.textContent = capability === 'browser'
        ? 'en el menú de tu navegador.'
        : 'en la barra de abajo de Safari.';
    }
  };

  /* ── La entrada permanente del Perfil ─────────────────────────────────── */

  const refreshEntry = () => {
    if (!entry) return;
    const kind = manualInstallEntryKind({ platform: platform(), hasDeferredPrompt: Boolean(deferredPrompt) });
    entry.hidden = !kind;
    if (!kind) return;
    entry.dataset.installEntryKind = kind;
    const title = entry.querySelector('[data-install-entry-title]');
    const copy = entry.querySelector('[data-install-entry-copy]');
    const action = entry.querySelector('[data-install-entry-action-label]');
    if (kind === 'ios') {
      if (title) title.textContent = 'Agregá La Taba al inicio';
      if (copy) copy.textContent = 'Tené La Taba como una app en tu iPhone.';
      if (action) action.textContent = 'Ver cómo';
      return;
    }
    if (title) title.textContent = 'Instalar La Taba';
    if (copy) copy.textContent = 'Abrila como una app, sin buscar la página cada vez.';
    if (action) action.textContent = 'Instalar';
  };

  /* ── La invitación automática ─────────────────────────────────────────── */

  const currentMoment = () => ({
    bootstrapReady: document.documentElement.dataset.appBootstrap === 'ready',
    // Cualquier diálogo abierto —ficha de producto, sugerencias del checkout,
    // historias, confirmación de cancelar— es trabajo en curso de otra persona.
    hasOpenDialog: Boolean(document.querySelector('dialog[open]')),
    activeView: document.body.dataset.activeView || '',
    msSinceInteraction: Date.now() - lastInteractionAt,
  });

  const tryInvite = () => {
    if (invited || !sheet) return;
    if (giveUpAt === Number.POSITIVE_INFINITY) giveUpAt = Date.now() + INVITATION_PATIENCE_MS;
    const kind = shouldInviteInstall({
      platform: platform(),
      hasDeferredPrompt: Boolean(deferredPrompt),
      decision: readInstallDecision().decision,
      moment: currentMoment(),
    });
    if (!kind) {
      if (Date.now() >= giveUpAt) { stopWatching(); return; }
      watchForClearMoment();
      window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(tryInvite, INVITATION_RETRY_MS);
      return;
    }
    if (openSheet(kind)) {
      invited = true;
      stopWatching();
    }
  };

  const watchForClearMoment = () => {
    if (viewObserver || !document.body) return;
    viewObserver = new MutationObserver(() => {
      // Un cambio de vista puede llegar con la pantalla todavía moviéndose:
      // el mismo respiro que la primera vez.
      window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(tryInvite, 600);
    });
    viewObserver.observe(document.body, { attributes: true, attributeFilter: ['data-active-view'] });
  };

  const stopWatching = () => {
    viewObserver?.disconnect();
    viewObserver = null;
    window.clearTimeout(retryTimer);
  };

  /* ── Android: el prompt nativo ────────────────────────────────────────── */

  const runNativePrompt = async () => {
    const prompt = deferredPrompt;
    if (!prompt) {
      // Sin evento no hay instalación: no se finge nada, se cierra y la entrada
      // del Perfil se vuelve a dibujar con la verdad.
      closeSheet();
      refreshEntry();
      return '';
    }
    // Se suelta ANTES de esperar: el evento es de un solo uso.
    deferredPrompt = null;
    resolvingNative = true;
    closeSheet();
    let outcome = '';
    try {
      const result = await prompt.prompt();
      outcome = result?.outcome || (await prompt.userChoice)?.outcome || '';
    } catch (_) {
      // El navegador lo bloqueó o la persona cerró el diálogo del sistema sin
      // elegir. No se guarda decisión: no la hubo.
      outcome = '';
    }
    resolvingNative = false;
    if (outcome === 'accepted') remember(INSTALL_DECISION.ACCEPTED);
    else if (outcome === 'dismissed') remember(INSTALL_DECISION.DECLINED);
    refreshEntry();
    return outcome;
  };

  /* ── Cableado ─────────────────────────────────────────────────────────── */

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    refreshEntry();
    // Puede llegar después del respiro inicial: si todavía no invitamos y el
    // momento está libre, esta es la primera oportunidad real de hacerlo.
    if (!invited && !hasResolvedInstallDecision()) tryInvite();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    resolvingNative = false;
    invited = true;
    remember(INSTALL_DECISION.INSTALLED);
    stopWatching();
    closeSheet();
    refreshEntry();
    showToast('¡Listo! La Taba quedó en tu pantalla de inicio.');
  });

  sheet?.addEventListener('close', () => {
    if (resolvingNative) return;
    // Cerrar la hoja —con "Ahora no", con la ✕, con Escape o tocando afuera—
    // es decir que no ahora. Se recuerda una sola vez: si ya hay decisión
    // guardada (aceptó, instaló) no se pisa.
    if (!hasResolvedInstallDecision()) remember(INSTALL_DECISION.DECLINED);
    refreshEntry();
  });

  // Tocar fuera de la tarjeta cierra la hoja, que es lo que espera cualquiera
  // frente a un bottom sheet. El `<dialog>` no lo hace solo.
  sheet?.addEventListener('click', (event) => {
    if (event.target === sheet) closeSheet();
  });

  sheet?.querySelector('[data-install-close]')?.addEventListener('click', closeSheet);
  sheet?.querySelector('[data-install-done]')?.addEventListener('click', closeSheet);
  // "Ahora no" existe dos veces —una por cara— y las dos hacen lo mismo.
  for (const button of sheet?.querySelectorAll('[data-install-decline]') || []) {
    button.addEventListener('click', closeSheet);
  }
  sheet?.querySelector('[data-install-accept]')?.addEventListener('click', () => { runNativePrompt(); });
  sheet?.querySelector('[data-install-ios-how]')?.addEventListener('click', () => {
    prepareIOSCopy();
    showView('ios-steps');
  });

  entry?.querySelector('[data-install-entry-action]')?.addEventListener('click', () => {
    const kind = manualInstallEntryKind({ platform: platform(), hasDeferredPrompt: Boolean(deferredPrompt) });
    if (kind === 'android') {
      // Desde el Perfil se va directo al prompt nativo: la persona ya pidió
      // instalar, mostrarle una hoja que repite la pregunta sería un paso de más.
      runNativePrompt();
      return;
    }
    if (kind === 'ios') openSheet('ios');
  });

  refreshEntry();

  return {
    /** La llama `bootstrap()` cuando la tienda terminó de armarse. */
    notifyAppReady() {
      if (invited || hasResolvedInstallDecision()) {
        refreshEntry();
        return;
      }
      window.setTimeout(tryInvite, INVITATION_DELAY_MS);
    },
    /** Para QA y para la comprobación manual: abre la hoja que corresponda. */
    open() {
      const kind = installInvitationKind({ platform: platform(), hasDeferredPrompt: Boolean(deferredPrompt) });
      return kind ? openSheet(kind) : false;
    },
    refreshEntry,
    isMomentClear: () => isInvitationMomentClear(currentMoment()),
  };
}
