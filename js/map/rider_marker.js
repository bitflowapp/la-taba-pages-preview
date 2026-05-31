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
  const label = source === 'gps' ? 'Tu ubicación real' : 'Rider';
  return L.divIcon({
    className: riderMarkerClass(status, source),
    html: `<span class="lt-rider-arrow" style="--heading:${Number(heading) || 0}deg"></span><strong class="lt-rider-label">${label}</strong>`,
    iconSize: [118, 58],
    iconAnchor: [59, 29],
  });
}

export function updateRiderMarker(marker, L, nextLocation, options = {}) {
  if (!marker || !L || !nextLocation) return null;
  if (!isValidLatLng(nextLocation.lat, nextLocation.lng)) return null;
  const current = marker.getLatLng?.();
  const next = L.latLng(nextLocation.lat, nextLocation.lng);
  if (!current) {
    marker.setLatLng(next);
    if (marker.setIcon) marker.setIcon(createRiderIcon(L, { ...options, heading: nextLocation.heading }));
    return next;
  }
  marker.setLatLng(next);
  if (marker.setIcon) marker.setIcon(createRiderIcon(L, { ...options, heading: nextLocation.heading }));
  return next;
}

function isValidLatLng(lat, lng) {
  const nextLat = Number(lat);
  const nextLng = Number(lng);
  return Number.isFinite(nextLat)
    && Number.isFinite(nextLng)
    && Math.abs(nextLat) <= 90
    && Math.abs(nextLng) <= 180;
}
