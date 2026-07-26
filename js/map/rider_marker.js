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
      <span class="lt-rider-moto-core" style="--heading:${safeHeading}deg" aria-hidden="true">
        <svg class="lt-rider-moto-icon" viewBox="0 0 120 76" role="img" aria-label="Moto de reparto">
          <ellipse cx="61" cy="66" rx="43" ry="5" fill="#17191d" opacity=".18"></ellipse>
          <g stroke="#17191d" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="35" cy="55" r="12" fill="#ffffff"></circle>
            <circle cx="88" cy="55" r="12" fill="#ffffff"></circle>
            <circle cx="35" cy="55" r="4" fill="#17191d" stroke="none"></circle>
            <circle cx="88" cy="55" r="4" fill="#17191d" stroke="none"></circle>
            <path d="M35 55h23l12-22h14l9 22" fill="none"></path>
            <path d="M47 55 57 37h19l-14 18" fill="none"></path>
            <path d="m75 33 8-12h15" fill="none"></path>
            <path d="m88 21 7 3" fill="none"></path>
            <path d="M59 37h16" fill="none"></path>
            <path d="M50 42h21" fill="none"></path>
            <path d="M71 33h13" fill="none"></path>
            <path d="M33 43h14l5-11" fill="none"></path>
          </g>
          <path d="M49 38h27l-7 12H44Z" fill="#e30613" stroke="#17191d" stroke-width="3" stroke-linejoin="round"></path>
          <path d="M52 40h13l-4 6H49Z" fill="#ffffff" opacity=".94"></path>
          <rect x="20" y="24" width="28" height="22" rx="4" fill="#ffffff" stroke="#17191d" stroke-width="3"></rect>
          <path d="M27 31h14M27 37h9" stroke="#e30613" stroke-width="3" stroke-linecap="round"></path>
          <path d="M96 42h11" stroke="#e30613" stroke-width="4" stroke-linecap="round"></path>
        </svg>
      </span>`,
    iconSize: [62, 52],
    iconAnchor: [31, 31],
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
    const moto = element?.querySelector?.('.lt-rider-moto-core');
    if (moto?.style) moto.style.setProperty('--heading', `${heading}deg`);
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
