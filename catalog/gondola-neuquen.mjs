/*
 * GÓNDOLA COMERCIAL DE TABA · NEUQUÉN CAPITAL · primera ola
 * =========================================================
 *
 * Este archivo es la AUTORIDAD del surtido inicial: qué se publica, con qué
 * datos comerciales y de dónde salió cada número. No se edita a ojo: cada fila
 * declara su costo de reposición medido y el precio se DERIVA de él, así que
 * el criterio es ejecutable y no una afirmación de un informe.
 *
 * ─── DE DÓNDE SALE EL SURTIDO ────────────────────────────────────────────────
 *
 * Tres fuentes cruzadas, en este orden:
 *
 *  1. La autoridad del propio repositorio (`catalog/products.json`, 92 fichas
 *     curadas el 2026-08-02 contra una cadena comercial). Aporta identidad:
 *     marca, nombre, variedad, capacidad y envase ya revisados.
 *  2. El ranking nacional de rotación: Coca-Cola es la marca más elegida de la
 *     Argentina por cuarto año (Kantar Brand Footprint); en cerveza el orden es
 *     Quilmes, Brahma, Heineken, Schneider, Corona, Stella Artois, Budweiser,
 *     Imperial, Patagonia, Andes Origen.
 *  3. La corrección regional para Neuquén: Patagonia (elaborada en Bariloche) y
 *     Andes Origen pesan acá mucho más que su puesto nacional, y entran por eso.
 *
 * ─── QUÉ SE DEJÓ AFUERA, Y POR QUÉ ───────────────────────────────────────────
 *
 *  · Heineken y Schneider — están en el top 10 nacional y NO están acá. No es
 *    un olvido: el mayorista no tenía ninguno de los dos en stock el día de la
 *    medición, así que no hay costo real y el precio saldría de la nada. Entran
 *    en la segunda ola con su costo medido.
 *  · Whisky — rota en mostrador, no en delivery de bebidas. Un SKU de whisky
 *    inmoviliza el capital de seis cervezas. Fuera de la primera ola.
 *  · Cerveza sin alcohol (Quilmes 0.0, Corona 0.0) — el contrato de la base
 *    exige `is_alcoholic = true` para toda la categoría `Cervezas`, así que
 *    publicarlas implicaría marcarlas +18, que es falso. Se resuelve con una
 *    subcategoría propia, no forzando el dato.
 *  · Jugos y sidras — no justifican rotación para arrancar.
 *  · Hielo — no es una bebida y no había costo medido. Alta rotación asociada
 *    al alcohol: es la primera candidata de la segunda ola.
 *  · Espumantes — categoría declarada y sin SKU: es estacional y de ticket
 *    alto, no de primera ola.
 *
 * ─── EL PRECIO ───────────────────────────────────────────────────────────────
 *
 * Ningún precio está escrito a mano. Cada fila trae `costoMayorista`, que es
 * un número REAL observado, y el precio sale de aplicarle el criterio de abajo.
 * Si mañana cambia el costo, se corrige el costo y el precio se recalcula solo.
 *
 * Estos son PRECIOS INICIALES DE OPERACIÓN. Son coherentes entre sí y con el
 * mercado, y están para que el comercio abra vendiendo; el dueño los ajusta
 * desde el Panel cuando quiera, producto por producto.
 */

/**
 * Criterio de precio, medido y contrastado el 2026-08-18.
 *
 * BASE · costo de reposición mayorista real (precio unitario por bulto cerrado,
 * Maxiconsumo). Es el número que un comercio paga de verdad por la unidad.
 *
 * MARGEN · 1,45 sobre ese costo para la venta por unidad. No es un número
 * elegido: es el que se desprende de contrastar el mismo producto en las dos
 * puntas el mismo día.
 *
 *     producto                mayorista    minorista    razón
 *     Coca-Cola 2,25 L        $4.049,50    $5.800       1,43
 *     Quilmes lata 473        $1.404,88    $1.900       1,35
 *     Budweiser lata 710      $2.396,61    $3.300       1,38
 *     Pepsi 2 L               $2.603,22    $4.550       1,75
 *                                                       ────
 *                                          promedio     1,48
 *
 * 1,45 queda POR DEBAJO del promedio observado y por encima del piso: es un
 * precio de góndola creíble, no un precio inflado por ser delivery. Neuquén
 * además carga flete patagónico, así que el margen es conservador.
 *
 * PACK · 1,35 en vez de 1,45. Un pack tiene que costar menos por unidad que la
 * unidad suelta o no es un pack: es la única razón por la que alguien lo lleva.
 *
 * REDONDEO · al múltiplo de $50 hacia arriba. Un precio de góndola termina en
 * cero; $2.037 no existe en ningún local.
 */
