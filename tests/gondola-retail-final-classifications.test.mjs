import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GONDOLA } from '../catalog/gondola-neuquen.mjs';
import { RETAIL_UNIDADES } from '../catalog/retail-unidades.mjs';
import {
  GONDOLA_RETAIL_FINAL_CLASSIFICATION_LABELS,
  GONDOLA_RETAIL_FINAL_CLASSIFICATIONS,
} from '../catalog/gondola-retail-final-classifications.mjs';
import { loadCatalogSkus } from '../scripts/catalog-images/catalog-skus.mjs';
import { OBJETIVOS } from '../scripts/catalog-images/lote-objetivo.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const snapshot = JSON.parse(
  fs.readFileSync(path.join(root, 'catalog/production-catalog-snapshot.json'), 'utf8'),
).productos;

function uniqueSkus(rows, source) {
  const skus = rows.map((row) => row.sku);
  assert.equal(new Set(skus).size, skus.length, `${source} contiene SKU repetidos`);
  return new Set(skus);
}

/**
 * Reconstruye la base de 60 SKU sobre la que se tomó esta clasificación:
 * 52 de `gondola-neuquen.mjs`, los 4 packs de lanzamiento y las 4 unidades
 * minoristas.
 *
 * POR QUÉ NO SE ARMA MIRANDO QUÉ MUESTRA PRODUCCIÓN
 * -------------------------------------------------
 * Antes se armaba por descarte sobre la fotografía: «los visibles que GONDOLA
 * no nombra son los 4 packs». Eso ataba la identidad del catálogo a
 * `available`, que se mueve con el inventario y con nada más. El 2026-08-23 un
 * pack se quedó sin stock y una de las 12 altas se recibió: el descarte metió
 * el alta entre los packs históricos y sacó al pack de la lista, y esta prueba
 * se puso roja sin que ningún SKU naciera ni muriera.
 *
 * `loadCatalogSkus(..., { gondolaFinal: false })` devuelve esa misma base por
 * IDENTIDAD, que es lo que la clasificación describe.
 */
async function compositeCatalog() {
  const { skus } = await loadCatalogSkus(root, { gondolaFinal: false });
  const ORIGEN = {
    'gondola-neuquen': 'gondola-neuquen-alcohol-hidden-by-rls',
    'pack-lanzamiento': 'pack-lanzamiento',
    produccion: 'production-snapshot',
    'retail-unidades': 'retail-unidades',
  };
  return skus.map((row) => Object.freeze({
    sku: row.sku,
    brand: row.brand,
    name: row.name,
    category: row.category,
    alcoholic: row.alcoholic,
    available: row.available,
    soldAsPack: row.soldAsPack,
    unitsPerPack: row.unitsPerPack,
    origin: ORIGEN[row.origen] || row.origen,
  }));
}

test('lo que producción muestra no contradice a la góndola que lo declaró', () => {
  // La fotografía y `gondola-neuquen.mjs` describen los mismos productos. Si
  // difieren en marca, nombre, categoría, alcohol o cantidad de pack, alguien
  // cambió el producto y no el archivo —o al revés—, y la clasificación de
  // abajo estaría hablando de otra cosa.
  const porSku = new Map(snapshot.map((row) => [row.sku, row]));
  for (const row of GONDOLA) {
    const visible = porSku.get(row.sku);
    if (!visible) continue;
    assert.equal(visible.brand, row.brand, `${row.sku}: marca difiere entre snapshot y GONDOLA`);
    assert.equal(visible.name, row.name, `${row.sku}: nombre difiere entre snapshot y GONDOLA`);
    assert.equal(visible.category, row.category, `${row.sku}: categoría difiere entre snapshot y GONDOLA`);
    assert.equal(visible.isAlcoholic === true, row.alcoholic, `${row.sku}: alcohol difiere entre snapshot y GONDOLA`);
    assert.equal(visible.soldAsPack === true, row.soldAsPack, `${row.sku}: pack difiere entre snapshot y GONDOLA`);
    assert.equal(visible.unitsPerPack, row.unitsPerPack, `${row.sku}: cantidad de pack difiere entre snapshot y GONDOLA`);
  }
});

