/*
 * Los 72 SKU del catálogo productivo, en una sola lista y con su procedencia.
 *
 * De dónde sale cada cosa, y por qué:
 *
 *   52  de `catalog/gondola-neuquen.mjs` — la góndola de Neuquén, el archivo
 *       que generó el lote SQL que la insertó. Sus 23 alcohólicos siguen
 *       cerrados por la compuerta de licencia y RLS no los devuelve.
 *    4  de `scripts/catalog-images/lote-objetivo.mjs` — los packs de
 *       lanzamiento, los únicos cuatro con packshot oficial publicado.
 *    4  de `catalog/retail-unidades.mjs` — unidades minoristas no alcohólicas.
 *   12  de `catalog/gondola-retail-final-proposal.mjs` — la góndola final,
 *       aplicada a producción el 2026-08-21 (60 → 72).
 *
 * Y encima de esas cuatro autoridades,
 * `catalog/production-catalog-snapshot.json` — lo que la clave publicable ve
 * HOY en producción. No agrega SKU: pisa los de las autoridades con el dato
 * fuerte (precio, disponibilidad, foto asociada) de los que hoy están abiertos.
 *
 * POR QUÉ SE RECONCILIA POR IDENTIDAD Y NO POR CONTEO
 * ---------------------------------------------------
 * Las autoridades declaran QUÉ productos existen; `available` dice cuáles se
 * pueden comprar hoy, y eso se mueve con el inventario. La reconciliación
 * anterior contaba baldes —«los visibles que la góndola no nombra son los 4
 * packs», «las altas agregadas tienen que ser 12»— y por lo tanto le pedía a
 * cada balde un tamaño fijo. El 2026-08-23 entró en góndola una de las 12 altas
 * (`coca-cola-original-pet-1500ml`, recibida) y se cerró un pack por falta de
 * stock: los baldes cambiaron de tamaño sin que ningún SKU naciera ni muriera, y
 * el pipeline de imágenes entero se plantó por un movimiento de inventario.
 *
 * Ahora se comprueban dos hechos que sí son sobre IDENTIDAD, y que siguen
 * plantando el proceso cuando algo de verdad cambió:
 *
 *   1. el universo declarado son 72 SKU distintos, sin colisiones entre
 *      autoridades;
 *   2. cada SKU que producción muestra está declarado por alguna autoridad.
 *      Un SKU visible que nadie declara es catálogo que apareció sin pasar por
 *      un lote, y ahí sí hay que mirar antes de auditar nada.
 *
 * `gondolaFinal: false` devuelve la autoridad de 60 anterior al lote: la usan
 * los tests de la propuesta (que afirman cosas SOBRE esa base) y los
 * aplicadores del lote, que toman el snapshot de los 60 previos. En ese modo los
 * visibles que pertenecen al lote ya aplicado se descartan, porque reconstruir
 * la base previa es justamente devolver el catálogo SIN esas altas.
 */
import fs from 'node:fs';
import path from 'node:path';
import { OBJETIVOS } from './lote-objetivo.mjs';

const ORIGEN_PRODUCCION = 'produccion';
const ORIGEN_GONDOLA = 'gondola-neuquen';
const ORIGEN_RETAIL_UNIDADES = 'retail-unidades';
const ORIGEN_GONDOLA_FINAL = 'gondola-retail-final';
const ORIGEN_PACK_LANZAMIENTO = 'pack-lanzamiento';

function desdeFotografia(producto) {
  return {
    alcoholic: producto.isAlcoholic === true,
    available: producto.available === true,
    brand: producto.brand,
    capacityUnit: producto.capacityUnit,
    capacityValue: producto.capacityValue,
    catalogAssetId: producto.catalogAssetId,
    category: producto.category,
    externalId: producto.externalId,
    imageUrl: producto.imageUrl,
    name: producto.name,
    origen: ORIGEN_PRODUCCION,
    packagingType: producto.packagingType,
    price: producto.price,
    sku: producto.sku,
    soldAsPack: producto.soldAsPack === true,
    unitsPerPack: producto.unitsPerPack || 1,
    variant: producto.variant,
  };
}

