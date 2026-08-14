/*
 * «ESTA PESTAÑA VOLVIÓ» — LA SEÑAL QUE NINGÚN NAVEGADOR EMITE IGUAL
 *
 * Un cliente mira su pedido, bloquea el teléfono, atiende un mensaje y vuelve.
 * Para el producto eso es UN evento —volvió— y lo único correcto es
 * reconciliar contra el servidor. Para la plataforma no hay un evento: hay
 * cinco, y cada navegador emite un subconjunto distinto.
 *
 *   pageshow          Safari en iOS lo emite al volver de la caché de
 *                     retroceso, que es por donde pasa el cambio de app. Un
 *                     navegador que NO guarda la página ahí no lo emite nunca.
 *   visibilitychange  lo emite casi todo el mundo, pero también al OCULTARSE;
 *                     hay que leer el estado, no el evento.
 *   focus             llega cuando el foco vuelve a la ventana, que no siempre
 *                     coincide con volverse visible.
 *   online            la pestaña estaba viva pero sin red; no hubo cambio de
 *                     visibilidad y sin embargo hay todo un intervalo perdido.
 *   resume            Page Lifecycle: lo emite `document` al descongelar.
 *
 * De ahí sale el defecto que motivó este módulo: la app desarmaba el
 * seguimiento del cliente con un evento de la familia `pagehide` y lo volvía a
 * armar SÓLO con `pageshow`. En el navegador que emite el primero y no el
 * segundo, el seguimiento quedaba apagado sin nada que lo encendiera —y como lo
 * apagado era justamente lo que traía novedades, tampoco había un cambio de
 * estado que redibujara. Se apagaba solo y no se prendía más.
 *
 * La salida no es adivinar qué emite cada navegador: es escuchar TODAS y tratar
 * la primera que llegue como la vuelta. Las demás, si llegan, ya no repiten el
 * trabajo.
 */

// Señales de reanudación que viajan por `window`.
export const BROWSER_RESUME_WINDOW_EVENTS = Object.freeze(['pageshow', 'focus', 'online']);
// `visibilitychange` y `resume` (Page Lifecycle) viajan por `document`.
export const BROWSER_RESUME_DOCUMENT_EVENTS = Object.freeze(['visibilitychange', 'resume']);

// Al volver, iOS despacha pageshow, focus y visibilitychange casi en el mismo
// turno. Reconciliar con cada una le pega tres consultas al servidor por cada
// vuelta a la pantalla.
export const BROWSER_RESUME_COALESCE_MS = 250;

/**
 * Llama a `handler(reason)` cada vez que el navegador indica que la pestaña
 * volvió al frente. Devuelve la función que desarma todos los listeners.
 *
 * El borde de ATAQUE manda: la primera señal reconcilia YA —esperar un debounce
 * es exactamente el retraso que el cliente ve como pantalla vieja— y las que la
 * acompañan quedan absorbidas por la ventana de fusión.
 */
export function onBrowserResume(handler, {
  windowRef = globalThis.window,
  documentRef = globalThis.document,
  coalesceMs = BROWSER_RESUME_COALESCE_MS,
  now = () => Date.now(),
} = {}) {
  if (typeof handler !== 'function') return () => {};

  const fusionMs = Math.max(0, Number(coalesceMs) || 0);
  let bound = true;
  let lastRunAt = 0;

  const run = (reason) => {
    if (!bound) return;
    const at = now();
    if (lastRunAt && fusionMs && at - lastRunAt < fusionMs) return;
    lastRunAt = at;
    handler(reason);
  };

  // Ocultarse NO es volver. El estado se lee del documento, no del evento:
  // `visibilitychange` es el mismo para los dos sentidos.
  const onVisibilityChange = () => {
    if (documentRef?.hidden === true) return;
    if (documentRef?.visibilityState && documentRef.visibilityState !== 'visible') return;
    run('visibilitychange');
  };

  const windowHandlers = BROWSER_RESUME_WINDOW_EVENTS.map((type) => [type, () => run(type)]);
  const documentHandlers = BROWSER_RESUME_DOCUMENT_EVENTS.map((type) => [
    type,
    type === 'visibilitychange' ? onVisibilityChange : () => run(type),
  ]);

  for (const [type, listener] of windowHandlers) {
    windowRef?.addEventListener?.(type, listener);
  }
  for (const [type, listener] of documentHandlers) {
    documentRef?.addEventListener?.(type, listener);
  }

  return () => {
    if (!bound) return;
    bound = false;
    for (const [type, listener] of windowHandlers) {
      windowRef?.removeEventListener?.(type, listener);
    }
    for (const [type, listener] of documentHandlers) {
      documentRef?.removeEventListener?.(type, listener);
    }
  };
}
