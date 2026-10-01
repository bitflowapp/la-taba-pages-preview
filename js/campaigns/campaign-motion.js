/*
 * CAMPAÑAS ANIMADAS — cuándo corre una escena.
 *
 * El CSS tiene la animación entera; este módulo sólo decide si está corriendo.
 * Escribe DOS atributos en la raíz de cada pieza y nada más:
 *
 *   data-motion-campaign="on"            la escena está en marcha
 *   data-motion-campaign-live="true"     la pieza está a la vista; en "false"
 *                                        el CSS pausa todo lo que haya adentro
 *
 * Sin ninguno de los dos, la pieza es su cuadro final: estática y completa. Ese
 * es el estado con movimiento reducido, en modo liviano, sin
 * IntersectionObserver o si este módulo no llega a arrancar.
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

export function initCampaignMotion(documentRef = globalThis.document, windowRef = globalThis.window) {
  activeController?.destroy();
  const inert = { refresh() {}, destroy() {}, getDiagnostics: () => ({ active: false }) };
  if (!documentRef?.body || !windowRef) return inert;

  const reducedQuery = windowRef.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
  const observed = new Set();
  const visible = new Set();
  const startedAt = new WeakMap();
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

  const start = (root) => {
    const last = startedAt.get(root);
    const finished = last === undefined ? 0 : last + durationOf(root, windowRef) + IDLE_MS;
    if (last !== undefined && now() - finished < REPLAY_GAP_MS) return;
    if (root.dataset.motionCampaign === 'on') {
      // Reiniciar una animación CSS exige quitarla y forzar un recálculo antes
      // de volver a ponerla. Pasa a lo sumo una vez por pieza cada 45 s.
      delete root.dataset.motionCampaign;
      void root.offsetWidth;
    }
    root.dataset.motionCampaign = 'on';
    startedAt.set(root, now());
    plays += 1;
  };

  const sync = (root) => {
    if (!allowed()) { still(root); return; }
    const live = visible.has(root) && !documentRef.hidden;
    if (root.dataset.motionCampaign === 'on') write(root, 'motionCampaignLive', String(live));
  };

  const observer = 'IntersectionObserver' in windowRef
    ? new windowRef.IntersectionObserver((entries) => {
      for (const entry of entries) {
        const root = entry.target;
        if (entry.isIntersecting) visible.add(root);
        else visible.delete(root);
        if (allowed() && entry.isIntersecting && entry.intersectionRatio >= START_RATIO && !documentRef.hidden) start(root);
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
    }
    for (const root of current) {
      if (observed.has(root)) continue;
      observed.add(root);
      observer.observe(root);
    }
  };

  const onVisibility = () => observed.forEach(sync);
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
      if (activeController === controller) activeController = null;
    },
    getDiagnostics() {
      const roots = [...observed];
      return {
        active: true,
        reducedMotion: Boolean(reducedQuery?.matches),
        liteMode: lite(),
        observerCount: observer ? 1 : 0,
        campaigns: roots.length,
        visible: visible.size,
        running: roots.filter((root) => root.dataset.motionCampaign === 'on').length,
        live: roots.filter((root) => root.dataset.motionCampaignLive === 'true').length,
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
