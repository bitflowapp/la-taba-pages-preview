/*
 * QUÉ TIENE QUE HACER ESTA CORRIDA, DECIDIDO ANTES DE HACER NADA.
 *
 * El runner no pregunta «¿recibo?» cuando ya está frente al botón: mira el
 * estado real del producto y del lock, elige uno de cuatro planes y después lo
 * ejecuta. Separarlo así tiene una razón concreta: el momento de decidir si se
 * carga inventario es el momento MENOS oportuno para improvisar, y una función
 * pura se puede probar con los cuatro casos sin tocar producción.
 *
 * LOS CUATRO CASOS
 * ----------------
 *   1. sin stock y oculto   → hace falta atestación física → recibir, publicar, vender
 *   2. con stock y oculto   → publicar y vender (NO recibir: la mercadería ya está contada)
 *   3. con stock y publicado→ vender directamente
 *   4. corrida anterior sin cerrar → no se crea otro pedido; se diagnostica
 *
 * LA REGLA QUE ATRAVIESA LOS CUATRO: una corrida repetida nunca se convierte en
 * inventario adicional. Si el stock ya subió, el plan pierde la etapa de
 * recepción; no la repite «por las dudas».
 */

export const CASOS = Object.freeze({
  RECIBIR_PUBLICAR_VENDER: 'CASO_1_RECEPCION_PUBLICACION_VENTA',
  PUBLICAR_VENDER: 'CASO_2_PUBLICACION_VENTA',
  VENDER: 'CASO_3_VENTA',
  RECUPERAR: 'CASO_4_RECUPERACION',
  REANUDAR: 'CASO_4_REANUDACION',
});

/** Estados de los que un pedido ya no vuelve. */
const TERMINALES = Object.freeze(['delivered', 'cancelled', 'canceled', 'rejected']);

export const ETAPAS = Object.freeze({
  RECEPCION: 'recepcion',
  PUBLICACION: 'publicacion',
  VENTA: 'venta',
  DIAGNOSTICO: 'diagnostico',
});

const plan = (caso, etapas, motivo, extra = {}) => Object.freeze({
  caso,
  etapas: Object.freeze(etapas),
  motivo,
  requiereAtestacion: etapas.includes(ETAPAS.RECEPCION),
  bloqueo: null,
  ...extra,
});

const planBloqueado = (caso, codigo, mensaje) => Object.freeze({
  caso,
  etapas: Object.freeze([ETAPAS.DIAGNOSTICO]),
  motivo: mensaje,
  requiereAtestacion: false,
  bloqueo: Object.freeze({ ok: false, codigo, mensaje }),
});

/**
 * Decide el plan.
 *
 * `lockPrevio` es una corrida que no cerró. No se trata como un estorbo a
 * saltear: si quedó abierta puede haber un pedido de producción a medias, y el
 * único movimiento seguro es mirar ese pedido —no crear otro—.
 */
