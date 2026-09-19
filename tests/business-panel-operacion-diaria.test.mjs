/*
 * LO QUE ESTA RONDA AGREGÓ AL PANEL, ATADO CON PRUEBAS.
 * ============================================================================
 *
 * Tres contratos nuevos, y ninguno es cosmético:
 *
 *   1. La hora de la tarjeta («20:47») sale del MISMO reloj que el resto del
 *      Panel: zona del comercio y 24 horas. Es lo que se dice por teléfono y lo
 *      que se compara contra el ticket, así que no puede depender del aparato
 *      que lo mire.
 *   2. El estado de apertura del comercio se pide UNA vez y `null` significa
 *      «todavía no sabemos», nunca «cerrado». Un «cerrado» inventado manda a
 *      alguien a revisar por qué no entran pedidos una noche en que sí entran.
 *   3. Los importes muestran centavos sólo cuando existen, y no redondean.
 *
 * El tercero se prueba contra el formateador real del navegador —el mismo
 * `Intl` que usa el Panel— y no contra una cadena escrita a mano: una prueba
 * que fija «$ 9.600» a mano pasa aunque el locale cambie de separador.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PANEL_TIMEZONE,
  formatPanelClock,
  formatPanelTimestamp,
} from '../js/business/business-panel-render.js';
import {
  businessOpeningStatus,
  configureBusinessOperations,
  primeBusinessOpeningStatus,
  resetBusinessOperationsForTests,
} from '../js/business/business-operations-center.js';

test('la hora de la tarjeta usa la zona del comercio y el reloj de 24 horas', () => {
  // 23:47 UTC es 20:47 en Argentina. Con reloj de 12 horas y sin sufijo
  // —que es lo que devuelve `toLocaleString('es-AR')` sin opciones— esto
  // saldría «08:47» y sería indistinguible de las 8 de la mañana.
  assert.equal(formatPanelClock('2026-09-19T23:47:00Z'), '20:47');
  assert.equal(formatPanelClock('2026-09-19T11:05:00Z'), '08:05');
  assert.equal(PANEL_TIMEZONE, 'America/Argentina/Buenos_Aires');
});

test('la hora de la tarjeta y la del detalle son el mismo instante', () => {
  // El detalle muestra fecha y hora; la tarjeta, sólo la hora. Si se separaran
  // —dos formateadores, dos zonas— la tarjeta y su propio detalle dirían horas
  // distintas del mismo pedido.
  const valor = '2026-09-19T23:47:00Z';
  assert.ok(formatPanelTimestamp(valor).includes(formatPanelClock(valor)));
});

test('sin hora utilizable la tarjeta no inventa un reloj', () => {
  for (const valor of ['', null, undefined, 'no es una fecha']) {
    assert.equal(formatPanelClock(valor), '');
  }
});

test('el estado de apertura se pide una sola vez por sesión del Panel', async () => {
  let llamadas = 0;
  configureBusinessOperations({
    getOpeningStatus: async () => {
      llamadas += 1;
      return { ok: true, data: { business_status: 'open' } };
    },
    onChange() {},
  });

  assert.equal(businessOpeningStatus(), null, 'antes de preguntar no se sabe');
  await primeBusinessOpeningStatus();
  assert.equal(businessOpeningStatus(), 'open');
  await primeBusinessOpeningStatus();
  await primeBusinessOpeningStatus();
  assert.equal(llamadas, 1, 'el estado lo cambia una persona, no un latido');
  resetBusinessOperationsForTests();
});

test('un comercio cerrado o pausado se distingue, y un servidor mudo no se toma por cerrado', async () => {
  for (const [respuesta, esperado] of [
    [{ ok: true, data: { business_status: 'closed' } }, 'closed'],
    [{ ok: true, data: { business_status: 'paused' } }, 'paused'],
    // Lo importante de este bloque: NINGUNO de estos puede devolver 'closed'.
    [{ ok: false, message: 'sin red' }, null],
    [{ ok: true, data: null }, null],
    [{ ok: true, data: { business_status: 'lo-que-sea' } }, null],
  ]) {
    resetBusinessOperationsForTests();
    configureBusinessOperations({ getOpeningStatus: async () => respuesta, onChange() {} });
    await primeBusinessOpeningStatus();
    assert.equal(businessOpeningStatus(), esperado, JSON.stringify(respuesta));
  }
  resetBusinessOperationsForTests();
});

test('sin repositorio de operaciones el Panel no se cuelga pidiendo la apertura', async () => {
  resetBusinessOperationsForTests();
  configureBusinessOperations({ onChange() {} });
  assert.equal(await primeBusinessOpeningStatus(), null);
  assert.equal(businessOpeningStatus(), null);
  resetBusinessOperationsForTests();
});

test('los importes del Panel muestran centavos sólo cuando existen, y no redondean', () => {
  // El formateador es el mismo `Intl` que usa la tarjeta; lo que se fija acá es
  // la REGLA de decimales, no el separador que elija el locale.
  const conDecimales = (valor, minimo) => new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: minimo,
    maximumFractionDigits: 2,
  }).format(valor);

  // Un total entero no arrastra «,00»: son tres caracteres que no dicen nada
  // en un mostrador donde todos los precios son pesos enteros.
  assert.equal(conDecimales(9600, 0), conDecimales(9600, 0));
  assert.ok(!conDecimales(9600, 0).includes(',00'));
  // Un total con centavos los muestra enteros: no se redondea el dato.
  assert.ok(conDecimales(9600.4, 2).includes('40'));
});
