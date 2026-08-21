/*
 * TABA2 · GONDOLA COMERCIAL FINAL · propuesta previa a aprobación humana
 * ======================================================================
 *
 * Este archivo es un PAYLOAD, no un aplicador. No abre la red, no usa
 * credenciales y no escribe en Supabase. La propuesta conserva los 60 SKU
 * actuales y agrega únicamente presentaciones reales cuya identidad, GTIN y
 * precio de referencia quedaron trazados.
 *
 * Regla comercial pedida por el dueño:
 *   referencia actual × 1,15, una sola vez, y luego siguiente precio terminado
 *   en 90. Ejemplos de control: 1.990 → 2.290; 4.290 → 4.990.
 *
 * Las URLs de retailers son evidencia de identidad/precio solamente. Nunca son
 * una autorización para publicar sus imágenes. Todos los SKU nuevos quedan con
 * los seis campos de imagen nulos y usan el fallback propio de TABA hasta que el
 * pipeline encuentre, audite y apruebe un packshot oficial EXACTO.
 */

export const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
export const CATALOGO_ACTUAL = 60;

export const FUENTES = Object.freeze({
  cotoNeuquen: Object.freeze({
    tipo: 'retailer_referencia_identidad_precio',
    nombre: 'Coto · sucursal 185 · Neuquén',
    actualizadoEl: '2026-08-20',
    consultadoEl: '2026-08-21',
    url: 'https://www.coto.com.ar/appcotows/preciosleyqr/pricelist_185.html',
    imagenPublicable: false,
  }),
  javicard: Object.freeze({
    tipo: 'retailer_referencia_precio_nacional',
    nombre: 'Drugstore Javicard · Six packs 473',
    actualizadoEl: null,
    consultadoEl: '2026-08-21',
    url: 'https://javicard.ar/productos/sixpacks473',
    imagenPublicable: false,
  }),
  pricelyBrahma: Object.freeze({
    tipo: 'agregador_referencia_gtin',
    nombre: 'Pricely · Brahma 473 ml x6',
    actualizadoEl: '2026-08-21',
    consultadoEl: '2026-08-21',
    url: 'https://pricely.ar/product/7792798005970',
    imagenPublicable: false,
  }),
});

export const CRITERIO_PRECIO_PROPUESTO = Object.freeze({
  margenUnaSolaVez: 1.15,
  redondeo: 'siguiente importe terminado en 90',
  conservarPreciosActuales: true,
});

/**
 * Aplica el 15 % una sola vez y avanza al siguiente importe terminado en 90.
 * El cálculo entero en centavos evita errores binarios en referencias con
 * centavos, como Villavicencio con gas ($3.010,40).
 */
export function precioFinalDesdeReferencia(precioReferencia) {
  if (!Number.isFinite(precioReferencia) || precioReferencia <= 0) {
    throw new TypeError('precioReferencia tiene que ser un número positivo');
  }
  const referenciaCentavos = Math.round(precioReferencia * 100);
  const conMargenCentavos = Math.round((referenciaCentavos * 115) / 100);
  const conMargenPesos = conMargenCentavos / 100;
  return Math.ceil((conMargenPesos + 10) / 100) * 100 - 10;
}

const NUEVO = Object.freeze({
  available: false,
  catalogAssetId: null,
  chilled: false,
  imageSource: 'FALLBACK_PROPIO_TABA',
  imageUrl: null,
  stock: 0,
});

function producto(datos) {
  const price = precioFinalDesdeReferencia(datos.referencePrice);
  return Object.freeze({
    ...NUEVO,
    ...datos,
    externalId: datos.sku,
    gtinType: 'EAN-13',
    price,
    priceStatus: 'confirmed',
  });
}

