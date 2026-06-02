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
        <svg class="lt-rider-helmet-icon" viewBox="0 0 64 64" focusable="false" aria-hidden="true">
          <path class="lt-rider-pin" d="M32 5.5c11.8 0 21.4 9.3 21.4 20.8 0 14.4-21.4 29.2-21.4 29.2S10.6 40.7 10.6 26.3C10.6 14.8 20.2 5.5 32 5.5Z"></path>
          <path class="lt-rider-helmet-shell" d="M18.6 34.4c.2-11.2 8.5-19 19.3-17.1 8.1 1.4 13.4 8.5 12.8 17.2-.2 2.8-2.5 5-5.3 5H25.7c-3.6 0-6.1-2.1-7.1-5.1Z"></path>
          <path class="lt-rider-helmet-visor" d="M31.4 25.3h14.7c1.2 0 2.2 1 2.2 2.2v3.1c0 1.4-1.1 2.5-2.5 2.5H31.4c-1.1 0-2-.9-2-2v-5.1c0-.6.4-1 1-1Z"></path>
          <path class="lt-rider-helmet-rim" d="M21.3 36.8h27.1"></path>
          <circle class="lt-rider-helmet-dot" cx="24.1" cy="30.6" r="2.4"></circle>
        </svg>
      </span>`,
    iconSize: [52, 52],
    iconAnchor: [26, 34],
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
