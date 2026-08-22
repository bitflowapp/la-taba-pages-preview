/*
 * El teléfono del repartidor, manejado por ADB.
 *
 * REGLA DE ORO, y no se relaja: volcar la pantalla → resolver el elemento por
 * su `content-desc` → calcular el centro de sus `bounds` → tocar ahí. NUNCA se
 * tocan coordenadas memorizadas. La app es Flutter: no expone `resource-id` ni
 * `text`, pero describe todo con `content-desc` en español.
 *
 * POR QUÉ ESTO IMPORTA TANTO ACÁ. El reconocimiento del 2026-08-22 encontró que
 * «Cerrar sesión» (en el cajón) y «Llegué» (en el mapa) caen a la MISMA altura:
 * y=2180. Un harness que tapee «el botón de abajo» sin releer la pantalla puede
 * cerrar la sesión de producción del repartidor creyendo que confirma una
 * entrega. Por eso acá cada toque se resuelve contra un volcado fresco y contra
 * una lista negra explícita.
 *
 * Y encontró algo más: el teléfono tiene LT-0001 vivo en pantalla. Este módulo
 * se niega a tocar cualquier cosa mientras el pedido que muestra la app no sea
 * exactamente el de esta corrida.
 */
import { execFileSync } from 'node:child_process';
import { RIDER } from './contrato.mjs';

/** Nada de esto se toca nunca, aunque lo pida el flujo. */
const LISTA_NEGRA = Object.freeze([
  'Cerrar sesión',
  'Rechazar',
  'Rechazar oferta',
  'Reportar un problema',
  'Activar huella o rostro',
  'Abrir en Google Maps',
  'Iniciar y abrir Maps',
  'Cancelar',
  'Eliminar',
  'Borrar',
]);

export class RiderInseguro extends Error {}

const adb = (args, { timeout = 30_000 } = {}) => execFileSync('adb', ['-s', RIDER.serie, ...args], {
  encoding: 'utf8',
  timeout,
  maxBuffer: 16 * 1024 * 1024,
}).trim();

/** El árbol de la pantalla, ahora. Nunca se reusa un volcado viejo. */
export function volcarPantalla() {
  adb(['shell', 'uiautomator', 'dump', '/sdcard/taba-e2e-ui.xml']);
  const xml = adb(['shell', 'cat', '/sdcard/taba-e2e-ui.xml'], { timeout: 45_000 });
  const nodos = [];
  const patron = /<node\b([^>]*)\/?>/g;
  let coincidencia = patron.exec(xml);
  while (coincidencia) {
    const atributos = coincidencia[1];
    const leer = (nombre) => (atributos.match(new RegExp(`${nombre}="([^"]*)"`)) || [])[1] || '';
    const bounds = leer('bounds').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    nodos.push({
      descripcion: leer('content-desc'),
      clase: leer('class'),
      clickable: leer('clickable') === 'true',
      bounds: bounds ? bounds.slice(1).map(Number) : null,
    });
    coincidencia = patron.exec(xml);
  }
  return nodos;
}

/** El pedido que la app está mostrando, leído del contenedor raíz. */
export function pedidoEnPantalla(nodos) {
  const raiz = nodos.find((nodo) => /^Mapa operativo del pedido /.test(nodo.descripcion));
  if (raiz) return raiz.descripcion.replace('Mapa operativo del pedido ', '').trim();
  // Sin pedido, la raíz es «Mapa operativo de TABA2 Rider».
  const capsula = nodos.find((nodo) => /^Estado: /.test(nodo.descripcion));
  return capsula ? null : undefined;
}

export function buscarElemento(nodos, descripcionExacta) {
  return nodos.find((nodo) => nodo.descripcion === descripcionExacta && nodo.bounds) || null;
}

export function buscarPorPrefijo(nodos, prefijo) {
  return nodos.filter((nodo) => nodo.descripcion.startsWith(prefijo));
}

/**
 * Toca un elemento por su etiqueta, con tres condiciones que no se saltean:
 * la etiqueta no está en la lista negra, el volcado es fresco, y el pedido en
 * pantalla es el de esta corrida.
 */
export function tocar(descripcion, { codigoEsperado, permitirSinPedido = false } = {}) {
  if (LISTA_NEGRA.includes(descripcion)) {
    throw new RiderInseguro(`«${descripcion}» está en la lista negra: este harness no lo toca nunca`);
  }
  const nodos = volcarPantalla();
  const enPantalla = pedidoEnPantalla(nodos);
  if (!permitirSinPedido) {
    if (!codigoEsperado) throw new RiderInseguro('no se puede tocar sin saber qué pedido se espera en pantalla');
    if (enPantalla !== codigoEsperado) {
      throw new RiderInseguro(
        `la app muestra ${enPantalla || 'ningún pedido'} y esta corrida es de ${codigoEsperado}: no se toca nada`,
      );
    }
  }
  const elemento = buscarElemento(nodos, descripcion);
  if (!elemento) throw new RiderInseguro(`no hay ningún elemento «${descripcion}» en la pantalla actual`);
  const [x1, y1, x2, y2] = elemento.bounds;
  const x = Math.round((x1 + x2) / 2);
  const y = Math.round((y1 + y2) / 2);
  adb(['shell', 'input', 'tap', String(x), String(y)]);
  return { descripcion, x, y };
}

