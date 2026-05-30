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
  return L.divIcon({
    className: riderMarkerClass(status, source),
    html: `<span class="lt-rider-arrow" style="--heading:${Number(heading) || 0}deg"></span>`,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
  });
}

export function updateRiderMarker(marker, L, nextLocation, options = {}) {
  if (!marker || !L || !nextLocation) return null;
  const current = marker.getLatLng?.();
  const next = L.latLng(nextLocation.lat, nextLocation.lng);
  if (!current) {
    marker.setLatLng(next);
    return next;
  }
  marker.setLatLng(next);
  if (marker.setIcon) marker.setIcon(createRiderIcon(L, { ...options, heading: nextLocation.heading }));
  return next;
}

