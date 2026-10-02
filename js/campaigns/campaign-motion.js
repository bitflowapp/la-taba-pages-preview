/*
 * CAMPAÑAS ANIMADAS — cuándo corre una escena.
 *
 * El CSS tiene la animación entera; este módulo sólo decide si está corriendo.
 * Escribe DOS atributos en la raíz de cada pieza y nada más:
 *
 *   data-motion-campaign="on"            la escena está armada o en marcha
 *   data-motion-campaign-live="true"     la pieza está a la vista; en "false"
 *                                        el CSS pausa todo lo que haya adentro
 *
 * Sin el primero, la pieza es su cuadro final: estática y completa. Ese es el
 * estado con movimiento reducido, en modo liviano, sin IntersectionObserver o si
 * este módulo no llega a arrancar.
 *
 * LOS TRES MOMENTOS DE UNA PIEZA
 *
 *   armada     recién observada y todavía sin entrar en pantalla lo suficiente:
 *              "on" + live "false". Las animaciones existen, pausadas en su
 *              primer cuadro. Antes la pieza esperaba ese momento mostrando el
 *              cuadro FINAL —vaso lleno, acción a la vista— y al cruzar el 40 %
 *              saltaba al vacío para recién ahí empezar: la escena se veía
 *              terminada antes de ocurrir.
 *   en marcha  cruzó el umbral: live "true" mientras esté a la vista.
 *   asentada   terminó su entrada y salió de pantalla: se le quita "on" y queda
 *              en su cuadro final. Antes "on" se quedaba puesto para siempre, y
 *              como las vistas se ocultan con `display: none` —que cancela las
 *              animaciones CSS— cada vuelta a la home o cada búsqueda borrada
 *              repetía la función entera desde cero, salteando la espera de
 *              `REPLAY_GAP_MS`. Sin "on" no hay animación que el navegador
 *              pueda reiniciar por su cuenta.
 *
 * Lo que NO hace, a propósito:
 *
 *   · No crea ni quita nodos. `js/motion.js` observa el documento y una
 *     inserción dispara una recolección completa.
 *   · No usa temporizadores ni `requestAnimationFrame`. La escena avanza sola
 *     en el compositor; acá sólo hay un IntersectionObserver.
 *   · No escribe estilos en línea. Los nombres empiezan con `data-motion-`
 *     porque es el prefijo que el parcheo estable del catálogo conserva.
 */
const ROOT = '[data-campaign]';
const START_RATIO = 0.4;
// Cuánto tiene que haber pasado desde que TERMINÓ una entrada para repetirla
// cuando la pieza vuelve a entrar en pantalla. Subir y bajar un poco no la
// reinicia: la persona ve el vaso lleno, no la función de nuevo.
const REPLAY_GAP_MS = 45000;
// Las burbujas, las gotas y el vapor siguen un rato y se detienen solas.
const IDLE_MS = 26000;

let activeController = null;

function durationOf(root, windowRef) {
  const seconds = Number.parseFloat(windowRef.getComputedStyle(root).getPropertyValue('--cmp-dur'));
  return (Number.isFinite(seconds) ? seconds : 5) * 1000;
}

const INERT = Object.freeze({ refresh() {}, destroy() {}, getDiagnostics: () => ({ active: false }) });

/**
 * Si el movimiento no puede arrancar, la tienda sigue: las piezas quedan en su
 * cuadro final, que es contenido completo. Una animación nunca decide si la
 * tienda abre.
 */
export function initCampaignMotion(documentRef = globalThis.document, windowRef = globalThis.window) {
  try {
    return startCampaignMotion(documentRef, windowRef);
  } catch (error) {
    activeController = null;
    globalThis.console?.warn?.('[TABA] las campañas quedan sin animación', error);
    return INERT;
  }
}

