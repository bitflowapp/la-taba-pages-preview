/*
 * Los 72 SKU del catálogo productivo, en una sola lista y con su procedencia.
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
 *   12  de `catalog/gondola-retail-final-proposal.mjs` — la góndola final,
 *       aplicada a producción el 2026-08-21 (60 → 72), todas con stock=0 y
 *       available=false hasta la Recepción real: la clave publicable tampoco
 *       las devuelve todavía.
 *
 * La reconciliación se comprueba, no se supone: 29 no alcohólicos de la góndola
 * más 4 packs previos tienen que dar los 33 visibles; además tienen que sumarse
 * exactamente 23 alcohólicos ocultos, 4 unidades minoristas y 12 altas de la
 * góndola final. Si no da 72, algo cambió y el pipeline se planta en vez de
 * auditar un catálogo imaginario.
 *
 * `gondolaFinal: false` devuelve la autoridad de 60 anterior al lote: la usan
 * los tests de la propuesta (que afirman cosas SOBRE esa base) y los
 * aplicadores del lote, que toman el snapshot de los 60 previos.
 */
import fs from 'node:fs';
import path from 'node:path';

const ORIGEN_PRODUCCION = 'produccion';
const ORIGEN_GONDOLA = 'gondola-neuquen';
const ORIGEN_RETAIL_UNIDADES = 'retail-unidades';
const ORIGEN_GONDOLA_FINAL = 'gondola-retail-final';

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

  const visibles = fotografia.productos.map(desdeFotografia);
  const porSku = new Map(visibles.map((producto) => [producto.sku, producto]));

  const ocultos = GONDOLA
    .filter((fila) => !porSku.has(fila.sku))
    .map(desdeGondola);

  const skuConocidos = new Set([...visibles, ...ocultos].map((producto) => producto.sku));
  const retailUnidades = RETAIL_UNIDADES
    .filter((fila) => !skuConocidos.has(fila.sku))
    .map(desdeRetailUnidad);

  for (const producto of retailUnidades) skuConocidos.add(producto.sku);
  const altasFinales = GONDOLA_FINAL
    .filter((fila) => !skuConocidos.has(fila.sku))
    .map(desdeGondolaFinal);

  const skus = [...visibles, ...ocultos, ...retailUnidades, ...altasFinales]
    .sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0));

  const gondolaNoAlcoholica = GONDOLA.filter((fila) => !fila.alcoholic).length;
  const packsPrevios = visibles.filter((producto) => !GONDOLA.some((fila) => fila.sku === producto.sku));
  const reconciliacion = {
    esperadoTotal: visibles.length + GONDOLA.filter((fila) => fila.alcoholic).length + RETAIL_UNIDADES.length + GONDOLA_FINAL.length,
    esperadoVisible: gondolaNoAlcoholica + packsPrevios.length,
    gondola: GONDOLA.length,
    gondolaAlcoholica: GONDOLA.filter((fila) => fila.alcoholic).length,
    gondolaNoAlcoholica,
    gondolaFinal: GONDOLA_FINAL.length,
    gondolaFinalAgregadas: altasFinales.length,
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
  if (reconciliacion.gondolaFinalAgregadas !== reconciliacion.gondolaFinal) {
    problemas.push(
      `Las altas de la góndola final agregadas (${reconciliacion.gondolaFinalAgregadas}) no son exactamente las `
      + `de la propuesta aplicada (${reconciliacion.gondolaFinal}).`,
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
