// CERTIFICACIÓN E-COMMERCE — cerrojo de salida de la máquina.
//
// Los destinos `local` y `stack` no necesitan salir nunca de loopback. Acá está el
// cerrojo que lo garantiza por debajo de cualquier `fetch`: todo socket TCP de Node
// pasa por `net.Socket.prototype.connect` (también `tls.connect`, el `fetch` global,
// `http.request` y `pg`), y con el cerrojo puesto un destino que no sea loopback lanza
// ANTES de resolver el nombre y de mandar un byte. Vale para todo el proceso y no se
// quita: quien lo instaló no vuelve a necesitar la red.
//
// Staging no lo usa: su resguardo es la lista de hosts de `guardedFetch`.
import net from 'node:net';

const EGRESS_LOCK = Symbol.for('taba.ecommerce-certification.egress-lock');
export const LOOPBACK_HOSTS = Object.freeze(['127.0.0.1', '::1', 'localhost']);
export const isLoopbackHost = (host) => LOOPBACK_HOSTS.includes(String(host ?? '').toLowerCase().replace(/^\[|\]$/g, ''));

function connectDestination(args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];   // `net` normaliza a [opciones, callback]
  if (first !== null && typeof first === 'object') return first.path ? null : { host: String(first.host ?? 'localhost'), port: first.port };
  if (typeof first === 'string' && !/^[0-9]+$/.test(first)) return null;   // un pipe con nombre: no es red
  return { host: typeof args[1] === 'string' ? args[1] : 'localhost', port: first };
}

// `errorPrefix` es el del destino que lo instala (`LOCAL_TARGET_EGRESS_REFUSED`, `STACK_TARGET_EGRESS_REFUSED`):
// el primero que llega lo fija para el proceso.
export function installEgressLock({ errorPrefix = 'EGRESS_REFUSED' } = {}) {
  const installed = net.Socket.prototype.connect[EGRESS_LOCK];
  if (installed) return installed;
  const original = net.Socket.prototype.connect;
  const state = { destinations: {}, refused: [], errorPrefix };
  function connect(...args) {
    const to = connectDestination(args);
    if (to && !isLoopbackHost(to.host)) {
      state.refused.push(`${to.host}:${to.port}`);
      throw Error(`${errorPrefix}:${to.host}`);
    }
    if (to) state.destinations[`${to.host}:${to.port}`] = (state.destinations[`${to.host}:${to.port}`] || 0) + 1;
    return original.apply(this, args);
  }
  connect[EGRESS_LOCK] = state;
  net.Socket.prototype.connect = connect;
  return state;
}
export const egressLockIsInstalled = () => Boolean(net.Socket.prototype.connect[EGRESS_LOCK]);
// Los destinos a los que se conectó el proceso que NO son loopback (tiene que ser una lista vacía).
export const offMachine = (state) => Object.keys(state.destinations).filter((destination) => !isLoopbackHost(destination.slice(0, destination.lastIndexOf(':'))));