/** El PIN se escribe en el único campo de texto de la hoja; nunca se registra. */
export function escribirPin(pin, { codigoEsperado }) {
  if (!/^\d{4}$/.test(String(pin || ''))) throw new RiderInseguro('el código de entrega no tiene cuatro dígitos');
  const nodos = volcarPantalla();
  if (pedidoEnPantalla(nodos) !== codigoEsperado) {
    throw new RiderInseguro('la pantalla no está mostrando el pedido de esta corrida');
  }
  const campo = nodos.find((nodo) => /EditText/i.test(nodo.clase) && nodo.bounds);
  if (!campo) throw new RiderInseguro('no se encontró el campo del código de entrega');
  const [x1, y1, x2, y2] = campo.bounds;
  adb(['shell', 'input', 'tap', String(Math.round((x1 + x2) / 2)), String(Math.round((y1 + y2) / 2))]);
  // `input text` no queda en el registro de este proceso: el PIN viaja como
  // argumento a adb y no se imprime nunca.
  adb(['shell', 'input', 'text', String(pin)]);
  return true;
}

export function estadoRider() {
  const nodos = volcarPantalla();
  const capsula = buscarPorPrefijo(nodos, 'Estado: ')[0];
  return {
    pedido: pedidoEnPantalla(nodos),
    estado: capsula ? capsula.descripcion.replace('Estado: ', '') : null,
    ofertas: buscarPorPrefijo(nodos, 'Oferta: ').map((nodo) => nodo.descripcion),
    acciones: nodos.filter((nodo) => nodo.clickable && nodo.descripcion).map((nodo) => nodo.descripcion),
  };
}

/*
 * El teléfono NO es exclusivo de La Taba: durante el reconocimiento apareció en
 * primer plano una app de otro proyecto. Antes de leer o tocar cualquier cosa
 * hay que asegurarse de que lo que está adelante es el Rider de PRODUCCIÓN, y
 * no la app de staging que también está instalada.
 */
export function appEnPrimerPlano() {
  const salida = execFileSync('adb', ['-s', RIDER.serie, 'shell', 'dumpsys', 'activity', 'activities'], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
  });
  const foco = salida.match(/mResumedActivity[^\n]*?([A-Za-z0-9_.]+)\/([A-Za-z0-9_.$]+)/)
    || salida.match(/topResumedActivity[^\n]*?([A-Za-z0-9_.]+)\/([A-Za-z0-9_.$]+)/);
  return foco ? foco[1] : null;
}

/**
 * Trae el Rider de producción al frente. `monkey` lanza la actividad principal
 * sin tocar datos ni sesión — no es `pm clear` ni `force-stop`.
 */
export function traerAlFrente({ esperaMs = 4000 } = {}) {
  const actual = appEnPrimerPlano();
  if (actual === RIDER.paquete) return { yaEstaba: true, paquete: actual };
  if (RIDER.paquetesProhibidos.includes(actual)) {
    throw new RiderInseguro(`en primer plano está ${actual}: esta prueba es contra ${RIDER.paquete}`);
  }
  adb(['shell', 'monkey', '-p', RIDER.paquete, '-c', 'android.intent.category.LAUNCHER', '1'], { timeout: 45_000 });
  execFileSync('adb', ['-s', RIDER.serie, 'shell', 'sleep', String(Math.ceil(esperaMs / 1000))], { encoding: 'utf8', timeout: 60_000 });
  const despues = appEnPrimerPlano();
  if (despues !== RIDER.paquete) {
    throw new RiderInseguro(`no se pudo traer ${RIDER.paquete} al frente (quedó ${despues})`);
  }
  return { yaEstaba: false, paquete: despues };
}

export function capturarPantalla(destino) {
  adb(['shell', 'screencap', '-p', '/sdcard/taba-e2e-shot.png']);
  execFileSync('adb', ['-s', RIDER.serie, 'pull', '/sdcard/taba-e2e-shot.png', destino], { encoding: 'utf8', timeout: 60_000 });
  return destino;
}

export function despertarPantalla() {
  const estado = adb(['shell', 'dumpsys', 'power']);
  if (/mWakefulness=Asleep|mWakefulness=Dozing/.test(estado)) adb(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP']);
  const bloqueada = /mDreamingLockscreen=true/.test(adb(['shell', 'dumpsys', 'window']));
  return { bloqueada };
}

export const LISTA_NEGRA_RIDER = LISTA_NEGRA;
