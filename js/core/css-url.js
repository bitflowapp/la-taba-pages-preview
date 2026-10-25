/*
 * VALOR SEGURO PARA url('…') DENTRO DE UN style="…".
 *
 * `encodeURI` NO escapa `'`, `(` ni `)`. La miniatura de una historia viene del
 * backend y se interpolaba así en el estilo en línea del círculo: un valor con una
 * comilla simple cerraba el `url()` y dejaba escribir CSS propio en el atributo
 * —otro `background-image`, `position: fixed`, lo que fuera—. Acá se escapan los
 * tres, así que el valor no puede salirse de sus comillas. `"` y `\` ya los
 * codifica `encodeURI`.
 *
 * Una cadena que `encodeURI` no puede codificar (sustitutos sueltos) devuelve '':
 * mejor una miniatura vacía que una pantalla de inicio que no se dibuja.
 */
export function cssUrlValue(url) {
  try {
    return encodeURI(String(url ?? '')).replace(/['()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  } catch (_) {
    return '';
  }
}
