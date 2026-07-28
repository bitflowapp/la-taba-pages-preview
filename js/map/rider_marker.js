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

export function createRiderIcon(L, { status = 'received', source = 'simulation' } = {}) {
  return L.divIcon({
    className: riderMarkerClass(status, source),
    html: `
      <span class="lt-rider-helmet-core">
        ${riderHelmetSvg()}
      </span>`,
    iconSize: [56, 56],
    iconAnchor: [28, 28],
  });
}

export function createPlaceIcon(L, { kind = 'store', label = '' } = {}) {
  const isDestination = kind === 'destination';
  const color = isDestination ? '#bd1e2d' : '#25282d';
  const aria = label || (isDestination ? 'Destino de entrega' : 'Comercio');
  const safeAria = String(aria).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
  return L.divIcon({
    className: `lt-place-marker ${isDestination ? 'is-destination' : 'is-store'}`,
    html: `<span class="lt-place-marker-pin" aria-label="${safeAria}" role="img">
      <svg viewBox="0 0 44 54" aria-hidden="true">
        <path d="M22 2C11 2 3 10 3 21c0 13 19 30 19 30s19-17 19-30C41 10 33 2 22 2Z" fill="${color}" stroke="#fff" stroke-width="2"/>
        ${isDestination
          ? '<path d="M13 23h18M16 18h12v12H16z" fill="none" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/>'
          : '<path d="M12 20h20v13H12zM15 20v-5h14v5M16 24h2M22 24h2M28 24h2" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>'}
      </svg>
    </span>`,
    iconSize: [44, 54],
    iconAnchor: [22, 51],
    tooltipAnchor: [0, -48],
  });
}

export function updateRiderMarker(marker, L, nextLocation, options = {}) {
  if (!marker || !L || !nextLocation) return null;
  const current = marker.getLatLng?.();
  const next = L.latLng(nextLocation.lat, nextLocation.lng);
  if (!current || current.lat !== next.lat || current.lng !== next.lng) marker.setLatLng(next);
  updateRiderMarkerVisual(marker, L, nextLocation, options);
  return next;
}

function updateRiderMarkerVisual(marker, L, nextLocation, options) {
  const source = options.source || nextLocation.source || 'simulation';
  const nextClass = riderMarkerClass(options.status, source);
  const element = marker.getElement?.();

  if (marker.__ltMarkerClass !== nextClass) {
    marker.__ltMarkerClass = nextClass;
    if (element) element.className = mergeMarkerClassName(element.className, nextClass);
    else if (marker.setIcon) marker.setIcon(createRiderIcon(L, { ...options, source }));
  }
}

function mergeMarkerClassName(current, nextClass) {
  const markerTokens = new Set(['lt-rider-marker', 'preparing', 'ready', 'on-the-way', 'arriving', 'delivered']);
  const kept = String(current || '')
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !markerTokens.has(token) && !token.startsWith('source-'));
  return [...kept, ...nextClass.split(/\s+/)].join(' ');
}
