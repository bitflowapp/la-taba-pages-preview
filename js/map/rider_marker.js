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
  palette = 'map',
} = {}) {
  const accessibility = decorative
    ? 'aria-hidden="true" focusable="false"'
    : 'role="img" aria-label="Casco del rider TABA" focusable="false"';
  const avatarPalette = palette === 'avatar';
  const discFill = avatarPalette ? 'none' : '#c8101e';
  const discStroke = avatarPalette ? 'none' : '#ffffff';
  const helmetFill = avatarPalette ? '#c8101e' : '#ffffff';
  const visorFill = avatarPalette ? '#fff0f1' : '#c8101e';
  const helmetStroke = avatarPalette ? '#c8101e' : '#ffffff';
  return `<svg class="${className}" viewBox="0 0 56 56" ${accessibility}>
    <circle cx="28" cy="28" r="24.5" fill="${discFill}" stroke="${discStroke}" stroke-width="2.5"></circle>
    <path d="M14.5 29.1c0-8 5.8-13.8 13.8-13.8 8.1 0 13.7 5.9 13.7 14v8.2H29.5l-3.3-7.2H14.5v-1.2Z" fill="${helmetFill}"></path>
    <path d="M29.1 24.1h9.2v9.3h-5.7l-3.5-9.3Z" fill="${visorFill}"></path>
    <path d="M16.8 30.3h9.4l3.3 7.2h8.8" fill="none" stroke="${helmetStroke}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"></path>
  </svg>`;
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
