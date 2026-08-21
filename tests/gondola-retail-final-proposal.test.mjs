import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  BARCODES_EXISTENTES_PROPUESTOS,
  CATALOGO_ACTUAL,
  EXCLUIDOS_POR_AHORA,
  FUENTES,
  PRODUCTOS_PROPUESTOS,
  TOTAL_ESTIMADO,
  precioFinalDesdeReferencia,
} from '../catalog/gondola-retail-final-proposal.mjs';
import { RETAIL_UNIDADES } from '../catalog/retail-unidades.mjs';
import { loadCatalogSkus } from '../scripts/catalog-images/catalog-skus.mjs';
import { gtinDigitoVerificadorValido } from '../scripts/retail-unidades-plan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('la regla aplica 15 % una sola vez y redondea a la siguiente terminación 90', () => {
  assert.equal(precioFinalDesdeReferencia(1990), 2290);
  assert.equal(precioFinalDesdeReferencia(4290), 4990);
  assert.equal(precioFinalDesdeReferencia(5990), 6890);
  assert.equal(precioFinalDesdeReferencia(3010.40), 3490);
  assert.equal(precioFinalDesdeReferencia(2450), 2890);
  assert.throws(() => precioFinalDesdeReferencia(0), /positivo/);
});

test('la propuesta es compacta: 12 altas nuevas llevan 60 a 72 sin colisiones', async () => {
  const { skus: actuales } = await loadCatalogSkus(ROOT);
  const actualesSet = new Set(actuales.map((row) => row.sku));
  const propuestasSet = new Set(PRODUCTOS_PROPUESTOS.map((row) => row.sku));

  assert.equal(actuales.length, CATALOGO_ACTUAL);
  assert.equal(PRODUCTOS_PROPUESTOS.length, 12);
  assert.equal(propuestasSet.size, 12, 'hay un SKU repetido en el payload');
  assert.equal([...propuestasSet].some((sku) => actualesSet.has(sku)), false, 'un alta colisiona con un SKU actual');
  assert.equal(TOTAL_ESTIMADO, 72);

  assert.deepEqual(
    Object.fromEntries(['Gaseosas', 'Aguas', 'Jugos', 'Cervezas'].map((category) => [
      category,
      PRODUCTOS_PROPUESTOS.filter((row) => row.category === category).length,
    ])),
    { Gaseosas: 4, Aguas: 2, Jugos: 2, Cervezas: 4 },
  );
});

test('cada alta nace verificada pero cerrada: stock 0, no disponible y fallback propio', () => {
  for (const row of PRODUCTOS_PROPUESTOS) {
    assert.equal(row.externalId, row.sku, row.sku);
    assert.equal(row.stock, 0, row.sku);
    assert.equal(row.available, false, row.sku);
    assert.equal(row.catalogAssetId, null, row.sku);
    assert.equal(row.imageUrl, null, row.sku);
    assert.equal(row.imageSource, 'FALLBACK_PROPIO_TABA', row.sku);
    assert.equal(row.price, precioFinalDesdeReferencia(row.referencePrice), row.sku);
    assert.equal(FUENTES[row.priceSource]?.imagenPublicable, false, `${row.sku}: fuente de precio no declarada`);
  }

  const cervezas = PRODUCTOS_PROPUESTOS.filter((row) => row.category === 'Cervezas');
  const noAlcoholicas = PRODUCTOS_PROPUESTOS.filter((row) => row.category !== 'Cervezas');
  assert.equal(cervezas.length, 4);
  assert.equal(cervezas.every((row) => row.alcoholic && row.minimumAge === 18), true);
  assert.equal(cervezas.every((row) => row.soldAsPack && row.unitsPerPack === 6), true);
  assert.equal(noAlcoholicas.every((row) => !row.alcoholic && !row.soldAsPack && row.unitsPerPack === 1), true);
});

test('todos los GTIN propuestos son EAN-13 válidos, únicos y sin choque local conocido', async () => {
  const { skus: actuales } = await loadCatalogSkus(ROOT);
  const actualesSet = new Set(actuales.map((row) => row.sku));
  const nuevos = PRODUCTOS_PROPUESTOS.map((row) => row.gtin);
  const enriquecimientos = BARCODES_EXISTENTES_PROPUESTOS.map((row) => row.gtin);
  const retailExistentes = RETAIL_UNIDADES.map((row) => row.gtin);
  const todos = [...nuevos, ...enriquecimientos, ...retailExistentes];

  assert.equal(new Set(todos).size, todos.length, 'hay un GTIN repetido entre altas, enriquecimientos y retail actual');
  for (const row of [...PRODUCTOS_PROPUESTOS, ...BARCODES_EXISTENTES_PROPUESTOS]) {
    assert.match(row.gtin, /^\d{13}$/, `${row.sku}: no es EAN-13`);
    assert.equal(gtinDigitoVerificadorValido(row.gtin), true, `${row.sku}: dígito verificador inválido`);
    assert.equal(row.gtinType, 'EAN-13', row.sku);
  }
  for (const row of BARCODES_EXISTENTES_PROPUESTOS) {
    assert.equal(actualesSet.has(row.sku), true, `${row.sku}: el enriquecimiento no apunta a un SKU actual`);
  }
});

test('la propuesta no inventa retornables, Corona/Patagonia incompatibles ni 3 L', () => {
  const altas = PRODUCTOS_PROPUESTOS.map((row) => row.sku).join(' ');
  assert.doesNotMatch(altas, /retornable|corona|patagonia|3000ml|3l/);
  assert.ok(EXCLUIDOS_POR_AHORA.some((row) => /retornable 2,5 L/.test(row.candidate)));
  assert.ok(EXCLUIDOS_POR_AHORA.some((row) => /^Corona pack/.test(row.candidate)));
  assert.ok(EXCLUIDOS_POR_AHORA.some((row) => /^Patagonia 24\.7/.test(row.candidate)));
  assert.ok(EXCLUIDOS_POR_AHORA.some((row) => /3 L/.test(row.candidate)));
});