export const CRITERIO_PRECIO = Object.freeze({
  medidoEl: '2026-08-18',
  fuenteCosto: 'Maxiconsumo · precio unitario por bulto cerrado · sucursal Cátan',
  fuenteContraste: 'Supermercados DIA online · precio minorista de góndola',
  margenUnidad: 1.45,
  margenPack: 1.35,
  redondeoA: 50,
  naturaleza: 'precios iniciales de operación, ajustables por el comercio desde el Panel',
});

/** Precio de venta a partir del costo de reposición. Redondea hacia arriba. */
export function precioDeVenta({ costoMayorista, unitsPerPack = 1, soldAsPack = false }) {
  const unidades = soldAsPack ? Math.max(1, Math.floor(unitsPerPack)) : 1;
  const margen = soldAsPack ? CRITERIO_PRECIO.margenPack : CRITERIO_PRECIO.margenUnidad;
  const bruto = Number(costoMayorista) * unidades * margen;
  const paso = CRITERIO_PRECIO.redondeoA;
  return Math.ceil(bruto / paso) * paso;
}

// Cómo se lee cada fila:
//
//   costoMayorista  el número observado, sin tocar. Con `derivado`, de dónde sale.
//   stock           tramo de rotación: 24 alta · 12 media · 6 ticket alto · 4 pack.
//   chilled         si el local lo tiene en frío. Una lata sí; un vino no.
//   tags            los que la vitrina lee: «más vendido» marca los de arriba.
//
// `presentation` NO se escribe: la base exige `presentation = variant` y el
// importador lo copia. `capacity` tampoco: se arma con capacidad y unidad.

