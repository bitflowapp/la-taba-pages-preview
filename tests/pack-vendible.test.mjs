import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectPurchasePackaging,
  isSoldAsPack,
  publishRetailUnits,
} from '../js/core/retail-packaging.js';
import { isProductVisibleToCustomer } from '../js/core/catalog-store.js';
import { isCommerciallyPurchasable } from '../js/core/pricing.js';

/*
 * Un pack puede ser lo que se vende, y hay que decirlo.
 *
 * La regla vieja leía `unitsPerPack > 1` como dos cosas al mismo tiempo: «trae
 * doce» —un hecho— y «no se vende» —una decisión—. Con eso, un comercio que
 * abría vendiendo packs no podía vender nada: la góndola le escondía los cuatro
 * productos que tenía y ofrecía en su lugar cuatro unidades derivadas sin precio,
 * porque el precio de un pack no se divide en doce sin que alguien decida el
 * precio de la botella.
 *
 * Se midió en producción el 2026-08-18, con la tienda abierta y el catálogo
 * cargado: «Ninguno de estos 4 tiene precio publicado todavía».
 */

const PACK = {
  id: 'coca-cola-original-pack-12',
  name: 'Coca-Cola Original',
  brand: 'Coca-Cola',
  categoryId: 'gaseosas',
  variant: 'Botella PET · 500 ml · Pack x12',
  presentation: 'Botella PET · 500 ml · Pack x12',
  capacity: '500 ml',
  capacityValue: 500,
  capacityUnit: 'ml',
  packageType: 'Botella PET',
  unitsPerPack: 12,
  price: 17100,
  priceStatus: 'confirmed',
  stock: 8,
  available: true,
};

test('sin declarar nada, un pack sigue siendo abastecimiento', () => {
  // El comportamiento de siempre, intacto: quien no dice nada no cambia.
  const [pack, unidad] = publishRetailUnits([PACK]);
  assert.equal(pack.procurementOnly, true);
  assert.equal(isProductVisibleToCustomer(pack), false, 'el pack no va a la góndola');
  assert.ok(unidad, 'se publica una unidad derivada en su lugar');
  assert.equal(unidad.pricePending, true, 'la unidad nace sin precio: nadie lo decidió');
  assert.equal(isCommerciallyPurchasable(unidad), false);
});

test('declarado como venta, el pack se queda en góndola con su precio', () => {
  const resultado = publishRetailUnits([{ ...PACK, soldAsPack: true }]);

  assert.equal(resultado.length, 1, 'no se deriva ninguna unidad: el bulto YA es lo que se vende');
  const [pack] = resultado;
  assert.equal(pack.procurementOnly, undefined);
  assert.equal(isProductVisibleToCustomer(pack), true);
  assert.equal(isCommerciallyPurchasable(pack), true, 'se puede comprar');
  assert.equal(pack.price, 17100, 'con el precio que autorizó el comercio, sin dividir');
  assert.equal(pack.unitsPerPack, 12, 'y sin mentir sobre cuántas unidades trae');
});

test('el nombre público sigue diciendo que son doce', () => {
  // Que se venda entero no autoriza a ocultarle al cliente lo que se lleva.
  const [pack] = publishRetailUnits([{ ...PACK, soldAsPack: true }]);
  assert.match(pack.presentation, /Pack x12/);
});

test('un «pack» de una sola unidad no es un pack', () => {
  assert.equal(isSoldAsPack({ soldAsPack: true, unitsPerPack: 1 }), false);
  assert.equal(isSoldAsPack({ soldAsPack: true, unitsPerPack: 12 }), true);
  assert.equal(isSoldAsPack({ sold_as_pack: true, units_per_pack: 6 }), true);
});

test('la declaración es explícita: nada la infiere', () => {
  assert.equal(isSoldAsPack({ unitsPerPack: 12 }), false, 'traer doce no alcanza');
  assert.equal(isSoldAsPack({ soldAsPack: 'true', unitsPerPack: 12 }), false, 'el texto no cuenta');
  assert.equal(isSoldAsPack({ soldAsPack: 1, unitsPerPack: 12 }), false, 'el uno tampoco');
  assert.equal(isSoldAsPack({}), false);
  assert.equal(isSoldAsPack(), false);
});

test('declararlo no cambia el hecho estructural del empaque', () => {
  // `detectPurchasePackaging` sigue contestando lo mismo: sigue siendo un pack de
  // doce. Lo que cambia es qué hace el catálogo con esa respuesta.
  const empaque = detectPurchasePackaging({ ...PACK, soldAsPack: true });
  assert.equal(empaque.isPack, true);
  assert.equal(empaque.unitsPerPack, 12);
});

test('los packs de abastecimiento y los de venta conviven en un mismo catálogo', () => {
  const catalogo = publishRetailUnits([
    { ...PACK, soldAsPack: true },
    { ...PACK, id: 'sprite-pack-12', name: 'Sprite', brand: 'Sprite' },
  ]);

  const enGondola = catalogo.filter(isProductVisibleToCustomer);
  assert.equal(enGondola.length, 2, 'el pack vendible y la unidad derivada del otro');
  assert.ok(enGondola.some((p) => p.id === 'coca-cola-original-pack-12'));
  assert.ok(enGondola.every((p) => p.id !== 'sprite-pack-12'), 'el pack no declarado sigue oculto');
});
