export function riderMarkerClass(status, source = 'simulation') {
  const state = ['received', 'preparing'].includes(status) ? 'preparing'
    : status === 'ready' ? 'ready'
    : ['arrived', 'arriving'].includes(status) ? 'arriving'
    : status === 'delivered' ? 'delivered'
    : status === 'on_the_way' ? 'on-the-way'
    : 'preparing';
  return `lt-rider-marker ${state} source-${source}`;
}

export function riderHelmetSvg({
  className = 'lt-rider-helmet-icon',
  decorative = false,
} = {}) {
  const accessibility = decorative
    ? 'aria-hidden="true" focusable="false"'
    : 'role="img" aria-label="Casco del rider TABA" focusable="false"';
  return `<svg class="${className} taba-map-helmet" data-map-rider-helmet viewBox="0 0 56 56" ${accessibility}>
    <circle cx="28" cy="28" r="24.5" fill="var(--taba-white)" stroke="currentColor" stroke-width="3.2"></circle>
    <g transform="translate(4.4 4.8) scale(.72)">
      ${riderHelmetProfileMarkup()}
    </g>
  </svg>`;
}

// Avatar y marcador comparten la geometría base, pero conservan wrappers y
// clases separados para mantener intactas sus escalas y tratamientos visuales.
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
      ${riderHelmetSvg()}
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
 * Pines para el lienzo nocturno. El DESTINO es el protagonista del reparto y
 * lleva el rojo TABA con glifo blanco; el LOCAL es el punto de partida y se
 * cuenta en negativo —pin blanco con glifo grafito— para contrastar sobre el
 * mapa oscuro sin competir con el destino. El hairline dorado del local es el
 * mismo dorado sutil de la marca: identifica al comercio sin gritar.
 */
function placeMarkerMarkup({ kind = 'store', label = '' } = {}) {
  const isDestination = kind === 'destination';
  const aria = label || (isDestination ? 'Destino de entrega' : 'Comercio');
  const safeAria = escapeAttribute(aria);
  const body = isDestination
    ? '<path d="M22 2C11 2 3 10 3 21c0 13 19 30 19 30s19-17 19-30C41 10 33 2 22 2Z" fill="#d0000d" stroke="#fff" stroke-width="2.4"/>'
      + '<path d="M13 23h18M16 18h12v12H16z" fill="none" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/>'
    : '<path d="M22 2C11 2 3 10 3 21c0 13 19 30 19 30s19-17 19-30C41 10 33 2 22 2Z" fill="#fff" stroke="#1c2026" stroke-width="2"/>'
      + '<path d="M22 3.6C11.9 3.6 4.6 11 4.6 21c0 11.9 17.4 27.6 17.4 27.6S39.4 32.9 39.4 21C39.4 11 32.1 3.6 22 3.6Z" fill="none" stroke="#c9953e" stroke-width="1.1" opacity="0.85"/>'
      + '<path d="M12 20h20v13H12zM15 20v-5h14v5M16 24h2M22 24h2M28 24h2" fill="none" stroke="#1c2026" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
  return `<span class="lt-place-marker-pin" aria-label="${safeAria}" role="img">
    <svg viewBox="0 0 44 54" aria-hidden="true" focusable="false">
      ${body}
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
