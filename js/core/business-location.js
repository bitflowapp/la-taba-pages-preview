// ─────────────────────────────────────────────────────────────────────────────
// CONTRATO CENTRAL DE UBICACIÓN. Única fuente de verdad geográfica de TABA2.
//
// POR QUÉ EXISTE
// --------------
// La coordenada del local estuvo duplicada a mano en cuatro lugares (config del
// storefront, zonas de entrega, destinos de prueba y el escenario sandbox del
// mapa) y las cuatro copias apuntaban a un punto equivocado: Avenida Argentina
// junto a Parque Central, a 793 m de la puerta real. La demo mostraba el pin ahí.
//
// Ahora la coordenada entra una sola vez, acá, con su procedencia declarada, y
// todo lo demás la deriva. Los valores son un espejo exacto de
// `data/business-location.json`, que es el contrato legible por herramientas;
// `npm run location:check` falla si este archivo, ese JSON, la app del Rider y
// el sembrado de staging dejan de coincidir.
//
// No se declara `human_verified: true` porque nadie del comercio confirmó todavía
// el pin contra la puerta. El origen es una ficha comercial pública contrastada
// contra varias fuentes independientes, que es una cosa distinta y más débil.
// Ver `data/business-location.json` → `source_note` para la evidencia completa.
// ─────────────────────────────────────────────────────────────────────────────

export const BUSINESS_LOCATION = Object.freeze({
  business_id: '00000000-0000-4000-8000-000000000001',
  name: 'La Taba 2',
  address: 'Mendoza 827, Neuquén',
  latitude: -38.9460616,
  longitude: -68.0533209,
  source: 'public_directory_cross_checked',
  confidence: 'high',
  verified_at: '2026-08-08T17:16:00Z',
  human_verified: false,
  accuracy_meters: 20,
});

// La forma { lat, lng } que consume el código de mapas del storefront.
export const BUSINESS_POINT = Object.freeze({
  name: `${BUSINESS_LOCATION.name} · Neuquén Capital`,
  lat: BUSINESS_LOCATION.latitude,
  lng: BUSINESS_LOCATION.longitude,
});

// Destino del CLIENTE en la demo. Es un espacio público a propósito: una plaza
// no es el domicilio de nadie, así que la demo nunca expone dónde vive una
// persona. Verificado por reverse geocoding como `leisure/playground`.
export const DEMO_CUSTOMER_DESTINATION = Object.freeze({
  id: 'plaza-de-la-vida',
  name: 'Destino demo · Plaza de la Vida',
  label: 'Destino demo · Plaza de la Vida',
  addressLabel: 'Destino demo · Plaza de la Vida',
  city: 'Neuquén',
  lat: -38.945584,
  lng: -68.040579,
});

function coordPair(lat, lng) {
  // Siete decimales son ~1 cm: más de lo que hace falta para una puerta, pero
  // es la precisión con la que está escrito el contrato, y fijarla acá deja la
  // cadena estable —siempre la misma— cuando se comparan dos enlaces.
  return `${Number(lat).toFixed(7)},${Number(lng).toFixed(7)}`;
}

// Google Maps tiene que abrir POR COORDENADAS y no sólo por texto: la misma
// cadena «Mendoza 827» resuelve en Zapala, a 175 km, si el geocodificador no
// acota la ciudad. La etiqueta va aparte, para que el usuario vea el nombre.
export function mapsSearchUrl(lat, lng) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordPair(lat, lng))}`;
}

export function mapsDirectionsUrl(lat, lng) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(coordPair(lat, lng))}`;
}

// Esquema `geo:` para que Android ofrezca la app de mapas que el usuario tenga.
export function geoUri(lat, lng, label = '') {
  const pair = coordPair(lat, lng);
  const q = label ? `${pair}(${label})` : pair;
  return `geo:${pair}?q=${encodeURIComponent(q)}`;
}

export function businessMapsSearchUrl() {
  return mapsSearchUrl(BUSINESS_LOCATION.latitude, BUSINESS_LOCATION.longitude);
}

export function businessMapsDirectionsUrl() {
  return mapsDirectionsUrl(BUSINESS_LOCATION.latitude, BUSINESS_LOCATION.longitude);
}

export function businessGeoUri() {
  return geoUri(BUSINESS_LOCATION.latitude, BUSINESS_LOCATION.longitude, BUSINESS_LOCATION.name);
}

// Un punto sólo se puede presentar como ubicación del comercio si viene de este
// contrato. `businessLocationVerified` del storefront se deriva de acá.
export const BUSINESS_LOCATION_IS_PLOTTABLE =
  BUSINESS_LOCATION.source !== 'qa_fixture' && BUSINESS_LOCATION.confidence !== 'low';
