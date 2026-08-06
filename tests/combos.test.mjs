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

/*
 * Este contrato cambió al cerrar el bloqueante, y conviene entender por qué.
 *
 * Antes protegía que ningún combo se ofreciera para comprar, porque el backend
 * no sabía aplicar su descuento y ofrecerlo habría cobrado la suma de los
 * precios de lista. Eso dejó de ser cierto: `20260806250000` hace que el
 * backend derive el precio de lista de los precios que bloquea al reservar y
 * aplique el descuento aprobado.
 *
 * Lo que el test protegía —que un combo NUNCA se cobre a un precio que el
 * backend no vaya a aplicar— sigue protegido, ahora del lado correcto: el
 * manifiesto declara la aprobación y `chargeable` es lo único que habilita la
 * compra. Un combo aprobado pero no armable sigue sin ofrecerse.
 */
test('la aprobación comercial está declarada y es lo único que habilita cobrar', () => {
  for (const combo of COMBO_MANIFEST) {
    assert.equal(combo.approvalStatus, 'APROBADO_COMERCIAL', combo.comboId);
    assert.equal(combo.previewOnly, false, combo.comboId);
  }

  const csv = readFileSync(path.join(root, 'data/combos.csv'), 'utf8').trim().split(/\r?\n/);
  for (const line of csv.slice(1)) {
    assert.ok(line.includes('APROBADO_COMERCIAL'), `el manifiesto importable declara la aprobación: ${line.split(',')[0]}`);
    assert.ok(!line.includes('PENDIENTE_APROBACION_COMERCIAL'), 'el CSV no puede quedar desincronizado del runtime');
  }
});

test('un combo sin aprobación no se puede cobrar aunque se pueda armar entero', () => {
  const products = [
    { id: 'lata', sku: 'lata', name: 'Lata', price: 1000, stock: 50, available: true, alcoholic: false },
  ];
  const definicion = { comboId: 'combo-test', name: 'Test', discountPercentage: 10, components: [{ sku: 'lata', quantity: 6 }] };

  const aprobado = resolveCombo({ ...definicion, approvalStatus: 'APROBADO_COMERCIAL' }, products);
  assert.equal(aprobado.available, true);
  assert.equal(aprobado.chargeable, true);
  assert.equal(aprobado.promotionalPrice, 5400);

  const pendiente = resolveCombo({ ...definicion, approvalStatus: 'PENDIENTE_APROBACION_COMERCIAL' }, products);
  assert.equal(pendiente.available, true, 'se puede armar');
  assert.equal(pendiente.chargeable, false, 'pero no se puede cobrar');
});

test('un combo aprobado que perdió un componente deja de ser cobrable', () => {
  const combo = resolveCombo(
    {
      comboId: 'combo-test',
      approvalStatus: 'APROBADO_COMERCIAL',
      discountPercentage: 10,
      components: [{ sku: 'lata', quantity: 6 }, { sku: 'fantasma', quantity: 1 }],
    },
    [{ id: 'lata', sku: 'lata', name: 'Lata', price: 1000, stock: 50, available: true }],
  );
  assert.equal(combo.chargeable, false);
  assert.equal(combo.promotionalPrice, null, 'sin precio parcial');
  assert.ok(combo.blockers.some((blocker) => blocker.includes('fantasma')));
});

test('el manifiesto resuelve por SKU aunque el catálogo use UUID como id', () => {
  // Contra Supabase el `id` del producto es un UUID y el SKU comercial viaja
  // aparte. Con el índice por `id` solamente, la góndola productiva mostraba
  // cero combos: todos los componentes quedaban "fuera del catálogo".
  const combo = resolveCombo(
    { comboId: 'c', approvalStatus: 'APROBADO_COMERCIAL', discountPercentage: 10, components: [{ sku: 'heineken-original-lata-473ml', quantity: 6 }] },
    [{
      id: '6f1ca8f8-bd7b-4815-ae80-1874b1f8e481',
      sku: 'heineken-original-lata-473ml',
      name: 'Heineken',
      price: 3900,
      stock: 99,
      available: true,
      alcoholic: true,
    }],
  );
  assert.equal(combo.chargeable, true);
  assert.equal(combo.individualPrice, 23400);
  assert.equal(combo.promotionalPrice, 21000);
  assert.equal(combo.savings, 2400);
  assert.equal(combo.ageRestricted, true);
});

test('el manifiesto no guarda ningún precio: el precio siempre se deriva', () => {
  const source = readFileSync(path.join(root, 'js/combos-data.js'), 'utf8');
  for (const forbidden of ['price:', 'promotionalPrice', 'individualPrice', 'savings']) {
    assert.ok(!source.includes(forbidden), `combos-data.js no puede declarar ${forbidden}`);
  }
});
