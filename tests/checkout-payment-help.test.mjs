/*
 * LA AYUDA DEL MEDIO DE PAGO SIGUE AL MEDIO ELEGIDO, EN LOS DOS SENTIDOS.
 *
 * Debajo del selector de pago el shell escribe «El cobro queda pendiente hasta
 * que el negocio registre el dinero recibido. No se paga en esta pantalla.». Con
 * Mercado Pago elegido esa frase quedaba puesta justo encima de un botón que
 * dice «Pagar con Mercado Pago»: la pantalla se contradecía en el momento de
 * pagar.
 *
 * Esta clase de defecto ya pasó una vez con la nota del modo: una copia escrita
 * en un lugar y restaurada en otro. Por eso se prueban las dos direcciones —ir a
 * Mercado Pago y volver—, y la vuelta por los dos caminos que existen: a mano, y
 * porque Mercado Pago deja de estar disponible mientras estaba elegido.
 *
 * La copia de efectivo tiene que volver EXACTA: la buscan, tal cual, las suites
 * de producción controlada y del piloto de cobro manual.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  MERCADO_PAGO_PAYMENT_HELP,
  refreshCheckoutPaymentCopy,
  setMercadoPagoCheckoutAvailability,
} from '../js/ui.js';

const EFECTIVO = 'El cobro queda pendiente hasta que el negocio registre el dinero recibido. No se paga en esta pantalla.';
const shell = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function nodo(texto = '') {
  return { textContent: texto, dataset: {}, disabled: false };
}

// Lo mínimo del checkout que tocan estas funciones: el selector con sus
// opciones, el botón, la nota del modo y la ayuda. Todo lo demás está guardado
// contra nodos ausentes.
function montarCheckout({ medio = 'cash' } = {}) {
  const opciones = [{ value: 'cash' }, { value: 'coordinate' }];
  const conRemove = (opcion) => Object.assign(opcion, {
    remove() {
      const indice = opciones.indexOf(opcion);
      if (indice >= 0) opciones.splice(indice, 1);
    },
  });
  opciones.forEach(conRemove);
  const selector = {
    value: medio,
    dataset: {},
    querySelector(selector) {
      const valor = /option\[value="([^"]+)"\]/.exec(selector)?.[1];
      return valor ? opciones.find((opcion) => opcion.value === valor) || null : null;
    },
    append(opcion) {
      opciones.push(conRemove(opcion));
    },
  };
  const boton = nodo('Confirmar pedido');
  const nota = nodo('El pago se coordina directamente con el local.');
  const ayuda = nodo(shellPaymentHelp());
  const nodos = {
    '[name="paymentMethod"]': selector,
    '[data-checkout-submit]': boton,
    '[data-checkout-mode-note]': nota,
    '[data-payment-help]': ayuda,
  };
  globalThis.document = {
    querySelector: (selector) => nodos[selector] || null,
    querySelectorAll: () => [],
    createElement: () => ({ value: '', textContent: '' }),
  };
  return { selector, boton, nota, ayuda, opciones };
}

function shellPaymentHelp() {
  return /<small data-payment-help>([^<]*)<\/small>/.exec(shell)?.[1] ?? '';
}

const documentoOriginal = globalThis.document;
test.afterEach(() => {
  globalThis.document = documentoOriginal;
});

test('el shell trae la ayuda de efectivo, marcada para poder cambiarla, y sin nombrar a Mercado Pago', () => {
  assert.equal(shellPaymentHelp(), EFECTIVO);
  assert.doesNotMatch(shellPaymentHelp(), /Mercado Pago/);
  assert.doesNotMatch(MERCADO_PAGO_PAYMENT_HELP, /No se paga en esta pantalla/);
});

test('ida y vuelta a mano: elegir Mercado Pago cambia la ayuda y volver la devuelve exacta', () => {
  const { selector, boton, nota, ayuda } = montarCheckout({ medio: 'cash' });

  refreshCheckoutPaymentCopy();
  assert.equal(ayuda.textContent, EFECTIVO);

  selector.value = 'mercadopago';
  refreshCheckoutPaymentCopy();
  assert.equal(ayuda.textContent, MERCADO_PAGO_PAYMENT_HELP);
  assert.equal(boton.textContent, 'Pagar con Mercado Pago');
  assert.match(nota.textContent, /Mercado Pago/);

  selector.value = 'cash';
  refreshCheckoutPaymentCopy();
  assert.equal(ayuda.textContent, EFECTIVO);
  assert.equal(boton.textContent, 'Confirmar pedido');

  // «A coordinar» también se cobra con el local: misma ayuda que efectivo.
  selector.value = 'mercadopago';
  refreshCheckoutPaymentCopy();
  selector.value = 'coordinate';
  refreshCheckoutPaymentCopy();
  assert.equal(ayuda.textContent, EFECTIVO);
});

test('la vuelta forzada: si Mercado Pago deja de estar disponible estando elegido, la ayuda vuelve a la de efectivo', () => {
  const { selector, boton, ayuda, opciones } = montarCheckout({ medio: 'cash' });
  refreshCheckoutPaymentCopy();

  setMercadoPagoCheckoutAvailability({ available: true });
  assert.ok(opciones.some((opcion) => opcion.value === 'mercadopago'), 'la opción se ofrece');
  selector.value = 'mercadopago';
  refreshCheckoutPaymentCopy();
  assert.equal(ayuda.textContent, MERCADO_PAGO_PAYMENT_HELP);

  setMercadoPagoCheckoutAvailability({ available: false });
  assert.equal(selector.value, 'coordinate');
  assert.ok(!opciones.some((opcion) => opcion.value === 'mercadopago'), 'la opción se retira');
  assert.equal(ayuda.textContent, EFECTIVO);
  assert.equal(boton.textContent, 'Confirmar pedido');
});

test('si el primer pintado ya llega con Mercado Pago elegido, la vuelta igual restaura la copia del shell', () => {
  // La preferencia del último pedido puede dejar Mercado Pago preseleccionado
  // ANTES del primer render. La copia base se recuerda del shell, no de lo que
  // la pantalla mostraba al volver.
  const { selector, ayuda } = montarCheckout({ medio: 'mercadopago' });
  refreshCheckoutPaymentCopy();
  assert.equal(ayuda.textContent, MERCADO_PAGO_PAYMENT_HELP);
  selector.value = 'cash';
  refreshCheckoutPaymentCopy();
  assert.equal(ayuda.textContent, EFECTIVO);
});
