// El carrito de una persona que está mirando la pantalla no se edita solo.
//
// POR QUÉ EXISTE ESTE ARCHIVO (H-08)
// ----------------------------------
// `sanitizeCart` mezclaba dos trabajos que no son el mismo:
//
//   1. SANEAR lo que viene del disco al arrancar. Ahí descartar y recortar está
//      bien: nadie está mirando y el dato puede ser de otra versión.
//   2. RECONCILIAR el carrito vivo contra un catálogo que acaba de cambiar. Ahí
//      descartar en silencio es editarle el pedido a alguien que lo está viendo.
//
// Como `sanitizeCart` corre en CADA `commitState`, el caso 2 heredaba las reglas
// del caso 1. Y en producción el catálogo se recarga por realtime cada vez que
// alguien compra, porque la RPC descuenta stock. Medido antes del arreglo: una
// línea de 5 unidades pasaba a 2 y el total bajaba de $17.880 a $7.152 sin una
// palabra; con stock 0 el carrito quedaba vacío.
//
// El daño colateral era peor que el susto: como después de cada commit siempre
// se cumplía `quantity <= stock` y el producto estaba disponible, `cartItemIssue`
// devolvía `null` SIEMPRE, y con eso quedaban inalcanzables el aviso
// «Se agotó mientras armabas el pedido», el botón «Quitar del pedido» y la rama
// de `validateCartForCheckout` que los respalda. El propio comentario de
// `cart.js` dice que existen porque antes «el cliente se enteraba al final del
// recorrido y sin saber CUÁL de sus productos era el problema».
//
// Este archivo fija los dos comportamientos por separado.
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import {
  addToCart,
  cartItemIssue,
  getCartItems,
  setCartItemQuantity,
  validateCartForCheckout,
} from '../js/cart.js';
import { getState, hydrateState, setState, updateState } from '../js/state.js';
import { resetState, state } from './helpers.mjs';

const SKU = 'qa-jugo-naranja';

beforeEach(() => {
  Object.defineProperty(globalThis, 'location', {
    value: { search: '?demo=1' },
    configurable: true,
  });
  resetState();
});

/** Cambia el stock del catálogo vivo, como hace un refresco por realtime. */
function catalogoConStock(unidades, extra = {}) {
  updateState((draft) => {
    draft.products = draft.products.map((product) => (
      product.id === SKU
        ? { ...product, stock: unidades, available: unidades > 0, ...extra }
        : product
    ));
  });
}

function lineaDelCarrito() {
  return getCartItems().find((item) => item.productId === SKU) || null;
}

test('1-2-3 · el stock cae a cero y la línea NO desaparece', () => {
  assert.equal(addToCart(SKU, 2).ok, true);
  assert.equal(lineaDelCarrito()?.quantity, 2);

  catalogoConStock(0);

  const linea = lineaDelCarrito();
  assert.ok(linea, 'la línea sigue en el carrito');
  assert.equal(linea.quantity, 2, 'y conserva la cantidad que la persona eligió');
});

test('4 · y el cliente recibe un aviso visible que nombra el problema', () => {
  addToCart(SKU, 2);
  catalogoConStock(0);

  const issue = cartItemIssue(lineaDelCarrito());
  assert.ok(issue, 'cartItemIssue dejó de ser código muerto');
  assert.equal(issue.kind, 'unavailable');
  assert.match(issue.message, /Se agotó/);
  assert.equal(issue.actionLabel, 'Quitar del pedido');
  assert.equal(issue.quantity, 0);
});

test('5 · el checkout no confirma un carrito que ya no se puede servir', () => {
  addToCart(SKU, 2);
  catalogoConStock(0);

  const resultado = validateCartForCheckout('delivery');
  assert.equal(resultado.ok, false);
  assert.match(resultado.message, /stock suficiente/i);
});

test('6 · el cliente puede corregir o retirar la línea', () => {
  addToCart(SKU, 4);
  catalogoConStock(1);

  // «Dejar 1»: la salida que ofrece el aviso.
  const issue = cartItemIssue(lineaDelCarrito());
  assert.equal(issue.kind, 'over');
  assert.equal(issue.quantity, 1);
  assert.equal(setCartItemQuantity(SKU, issue.quantity).ok, true);
  assert.equal(lineaDelCarrito().quantity, 1);
  assert.equal(cartItemIssue(lineaDelCarrito()), null, 'corregida, ya no avisa');
  assert.equal(validateCartForCheckout('delivery').ok, true);

  // Y quitarla del todo también.
  assert.equal(setCartItemQuantity(SKU, 0).ok, true);
  assert.equal(lineaDelCarrito(), null);
});