const NO_ALCOHOLICAS = [
  // ── Gaseosas ───────────────────────────────────────────────────────────────
  { sku: 'coca-cola-original-2250ml', brand: 'Coca-Cola', name: 'Coca-Cola', variant: 'Original', category: 'Gaseosas', subcategory: 'cola', capacityValue: 2250, packagingType: 'botella-pet', costoMayorista: 4049.50, stock: 24, chilled: false, tags: ['gaseosa', 'cola', 'más vendido'] },
  { sku: 'coca-cola-zero-2250ml', brand: 'Coca-Cola', name: 'Coca-Cola Zero', variant: 'Sin azúcar', category: 'Gaseosas', subcategory: 'cola-sin-azucar', capacityValue: 2250, packagingType: 'botella-pet', costoMayorista: 4049.50, stock: 24, chilled: false, tags: ['gaseosa', 'cola', 'sin-azucar', 'más vendido'] },
  { sku: 'coca-cola-original-lata-354ml', brand: 'Coca-Cola', name: 'Coca-Cola', variant: 'Original', category: 'Gaseosas', subcategory: 'cola', capacityValue: 354, packagingType: 'lata', costoMayorista: 1214.79, stock: 24, chilled: true, tags: ['gaseosa', 'cola', 'lata'] },
  { sku: 'coca-cola-zero-lata-354ml', brand: 'Coca-Cola', name: 'Coca-Cola Zero', variant: 'Sin azúcar', category: 'Gaseosas', subcategory: 'cola-sin-azucar', capacityValue: 354, packagingType: 'lata', costoMayorista: 1214.79, stock: 24, chilled: true, tags: ['gaseosa', 'cola', 'sin-azucar', 'lata'] },
  { sku: 'sprite-original-2250ml', brand: 'Sprite', name: 'Sprite', variant: 'Original', category: 'Gaseosas', subcategory: 'lima-limon', capacityValue: 2250, packagingType: 'botella-pet', costoMayorista: 4049.51, stock: 24, chilled: false, tags: ['gaseosa', 'lima-limon'] },
  { sku: 'sprite-zero-2250ml', brand: 'Sprite', name: 'Sprite Zero', variant: 'Sin azúcar', category: 'Gaseosas', subcategory: 'lima-limon-sin-azucar', capacityValue: 2250, packagingType: 'botella-pet', costoMayorista: 4049.50, stock: 12, chilled: false, tags: ['gaseosa', 'lima-limon', 'sin-azucar'], derivado: 'Sin stock en el mayorista el día de la medición. Se toma el costo de Sprite Original 2250 ml porque en esta línea la versión sin azúcar cotiza IDÉNTICA a la regular: medido el mismo día en Coca-Cola 2,25 L ($4.049,50 = $4.049,50), 1,75 L ($2.892,48 = $2.892,48) y 1,25 L ($2.231,32 = $2.231,32).' },
  { sku: 'sprite-original-lata-354ml', brand: 'Sprite', name: 'Sprite', variant: 'Original', category: 'Gaseosas', subcategory: 'lima-limon', capacityValue: 354, packagingType: 'lata', costoMayorista: 1214.79, stock: 24, chilled: true, tags: ['gaseosa', 'lima-limon', 'lata'] },
  { sku: 'fanta-naranja-2250ml', brand: 'Fanta', name: 'Fanta Naranja', variant: 'Naranja', category: 'Gaseosas', subcategory: 'naranja', capacityValue: 2250, packagingType: 'botella-pet', costoMayorista: 4049.50, stock: 24, chilled: false, tags: ['gaseosa', 'naranja'] },
  { sku: 'pepsi-original-2000ml', brand: 'Pepsi', name: 'Pepsi', variant: 'Original', category: 'Gaseosas', subcategory: 'cola', capacityValue: 2000, packagingType: 'botella-pet', costoMayorista: 2603.22, stock: 24, chilled: false, tags: ['gaseosa', 'cola'] },
  { sku: 'pepsi-black-1500ml', brand: 'Pepsi', name: 'Pepsi Black', variant: 'Sin azúcar', category: 'Gaseosas', subcategory: 'cola-sin-azucar', capacityValue: 1500, packagingType: 'botella-pet', costoMayorista: 1818.11, stock: 12, chilled: false, tags: ['gaseosa', 'cola', 'sin-azucar'] },
  { sku: 'seven-up-original-2000ml', brand: '7UP', name: '7UP', variant: 'Original', category: 'Gaseosas', subcategory: 'lima-limon', capacityValue: 2000, packagingType: 'botella-pet', costoMayorista: 2603.22, stock: 12, chilled: false, tags: ['gaseosa', 'lima-limon'] },

  // ── Mixers ─────────────────────────────────────────────────────────────────
  { sku: 'paso-de-los-toros-tonica-1500ml', brand: 'Paso de los Toros', name: 'Paso de los Toros Tónica', variant: 'Tónica', category: 'Mixers', subcategory: 'tonica', capacityValue: 1500, packagingType: 'botella-pet', costoMayorista: 2231.32, stock: 24, chilled: false, tags: ['mixer', 'tonica', 'más vendido'] },
  { sku: 'paso-de-los-toros-pomelo-1500ml', brand: 'Paso de los Toros', name: 'Paso de los Toros Pomelo', variant: 'Pomelo', category: 'Mixers', subcategory: 'pomelo', capacityValue: 1500, packagingType: 'botella-pet', costoMayorista: 2231.32, stock: 12, chilled: false, tags: ['mixer', 'pomelo'] },
  { sku: 'soda-manaos-sifon-2000ml', brand: 'Manaos', name: 'Soda Manaos', variant: 'Soda', category: 'Mixers', subcategory: 'soda', capacityValue: 2000, packagingType: 'sifon', costoMayorista: 1198.26, stock: 24, chilled: false, tags: ['mixer', 'soda'] },

  // ── Aguas ──────────────────────────────────────────────────────────────────
  { sku: 'villa-del-sur-sin-gas-600ml', brand: 'Villa del Sur', name: 'Villa del Sur', variant: 'Sin gas', category: 'Aguas', subcategory: 'sin-gas', capacityValue: 600, packagingType: 'botella-pet', costoMayorista: 1156.94, stock: 24, chilled: true, tags: ['agua', 'sin-gas', 'más vendido'] },
  { sku: 'villavicencio-sin-gas-1500ml', brand: 'Villavicencio', name: 'Villavicencio', variant: 'Sin gas', category: 'Aguas', subcategory: 'sin-gas', capacityValue: 1500, packagingType: 'botella-pet', costoMayorista: 1652.81, stock: 24, chilled: false, tags: ['agua', 'sin-gas'] },
  { sku: 'villavicencio-con-gas-500ml', brand: 'Villavicencio', name: 'Villavicencio', variant: 'Con gas', category: 'Aguas', subcategory: 'con-gas', capacityValue: 500, packagingType: 'botella-pet', costoMayorista: 1280.91, stock: 12, chilled: true, tags: ['agua', 'con-gas'], derivado: 'Sin stock en el mayorista el día de la medición. Se toma el costo de Villavicencio SIN gas 500 ml, misma marca y misma capacidad: en agua mineral la variante con gas comparte lista con la sin gas.' },
  { sku: 'benedictino-sin-gas-2250ml', brand: 'Benedictino', name: 'Benedictino', variant: 'Sin gas', category: 'Aguas', subcategory: 'sin-gas', capacityValue: 2250, packagingType: 'botella-pet', costoMayorista: 1528.84, stock: 12, chilled: false, tags: ['agua', 'sin-gas'] },

  // ── Aguas saborizadas ──────────────────────────────────────────────────────
  { sku: 'aquarius-pera-1500ml', brand: 'Aquarius', name: 'Aquarius Pera', variant: 'Pera', category: 'Aguas saborizadas', subcategory: 'pera', capacityValue: 1500, packagingType: 'botella-pet', costoMayorista: 1239.59, stock: 12, chilled: false, tags: ['agua-saborizada', 'pera'] },
  { sku: 'aquarius-manzana-1500ml', brand: 'Aquarius', name: 'Aquarius Manzana', variant: 'Manzana', category: 'Aguas saborizadas', subcategory: 'manzana', capacityValue: 1500, packagingType: 'botella-pet', costoMayorista: 1239.59, stock: 12, chilled: false, tags: ['agua-saborizada', 'manzana'] },
  { sku: 'aquarius-pomelo-2250ml', brand: 'Aquarius', name: 'Aquarius Pomelo', variant: 'Pomelo', category: 'Aguas saborizadas', subcategory: 'pomelo', capacityValue: 2250, packagingType: 'botella-pet', costoMayorista: 1818.10, stock: 12, chilled: false, tags: ['agua-saborizada', 'pomelo'] },

  // ── Energizantes ───────────────────────────────────────────────────────────
  { sku: 'red-bull-original-250ml', brand: 'Red Bull', name: 'Red Bull', variant: 'Original', category: 'Energizantes', subcategory: 'original', capacityValue: 250, packagingType: 'lata', costoMayorista: 1900.74, stock: 24, chilled: true, tags: ['energizante', 'más vendido'] },
  { sku: 'red-bull-sin-azucar-250ml', brand: 'Red Bull', name: 'Red Bull Sugarfree', variant: 'Sin azúcar', category: 'Energizantes', subcategory: 'sin-azucar', capacityValue: 250, packagingType: 'lata', costoMayorista: 1900.74, stock: 12, chilled: true, tags: ['energizante', 'sin-azucar'] },
  { sku: 'monster-green-zero-473ml', brand: 'Monster', name: 'Monster Green Zero', variant: 'Sin azúcar', category: 'Energizantes', subcategory: 'sin-azucar', capacityValue: 473, packagingType: 'lata', costoMayorista: 2231.32, stock: 12, chilled: true, tags: ['energizante', 'sin-azucar'] },
  { sku: 'speed-original-473ml', brand: 'Speed', name: 'Speed', variant: 'Original', category: 'Energizantes', subcategory: 'original', capacityValue: 473, packagingType: 'lata', costoMayorista: 1942.06, stock: 24, chilled: true, tags: ['energizante', 'más vendido'] },
  { sku: 'speed-zero-473ml', brand: 'Speed', name: 'Speed Zero', variant: 'Sin azúcar', category: 'Energizantes', subcategory: 'sin-azucar', capacityValue: 473, packagingType: 'lata', costoMayorista: 1942.06, stock: 12, chilled: true, tags: ['energizante', 'sin-azucar'] },

  // ── Isotónicas ─────────────────────────────────────────────────────────────
  { sku: 'gatorade-cool-blue-500ml', brand: 'Gatorade', name: 'Gatorade Cool Blue', variant: 'Cool Blue', category: 'Isotónicas', subcategory: 'cool-blue', capacityValue: 500, packagingType: 'botella-pet', costoMayorista: 1363.55, stock: 12, chilled: true, tags: ['isotonica'] },
  { sku: 'gatorade-manzana-1250ml', brand: 'Gatorade', name: 'Gatorade Manzana', variant: 'Manzana', category: 'Isotónicas', subcategory: 'manzana', capacityValue: 1250, packagingType: 'botella-pet', costoMayorista: 1818.10, stock: 12, chilled: false, tags: ['isotonica'] },
  { sku: 'powerade-mountain-blast-500ml', brand: 'Powerade', name: 'Powerade Mountain Blast', variant: 'Mountain Blast', category: 'Isotónicas', subcategory: 'mountain-blast', capacityValue: 500, packagingType: 'botella-pet', costoMayorista: 991.65, stock: 12, chilled: true, tags: ['isotonica'] },
];

