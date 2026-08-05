import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyRetailNaming,
  canUseAsUnitBarcode,
  composeRetailName,
  detectPurchasePackaging,
  isPurchasePackBarcode,
  linkProcurementPacks,
  readMultiplierHint,
  retailPublicationReadiness,
  stripLogisticsFromName,
  unitsReceivedFromPurchase,
  applyUnitSale,
  validateRetailBarcode,
} from '../js/core/retail-packaging.js';
import { isPurchasableBeverageProduct } from '../js/core/beverage-home-sections.js';

// ── 1. Recepción de mercadería: un pack recibido suma sus unidades ───────────

test('un pack x6 recibido ingresa seis unidades al stock', () => {
  assert.equal(unitsReceivedFromPurchase({ purchaseUnit: 'pack', unitsPerPurchasePack: 6, quantity: 1 }), 6);
  assert.equal(unitsReceivedFromPurchase({ purchaseUnit: 'pack', unitsPerPurchasePack: 6, quantity: 2 }), 12);
  assert.equal(unitsReceivedFromPurchase({ purchaseUnit: 'caja', unitsPerPurchasePack: 12, quantity: 3 }), 36);
  assert.equal(unitsReceivedFromPurchase({ purchaseUnit: 'unidad', unitsPerPurchasePack: 1, quantity: 5 }), 5);
});

// ── 2. Venta: descuenta exactamente lo vendido ──────────────────────────────

test('vender una unidad descuenta una unidad', () => {
  assert.equal(applyUnitSale({ stockUnits: 12, quantity: 1 }), 11);
  assert.equal(applyUnitSale({ stockUnits: 12, quantity: 3 }), 9);
  assert.equal(applyUnitSale({ stockUnits: 1, quantity: 1 }), 0);
});

test('no se vende más de lo que hay ni con cantidades inválidas', () => {
  assert.equal(applyUnitSale({ stockUnits: 2, quantity: 3 }), null);
  assert.equal(applyUnitSale({ stockUnits: 5, quantity: 0 }), null);
  assert.equal(applyUnitSale({ stockUnits: 5, quantity: -1 }), null);
  assert.equal(applyUnitSale({ stockUnits: 5, quantity: 1.5 }), null);
  assert.equal(applyUnitSale({ stockUnits: 2.5, quantity: 1 }), null);
});

// ── 3. Nombre público sin información logística ─────────────────────────────

test('el nombre público no conserva pack, caja ni multiplicadores', () => {
  assert.equal(stripLogisticsFromName('PACK X6 COCA COLA ORIGINAL 2.25 LT'), 'COCA COLA ORIGINAL 2.25 LT');
  assert.equal(stripLogisticsFromName('CAJA HEINEKEN LATA 473CC X24'), 'HEINEKEN LATA 473CC');
  assert.equal(stripLogisticsFromName('FERNET BRANCA 750ML X6'), 'FERNET BRANCA 750ML');
  assert.equal(stripLogisticsFromName('Coca-Cola Original'), 'Coca-Cola Original');
  for (const nombre of ['PACK X6 COCA COLA', 'Six pack Quilmes', 'Bulto Heineken x24', 'Bandeja 24 latas']) {
    assert.doesNotMatch(stripLogisticsFromName(nombre), /\bx\s?\d|\bpack\b|\bcaja\b|\bbulto\b|\bbandeja\b/i, nombre);
  }
});

test('la variedad viaja al nombre sólo cuando agrega información', () => {
  assert.equal(composeRetailName({ name: 'Coca-Cola Original', variant: 'Original' }), 'Coca-Cola Original');
  assert.equal(composeRetailName({ name: 'Speed Unlimited', variant: 'Zero Sugar' }), 'Speed Unlimited Zero Sugar');
  assert.equal(composeRetailName({ name: 'Manaos', variant: 'Naranja' }), 'Manaos Naranja');
  assert.equal(composeRetailName({ name: 'Aperol', variant: '' }), 'Aperol');
});

