/*
 * PROMOCIONES DE ALCOHOL · combos armados sobre el catálogo REAL de TABA
 * ======================================================================
 *
 * Acá no hay ni un número de dinero, igual que en `js/combos-data.js`: un combo
 * declara QUÉ trae y CUÁNTO descuenta, y el precio lo deriva el catálogo vivo.
 * Lo que sí vive acá es la razón comercial de cada uno y la ocasión de consumo,
 * que es lo que decide si alguien lo compra.
 *
 * ─── LA REGLA DEL DESCUENTO, Y POR QUÉ NO LA ELIGIÓ NADIE ────────────────────
 *
 * El catálogo entero de TABA deriva su precio de un costo mayorista MEDIDO:
 * ×1,45 para la unidad suelta y ×1,35 para el pack, porque «un pack tiene que
 * costar menos por unidad que la unidad suelta o no es un pack»
 * (`catalog/gondola-neuquen.mjs`). Un combo es exactamente eso: un pack armado
 * con productos distintos. Así que su piso es el mismo, **×1,35 sobre la suma
 * de los costos**, y el descuento máximo de cada combo es el que lo deja justo
 * ahí. No es un número elegido para que la tarjeta se vea bien: es el que se
 * desprende del criterio que ya rige la góndola.
 *
 * La consecuencia hay que decirla, porque es incómoda y es cierta: con margen
 * base 1,45, el techo real de descuento de estos combos está entre **6 % y 7 %**.
 * Un «30 % OFF» en esta góndola sería vender por debajo del piso de pack, o
 * mentir sobre el precio de lista. `scripts/alcohol/verificar-promos-alcohol.mjs`
 * calcula el techo de cada combo y falla si el declarado lo pasa.
 *
 * ─── QUÉ COMPONENTES SE ADMITEN ─────────────────────────────────────────────
 *
 * Sólo SKU con COSTO MAYORISTA MEDIDO. Los cuatro packs de cerveza
 * (`*-pack-6`) derivan su precio de una referencia MINORISTA, no de un costo:
 * su margen no se puede calcular, así que no pueden entrar a un combo sin
 * inventar el dato que justificaría el descuento. Además ya son un pack: meter
 * un pack adentro de un combo duplicaría la misma decisión de compra.
 *
 * ─── ESTADO ─────────────────────────────────────────────────────────────────
 *
 * Los seis nacen `PENDIENTE_APROBACION_COMERCIAL`, o sea INACTIVOS, y no es una
 * formalidad: `chargeable` exige `APROBADO_COMERCIAL`, y además los 27
 * alcohólicos están con `available = false` detrás de la compuerta de licencia,
 * así que hoy `resolveCombo` los devuelve bloqueados por sus componentes. Se
 * aprueban cuando el alcohol se pueda vender, no antes.
 */

/** El piso de margen de un combo, tomado del criterio de pack de la góndola. */
export const PISO_MARGEN_COMBO = 1.35;

/**
 * Los seis combos, con su razón comercial.
 *
 * `sustituciones` sólo lista SKU que valen EXACTAMENTE lo mismo: `resolveCombo`
 * descarta cualquier sustitución con otro precio, porque cambiar por algo más
 * caro sin cobrarlo o por algo más barato sin descontarlo son las dos formas de
 * romper la promesa.
 */
