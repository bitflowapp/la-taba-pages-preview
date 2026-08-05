// Publicación minorista · el pack abastece, la unidad se vende.
//
// Cubre la decisión comercial sobre el catálogo REAL (el runner sirve un
// fixture, así que el catálogo comercial se importa directo y se pasa por el
// mismo funnel que usa la app) y sobre fixtures mínimas para los casos que el
// catálogo todavía no tiene.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyRetailCatalogModel,
  getCustomerCatalogProducts,
  isProductOrderable,
  normalizeCatalogProduct,
} from '../js/core/catalog-store.js';
import { isPurchasableBeverageProduct } from '../js/core/beverage-home-sections.js';
import {
  RETAIL_UNIT_PLACEHOLDER_IMAGE,
  deriveRetailUnitFromPack,
  deriveRetailUnitId,
  publishRetailUnits,
  resolveRetailProductId,
  retailCapacityLabel,
  unitsReceivedFromPurchase,
} from '../js/core/retail-packaging.js';
import { getCartRecommendations } from '../js/core/cart-recommendations.js';
import { products as commercialProducts } from '../js/approved-beverage-demo-data.js';

const catalog = applyRetailCatalogModel(
  commercialProducts.map((product) => normalizeCatalogProduct(product)).filter(Boolean),
);
const visible = getCustomerCatalogProducts(catalog);
const purchasable = visible.filter(isPurchasableBeverageProduct);
const byId = (id) => catalog.find((product) => product.id === id);

// Los nueve packs sobre los que se tomó la decisión comercial.
const NINE_PACKS = [
  'coca-cola-original-pet-500ml-pack-12',
  'coca-cola-zero-pet-500ml-pack-12',
  'sprite-original-pet-500ml-pack-12',
  'coca-cola-original-pet-1500ml-pack-6',
  'coca-cola-zero-pet-1500ml-pack-6',
  'sprite-original-pet-1500ml-pack-6',
  'fanta-naranja-pet-1500ml-pack-6',
  'schweppes-tonica-pet-1500ml-pack-6',
  'schweppes-citrus-pet-1500ml-pack-6',
];

// ── 1 y 2. Los packs salen de la góndola; las unidades aparecen ──────────────

test('los nueve packs dejan la góndola y quedan como abastecimiento', () => {
  for (const id of NINE_PACKS) {
    const pack = byId(id);
    assert.ok(pack, id);
    assert.equal(pack.procurementOnly, true, `${id} sigue en góndola`);
    assert.equal(visible.some((product) => product.id === id), false, `${id} visible al cliente`);
    assert.equal(isProductOrderable(pack), false, `${id} se puede pedir`);
    assert.equal(isPurchasableBeverageProduct(pack), false, `${id} figura como comprable`);
    // No se borró: conserva identidad e historial.
    assert.equal(pack.id, id);
    assert.ok(pack.retailUnitId, `${id} sin unidad vinculada`);
  }
});

test('cada pack publica su unidad minorista, visible y con contenido correcto', () => {
  for (const id of NINE_PACKS) {
    const pack = byId(id);
    const unit = byId(pack.retailUnitId);
    assert.ok(unit, `${id}: falta la unidad`);
    assert.equal(visible.some((product) => product.id === unit.id), true, `${unit.id} no está en góndola`);
    assert.equal(unit.unitsPerPack, 1, unit.id);
    assert.equal(unit.unitLabel, 'Unidad', unit.id);
    // El contenido de la unidad es el que el pack ya declaraba por botella.
    assert.equal(unit.capacityValue, pack.capacityValue, unit.id);
    assert.equal(unit.capacityUnit, pack.capacityUnit, unit.id);
    assert.equal(unit.brand, pack.brand, unit.id);
    assert.equal(unit.categoryId, pack.categoryId, unit.id);
    assert.equal(unit.purchasePack.productId, pack.id, unit.id);
    assert.equal(unit.purchasePack.unitsPerPurchasePack, pack.unitsPerPack, unit.id);
  }
});

// ── 3. Ningún nombre ni presentación pública arrastra el empaque ─────────────

test('ninguna unidad publicada arrastra pack, caja ni multiplicador', () => {
  for (const id of NINE_PACKS) {
    const unit = byId(byId(id).retailUnitId);
    assert.doesNotMatch(unit.name, /\bpack\b|\bcaja\b|\bbulto\b|x\s?\d/i, unit.id);
    assert.doesNotMatch(unit.presentation, /\bpack\b|\bcaja\b|\bbulto\b|x\s?\d/i, unit.id);
    assert.doesNotMatch(unit.description || '', /\bpack\b|\bcaja\b|\bbulto\b|x\s?\d/i, unit.id);
  }
});

test('la capacidad se lee en góndola: 1500 ml es 1,5 L', () => {
  assert.equal(retailCapacityLabel(1500, 'ml'), '1,5 L');
  assert.equal(retailCapacityLabel(2250, 'ml'), '2,25 L');
  assert.equal(retailCapacityLabel(500, 'ml'), '500 ml');
  assert.equal(retailCapacityLabel(4000, 'g'), '4 kg');
  assert.equal(byId('coca-cola-original-pet-1500ml').presentation, 'Botella PET · 1,5 L · Unidad');
});