const ALCOHOLICAS = [
  // ── Cervezas ───────────────────────────────────────────────────────────────
  { sku: 'quilmes-clasica-lata-473ml', brand: 'Quilmes', name: 'Quilmes Clásica', variant: 'Lager', category: 'Cervezas', subcategory: 'lager', capacityValue: 473, packagingType: 'lata', costoMayorista: 1404.88, stock: 24, chilled: true, tags: ['cerveza', 'lager', 'más vendido'] },
  { sku: 'quilmes-clasica-lata-473ml-pack-6', brand: 'Quilmes', name: 'Quilmes Clásica', variant: 'Lager', category: 'Cervezas', subcategory: 'lager', capacityValue: 473, packagingType: 'lata', unitsPerPack: 6, soldAsPack: true, costoMayorista: 1404.88, stock: 4, chilled: true, tags: ['cerveza', 'lager', 'pack', 'para-compartir'] },
  { sku: 'quilmes-clasica-botella-710ml', brand: 'Quilmes', name: 'Quilmes Clásica', variant: 'Lager', category: 'Cervezas', subcategory: 'lager', capacityValue: 710, packagingType: 'botella', costoMayorista: 2066.04, stock: 24, chilled: true, tags: ['cerveza', 'lager', 'porron-grande'] },
  { sku: 'quilmes-stout-lata-473ml', brand: 'Quilmes', name: 'Quilmes Stout', variant: 'Stout', category: 'Cervezas', subcategory: 'stout', capacityValue: 473, packagingType: 'lata', costoMayorista: 1404.88, stock: 12, chilled: true, tags: ['cerveza', 'stout'] },
  { sku: 'brahma-chopp-lata-710ml', brand: 'Brahma', name: 'Brahma Chopp', variant: 'Rubia', category: 'Cervezas', subcategory: 'rubia', capacityValue: 710, packagingType: 'lata', costoMayorista: 2066.03, stock: 24, chilled: true, tags: ['cerveza', 'rubia', 'más vendido'] },
  { sku: 'budweiser-lata-473ml', brand: 'Budweiser', name: 'Budweiser', variant: 'Lager', category: 'Cervezas', subcategory: 'lager', capacityValue: 473, packagingType: 'lata', costoMayorista: 1611.49, stock: 12, chilled: true, tags: ['cerveza', 'lager'] },
  { sku: 'stella-artois-lata-473ml', brand: 'Stella Artois', name: 'Stella Artois', variant: 'Lager', category: 'Cervezas', subcategory: 'lager', capacityValue: 473, packagingType: 'lata', costoMayorista: 2479.26, stock: 12, chilled: true, tags: ['cerveza', 'lager'] },
  { sku: 'corona-extra-botella-330ml', brand: 'Corona', name: 'Corona Extra', variant: 'Lager', category: 'Cervezas', subcategory: 'lager', capacityValue: 330, packagingType: 'botella', costoMayorista: 2313.97, stock: 12, chilled: true, tags: ['cerveza', 'lager', 'porron'] },
  { sku: 'andes-origen-rubia-lata-473ml', brand: 'Andes Origen', name: 'Andes Origen Rubia', variant: 'Rubia', category: 'Cervezas', subcategory: 'rubia', capacityValue: 473, packagingType: 'lata', costoMayorista: 1818.10, stock: 24, chilled: true, tags: ['cerveza', 'rubia', 'patagonia'] },
  { sku: 'andes-origen-roja-lata-473ml', brand: 'Andes Origen', name: 'Andes Origen Roja', variant: 'Roja', category: 'Cervezas', subcategory: 'roja', capacityValue: 473, packagingType: 'lata', costoMayorista: 1818.10, stock: 12, chilled: true, tags: ['cerveza', 'roja', 'patagonia'] },
  { sku: 'patagonia-amber-lager-botella-730ml', brand: 'Patagonia', name: 'Patagonia Amber Lager', variant: 'Amber Lager', category: 'Cervezas', subcategory: 'amber-lager', capacityValue: 730, packagingType: 'botella', costoMayorista: 3636.28, stock: 6, chilled: true, tags: ['cerveza', 'amber', 'patagonia', 'más vendido'] },

  // ── Fernet y amargos ───────────────────────────────────────────────────────
  { sku: 'fernet-branca-1000ml', brand: 'Fernet Branca', name: 'Fernet Branca', variant: 'Original', category: 'Fernet', subcategory: 'fernet', capacityValue: 1000, packagingType: 'botella', costoMayorista: 18099.09, stock: 6, chilled: false, tags: ['fernet', 'más vendido'] },
  { sku: 'fernet-1882-750ml', brand: '1882', name: 'Fernet 1882', variant: 'Original', category: 'Fernet', subcategory: 'fernet', capacityValue: 750, packagingType: 'botella', costoMayorista: 6168.87, stock: 6, chilled: false, tags: ['fernet'] },

  // ── Aperitivos ─────────────────────────────────────────────────────────────
  { sku: 'gancia-americano-450ml', brand: 'Gancia', name: 'Gancia Americano', variant: 'Americano', category: 'Aperitivos', subcategory: 'americano', capacityValue: 450, packagingType: 'botella', costoMayorista: 2975.12, stock: 12, chilled: false, tags: ['aperitivo', 'americano'] },
  { sku: 'gancia-lima-limon-lata-473ml', brand: 'Gancia', name: 'Gancia Lima Limón', variant: 'Lima limón', category: 'Aperitivos', subcategory: 'listo-para-tomar', capacityValue: 473, packagingType: 'lata', costoMayorista: 1735.45, stock: 12, chilled: true, tags: ['aperitivo', 'listo-para-tomar'] },
  { sku: 'dr-lemon-vodka-pomelo-lata-473ml', brand: 'Dr. Lemon', name: 'Dr. Lemon Vodka Pomelo', variant: 'Vodka pomelo', category: 'Aperitivos', subcategory: 'listo-para-tomar', capacityValue: 473, packagingType: 'lata', costoMayorista: 1487.53, stock: 12, chilled: true, tags: ['aperitivo', 'listo-para-tomar'] },

  // ── Vinos ──────────────────────────────────────────────────────────────────
  { sku: 'trapiche-origen-malbec-750ml', brand: 'Trapiche', name: 'Trapiche Origen Malbec', variant: 'Malbec', category: 'Vinos', subcategory: 'tinto', capacityValue: 750, packagingType: 'botella', costoMayorista: 4214.79, stock: 12, chilled: false, tags: ['vino', 'tinto', 'malbec', 'más vendido'] },
  { sku: 'dada-caramel-750ml', brand: 'Dada', name: 'Dada Caramel', variant: 'Caramel', category: 'Vinos', subcategory: 'tinto-dulce', capacityValue: 750, packagingType: 'botella', costoMayorista: 4049.50, stock: 12, chilled: false, tags: ['vino', 'tinto', 'dulce'] },
  { sku: 'cafayate-torrontes-750ml', brand: 'Cafayate', name: 'Cafayate Torrontés', variant: 'Torrontés', category: 'Vinos', subcategory: 'blanco', capacityValue: 750, packagingType: 'botella', costoMayorista: 3718.92, stock: 6, chilled: true, tags: ['vino', 'blanco', 'torrontes'] },
  { sku: 'toro-viejo-clasico-tinto-750ml', brand: 'Toro Viejo', name: 'Toro Viejo Clásico', variant: 'Tinto', category: 'Vinos', subcategory: 'tinto', capacityValue: 750, packagingType: 'botella', costoMayorista: 1735.45, stock: 24, chilled: false, tags: ['vino', 'tinto', 'más vendido'] },
  { sku: 'toro-tinto-1000ml', brand: 'Toro', name: 'Toro', variant: 'Tinto', category: 'Vinos', subcategory: 'tinto', capacityValue: 1000, packagingType: 'botella', costoMayorista: 1570.16, stock: 24, chilled: false, tags: ['vino', 'tinto'] },

  // ── Destilados ─────────────────────────────────────────────────────────────
  { sku: 'gin-gordons-700ml', brand: "Gordon's", name: "Gordon's London Dry", variant: 'London Dry', category: 'Destilados', subcategory: 'gin', capacityValue: 700, packagingType: 'botella', costoMayorista: 11570.15, stock: 6, chilled: false, tags: ['destilado', 'gin'] },
  { sku: 'vodka-skyy-700ml', brand: 'Skyy', name: 'Skyy Vodka', variant: 'Original', category: 'Destilados', subcategory: 'vodka', capacityValue: 700, packagingType: 'botella', costoMayorista: 6528.85, stock: 6, chilled: false, tags: ['destilado', 'vodka'] },
];

