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

export function createOwnLocationMarkerElement(documentRef = globalThis.document, {
  source = 'gps',
  heading = null,
} = {}) {
  if (!documentRef?.createElement) return null;
  const element = documentRef.createElement('div');
  element.setAttribute?.('role', 'img');
  element.setAttribute?.('aria-label', 'Tu ubicación');
  element.setAttribute?.('title', 'Tu ubicación');
  element.innerHTML = `
    <span class="rider-self-heading" aria-hidden="true"></span>
    <span class="rider-self-halo" aria-hidden="true"></span>
    <span class="rider-self-core" aria-hidden="true"></span>`;
  return updateOwnLocationMarkerElement(element, { source, heading });
}

export function updateOwnLocationMarkerElement(element, {
  source = 'gps',
  heading = null,
} = {}) {
  if (!element) return null;
  const normalizedHeading = normalizeHeading(heading);
  element.className = `rider-self-marker source-${safeClassToken(source)}${normalizedHeading === null ? '' : ' has-heading'}`;
  if (normalizedHeading === null) {
    element.style?.removeProperty?.('--rider-heading');
  } else {
    element.style?.setProperty?.('--rider-heading', `${normalizedHeading}deg`);
  }
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

export function createOperationalPlaceMarkerElement(documentRef = globalThis.document, {
  kind = 'business',
  label = '',
  priority = false,
} = {}) {
  if (!documentRef?.createElement) return null;
  const element = documentRef.createElement('div');
  element.innerHTML = operationalPlaceMarkerMarkup({ kind, label });
  return updateOperationalPlaceMarkerElement(element, { kind, label, priority });
}

export function updateOperationalPlaceMarkerElement(element, {
  kind = 'business',
  label = '',
  priority = false,
} = {}) {
  if (!element) return null;
  const normalizedKind = normalizeOperationalPlaceKind(kind);
  const aria = label || (normalizedKind === 'client' ? 'Cliente' : 'Negocio');
  element.className = `rider-place-marker is-${normalizedKind} ${priority ? 'is-primary' : 'is-secondary'}`;
  element.setAttribute?.('role', 'img');
  element.setAttribute?.('aria-label', aria);
  element.setAttribute?.('title', aria);
  const visibleLabel = element.querySelector?.('.rider-place-label');
  if (visibleLabel) visibleLabel.textContent = aria;
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

function operationalPlaceMarkerMarkup({ kind = 'business', label = '' } = {}) {
  const normalizedKind = normalizeOperationalPlaceKind(kind);
  const displayLabel = escapeAttribute(label || (normalizedKind === 'client' ? 'Cliente' : 'Negocio'));
  const icon = normalizedKind === 'client'
    ? `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <circle cx="16" cy="10.5" r="5" fill="none" stroke="currentColor" stroke-width="2.4"/>
        <path d="M7.5 27c.8-6 4.1-9 8.5-9s7.7 3 8.5 9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
      </svg>`
    : `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <path d="M7 12h18v14H7zM5.5 7h21l-1.8 6H7.3L5.5 7Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="M11 13v4m5-4v4m5-4v4M13 26v-6h6v6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
      </svg>`;
  return `<span class="rider-place-visual" aria-hidden="true">
      <span class="rider-place-disc">${icon}</span>
      <span class="rider-place-stem"></span>
      <span class="rider-place-target"></span>
    </span>
    <span class="rider-place-label" aria-hidden="true">${displayLabel}</span>`;
}

function normalizeOperationalPlaceKind(kind) {
  return ['client', 'destination'].includes(String(kind || '').toLowerCase())
    ? 'client'
    : 'business';
}

function normalizeHeading(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? ((numeric % 360) + 360) % 360 : null;
}

function safeClassToken(value) {
  return String(value || 'gps').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'gps';
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