test('9 · el stock por debajo de la cantidad se avisa, no se recorta a escondidas', () => {
  addToCart(SKU, 4);
  catalogoConStock(2);

  const linea = lineaDelCarrito();
  assert.equal(linea.quantity, 4, 'la cantidad elegida no se toca sola');
  const issue = cartItemIssue(linea);
  assert.equal(issue.kind, 'over');
  assert.match(issue.message, /Quedan 2 unidades/);
  assert.equal(issue.quantity, 2);
  assert.equal(validateCartForCheckout('delivery').ok, false);
});

test('10 · si vuelve el stock, el carrito queda sano solo', () => {
  addToCart(SKU, 3);
  catalogoConStock(0);
  assert.ok(cartItemIssue(lineaDelCarrito()), 'primero avisa');

  catalogoConStock(9); // reposición

  const linea = lineaDelCarrito();
  assert.equal(linea.quantity, 3, 'la cantidad original sobrevivió al bache');
  assert.equal(cartItemIssue(linea), null, 'y el aviso se retira solo');
  assert.equal(validateCartForCheckout('delivery').ok, true);
});

test('7 · una recarga con el mismo catálogo no cambia el carrito', () => {
  addToCart(SKU, 3);
  const antes = getState().cart.map((item) => ({ ...item }));

  const rehidratado = hydrateState({ ...getState() });

  assert.deepEqual(
    rehidratado.cart.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    antes.map((item) => ({ productId: item.productId, quantity: item.quantity })),
  );
});

test('8 · al hidratar del disco SÍ se limpia lo que ya no se puede servir', () => {
  // Es el otro lado del contrato: un carrito guardado ayer, con un producto que
  // desde entonces se agotó, no se rehidrata pidiendo algo que no existe. Acá
  // nadie está mirando la pantalla y limpiar es lo correcto.
  const guardado = {
    ...getState(),
    cart: [{ productId: SKU, quantity: 3 }],
    products: getState().products.map((product) => (
      product.id === SKU ? { ...product, stock: 0, available: false } : product
    )),
  };

  const rehidratado = hydrateState(guardado);

  assert.equal(
    rehidratado.cart.find((item) => item.productId === SKU),
    undefined,
    'la línea agotada no vuelve del disco',
  );
});

test('8b · al hidratar, una cantidad mayor al stock se recorta', () => {
  const guardado = {
    ...getState(),
    cart: [{ productId: SKU, quantity: 9 }],
    products: getState().products.map((product) => (
      product.id === SKU ? { ...product, stock: 2, available: true } : product
    )),
  };

  const rehidratado = hydrateState(guardado);

  assert.equal(rehidratado.cart.find((item) => item.productId === SKU)?.quantity, 2);
});

test('en vivo se sigue descartando lo que se cobraría mal', () => {
  // La reconciliación en vivo conserva la línea para poder EXPLICARLA, pero eso
  // NO alcanza a lo que se cobraría mal. Ese descarte se mantiene siempre, mire
  // alguien o no: perder plata en silencio es peor que perder una línea en
  // silencio. La compuerta es `!isProductVisibleToCustomer || isPricePending`,
  // y acá se ejercita por la primera mitad, con un producto archivado.
  //
  // La mitad del precio no se prueba desde este harness a propósito y no por
  // olvido: el catálogo de fixtures pasa por `mergeCatalogProducts`, que sólo
  // conserva los campos de `editableProductFields` y renormaliza el precio
  // contra el producto base, así que un `price: 0` inyectado acá vuelve a su
  // valor y el escenario no es expresable. Forzarlo pidiendo un harness nuevo
  // costaría más que lo que probaría: las dos mitades comparten la misma línea
  // de código.
  addToCart(SKU, 2);
  updateState((draft) => {
    draft.products = draft.products.map((product) => (
      product.id === SKU ? { ...product, archived: true } : product
    ));
  });

  assert.equal(lineaDelCarrito(), null, 'lo que no se puede vender no se conserva');
});

test('agregar al carrito sigue rechazando lo agotado: esto no abre una puerta trasera', () => {
  catalogoConStock(0);
  const resultado = addToCart(SKU, 1);
  assert.equal(resultado.ok, false, 'la compuerta de ENTRADA no cambió');
  assert.equal(lineaDelCarrito(), null);
});

test('setState directo tampoco recorta: la reconciliación viva es una sola regla', () => {
  // 4 es el stock del fixture: `addToCart` no deja pasar más, y esa compuerta
  // de ENTRADA no cambió. Lo que se comprueba acá es que un commit posterior no
  // vuelva a tocar la línea por su cuenta.
  addToCart(SKU, 4);
  catalogoConStock(1);
  setState({ ...getState() });
  assert.equal(lineaDelCarrito()?.quantity, 4, 'ningún commit recorta la cantidad elegida');
});
