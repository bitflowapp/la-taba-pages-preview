export function riderMarkerClass(status, source = 'simulation') {
  const state = ['received', 'preparing'].includes(status) ? 'preparing'
    : status === 'ready' ? 'ready'
    : status === 'arriving' ? 'arriving'
    : status === 'delivered' ? 'delivered'
    : status === 'on_the_way' ? 'on-the-way'
    : 'preparing';
  return `lt-rider-marker ${state} source-${source}`;
}

export function createRiderIcon(L, { status = 'received', source = 'simulation', heading = 0 } = {}) {
  const safeHeading = Number.isFinite(Number(heading)) ? Number(heading) : 0;
  return L.divIcon({
    className: riderMarkerClass(status, source),
    html: `
      <span class="lt-rider-marker-halo" aria-hidden="true"></span>
      <span class="lt-rider-helmet-core" style="--heading:${safeHeading}deg" aria-hidden="true">
        <svg class="lt-rider-helmet-icon" viewBox="0 0 80 64" role="img" aria-label="Moto de reparto">
          <circle class="lt-rider-pin" cx="40" cy="32" r="28"></circle>
          <g class="lt-rider-delivery-icon" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="25" cy="47" r="7" fill="#25282d"></circle>
            <circle cx="59" cy="47" r="7" fill="#25282d"></circle>
            <path d="M25 47h13l7-16h10l6 16"></path>
            <path d="M38 47l-7-16h14l6 8H40"></path>
            <path d="M50 31l5-7h7l-2 7"></path>
            <path d="M34 30h-6l-4 8h11"></path>
            <path d="M31 22c1-7 6-11 13-11 8 0 13 5 14 13H48l-5-5h-8"></path>
            <path d="M50 24h8"></path>
          </g>
          <rect x="7" y="33" width="16" height="12" rx="2" fill="#fff" stroke="#25282d" stroke-width="2"></rect>
          <path d="M11 37h8M11 41h6" stroke="#bd1e2d" stroke-width="2" stroke-linecap="round"></path>
        </svg>
      </span>`,
    iconSize: [52, 52],
    iconAnchor: [26, 26],
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
  const heading = Number(nextLocation.heading) || 0;
  const element = marker.getElement?.();

  if (marker.__ltMarkerClass !== nextClass) {
    marker.__ltMarkerClass = nextClass;
    if (element) element.className = mergeMarkerClassName(element.className, nextClass);
    else if (marker.setIcon) marker.setIcon(createRiderIcon(L, { ...options, source, heading }));
  }

  if (marker.__ltMarkerHeading !== heading) {
    marker.__ltMarkerHeading = heading;
    const helmet = element?.querySelector?.('.lt-rider-helmet-core');
    if (helmet?.style) helmet.style.setProperty('--heading', `${heading}deg`);
    else if (!element && marker.setIcon) marker.setIcon(createRiderIcon(L, { ...options, source, heading }));
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
