/*
 * LA COLA, EN LOS ESCENARIOS DE UNA JORNADA REAL.
 * ===========================================================================
 * `business-command-outbox.test.mjs` cubre el contrato de la cola pieza por
 * pieza. Esto cubre las SITUACIONES: se cortó la red a mitad de un toque, el
 * navegador se recargó, hay dos pestañas abiertas en el mostrador, el backend
 * tarda, el backend contesta algo ambiguo.
 *
 * La pregunta que responden todas es la misma y es la única que importa acá:
 * ¿puede una acción del operador aplicarse DOS VECES, o darse por hecha sin que
 * el servidor la haya confirmado? Un pedido aceptado dos veces, o marcado como
 * listo sin estarlo, cuesta plata y confianza.
 *
 * El servidor de mentira de estas pruebas hace lo que hace el de verdad:
 * respeta la clave de idempotencia. Así, «cuántas veces se envió» y «cuántas
 * veces se APLICÓ» son dos números distintos, y el que se mide es el segundo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createBusinessCommand, createCommandOutbox, createMemoryCommandStorage } from '../js/business/business-command-outbox.js';

const accionDeOperador = (overrides = {}) => ({
  businessId: 'business-1',
  orderId: 'order-1',
  commandType: 'transition_order',
  expectedRevision: 2,
  idempotencyKey: 'transition_order:order-1:2:preparing',
  payload: { newStatus: 'preparing' },
  ...overrides,
});

/** Un servidor que aplica una vez por clave de idempotencia, como el real. */
function servidorIdempotente({ falla = () => null } = {}) {
  const aplicadas = new Map();
  const envios = [];
  let revision = 2;
  return {
    aplicadas,
    envios,
    async reconcile(command) {
      return aplicadas.has(command.idempotencyKey)
        ? { alreadyApplied: true, revision: aplicadas.get(command.idempotencyKey) }
        : { revision };
    },
    async send(command) {
      envios.push(command.idempotencyKey);
      const problema = falla(envios.length);
      if (problema === 'red') throw Object.assign(new Error('sin red'), { code: 'NETWORK_ERROR' });
      if (problema === 'ambigua') {
        // El caso feo: el servidor SÍ aplicó y la respuesta se perdió.
        if (!aplicadas.has(command.idempotencyKey)) aplicadas.set(command.idempotencyKey, ++revision);
        return { ok: false, code: 'TIMEOUT', message: 'sin respuesta' };
      }
      if (aplicadas.has(command.idempotencyKey)) {
        return { ok: true, revision: aplicadas.get(command.idempotencyKey) };
      }
      aplicadas.set(command.idempotencyKey, ++revision);
      return { ok: true, revision: aplicadas.get(command.idempotencyKey) };
    },
  };
}

test('dos pestañas del mostrador no aplican la acción dos veces', async () => {
  // El almacenamiento es el mismo —IndexedDB del origen— y las dos pestañas
  // tienen su propia cola en memoria, que es exactamente la situación real.
  const storage = createMemoryCommandStorage();
  const pestanaA = createCommandOutbox({ storage });
  const pestanaB = createCommandOutbox({ storage });
  const servidor = servidorIdempotente();

  await Promise.all([pestanaA.enqueue(accionDeOperador()), pestanaB.enqueue(accionDeOperador())]);
  assert.equal((await pestanaA.list()).length, 1, 'la misma acción no puede encolarse dos veces');

  await Promise.all([pestanaA.drain(servidor), pestanaB.drain(servidor)]);

  assert.equal(servidor.aplicadas.size, 1, 'el servidor aplicó la acción una sola vez');
  const comandos = await pestanaA.list();
  assert.equal(comandos.length, 1);
  assert.equal(comandos[0].state, 'confirmed');
});

test('la red que se corta a mitad del toque deja la acción pendiente, nunca confirmada', async () => {
  const outbox = createCommandOutbox({ storage: createMemoryCommandStorage() });
  const servidor = servidorIdempotente({ falla: () => 'red' });
  await outbox.enqueue(accionDeOperador());

  const [resultado] = await outbox.drain(servidor);

  assert.equal(resultado.state, 'pending', 'sin confirmación del servidor no hay éxito');
  assert.equal(resultado.lastErrorCode, 'NETWORK_ERROR');
  assert.equal(servidor.aplicadas.size, 0);
  // Y queda una fecha de reintento: si no, la acción se quedaría esperando un
  // click que nadie va a hacer.
  assert.ok(await outbox.nextDueAt(), 'el reintento queda programado');
});