// ── 4. El costo de compra nunca se publica ──────────────────────────────────

test('el dato de compra queda separado y sin costo inventado', () => {
  const catalogo = [
    { id: 'lata', brand: 'Heineken', categoryId: 'cervezas', name: 'Heineken', capacityValue: 473, capacityUnit: 'ml', unitsPerPack: 1, price: 3900, pricePending: false },
    { id: 'pack', brand: 'Heineken', categoryId: 'cervezas', name: 'Heineken', capacityValue: 473, capacityUnit: 'ml', unitsPerPack: 6, presentation: 'Lata · 473 ml · Pack x6', price: null, pricePending: true },
  ];
  const [lata, pack] = linkProcurementPacks(catalogo);

  assert.equal(pack.procurement.retailUnitId, 'lata');
  assert.equal(pack.procurement.unitsPerPurchasePack, 6);
  assert.equal(pack.procurement.purchaseUnit, 'pack');
  // Costo y código de pack existen como campos y quedan vacíos: no se inventan.
  assert.equal(pack.procurement.supplierPackCost, null);
  assert.equal(pack.procurement.supplierPackBarcode, null);
  // La unidad recibe la referencia inversa, no un precio derivado del pack.
  assert.equal(lata.purchasePack.productId, 'pack');
  assert.equal(lata.purchasePack.unitsPerPurchasePack, 6);
  assert.equal(lata.price, 3900);
  assert.ok(!('supplierPackCost' in lata));
});

// ── 5. Sin precio no hay compra ─────────────────────────────────────────────

test('un producto sin precio publicado sigue siendo no comprable', () => {
  const pendiente = { id: 'x', name: 'X', image: 'x.webp', pricePending: true, price: null, available: false, stock: 0 };
  assert.equal(isPurchasableBeverageProduct(pendiente), false);
  const readiness = retailPublicationReadiness(pendiente);
  assert.equal(readiness.purchasable, false);
  assert.ok(readiness.missing.includes('precio de venta unitario aprobado'));
});

// ── 6. Un pack que el local vende sigue siendo pack ─────────────────────────

test('un pack con precio y stock propios conserva su presentación de pack', () => {
  const pack = {
    id: 'coca-pack-6', brand: 'Coca-Cola', categoryId: 'gaseosas', name: 'Coca-Cola Original',
    presentation: 'Botella PET · 1500 ml · Pack x6', unitLabel: 'Pack x6', unitsPerPack: 6,
    capacityValue: 1500, capacityUnit: 'ml', price: 19999, pricePending: false,
    available: true, stock: 99, image: 'coca.webp',
  };
  const [resultado] = linkProcurementPacks([pack]);
  // Sin unidad suelta equivalente no hay vínculo de compra: el pack ES el producto.
  assert.equal(resultado.procurement, undefined);
  assert.equal(resultado.packaging.unitsPerPurchasePack, 6);
  assert.equal(resultado.unitLabel, 'Pack x6');
  assert.equal(isPurchasableBeverageProduct(resultado), true);
});

// ── 7 y 8. Códigos de barras ────────────────────────────────────────────────

test('el código de la caja no puede usarse como código de la unidad', () => {
  const gtin14 = '10750123456785'; // GTIN-14 válido (agrupación logística)
  const ean13 = '7790895000997'; // EAN-13 válido (unidad de consumo)
  assert.equal(validateRetailBarcode(gtin14).symbology, 'GTIN-14');
  assert.equal(isPurchasePackBarcode(gtin14), true);
  assert.equal(canUseAsUnitBarcode(gtin14), false);
  assert.equal(validateRetailBarcode(ean13).symbology, 'EAN-13');
  assert.equal(canUseAsUnitBarcode(ean13), true);
  assert.equal(isPurchasePackBarcode(ean13), false);
});

