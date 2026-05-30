export const BUSINESS_CONFIG = Object.freeze({
  businessName: 'La Taba',
  name: 'La Taba',
  subtitle: 'Carnicería & delivery propio',
  whatsappNumber: '5492996209136',
  address: 'Neuquén capital',
  deliveryZone: 'Zona centro, barrios cercanos y pedidos coordinados',
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
    name: 'La Taba demo · Neuquén Capital',
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
    neuquen: { name: 'Destino demo · Neuquén Capital', lat: -38.9402, lng: -68.0735 },
    cipolletti: { name: 'Destino demo · Cipolletti', lat: -38.9339, lng: -67.9903 },
  },
  mapProvider: {
    name: 'OpenStreetMap',
    tilesUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
  },
  // Categorías demo que el comercio puede activar/desactivar y editar.
  // "alcohol" queda como ejemplo configurable y NO se vende por defecto
  // (sin ventas reales): para habilitarla habría que cargar productos propios.
  demoCategories: ['lacteos'],
});

export const STORAGE_KEYS = Object.freeze({
  state: 'la_taba_mvp_v4_state',
  adminUnlocked: 'la_taba_mvp_v4_admin_unlocked',
});
