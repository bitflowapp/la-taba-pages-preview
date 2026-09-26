/*
 * LA ENTRADA DE LA TIENDA CUANDO TODAVÍA NO SE PUEDE PEDIR.
 *
 * Mientras el catálogo no está listo, la home, el catálogo y el carrito se
 * reemplazan por una sola tarjeta. Esa tarjeta ES la puerta del local para
 * quien entra por la raíz: medido en CONTROLLED_PRODUCTION el 2026-09-25, lo
 * único que se veía era «El catálogo verificado todavía no está disponible.
 * Los pedidos permanecen bloqueados.» sobre una pantalla negra. Describía el
 * estado de una bandera del sistema, no del local, y se leía como un sitio
 * roto.
 *
 * Esta función decide QUÉ decir; `app.js` lo pinta. Es pura a propósito: el
 * texto sale sólo de lo que ya dijo el backend (estado del catálogo, bandera
 * de pedidos, próxima apertura) y nunca de una suposición. Si no se sabe por
 * qué no se puede pedir, se dice que por ahora no se puede y nada más: no se
 * inventa un horario, un motivo ni un negocio.
 */

export const STORE_ENTRY_KIND = Object.freeze({
  UNCONFIGURED: 'unconfigured',
  UNAVAILABLE: 'unavailable',
  LOADING: 'loading',
  ERROR: 'error',
  CLOSED_UNTIL: 'closed-until',
  CATALOG_EMPTY: 'catalog-empty',
  NOT_TAKING_ORDERS: 'not-taking-orders',
});

const MODE_PUBLIC = 'public';
const MODE_UNAVAILABLE = 'unavailable';

/**
 * @param {object} input
 * @param {string} input.mode            modo de la app (`public`, `unavailable`, `production`, `demo`)
 * @param {string} [input.catalogState]  estado del catálogo del repositorio
 * @param {boolean} [input.orderingVerified] el backend confirmó que el comercio toma pedidos
 * @param {object} [input.availability]  respuesta de `commerce_availability` ya normalizada
 * @param {Date} [input.now]
 * @returns {{ kind: string, title: string, message: string, retry: boolean, tracking: boolean }}
 */
export function describeStoreEntry({
  mode,
  catalogState = 'idle',
  orderingVerified = false,
  availability = null,
  now = new Date(),
} = {}) {
  if (mode === MODE_PUBLIC) {
    return entry(STORE_ENTRY_KIND.UNCONFIGURED,
      'La tienda online todavía no está abierta',
      'Cuando el local la habilite, vas a poder hacer tu pedido desde acá.',
      { tracking: false });
  }
  if (mode === MODE_UNAVAILABLE) {
    return entry(STORE_ENTRY_KIND.UNAVAILABLE,
      'La tienda no está disponible en este momento',
      'Estamos resolviendo un problema técnico. Probá de nuevo en unos minutos.',
      { retry: true, tracking: false });
  }

  const state = String(catalogState || 'idle');
  if (state === 'idle' || state === 'loading') {
    return entry(STORE_ENTRY_KIND.LOADING,
      'Abriendo la tienda…',
      'Estamos trayendo el catálogo del local.');
  }
  if (state === 'error') {
    return entry(STORE_ENTRY_KIND.ERROR,
      'No pudimos abrir la tienda',
      'Revisá tu conexión y probá de nuevo.',
      { retry: true });
  }

  const reopening = nextOpeningLabel(availability, now);
  if (availability?.known && availability.isOpen === false && reopening) {
    return entry(STORE_ENTRY_KIND.CLOSED_UNTIL, 'Ahora estamos cerrados', `${reopening}.`);
  }
  if (state === 'empty' && orderingVerified) {
    return entry(STORE_ENTRY_KIND.CATALOG_EMPTY,
      'Estamos actualizando el catálogo',
      'Volvé a entrar en un rato para hacer tu pedido.');
  }
  return entry(STORE_ENTRY_KIND.NOT_TAKING_ORDERS,
    'Por ahora no estamos tomando pedidos online',
    'Volvé a entrar más tarde.');
}

/**
 * «Abrimos hoy a las 19:00» / «Abrimos el sábado a las 10:00», o '' si el
 * servidor no publicó una próxima apertura válida. Reloj de 24 horas, como se
 * lee un horario comercial en Argentina.
 */
export function nextOpeningLabel(availability, now = new Date()) {
  const raw = availability?.nextOpenAt;
  if (!raw) return '';
  const when = new Date(raw);
  if (Number.isNaN(when.getTime()) || when.getTime() <= now.getTime()) return '';
  const time = when.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (when.toDateString() === now.toDateString()) return `Abrimos hoy a las ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (when.toDateString() === tomorrow.toDateString()) return `Abrimos mañana a las ${time}`;
  return `Abrimos el ${when.toLocaleDateString('es-AR', { weekday: 'long' })} a las ${time}`;
}

function entry(kind, title, message, { retry = false, tracking = true } = {}) {
  return Object.freeze({ kind, title, message, retry, tracking });
}