test('los ceros a la izquierda se conservan y el verificador se valida', () => {
  const conCeroInicial = '04963400'; // EAN-8 válido que empieza en 0
  const resultado = validateRetailBarcode(conCeroInicial);
  assert.equal(resultado.valid, true);
  assert.equal(resultado.symbology, 'EAN-8');
  assert.equal(resultado.normalized, '04963400');
  assert.equal(resultado.normalized.length, 8);
  // Un código no se rearma como número: 4963400 (sin el cero) ya no es válido.
  assert.equal(validateRetailBarcode('4963400').valid, false);
  // UPC-A con cero inicial: mismo criterio, la cadena manda.
  assert.equal(validateRetailBarcode('012345678905').symbology, 'UPC-A');
  assert.equal(validateRetailBarcode('012345678905').normalized, '012345678905');
  assert.equal(validateRetailBarcode('7790895000998').valid, false, 'verificador incorrecto');
  assert.equal(validateRetailBarcode('779089500099X').valid, false, 'no numérico');
  assert.equal(validateRetailBarcode('').valid, false);
});

// ── 9 y 10. Multiplicadores inválidos y ambiguos ────────────────────────────

test('un multiplicador inválido no produce unidades', () => {
  assert.equal(unitsReceivedFromPurchase({ purchaseUnit: 'pack', unitsPerPurchasePack: 0, quantity: 1 }), null);
  assert.equal(unitsReceivedFromPurchase({ purchaseUnit: 'pack', unitsPerPurchasePack: -6, quantity: 1 }), null);
  assert.equal(unitsReceivedFromPurchase({ purchaseUnit: 'pack', unitsPerPurchasePack: 1.5, quantity: 1 }), null);
  assert.equal(unitsReceivedFromPurchase({ purchaseUnit: 'pack', unitsPerPurchasePack: 1, quantity: 1 }), null);
  assert.equal(unitsReceivedFromPurchase({ purchaseUnit: 'bulto-raro', unitsPerPurchasePack: 6, quantity: 1 }), null);
  assert.equal(unitsReceivedFromPurchase({ purchaseUnit: 'pack', unitsPerPurchasePack: 6, quantity: 0 }), null);
});

test('un multiplicador contradictorio deja el producto ambiguo y sin conversión', () => {
  const contradictorio = {
    id: 'budweiser-pack', brand: 'Budweiser', categoryId: 'cervezas', name: 'Budweiser',
    presentation: 'Lata · 473 ml · Pack x6', unitLabel: 'Unidad', unitsPerPack: 1,
    capacityValue: 473, capacityUnit: 'ml',
  };
  const deteccion = detectPurchasePackaging(contradictorio);
  assert.equal(deteccion.ambiguous, true);
  assert.equal(deteccion.isPack, null);
  assert.equal(deteccion.unitsPerPack, null);
  assert.ok(deteccion.conflicts.length >= 1);

  // Y con el pack_count del catálogo de release en contra, también.
  assert.equal(detectPurchasePackaging({ unitsPerPack: 1, packCount: 6 }).ambiguous, true);
  // Coincidencia = sin ambigüedad.
  assert.equal(detectPurchasePackaging({ unitsPerPack: 6, packCount: 6, presentation: 'Pack x6' }).ambiguous, false);
  assert.equal(detectPurchasePackaging({ unitsPerPack: 6, packCount: 6, presentation: 'Pack x6' }).unitsPerPack, 6);
});

test('un producto ambiguo no se vincula ni se convierte', () => {
  const catalogo = [
    { id: 'unidad', brand: 'Budweiser', categoryId: 'cervezas', name: 'Budweiser', capacityValue: 473, capacityUnit: 'ml', unitsPerPack: 1 },
    { id: 'ambiguo', brand: 'Budweiser', categoryId: 'cervezas', name: 'Budweiser', capacityValue: 473, capacityUnit: 'ml', unitsPerPack: 1, presentation: 'Lata · 473 ml · Pack x6' },
  ];
  const [, ambiguo] = linkProcurementPacks(catalogo);
  assert.equal(ambiguo.procurement, undefined, 'no se vincula');
  assert.equal(ambiguo.packaging.ambiguous, true);
  assert.equal(ambiguo.unitsPerPack, 1, 'el multiplicador original no se toca');
  assert.ok(retailPublicationReadiness(ambiguo).missing.includes('empaque ambiguo: revisar multiplicador'));
});