/** Categorías con alcohol, idénticas a `ALCOHOLIC_CATEGORY_IDS` del cliente. */
export const CATEGORIAS_CON_ALCOHOL = Object.freeze([
  'Cervezas', 'Fernet', 'Aperitivos', 'Vinos', 'Espumantes', 'Destilados',
]);

const ETIQUETA_ENVASE = Object.freeze({
  'botella-pet': 'botella PET',
  'botella-retornable': 'botella retornable',
  botella: 'botella',
  lata: 'lata',
  sifon: 'sifón',
  bolsa: 'bolsa',
});

/** "2250 ml" se lee "2,25 L" cuando pasa el litro. Sólo para la descripción. */
function capacidadLegible(ml) {
  if (ml >= 1000) return `${String(Number((ml / 1000).toFixed(2))).replace('.', ',')} L`;
  return `${ml} ml`;
}

/**
 * Descripción factual: qué es, en qué viene y cuánto trae. Nada de adjetivos
 * de venta —no los podemos afirmar— y nada de placeholders.
 */
function descripcionDe(fila) {
  const envase = ETIQUETA_ENVASE[fila.packagingType] || 'envase';
  const capacidad = capacidadLegible(fila.capacityValue);
  if (fila.soldAsPack) {
    return `Pack de ${fila.unitsPerPack} unidades de ${fila.name} en ${envase} de ${capacidad}.`;
  }
  return `${fila.name} en ${envase} de ${capacidad}.`;
}

