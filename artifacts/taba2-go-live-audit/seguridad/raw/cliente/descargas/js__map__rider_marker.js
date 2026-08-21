export function riderMarkerClass(status, source = 'simulation') {
  const state = ['received', 'preparing'].includes(status) ? 'preparing'
    : status === 'ready' ? 'ready'
    : ['arrived', 'arriving'].includes(status) ? 'arriving'
    : status === 'delivered' ? 'delivered'
    : status === 'on_the_way' ? 'on-the-way'
    : 'preparing';
  return `lt-rider-marker ${state} source-${source}`;
}

/*
 * MARCADOR DEL RIDER. Disco rojo intenso, aro blanco y una moto blanca de
 * perfil. Antes acá iba el mismo casco que usa la tarjeta del rider, y a 43–48
 * px se empastaba: la visera y el aro interior se comían el contraste y el
 * glifo dejaba de leerse como algo. La moto se reconoce por su silueta —dos
 * ruedas y el manubrio— sin depender del detalle.
 *
 * El casco NO desaparece del producto: sigue siendo el retrato del repartidor
 * en la tarjeta (`riderAvatarHelmetSvg`), donde hay tamaño para sostenerlo.
 *
 * Las clases del DOM conservan su nombre histórico (`lt-rider-helmet-*`,
 * `taba-map-helmet`) a propósito: son ganchos de CSS repartidos por toda la
 * hoja de seguimiento y renombrarlos sería un refactor que este arreglo no
 * necesita.
 */
export function riderScooterSvg({
  className = 'lt-rider-helmet-icon',
  decorative = false,
} = {}) {
  const accessibility = decorative
    ? 'aria-hidden="true" focusable="false"'
    : 'role="img" aria-label="Moto del repartidor TABA" focusable="false"';
  return `<svg class="${className} taba-map-helmet" data-map-rider-scooter viewBox="0 0 56 56" ${accessibility}>
    <circle cx="28" cy="28" r="24.5" fill="var(--map-rider-disc)" stroke="var(--taba-white)" stroke-width="3.2"></circle>
    <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="17.4" cy="32.8" r="6.7" stroke-width="3.3"></circle>
      <circle cx="38.6" cy="32.8" r="6.7" stroke-width="3.3"></circle>
      <path d="M13.6 21.8h9.6l-2.8 6.6h10.2l6.6-11.6" stroke-width="5.2"></path>
      <path d="M32.6 16.8h5.6" stroke-width="3.6"></path>
      <path d="M37.6 17.6 38.6 30.4" stroke-width="3.6"></path>
    </g>
  </svg>`;
}

// El casco de perfil es el RETRATO del repartidor en la tarjeta de seguimiento,
// no un marcador de mapa: acá tiene 60 px y el detalle se sostiene. Su escala y
// su tratamiento visual son propios y no cambian con los del mapa.
export function riderAvatarHelmetSvg({
  className = 'tracking-rider-helmet',
  decorative = true,
} = {}) {
  const accessibility = decorative
    ? 'aria-hidden="true" focusable="false"'
    : 'role="img" aria-label="Casco del rider TABA" focusable="false"';
  return `<svg class="${className} taba-delivery-helmet" viewBox="0 0 64 64" preserveAspectRatio="xMidYMid meet" ${accessibility}>
    ${riderHelmetProfileMarkup()}
    <path d="M23.8 47.8c7.4 1.4 15 5 19.2 10.2H17.5c1.3-3.6 3.5-6.5 6.3-10.2Z" fill="currentColor"></path>
    <path d="M20.3 47.3c9.5 1.8 18.2 5.6 24.3 10.8" fill="none" stroke="var(--delivery-helmet-contrast)" stroke-width="2.3" stroke-linecap="round"></path>
  </svg>`;
}

function riderHelmetProfileMarkup() {
  return `
    <path d="M12.5 31.8c0-11.4 8.7-19.3 20.2-19.3 10.7 0 19.1 7.1 19.8 18.2l.7 10.6c.4 5.7-1.6 10.3-6.1 14.1a4.1 4.1 0 0 1-4.9.2l-20.8-7.2c-5.6-1.9-8.9-6.7-8.9-12.7V31.8Z" fill="currentColor"></path>
    <path d="M38.9 24.5c3.6.2 7.5.6 10.2 1 1.8.3 3 1.7 3.2 3.4l.8 11.5c.3 4.2-.6 7.1-3.2 8.6-1.4.8-3 .7-4.4-.2l-8.9-6.5a10.7 10.7 0 0 1-4.5-8.7v-4.4c0-2.6 2.1-4.8 4.8-4.7h2Z" fill="var(--delivery-helmet-contrast)"></path>
    <circle cx="27.5" cy="31.4" r="5.8" fill="var(--delivery-helmet-contrast)"></circle>
    <circle cx="27.5" cy="31.4" r="3.2" fill="currentColor"></circle>
    <path d="M12.5 31.5h6.2" fill="none" stroke="var(--delivery-helmet-contrast)" stroke-width="2.6" stroke-linecap="round"></path>`;
}

export function createRiderMarkerElement(documentRef = globalThis.document, {
  status = 'received',
  source = 'simulation',
} = {}) {
  if (!documentRef?.createElement) return null;
  const element = documentRef.createElement('div');
  element.className = riderMarkerClass(status, source);
  element.innerHTML = `
    <span class="lt-rider-helmet-core">
      ${riderScooterSvg()}
    </span>`;
  return element;
}