function desdeGondola(fila) {
  return {
    alcoholic: fila.alcoholic === true,
    // La compuerta de licencia los mantiene cerrados: en la base están con
    // available=false, y por eso la clave publicable no los devuelve.
    available: false,
    brand: fila.brand,
    capacityUnit: fila.capacityUnit,
    capacityValue: fila.capacityValue,
    catalogAssetId: null,
    category: fila.category,
    externalId: fila.externalId,
    imageUrl: null,
    name: fila.name,
    origen: ORIGEN_GONDOLA,
    packagingType: fila.packagingType,
    price: fila.price,
    sku: fila.sku,
    soldAsPack: fila.soldAsPack === true,
    unitsPerPack: fila.unitsPerPack || 1,
    variant: fila.variant,
  };
}

function desdeRetailUnidad(fila) {
  return {
    alcoholic: false,
    // Son líneas reales de inventario, pero nacieron sin stock verificable y
    // permanecen fuera de la respuesta publicable hasta una recepción real.
    available: false,
    brand: fila.brand,
    capacityUnit: 'ml',
    capacityValue: fila.capacityValue,
    catalogAssetId: null,
    category: fila.category,
    externalId: fila.externalId,
    imageUrl: null,
    name: fila.name,
    origen: ORIGEN_RETAIL_UNIDADES,
    packagingType: fila.packagingType,
    price: fila.price,
    sku: fila.sku,
    soldAsPack: false,
    unitsPerPack: 1,
    variant: fila.variant,
  };
}

/*
 * Un pack de lanzamiento que producción hoy no muestra. Conserva su
 * presentación —que es lo que el matcher compara— y nada más: sin precio, y
 * cerrado, porque si estuviera abierto la clave publicable lo estaría
 * devolviendo y este camino no se habría usado.
 */
function desdePackLanzamiento(sku, objetivo) {
  const { presentacion } = objetivo;
  return {
    alcoholic: false,
    available: false,
    brand: presentacion.brand,
    capacityUnit: presentacion.capacityUnit,
    capacityValue: presentacion.capacityValue,
    catalogAssetId: null,
    category: presentacion.category,
    externalId: sku,
    imageUrl: null,
    name: presentacion.name,
    origen: ORIGEN_PACK_LANZAMIENTO,
    packagingType: presentacion.packagingType,
    price: null,
    sku,
    soldAsPack: true,
    unitsPerPack: objetivo.unitsPerPack,
    variant: presentacion.variant,
  };
}

function desdeGondolaFinal(fila) {
  return {
    alcoholic: fila.alcoholic === true,
    // Nacen cerradas: stock 0 y available=false hasta la Recepción real en el
    // Panel. La clave publicable no las devuelve.
    available: false,
    brand: fila.brand,
    capacityUnit: fila.capacityUnit,
    capacityValue: fila.capacityValue,
    catalogAssetId: null,
    category: fila.category,
    externalId: fila.externalId,
    imageUrl: null,
    name: fila.name,
    origen: ORIGEN_GONDOLA_FINAL,
    packagingType: fila.packagingType,
    price: fila.price,
    sku: fila.sku,
    soldAsPack: fila.soldAsPack === true,
    unitsPerPack: fila.unitsPerPack || 1,
    variant: fila.variant,
  };
}

/**
 * Devuelve los 72 SKU (60 con `gondolaFinal: false`) y el detalle de la
 * reconciliación. `strict` planta el proceso si las cuentas no cierran.
 */