// ── 4 y 5. Precio: no se divide y sin precio no hay compra ───────────────────

test('el precio del pack no se divide ni se traslada a la unidad', () => {
  for (const id of NINE_PACKS) {
    const pack = byId(id);
    const unit = byId(pack.retailUnitId);
    assert.equal(unit.price, null, `${unit.id} recibió un precio`);
    assert.equal(unit.pricePending, true, unit.id);
    assert.notEqual(unit.price, pack.price, unit.id);
    // Y no aparece ningún importe derivado del pack en el registro.
    const derivado = pack.price / pack.unitsPerPack;
    assert.equal(JSON.stringify(unit).includes(String(Math.round(derivado))), false, `${unit.id} contiene ${derivado}`);
  }
});

test('sin precio la unidad no es comprable ni ofrece Agregar', () => {
  for (const id of NINE_PACKS) {
    const unit = byId(byId(id).retailUnitId);
    assert.equal(isPurchasableBeverageProduct(unit), false, unit.id);
    assert.equal(isProductOrderable(unit), false, unit.id);
    assert.equal(unit.available, false, unit.id);
  }
});

test('ningún producto comprable muestra cero', () => {
  for (const product of purchasable) {
    assert.ok(Number(product.price) > 0, `${product.id} con precio ${product.price}`);
    assert.equal(product.pricePending, false, product.id);
  }
  assert.ok(purchasable.length > 0);
});

// ── 6. Nada sin precio ni de abastecimiento entra en las sugerencias ─────────

test('las sugerencias del carrito excluyen packs de abastecimiento y pendientes', () => {
  const cerveza = purchasable.find((product) => product.alcoholic);
  assert.ok(cerveza, 'el catálogo tiene una cerveza comprable');
  const recomendacion = getCartRecommendations({
    products: catalog,
    cart: [{ productId: cerveza.id, quantity: 1 }],
    maxItems: 8,
  });
  for (const product of recomendacion.products) {
    assert.equal(product.procurementOnly, undefined, `${product.id} es abastecimiento`);
    assert.equal(product.pricePending, false, product.id);
    assert.ok(Number(product.price) > 0, product.id);
  }
});

// ── 5 y 11. Stock: cero se queda en cero y no se transforma ─────────────────

test('el stock del pack no se convierte en stock de la unidad', () => {
  for (const id of NINE_PACKS) {
    const pack = byId(id);
    const unit = byId(pack.retailUnitId);
    assert.equal(unit.stock, 0, `${unit.id} recibió stock`);
    assert.notEqual(unit.stock, pack.stock * pack.unitsPerPack, unit.id);
  }
  // La regla futura queda escrita y probada, pero no se aplicó a estos datos.
  assert.equal(unitsReceivedFromPurchase({ purchaseUnit: 'pack', unitsPerPurchasePack: 6, quantity: 2 }), 12);
});

test('la publicación es idempotente: correrla dos veces no duplica ni multiplica', () => {
  const una = applyRetailCatalogModel(commercialProducts.map((product) => normalizeCatalogProduct(product)).filter(Boolean));
  const dos = applyRetailCatalogModel(una);
  assert.equal(dos.length, una.length, 'se crearon unidades de más');
  assert.deepEqual(dos.map((product) => product.id).sort(), una.map((product) => product.id).sort());
  for (const id of NINE_PACKS) {
    const antes = una.find((product) => product.id === deriveRetailUnitId(id));
    const despues = dos.find((product) => product.id === deriveRetailUnitId(id));
    assert.equal(despues.stock, antes.stock, id);
    assert.equal(despues.price, antes.price, id);
    assert.equal(despues.unitsPerPack, antes.unitsPerPack, id);
  }
});

// ── 10 y 12. Empaque ambiguo e imágenes ─────────────────────────────────────

test('el producto de empaque ambiguo no se convierte ni se publica como unidad', () => {
  const ambiguo = byId('budweiser-lata-473ml-pack-6-local');
  assert.ok(ambiguo);
  assert.equal(ambiguo.procurementOnly, undefined, 'se tocó un producto ambiguo');
  assert.equal(ambiguo.retailUnitId, undefined);
  assert.equal(ambiguo.unitsPerPack, 1, 'se cambió su multiplicador');
  assert.equal(catalog.some((product) => product.retailUnitDerivedFrom === ambiguo.id), false);
  // Sigue visible como estaba y sin poder comprarse.
  assert.equal(isPurchasableBeverageProduct(ambiguo), false);
});

test('la imagen del pack no se presenta como imagen de la unidad', () => {
  for (const id of NINE_PACKS) {
    const pack = byId(id);
    const unit = byId(pack.retailUnitId);
    assert.notEqual(unit.image, pack.image, `${unit.id} reutiliza la foto del pack`);
    assert.equal(unit.image, RETAIL_UNIT_PLACEHOLDER_IMAGE, unit.id);
    assert.equal(unit.imagePending, true, unit.id);
  }
});

