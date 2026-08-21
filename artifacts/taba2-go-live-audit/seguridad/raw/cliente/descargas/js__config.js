// ─────────────────────────────────────────────────────────────────────────────
// Identidad única de TABA. La presentación comercial y el storefront comparten
// marca para evitar que el cliente vea nombres de producto distintos.
import { isShowcaseMode } from './core/showcase-mode.js';
import {
  BUSINESS_LOCATION,
  BUSINESS_LOCATION_IS_PLOTTABLE,
  BUSINESS_POINT,
} from './core/business-location.js';

export const BRAND = Object.freeze({
  productName: 'TABA2',
  tagline: 'Bebidas, pedidos y retiro en una experiencia clara.',
  shortTagline: 'Tienda de bebidas',
  // Nombre del COMERCIO (distinto del nombre de producto). Es una semilla
  // editable desde Panel Negocio → Configuración: la superficie nunca escribe
  // el nombre a mano, siempre lee `businessConfig.businessName`.
  demoBusinessName: 'La Taba 2',
  demoBusinessSubtitle: 'Tienda de bebidas',
  demoBusinessClaim: 'Tus bebidas, ahora a un toque.',
  demoBusinessClaimSecondary: 'Pedí. Seguí. Disfrutá.',
  contactWhatsappMessage: 'Hola, vi TABA2 y quiero más información.',
});

export const BUSINESS_CONFIG = Object.freeze({
  businessName: BRAND.demoBusinessName,
  name: BRAND.demoBusinessName,
  subtitle: BRAND.demoBusinessSubtitle,
  // Estos datos deben completarse y verificarse con el comercio antes de
  // habilitar pedidos reales. La presentación usa valores operativos de ejemplo.
  whatsappNumber: '',
  whatsappVerified: false,
  // Dirección postal confirmada por el comercio. Sigue siendo una semilla
  // editable: la superficie la lee de `businessConfig.address`, nunca la
  // escribe a mano. La coordenada ya NO se escribe acá: sale del contrato
  // central `js/core/business-location.js`.
  address: BUSINESS_LOCATION.address,
  // La coordenada del local está contrastada contra la ficha comercial de
  // Google Maps, la numeración catastral de OSM y el Plus Code, así que el mapa
  // del cliente ya puede plotear el marcador del local. Sigue sin ser
  // `human_verified`: nadie la confirmó todavía contra la puerta. Ver el
  // contrato para la evidencia y para qué haría falta para elevarla.
  businessLocationVerified: BUSINESS_LOCATION_IS_PLOTTABLE,
  deliveryZone: 'Cobertura a confirmar con el local',
  openingHoursLabel: 'Horarios a confirmar con el local',
  openingHours: 'Horarios a confirmar con el local',
  openHour: 9,
  closeHour: 21,
  deliveryFee: 1990,
  minDeliveryOrder: 5000,
  orderingDetailsVerified: false,
  deliveryEnabled: true,
  pickupEnabled: true,
  adminPin: '1234',
  currency: 'ARS',
  orderPrefix: 'LT',
  businessLocation: BUSINESS_POINT,
  defaultMapBounds: [
    [-38.982, -68.105],
    [-38.904, -67.955],
  ],
  defaultDeliveryZones: [
    {
      id: 'neuquen-capital',
      name: 'Neuquén Capital',
      center: { lat: BUSINESS_POINT.lat, lng: BUSINESS_POINT.lng },
    },
    { id: 'cipolletti', name: 'Cipolletti', center: { lat: -38.9339, lng: -67.9903 } },
  ],
  demoDestinations: {
    neuquen: { name: 'Destino · Neuquén Capital', lat: -38.9402, lng: -68.0735 },
    cipolletti: { name: 'Destino · Cipolletti', lat: -38.9339, lng: -67.9903 },
  },
  demoStreetTestDestinations: [
    {
      id: 'neuquen-centro',
      label: 'Neuquén Centro',
      addressLabel: 'Destino demo · Neuquén Centro',
      city: 'Neuquén',
      lat: -38.9517,
      lng: -68.0641,
    },
    {
      id: 'alto-comahue',
      label: 'Alto Comahue',
      addressLabel: 'Destino demo · Alto Comahue',
      city: 'Neuquén',
      lat: -38.9511,
      lng: -68.0805,
    },
    {
      id: 'cipolletti-centro',
      label: 'Cipolletti Centro',
      addressLabel: 'Destino demo · Cipolletti Centro',
      city: 'Cipolletti',
      lat: -38.9339,
      lng: -67.9903,
    },
    {
      id: 'parque-norte-bardas',
      label: 'Parque Norte / Bardas',
      addressLabel: 'Destino demo · Parque Norte / Bardas',
      city: 'Neuquén',
      lat: -38.9282,
      lng: -68.0718,
    },
    {
      id: 'la-taba-demo',
      label: 'Local TABA2 demo',
      addressLabel: 'Local demo · TABA2',
      city: 'Neuquén',
      lat: BUSINESS_POINT.lat,
      lng: BUSINESS_POINT.lng,
    },
  ],
  mapProvider: {
    name: 'CARTO + OpenStreetMap',
    defaultTheme: 'light',
    tileLayers: {
      light: {
        name: 'CARTO Positron',
        tilesUrl: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      },
      dark: {
        name: 'CARTO Dark Matter',
        tilesUrl: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      },
      fallback: {
        name: 'OpenStreetMap',
        tilesUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '&copy; OpenStreetMap contributors',
      },
    },
  },
  // Categorías demo que el comercio puede activar/desactivar y editar.
  // El catálogo QA no trae categorías opcionales por defecto.
  demoCategories: [],
});

export const DEFAULT_STORAGE_KEYS = Object.freeze({
  state: 'la_taba_mvp_v4_state',
  productionCart: 'la_taba_production_cart_v1',
  adminUnlocked: 'la_taba_mvp_v4_admin_unlocked',
  customerFavorites: 'la_taba_customer_favorites_v1',
  customerHistory: 'la_taba_customer_history_v1',
  customerProfile: 'la_taba_customer_profile_v1',
  cashboxClosures: 'la_taba_cashbox_closures_v1',
});

export const SHOWCASE_STORAGE_KEYS = Object.freeze({
  state: 'la_taba_showcase_mvp_v4_state',
  productionCart: 'la_taba_showcase_production_cart_v1',
  adminUnlocked: 'la_taba_showcase_mvp_v4_admin_unlocked',
  customerFavorites: 'la_taba_showcase_customer_favorites_v1',
  customerHistory: 'la_taba_showcase_customer_history_v1',
  customerProfile: 'la_taba_showcase_customer_profile_v1',
  cashboxClosures: 'la_taba_showcase_cashbox_closures_v1',
});

export function storageKeysForSearch(search = currentSearch()) {
  return isShowcaseMode(search) ? SHOWCASE_STORAGE_KEYS : DEFAULT_STORAGE_KEYS;
}

export const STORAGE_KEYS = storageKeysForSearch();

function currentSearch() {
  try {
    return globalThis.location?.search ?? '';
  } catch (_) {
    return '';
  }
}