test('la pista de multiplicador se lee sólo cuando es inequívoca', () => {
  assert.equal(readMultiplierHint({ presentation: 'Lata · 473 ml · Pack x6' }), 6);
  assert.equal(readMultiplierHint({ description: 'Pack de 12 botellas PET' }), 12);
  assert.equal(readMultiplierHint({ name: 'Bandeja 24' }), 24);
  assert.equal(readMultiplierHint({ presentation: 'Unidad' }), null);
  // Dos números distintos no son evidencia: son una alerta.
  assert.equal(readMultiplierHint({ presentation: 'Pack x6', description: 'Caja de 12 unidades' }), null);
});

// ── 11. La pasada minorista es idempotente ──────────────────────────────────

test('correr el modelo dos veces no vuelve a transformar nada', () => {
  const catalogo = [
    { id: 'lata', brand: 'Heineken', categoryId: 'cervezas', name: 'Heineken', capacityValue: 473, capacityUnit: 'ml', unitsPerPack: 1, stock: 12, price: 3900 },
    { id: 'pack', brand: 'Heineken', categoryId: 'cervezas', name: 'Heineken', capacityValue: 473, capacityUnit: 'ml', unitsPerPack: 6, presentation: 'Pack x6', stock: 0 },
    { id: 'speed-o', brand: 'Speed', categoryId: 'energizantes', name: 'Speed Unlimited', variant: 'Original', subcategory: 'original', capacityValue: 473, capacityUnit: 'ml', unitsPerPack: 1, stock: 5 },
    { id: 'speed-z', brand: 'Speed', categoryId: 'energizantes', name: 'Speed Unlimited', variant: 'Zero Sugar', subcategory: 'sin-azucar', capacityValue: 473, capacityUnit: 'ml', unitsPerPack: 1, stock: 5 },
  ];
  const pasada = (list) => linkProcurementPacks(applyRetailNaming(list));
  const una = pasada(catalogo);
  const dos = pasada(una);
  assert.deepEqual(dos, una, 'la segunda pasada no cambia nada');
  // Ni el stock ni el multiplicador se multiplican o dividen por correr de nuevo.
  assert.equal(dos.find((p) => p.id === 'lata').stock, 12);
  assert.equal(dos.find((p) => p.id === 'pack').packaging.unitsPerPurchasePack, 6);
  assert.equal(dos.find((p) => p.id === 'lata').purchasePack.unitsPerPurchasePack, 6);
});

// ── 12. Desambiguación de nombres sólo ante conflicto real ──────────────────

test('dos variedades distintas con el mismo nombre se desambiguan', () => {
  const catalogo = [
    { id: 'speed-o', brand: 'Speed', categoryId: 'energizantes', name: 'Speed Unlimited', variant: 'Original', subcategory: 'original' },
    { id: 'speed-z', brand: 'Speed', categoryId: 'energizantes', name: 'Speed Unlimited', variant: 'Zero Sugar', subcategory: 'sin-azucar' },
  ];
  const [original, zero] = applyRetailNaming(catalogo);
  assert.equal(original.name, 'Speed Unlimited Original');
  assert.equal(zero.name, 'Speed Unlimited Zero Sugar');
});

