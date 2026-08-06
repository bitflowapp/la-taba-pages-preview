import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { COMBO_MANIFEST } from '../js/combos-data.js';
import { products as rawCatalog } from '../js/approved-beverage-demo-data.js';
import { getCustomerCatalogProducts } from '../js/core/catalog-store.js';
import { resolveCombo, resolveCombos, roundPromotionalPrice } from '../js/core/combos.js';

const root = path.resolve(import.meta.dirname, '..');
// El catálogo del CLIENTE, no el crudo. La diferencia no es cosmética: el crudo
// todavía trae los packs de abastecimiento, que la góndola no publica como
// unidad de venta. Un combo verificado contra el crudo pasaría en test y no
// tendría componentes en la app, que es exactamente lo que pasó al armar los
// primeros siete: dos combos de gaseosa cerraban en Node y en la home no
// existían. El test corre contra lo que el cliente ve.
const products = getCustomerCatalogProducts(rawCatalog);
const resolved = resolveCombos(COMBO_MANIFEST, products);

test('todos los combos se arman con componentes de precio y stock confirmados', () => {
  for (const combo of resolved) {
    assert.deepEqual(combo.blockers, [], `${combo.comboId} tiene bloqueantes`);
    assert.equal(combo.available, true, `${combo.comboId} no está disponible`);
  }
  assert.equal(resolved.length, 7);
});

test('el precio individual es la suma de los componentes vivos, no un número guardado', () => {
  const byId = new Map(products.map((product) => [product.id, product]));
  for (const combo of resolved) {
    const expected = combo.components.reduce(
      (total, component) => total + byId.get(component.sku).price * component.quantity,
      0,
    );
    assert.equal(combo.individualPrice, expected, `${combo.comboId}`);
  }
});

test('el ahorro anunciado es exactamente la diferencia y nunca es menor que el real', () => {
  for (const combo of resolved) {
    assert.equal(combo.savings, combo.individualPrice - combo.promotionalPrice, `${combo.comboId}`);
    assert.ok(combo.savings > 0, `${combo.comboId} no ahorra nada`);
    // El redondeo a la centena inferior sólo puede AGRANDAR el ahorro.
    const sinRedondear = combo.individualPrice * (1 - combo.discountPercentage / 100);
    assert.ok(combo.promotionalPrice <= sinRedondear, `${combo.comboId} redondeó para arriba`);
    assert.equal(combo.promotionalPrice % 100, 0, `${combo.comboId} no cierra en centena`);
  }
});

test('el stock del combo es el del componente limitante', () => {
  const byId = new Map(products.map((product) => [product.id, product]));
  for (const combo of resolved) {
    const expected = Math.min(...combo.components.map(
      (component) => Math.floor(byId.get(component.sku).stock / component.quantity),
    ));
    assert.equal(combo.stock, expected, `${combo.comboId}`);
    assert.ok(combo.limitingSku, `${combo.comboId} no declara componente limitante`);
  }
});

test('la restricción +18 de un componente se propaga al combo entero', () => {
  const byId = new Map(products.map((product) => [product.id, product]));
  for (const combo of resolved) {
    const alguno = combo.components.some((component) => byId.get(component.sku).alcoholic);
    assert.equal(combo.ageRestricted, alguno, `${combo.comboId}`);
    assert.equal(combo.minimumAge, alguno ? 18 : null, `${combo.comboId}`);
  }
  // Birra y energía mezcla cerveza con energizante: el combo entero es +18.
  const mixto = resolved.find((combo) => combo.comboId === 'combo-birra-y-energia');
  assert.equal(mixto.ageRestricted, true);
});

test('una sustitución sólo se ofrece si existe, se puede comprar y vale lo mismo', () => {
  const byId = new Map(products.map((product) => [product.id, product]));
  for (const combo of resolved) {
    for (const component of combo.components) {
      const base = byId.get(component.sku);
      for (const substitution of component.substitutions) {
        const candidate = byId.get(substitution.sku);
        assert.ok(candidate, `${substitution.sku} no existe`);
        assert.equal(candidate.price, base.price, `${substitution.sku} no vale lo mismo que ${component.sku}`);
        assert.equal(candidate.pricePending, false);
        assert.equal(candidate.available, true);
      }
    }
  }
  const previa = resolved.find((combo) => combo.comboId === 'combo-previa-imperial-x6');
  assert.equal(previa.components[0].substitutions.length, 3);
});

test('un componente sin precio confirmado bloquea el combo en vez de completarlo', () => {
  const conPendiente = {
    comboId: 'combo-de-prueba',
    discountPercentage: 10,
    components: [
      { sku: 'imperial-golden-lata-473ml', quantity: 2 },
      { sku: 'sprite-sin-azucar-600ml', quantity: 1 },
    ],
  };
  const combo = resolveCombo(conPendiente, products);
  assert.equal(combo.available, false);
  assert.equal(combo.individualPrice, null);
  assert.equal(combo.promotionalPrice, null);
  assert.equal(combo.savings, null);
  assert.ok(combo.blockers.some((reason) => reason.includes('precio pendiente')));
});

test('un componente inexistente bloquea el combo y lo dice por SKU', () => {
  const combo = resolveCombo(
    { comboId: 'x', discountPercentage: 10, components: [{ sku: 'no-existe', quantity: 1 }] },
    products,
  );
  assert.equal(combo.available, false);
  assert.ok(combo.blockers.some((reason) => reason.startsWith('no-existe:')));
});

test('el redondeo del precio promocional baja a la centena', () => {
  assert.equal(roundPromotionalPrice(15840), 15800);
  assert.equal(roundPromotionalPrice(21060), 21000);
  assert.equal(roundPromotionalPrice(35998.2), 35900);
  assert.equal(roundPromotionalPrice(10500), 10500);
});

test('el manifiesto importable declara los mismos combos que el runtime', () => {
  const csv = readFileSync(path.join(root, 'data/combos.csv'), 'utf8').trim().split(/\r?\n/);
  const ids = csv.slice(1).map((line) => line.split(',')[0]);
  assert.deepEqual(ids, COMBO_MANIFEST.map((combo) => combo.comboId));
});

test('ningún combo se publica sin la aprobación comercial de Operaciones', () => {
  for (const combo of COMBO_MANIFEST) {
    assert.equal(combo.approvalStatus, 'PENDIENTE_APROBACION_COMERCIAL', combo.comboId);
    assert.equal(combo.previewOnly, true, combo.comboId);
  }
});

test('el manifiesto no guarda ningún precio: el precio siempre se deriva', () => {
  const source = readFileSync(path.join(root, 'js/combos-data.js'), 'utf8');
  for (const forbidden of ['price:', 'promotionalPrice', 'individualPrice', 'savings']) {
    assert.ok(!source.includes(forbidden), `combos-data.js no puede declarar ${forbidden}`);
  }
});