test('la autoridad compuesta reconstruye exactamente los 60 SKU actuales', async () => {
  const gondolaSkus = uniqueSkus(GONDOLA, 'GONDOLA');
  const retailSkus = uniqueSkus(RETAIL_UNIDADES, 'RETAIL_UNIDADES');
  const packSkus = new Set(OBJETIVOS.keys());
  uniqueSkus(snapshot, 'production-catalog-snapshot');

  assert.equal(GONDOLA.length, 52);
  assert.equal(packSkus.size, 4, 'los 4 packs de lanzamiento');
  assert.equal(RETAIL_UNIDADES.length, 4);
  assert.equal(GONDOLA.filter((row) => row.alcoholic).length, 23);

  // Las tres autoridades son disjuntas: ningún SKU lo declara más de una.
  for (const sku of packSkus) assert.equal(gondolaSkus.has(sku), false, `${sku}: pack declarado también por GONDOLA`);
  assert.equal([...retailSkus].some((sku) => gondolaSkus.has(sku) || packSkus.has(sku)), false);

  const catalog = await compositeCatalog();
  assert.equal(catalog.length, 60);
  assert.equal(new Set(catalog.map((row) => row.sku)).size, 60, 'el compuesto final contiene SKU repetidos');

  /*
   * Cuántos de los 60 se pueden comprar HOY es inventario, y se mueve solo. Lo
   * que esta prueba fija es la identidad: los 23 alcohólicos y las 4 unidades
   * minoristas están cerrados por decisión, no por falta de stock, y ésos sí no
   * pueden abrirse sin que alguien lo decida.
   */
  const cerradosPorDecision = catalog.filter((row) => row.alcoholic || row.origin === 'retail-unidades');
  assert.equal(cerradosPorDecision.length, 27);
  assert.equal(cerradosPorDecision.every((row) => row.available === false), true);
});

test('cada SKU actual tiene exactamente una clasificación permitida', async () => {
  const catalog = await compositeCatalog();
  const catalogSkus = catalog.map((row) => row.sku).sort();
  const classifiedSkus = GONDOLA_RETAIL_FINAL_CLASSIFICATIONS.map((row) => row.sku).sort();
  const allowed = new Set(GONDOLA_RETAIL_FINAL_CLASSIFICATION_LABELS);

  assert.equal(GONDOLA_RETAIL_FINAL_CLASSIFICATIONS.length, 60);
  assert.equal(new Set(classifiedSkus).size, 60, 'hay un SKU clasificado más de una vez');
  assert.deepEqual(classifiedSkus, catalogSkus, 'la clasificación no cubre exactamente el compuesto actual');

  for (const row of GONDOLA_RETAIL_FINAL_CLASSIFICATIONS) {
    assert.equal(allowed.has(row.classification), true, `${row.sku}: clasificación no permitida`);
    assert.ok(row.rationale.length >= 30, `${row.sku}: falta una justificación concreta`);
  }

  const counts = Object.fromEntries(
    GONDOLA_RETAIL_FINAL_CLASSIFICATION_LABELS.map((label) => [
      label,
      GONDOLA_RETAIL_FINAL_CLASSIFICATIONS.filter((row) => row.classification === label).length,
    ]),
  );
  assert.deepEqual(counts, {
    KEEP_HIGH_PRIORITY: 31,
    KEEP_SECONDARY: 22,
    FAMILY_SIZE_MISSING: 2,
    PACK_OK: 5,
    DUPLICATE: 0,
    WRONG_PRESENTATION: 0,
    REVIEW: 0,
  });
});

test('PACK_OK coincide con los cinco packs reales y ningún alcohol queda disponible', async () => {
  const catalog = await compositeCatalog();
  const packs = catalog.filter((row) => row.soldAsPack).map((row) => row.sku).sort();
  const packOk = GONDOLA_RETAIL_FINAL_CLASSIFICATIONS
    .filter((row) => row.classification === 'PACK_OK')
    .map((row) => row.sku)
    .sort();
  assert.deepEqual(packOk, packs);

  const alcohol = catalog.filter((row) => row.alcoholic);
  assert.equal(alcohol.length, 23);
  assert.equal(alcohol.every((row) => row.available === false), true, 'al menos un producto alcohólico quedó disponible');

  const retail = catalog.filter((row) => row.origin === 'retail-unidades');
  assert.equal(retail.length, 4);
  assert.equal(retail.every((row) => row.available === false && !row.soldAsPack), true);
});