test('dos filas del mismo producto NO se disfrazan de productos distintos', () => {
  // Mismo producto duplicado entre dos orígenes del catálogo: misma variedad.
  const duplicado = [
    { id: 'monster-a', brand: 'Monster', categoryId: 'energizantes', name: 'Monster Mango Loco', variant: 'Mango Loco', subcategory: 'juice-monster' },
    { id: 'monster-b', brand: 'Monster', categoryId: 'energizantes', name: 'Monster Mango Loco', variant: 'Mango Loco', subcategory: 'mango-loco' },
  ];
  const resultado = applyRetailNaming(duplicado);
  assert.equal(resultado[0].name, 'Monster Mango Loco');
  assert.equal(resultado[1].name, 'Monster Mango Loco', 'se consolidan, no se renombran');

  // Misma subcategoría con variedades sinónimas tampoco inventa distinción.
  const corona = [
    { id: 'corona-a', brand: 'Corona', categoryId: 'cervezas', name: 'Corona Extra', variant: 'Extra', subcategory: 'lager' },
    { id: 'corona-b', brand: 'Corona', categoryId: 'cervezas', name: 'Corona Extra', variant: 'Lager', subcategory: 'lager' },
  ];
  assert.deepEqual(applyRetailNaming(corona).map((p) => p.name), ['Corona Extra', 'Corona Extra']);
});

// ── 17 y 18. Identidad estable: deep links y favoritos ──────────────────────

test('la pasada minorista nunca cambia id ni sku', () => {
  const catalogo = [
    { id: 'a', sku: 'sku-a', brand: 'Speed', categoryId: 'energizantes', name: 'Speed Unlimited', variant: 'Original', subcategory: 'original', unitsPerPack: 1, capacityValue: 473, capacityUnit: 'ml' },
    { id: 'b', sku: 'sku-b', brand: 'Speed', categoryId: 'energizantes', name: 'Speed Unlimited', variant: 'Zero Sugar', subcategory: 'sin-azucar', unitsPerPack: 1, capacityValue: 473, capacityUnit: 'ml' },
    { id: 'c', sku: 'sku-c', brand: 'Speed', categoryId: 'energizantes', name: 'Speed Unlimited', variant: 'Original', subcategory: 'original', unitsPerPack: 6, presentation: 'Pack x6', capacityValue: 473, capacityUnit: 'ml' },
  ];
  const resultado = linkProcurementPacks(applyRetailNaming(catalogo));
  assert.deepEqual(resultado.map((p) => p.id), ['a', 'b', 'c']);
  assert.deepEqual(resultado.map((p) => p.sku), ['sku-a', 'sku-b', 'sku-c']);
});

// ── 19. Producto sin imagen de la unidad ────────────────────────────────────

test('un producto sin imagen de la unidad se reporta pendiente, no se inventa una', () => {
  const sinImagen = { id: 'x', name: 'Fernet Branca', capacityValue: 750, capacityUnit: 'ml', price: 100, pricePending: false, stock: 3, image: '', imageThumbnail: '' };
  const readiness = retailPublicationReadiness(sinImagen);
  assert.ok(readiness.missing.includes('imagen de la unidad'));
  assert.equal(readiness.ready, false);
  const conImagen = retailPublicationReadiness({ ...sinImagen, image: 'unidad.webp' });
  assert.ok(!conImagen.missing.includes('imagen de la unidad'));
});

test('sin código de barras de la unidad el producto no está listo para publicar', () => {
  const readiness = retailPublicationReadiness({ id: 'x', name: 'X', capacityValue: 473, capacityUnit: 'ml', price: 1000, pricePending: false, stock: 4, image: 'x.webp' });
  assert.ok(readiness.missing.includes('código de barras de la unidad'));
  const conCodigo = retailPublicationReadiness({ id: 'x', name: 'X', capacityValue: 473, capacityUnit: 'ml', price: 1000, pricePending: false, stock: 4, image: 'x.webp', gtin: '7790895000997' });
  assert.equal(conCodigo.ready, true);
  assert.equal(conCodigo.purchasable, false, 'la comprabilidad sigue siendo del contrato existente');
});
