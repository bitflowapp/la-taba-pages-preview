/*
 * ¿CUÁNTO AGUANTA LA GÓNDOLA?
 *
 * TABA se construyó y se midió con decenas de SKU. La tienda 24/7 multi-rubro
 * llega a cientos, y «va a andar» no es una respuesta: hay que medir antes de
 * optimizar, y hay que optimizar sólo lo que la medición señale.
 *
 * QUÉ MIDE
 * --------
 * Las cinco operaciones que un cliente hace en los primeros veinte segundos, y
 * que son las únicas que crecen con el tamaño del catálogo:
 *
 *   catalogo        · normalizar el catálogo entero y aplicar el modelo
 *                     minorista. Es lo que corre una sola vez al recibir la
 *                     respuesta del backend, y es donde vive el único algoritmo
 *                     cuadrático conocido.
 *   home            · armar las secciones de la home.
 *   busqueda        · una consulta de dos términos contra el catálogo entero.
 *   categoria       · cambiar de categoría (filtrar y ordenar).
 *   tarjetas        · el HTML de la grilla, medido en nodos y en bytes. No se
 *                     puede renderizar sin navegador; lo que sí se puede es
 *                     contar cuántos nodos pediría, que es la magnitud que
 *                     decide si hace falta paginar.
 *
 * QUÉ NO MIDE
 * -----------
 * No mide el navegador. Esto es Node: no hay layout, ni pintado, ni memoria de
 * GPU. Sirve para encontrar un algoritmo que crece mal —que es lo que se
 * encontró— y no para afirmar una experiencia. Cualquier afirmación sobre la
 * pantalla necesita el E2E.
 *
 * Uso:
 *   node scripts/benchmark-catalog-scale.mjs                 100, 500 y 1000
 *   node scripts/benchmark-catalog-scale.mjs --sizes 100,2000
 *   node scripts/benchmark-catalog-scale.mjs --json          para diffear
 *   node scripts/benchmark-catalog-scale.mjs --out artifacts/x.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { STORE_CATEGORIES } from '../js/core/store-taxonomy.js';
import { mergeCatalogProducts, normalizeCatalogProduct } from '../js/core/catalog-store.js';
import { buildBeverageHomeSections } from '../js/core/beverage-home-sections.js';
import { productMatchesQuery } from '../js/core/catalog-search.js';
import { isCommerciallyPurchasable } from '../js/core/pricing.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_SIZES = Object.freeze([100, 500, 1000]);

const MARCAS = ['Coca-Cola', 'Quilmes', 'Ayudín', 'Magistral', 'Sedal', 'Elite', 'Oreo', 'Playadito', 'Dogui', 'Villavicencio'];
const SUBRUBROS = ['lavandina', 'detergente', 'shampoo', 'papel higienico', 'galletitas', 'yerba', 'cola', 'sin gas', 'alimento para perro', 'jabon'];
const CAPACIDADES = [354, 473, 500, 750, 1000, 1500, 2250];
const CATEGORIAS = STORE_CATEGORIES.map((categoria) => categoria.id);

/**
 * Un catálogo sintético del tamaño pedido.
 *
 * NO ES UN CATÁLOGO COMERCIAL: ningún nombre, precio ni stock de acá describe
 * un producto real, y este archivo no escribe en ninguna base. Es una carga de
 * la forma que tendría un catálogo multi-rubro grande —marcas repetidas,
 * capacidades repetidas, packs junto a unidades— porque esa forma es la que hace
 * trabajar a los algoritmos que se están midiendo. Un catálogo con todos los
 * campos distintos no mediría nada.
 */
export function buildSyntheticCatalog(size) {
  const productos = [];
  for (let index = 0; index < size; index += 1) {
    // Una FAMILIA de ocho artículos comparte marca y categoría, como una marca
    // real comparte estante. Dentro de la familia cada uno tiene su papel, y los
    // papeles son los que hacen trabajar a los dos algoritmos que se miden.
    const familia = Math.floor(index / 8);
    const papel = index % 8;
    const categoryId = CATEGORIAS[familia % CATEGORIAS.length];
    const brand = MARCAS[familia % MARCAS.length];

    // Papeles 6 y 7 son la pareja unidad/pack: comparten una capacidad propia de
    // la familia, así que el pack tiene EXACTAMENTE una unidad candidata y el
    // vínculo se produce. Es la forma que tiene una góndola de verdad —el bulto
    // con el que el local se surte, al lado de la unidad que vende— y es la
    // única que ejercita el camino caro de `linkProcurementPacks`.
    const esParejaDeAbastecimiento = papel >= 6;
    const esPack = papel === 7;
    const capacityValue = esParejaDeAbastecimiento
      ? 300 + familia
      : CAPACIDADES[(familia + papel) % CAPACIDADES.length];

    // Papeles 0 y 1 comparten marca, categoría y NOMBRE, y difieren en variante
    // y subcategoría: es la colisión que obliga a desambiguar el nombre corto.
    const comparteNombre = papel <= 1;
    const nombre = comparteNombre
      ? `${brand} Clásico`
      : `${brand} ${papel === 7 ? 'Clásico' : `Línea ${papel}`}`;

    const pricePending = index % 11 === 0;
    productos.push({
      id: `bench-${categoryId}-${index}`,
      sku: `bench-${categoryId}-${index}`,
      externalId: `bench-${index}`,
      brand,
      name: nombre,
      variant: `Variante ${papel}`,
      categoryId,
      subcategory: SUBRUBROS[(familia + papel) % SUBRUBROS.length],
      description: `Producto sintético ${index} para medir escala.`,
      capacityValue,
      capacityUnit: 'ml',
      packageType: esPack ? 'caja' : 'botella-pet',
      unit: esPack ? 'pack' : 'unidad',
      unitLabel: esPack ? 'Pack x6' : 'Unidad',
      unitsPerPack: esPack ? 6 : 1,
      price: pricePending ? null : 1000 + (index % 90) * 25,
      pricePending,
      stock: index % 13 === 0 ? 0 : 5 + (index % 20),
      available: index % 17 !== 0,
      sortOrder: index % 50,
      tags: index % 9 === 0 ? [`recomendado-${(index % 12) + 1}`] : [],
      popular: index % 23 === 0,
      combo: index % 31 === 0,
      image: `assets/catalog/bench/${index}.webp`,
    });
  }
  return productos;
}

