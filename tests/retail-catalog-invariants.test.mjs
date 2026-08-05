// Invariantes minoristas sobre el catálogo REAL que ve el cliente.
//
// El archivo de arriba (`retail-packaging.test.mjs`) prueba el modelo con
// fixtures. Éste lo aplica al catálogo que la demo publica de verdad: es el que
// detecta que una importación futura vuelva a meter un pack mayorista en la
// góndola o un nombre que el cliente no puede distinguir del de al lado.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyRetailCatalogModel,
  getCustomerCatalogProducts,
  normalizeCatalogProduct,
} from '../js/core/catalog-store.js';
import { isPurchasableBeverageProduct } from '../js/core/beverage-home-sections.js';
import { detectPurchasePackaging, retailPublicationReadiness } from '../js/core/retail-packaging.js';
// El runner sirve un catálogo fixture por `tests/test-bootstrap.mjs`, así que
// el catálogo comercial real se importa directo —igual que en
// `approved-beverage-demo.test.mjs`— y se pasa por el mismo funnel que la app.
import { products as commercialProducts } from '../js/approved-beverage-demo-data.js';

const catalog = applyRetailCatalogModel(
  commercialProducts.map((product) => normalizeCatalogProduct(product)).filter(Boolean),
);
const visible = getCustomerCatalogProducts(catalog);
const purchasable = visible.filter(isPurchasableBeverageProduct);
const norm = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

test('ningún nombre público arrastra información logística del proveedor', () => {
  for (const product of visible) {
    assert.doesNotMatch(
      product.name,
      /\bx\s?\d{1,3}\b|\bpack\b|\bcaja\b|\bbulto\b|\bbandeja\b|\bsix\s?pack\b/i,
      `${product.id}: "${product.name}"`,
    );
  }
});

test('dos productos comprables nunca se ven iguales en la góndola', () => {
  const seen = new Map();
  for (const product of purchasable) {
    const key = `${norm(product.brand)}|${norm(product.name)}|${product.capacityValue}${norm(product.capacityUnit)}|${norm(product.unitLabel)}`;
    assert.equal(seen.has(key), false, `${product.id} se ve idéntico a ${seen.get(key)}`);
    seen.set(key, product.id);
  }
});

test('el dato de compra existe sólo como bloque interno y sin costo inventado', () => {
  const conProcurement = catalog.filter((product) => product.procurement);
  assert.ok(conProcurement.length > 0, 'el catálogo tiene al menos un pack de compra identificado');
  for (const pack of conProcurement) {
    assert.equal(pack.procurement.supplierPackCost, null, pack.id);
    assert.equal(pack.procurement.supplierPackBarcode, null, pack.id);
    assert.ok(pack.procurement.unitsPerPurchasePack > 1, pack.id);
    const unit = catalog.find((product) => product.id === pack.procurement.retailUnitId);
    assert.ok(unit, `${pack.id}: la unidad vinculada existe`);
    assert.equal(unit.purchasePack.productId, pack.id);
    assert.equal(unit.purchasePack.unitsPerPurchasePack, pack.procurement.unitsPerPurchasePack);
    // La unidad conserva SU precio: nunca uno derivado del pack.
    assert.ok(!('supplierPackCost' in unit), unit.id);
  }
});

test('ningún producto del cliente expone costo, proveedor ni margen', () => {
  const prohibidos = ['cost', 'costo', 'wholesale', 'supplier', 'proveedor', 'margin', 'margen'];
  for (const product of visible) {
    for (const key of Object.keys(product)) {
      if (key === 'procurement' || key === 'purchasePack') continue;
      assert.equal(
        prohibidos.some((token) => key.toLowerCase().includes(token)),
        false,
        `${product.id} expone ${key} fuera del bloque de compra`,
      );
    }
  }
});

test('ningún producto con empaque ambiguo es comprable', () => {
  const ambiguos = visible.filter((product) => detectPurchasePackaging(product).ambiguous);
  for (const product of ambiguos) {
    assert.equal(isPurchasableBeverageProduct(product), false, `${product.id} es ambiguo y comprable`);
  }
});

test('todo producto comprable declara una presentación de venta legible', () => {
  for (const product of purchasable) {
    assert.ok(String(product.unitLabel || '').trim(), `${product.id} sin unitLabel`);
    assert.ok(Number(product.capacityValue) > 0, `${product.id} sin contenido`);
    assert.ok(String(product.capacityUnit || '').trim(), `${product.id} sin unidad de contenido`);
    // La presentación de un pack lo dice; la de una unidad, también.
    const packaging = detectPurchasePackaging(product);
    if (packaging.isPack) {
      assert.match(product.unitLabel, /pack|caja|bandeja/i, `${product.id}: un pack tiene que decirlo`);
    } else {
      assert.doesNotMatch(product.unitLabel, /pack|caja|bandeja|bulto/i, `${product.id}: una unidad no puede decir pack`);
    }
  }
});

test('ningún producto comprable queda sin precio ni muestra cero', () => {
  for (const product of purchasable) {
    assert.equal(product.pricePending, false, product.id);
    assert.ok(Number(product.price) > 0, `${product.id} con precio ${product.price}`);
  }
});

test('el informe de publicación identifica exactamente lo que falta conseguir', () => {
  const faltantes = new Map();
  for (const product of visible) {
    for (const missing of retailPublicationReadiness(product).missing) {
      faltantes.set(missing, (faltantes.get(missing) || 0) + 1);
    }
  }
  // Hoy el catálogo no tiene ni un código de barras cargado: si alguna
  // importación futura los trae, este número baja y el informe lo refleja.
  assert.equal(faltantes.get('código de barras de la unidad'), visible.length);
  assert.ok(faltantes.get('precio de venta unitario aprobado') > 0);
});
