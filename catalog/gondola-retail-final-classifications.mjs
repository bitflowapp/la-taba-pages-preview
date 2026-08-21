/*
 * Clasificación comercial de los 60 SKU actuales de La Taba.
 *
 * Esta lista no crea, publica ni modifica productos. Es la decisión de auditoría
 * sobre el catálogo compuesto por:
 *   - 52 filas de `catalog/gondola-neuquen.mjs`;
 *   - 4 packs históricos que siguen en la fotografía pública de producción;
 *   - 4 unidades minoristas de `catalog/retail-unidades.mjs`.
 *
 * Cada SKU aparece exactamente una vez. Los tests reconstruyen esas tres fuentes
 * y fallan si la lista queda corta, agrega un SKU ajeno o repite una decisión.
 */

export const GONDOLA_RETAIL_FINAL_CLASSIFICATION_LABELS = Object.freeze([
  'KEEP_HIGH_PRIORITY',
  'KEEP_SECONDARY',
  'FAMILY_SIZE_MISSING',
  'PACK_OK',
  'DUPLICATE',
  'WRONG_PRESENTATION',
  'REVIEW',
]);

const decision = (sku, classification, rationale) => Object.freeze({
  sku,
  classification,
  rationale,
});

export const GONDOLA_RETAIL_FINAL_CLASSIFICATIONS = Object.freeze([
  // Gaseosas: primero formatos familiares, luego unidades chicas y packs.
  decision('coca-cola-original-2250ml', 'KEEP_HIGH_PRIORITY', 'Botella unitaria de 2,25 L: formato familiar real y apto para delivery.'),
  decision('coca-cola-zero-2250ml', 'KEEP_HIGH_PRIORITY', 'Botella unitaria de 2,25 L: formato familiar real y apto para delivery.'),
  decision('coca-cola-original-lata-354ml', 'KEEP_SECONDARY', 'Lata individual chica; se conserva detrás de las botellas familiares.'),
  decision('coca-cola-zero-lata-354ml', 'KEEP_SECONDARY', 'Lata individual chica; se conserva detrás de las botellas familiares.'),
  decision('sprite-original-2250ml', 'KEEP_HIGH_PRIORITY', 'Botella unitaria de 2,25 L: formato familiar real y apto para delivery.'),
  decision('sprite-zero-2250ml', 'KEEP_HIGH_PRIORITY', 'Botella unitaria de 2,25 L: formato familiar real y apto para delivery.'),
  decision('sprite-original-lata-354ml', 'KEEP_SECONDARY', 'Lata individual chica; se conserva detrás de las botellas familiares.'),
  decision('fanta-naranja-2250ml', 'KEEP_HIGH_PRIORITY', 'Botella unitaria de 2,25 L: formato familiar real y apto para delivery.'),
  decision('pepsi-original-2000ml', 'KEEP_HIGH_PRIORITY', 'Botella unitaria de 2 L: formato familiar real y apto para delivery.'),
  decision('pepsi-black-1500ml', 'KEEP_HIGH_PRIORITY', 'Botella unitaria de 1,5 L: formato familiar prioritario.'),
  decision('seven-up-original-2000ml', 'KEEP_HIGH_PRIORITY', 'Botella unitaria de 2 L: formato familiar real y apto para delivery.'),
  decision('coca-cola-original-botella-pet-500-ml-pack-x12', 'PACK_OK', 'Pack x12 explícito, con precio de pack y unidad hermana diferenciada.'),
  decision('coca-cola-zero-botella-pet-500-ml-pack-x12', 'PACK_OK', 'Pack x12 explícito, con precio de pack y unidad hermana diferenciada.'),
  decision('sprite-botella-pet-500-ml-pack-x12', 'PACK_OK', 'Pack x12 explícito, con precio de pack y unidad hermana diferenciada.'),
  decision('fanta-naranja-botella-pet-1500-ml-pack-x6', 'PACK_OK', 'Pack x6 explícito, con precio de pack y unidad hermana diferenciada.'),
  decision('coca-cola-original-pet-500ml', 'KEEP_SECONDARY', 'Unidad de 500 ml válida; la decisión comercial exige conservarla sin priorizarla.'),
  decision('coca-cola-zero-pet-500ml', 'KEEP_SECONDARY', 'Unidad de 500 ml válida; la decisión comercial exige conservarla sin priorizarla.'),
  decision('sprite-pet-500ml', 'KEEP_SECONDARY', 'Unidad de 500 ml válida; la decisión comercial exige conservarla sin priorizarla.'),
  decision('fanta-naranja-pet-1500ml', 'KEEP_HIGH_PRIORITY', 'Botella unitaria de 1,5 L: formato familiar prioritario.'),

  // Mixers.
  decision('paso-de-los-toros-tonica-1500ml', 'KEEP_HIGH_PRIORITY', 'Botella unitaria de 1,5 L, formato comercial para previa y juntada.'),
  decision('paso-de-los-toros-pomelo-1500ml', 'KEEP_HIGH_PRIORITY', 'Botella unitaria de 1,5 L, formato comercial para previa y juntada.'),
  decision('soda-manaos-sifon-2000ml', 'KEEP_HIGH_PRIORITY', 'Sifón unitario de 2 L, formato familiar y de mezcla.'),

  // Aguas.
  decision('villa-del-sur-sin-gas-600ml', 'FAMILY_SIZE_MISSING', 'Se conserva, pero Villa del Sur sólo tiene 600 ml en los 60 SKU y necesita investigar una hermana familiar.'),
  decision('villavicencio-sin-gas-1500ml', 'KEEP_HIGH_PRIORITY', 'Botella unitaria de 1,5 L: formato familiar prioritario de agua sin gas.'),
  decision('villavicencio-con-gas-500ml', 'FAMILY_SIZE_MISSING', 'Se conserva, pero la variante con gas sólo tiene 500 ml y necesita investigar una hermana familiar.'),
  decision('benedictino-sin-gas-2250ml', 'KEEP_HIGH_PRIORITY', 'Botella unitaria de 2,25 L: formato familiar real de agua sin gas.'),

  // Aguas saborizadas.
  decision('aquarius-pera-1500ml', 'KEEP_HIGH_PRIORITY', 'Botella unitaria de 1,5 L: presentación familiar comercial.'),
  decision('aquarius-manzana-1500ml', 'KEEP_HIGH_PRIORITY', 'Botella unitaria de 1,5 L: presentación familiar comercial.'),
  decision('aquarius-pomelo-2250ml', 'KEEP_HIGH_PRIORITY', 'Botella unitaria de 2,25 L: presentación familiar comercial.'),

  // Energizantes: la lata individual es el formato comercial correcto.
  decision('red-bull-original-250ml', 'KEEP_HIGH_PRIORITY', 'Lata individual propia de la categoría energizantes; no aplica el mínimo familiar.'),
  decision('red-bull-sin-azucar-250ml', 'KEEP_HIGH_PRIORITY', 'Lata individual propia de la categoría energizantes; no aplica el mínimo familiar.'),
  decision('monster-green-zero-473ml', 'KEEP_HIGH_PRIORITY', 'Lata individual propia de la categoría energizantes; no aplica el mínimo familiar.'),
  decision('speed-original-473ml', 'KEEP_HIGH_PRIORITY', 'Lata individual propia de la categoría energizantes; no aplica el mínimo familiar.'),
  decision('speed-zero-473ml', 'KEEP_HIGH_PRIORITY', 'Lata individual propia de la categoría energizantes; no aplica el mínimo familiar.'),

  // Isotónicas: presentaciones unitarias comerciales reales.
  decision('gatorade-cool-blue-500ml', 'KEEP_HIGH_PRIORITY', 'Botella individual comercial propia de la categoría isotónicas.'),
  decision('gatorade-manzana-1250ml', 'KEEP_HIGH_PRIORITY', 'Botella de 1,25 L comercial propia de la categoría isotónicas.'),
  decision('powerade-mountain-blast-500ml', 'KEEP_HIGH_PRIORITY', 'Botella individual comercial propia de la categoría isotónicas.'),

  // Cervezas: x6 primero; botellas grandes después; unidades chicas secundarias.
  decision('quilmes-clasica-lata-473ml', 'KEEP_SECONDARY', 'Unidad válida, pero el pack x6 de la misma cerveza tiene prioridad comercial.'),
  decision('quilmes-clasica-lata-473ml-pack-6', 'PACK_OK', 'Pack de cerveza x6 explícito y comercialmente prioritario.'),
  decision('quilmes-clasica-botella-710ml', 'KEEP_HIGH_PRIORITY', 'Botella grande individual, formato razonable para delivery.'),
  decision('quilmes-stout-lata-473ml', 'KEEP_SECONDARY', 'Lata individual válida; queda después de packs y botellas grandes.'),
  decision('brahma-chopp-lata-710ml', 'KEEP_HIGH_PRIORITY', 'Presentación grande individual y marcada como de alta rotación en la góndola base.'),
  decision('budweiser-lata-473ml', 'KEEP_SECONDARY', 'Lata individual válida; investigar un pack real sin inventarlo.'),
  decision('stella-artois-lata-473ml', 'KEEP_SECONDARY', 'Lata individual válida; investigar un pack real sin inventarlo.'),
  decision('corona-extra-botella-330ml', 'KEEP_SECONDARY', 'Botella individual válida; investigar un pack real sin inventarlo.'),
  decision('andes-origen-rubia-lata-473ml', 'KEEP_SECONDARY', 'Lata individual válida; investigar un pack real sin inventarlo.'),
  decision('andes-origen-roja-lata-473ml', 'KEEP_SECONDARY', 'Lata individual válida; investigar un pack real sin inventarlo.'),
  decision('patagonia-amber-lager-botella-730ml', 'KEEP_HIGH_PRIORITY', 'Botella grande regional y marcada como de alta rotación en la góndola base.'),

  // Fernet, aperitivos, vinos y destilados permanecen no disponibles por alcohol.
  decision('fernet-branca-1000ml', 'KEEP_HIGH_PRIORITY', 'Botella de 1 L y producto de alta rotación para una futura góndola de alcohol habilitada.'),
  decision('fernet-1882-750ml', 'KEEP_SECONDARY', 'Alternativa válida de fernet; se conserva detrás de la referencia principal.'),
  decision('gancia-americano-450ml', 'KEEP_SECONDARY', 'Aperitivo individual válido, preparado pero no publicable con el alcohol cerrado.'),
  decision('gancia-lima-limon-lata-473ml', 'KEEP_SECONDARY', 'Aperitivo listo para tomar válido, preparado pero no publicable con el alcohol cerrado.'),
  decision('dr-lemon-vodka-pomelo-lata-473ml', 'KEEP_SECONDARY', 'Aperitivo listo para tomar válido, preparado pero no publicable con el alcohol cerrado.'),
  decision('trapiche-origen-malbec-750ml', 'KEEP_HIGH_PRIORITY', 'Malbec de 750 ml marcado como de alta rotación en la góndola base.'),
  decision('dada-caramel-750ml', 'KEEP_SECONDARY', 'Vino alternativo válido; conserva fallback hasta resolver su imagen.'),
  decision('cafayate-torrontes-750ml', 'KEEP_SECONDARY', 'Vino blanco alternativo válido para amplitud acotada de la categoría.'),
  decision('toro-viejo-clasico-tinto-750ml', 'KEEP_HIGH_PRIORITY', 'Vino tinto marcado como de alta rotación en la góndola base.'),
  decision('toro-tinto-1000ml', 'KEEP_SECONDARY', 'Vino alternativo válido; se conserva sin desplazar las referencias prioritarias.'),
  decision('gin-gordons-700ml', 'KEEP_SECONDARY', 'Destilado válido; conserva fallback hasta resolver su imagen.'),
  decision('vodka-skyy-700ml', 'KEEP_SECONDARY', 'Destilado válido, preparado pero no publicable con el alcohol cerrado.'),
]);