export async function loadCatalogSkus(root, { strict = true, gondolaFinal = true } = {}) {
  const fotografia = JSON.parse(
    fs.readFileSync(path.join(root, 'catalog/production-catalog-snapshot.json'), 'utf8'),
  );
  const [{ GONDOLA }, { RETAIL_UNIDADES }, { PRODUCTOS_PROPUESTOS }] = await Promise.all([
    import(new URL(`file://${path.join(root, 'catalog/gondola-neuquen.mjs').replaceAll('\\', '/')}`).href),
    import(new URL(`file://${path.join(root, 'catalog/retail-unidades.mjs').replaceAll('\\', '/')}`).href),
    import(new URL(`file://${path.join(root, 'catalog/gondola-retail-final-proposal.mjs').replaceAll('\\', '/')}`).href),
  ]);
  const GONDOLA_FINAL = gondolaFinal ? PRODUCTOS_PROPUESTOS : [];

  /*
   * Las autoridades, en orden de precedencia. Cada una aporta los SKU que las
   * anteriores no declararon; ninguna debería pisar a otra, y si lo hace se
   * reporta como colisión en vez de resolverse en silencio.
   */
  const autoridades = [
    { origen: ORIGEN_GONDOLA, filas: GONDOLA, mapear: desdeGondola },
    {
      origen: ORIGEN_PACK_LANZAMIENTO,
      filas: [...OBJETIVOS.entries()].map(([sku, objetivo]) => ({ sku, objetivo })),
      mapear: ({ sku, objetivo }) => desdePackLanzamiento(sku, objetivo),
    },
    { origen: ORIGEN_RETAIL_UNIDADES, filas: RETAIL_UNIDADES, mapear: desdeRetailUnidad },
    { origen: ORIGEN_GONDOLA_FINAL, filas: GONDOLA_FINAL, mapear: desdeGondolaFinal },
  ];

  const declarados = new Map();
  const colisiones = [];
  const aportadosPorAutoridad = {};
  for (const { origen, filas, mapear } of autoridades) {
    let aportados = 0;
    for (const fila of filas) {
      if (declarados.has(fila.sku)) {
        colisiones.push(`${fila.sku} lo declaran ${declarados.get(fila.sku).origen} y ${origen}`);
        continue;
      }
      declarados.set(fila.sku, mapear(fila));
      aportados += 1;
    }
    aportadosPorAutoridad[origen] = aportados;
  }

  /*
   * En modo «base previa al lote», una alta ya aplicada que producción hoy
   * muestra no es un visible desconocido: es exactamente lo que ese modo tiene
   * que dejar afuera para poder reconstruir los 60 anteriores.
   */
  const delLoteFinal = new Set(PRODUCTOS_PROPUESTOS.map((fila) => fila.sku));
  const visibles = fotografia.productos
    .map(desdeFotografia)
    .filter((producto) => gondolaFinal || !delLoteFinal.has(producto.sku));

  // Producción pisa a la autoridad: precio, disponibilidad y foto asociada
  // reales le ganan a lo que el archivo del lote decía el día que se escribió.
  const sinDeclarar = [];
  for (const producto of visibles) {
    if (!declarados.has(producto.sku)) sinDeclarar.push(producto.sku);
    declarados.set(producto.sku, producto);
  }

  const skus = [...declarados.values()]
    .sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0));

  const universo = autoridades.reduce((suma, { filas }) => suma + filas.length, 0);
  const reconciliacion = {
    colisiones: colisiones.length,
    esperadoTotal: universo,
    gondola: GONDOLA.length,
    gondolaAlcoholica: GONDOLA.filter((fila) => fila.alcoholic).length,
    gondolaFinal: GONDOLA_FINAL.length,
    gondolaNoAlcoholica: GONDOLA.filter((fila) => !fila.alcoholic).length,
    ocultos: skus.filter((producto) => !producto.available).length,
    packsLanzamiento: OBJETIVOS.size,
    porAutoridad: aportadosPorAutoridad,
    retailUnidades: RETAIL_UNIDADES.length,
    sinDeclarar: sinDeclarar.length,
    total: skus.length,
    visibles: visibles.length,
  };

  const problemas = [];
  for (const colision of colisiones) {
    problemas.push(`Dos autoridades declaran el mismo SKU: ${colision}.`);
  }
  if (sinDeclarar.length) {
    problemas.push(
      `Producción muestra ${sinDeclarar.length} SKU que ninguna autoridad declara `
      + `(${sinDeclarar.join(', ')}): catálogo que entró sin pasar por un lote.`,
    );
  }
  if (reconciliacion.total !== reconciliacion.esperadoTotal) {
    problemas.push(
      `El universo declarado son ${reconciliacion.esperadoTotal} SKU y la reconciliación `
      + `devolvió ${reconciliacion.total}.`,
    );
  }
  if (strict && problemas.length) {
    throw new Error(`El catálogo no reconcilia.\n  ${problemas.join('\n  ')}`);
  }

  return { skus, reconciliacion, problemas };
}
