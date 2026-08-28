// El aviso de pedido nuevo: timbre, vibración, insignia y contador del título.
//
// POR QUÉ EXISTE ESTE ARCHIVO
// ---------------------------
// Antes de esto, en el Panel de PRODUCCIÓN un pedido nuevo hacía una sola cosa:
// un toast de tres segundos. Si el teléfono estaba apoyado en el mostrador y
// nadie miraba la pantalla en esos tres segundos, el pedido entraba mudo.
//
// Los servicios de timbre y notificación existían desde antes y NADIE los
// instanciaba: eran código muerto. Estas pruebas fijan lo que hace el canal que
// los usa, y sobre todo las dos cosas que no puede hacer: sonar sin permiso y
// avisar dos veces por el mismo pedido.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ORDER_SOUND_STORAGE_KEY,
  createBusinessOrderAlertChannel,
} from '../js/business/business-order-alerts.js';

function almacenamientoFalso(inicial = {}) {
  const datos = new Map(Object.entries(inicial));
  return {
    getItem: (clave) => (datos.has(clave) ? datos.get(clave) : null),
    setItem: (clave, valor) => datos.set(clave, String(valor)),
    volcado: () => Object.fromEntries(datos),
  };
}

function timbreFalso() {
  const estado = { muted: true, sonadas: 0 };
  return {
    estado,
    setMuted(valor) { estado.muted = Boolean(valor); },
    async playNewOrder() {
      if (estado.muted) return false;
      estado.sonadas += 1;
      return true;
    },
  };
}

function entornoFalso() {
  const registro = { insignias: [], limpiezas: 0, vibraciones: [] };
  return {
    registro,
    navigatorRef: {
      setAppBadge: (n) => registro.insignias.push(n),
      clearAppBadge: () => { registro.limpiezas += 1; },
    },
    documentRef: { title: 'La Taba' },
    vibrate: (patron) => { registro.vibraciones.push(patron); return true; },
  };
}

test('el timbre nace apagado y sólo lo enciende una persona', async () => {
  // No es una preferencia de diseño: `AudioContext` arranca suspendido y el
  // navegador sólo lo despierta dentro de un gesto del usuario. Un timbre
  // "siempre encendido" sería un interruptor que dice sí y no suena.
  const sound = timbreFalso();
  const storage = almacenamientoFalso();
  const canal = createBusinessOrderAlertChannel({ sound, storage, ...entornoFalso() });

  assert.equal(canal.soundEnabled, false);
  await canal.announceNewOrder({ id: 'LT-1' });
  assert.equal(sound.estado.sonadas, 0, 'sonó sin que nadie lo encendiera');

  assert.equal(await canal.setSoundEnabled(true), true);
  // Encenderlo suena una vez: es la única prueba honesta de que va a sonar
  // cuando entre un pedido.
  assert.equal(sound.estado.sonadas, 1);
  await canal.announceNewOrder({ id: 'LT-2' });
  assert.equal(sound.estado.sonadas, 2);
});

test('la preferencia del timbre sobrevive a la recarga', () => {
  const storage = almacenamientoFalso();
  const primero = createBusinessOrderAlertChannel({ sound: timbreFalso(), storage, ...entornoFalso() });
  void primero.setSoundEnabled(true);
  assert.equal(storage.volcado()[ORDER_SOUND_STORAGE_KEY], 'on');

  // Un Panel nuevo sobre el mismo almacenamiento: el turno siguiente arranca
  // con el timbre como lo dejó el anterior.
  const segundo = createBusinessOrderAlertChannel({ sound: timbreFalso(), storage, ...entornoFalso() });
  assert.equal(segundo.soundEnabled, true);
});

test('un almacenamiento bloqueado no apaga el timbre de este turno', async () => {
  // Modo privado, o un navegador con el almacenamiento denegado.
  const roto = {
    getItem() { throw new Error('storage bloqueado'); },
    setItem() { throw new Error('storage bloqueado'); },
  };
  const sound = timbreFalso();
  const canal = createBusinessOrderAlertChannel({ sound, storage: roto, ...entornoFalso() });
  assert.equal(canal.soundEnabled, false);
  assert.equal(await canal.setSoundEnabled(true), true);
  await canal.announceNewOrder({ id: 'LT-9' });
  assert.equal(sound.estado.sonadas, 2);
});