export function decidirPlan({
  producto, lockPrevio = null, atestacion = null, pedidoDelLock = null,
} = {}) {
  if (lockPrevio) {
    /*
     * UNA CORRIDA A MEDIAS CON UN PEDIDO VIVO SE REANUDA, NO SE REPITE.
     *
     * Es la diferencia entre «recuperar» y «volver a empezar», y es la que
     * importa: si la corrida anterior alcanzó a crear un pedido real y se cayó
     * después —le pasó el 2026-08-22, buscando en el Panel por el uuid cuando
     * el Panel indexa por código público—, crear OTRO pedido para probar lo
     * mismo dejaría dos ventas reales donde el dueño pidió una. Se retoma el
     * que ya existe, desde donde quedó.
     *
     * Sin pedido anotado no hay nada que retomar y se frena para que alguien
     * mire: un lock sin pedido puede significar que la corrida murió justo
     * mientras compraba.
     */
    if (lockPrevio.pedido && pedidoDelLock) {
      if (TERMINALES.includes(pedidoDelLock.status)) {
        return planBloqueado(
          CASOS.RECUPERAR,
          'PEDIDO_ANTERIOR_TERMINADO',
          `la corrida ${lockPrevio.runId || 'anterior'} dejó ${lockPrevio.pedido} en «${pedidoDelLock.status}»: `
          + 'ya no hay nada que reanudar. Revisalo y liberá el lock.',
        );
      }
      return plan(
        CASOS.REANUDAR,
        [ETAPAS.VENTA],
        `se retoma ${lockPrevio.pedido}, que quedó en «${pedidoDelLock.status}»: no se crea otro pedido`,
        { reanudarCodigo: lockPrevio.pedido, estadoAlReanudar: pedidoDelLock.status },
      );
    }
    return planBloqueado(
      CASOS.RECUPERAR,
      'CORRIDA_ANTERIOR_ABIERTA',
      `hay una corrida sin cerrar (${lockPrevio.runId || 'sin id'}, estado ${lockPrevio.estado || 'desconocido'}`
      + `${lockPrevio.pedido ? `, pedido ${lockPrevio.pedido}` : ' y sin pedido anotado'}): se diagnostica, no se crea otro pedido`,
    );
  }

  if (!producto) {
    return planBloqueado(CASOS.RECUPERAR, 'PRODUCTO_INEXISTENTE', 'el producto autorizado no existe en producción');
  }

  const stock = Number(producto.stock);
  if (!Number.isFinite(stock)) {
    return planBloqueado(CASOS.RECUPERAR, 'STOCK_ILEGIBLE', `el stock del producto no es un número: «${producto.stock}»`);
  }
  const publicado = producto.available === true;

  /*
   * Publicado con stock cero no debería existir —el servidor lo impide— pero si
   * pasara, vender sería prometerle a un cliente algo que no está. Se frena.
   */
  if (publicado && stock <= 0) {
    return planBloqueado(
      CASOS.RECUPERAR,
      'PUBLICADO_SIN_STOCK',
      `el producto figura publicado con stock ${stock}: eso no puede pasar y no se toca sin mirarlo`,
    );
  }

  if (stock > 0 && publicado) {
    return plan(CASOS.VENDER, [ETAPAS.VENTA], `stock ${stock} y publicado: se vende directamente`);
  }

  if (stock > 0 && !publicado) {
    return plan(
      CASOS.PUBLICAR_VENDER,
      [ETAPAS.PUBLICACION, ETAPAS.VENTA],
      `stock ${stock} sin publicar: se publica y se vende, NO se recibe de nuevo`,
    );
  }

  // stock === 0 y oculto: el único caso donde se toca inventario.
  const cantidad = atestacion?.ok ? atestacion.cantidad : null;
  return plan(
    CASOS.RECIBIR_PUBLICAR_VENDER,
    [ETAPAS.RECEPCION, ETAPAS.PUBLICACION, ETAPAS.VENTA],
    'sin stock y oculto: hace falta una atestación física para recibir',
    { cantidadARecibir: cantidad },
  );
}

/**
 * El stock que se espera DESPUÉS de ejecutar el plan y antes de vender.
 *
 * Se calcula acá, junto a la decisión, y no en el medio de la recepción: así el
 * runner puede comparar lo que la base devolvió contra un número que se fijó
 * antes de tocar nada, en vez de contra uno derivado de lo que acaba de pasar.
 */
export function stockEsperadoAntesDeVender({ plan: elPlan, stockActual }) {
  const actual = Number(stockActual) || 0;
  if (!elPlan?.etapas?.includes(ETAPAS.RECEPCION)) return actual;
  return actual + Number(elPlan.cantidadARecibir || 0);
}

/**
 * ¿Esta oferta todavía se puede aceptar?
 *
 * Cada oferta guarda la revisión del pedido que esperaba. Si el pedido cambió
 * desde entonces, el servidor la rechaza y el teléfono muestra «La solicitud
 * cambió» sin que el botón de aceptar haga nada nunca más. Lo que la vuelve
 * obsoleta, medido: que el cliente abra su pantalla de seguimiento, porque eso
 * rota su token y sube la revisión del pedido.
 */
export function ofertaSigueVigente(oferta, revisionDelPedido) {
  if (!oferta || oferta.status !== 'pending') return false;
  const esperada = Number(oferta.expected_order_revision);
  const actual = Number(revisionDelPedido);
  if (!Number.isFinite(esperada) || !Number.isFinite(actual)) return false;
  return esperada === actual;
}

export function describirPlan(elPlan) {
  if (!elPlan) return 'sin plan';
  const etapas = elPlan.etapas.join(' → ');
  return `${elPlan.caso} · ${etapas}${elPlan.cantidadARecibir ? ` · recibir ${elPlan.cantidadARecibir}` : ''}`;
}
