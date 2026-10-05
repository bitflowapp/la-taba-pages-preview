import test from 'node:test';
import assert from 'node:assert/strict';

import { businessDeepLinkFromUrl } from '../js/production-operations.js';
import { BUSINESS_OPERATION_VIEWS } from '../js/business/business-operations-center.js';

/*
 * `?panel=mercadopago#business` es el link estable con el que Caja Clara abre
 * el Panel directamente en Mercado Pago («Vincular Mercado Pago»). Si este
 * contrato cambia, Caja Clara (`TabaMercadoPagoLink.PaymentsUrl`) cae en la
 * bandeja de pedidos y el dueño tiene que buscar la pantalla a mano.
 */
const STORE = 'https://la-taba-commercial-pilot.pages.dev';

test('el link de Caja Clara abre la pantalla de Mercado Pago y se borra de la barra', () => {
  const link = businessDeepLinkFromUrl(`${STORE}/?panel=mercadopago#business`);
  assert.equal(link.view, 'payments-setup');
  assert.ok(BUSINESS_OPERATION_VIEWS.includes(link.view));
  assert.equal(link.cleanUrl, `${STORE}/#business`);
});

test('la vuelta del OAuth cae en la misma pantalla sin creerle el resultado a la URL', () => {
  for (const result of ['connected', 'cancelled', 'error']) {
    const link = businessDeepLinkFromUrl(`${STORE}/?mp_connection=${result}#business`);
    assert.equal(link.view, 'payments-setup');
    assert.equal(link.cleanUrl, `${STORE}/#business`);
  }
});

test('conserva los demás parámetros y el hash', () => {
  const link = businessDeepLinkFromUrl(`${STORE}/?relay=x&panel=MercadoPago&room=7#business`);
  assert.equal(link.view, 'payments-setup');
  assert.equal(link.cleanUrl, `${STORE}/?relay=x&room=7#business`);
});

test('un panel desconocido no elige pantalla pero se limpia igual', () => {
  const link = businessDeepLinkFromUrl(`${STORE}/?panel=borrar-todo#business`);
  assert.equal(link.view, null);
  assert.equal(link.cleanUrl, `${STORE}/#business`);
});

test('sin parámetros no hay deep link', () => {
  assert.equal(businessDeepLinkFromUrl(`${STORE}/#business`), null);
  assert.equal(businessDeepLinkFromUrl('no es una url'), null);
});