/** Mediana de `runs` corridas, en milisegundos. Una sola corrida mide el ruido. */
function medir(runs, fn) {
  const muestras = [];
  for (let index = 0; index < runs; index += 1) {
    const desde = performance.now();
    fn();
    muestras.push(performance.now() - desde);
  }
  muestras.sort((left, right) => left - right);
  return Number(muestras[Math.floor(muestras.length / 2)].toFixed(3));
}

/**
 * Los nodos que pediría la grilla del catálogo.
 *
 * `renderProducts` dibuja TODOS los productos filtrados de una vez, sin paginar.
 * No se puede medir el DOM desde Node, pero sí la magnitud que lo determina: una
 * tarjeta de producto es del orden de veinte elementos, así que el conteo dice
 * con qué orden de nodos se encuentra el navegador al abrir «Todas».
 */
const NODOS_POR_TARJETA = 20;

export function measureCatalogScale(size, { runs = 5 } = {}) {
  const crudos = buildSyntheticCatalog(size);

  const normalizacion = medir(runs, () => mergeCatalogProducts(crudos, []));
  const catalogo = mergeCatalogProducts(crudos, []);

  const home = medir(runs, () => buildBeverageHomeSections(catalogo, []));
  const busqueda = medir(runs, () => catalogo.filter((product) => productMatchesQuery(product, 'coca original')));
  const categoria = medir(runs, () => catalogo
    .filter((product) => product.categoryId === 'limpieza')
    .sort((left, right) => Number(right.stock) - Number(left.stock)));

  const comprables = catalogo.filter(isCommerciallyPurchasable).length;
  const secciones = buildBeverageHomeSections(catalogo, []).filter((section) => !section.hidden);

  return {
    size,
    productos: catalogo.length,
    comprables,
    seccionesVisibles: secciones.length,
    nodosGrillaCompleta: catalogo.length * NODOS_POR_TARJETA,
    ms: {
      catalogo: normalizacion,
      home,
      busqueda,
      categoria,
    },
  };
}

export function runBenchmark(sizes = DEFAULT_SIZES, options = {}) {
  return {
    generado: new Date().toISOString(),
    node: process.version,
    nodosPorTarjeta: NODOS_POR_TARJETA,
    medidas: sizes.map((size) => measureCatalogScale(size, options)),
  };
}

function parseArgs(args) {
  const sizesIndex = args.indexOf('--sizes');
  const sizes = sizesIndex >= 0
    ? String(args[sizesIndex + 1] || '').split(',').map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value > 0)
    : [...DEFAULT_SIZES];
  if (!sizes.length) throw new Error('--sizes espera una lista de enteros positivos separados por coma.');
  const outIndex = args.indexOf('--out');
  return { sizes, json: args.includes('--json'), out: outIndex >= 0 ? args[outIndex + 1] : '' };
}

function render(report) {
  const filas = report.medidas.map((medida) => [
    String(medida.size).padStart(5),
    `${medida.ms.catalogo}`.padStart(9),
    `${medida.ms.home}`.padStart(8),
    `${medida.ms.busqueda}`.padStart(9),
    `${medida.ms.categoria}`.padStart(10),
    String(medida.comprables).padStart(10),
    String(medida.nodosGrillaCompleta).padStart(8),
  ].join(' '));
  return [
    '',
    '  SKU   catálogo     home  búsqueda  categoría  comprables    nodos',
    '  ---------------------------------------------------------------------',
    ...filas.map((fila) => `  ${fila}`),
    '',
    '  Milisegundos (mediana). «nodos» es el orden de elementos que pediría la',
    '  grilla completa sin paginar, a razón de ~20 por tarjeta.',
    '',
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const { sizes, json, out } = parseArgs(process.argv.slice(2));
  const report = runBenchmark(sizes);
  if (json) console.log(JSON.stringify(report, null, 2));
  else console.log(render(report));
  if (out) {
    const destino = path.resolve(ROOT, out);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`  Escrito en ${path.relative(ROOT, destino)}`);
  }
}

// Referencia no usada en el flujo principal, exportada para que un ensayo pueda
// construir un producto normalizado con la misma forma que el resto del catálogo.
export { normalizeCatalogProduct };
