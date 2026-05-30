import { BUSINESS_CONFIG } from '../config.js';

export const MAP_PROVIDER = Object.freeze(BUSINESS_CONFIG.mapProvider);
export const STORE_LOCATION = Object.freeze(BUSINESS_CONFIG.businessLocation);
export const DEFAULT_MAP_BOUNDS = Object.freeze(BUSINESS_CONFIG.defaultMapBounds);
export const DEMO_DESTINATIONS = Object.freeze(BUSINESS_CONFIG.demoDestinations);

export const RIDER_LOCATION_SOURCES = Object.freeze({
  gps: 'Ubicación rider',
  simulation: 'Ubicación demo',
  fallback: 'Ubicación demo',
});

