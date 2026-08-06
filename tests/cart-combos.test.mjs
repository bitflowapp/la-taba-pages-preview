import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import {
  addComboToCart,
  addToCart,
  clearCart,
  decrementComboItem,
  getAvailableCombos,
  getCartCombos,
  getCartSummary,
  committedProductQuantity,
  removeComboItem,
  validateCartForCheckout,
} from '../js/cart.js';
import { resetState, state } from './helpers.mjs';

/*
 * El bootstrap de tests reemplaza el catálogo por un fixture QA aislado, así
 * que estos tests arman el suyo con los SKU que el manifiesto de combos
 * referencia de verdad. Los precios son los del catálogo comercial: sirven para
 * que los números del ahorro sean los reales y no unos inventados que
 * esconderían un error de redondeo.
 */
const HEINEKEN = 'heineken-original-lata-473ml';
const RED_BULL = 'red-bull-original-lata-250ml';
const SPEED = 'speed-original-lata-473ml';

function producto(sku, name, price, { alcoholic = false, stock = 99 } = {}) {
  return {
    id: sku,
    sku,
    externalId: sku,
    name,
    description: 'Fixture de combos',
    categoryId: alcoholic ? 'cervezas' : 'energizantes',
    price,
    stock,
    available: true,
    unit: 'unidad',
    unitLabel: 'Unidad',
    unitsPerPack: 1,
    image: 'assets/products/beverage-placeholder.svg',
    imageThumbnail: 'assets/products/beverage-placeholder.svg',
    imageShowsMultipack: false,
    previewCatalogApproved: false,
    qaFixture: true,
    alcoholic,
    minimumAge: alcoholic ? 18 : null,
    popular: false,
    featured: false,
    brand: 'Fixture',
    variant: 'Test',
    packageType: 'lata',
    prepMinutes: 2,
  };
}

function catalogoDeCombos(overrides = {}) {
  return [
    producto(HEINEKEN, 'Heineken', 3900, { alcoholic: true, ...(overrides[HEINEKEN] || {}) }),
    producto(RED_BULL, 'Red Bull Energy Drink', 3576, overrides[RED_BULL] || {}),
    producto(SPEED, 'Speed Unlimited', 2925, overrides[SPEED] || {}),
  ];
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'location', {
    value: { search: '?demo=1' },
    configurable: true,
  });
  resetState({ products: catalogoDeCombos() });
});

test('un combo cobrable se agrega, se suma y se quita', () => {
  assert.deepEqual(getCartCombos(), []);
  assert.ok(getAvailableCombos().some((combo) => combo.comboId === 'combo-heineken-x6'));

  assert.equal(addComboToCart('combo-heineken-x6').ok, true);
  assert.equal(state().comboSelections[0].quantity, 1);

  assert.equal(addComboToCart('combo-heineken-x6').ok, true);
  assert.equal(state().comboSelections[0].quantity, 2);

  decrementComboItem('combo-heineken-x6');
  assert.equal(state().comboSelections[0].quantity, 1);

  assert.equal(removeComboItem('combo-heineken-x6').ok, true);
  assert.deepEqual(state().comboSelections, []);
});

test('un combo inexistente o no cobrable no entra al carrito', () => {
  const result = addComboToCart('combo-que-no-existe');
  assert.equal(result.ok, false);
  assert.match(result.message, /no está disponible/);
  assert.deepEqual(state().comboSelections, []);
});

test('el combo suma al subtotal a precio de lista y su ahorro va al descuento', () => {
  // Es exactamente como lo representa el backend: el pedido guarda el subtotal
  // de lista y el descuento aparte, así la pantalla y el pedido cuentan la
  // misma historia.
  addComboToCart('combo-heineken-x6');
  const summary = getCartSummary('pickup');

  assert.equal(summary.subtotal, 23400, 'seis Heineken a precio de lista');
  assert.equal(summary.comboDiscount, 2400);
  assert.equal(summary.discountTotal, 2400);
  assert.equal(summary.total, 21000, 'el precio del combo');
  assert.equal(summary.count, 1);
  assert.equal(summary.combos.length, 1);
});

