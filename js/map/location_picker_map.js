// Mapa del paso «Confirmá dónde te entregamos».
//
// Es deliberadamente chico y aparte del mapa de seguimiento: aquel dibuja rider,
// ruta y frescura de GPS; este sólo tiene que dejar poner un pin y moverlo.
//
// El mapa es una MEJORA, no el mecanismo. Si MapLibre no está, si no hay WebGL o
// si el estilo no baja, el paso sigue funcionando con las coordenadas y los
// controles de ajuste: lo que no puede pasar es que alguien quede sin poder
// confirmar dónde vive porque un CDN no respondió.

import { MAPLIBRE_PUBLIC_STYLE_URL } from './maplibre_tracking_map.js';

const DEFAULT_ZOOM = 16.5;
const STYLE_TIMEOUT_MS = 8000;

export function createLocationPickerMap({
  root = globalThis,
  documentRef = globalThis.document,
  styleUrl = MAPLIBRE_PUBLIC_STYLE_URL,
  zoom = DEFAULT_ZOOM,
} = {}) {
  const state = {
    map: null,
    marker: null,
    element: null,
    unavailable: '',
    styleTimer: null,
    onPick: null,
    onUnavailable: null,
  };

  function libraryAvailable() {
    const maplibregl = root?.maplibregl;
    return Boolean(maplibregl?.Map && maplibregl?.Marker && documentRef?.createElement);
  }

  function mount({ container, point, onPick, onUnavailable } = {}) {
    if (state.map || !container) return false;
    if (!libraryAvailable()) {
      state.unavailable = 'library';
      return false;
    }
    if (!Number.isFinite(Number(point?.latitude)) || !Number.isFinite(Number(point?.longitude))) {
      state.unavailable = 'missing-point';
      return false;
    }
    const maplibregl = root.maplibregl;
    state.onPick = typeof onPick === 'function' ? onPick : null;
    state.onUnavailable = typeof onUnavailable === 'function' ? onUnavailable : null;
    try {
      state.map = new maplibregl.Map({
        container,
        style: styleUrl,
        center: [Number(point.longitude), Number(point.latitude)],
        zoom,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        maxPitch: 0,
        renderWorldCopies: false,
      });
      if (maplibregl.AttributionControl && state.map.addControl) {
        state.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
      }
      if (maplibregl.NavigationControl && state.map.addControl) {
        state.map.addControl(new maplibregl.NavigationControl({ showCompass: false, showZoom: true }), 'top-right');
      }
    } catch (_) {
      state.map = null;
      state.unavailable = 'constructor';
      return false;
    }

    try {
      state.element = buildPinElement(documentRef);
      state.marker = new maplibregl.Marker({ element: state.element, draggable: true, anchor: 'bottom' })
        .setLngLat([Number(point.longitude), Number(point.latitude)])
        .addTo(state.map);
    } catch (_) {
      try { state.map?.remove?.(); } catch (_) { /* no-op */ }
      state.map = null;
      state.marker = null;
      state.element = null;
      state.unavailable = 'marker';
      return false;
    }

    state.marker.on?.('dragend', () => {
      const next = state.marker.getLngLat?.();
      if (next) emit({ latitude: next.lat, longitude: next.lng });
    });
    // Tocar el mapa mueve el pin: es la forma directa de decir «es acá», y en un
    // teléfono es mucho más fácil que arrastrar con precisión.
    state.map.on?.('click', (event) => {
      const next = event?.lngLat;
      if (next) emit({ latitude: next.lat, longitude: next.lng });
    });
    state.map.on?.('load', () => {
      clearStyleTimer();
      container.dataset.locationMapReady = 'true';
    });
    state.map.on?.('error', () => markUnavailable('style', container));
    state.styleTimer = setTimeout(() => {
      state.styleTimer = null;
      if (container.dataset.locationMapReady !== 'true') markUnavailable('timeout', container);
    }, STYLE_TIMEOUT_MS);
    return true;
  }

  function emit(point) {
    if (state.marker) state.marker.setLngLat([point.longitude, point.latitude]);
    state.onPick?.(point);
  }

  function setPoint(point) {
    if (!state.map || !state.marker) return false;
    const latitude = Number(point?.latitude);
    const longitude = Number(point?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
    state.marker.setLngLat([longitude, latitude]);
    state.map.easeTo?.({ center: [longitude, latitude], duration: 220 });
    return true;
  }

  function resize() {
    state.map?.resize?.();
  }

  function destroy() {
    clearStyleTimer();
    try {
      state.marker?.remove?.();
      state.map?.remove?.();
    } catch (_) {
      // Un mapa a medio montar no puede impedir cerrar el formulario.
    }
    state.map = null;
    state.marker = null;
    state.element = null;
    state.onPick = null;
    state.onUnavailable = null;
  }

  function markUnavailable(reason, container) {
    if (state.unavailable) return;
    state.unavailable = reason;
    if (container?.dataset) container.dataset.locationMapError = 'true';
    clearStyleTimer();
    state.onUnavailable?.(reason);
  }

  function clearStyleTimer() {
    if (state.styleTimer) clearTimeout(state.styleTimer);
    state.styleTimer = null;
  }

  return {
    mount,
    setPoint,
    resize,
    destroy,
    get mounted() { return Boolean(state.map); },
    get unavailableReason() { return state.unavailable; },
  };
}

function buildPinElement(documentRef) {
  const element = documentRef.createElement('div');
  element.className = 'location-pin-marker';
  element.setAttribute('aria-hidden', 'true');
  element.innerHTML = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none">'
    + '<path d="M12 22.5s-7-6.6-7-11.7a7 7 0 0 1 14 0c0 5.1-7 11.7-7 11.7Z" fill="#e0392f"/>'
    + '<circle cx="12" cy="10.6" r="2.6" fill="#fff"/></svg>';
  return element;
}