test('el mismo pedido no se anuncia dos veces', async () => {
  const sound = timbreFalso();
  const canal = createBusinessOrderAlertChannel({ sound, storage: almacenamientoFalso(), ...entornoFalso() });
  await canal.setSoundEnabled(true);
  sound.estado.sonadas = 0;

  const primero = await canal.announceNewOrder({ backendId: 'orden-1', id: 'LT-1' });
  const repetido = await canal.announceNewOrder({ backendId: 'orden-1', id: 'LT-1' });
  assert.equal(primero.announced, true);
  assert.equal(repetido.announced, false);
  assert.equal(sound.estado.sonadas, 1);
});

test('la vibración se intenta y su fracaso no cambia nada', async () => {
  const entorno = entornoFalso();
  const canal = createBusinessOrderAlertChannel({ sound: timbreFalso(), storage: almacenamientoFalso(), ...entorno });
  const resultado = await canal.announceNewOrder({ id: 'LT-1' });
  assert.equal(resultado.vibration, true);
  assert.deepEqual(entorno.registro.vibraciones, ['confirm']);

  // En iOS `navigator.vibrate` no existe: el aviso sigue sucediendo igual.
  const sinMotor = createBusinessOrderAlertChannel({
    sound: timbreFalso(),
    storage: almacenamientoFalso(),
    ...entornoFalso(),
    vibrate: () => { throw new Error('sin Vibration API'); },
  });
  const enIos = await sinMotor.announceNewOrder({ id: 'LT-2' });
  assert.equal(enIos.announced, true);
  assert.equal(enIos.vibration, false);
});

test('el contador de pendientes va a la insignia y al título, y no se repite', () => {
  const entorno = entornoFalso();
  const canal = createBusinessOrderAlertChannel({
    sound: timbreFalso(), storage: almacenamientoFalso(), ...entorno,
  });

  canal.setPendingCount(2);
  assert.equal(entorno.documentRef.title, '(2) La Taba');
  assert.deepEqual(entorno.registro.insignias, [2]);

  // Idempotente: se llama en CADA repintado, así que repetir el mismo número no
  // puede volver a tocar el título ni la insignia.
  canal.setPendingCount(2);
  assert.deepEqual(entorno.registro.insignias, [2]);

  canal.setPendingCount(0);
  assert.equal(entorno.documentRef.title, 'La Taba');
  assert.equal(entorno.registro.limpiezas, 1);
});

test('el contador no se acumula sobre un título ya contado', () => {
  // Si el título ya venía con «(3)» —una recarga con la pestaña marcada— el
  // canal no puede terminar escribiendo «(1) (3) La Taba».
  const entorno = entornoFalso();
  entorno.documentRef.title = '(3) La Taba';
  const canal = createBusinessOrderAlertChannel({
    sound: timbreFalso(), storage: almacenamientoFalso(), ...entorno,
  });
  canal.setPendingCount(1);
  assert.equal(entorno.documentRef.title, '(1) La Taba');
});

test('un navegador sin insignia no rompe el Panel', () => {
  const canal = createBusinessOrderAlertChannel({
    sound: timbreFalso(),
    storage: almacenamientoFalso(),
    navigatorRef: {},
    documentRef: { title: 'La Taba' },
    vibrate: () => false,
  });
  assert.doesNotThrow(() => canal.setPendingCount(4));
});

test('cerrar sesión deja el título y la insignia como estaban', async () => {
  const entorno = entornoFalso();
  const canal = createBusinessOrderAlertChannel({
    sound: timbreFalso(), storage: almacenamientoFalso(), ...entorno,
  });
  canal.setPendingCount(3);
  await canal.announceNewOrder({ id: 'LT-1' });
  canal.reset();
  assert.equal(entorno.documentRef.title, 'La Taba');
  // Y después del reset, el mismo pedido vuelve a poder anunciarse: la sesión
  // siguiente empieza de cero.
  const otraVez = await canal.announceNewOrder({ id: 'LT-1' });
  assert.equal(otraVez.announced, true);
});