export const PRODUCTOS_PROPUESTOS = Object.freeze([
  // Gaseosas · 1,5 L primero. Fanta Naranja 1,5 L ya existe y se conserva.
  producto({
    sku: 'coca-cola-original-pet-1500ml',
    brand: 'Coca-Cola',
    name: 'Coca-Cola Original',
    category: 'Gaseosas',
    subcategory: 'cola',
    variant: 'Original',
    capacityValue: 1500,
    capacityUnit: 'ml',
    packagingType: 'botella-pet',
    soldAsPack: false,
    unitsPerPack: 1,
    alcoholic: false,
    gtin: '7790895000430',
    referencePrice: 4290,
    priceSource: 'cotoNeuquen',
    commercialReason: 'formato familiar principal; completa Coca-Cola Original',
  }),
  producto({
    sku: 'coca-cola-zero-pet-1500ml',
    brand: 'Coca-Cola',
    name: 'Coca-Cola Zero',
    category: 'Gaseosas',
    subcategory: 'cola-sin-azucar',
    variant: 'Sin azúcar',
    capacityValue: 1500,
    capacityUnit: 'ml',
    packagingType: 'botella-pet',
    soldAsPack: false,
    unitsPerPack: 1,
    alcoholic: false,
    gtin: '7790895067556',
    referencePrice: 4290,
    priceSource: 'cotoNeuquen',
    commercialReason: 'formato familiar principal; completa Coca-Cola Zero',
  }),
  producto({
    sku: 'sprite-original-pet-1500ml',
    brand: 'Sprite',
    name: 'Sprite',
    category: 'Gaseosas',
    subcategory: 'lima-limon',
    variant: 'Original',
    capacityValue: 1500,
    capacityUnit: 'ml',
    packagingType: 'botella-pet',
    soldAsPack: false,
    unitsPerPack: 1,
    alcoholic: false,
    gtin: '7790895000447',
    referencePrice: 4290,
    priceSource: 'cotoNeuquen',
    commercialReason: 'formato familiar principal; completa Sprite Original',
  }),
  producto({
    sku: 'sprite-zero-pet-1500ml',
    brand: 'Sprite',
    name: 'Sprite Zero',
    category: 'Gaseosas',
    subcategory: 'lima-limon-sin-azucar',
    variant: 'Sin azúcar',
    capacityValue: 1500,
    capacityUnit: 'ml',
    packagingType: 'botella-pet',
    soldAsPack: false,
    unitsPerPack: 1,
    alcoholic: false,
    gtin: '7790895064173',
    referencePrice: 4290,
    priceSource: 'cotoNeuquen',
    commercialReason: 'formato familiar principal; completa Sprite Zero',
  }),

  // Aguas · se conserva la unidad chica y se suma su hermana familiar real.
  producto({
    sku: 'villa-del-sur-sin-gas-pet-2250ml',
    brand: 'Villa del Sur',
    name: 'Villa del Sur',
    category: 'Aguas',
    subcategory: 'sin-gas',
    variant: 'Sin gas',
    capacityValue: 2250,
    capacityUnit: 'ml',
    packagingType: 'botella-pet',
    soldAsPack: false,
    unitsPerPack: 1,
    alcoholic: false,
    gtin: '7798062547559',
    referencePrice: 2450,
    priceSource: 'cotoNeuquen',
    commercialReason: 'resuelve FAMILY_SIZE_MISSING de Villa del Sur',
  }),
  producto({
    sku: 'villavicencio-con-gas-pet-1500ml',
    brand: 'Villavicencio',
    name: 'Villavicencio',
    category: 'Aguas',
    subcategory: 'con-gas',
    variant: 'Con gas',
    capacityValue: 1500,
    capacityUnit: 'ml',
    packagingType: 'botella-pet',
    soldAsPack: false,
    unitsPerPack: 1,
    alcoholic: false,
    gtin: '7799155000210',
    referencePrice: 3010.40,
    priceSource: 'cotoNeuquen',
    commercialReason: 'resuelve FAMILY_SIZE_MISSING de Villavicencio con gas',
  }),

  // Jugos · categoría hoy vacía; dos sabores de alta reconocibilidad, sin inflarla.
  producto({
    sku: 'cepita-naranja-pet-1500ml',
    brand: 'Cepita',
    name: 'Cepita Naranja',
    category: 'Jugos',
    subcategory: 'naranja',
    variant: 'Naranja',
    capacityValue: 1500,
    capacityUnit: 'ml',
    packagingType: 'botella-pet',
    soldAsPack: false,
    unitsPerPack: 1,
    alcoholic: false,
    gtin: '7790895641800',
    referencePrice: 3890,
    priceSource: 'cotoNeuquen',
    commercialReason: 'abre Jugos con un formato familiar y sabor principal',
  }),
  producto({
    sku: 'cepita-durazno-pet-1500ml',
    brand: 'Cepita',
    name: 'Cepita Durazno',
    category: 'Jugos',
    subcategory: 'durazno',
    variant: 'Durazno',
    capacityValue: 1500,
    capacityUnit: 'ml',
    packagingType: 'botella-pet',
    soldAsPack: false,
    unitsPerPack: 1,
    alcoholic: false,
    gtin: '7790895641534',
    referencePrice: 3890,
    priceSource: 'cotoNeuquen',
    commercialReason: 'segundo sabor familiar útil; evita una categoría de un solo SKU',
  }),

  // Cervezas · el pack es la presentación principal. Siguen detrás de la
  // compuerta de licencia: is_alcoholic=true, stock=0 y available=false.
  producto({
    sku: 'brahma-chopp-lata-473ml-pack-6',
    brand: 'Brahma',
    name: 'Brahma Chopp',
    category: 'Cervezas',
    subcategory: 'rubia',
    variant: 'Rubia',
    capacityValue: 473,
    capacityUnit: 'ml',
    packagingType: 'lata',
    soldAsPack: true,
    unitsPerPack: 6,
    alcoholic: true,
    minimumAge: 18,
    gtin: '7792798005970',
    referencePrice: 13000,
    priceSource: 'javicard',
    gtinSource: 'pricelyBrahma',
    commercialReason: 'pack x6 real para una marca importante hoy presente sólo en 710 ml',
  }),
  producto({
    sku: 'budweiser-lata-473ml-pack-6',
    brand: 'Budweiser',
    name: 'Budweiser',
    category: 'Cervezas',
    subcategory: 'lager',
    variant: 'Lager',
    capacityValue: 473,
    capacityUnit: 'ml',
    packagingType: 'lata',
    soldAsPack: true,
    unitsPerPack: 6,
    alcoholic: true,
    minimumAge: 18,
    gtin: '7793147118846',
    referencePrice: 17322,
    priceSource: 'cotoNeuquen',
    commercialReason: 'pack x6 local y exacto; unidad actual queda secundaria',
  }),
  producto({
    sku: 'stella-artois-lata-473ml-pack-6',
    brand: 'Stella Artois',
    name: 'Stella Artois',
    category: 'Cervezas',
    subcategory: 'lager',
    variant: 'Lager',
    capacityValue: 473,
    capacityUnit: 'ml',
    packagingType: 'lata',
    soldAsPack: true,
    unitsPerPack: 6,
    alcoholic: true,
    minimumAge: 18,
    gtin: '7792798010592',
    referencePrice: 25602,
    priceSource: 'cotoNeuquen',
    commercialReason: 'pack x6 local y exacto; unidad actual queda secundaria',
  }),
  producto({
    sku: 'andes-origen-rubia-lata-473ml-pack-6',
    brand: 'Andes Origen',
    name: 'Andes Origen Rubia',
    category: 'Cervezas',
    subcategory: 'rubia',
    variant: 'Rubia',
    capacityValue: 473,
    capacityUnit: 'ml',
    packagingType: 'lata',
    soldAsPack: true,
    unitsPerPack: 6,
    alcoholic: true,
    minimumAge: 18,
    gtin: '7792798001712',
    referencePrice: 20316,
    priceSource: 'cotoNeuquen',
    commercialReason: 'pack x6 local y exacto; alta relevancia regional',
  }),
]);

