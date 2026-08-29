/*
 * PARCHE DE LA BANDEJA: QUE UN PEDIDO QUE CAMBIA NO REARME EL TABLERO.
 * ===========================================================================
 *
 * EL PROBLEMA, MEDIDO
 * -------------------
 * El Panel dibuja el workspace del negocio reemplazando su `innerHTML`. Con seis
 * pedidos eso es gratis. Con quinientos —el tope que sirve el repositorio— cada
 * cambio de UN pedido tira y reconstruye el tablero entero: decenas de miles de
 * elementos, el scroll que se mueve, el `<select>` de rider que vuelve a la
 * primera opción y el motivo de cancelación a medio escribir que hay que
 * rescatar y volver a poner con pinzas.
 *
 * Rescatar y volver a poner funciona —el Panel ya lo hacía— pero es una cura
 * para una herida autoinfligida: la tarjeta que NO cambió no tenía por qué
 * desaparecer.
 *
 * LO QUE HACE ESTE MÓDULO
 * -----------------------
 * Dos piezas, las dos chicas:
 *
 *   · `planTrayReconciliation` — PURA. Recibe qué tarjetas hay y cuáles debería
 *     haber, cada una con su huella, y devuelve la lista mínima de operaciones:
 *     qué quitar, qué reemplazar, qué mover y qué insertar. No toca el DOM, así
 *     que se puede probar sin navegador y es donde vive toda la lógica.
 *
 *   · `aplicarReconciliacion` — el brazo. Ejecuta ese plan sobre un contenedor
 *     real. Deliberadamente tonta: sin decisiones propias.
 *
 * POR QUÉ NO VIRTUALIZACIÓN
 * -------------------------
 * Virtualizar —dibujar sólo lo que entra en pantalla— es la respuesta de moda y
 * acá habría sido peor: rompe Ctrl+F, rompe el orden de tabulación, obliga a
 * medir alturas variables (una tarjeta con seis productos y observaciones no
 * mide como una de uno) y deja al lector de pantalla sin la lista completa. El
 * costo que duele no es tener 500 tarjetas en el DOM: es RECONSTRUIRLAS. Esto
 * ataca eso y deja el documento entero, que es lo que el operador busca cuando
 * rastrea un pedido por el nombre del cliente.
 *
 * LA HUELLA
 * ---------
 * `huellaDeMarcado` es FNV-1a de 32 bits sobre el marcado ya generado. Sale del
 * marcado REAL y no de «revisión + estado», y esa diferencia importa: la tarjeta
 * también cambia por cosas que no son del pedido —los pagos del día, qué riders
 * están en turno, si su propio botón está en vuelo— y una huella derivada de la
 * revisión del servidor se perdería todas esas.
 */