export function updateRiderMarkerElement(element, {
  status = 'received',
  source = 'simulation',
} = {}) {
  if (!element) return null;
  const nextClass = riderMarkerClass(status, source);
  element.className = mergeMarkerClassName(element.className, nextClass);
  return element;
}

export function createPlaceMarkerElement(documentRef = globalThis.document, {
  kind = 'store',
  label = '',
} = {}) {
  if (!documentRef?.createElement) return null;
  const element = documentRef.createElement('div');
  const isDestination = kind === 'destination';
  element.className = `lt-place-marker ${isDestination ? 'is-destination' : 'is-store'}`;
  element.innerHTML = placeMarkerMarkup({ kind, label });
  return element;
}

export function mergeMarkerClassName(current, nextClass) {
  const markerTokens = new Set(['lt-rider-marker', 'preparing', 'ready', 'on-the-way', 'arriving', 'delivered']);
  const kept = String(current || '')
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !markerTokens.has(token) && !token.startsWith('source-'));
  return [...kept, ...nextClass.split(/\s+/)].join(' ');
}

/*
 * SILUETA DEL PIN. Los dos lugares comparten exactamente este contorno y este
 * `viewBox`, y no se tocan: el marcador se ancla por `bottom`, así que la punta
 * del pin ES el punto geográfico. Cambiar la geometría —o el alto del lienzo—
 * movería el punto que el cliente lee como su casa o como el local. Lo que
 * distingue a un pin de otro es el RELLENO y el GLIFO, nunca la forma.
 */
export const PLACE_PIN_VIEWBOX = '0 0 44 54';
export const PLACE_PIN_OUTLINE_PATH = 'M22 2C11 2 3 10 3 21c0 13 19 30 19 30s19-17 19-30C41 10 33 2 22 2Z';

/*
 * Los tres actores del mapa tienen que leerse sin texto y en menos de un
 * segundo, así que ninguno se distingue por un solo rasgo:
 *
 *   LOCAL    pin BORDÓ con aro dorado de marca · vitrina blanca (toldo, cuerpo
 *            y puerta calada). Es un comercio, no un paquete.
 *   DESTINO  pin DORADO PROFUNDO con aro blanco · casa blanca de techo a dos
 *            aguas. Techo inclinado contra toldo recto: el contraste de forma
 *            aguanta aunque el color se pierda.
 *   RIDER    disco ROJO INTENSO con aro blanco y la moto blanca (arriba). Es
 *            un círculo, no un pin: no señala un lugar fijo, se mueve.
 *
 * Los glifos van CENTRADOS en el bulbo del pin (centro ~22,20.5 del viewBox) y
 * como siluetas llenas: a 34–44 px un trazo fino se empasta. Antes eran dos
 * rectángulos con una línea encima —de ahí que los dos se leyeran como una caja
 * o una valija—, y encima colgaban bajos, sobre la punta y no sobre el bulbo.
 */
const PLACE_PIN_INK = '#fff';
const STORE_PIN_FILL = '#8b1020';        /*  9,6:1 con el glifo blanco */
const STORE_PIN_RING = '#c9953e';        /*  el dorado de marca, --brand-gold */
const DESTINATION_PIN_FILL = '#a9752b';  /*  4,0:1 con el glifo blanco */
const DESTINATION_PIN_RING = '#fff';

/*
 * El toldo va SEPARADO del cuerpo por una franja del color del pin. Pegados, la
 * silueta se cierra en un arco y el local vuelve a parecer un objeto —que es el
 * defecto que este arreglo corrige—; separados se lee toldo sobre vitrina.
 */
const STORE_GLYPH = '<path d="M13.3 10h17.4a1.8 1.8 0 0 1 1.7 1.2l1.6 4.4H10l1.6-4.4A1.8 1.8 0 0 1 13.3 10Z"/>'
  + '<path fill-rule="evenodd" d="M12.2 17h19.6v12.7a1.3 1.3 0 0 1-1.3 1.3H13.5a1.3 1.3 0 0 1-1.3-1.3Zm7.2 14h5.2v-5.6a2.6 2.6 0 0 0-5.2 0Z"/>';

const DESTINATION_GLYPH = '<path fill-rule="evenodd" d="M22.9 9.9a1.4 1.4 0 0 0-1.8 0L10.6 18.8a1.4 1.4 0 0 0-.5 1.1V30a1.3 1.3 0 0 0 1.3 1.3h21.2a1.3 1.3 0 0 0 1.3-1.3V19.9a1.4 1.4 0 0 0-.5-1.1ZM19.7 31.3v-6.9h4.6v6.9Z"/>';

function placeMarkerMarkup({ kind = 'store', label = '' } = {}) {
  const isDestination = kind === 'destination';
  const aria = label || (isDestination ? 'Destino de entrega' : 'Comercio');
  const safeAria = escapeAttribute(aria);
  const fill = isDestination ? DESTINATION_PIN_FILL : STORE_PIN_FILL;
  const ring = isDestination ? DESTINATION_PIN_RING : STORE_PIN_RING;
  const glyph = isDestination ? DESTINATION_GLYPH : STORE_GLYPH;
  return `<span class="lt-place-marker-pin" aria-label="${safeAria}" role="img">
    <svg viewBox="${PLACE_PIN_VIEWBOX}" aria-hidden="true" focusable="false">
      <path d="${PLACE_PIN_OUTLINE_PATH}" fill="${fill}" stroke="${ring}" stroke-width="2.4"/>
      <g class="lt-place-marker-glyph" fill="${PLACE_PIN_INK}">${glyph}</g>
    </svg>
  </span>`;
}

function escapeAttribute(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}
