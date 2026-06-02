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
          <path class="lt-rider-pin" d="M32 5C19 5 8.5 14.8 8.5 27.4c0 10.6 9.5 19.1 19.7 31.5 1.9 2.3 5.7 2.3 7.6 0C46 46.5 55.5 38 55.5 27.4 55.5 14.8 45 5 32 5Z"></path>
          <path class="lt-rider-helmet-shell" d="M16 27.6C16 16.5 23.2 10 32 10s16 6.5 16 17.6V32c0 6-5.4 10.5-12.5 10.5h-7C21.4 42.5 16 38 16 32Z"></path>
          <path class="lt-rider-helmet-base" d="M19.4 35.4h25.2C43.4 39.7 38.2 42.5 32 42.5s-11.4-2.8-12.6-7.1Z"></path>
          <path class="lt-rider-helmet-visor" d="M20.5 23.6c0-2.9 1.8-4.4 4.6-4.4h13.8c2.8 0 4.6 1.5 4.6 4.4v2.6c0 3.1-2.2 5-5.4 5H25.9c-3.2 0-5.4-1.9-5.4-5Z"></path>
          <path class="lt-rider-helmet-glint" d="M24.4 22.1h11.2c1.4 0 2.3.6 2.3 1.6s-.9 1.4-2.3 1.4H24.4c-1.4 0-2.3-.5-2.3-1.4s.9-1.6 2.3-1.6Z"></path>
          <path class="lt-rider-helmet-highlight" d="M21.5 19.6C24 15.4 27.6 13.2 32 13.2c-3.7.6-6.8 2.9-9 6.9-.6 1-1.8.6-1.5-.5Z"></path>
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