// ── 13 y 14. El dato de compra no se filtra; los ids son estables ───────────

test('la unidad no expone costo, proveedor ni multiplicador de compra en su superficie', () => {
  const unit = byId('coca-cola-original-pet-1500ml');
  const prohibidos = ['cost', 'wholesale', 'supplier', 'proveedor', 'margen'];
  for (const key of Object.keys(unit)) {
    if (key === 'purchasePack') continue;
    assert.equal(prohibidos.some((token) => key.toLowerCase().includes(token)), false, `${unit.id} expone ${key}`);
  }
  // El bloque de compra del pack conserva el costo en null: nunca se inventa.
  const pack = byId('coca-cola-original-pet-1500ml-pack-6');
  assert.equal(pack.procurement.supplierPackCost, null);
  assert.equal(pack.procurement.supplierPackBarcode, null);
});

test('ningún id ni sku existente cambia al publicar', () => {
  for (const original of commercialProducts) {
    const conservado = byId(original.id);
    assert.ok(conservado, `${original.id} desapareció del catálogo`);
    assert.equal(conservado.sku, original.sku, original.id);
  }
});

// ── 9 y 10. Enlaces viejos y favoritos siguen resolviendo ───────────────────

test('un enlace o favorito al pack resuelve a la unidad que lo reemplazó', () => {
  for (const id of NINE_PACKS) {
    const destino = resolveRetailProductId(catalog, id);
    assert.equal(destino, byId(id).retailUnitId, id);
    assert.ok(getCustomerCatalogProducts(catalog).some((product) => product.id === destino), destino);
  }
  // Un producto normal no se redirige, y un id desconocido tampoco.
  assert.equal(resolveRetailProductId(catalog, 'heineken-original-lata-473ml'), 'heineken-original-lata-473ml');
  assert.equal(resolveRetailProductId(catalog, 'no-existe'), 'no-existe');
});

// ── Casos que el catálogo real no tiene ─────────────────────────────────────

test('CASO A: con la unidad ya publicada, el pack sólo se vincula y no duplica la tarjeta', () => {
  const base = [
    { id: 'lata', brand: 'Heineken', categoryId: 'cervezas', name: 'Heineken', capacityValue: 473, capacityUnit: 'ml', unitsPerPack: 1, price: 3900, pricePending: false, available: true, stock: 9, image: 'lata.webp' },
    { id: 'lata-pack-6', brand: 'Heineken', categoryId: 'cervezas', name: 'Heineken', capacityValue: 473, capacityUnit: 'ml', unitsPerPack: 6, presentation: 'Lata · 473 ml · Pack x6', price: null, pricePending: true, available: false, stock: 0, image: 'pack.webp' },
  ];
  const resultado = publishRetailUnits(base.map((product) => ({ ...product, procurement: product.unitsPerPack > 1 ? { retailUnitId: 'lata' } : undefined })));
  assert.equal(resultado.length, 2, 'se creó una unidad de más');
  assert.equal(resultado.find((product) => product.id === 'lata-pack-6').procurementOnly, true);
  assert.equal(resultado.find((product) => product.id === 'lata').procurementOnly, undefined);
});

test('CASO B con id ocupado: no se pisa un producto existente', () => {
  const base = [
    { id: 'agua', brand: 'Glaciar', categoryId: 'aguas', name: 'Glaciar', capacityValue: 500, capacityUnit: 'ml', unitsPerPack: 1 },
    { id: 'agua-pack-6', brand: 'Glaciar', categoryId: 'aguas', name: 'Glaciar', capacityValue: 1500, capacityUnit: 'ml', unitsPerPack: 6, presentation: 'Pack x6' },
  ];
  // El id derivado de `agua-pack-6` sería `agua`, que ya existe con otra capacidad.
  const resultado = publishRetailUnits(base);
  assert.equal(resultado.length, 2, 'se pisó o duplicó un id existente');
  assert.equal(resultado.find((product) => product.id === 'agua-pack-6').procurementOnly, true);
  assert.equal(resultado.find((product) => product.id === 'agua').capacityValue, 500);
});

test('deriveRetailUnitFromPack no inventa precio, stock, código ni imagen', () => {
  const unidad = deriveRetailUnitFromPack({
    id: 'x-pack-6', brand: 'Marca', name: 'Producto', variant: 'Original', categoryId: 'gaseosas',
    capacityValue: 1500, capacityUnit: 'ml', packageType: 'botella-pet', unitsPerPack: 6,
    price: 19999, stock: 99, available: true, image: 'pack.webp', gtin: '7790895000997',
  });
  assert.equal(unidad.id, 'x-pack-6'.replace('-pack-6', ''));
  assert.equal(unidad.price, null);
  assert.equal(unidad.stock, 0);
  assert.equal(unidad.available, false);
  assert.equal(unidad.gtin, '');
  assert.equal(unidad.image, RETAIL_UNIT_PLACEHOLDER_IMAGE);
  assert.equal(unidad.unitsPerPack, 1);
  assert.equal(unidad.purchasePack.unitsPerPurchasePack, 6);
});
