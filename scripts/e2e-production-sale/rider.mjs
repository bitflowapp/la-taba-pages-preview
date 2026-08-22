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

/*
 * ══ CORRELACIÓN: TRABAJAR SOBRE EL PEDIDO DE ESTA CORRIDA Y SOBRE NINGÚN OTRO ══
 *
 * El repartidor de producción puede llevar hasta TRES entregas a la vez
 * (`rider_max_active_orders()` = 3), y de hecho el día que se escribió esto
 * tenía una vieja sin cerrar. O sea que «el pedido que está en pantalla» no es
 * necesariamente el nuestro, y avanzar el equivocado sería mover la entrega de
 * otra persona.
 *
 * Todo lo que sigue busca el pedido por su CÓDIGO PÚBLICO, y `tocar()` vuelve a
 * comprobarlo antes de cada toque.
 */

/** ¿Aparece este código en algún lugar de la pantalla, y dónde? */
export function nodosDelPedido(nodos, codigo) {
  const buscado = String(codigo || '').trim();
  if (!buscado) return [];
  return nodos.filter((nodo) => nodo.descripcion.includes(buscado) && nodo.bounds);
}

/**
 * Deja en pantalla el pedido pedido.
 *
 * Si ya está, no toca nada. Si no está pero aparece en una lista, toca el
 * elemento clickable más chico que lo menciona —el más chico es la fila, no el
 * contenedor de toda la pantalla— y vuelve a mirar.
 *
 * `tolerante` existe para los sondeos: durante una espera el pedido puede
 * todavía no haber llegado al teléfono, y eso no es un error todavía.
 */
export function seleccionarPedido(codigo, { tolerante = false, intentos = 2 } = {}) {
  for (let intento = 0; intento < intentos; intento += 1) {
    const nodos = volcarPantalla();
    if (pedidoEnPantalla(nodos) === codigo) return true;
    const candidatos = nodosDelPedido(nodos, codigo)
      .filter((nodo) => nodo.clickable && !LISTA_NEGRA.includes(nodo.descripcion))
      .sort((a, b) => area(a) - area(b));
    if (!candidatos.length) break;
    const [x1, y1, x2, y2] = candidatos[0].bounds;
    adb(['shell', 'input', 'tap', String(Math.round((x1 + x2) / 2)), String(Math.round((y1 + y2) / 2))]);
    adb(['shell', 'sleep', '2']);
  }
  if (pedidoEnPantalla(volcarPantalla()) === codigo) return true;
  if (tolerante) return false;
  throw new RiderInseguro(`no se pudo poner ${codigo} en pantalla: no se toca nada`);
}

const area = (nodo) => {
  const [x1, y1, x2, y2] = nodo.bounds;
  return Math.max(1, (x2 - x1) * (y2 - y1));
};

/**
 * Acepta la oferta de ESTE pedido, si está ofrecida.
 *
 * La compuerta es doble: la etiqueta de la oferta tiene que mencionar el código
 * de la corrida, y el botón de aceptar tiene que estar dentro de esa misma
 * tarjeta —se elige el «Aceptar» más cercano por debajo del renglón de la
 * oferta—. Aceptar el «Aceptar» de otra tarjeta sería tomarle el viaje a otro.
 */
export function aceptarOfertaDe(codigo, estado = null) {
  const nodos = volcarPantalla();
  const actual = estado || {
    ofertas: buscarPorPrefijo(nodos, 'Oferta: ').map((nodo) => nodo.descripcion),
  };
  const oferta = (actual.ofertas || []).find((texto) => texto.includes(codigo));
  if (!oferta) return false;
  const renglon = nodos.find((nodo) => nodo.descripcion === oferta && nodo.bounds);
  const aceptar = nodos
    .filter((nodo) => /^Aceptar/.test(nodo.descripcion) && nodo.clickable && nodo.bounds)
    .filter((nodo) => !renglon || nodo.bounds[1] >= renglon.bounds[1])
    .sort((a, b) => a.bounds[1] - b.bounds[1])[0];
  if (!aceptar) return false;
  const [x1, y1, x2, y2] = aceptar.bounds;
  adb(['shell', 'input', 'tap', String(Math.round((x1 + x2) / 2)), String(Math.round((y1 + y2) / 2))]);
  adb(['shell', 'sleep', '2']);
  return true;
}

/**
 * Cierra la aplicación y la vuelve a abrir, para la prueba de persistencia.
 *
 * `force-stop` está permitido ACÁ y sólo acá, y con una condición: que no haya
 * ninguna entrega viva. Matar el proceso mientras un viaje publica su posición
 * le corta el rastreo a un cliente real, así que primero se pregunta.
 */
export function reiniciarAplicacion({ esperaMs = 6000 } = {}) {
  const estado = estadoRider();
  if (estado.pedido) {
    throw new RiderInseguro(
      `el teléfono todavía muestra ${estado.pedido}: no se cierra la aplicación con una entrega en curso`,
    );
  }
  adb(['shell', 'am', 'force-stop', RIDER.paquete], { timeout: 45_000 });
  adb(['shell', 'sleep', '2']);
  adb(['shell', 'monkey', '-p', RIDER.paquete, '-c', 'android.intent.category.LAUNCHER', '1'], { timeout: 45_000 });
  adb(['shell', 'sleep', String(Math.ceil(esperaMs / 1000))], { timeout: 60_000 });
  const despues = appEnPrimerPlano();
  if (despues !== RIDER.paquete) {
    throw new RiderInseguro(`la aplicación no volvió al frente después de reiniciarla (quedó ${despues})`);
  }
  return true;
}

export const LISTA_NEGRA_RIDER = LISTA_NEGRA;
