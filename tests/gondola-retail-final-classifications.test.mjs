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
 * Reconstruye la autoridad actual sin consultar producción:
 * - snapshot: 29 no alcohólicos de GONDOLA + los 4 packs históricos;
 * - GONDOLA: agrega los 23 alcohólicos ocultos por RLS;
 * - RETAIL_UNIDADES: agrega las 4 unidades nuevas, stock 0/no disponibles.
 */
function compositeCatalog() {
  const bySku = new Map(snapshot.map((row) => [row.sku, Object.freeze({
    sku: row.sku,
    brand: row.brand,
    name: row.name,
    category: row.category,
    alcoholic: row.isAlcoholic === true,
    available: row.available === true,
    soldAsPack: row.soldAsPack === true,
    unitsPerPack: row.unitsPerPack,
    origin: 'production-snapshot',
  })]));

  for (const row of GONDOLA) {
    const visible = bySku.get(row.sku);
    if (visible) {
      assert.equal(visible.brand, row.brand, `${row.sku}: marca difiere entre snapshot y GONDOLA`);
      assert.equal(visible.name, row.name, `${row.sku}: nombre difiere entre snapshot y GONDOLA`);
      assert.equal(visible.category, row.category, `${row.sku}: categoría difiere entre snapshot y GONDOLA`);
      assert.equal(visible.alcoholic, row.alcoholic, `${row.sku}: alcohol difiere entre snapshot y GONDOLA`);
      assert.equal(visible.soldAsPack, row.soldAsPack, `${row.sku}: pack difiere entre snapshot y GONDOLA`);
      assert.equal(visible.unitsPerPack, row.unitsPerPack, `${row.sku}: cantidad de pack difiere entre snapshot y GONDOLA`);
      continue;
    }
    bySku.set(row.sku, Object.freeze({
      sku: row.sku,
      brand: row.brand,
      name: row.name,
      category: row.category,
      alcoholic: row.alcoholic,
      available: false,
      soldAsPack: row.soldAsPack,
      unitsPerPack: row.unitsPerPack,
      origin: 'gondola-neuquen-alcohol-hidden-by-rls',
    }));
  }

  for (const row of RETAIL_UNIDADES) {
    assert.equal(bySku.has(row.sku), false, `${row.sku}: la unidad retail colisiona con el catálogo previo`);
    bySku.set(row.sku, Object.freeze({
      sku: row.sku,
      brand: row.brand,
      name: row.name,
      category: row.category,
      alcoholic: false,
      available: false,
      soldAsPack: false,
      unitsPerPack: 1,
      origin: 'retail-unidades',
    }));
  }

  return [...bySku.values()];
}

test('la autoridad compuesta reconstruye exactamente los 60 SKU actuales', () => {
  const snapshotSkus = uniqueSkus(snapshot, 'production-catalog-snapshot');
  const gondolaSkus = uniqueSkus(GONDOLA, 'GONDOLA');
  const retailSkus = uniqueSkus(RETAIL_UNIDADES, 'RETAIL_UNIDADES');

  assert.equal(snapshot.length, 33);
  assert.equal(GONDOLA.length, 52);
  assert.equal(RETAIL_UNIDADES.length, 4);

  const overlapSnapshotGondola = [...snapshotSkus].filter((sku) => gondolaSkus.has(sku));
  const packsHistoricos = [...snapshotSkus].filter((sku) => !gondolaSkus.has(sku));
  const alcoholOculto = [...gondolaSkus].filter((sku) => !snapshotSkus.has(sku));

  assert.equal(overlapSnapshotGondola.length, 29, 'el snapshot debe releer los 29 no alcohólicos de GONDOLA');
  assert.equal(packsHistoricos.length, 4, 'el snapshot debe aportar los 4 packs históricos');
  assert.equal(alcoholOculto.length, 23, 'GONDOLA debe aportar los 23 alcohólicos ocultos por RLS');
  assert.equal([...retailSkus].some((sku) => snapshotSkus.has(sku) || gondolaSkus.has(sku)), false);

  const catalog = compositeCatalog();
  assert.equal(catalog.length, 60);
  assert.equal(new Set(catalog.map((row) => row.sku)).size, 60, 'el compuesto final contiene SKU repetidos');
  assert.equal(catalog.filter((row) => row.available).length, 33);
  assert.equal(catalog.filter((row) => !row.available).length, 27);
});

test('cada SKU actual tiene exactamente una clasificación permitida', () => {
  const catalog = compositeCatalog();
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

test('PACK_OK coincide con los cinco packs reales y ningún alcohol queda disponible', () => {
  const catalog = compositeCatalog();
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

