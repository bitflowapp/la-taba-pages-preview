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
        <svg class="lt-rider-moto-icon" viewBox="0 0 64 64" focusable="false" aria-hidden="true">
          <path class="lt-rider-pin" d="M32 6c12.2 0 22 9.6 22 21.4C54 42.4 32 58 32 58S10 42.4 10 27.4C10 15.6 19.8 6 32 6Z"></path>
          <path class="lt-rider-scooter" d="M20 35h11l7-10h7"></path>
          <path class="lt-rider-scooter" d="M38 25l6 10h4"></path>
          <path class="lt-rider-scooter" d="M31 35h9"></path>
          <circle class="lt-rider-wheel" cx="23" cy="39" r="4.5"></circle>
          <circle class="lt-rider-wheel" cx="47" cy="39" r="4.5"></circle>
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
