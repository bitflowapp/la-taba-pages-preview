/*
 * LAS CAMPAÑAS PUBLICADAS ENCUENTRAN SU PRODUCTO EN EL CATÁLOGO VIVO.
 *
 * `tests/fixtures/catalog-live.json` es una lectura de sólo lectura del catálogo
 * público de producción (`npm run campaigns:verify-live -- --write-snapshot`).
 * NO es el snapshot CP de las demás pruebas: ése tiene productos sin publicar.
 *
 * Para cada campaña ENCENDIDA y APROBADA:
 *   TARGET_PRODUCT_EXISTS · BRAND_MATCH · PRESENTATION_MATCH · PACKAGING_MATCH ·
 *   REAL_IMAGE · ORDERABLE_WHEN_SHOWN · SELECTED_BY_ENGINE
 * Si una falla, la release no puede declararse lista comercialmente.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { CAMPAIGNS } from '../js/campaigns/campaign-config.js';
import { CAMPAIGNS as CAMPAIGNS_CP46 } from './fixtures/campaign-config-cp46.js';
import { selectCampaigns } from '../js/campaigns/campaign-engine.js';
import { getCustomerCatalogProducts, isProductOrderable } from '../js/core/catalog-store.js';
import {
  evaluateCampaign,
  evaluateCampaignsAgainstRows,
  isLiveCampaign,
  loadProductsLikeTheStore,
} from '../scripts/campaigns/live-catalog-gate.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/catalog-live.json'), 'utf8'));
const rows = snapshot.products;
const options = { supabaseUrl: snapshot.supabaseUrl, businessId: snapshot.businessId };

test('la instantánea es la vista pública del catálogo: sin costos ni autores', () => {
  assert.ok(rows.length >= 40, 'una lectura corta no demuestra nada');
  for (const forbidden of ['unit_cost', 'verified_by', 'created_at', 'updated_at']) {
    assert.ok(rows.every((row) => !(forbidden in row)), `${forbidden} no debe viajar en el repositorio`);
  }
});

test('cada campaña encendida y aprobada pasa las siete comprobaciones contra el catálogo vivo', async () => {
  const report = await evaluateCampaignsAgainstRows(rows, CAMPAIGNS, options);
  assert.ok(report.live.length >= 3, `hay que tener varias campañas con producto real; hay ${report.live.length}`);
  for (const entry of report.live) {
    assert.deepEqual(entry.problems, [], `${entry.id}: contrato editorial`);
    for (const [flag, ok] of Object.entries(entry.flags)) assert.equal(ok, true, `${entry.id} ${flag} (${entry.sku})`);
  }
});

test('lo que no tiene producto real queda APAGADO y PENDIENTE, nunca encendido apuntando al vacío', async () => {
  const report = await evaluateCampaignsAgainstRows(rows, CAMPAIGNS, options);
  const ids = new Set(report.live.map((entry) => entry.id));
  // Heineken y Aperol no están en el catálogo y el alcohol está cerrado.
  for (const id of ['heineken-beer-pour', 'aperol-ice-reveal']) {
    assert.equal(ids.has(id), false, `${id} no puede estar encendida sin producto real`);
    const campaign = CAMPAIGNS.find((entry) => entry.id === id);
    assert.equal(campaign.enabled, false);
    assert.equal(campaign.approval.status, 'PENDIENTE');
  }
  for (const campaign of CAMPAIGNS.filter((entry) => !isLiveCampaign(entry))) {
    assert.match(campaign.approval.reference, /\S/, `${campaign.id}: decir por qué está pendiente`);
  }
});

test('CONTROL NEGATIVO: la configuración publicada hasta v140 NO encontraba ninguno de sus productos', async () => {
  const report = await evaluateCampaignsAgainstRows(rows, CAMPAIGNS_CP46, options);
  assert.equal(report.live.length, 4);
  for (const entry of report.live) {
    assert.equal(entry.flags.TARGET_PRODUCT_EXISTS, false, `${entry.id}: el gate tiene que detectar el SKU inexistente`);
    assert.equal(entry.flags.SELECTED_BY_ENGINE, false);
    assert.equal(entry.ok, false);
  }
});

test('MUTACIÓN: la misma campaña con la identidad de 355 ml deja de coincidir con la lata de 250 ml', async () => {
  const products = await loadProductsLikeTheStore(rows, options);
  const redBull = CAMPAIGNS.find((entry) => entry.id === 'red-bull-cold-can');
  assert.equal(evaluateCampaign(redBull, products, options).ok, true);
  const vieja = { ...redBull, target: { ...redBull.target, identity: { ...redBull.target.identity, volumeMl: 355 } } };
  const resultado = evaluateCampaign(vieja, products, options);
  assert.equal(resultado.flags.PRESENTATION_MATCH, false);
  assert.equal(resultado.flags.SELECTED_BY_ENGINE, false, 'el motor no sustituye una presentación por otra');
  assert.doesNotMatch(JSON.stringify(redBull), /355/, 'no queda ninguna referencia a 355 ml en Red Bull');
});

test('MUTACIÓN: sin la cadena completa de foto oficial no hay REAL_IMAGE; sin stock no es comprable', async () => {
  const sinFoto = rows.map((row) => (row.sku === 'coca-cola-original-2250ml' ? { ...row, image_thumbnail_sha256: null } : row));
  const coca = CAMPAIGNS.find((entry) => entry.id === 'coca-cola-product-drop');
  const products = await loadProductsLikeTheStore(sinFoto, options);
  assert.equal(evaluateCampaign(coca, products, options).flags.REAL_IMAGE, false);
  const sinStock = rows.map((row) => (row.sku === 'coca-cola-original-2250ml' ? { ...row, stock: 0 } : row));
  const productsSinStock = await loadProductsLikeTheStore(sinStock, options);
  const resultado = evaluateCampaign(coca, productsSinStock, options);
  assert.equal(resultado.flags.ORDERABLE_WHEN_SHOWN, false);
  assert.equal(resultado.flags.SELECTED_BY_ENGINE, false);
});

test('ningún producto con alcohol se puede comprar hoy: no hay candidata de cerveza ni de aperitivo', async () => {
  const products = await loadProductsLikeTheStore(rows, options);
  const alcohol = products.filter((product) => product.alcoholic);
  assert.ok(alcohol.length > 0);
  assert.equal(alcohol.filter(isProductOrderable).length, 0);
  assert.ok(!products.some((product) => /heineken|aperol/i.test(`${product.brand} ${product.name}`)));
});

test('con el catálogo vivo las tres campañas reales se ven: banda, franja y grilla; cada una en SU superficie', async () => {
  const products = getCustomerCatalogProducts(await loadProductsLikeTheStore(rows, options));
  const elegir = (catalog, isOrderable = isProductOrderable) => selectCampaigns({ campaigns: CAMPAIGNS, products, isOrderable, catalog });
  // Tamaños REALES de lista: la pieza de grilla pide 8 productos o más, y de los
  // rubros del catálogo vivo sólo «Gaseosas» (16) y «Todo» (51) lo cumplen.
  const todo = elegir({ categoryId: 'all', searching: false, filtered: false, listSize: products.length });
  assert.equal(products.length, 51);
  assert.equal(todo['home-hero']?.campaign.id, 'red-bull-cold-can');
  assert.equal(todo['home-inline']?.campaign.id, 'coca-cola-product-drop');
  assert.equal(todo['catalog-inline']?.campaign.id, 'aquarius-ice-reveal');
  const gaseosas = products.filter((product) => product.categoryId === 'gaseosas').length;
  assert.equal(elegir({ categoryId: 'gaseosas', searching: false, filtered: false, listSize: gaseosas })['catalog-inline']?.campaign.id, 'coca-cola-product-drop');
  // Una lista corta no lleva pieza: es la regla del motor, y por eso Red Bull y
  // Aquarius no se anuncian en sus propios rubros.
  for (const [categoryId, listSize] of [['energizantes', 5], ['aguas-saborizadas', 3]]) {
    assert.equal(elegir({ categoryId, searching: false, filtered: false, listSize })['catalog-inline'], null, categoryId);
  }
  // Si Red Bull se agota, la banda la toma otra campaña real, no queda vacía.
  const sinRedBull = (product) => isProductOrderable(product) && product.sku !== 'red-bull-original-250ml';
  assert.equal(elegir({ categoryId: 'all', searching: false, filtered: false, listSize: 51 }, sinRedBull)['home-hero']?.campaign.id, 'aquarius-ice-reveal');
  // Y si se agota Aquarius, la grilla de «Todo» la toma Coca-Cola.
  const sinAquarius = (product) => isProductOrderable(product) && product.sku !== 'aquarius-pomelo-2250ml';
  assert.equal(elegir({ categoryId: 'all', searching: false, filtered: false, listSize: 51 }, sinAquarius)['catalog-inline']?.campaign.id, 'coca-cola-product-drop');
});
