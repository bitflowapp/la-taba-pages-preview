import { BUSINESS_CONFIG } from '../config.js';

export const MAP_PROVIDER = Object.freeze(BUSINESS_CONFIG.mapProvider);
export const STORE_LOCATION = Object.freeze(BUSINESS_CONFIG.businessLocation);
export const DEFAULT_MAP_BOUNDS = Object.freeze(BUSINESS_CONFIG.defaultMapBounds);
export const DEMO_DESTINATIONS = Object.freeze(BUSINESS_CONFIG.demoDestinations);

export const RIDER_LOCATION_SOURCES = Object.freeze({
  gps: 'Ubicación rider',
  simulation: 'Ubicación estimada',
  fallback: 'Ubicación estimada',
});

export function getMapTheme(theme = MAP_PROVIDER.defaultTheme) {
  const candidate = String(theme || '').toLowerCase();
  const fallback = MAP_PROVIDER.defaultTheme === 'dark' ? 'dark' : 'light';
  return candidate === 'light' || candidate === 'dark' ? candidate : fallback;
}

export function getTileLayerForTheme(theme = MAP_PROVIDER.defaultTheme) {
  const normalized = getMapTheme(theme);
  const layer = MAP_PROVIDER.tileLayers?.[normalized] || MAP_PROVIDER.tileLayers?.fallback || MAP_PROVIDER;
  return {
    theme: normalized,
    name: layer.name || MAP_PROVIDER.name || 'OpenStreetMap',
    tilesUrl: layer.tilesUrl || MAP_PROVIDER.tilesUrl,
    attribution: layer.attribution || MAP_PROVIDER.attribution || '&copy; OpenStreetMap contributors',
  };
}
