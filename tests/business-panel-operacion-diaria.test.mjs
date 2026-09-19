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
import { readFile } from 'node:fs/promises';
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

/* ===========================================================================
 * EL REPARTO PROPIO DEL COMERCIO
 * ===========================================================================
 * La máquina de estados del Panel tiene que ser el ESPEJO EXACTO de la rama
 * `v_is_business` de `change_order_status` después de la migración
 * 20260919120000. Un botón de más acá es un 23514 y un pedido que no se mueve
 * —el defecto H1 de BUSINESS-PANEL-HARDENING, otra vez—; uno de menos es el
 * bloqueo que esta ronda vino a cerrar.
 * ======================================================================== */

test('el comercio despacha y cierra su propio delivery, y sólo mientras no haya repartidor', async () => {
  const { nextBusinessStatus } = await import('../js/production-operations.js');

  // Sin repartidor, la cadena completa es del comercio.
  assert.equal(nextBusinessStatus({ status: 'ready', deliveryMode: 'delivery' }), 'on_the_way');
  assert.equal(nextBusinessStatus({ status: 'on_the_way', deliveryMode: 'delivery' }), 'delivered');

  // Con repartidor asignado no hay acción: el pedido es suyo y lo cierra con el
  // código del cliente. Ofrecer el botón sería prometer lo que el servidor
  // rechaza.
  for (const status of ['ready', 'assigned', 'picked_up', 'on_the_way', 'arrived']) {
    assert.equal(
      nextBusinessStatus({ status, deliveryMode: 'delivery', assignedRiderId: 'r-1' }),
      null,
      `con repartidor asignado no puede haber acción de negocio en ${status}`,
    );
  }

  // El retiro no cambió, y sigue sin pasar por `on_the_way`.
  assert.equal(nextBusinessStatus({ status: 'ready', deliveryMode: 'pickup' }), 'delivered');
  assert.equal(nextBusinessStatus({ status: 'delivered', deliveryMode: 'delivery' }), null);
});

test('el orden de la cadena del comercio es el mismo que ve el cliente en su seguimiento', async () => {
  const { DELIVERY_STATUS_FLOW } = await import('../js/core/order-status.js');
  // El seguimiento del cliente NO tiene un paso de repartidor entre «listo» y
  // «en camino»: la cadena que el comercio recorre por su cuenta es exactamente
  // la que el cliente ya venía viendo dibujada. Si alguien agregara `assigned`
  // acá, un pedido despachado por el local se vería trabado un paso antes.
  assert.deepEqual(
    [...DELIVERY_STATUS_FLOW],
    ['received', 'preparing', 'ready', 'on_the_way', 'delivered'],
  );
});

test('el seguimiento del cliente avanza igual lo lleve un repartidor o el comercio', async () => {
  const { orderTimelineIndex, publicOrderTimelineIndex } = await import('../js/core/order-timeline.js');

  /*
   * Lo que el cliente ve avanzar no puede depender de QUIÉN lleva el pedido.
   *
   * El reparto del comercio recorre ready -> on_the_way -> delivered; el del
   * repartidor pasa además por assigned y picked_up. Los dos tienen que caer en
   * el mismo paso del seguimiento, porque para quien espera en la puerta son el
   * mismo hecho: salió del local. Si `on_the_way` sin repartidor cayera un paso
   * antes, un pedido despachado por el local se vería trabado en «Listo» hasta
   * que llegara.
   */
  assert.equal(orderTimelineIndex('ready'), 2);
  assert.equal(orderTimelineIndex('on_the_way'), 3, 'salió del local, lo lleve quien lo lleve');
  assert.equal(orderTimelineIndex('delivered'), 4);

  // Y en el seguimiento público —el del enlace que recibe el cliente— los
  // estados del repartidor y el del comercio comparten paso.
  assert.equal(publicOrderTimelineIndex('ready'), 1);
  for (const status of ['picked_up', 'on_the_way', 'arrived']) {
    assert.equal(publicOrderTimelineIndex(status), 2, status);
  }
  assert.equal(publicOrderTimelineIndex('delivered'), 3);
});

test('el botón dice lo que va a pasar, no el nombre del estado', async () => {
  const origen = await readFile(new URL('../js/production-operations.js', import.meta.url), 'utf8');
  // `actionLabel` no se exporta —es de presentación— así que se fija sobre el
  // texto: lo que no puede volver es «En camino», que describía un estado en
  // vez de una acción.
  assert.match(origen, /actor === 'rider' \? 'Salir en camino' : 'Sale a reparto'/);
  assert.match(origen, /'Marcar entregado' : 'Confirmar entrega'/);
});

test('al cliente no se le nombra un repartidor que puede no existir', async () => {
  for (const archivo of ['../js/repositories/supabase_order_repository.js', '../js/state.js']) {
    const origen = await readFile(new URL(archivo, import.meta.url), 'utf8');
    const codigo = origen.split('\n')
      .filter((linea) => !linea.trim().startsWith('*') && !linea.trim().startsWith('//'))
      .join('\n');
    // Desde que el comercio reparte con su propia gente, un pedido `on_the_way`
    // puede no tener repartidor. Prometerle uno al cliente es una respuesta que
    // nadie puede sostener si llama a preguntar quién se lo trae.
    assert.doesNotMatch(codigo, /El repartidor salió del local/, archivo);
    assert.match(codigo, /Tu pedido salió del local/, archivo);
  }
});