/**
 * La góndola completa, normalizada y lista para cargar.
 *
 * Cada fila sale con el contrato de la base ya resuelto: `presentation` copia
 * `variant`, `capacity` se arma con la capacidad y su unidad, el precio se
 * deriva del costo y la edad mínima aparece si y sólo si hay alcohol.
 */
export const GONDOLA = Object.freeze(
  [...NO_ALCOHOLICAS, ...ALCOHOLICAS].map((fila, indice) => {
    const alcoholic = CATEGORIAS_CON_ALCOHOL.includes(fila.category);
    const unitsPerPack = fila.unitsPerPack ?? 1;
    const soldAsPack = fila.soldAsPack === true;
    return Object.freeze({
      externalId: fila.sku,
      sku: fila.sku,
      brand: fila.brand,
      name: fila.name,
      description: descripcionDe({ ...fila, unitsPerPack, soldAsPack }),
      category: fila.category,
      subcategory: fila.subcategory,
      variant: fila.variant,
      presentation: fila.variant,
      capacityValue: fila.capacityValue,
      capacityUnit: 'ml',
      capacity: `${fila.capacityValue} ml`,
      packagingType: fila.packagingType,
      unitsPerPack,
      soldAsPack,
      costoMayorista: fila.costoMayorista,
      derivado: fila.derivado ?? null,
      price: precioDeVenta({ costoMayorista: fila.costoMayorista, unitsPerPack, soldAsPack }),
      stock: fila.stock,
      chilled: fila.chilled === true,
      alcoholic,
      minimumAge: alcoholic ? 18 : null,
      tags: Object.freeze([...fila.tags].sort()),
      sortOrder: (indice + 1) * 10,
    });
  }),
);