function startCampaignMotion(documentRef, windowRef) {
  activeController?.destroy();
  const inert = INERT;
  if (!documentRef?.body || !windowRef) return inert;

  const reducedQuery = windowRef.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
  const observed = new Set();
  const visible = new Set();
  // Las que ya cruzaron el umbral de arranque. Si el aviso llegó con la pestaña
  // oculta la escena no arranca en ese momento, y sin esta lista tampoco
  // arrancaba al volver: quedaba armada en su primer cuadro, sin acción a la vista.
  const ready = new Set();
  const startedAt = new WeakMap();
  // La duración se mide al arrancar, con la pieza a la vista: después hay que
  // poder consultarla con la vista oculta, sin pedirle estilos a un subárbol
  // que no se está dibujando.
  const durations = new WeakMap();
  let plays = 0;
  let destroyed = false;

  const lite = () => documentRef.body.dataset.motionLite === 'true';
  const allowed = () => !destroyed && !reducedQuery?.matches && !lite();
  const now = () => (windowRef.performance?.now ? windowRef.performance.now() : Date.now());
  const write = (root, name, value) => { if (root.dataset[name] !== value) root.dataset[name] = value; };

  const still = (root) => {
    delete root.dataset.motionCampaign;
    delete root.dataset.motionCampaignLive;
  };

  /** La entrada de esta pieza ya terminó de verse. */
  const settled = (root) => {
    const last = startedAt.get(root);
    return last !== undefined && now() - last >= (durations.get(root) ?? Number.POSITIVE_INFINITY);
  };

  // Una pieza que todavía no se vio queda lista en su PRIMER cuadro. Sólo eso:
  // la que ya tuvo su entrada no se vuelve a armar por reaparecer en el DOM.
  const arm = (root) => {
    if (!allowed() || startedAt.has(root)) return;
    root.dataset.motionCampaign = 'on';
    root.dataset.motionCampaignLive = 'false';
  };

  const start = (root) => {
    const last = startedAt.get(root);
    if (last !== undefined) {
      const finished = last + (durations.get(root) ?? 0) + IDLE_MS;
      if (now() - finished < REPLAY_GAP_MS) return;
      if (root.dataset.motionCampaign === 'on') {
        // Reiniciar una animación CSS exige quitarla y forzar un recálculo antes
        // de volver a ponerla. Pasa a lo sumo una vez por pieza cada 45 s.
        delete root.dataset.motionCampaign;
        void root.offsetWidth;
      }
    }
    write(root, 'motionCampaign', 'on');
    durations.set(root, durationOf(root, windowRef));
    startedAt.set(root, now());
    plays += 1;
  };

  const sync = (root) => {
    if (!allowed()) { still(root); return; }
    if (root.dataset.motionCampaign !== 'on' && !startedAt.has(root)) return;
    const live = startedAt.has(root) && visible.has(root) && !documentRef.hidden;
    write(root, 'motionCampaignLive', String(live));
  };

  const observer = 'IntersectionObserver' in windowRef
    ? new windowRef.IntersectionObserver((entries) => {
      for (const entry of entries) {
        const root = entry.target;
        // Una pieza que salió de pantalla a mitad de su entrada conserva "on":
        // todavía no había terminado. Si vuelve cuando esa entrada ya pasó
        // —la vista estuvo oculta, y eso reinicia las animaciones CSS—, vuelve
        // en su cuadro final y no con la función entera de nuevo.
        if (entry.isIntersecting && !visible.has(root) && settled(root)) delete root.dataset.motionCampaign;
        if (entry.isIntersecting) visible.add(root);
        else visible.delete(root);
        if (entry.isIntersecting && entry.intersectionRatio >= START_RATIO) ready.add(root);
        else ready.delete(root);
        if (allowed() && ready.has(root) && !documentRef.hidden) {
          start(root);
        } else if (!entry.isIntersecting && settled(root)) {
          delete root.dataset.motionCampaign;
        }
        sync(root);
      }
    }, { threshold: [0, START_RATIO] })
    : null;

  /*
   * Las piezas entran y salen con los renders del catálogo. En vez de un
   * MutationObserver propio, quien renderiza avisa: se compara lo que hay
   * contra lo que se estaba observando y se ajusta la diferencia.
   */
  const refresh = () => {
    if (destroyed || !observer) return;
    const current = new Set(documentRef.querySelectorAll(ROOT));
    for (const root of observed) {
      if (current.has(root)) continue;
      observer.unobserve(root);
      observed.delete(root);
      visible.delete(root);
      ready.delete(root);
      // El parcheo estable guarda el nodo para reusarlo: si vuelve —se borró
      // la búsqueda, se volvió al rubro— vuelve en su cuadro final, no con la
      // entrada a medio correr.
      if (startedAt.has(root)) still(root);
    }
    for (const root of current) {
      if (observed.has(root)) continue;
      observed.add(root);
      arm(root);
      observer.observe(root);
    }
  };

  const onVisibility = () => observed.forEach((root) => {
    if (allowed() && !documentRef.hidden && ready.has(root) && !startedAt.has(root)) start(root);
    sync(root);
  });
  const onPreference = () => observed.forEach(sync);
  // Una creatividad que no carga no puede dejar un hueco: la pieza lo declara y
  // el CSS vuelve a mostrar la silueta dibujada.
  const onAssetError = (event) => {
    const root = event.target?.closest?.(ROOT);
    if (root && event.target.matches?.('img')) root.dataset.motionCampaignAsset = 'failed';
  };

  documentRef.addEventListener('visibilitychange', onVisibility);
  documentRef.addEventListener('error', onAssetError, true);
  reducedQuery?.addEventListener?.('change', onPreference);
  refresh();

  const controller = {
    refresh,
    destroy() {
      destroyed = true;
      observer?.disconnect();
      documentRef.removeEventListener('visibilitychange', onVisibility);
      documentRef.removeEventListener('error', onAssetError, true);
      reducedQuery?.removeEventListener?.('change', onPreference);
      observed.forEach(still);
      observed.clear();
      visible.clear();
      ready.clear();
      if (activeController === controller) activeController = null;
    },
    getDiagnostics() {
      const roots = [...observed];
      const running = roots.filter((root) => root.dataset.motionCampaign === 'on');
      return {
        active: true,
        reducedMotion: Boolean(reducedQuery?.matches),
        liteMode: lite(),
        observerCount: observer ? 1 : 0,
        campaigns: roots.length,
        visible: visible.size,
        running: running.length,
        live: running.filter((root) => root.dataset.motionCampaignLive === 'true').length,
        plays,
      };
    },
  };
  activeController = controller;
  return controller;
}

/** Avisar que las superficies se volvieron a renderizar. Barato y sin efectos si no cambió nada. */
export function refreshCampaignMotion() {
  activeController?.refresh();
}
