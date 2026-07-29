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
  return `<svg class="${className}" viewBox="0 0 56 56" ${accessibility}>
    <circle cx="28" cy="28" r="24.5" fill="#c8101e" stroke="#ffffff" stroke-width="2.5"></circle>
    <path d="M14.5 29.1c0-8 5.8-13.8 13.8-13.8 8.1 0 13.7 5.9 13.7 14v8.2H29.5l-3.3-7.2H14.5v-1.2Z" fill="#ffffff"></path>
    <path d="M29.1 24.1h9.2v9.3h-5.7l-3.5-9.3Z" fill="#c8101e"></path>
    <path d="M16.8 30.3h9.4l3.3 7.2h8.8" fill="none" stroke="#ffffff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"></path>
  </svg>`;
}

// El avatar no comparte la geometría del marcador del mapa: el tracking público
// necesita un casco de perfil reconocible incluso dentro de su círculo de 50 px.
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

function placeMarkerMarkup({ kind = 'store', label = '' } = {}) {
  const isDestination = kind === 'destination';
  const color = isDestination ? '#bd1e2d' : '#25282d';
  const aria = label || (isDestination ? 'Destino de entrega' : 'Comercio');
  const safeAria = escapeAttribute(aria);
  return `<span class="lt-place-marker-pin" aria-label="${safeAria}" role="img">
    <svg viewBox="0 0 44 54" aria-hidden="true" focusable="false">
      <path d="M22 2C11 2 3 10 3 21c0 13 19 30 19 30s19-17 19-30C41 10 33 2 22 2Z" fill="${color}" stroke="#fff" stroke-width="2"/>
      ${isDestination
        ? '<path d="M13 23h18M16 18h12v12H16z" fill="none" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/>'
        : '<path d="M12 20h20v13H12zM15 20v-5h14v5M16 24h2M22 24h2M28 24h2" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>'}
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
