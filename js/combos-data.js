/*
 * Derivado de data/combos.csv, que es el manifiesto que Operaciones importa.
 *
 * Acá NO hay precios. Un combo declara qué contiene, cuánto de cada cosa, qué
 * se puede sustituir y qué descuento decidió el comercio; el precio individual,
 * el promocional, el ahorro y el stock los deriva `js/core/combos.js` del
 * catálogo vivo. Ver el comentario de ese módulo para el porqué.
 *
 * `approvalStatus` es PENDIENTE_APROBACION_COMERCIAL en los siete: el descuento
 * es una propuesta armada sobre precios de componente confirmados, no una
 * promoción aprobada. Mientras esté en ese estado el combo se muestra y se
 * puede comparar, pero no se cobra: el precio promocional lo tiene que aplicar
 * el backend de pedidos, y eso es integración de Operaciones.
 */

export const COMBO_MANIFEST = Object.freeze([
  Object.freeze({
    comboId: 'combo-previa-imperial-x6',
    name: 'Previa Imperial',
    tagline: 'Seis latas bien frías para arrancar',
    description: 'Seis Imperial Golden de 473 ml. Se puede cambiar por Extra Lager, APA o Cream Stout sin costo: las cuatro valen lo mismo y vienen en la misma lata.',
    categoryId: 'cervezas',
    discountPercentage: 12,
    terms: 'Requiere validación de mayoría de edad al recibir.',
    approvalStatus: 'PENDIENTE_APROBACION_COMERCIAL',
    previewOnly: true,
    components: Object.freeze([
      Object.freeze({
        sku: 'imperial-golden-lata-473ml',
        quantity: 6,
        substitutions: Object.freeze([
          'imperial-extra-lager-lata-473ml',
          'imperial-apa-lata-473ml',
          'imperial-cream-stout-lata-473ml',
        ]),
      }),
    ]),
  }),
  Object.freeze({
    comboId: 'combo-heineken-x6',
    name: 'Heineken x6',
    tagline: 'La verde, por media docena',
    description: 'Seis Heineken de 473 ml en lata.',
    categoryId: 'cervezas',
    discountPercentage: 10,
    terms: 'Requiere validación de mayoría de edad al recibir.',
    approvalStatus: 'PENDIENTE_APROBACION_COMERCIAL',
    previewOnly: true,
    components: Object.freeze([
      Object.freeze({ sku: 'heineken-original-lata-473ml', quantity: 6, substitutions: Object.freeze([]) }),
    ]),
  }),
  Object.freeze({
    comboId: 'combo-corona-x6',
    name: 'Corona Extra x6',
    tagline: 'Seis porrones de 330 ml',
    description: 'Seis Corona Extra de 330 ml en botella.',
    categoryId: 'cervezas',
    discountPercentage: 10,
    terms: 'Requiere validación de mayoría de edad al recibir.',
    approvalStatus: 'PENDIENTE_APROBACION_COMERCIAL',
    previewOnly: true,
    components: Object.freeze([
      Object.freeze({ sku: 'corona-extra-botella-330ml', quantity: 6, substitutions: Object.freeze([]) }),
    ]),
  }),
  Object.freeze({
    comboId: 'combo-birra-y-energia',
    name: 'Birra y energía',
    tagline: 'Cuatro latas y dos para aguantar',
    description: 'Cuatro Imperial Golden de 473 ml y dos Speed Unlimited de 473 ml. La cerveza se puede cambiar por Extra Lager, APA o Cream Stout, y el energizante por la versión Zero.',
    categoryId: 'cervezas',
    discountPercentage: 12,
    terms: 'Requiere validación de mayoría de edad al recibir.',
    approvalStatus: 'PENDIENTE_APROBACION_COMERCIAL',
    previewOnly: true,
    components: Object.freeze([
      Object.freeze({
        sku: 'imperial-golden-lata-473ml',
        quantity: 4,
        substitutions: Object.freeze([
          'imperial-extra-lager-lata-473ml',
          'imperial-apa-lata-473ml',
          'imperial-cream-stout-lata-473ml',
        ]),
      }),
      Object.freeze({
        sku: 'speed-original-lata-473ml',
        quantity: 2,
        substitutions: Object.freeze(['speed-zero-lata-473ml']),
      }),
    ]),
  }),
  Object.freeze({
    comboId: 'combo-tabla-de-cervezas',
    name: 'Tabla de cervezas',
    tagline: 'Una de cada una, seis en total',
    description: 'Las cuatro Imperial —Golden, Extra Lager, APA y Cream Stout—, una Schneider Rubia de 710 ml y una Corona Extra de 330 ml. Seis cervezas distintas para probar de todo.',
    categoryId: 'cervezas',
    discountPercentage: 10,
    terms: 'Requiere validación de mayoría de edad al recibir.',
    approvalStatus: 'PENDIENTE_APROBACION_COMERCIAL',
    previewOnly: true,
    components: Object.freeze([
      Object.freeze({ sku: 'imperial-golden-lata-473ml', quantity: 1, substitutions: Object.freeze([]) }),
      Object.freeze({ sku: 'imperial-extra-lager-lata-473ml', quantity: 1, substitutions: Object.freeze([]) }),
      Object.freeze({ sku: 'imperial-apa-lata-473ml', quantity: 1, substitutions: Object.freeze([]) }),
      Object.freeze({ sku: 'imperial-cream-stout-lata-473ml', quantity: 1, substitutions: Object.freeze([]) }),
      Object.freeze({ sku: 'schneider-rubia-lata-710ml', quantity: 1, substitutions: Object.freeze([]) }),
      Object.freeze({ sku: 'corona-extra-botella-330ml', quantity: 1, substitutions: Object.freeze([]) }),
    ]),
  }),
  Object.freeze({
    comboId: 'combo-noche-larga',
    name: 'Noche larga',
    tagline: 'Cuatro Heineken y dos Red Bull',
    description: 'Cuatro Heineken de 473 ml y dos Red Bull de 250 ml.',
    categoryId: 'cervezas',
    discountPercentage: 12,
    terms: 'Requiere validación de mayoría de edad al recibir.',
    approvalStatus: 'PENDIENTE_APROBACION_COMERCIAL',
    previewOnly: true,
    components: Object.freeze([
      Object.freeze({ sku: 'heineken-original-lata-473ml', quantity: 4, substitutions: Object.freeze([]) }),
      Object.freeze({ sku: 'red-bull-original-lata-250ml', quantity: 2, substitutions: Object.freeze([]) }),
    ]),
  }),
  Object.freeze({
    comboId: 'combo-cuatro-para-arrancar',
    name: 'Cuatro para arrancar',
    tagline: 'Speed por cuatro',
    description: 'Cuatro Speed Unlimited de 473 ml. Se puede cambiar por la versión Zero sin costo.',
    categoryId: 'energizantes',
    discountPercentage: 10,
    terms: 'Sin alcohol. No requiere validación de edad.',
    approvalStatus: 'PENDIENTE_APROBACION_COMERCIAL',
    previewOnly: true,
    components: Object.freeze([
      Object.freeze({
        sku: 'speed-original-lata-473ml',
        quantity: 4,
        substitutions: Object.freeze(['speed-zero-lata-473ml']),
      }),
    ]),
  }),
]);
