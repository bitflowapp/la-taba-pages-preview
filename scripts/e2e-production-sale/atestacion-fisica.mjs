/*
 * LA ÚNICA COSA QUE EL SOFTWARE NO PUEDE AVERIGUAR SOLO.
 *
 * Cuántas botellas hay realmente sobre el mostrador. No hay consulta, ni
 * sensor, ni heurística: alguien tiene que mirarlas y contarlas. Todo lo demás
 * de esta automatización se mide; esto se ATESTIGUA.
 *
 * Por eso la entrada humana no es un número suelto, que se teclea sin pensar,
 * sino DOS declaraciones que tienen que decir lo mismo:
 *
 *   TABA2_E2E_PHYSICAL_QTY=6
 *   TABA2_E2E_PHYSICAL_CONFIRMATION=I_CONFIRM_6_PHYSICAL_UNITS_EXIST
 *
 * Escribir el número dos veces, una de ellas dentro de una frase que hay que
 * leer entera, es lo que convierte «6» en una afirmación. Si no coinciden, no
 * se recibe nada: un `qty=6` con una confirmación de 5 es exactamente la clase
 * de descuido que carga inventario que no existe, y el inventario inventado no
 * se nota hasta que un cliente compra algo que no está.
 *
 * Módulo puro a propósito: sin red, sin base, sin navegador. Se puede probar
 * entero con un objeto de entorno de mentira.
 */

export const VARIABLE_CANTIDAD = 'TABA2_E2E_PHYSICAL_QTY';
export const VARIABLE_CONFIRMACION = 'TABA2_E2E_PHYSICAL_CONFIRMATION';

/** El techo de una recepción automatizada. Más que esto se carga a mano. */
export const CANTIDAD_MAXIMA = 24;

export const frase = (cantidad) => `I_CONFIRM_${cantidad}_PHYSICAL_UNITS_EXIST`;

const sinAtestiguar = (motivo) => Object.freeze({
  ok: false,
  cantidad: null,
  codigo: 'PHYSICAL_STOCK_NOT_ATTESTED',
  mensaje: motivo,
});

/**
 * Lee las dos variables y decide si hay una atestación válida.
 *
 * Devuelve `{ ok: false, presente: false }` cuando no hay NINGUNA de las dos:
 * eso no es un error, es una corrida que no venía a recibir mercadería —el caso
 * en que el producto ya tiene stock—. Que falte una sola sí es un error: quien
 * escribió una y no la otra estaba por recibir algo.
 */
export function leerAtestacionFisica(env = process.env) {
  const crudoCantidad = String(env[VARIABLE_CANTIDAD] ?? '').trim();
  const crudoConfirmacion = String(env[VARIABLE_CONFIRMACION] ?? '').trim();

  if (!crudoCantidad && !crudoConfirmacion) {
    return Object.freeze({
      ok: false,
      presente: false,
      cantidad: null,
      codigo: 'PHYSICAL_STOCK_NOT_ATTESTED',
      mensaje: `no hay atestación de stock físico: falta ${VARIABLE_CANTIDAD} y ${VARIABLE_CONFIRMACION}`,
    });
  }

  const incompleta = (falta) => Object.freeze({
    ...sinAtestiguar(`la atestación está a medias: falta ${falta}`),
    presente: true,
  });
  if (!crudoCantidad) return incompleta(VARIABLE_CANTIDAD);
  if (!crudoConfirmacion) return incompleta(VARIABLE_CONFIRMACION);

  if (!/^[0-9]{1,3}$/.test(crudoCantidad)) {
    return Object.freeze({ ...sinAtestiguar(`${VARIABLE_CANTIDAD} tiene que ser un entero: llegó «${crudoCantidad}»`), presente: true });
  }
  const cantidad = Number(crudoCantidad);
  if (cantidad < 1) {
    return Object.freeze({ ...sinAtestiguar('no se puede atestiguar una recepción de cero unidades'), presente: true });
  }
  if (cantidad > CANTIDAD_MAXIMA) {
    return Object.freeze({
      ...sinAtestiguar(`${cantidad} supera el techo de ${CANTIDAD_MAXIMA} de esta automatización: cargala desde el Panel a mano`),
      presente: true,
    });
  }

  /*
   * La comparación es EXACTA y sensible a mayúsculas. Aceptar variantes sería
   * aceptar que la frase se escriba de memoria, y la frase existe justamente
   * para que haya que leerla.
   */
  if (crudoConfirmacion !== frase(cantidad)) {
    const declarada = (crudoConfirmacion.match(/^I_CONFIRM_(\d{1,3})_PHYSICAL_UNITS_EXIST$/) || [])[1];
    const detalle = declarada !== undefined && declarada !== crudoCantidad
      ? `la cantidad dice ${crudoCantidad} y la confirmación dice ${declarada}`
      : `la confirmación tiene que ser exactamente «${frase(cantidad)}»`;
    return Object.freeze({ ...sinAtestiguar(`las dos declaraciones no coinciden: ${detalle}`), presente: true });
  }

  return Object.freeze({
    ok: true,
    presente: true,
    cantidad,
    codigo: null,
    mensaje: `${cantidad} unidad(es) atestiguadas por una persona`,
  });
}

/**
 * La compuerta que usa el orquestador cuando SABE que hace falta recibir.
 *
 * Se separa de la lectura porque el resultado depende del caso: sin stock hay
 * que exigirla, y con stock cargado no sólo no hace falta sino que no se puede
 * usar —recibir de nuevo sería duplicar mercadería que ya está contada—.
 */
export function evaluarAtestacion(atestacion, { hace_falta: haceFalta }) {
  if (!haceFalta) {
    if (atestacion?.ok) {
      return Object.freeze({
        ok: false,
        codigo: 'ATESTACION_NO_APLICABLE',
        mensaje: 'el producto ya tiene stock cargado: una atestación física ahora sumaría inventario de más. Quitá las dos variables y volvé a correr.',
      });
    }
    return Object.freeze({ ok: true, codigo: null, mensaje: '' });
  }
  if (atestacion?.ok) return Object.freeze({ ok: true, codigo: null, mensaje: '' });
  return Object.freeze({
    ok: false,
    codigo: atestacion?.codigo || 'PHYSICAL_STOCK_NOT_ATTESTED',
    mensaje: atestacion?.mensaje || 'PHYSICAL STOCK NOT ATTESTED',
  });
}
