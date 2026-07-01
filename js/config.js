// ─────────────────────────────────────────────────────────────────────────────
// Marca del PRODUCTO (la plataforma que se vende a comercios). Es la única fuente
// de verdad del nombre comercial, el claim y los textos de marca: evita repetir
// strings sueltos por la app. OJO: es distinta del COMERCIO demo que se ve dentro
// de la app (PedidoPropio = producto; "La Taba" = comercio de ejemplo).
// El comercio demo se siembra desde BRAND.demoBusinessName más abajo.
export const BRAND = Object.freeze({
  productName: 'PedidoPropio',
  tagline: 'Tu sistema de pedidos directo, sin depender de apps con comisión.',
  shortTagline: 'Pedidos directos para tu comercio',
  // Comercio ficticio reusable que protagoniza la demo (encaja con el catálogo
  // de parrilla/carnicería actual). Cambialo acá para adaptar la demo a otro rubro.
  demoBusinessName: 'La Taba',
  demoBusinessSubtitle: 'Carnicería y parrilla · delivery propio',
  // Mensaje que se precarga al tocar "Hablar por WhatsApp" desde la presentación.
  contactWhatsappMessage: 'Hola, vi la demo de PedidoPropio y quiero info para mi comercio.',
});

export const BUSINESS_CONFIG = Object.freeze({
  businessName: BRAND.demoBusinessName,
  name: BRAND.demoBusinessName,
  subtitle: BRAND.demoBusinessSubtitle,
  whatsappNumber: '5492996209136',
  address: 'Mendoza 845/851, Neuquén Capital',
  // Dirección textual del local. NO hay una coordenada lat/lng verificada para
  // esta dirección, así que el mapa del cliente NO plotea un marcador del local
  // (no inventamos su ubicación). `businessLocation` queda sólo como referencia
  // interna y no se muestra como ubicación real del comercio.
  businessLocationVerified: false,
  deliveryZone: 'Neuquén centro, barrios cercanos y Cipolletti coordinado',
  openingHoursLabel: 'Lunes a sábado · 9:00 a 21:00',
  openingHours: 'Lunes a sábado · 9:00 a 21:00',
  openHour: 9,
  closeHour: 21,
  deliveryFee: 1990,
  minDeliveryOrder: 5000,
  adminPin: '1234',
  currency: 'ARS',
  orderPrefix: 'LT',
  businessLocation: {
    name: `${BRAND.demoBusinessName} · Neuquén Capital`,
    lat: -38.9516,
    lng: -68.0591,
  },
  defaultMapBounds: [
    [-38.982, -68.105],
    [-38.904, -67.955],
  ],
  defaultDeliveryZones: [
    { id: 'neuquen-capital', name: 'Neuquén Capital', center: { lat: -38.9516, lng: -68.0591 } },
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
      label: 'Local La Taba demo',
      addressLabel: 'Local demo · La Taba',
      city: 'Neuquén',
      lat: -38.9516,
      lng: -68.0591,
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
  // "alcohol" queda como ejemplo configurable y NO se vende por defecto
  // (sin ventas reales): para habilitarla habría que cargar productos propios.
  demoCategories: ['lacteos'],
});

export const STORAGE_KEYS = Object.freeze({
  state: 'la_taba_mvp_v4_state',
  adminUnlocked: 'la_taba_mvp_v4_admin_unlocked',
  customerFavorites: 'la_taba_customer_favorites_v1',
  customerHistory: 'la_taba_customer_history_v1',
  customerProfile: 'la_taba_customer_profile_v1',
  cashboxClosures: 'la_taba_cashbox_closures_v1',
});