/*
 * GTIN exactos para SKU que ya existen. Son una propuesta de enriquecimiento,
 * no cambios ejecutados. Antes de aplicar, la vía guardada debe releer
 * product_barcodes y abortar ante cualquier colisión o dato ya diferente.
 */
export const BARCODES_EXISTENTES_PROPUESTOS = Object.freeze([
  { sku: 'coca-cola-original-2250ml', gtin: '7790895000997', gtinType: 'EAN-13', source: 'cotoNeuquen' },
  { sku: 'coca-cola-zero-2250ml', gtin: '7790895067570', gtinType: 'EAN-13', source: 'cotoNeuquen' },
  { sku: 'sprite-original-2250ml', gtin: '7790895001000', gtinType: 'EAN-13', source: 'cotoNeuquen' },
  { sku: 'sprite-zero-2250ml', gtin: '7790895064166', gtinType: 'EAN-13', source: 'cotoNeuquen' },
  { sku: 'fanta-naranja-2250ml', gtin: '7790895001017', gtinType: 'EAN-13', source: 'cotoNeuquen' },
  { sku: 'coca-cola-original-lata-354ml', gtin: '7790895000232', gtinType: 'EAN-13', source: 'cotoNeuquen' },
  { sku: 'coca-cola-zero-lata-354ml', gtin: '7790895067587', gtinType: 'EAN-13', source: 'cotoNeuquen' },
  { sku: 'sprite-original-lata-354ml', gtin: '7790895000270', gtinType: 'EAN-13', source: 'cotoNeuquen' },
  { sku: 'villa-del-sur-sin-gas-600ml', gtin: '7798062540109', gtinType: 'EAN-13', source: 'cotoNeuquen' },
  { sku: 'villavicencio-sin-gas-1500ml', gtin: '7799155000180', gtinType: 'EAN-13', source: 'cotoNeuquen' },
  { sku: 'villavicencio-con-gas-500ml', gtin: '7799155000203', gtinType: 'EAN-13', source: 'cotoNeuquen' },
]);

export const EXCLUIDOS_POR_AHORA = Object.freeze([
  {
    candidate: 'Coca-Cola retornable 2,5 L',
    reason: 'formato real, pero la góndola no modela depósito/devolución de envase; no se publica como descartable',
    gtin: '7790895068164',
  },
  {
    candidate: 'Corona pack x6 · 2.838 ml',
    reason: 'la referencia implica seis unidades de 473 ml y no es hermana de la Corona Extra 330 ml actual',
    gtin: '7792798014750',
  },
  {
    candidate: 'Patagonia 24.7 lata 473 ml x6',
    reason: 'es otra línea; no debe usarse para completar Patagonia Amber Lager 730 ml',
    gtin: '7792798001927',
  },
  {
    candidate: 'Fanta Naranja Zero 1,5 L',
    reason: 'formato real, pero agrega una variante nueva antes de cubrir surtido esencial; queda como REVIEW comercial',
    gtin: '7790895002304',
  },
  {
    candidate: 'gaseosas descartables 3 L',
    reason: 'sin evidencia local exacta para las familias principales; no se inventa una presentación por objetivo de cantidad',
    gtin: null,
  },
]);

export const TOTAL_ESTIMADO = CATALOGO_ACTUAL + PRODUCTOS_PROPUESTOS.length;