/** FNV-1a de 32 bits. Alcanza para «¿esto es el mismo marcado que antes?». */
export function huellaDeMarcado(texto) {
  let hash = 0x811c9dc5;
  const cadena = String(texto ?? '');
  for (let i = 0; i < cadena.length; i += 1) {
    hash ^= cadena.charCodeAt(i);
    // El equivalente a multiplicar por 16777619 sin salirse de 32 bits.
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  // La longitud entra en la huella: dos marcados de largo distinto no pueden
  // colisionar, que es el caso frecuente (una tarjeta gana o pierde un botón).
  return `${hash.toString(36)}:${cadena.length}`;
}

/**
 * El plan mínimo para que `actuales` termine siendo `deseados`.
 *
 * Las dos listas son de `{ clave, huella }` EN EL ORDEN EN QUE ESTÁN. Devuelve
 * las operaciones ya ordenadas para aplicarse tal cual vienen: primero las
 * bajas, después los reemplazos —que son en el lugar— y al final el orden. Esa
 * secuencia es la que hace que `antes` siempre apunte a una clave que todavía
 * existe cuando le toca.
 */
export function planTrayReconciliation(actuales = [], deseados = []) {
  const deseadoPorClave = new Map();
  const orden = [];
  for (const entrada of Array.isArray(deseados) ? deseados : []) {
    const clave = entrada?.clave;
    // Una clave repetida sería un pedido duplicado en la bandeja. No puede
    // pasar —el reconciliador de snapshots indexa por identidad— y si pasara,
    // duplicarla en el DOM haría que las dos tarjetas se pisaran para siempre.
    if (!clave || deseadoPorClave.has(clave)) continue;
    deseadoPorClave.set(clave, entrada);
    orden.push(clave);
  }
  const actualPorClave = new Map();
  const vivos = [];
  for (const entrada of Array.isArray(actuales) ? actuales : []) {
    const clave = entrada?.clave;
    if (!clave || actualPorClave.has(clave)) continue;
    actualPorClave.set(clave, entrada);
    if (deseadoPorClave.has(clave)) vivos.push(clave);
  }

  const operaciones = [];
  let quitadas = 0;
  for (const [clave] of actualPorClave) {
    if (deseadoPorClave.has(clave)) continue;
    operaciones.push({ tipo: 'quitar', clave });
    quitadas += 1;
  }

  let reemplazadas = 0;
  for (const clave of orden) {
    const antes = actualPorClave.get(clave);
    if (!antes || antes.huella === deseadoPorClave.get(clave).huella) continue;
    operaciones.push({ tipo: 'reemplazar', clave });
    reemplazadas += 1;
  }

  /*
   * EL ORDEN, MOVIENDO LO MÍNIMO.
   * -------------------------------------------------------------------------
   * La primera versión de esto recorría el destino de adelante hacia atrás y
   * movía todo lo que no estuviera en su lugar. Es correcto y es carísimo:
   * medido con 500 pedidos, aceptar UNO —que lo saca de «Nuevos» y lo baja a
   * «En preparación»— desplaza a los 165 que estaban en el medio, y esa versión
   * movía los 166. Un `insertBefore` es un `remove` y un `insert` para el
   * navegador y para todo lo que estuviera dentro de la tarjeta.
   *
   * Sólo UNA tarjeta se movió de verdad. Las otras 165 quedaron corridas, que no
   * es lo mismo.
   *
   * La subsecuencia creciente más larga separa una cosa de la otra: las
   * tarjetas cuyo orden relativo ya es el correcto se dejan quietas, y sólo se
   * mueven las que rompen esa secuencia. Se recorre de atrás para adelante para
   * que el ancla —la tarjeta siguiente— ya esté en su posición final.
   */
  const posicionActual = new Map();
  vivos.forEach((clave, indice) => posicionActual.set(clave, indice));
  const anteriores = orden.map((clave) => (posicionActual.has(clave) ? posicionActual.get(clave) : -1));
  const quedanQuietas = subsecuenciaCrecienteMasLarga(anteriores);

  let insertadas = 0;
  let movidas = 0;
  for (let i = orden.length - 1; i >= 0; i -= 1) {
    const clave = orden[i];
    const ancla = orden[i + 1] ?? null;
    if (anteriores[i] === -1) {
      operaciones.push({ tipo: 'insertar', clave, antes: ancla });
      insertadas += 1;
    } else if (!quedanQuietas.has(i)) {
      operaciones.push({ tipo: 'mover', clave, antes: ancla });
      movidas += 1;
    }
  }

  return {
    operaciones,
    resumen: {
      total: orden.length,
      quitadas,
      reemplazadas,
      insertadas,
      movidas,
      // Lo que el operador no ve moverse. Es el número que este trabajo
      // existe para subir.
      intactas: orden.length - reemplazadas - insertadas,
    },
  };
}

/**
 * Ejecuta el plan sobre un contenedor real.
 *
 * `marcadoPorClave` responde el HTML de una tarjeta. `alReemplazar(viejo, nuevo)`
 * es el gancho para trasplantar lo que el operador tenía escrito en la tarjeta
 * que sí cambia; el resto de las tarjetas no se tocan y no necesitan rescate.
 */
export function aplicarReconciliacion(contenedor, operaciones = [], {
  marcadoPorClave,
  atributoDeClave = 'data-order-card',
  alReemplazar = () => {},
} = {}) {
  if (!contenedor || typeof marcadoPorClave !== 'function') return { aplicadas: 0 };
  const nodos = new Map();
  for (const hijo of Array.from(contenedor.children || [])) {
    const clave = hijo.getAttribute?.(atributoDeClave);
    if (clave) nodos.set(clave, hijo);
  }

  let aplicadas = 0;
  for (const operacion of operaciones) {
    const { tipo, clave } = operacion;
    if (tipo === 'quitar') {
      nodos.get(clave)?.remove?.();
      nodos.delete(clave);
      aplicadas += 1;
      continue;
    }
    if (tipo === 'reemplazar') {
      const viejo = nodos.get(clave);
      const nuevo = elementoDesdeMarcado(contenedor, marcadoPorClave(clave));
      if (!viejo || !nuevo) continue;
      alReemplazar(viejo, nuevo);
      viejo.replaceWith(nuevo);
      nodos.set(clave, nuevo);
      aplicadas += 1;
      continue;
    }
    if (tipo === 'insertar') {
      const nuevo = elementoDesdeMarcado(contenedor, marcadoPorClave(clave));
      if (!nuevo) continue;
      contenedor.insertBefore(nuevo, nodos.get(operacion.antes) || null);
      nodos.set(clave, nuevo);
      aplicadas += 1;
      continue;
    }
    if (tipo === 'mover') {
      const nodo = nodos.get(clave);
      if (!nodo) continue;
      contenedor.insertBefore(nodo, nodos.get(operacion.antes) || null);
      aplicadas += 1;
    }
  }
  return { aplicadas };
}

/** Las tarjetas que hay ahora en el contenedor, en orden, con su huella. */
export function leerTarjetasDelDom(contenedor, huellas, atributoDeClave = 'data-order-card') {
  const actuales = [];
  for (const hijo of Array.from(contenedor?.children || [])) {
    const clave = hijo.getAttribute?.(atributoDeClave);
    if (clave) actuales.push({ clave, huella: huellas?.get?.(clave) ?? null });
  }
  return actuales;
}

/**
 * Los índices de `valores` que ya están en orden creciente entre sí, tomando la
 * subsecuencia más larga posible. Los `-1` —elementos nuevos, que no estaban en
 * el DOM— quedan afuera: no hay nada que dejar quieto.
 *
 * Es el paso de parche por listas con clave que usan los frameworks modernos, y
 * la razón por la que mover un elemento cuesta un movimiento y no N.
 */
export function subsecuenciaCrecienteMasLarga(valores = []) {
  const colas = [];
  const anterior = new Array(valores.length).fill(-1);
  for (let i = 0; i < valores.length; i += 1) {
    const valor = valores[i];
    if (valor === -1) continue;
    let bajo = 0;
    let alto = colas.length;
    while (bajo < alto) {
      const medio = (bajo + alto) >> 1;
      if (valores[colas[medio]] < valor) bajo = medio + 1;
      else alto = medio;
    }
    anterior[i] = bajo > 0 ? colas[bajo - 1] : -1;
    colas[bajo] = i;
  }
  const resultado = new Set();
  let indice = colas.length ? colas[colas.length - 1] : -1;
  while (indice !== -1) {
    resultado.add(indice);
    indice = anterior[indice];
  }
  return resultado;
}

function elementoDesdeMarcado(contenedor, marcado) {
  const documento = contenedor.ownerDocument || globalThis.document;
  if (!documento?.createElement) return null;
  const plantilla = documento.createElement('template');
  plantilla.innerHTML = String(marcado || '').trim();
  const elemento = plantilla.content?.firstElementChild;
  return elemento ? documento.importNode(elemento, true) : null;
}
