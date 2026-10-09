/*
 * COBERTURA COMERCIAL SIN NAVEGADOR: promociones, combos y catálogo.
 *
 * Lo que se recorre sale de los datos —todas las campañas configuradas, todos
 * los combos del manifiesto, todas las filas del catálogo—, no de tres SKU
 * elegidos a mano. La contraparte con navegador (toques, ficha, carrito, WebKit)
 * es `tests/e2e/catalog-commercial-coverage.spec.mjs`.
 *
 * ORIGEN DE LOS DATOS
 *   REAL OBSERVADO  `tests/fixtures/catalog-live.json`: las 51 filas que la tienda
 *                   pública de producción devolvía el 2026-10-05.
 *   SINTÉTICO       lo que dice «sintético» en el nombre de la prueba: filas
 *                   fabricadas a partir del propio manifiesto para ejercer una
 *                   regla que el catálogo real hoy no activa (p. ej. un combo
 *                   completo). No existe en ninguna base.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { CAMPAIGNS } from '../js/campaigns/campaign-config.js';
import { campaignProblems, normalizeCampaign, selectCampaigns } from '../js/campaigns/campaign-engine.js';
import { COMBO_MANIFEST } from '../js/combos-data.js';
import { resolveCombos, roundPromotionalPrice } from '../js/core/combos.js';
import { getCustomerCatalogProducts, isProductOrderable } from '../js/core/catalog-store.js';
import { loadProductsLikeTheStore, rowsVisibleToCustomers } from '../scripts/campaigns/live-catalog-gate.mjs';

const live = JSON.parse(fs.readFileSync(new URL('./fixtures/catalog-live.json', import.meta.url), 'utf8'));
const products = await loadProductsLikeTheStore(live.products);
const customerProducts = getCustomerCatalogProducts(products);
const rowBySku = new Map(live.products.map((row) => [row.sku, row]));

test('REAL: el catálogo observado no cambió de forma sin que esta prueba lo note', () => {
  assert.equal(live.products.length, 51);
  assert.equal(rowsVisibleToCustomers(live.products).length, 51);
  const orderable = customerProducts.filter(isProductOrderable);
  assert.equal(orderable.length, 34, 'productos comprables hoy');
  assert.ok(customerProducts.filter((p) => !isProductOrderable(p)).every((p) => p.alcoholic === true),
    'lo que no se puede comprar es alcohol sin habilitar');
});

test('REAL: cada campaña ENCENDIDA y aprobada apunta a un producto que existe, es el de su identidad y se puede comprar', () => {
  const enabled = CAMPAIGNS.filter((c) => c.enabled && c.approval.status === 'APROBADA');
  assert.ok(enabled.length >= 3);
  for (const campaign of enabled) {
    const normalized = normalizeCampaign(campaign);
    assert.deepEqual(campaignProblems(normalized), [], `${campaign.id}: el motor la descarta`);
    const sku = campaign.target.skus[0];
    const row = rowBySku.get(sku);
    assert.ok(row, `${campaign.id}: el SKU ${sku} no existe en el catálogo publicado`);
    const product = customerProducts.find((p) => p.sku === sku);
    assert.ok(product && isProductOrderable(product), `${campaign.id}: promociona algo que no se puede comprar`);
    assert.equal(product.brand, campaign.target.identity.brand);
  }
});

test('REAL: una campaña APAGADA nunca llega a una superficie, aunque se la pida', () => {
  const picked = selectCampaigns({
    campaigns: CAMPAIGNS.map((c) => ({ ...c, enabled: c.enabled })),
    products: customerProducts,
    isOrderable: isProductOrderable,
    catalog: { categoryId: 'all', searching: false, filtered: false, listSize: 51 },
  });
  const shown = Object.values(picked).filter(Boolean).map((entry) => entry.campaign.id);
  const off = CAMPAIGNS.filter((c) => !c.enabled).map((c) => c.id);
  assert.ok(off.length >= 2);
  for (const id of off) assert.ok(!shown.includes(id), `${id}: está apagada y se eligió`);
  for (const entry of Object.values(picked)) if (entry) assert.ok(isProductOrderable(entry.product));
});

test('REAL: cada pieza elegida lleva el id del producto de la fila y su precio vivo, por superficie y por rubro', () => {
  const categories = ['all', ...new Set(customerProducts.map((p) => p.categoryId))];
  for (const categoryId of categories) {
    const picked = selectCampaigns({
      campaigns: CAMPAIGNS,
      products: customerProducts,
      isOrderable: isProductOrderable,
      catalog: { categoryId, searching: false, filtered: false, listSize: categoryId === 'all' ? 51 : 8 },
    });
    for (const [placement, entry] of Object.entries(picked)) {
      if (!entry) continue;
      const row = rowBySku.get(entry.product.sku);
      assert.equal(entry.product.id, row.id, `${placement}/${categoryId}: otro producto`);
      assert.equal(Number(entry.product.price), Number(row.price), `${placement}/${categoryId}: otro precio`);
      assert.equal(entry.product.alcoholic === true, row.is_alcoholic === true);
    }
  }
});

test('REAL: ningún combo del manifiesto se puede cobrar con el catálogo publicado, y cada uno explica por qué', () => {
  const resolved = resolveCombos(COMBO_MANIFEST, customerProducts);
  assert.equal(resolved.length, COMBO_MANIFEST.length);
  for (const combo of resolved) {
    assert.equal(combo.chargeable, false, `${combo.comboId}: se ofrece sin poder armarse`);
    assert.equal(combo.available, false);
    assert.equal(combo.promotionalPrice, null, `${combo.comboId}: inventa un precio de combo`);
    assert.ok(combo.blockers.length >= 1, `${combo.comboId}: bloqueado sin explicación`);
  }
});

/* ─── Sintético: las reglas de combo con un catálogo que sí los arma ──────── */

