/*
 * Los 60 SKU del catálogo productivo, en una sola lista y con su procedencia.
 *
 * De dónde sale cada cosa, y por qué:
 *
 *   33  de `catalog/production-catalog-snapshot.json` — lo que la clave
 *       publicable ve HOY en producción. Es el dato más fuerte: precio, stock
 *       y disponibilidad reales.
 *   23  de `catalog/gondola-neuquen.mjs` — los alcohólicos que RLS no
 *       devuelve porque están cerrados por la compuerta de licencia. Ese
 *       archivo es el que generó el lote SQL que los insertó, así que describe
 *       exactamente lo que hay en la base.
 *    4  de `catalog/retail-unidades.mjs` — unidades minoristas no alcohólicas
 *       que están en producción con stock=0 y available=false, por lo que la
 *       clave publicable tampoco las devuelve.
 *
 * La reconciliación se comprueba, no se supone: 29 no alcohólicos de la góndola
 * más 4 packs previos tienen que dar los 33 visibles; además tienen que sumarse
 * exactamente 23 alcohólicos ocultos y 4 unidades minoristas. Si no da 60, algo
 * cambió y el pipeline se planta en vez de auditar un catálogo imaginario.
 */
import fs from 'node:fs';
import path from 'node:path';

const ORIGEN_PRODUCCION = 'produccion';
const ORIGEN_GONDOLA = 'gondola-neuquen';
const ORIGEN_RETAIL_UNIDADES = 'retail-unidades';

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

/**
 * Devuelve los 60 SKU y el detalle de la reconciliación.
 * `strict` planta el proceso si las cuentas no cierran.
 */
export async function loadCatalogSkus(root, { strict = true } = {}) {
  const fotografia = JSON.parse(
    fs.readFileSync(path.join(root, 'catalog/production-catalog-snapshot.json'), 'utf8'),
  );
  const [{ GONDOLA }, { RETAIL_UNIDADES }] = await Promise.all([
    import(new URL(`file://${path.join(root, 'catalog/gondola-neuquen.mjs').replaceAll('\\', '/')}`).href),
    import(new URL(`file://${path.join(root, 'catalog/retail-unidades.mjs').replaceAll('\\', '/')}`).href),
  ]);

  const visibles = fotografia.productos.map(desdeFotografia);
  const porSku = new Map(visibles.map((producto) => [producto.sku, producto]));

  const ocultos = GONDOLA
    .filter((fila) => !porSku.has(fila.sku))
    .map(desdeGondola);

  const skuConocidos = new Set([...visibles, ...ocultos].map((producto) => producto.sku));
  const retailUnidades = RETAIL_UNIDADES
    .filter((fila) => !skuConocidos.has(fila.sku))
    .map(desdeRetailUnidad);

  const skus = [...visibles, ...ocultos, ...retailUnidades]
    .sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0));

  const gondolaNoAlcoholica = GONDOLA.filter((fila) => !fila.alcoholic).length;
  const packsPrevios = visibles.filter((producto) => !GONDOLA.some((fila) => fila.sku === producto.sku));
  const reconciliacion = {
    esperadoTotal: visibles.length + GONDOLA.filter((fila) => fila.alcoholic).length + RETAIL_UNIDADES.length,
    esperadoVisible: gondolaNoAlcoholica + packsPrevios.length,
    gondola: GONDOLA.length,
    gondolaAlcoholica: GONDOLA.filter((fila) => fila.alcoholic).length,
    gondolaNoAlcoholica,
    ocultosAgregados: ocultos.length,
    packsPrevios: packsPrevios.length,
    retailUnidades: RETAIL_UNIDADES.length,
    retailUnidadesAgregadas: retailUnidades.length,
    total: skus.length,
    visibles: visibles.length,
  };

  const problemas = [];
  if (reconciliacion.esperadoVisible !== reconciliacion.visibles) {
    problemas.push(
      `La cuenta no cierra: la góndola no alcohólica (${gondolaNoAlcoholica}) más los packs previos `
      + `(${packsPrevios.length}) da ${reconciliacion.esperadoVisible}, y producción muestra ${visibles.length}.`,
    );
  }
  if (reconciliacion.ocultosAgregados !== reconciliacion.gondolaAlcoholica) {
    problemas.push(
      `Los SKU que producción no muestra (${reconciliacion.ocultosAgregados}) no son exactamente los `
      + `alcohólicos de la góndola (${reconciliacion.gondolaAlcoholica}).`,
    );
  }
  if (reconciliacion.retailUnidadesAgregadas !== reconciliacion.retailUnidades) {
    problemas.push(
      `Las unidades minoristas agregadas (${reconciliacion.retailUnidadesAgregadas}) no son exactamente las `
      + `de la autoridad local (${reconciliacion.retailUnidades}).`,
    );
  }
  if (reconciliacion.total !== reconciliacion.esperadoTotal) {
    problemas.push(
      `El total reconciliado (${reconciliacion.total}) no coincide con visibles + alcohol oculto + `
      + `unidades minoristas (${reconciliacion.esperadoTotal}).`,
    );
  }
  if (strict && problemas.length) {
    throw new Error(`El catálogo no reconcilia.\n  ${problemas.join('\n  ')}`);
  }

  return { skus, reconciliacion, problemas };
}