test('dos combos iguales duplican el ahorro', () => {
  addComboToCart('combo-heineken-x6', 2);
  const summary = getCartSummary('pickup');
  assert.equal(summary.subtotal, 46800);
  assert.equal(summary.comboDiscount, 4800);
  assert.equal(summary.total, 42000);
});

test('el stock del combo es el del componente limitante', () => {
  const combo = getAvailableCombos().find((candidate) => candidate.comboId === 'combo-heineken-x6');
  // 99 latas / 6 por combo = 16 combos, no 99.
  assert.equal(combo.stock, 16);

  assert.equal(addComboToCart('combo-heineken-x6', 16).ok, true);
  const excedido = addComboToCart('combo-heineken-x6', 1);
  assert.equal(excedido.ok, false);
  assert.match(excedido.message, /Alcanza para 16 combos/);
});

test('el stock se comparte entre el combo y las líneas sueltas', () => {
  // Seis latas dentro del combo y las sueltas salen del mismo stock. Sin este
  // control el carrito arma un pedido que el backend rechaza al reservar.
  addComboToCart('combo-heineken-x6');
  assert.equal(committedProductQuantity(HEINEKEN), 6);

  addToCart(HEINEKEN, 3);
  assert.equal(committedProductQuantity(HEINEKEN), 9);

  const combo = getAvailableCombos().find((candidate) => candidate.comboId === 'combo-heineken-x6');
  const restantes = Math.floor((combo.components[0].product.stock - 9) / 6);
  assert.equal(addComboToCart('combo-heineken-x6', restantes).ok, true);
  assert.equal(addComboToCart('combo-heineken-x6', 1).ok, false);
});

test('vaciar el carrito también saca los combos', () => {
  addComboToCart('combo-heineken-x6');
  addToCart(HEINEKEN, 1);
  assert.equal(clearCart().ok, true);
  assert.deepEqual(state().cart, []);
  assert.deepEqual(state().comboSelections, []);
});

test('un carrito con sólo combos se puede confirmar', () => {
  addComboToCart('combo-heineken-x6');
  const validation = validateCartForCheckout('pickup', { paymentMethod: 'mercadopago' });
  assert.equal(validation.ok, true, validation.message);
});

test('un combo no se puede confirmar con un medio de pago que no lo sabe cobrar', () => {
  // La ruta directa de pedidos sólo acepta líneas de producto: dejar pasar un
  // combo por ahí lo cobraría a precio de lista, que es el defecto que este
  // contrato cierra.
  addComboToCart('combo-heineken-x6');
  for (const paymentMethod of ['cash', 'coordinate']) {
    const validation = validateCartForCheckout('pickup', { paymentMethod });
    assert.equal(validation.ok, false, paymentMethod);
    assert.match(validation.message, /Los combos se cobran con Mercado Pago/);
  }
});

test('un combo guardado que dejó de ser cobrable no se rehidrata', () => {
  // Rearmarlo con los componentes que quedaron sería cobrar un combo que el
  // mostrador no puede armar.
  resetState({
    products: catalogoDeCombos(),
    comboSelections: [{ comboId: 'combo-heineken-x6', quantity: 1 }],
  });
  assert.equal(getCartCombos().length, 1);

  resetState({
    products: catalogoDeCombos({ [HEINEKEN]: { stock: 0 } }),
    comboSelections: [{ comboId: 'combo-heineken-x6', quantity: 1 }],
  });
  assert.deepEqual(state().comboSelections, []);
  assert.deepEqual(getCartCombos(), []);
});

test('el +18 de un componente alcanza al combo entero', () => {
  const conAlcohol = getAvailableCombos().find((combo) => combo.comboId === 'combo-noche-larga');
  // Cuatro Heineken (alcohólicas) y dos Red Bull (no): el combo es +18.
  assert.equal(conAlcohol.ageRestricted, true);
  assert.equal(conAlcohol.minimumAge, 18);

  const sinAlcohol = getAvailableCombos().find((combo) => combo.comboId === 'combo-cuatro-para-arrancar');
  assert.equal(sinAlcohol.ageRestricted, false);
});