const completeCatalog = (overrides = {}) => {
  const skus = new Map();
  for (const combo of COMBO_MANIFEST) {
    for (const component of combo.components) {
      skus.set(component.sku, component);
      for (const sub of component.substitutions) if (!skus.has(sub)) skus.set(sub, { sku: sub, quantity: 1 });
    }
  }
  return [...skus.keys()].map((sku, index) => ({
    id: sku, sku, name: sku, price: 2000 + (index % 5) * 500, pricePending: false,
    available: true, stock: 24, alcoholic: true, ...overrides[sku],
  }));
};

test('SINTÉTICO: con todos los componentes publicados cada combo se cobra a su precio de combo y el ahorro cierra', () => {
  const resolved = resolveCombos(COMBO_MANIFEST, completeCatalog());
  for (const combo of resolved) {
    assert.equal(combo.chargeable, combo.approvalStatus === 'APROBADO_COMERCIAL', combo.comboId);
    const list = combo.components.reduce((sum, c) => sum + c.unitPrice * c.quantity, 0);
    assert.equal(combo.individualPrice, list, `${combo.comboId}: el precio individual no es la suma`);
    assert.equal(combo.promotionalPrice, roundPromotionalPrice(list * (1 - combo.discountPercentage / 100)));
    assert.equal(combo.savings, list - combo.promotionalPrice);
    assert.ok(combo.promotionalPrice <= list, `${combo.comboId}: el combo sale MÁS caro que sus partes`);
    assert.ok(combo.ageRestricted, `${combo.comboId}: lleva alcohol y no declara +18`);
  }
});

test('SINTÉTICO: un componente agotado, sin precio o ausente bloquea el combo entero; nunca lo completa con un número inventado', () => {
  const [first] = COMBO_MANIFEST;
  const sku = first.components[0].sku;
  const cases = {
    agotado: { [sku]: { stock: 0, available: false } },
    'sin precio': { [sku]: { pricePending: true, price: 0 } },
  };
  for (const [label, overrides] of Object.entries(cases)) {
    const combo = resolveCombos([first], completeCatalog(overrides))[0];
    assert.equal(combo.chargeable, false, `${label}: se puede cobrar`);
    assert.equal(combo.promotionalPrice, null, `${label}: inventa precio`);
    assert.ok(combo.blockers.some((text) => text.includes(sku)), `${label}: no nombra el componente`);
  }
  const missing = completeCatalog().filter((product) => product.sku !== sku);
  const absent = resolveCombos([first], missing)[0];
  assert.equal(absent.chargeable, false);
  assert.match(absent.blockers[0], /no está en el catálogo publicado/);
});

test('SINTÉTICO: el stock de un combo es el del componente limitante y no se promete más', () => {
  const combo = COMBO_MANIFEST.find((entry) => entry.components.length > 1) || COMBO_MANIFEST[0];
  const scarce = combo.components[0];
  // El primer componente alcanza para 3 combos; los demás tienen 24 unidades.
  const stock = scarce.quantity * 3 + 1;
  const resolved = resolveCombos([combo], completeCatalog({ [scarce.sku]: { stock } }))[0];
  const expected = Math.min(...combo.components.map((c) => Math.floor((c.sku === scarce.sku ? stock : 24) / c.quantity)));
  assert.equal(resolved.stock, expected, 'promete más combos que los que sostiene el componente más escaso');
  assert.ok(expected <= 3);
  const limiting = resolved.components.find((c) => c.maxCombos === expected);
  assert.equal(resolved.limitingSku, limiting.sku);
});

test('SINTÉTICO: un combo sin aprobación comercial no se cobra aunque se pueda armar', () => {
  const [first] = COMBO_MANIFEST;
  const combo = resolveCombos([{ ...first, approvalStatus: 'PENDIENTE' }], completeCatalog())[0];
  assert.equal(combo.available, true);
  assert.equal(combo.chargeable, false, 'se cobraría a la suma de los precios de lista');
});