test('recargar la página con un envío en vuelo no duplica la acción', async () => {
  // La pestaña murió con el comando en `sending`: no se sabe si llegó.
  const semilla = createBusinessCommand(accionDeOperador(), { randomId: () => 'cmd-1' });
  const storage = createMemoryCommandStorage([
    { ...semilla, state: 'sending', sendingStartedAt: new Date().toISOString() },
  ]);
  const servidor = servidorIdempotente();
  // El servidor SÍ había aplicado la transición antes de que se cortara.
  servidor.aplicadas.set(semilla.idempotencyKey, 3);

  const despuesDeRecargar = createCommandOutbox({ storage });
  await despuesDeRecargar.recoverAbandoned({ force: true });
  const [resultado] = await despuesDeRecargar.drain(servidor);

  assert.equal(resultado.state, 'confirmed');
  assert.equal(servidor.envios.length, 0, 'la reconciliación evitó el reenvío');
  assert.equal(servidor.aplicadas.size, 1);
});

test('una respuesta ambigua se resuelve preguntando, no reintentando a ciegas', async () => {
  // El servidor aplica y la respuesta se pierde. El reintento NO puede volver a
  // aplicar: tiene que descubrir que ya estaba hecho.
  const outbox = createCommandOutbox({ storage: createMemoryCommandStorage(), baseBackoffMs: 0 });
  const servidor = servidorIdempotente({ falla: (n) => (n === 1 ? 'ambigua' : null) });
  await outbox.enqueue(accionDeOperador());

  const [primero] = await outbox.drain(servidor);
  assert.equal(primero.state, 'pending', 'una respuesta ambigua no es una confirmación');

  const [segundo] = await outbox.drain(servidor);
  assert.equal(segundo.state, 'confirmed');
  assert.equal(servidor.envios.length, 1, 'el segundo intento no reenvió: reconcilió');
  assert.equal(servidor.aplicadas.size, 1, 'la transición se aplicó una sola vez');
});

test('el backend lento no dispara un segundo envío desde la misma pestaña', async () => {
  const outbox = createCommandOutbox({ storage: createMemoryCommandStorage() });
  const servidor = servidorIdempotente();
  let soltar = () => {};
  const lento = new Promise((resolve) => { soltar = resolve; });
  const send = async (command) => { await lento; return servidor.send(command); };
  await outbox.enqueue(accionDeOperador());

  const primerDrenaje = outbox.drain({ reconcile: servidor.reconcile, send });
  const segundoDrenaje = outbox.drain({ reconcile: servidor.reconcile, send });
  soltar();
  await Promise.all([primerDrenaje, segundoDrenaje]);

  assert.equal(servidor.envios.length, 1, 'el segundo drenaje se sumó al primero');
  assert.equal(servidor.aplicadas.size, 1);
});

test('al volver la conexión el reintento programado confirma la acción', async () => {
  let ahora = Date.parse('2026-08-28T10:00:00Z');
  const outbox = createCommandOutbox({
    storage: createMemoryCommandStorage(),
    now: () => new Date(ahora),
    baseBackoffMs: 1000,
    random: () => 0.5,
  });
  let hayRed = false;
  const servidor = servidorIdempotente({ falla: () => (hayRed ? null : 'red') });
  await outbox.enqueue(accionDeOperador());

  await outbox.drain(servidor);
  const cuando = await outbox.nextDueAt();
  assert.ok(cuando > ahora, 'el reintento queda en el futuro, con backoff');

  hayRed = true;
  ahora = cuando + 1;
  const [resultado] = await outbox.drain(servidor);
  assert.equal(resultado.state, 'confirmed');
  assert.equal(servidor.aplicadas.size, 1);
});

test('un conflicto de revisión se detiene y espera a una persona', async () => {
  // Otro operador movió el pedido primero. Reintentar sería pisar su decisión.
  const outbox = createCommandOutbox({ storage: createMemoryCommandStorage() });
  await outbox.enqueue(accionDeOperador());

  const [resultado] = await outbox.drain({
    reconcile: async () => ({ conflict: true, code: 'REVISION_CONFLICT', revision: 9 }),
    send: async () => assert.fail('no se envía un comando en conflicto'),
  });

  assert.equal(resultado.state, 'conflicted');
  assert.equal(resultado.serverRevision, 9);
  // Y no vuelve solo: no queda nada vencido para reintentar.
  assert.equal(await outbox.nextDueAt(), null);
});
