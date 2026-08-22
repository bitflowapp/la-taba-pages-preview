/*
 * La clave de idempotencia, con el contrato del SERVIDOR escrito una sola vez.
 *
 * EL CONTRATO, que no lo inventa este archivo: doce funciones del backend
 * validan la misma expresión antes de tocar nada —`apply_inventory_movement`,
 * `transition_order`, `start_packing_session`, `create_catalog_product_draft`
 * y compañía—, y las tablas de comandos lo repiten como CHECK:
 *
 *     ^[A-Za-z0-9_-]{8,128}$
 *
 * Letras, dígitos, guion bajo y guion medio. NADA MÁS. En particular NO admite
 * dos puntos.
 *
 * POR QUÉ EXISTE ESTE MÓDULO
 * --------------------------
 * El Panel armaba sus claves con `` `${prefijo}:${uuid}` ``, así que TODA
 * operación con idempotencia del Centro de operación —recepción de mercadería,
 * ajuste, conteo físico, mostrador, alta de producto, preparación de pedido—
 * viajaba con un carácter que el servidor rechaza. El error llegaba como
 * «idempotency_key invalida» y no escribía nada: fail-close correcto del lado
 * del servidor, operación imposible del lado del comercio.
 *
 * Lo destapó el primer gate físico de recepción, con la mercadería sobre el
 * mostrador. No lo vio ninguna suite porque los repositorios de prueba aceptan
 * cualquier cadena: la validación real vive en PostgreSQL. Los pedidos sí
 * funcionaban —LT-0001 existe— porque `orderCommandKey` ya saneaba al alfabeto
 * correcto por su cuenta. O sea que el contrato estaba entendido en un archivo
 * y desconocido en el de al lado; por eso ahora hay uno solo.
 *
 * DOS FORMAS, Y CUÁNDO USAR CADA UNA
 * ----------------------------------
 * `operationKey(prefijo, ...partes)` es DETERMINISTA: la misma operación
 * produce la misma clave, que es lo que convierte un segundo toque o un
 * reintento en la respuesta guardada en vez de en una segunda escritura.
 * Úsese siempre que la operación tenga identidad natural (un pedido y su
 * revisión, una sesión de preparación, un borrador de recepción).
 *
 * `randomOperationKey(prefijo)` es el último recurso, para operaciones sin
 * identidad estable. Protege el formato pero NO protege del doble toque.
 */

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const MIN_LENGTH = 8;
const MAX_LENGTH = 128;

export function isValidIdempotencyKey(value) {
  return typeof value === 'string' && IDEMPOTENCY_KEY_PATTERN.test(value);
}

/**
 * Deja un fragmento en el alfabeto del contrato. Todo lo que no entra se
 * reemplaza por `-`, en vez de borrarse: quitar caracteres puede hacer que dos
 * fragmentos distintos terminen iguales, y estas claves existen justamente para
 * distinguir operaciones.
 */
export function sanitizeKeySegment(value) {
  return String(value ?? '').replace(/[^A-Za-z0-9_-]/g, '-');
}

/**
 * Huella determinista y corta de un texto (FNV-1a de 32 bits en base 36).
 *
 * No es criptográfica y no pretende serlo: sólo tiene que distinguir dos
 * identificadores distintos dentro de un comercio, sin depender de APIs
 * asíncronas y sin arrastrar el valor entero a la clave.
 */
function huella(texto) {
  let acumulado = 0x811c9dc5;
  for (let i = 0; i < texto.length; i += 1) {
    acumulado ^= texto.charCodeAt(i);
    acumulado = Math.imul(acumulado, 0x01000193) >>> 0;
  }
  return acumulado.toString(36);
}

/**
 * Reduce un identificador largo a algo corto que SIGA distinguiéndolo.
 *
 * Recortar por el principio no sirve y costó un caso rojo: los identificadores
 * de este proyecto son UUID estructurados —`30000000-0000-4000-8000-…001` y
 * `…002`— que comparten los primeros veinte caracteres y difieren en el
 * último. Un recorte a doce los volvía la misma clave, y dos recepciones de
 * productos distintos habrían chocado. Por eso lo que entra es la cola del
 * valor más una huella de la cadena COMPLETA.
 */
export function compactSegment(value, maxLength = 12) {
  const saneado = sanitizeKeySegment(value);
  if (saneado.length <= maxLength) return saneado;
  return `${saneado.replace(/-/g, '').slice(-4)}${huella(saneado)}`;
}

function ajustarLargo(clave) {
  // El mínimo se completa con relleno derivado de la propia clave, para no
  // volver iguales dos claves cortas distintas.
  let salida = clave;
  while (salida.length < MIN_LENGTH) salida += `-${salida.length}`;
  // El máximo se recorta desde el final. Las claves reales del Panel quedan muy
  // por debajo de 128 (un prefijo y un par de UUID); el recorte existe para que
  // una entrada larga inesperada no se convierta en un rechazo del servidor.
  return salida.slice(0, MAX_LENGTH);
}

/**
 * Clave determinista: misma operación, misma clave.
 * Un segundo toque con los MISMOS datos vuelve con el resultado ya escrito.
 */
export function operationKey(prefix, ...segments) {
  const partes = [prefix, ...segments]
    .map(sanitizeKeySegment)
    .map((parte) => parte.replace(/^-+|-+$/g, ''))
    .filter(Boolean);
  return ajustarLargo(partes.join('-') || 'operacion');
}

/** Clave aleatoria y válida, para operaciones sin identidad estable. */
export function randomOperationKey(prefix) {
  const azar = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return operationKey(prefix, azar);
}
