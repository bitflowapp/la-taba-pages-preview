/*
 * Una ejecución, un pedido. Como máximo.
 *
 * El lock no es contra la concurrencia de máquinas: es contra la repetición.
 * Si una corrida quedó a medias —el navegador se cerró, el teléfono se
 * desconectó, alguien cortó con Ctrl+C— el archivo queda, y la próxima corrida
 * se niega a crear OTRO pedido real hasta que una persona mire qué pasó con el
 * anterior. Un pedido de producción huérfano se cierra a mano, no se tapa con
 * otro pedido.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { RUTAS } from './contrato.mjs';

const rutaLock = (raiz) => path.join(raiz, RUTAS.lock);

export function generarRunId({ ahora = new Date(), azar = null } = {}) {
  const sello = ahora.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const sufijo = azar || globalThis.crypto?.randomUUID?.().slice(0, 8) || Math.random().toString(36).slice(2, 10);
  return `${sello}-${sufijo}`;
}

export function leerLock(raiz = process.cwd()) {
  const ruta = rutaLock(raiz);
  if (!existsSync(ruta)) return null;
  try {
    return JSON.parse(readFileSync(ruta, 'utf8'));
  } catch {
    // Un lock ilegible se trata como lock: fallar cerrado.
    return { runId: '(ilegible)', estado: 'desconocido', abierto: true };
  }
}

export function tomarLock({ runId, modo, raiz = process.cwd() }) {
  const ruta = rutaLock(raiz);
  mkdirSync(path.dirname(ruta), { recursive: true });
  const contenido = { runId, modo, estado: 'abierto', abierto: true, tomadoUtc: new Date().toISOString(), pedido: null };
  writeFileSync(ruta, `${JSON.stringify(contenido, null, 2)}\n`);
  return contenido;
}

export function anotarPedidoEnLock({ runId, pedido, raiz = process.cwd() }) {
  const actual = leerLock(raiz);
  if (!actual || actual.runId !== runId) return;
  writeFileSync(rutaLock(raiz), `${JSON.stringify({ ...actual, pedido }, null, 2)}\n`);
}

export function cerrarLock({ runId, estado, raiz = process.cwd() }) {
  const actual = leerLock(raiz);
  if (!actual || actual.runId !== runId) return;
  if (estado === 'ok') {
    // Una corrida que terminó bien libera el paso.
    rmSync(rutaLock(raiz), { force: true });
    return;
  }
  // Una corrida que falló DEJA el lock: la próxima tiene que mirarla primero.
  writeFileSync(rutaLock(raiz), `${JSON.stringify({ ...actual, estado, abierto: true, cerradoUtc: new Date().toISOString() }, null, 2)}\n`);
}