export const PROMOS_ALCOHOL = Object.freeze([
  Object.freeze({
    comboId: 'combo-fernet-y-coca',
    name: 'Fernet y Coca',
    tagline: 'El clásico, resuelto en un toque',
    description: 'Una botella de Fernet Branca de 1 litro y una Coca-Cola de 2,25 L. La gaseosa se puede cambiar por Coca-Cola Zero sin costo.',
    ocasion: 'previa',
    categoryId: 'fernet',
    razonComercial: 'Fernet es la tercera bebida alcohólica más vendida del país y Branca la marca líder por lejos. Fernet + Coca es el pedido de último momento por excelencia, y hoy el cliente tiene que armarlo a mano en dos categorías distintas.',
    terms: 'Requiere validación de mayoría de edad al recibir.',
    components: Object.freeze([
      Object.freeze({ sku: 'fernet-branca-1000ml', quantity: 1, substitutions: Object.freeze([]) }),
      Object.freeze({ sku: 'coca-cola-original-2250ml', quantity: 1, substitutions: Object.freeze(['coca-cola-zero-2250ml']) }),
    ]),
  }),
  Object.freeze({
    comboId: 'combo-gin-tonic',
    name: 'Gin Tonic en casa',
    tagline: 'La botella y la tónica, juntas',
    description: "Una botella de Gordon's London Dry de 700 ml y una Paso de los Toros Tónica de 1,5 L. La tónica se puede cambiar por Pomelo sin costo.",
    ocasion: 'juntada',
    categoryId: 'destilados',
    razonComercial: "Gordon's es el gin de precio accesible del catálogo y el que sostiene el gin-tonic de juntada. La tónica es el complemento obligado y ya está en góndola: el combo junta las dos mitades de una misma decisión.",
    terms: 'Requiere validación de mayoría de edad al recibir.',
    components: Object.freeze([
      Object.freeze({ sku: 'gin-gordons-700ml', quantity: 1, substitutions: Object.freeze([]) }),
      Object.freeze({ sku: 'paso-de-los-toros-tonica-1500ml', quantity: 1, substitutions: Object.freeze(['paso-de-los-toros-pomelo-1500ml']) }),
    ]),
  }),
  Object.freeze({
    comboId: 'combo-vodka-y-energia',
    name: 'Vodka y energía',
    tagline: 'Una botella y dos latas para la noche',
    description: 'Una botella de Skyy Vodka de 700 ml y dos Speed de 473 ml. El energizante se puede cambiar por Speed Zero sin costo.',
    ocasion: 'previa',
    categoryId: 'destilados',
    razonComercial: 'Vodka con energizante es la combinación de mayor rotación nocturna del canal, y las dos partes ya existen en el catálogo con costo medido.',
    terms: 'Requiere validación de mayoría de edad al recibir. Tomar con moderación.',
    components: Object.freeze([
      Object.freeze({ sku: 'vodka-skyy-700ml', quantity: 1, substitutions: Object.freeze([]) }),
      Object.freeze({ sku: 'speed-original-473ml', quantity: 2, substitutions: Object.freeze(['speed-zero-473ml']) }),
    ]),
  }),
  Object.freeze({
    comboId: 'combo-previa-rubia-x6',
    name: 'Previa surtida x6',
    tagline: 'Seis latas, tres cervecerías',
    description: 'Dos Quilmes Clásica, dos Andes Origen Rubia y dos Budweiser, todas en lata de 473 ml. Cada par se puede cambiar por su hermana del mismo precio.',
    ocasion: 'previa',
    categoryId: 'cervezas',
    razonComercial: 'Los packs de seis que ya existen son de UNA marca. Este resuelve la otra mitad del problema —una mesa donde no todos toman lo mismo— sin duplicar ningún SKU de pack.',
    terms: 'Requiere validación de mayoría de edad al recibir.',
    components: Object.freeze([
      Object.freeze({ sku: 'quilmes-clasica-lata-473ml', quantity: 2, substitutions: Object.freeze(['quilmes-stout-lata-473ml']) }),
      Object.freeze({ sku: 'andes-origen-rubia-lata-473ml', quantity: 2, substitutions: Object.freeze(['andes-origen-roja-lata-473ml']) }),
      Object.freeze({ sku: 'budweiser-lata-473ml', quantity: 2, substitutions: Object.freeze([]) }),
    ]),
  }),
  Object.freeze({
    comboId: 'combo-asado-tinto',
    name: 'Asado con tinto',
    tagline: 'Dos botellas y el sifón',
    description: 'Dos botellas de Toro Viejo Clásico Tinto de 750 ml y un sifón de soda Manaos de 2 litros.',
    ocasion: 'asado',
    categoryId: 'vinos',
    razonComercial: 'Tinto de mesa con soda es el consumo de asado del Alto Valle. Toro Viejo es el tinto de mayor rotación del catálogo y la soda ya está en Mixers.',
    terms: 'Requiere validación de mayoría de edad al recibir.',
    components: Object.freeze([
      Object.freeze({ sku: 'toro-viejo-clasico-tinto-750ml', quantity: 2, substitutions: Object.freeze([]) }),
      Object.freeze({ sku: 'soda-manaos-sifon-2000ml', quantity: 1, substitutions: Object.freeze([]) }),
    ]),
  }),
  Object.freeze({
    comboId: 'combo-tinto-y-blanco',
    name: 'Tinto y blanco',
    tagline: 'Una de cada una para la mesa',
    description: 'Una botella de Trapiche Origen Malbec de 750 ml y una de Cafayate Torrontés de 750 ml.',
    ocasion: 'juntada',
    categoryId: 'vinos',
    razonComercial: 'Una mesa larga pide las dos. Son las dos etiquetas del catálogo con packshot de origen y cubren tinto y blanco sin obligar a elegir.',
    terms: 'Requiere validación de mayoría de edad al recibir.',
    components: Object.freeze([
      Object.freeze({ sku: 'trapiche-origen-malbec-750ml', quantity: 1, substitutions: Object.freeze([]) }),
      Object.freeze({ sku: 'cafayate-torrontes-750ml', quantity: 1, substitutions: Object.freeze([]) }),
    ]),
  }),
]);

/**
 * El descuento declarado de cada combo.
 *
 * Se escribe acá y NO adentro de la definición a propósito: es la única cifra
 * que un humano decide, y tiene que poder mirarse sola contra el techo que
 * calcula el verificador. Cada uno es el entero más alto que deja el precio
 * promocional en el piso de pack o por encima.
 */
export const DESCUENTOS_DECLARADOS = Object.freeze({
  'combo-fernet-y-coca': 6,
  'combo-gin-tonic': 6,
  'combo-vodka-y-energia': 7,
  'combo-previa-rubia-x6': 7,
  'combo-asado-tinto': 6,
  'combo-tinto-y-blanco': 6,
});
