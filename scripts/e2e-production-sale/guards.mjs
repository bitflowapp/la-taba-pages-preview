/*
 * Las compuertas. Todas fallan CERRADAS: si algo no se puede comprobar, la
 * respuesta es que no se crea el pedido.
 *
 * Están separadas del orquestador para que se puedan probar sin navegador, sin
 * teléfono y sin red — que es exactamente lo que hace
 * tests/production-sale-e2e-harness.test.mjs.
 */
import { AUTORIZACION, direccionPermitida, PAGOS_PERMITIDOS, PRODUCTO_AUTORIZADO } from './contrato.mjs';

export const bloqueo = (codigo, mensaje) => Object.freeze({ ok: false, codigo, mensaje });
export const permitido = Object.freeze({ ok: true, codigo: null, mensaje: '' });

/**
 * ¿Puede esta corrida crear un pedido REAL?
 *
 * Exige las cuatro llaves a la vez. Falta una y el harness sigue existiendo,
 * pero en seco: mide, valida y reporta sin comprar nada.
 */
export function evaluarAutorizacion({ flags = new Set(), env = {} } = {}) {
  const faltantes = AUTORIZACION.flags.filter((flag) => !flags.has(flag));
  if (faltantes.length) {
    return bloqueo('FLAGS_FALTANTES', `faltan las banderas: ${faltantes.map((f) => `--${f}`).join(' ')}`);
  }
  if (env[AUTORIZACION.variable] !== AUTORIZACION.valor) {
    return bloqueo('AUTORIZACION_AUSENTE', `falta ${AUTORIZACION.variable}="${AUTORIZACION.valor}" en el entorno`);
  }
  return permitido;
}

/** El producto, contra el contrato y contra lo que la base dice HOY. */
export function evaluarProducto(fila, { cantidad = PRODUCTO_AUTORIZADO.cantidad, aceptaPrecioDistinto = false } = {}) {
  if (!fila) return bloqueo('PRODUCTO_INEXISTENTE', 'el producto autorizado no existe en producción');
  if (fila.external_id !== PRODUCTO_AUTORIZADO.externalId) {
    return bloqueo('SKU_NO_AUTORIZADO', `esta automatización sólo compra ${PRODUCTO_AUTORIZADO.externalId}`);
  }
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > PRODUCTO_AUTORIZADO.cantidadMaxima) {
    return bloqueo('CANTIDAD_NO_AUTORIZADA', `la cantidad tiene que ser exactamente ${PRODUCTO_AUTORIZADO.cantidadMaxima}`);
  }
  if (fila.is_alcoholic === true) return bloqueo('ALCOHOL', 'un producto con alcohol nunca entra a esta prueba');
  if (fila.available !== true) return bloqueo('NO_PUBLICADO', 'el producto no está publicado: falta la recepción física y publicarlo desde el Panel');
  if (fila.is_verified !== true || fila.is_active !== true) return bloqueo('NO_VERIFICADO', 'el producto no está verificado/activo');
  const stock = Number(fila.stock);
  if (!Number.isFinite(stock) || stock < cantidad) {
    return bloqueo('SIN_STOCK', `stock ${fila.stock}: hace falta al menos ${cantidad}`);
  }
  const precio = Number(fila.price);
  if (precio !== PRODUCTO_AUTORIZADO.precioEsperado && !aceptaPrecioDistinto) {
    return bloqueo('PRECIO_DISTINTO', `el precio es ${precio} y el contrato dice ${PRODUCTO_AUTORIZADO.precioEsperado}: hace falta aceptación explícita`);
  }
  return permitido;
}

/**
 * Lo del producto que tiene que ser cierto SIEMPRE, en cualquier etapa.
 *
 * `evaluarProducto` es la compuerta de la venta: exige stock y publicación,
 * que es correcto justo antes de comprar y es INCORRECTO en el precheck de una
 * corrida que viene a recibir —ahí el producto está en cero y oculto a
 * propósito—. Sin esta versión, el precheck automático se quedaba sin mirar la
 * identidad del SKU, el alcohol, la verificación y el precio, que no dependen de
 * la etapa y que son justamente lo que no puede cambiar en silencio.
 */
export function evaluarProductoBase(fila, { aceptaPrecioDistinto = false } = {}) {
  if (!fila) return bloqueo('PRODUCTO_INEXISTENTE', 'el producto autorizado no existe en producción');
  if (fila.external_id !== PRODUCTO_AUTORIZADO.externalId) {
    return bloqueo('SKU_NO_AUTORIZADO', `esta automatización sólo compra ${PRODUCTO_AUTORIZADO.externalId}`);
  }
  if (fila.is_alcoholic === true) return bloqueo('ALCOHOL', 'un producto con alcohol nunca entra a esta prueba');
  if (fila.is_verified !== true || fila.is_active !== true) {
    return bloqueo('NO_VERIFICADO', 'el producto no está verificado/activo');
  }
  const precio = Number(fila.price);
  if (precio !== PRODUCTO_AUTORIZADO.precioEsperado && !aceptaPrecioDistinto) {
    return bloqueo('PRECIO_DISTINTO', `el precio es ${precio} y el contrato dice ${PRODUCTO_AUTORIZADO.precioEsperado}: hace falta aceptación explícita`);
  }
  return permitido;
}

/** El comercio tiene que estar realmente abierto y sin alcohol habilitado. */
export function evaluarNegocio(negocio) {
  if (!negocio) return bloqueo('NEGOCIO_INEXISTENTE', 'no se pudo leer el comercio');
  if (negocio.is_active !== true) return bloqueo('NEGOCIO_INACTIVO', 'el comercio no está activo');
  if (negocio.ordering_enabled !== true) return bloqueo('PEDIDOS_CERRADOS', 'ordering_enabled es false');
  if (negocio.ordering_verified !== true) return bloqueo('PEDIDOS_NO_VERIFICADOS', 'ordering_verified es false');
  if (negocio.alcohol_sales_enabled !== false) return bloqueo('ALCOHOL_HABILITADO', 'alcohol_sales_enabled dejó de ser false: fuera del alcance');
  return permitido;
}

/**
 * El repartidor tiene que existir, estar activo y ser el de producción.
 *
 * El mensaje distingue entre «no aparece» y «aparece pero no habla», porque
 * mandan a hacer cosas distintas: la primera es un cable, la segunda es una
 * pantalla bloqueada o un permiso de depuración esperando que alguien lo
 * acepte. Decir siempre «no aparece en adb» manda a buscar un cable que ya
 * estaba puesto.
 */
const COMO_DESTRABAR = Object.freeze({
  ausente: 'no aparece en adb: revisá el cable y que el teléfono esté con la depuración USB encendida',
  offline: 'aparece OFFLINE: desbloqueá la pantalla y aceptá el permiso de depuración USB (después, `adb reconnect device`)',
  unauthorized: 'aparece SIN AUTORIZAR: aceptá «Permitir depuración USB» en la pantalla del teléfono',
  error: 'adb devolvió un error al consultarlo',
});

export function evaluarRider({ miembroActivo, paquete, dispositivoConectado, estadoAdb } = {}) {
  if (!dispositivoConectado) {
    const detalle = COMO_DESTRABAR[estadoAdb] || COMO_DESTRABAR.ausente;
    return bloqueo('RIDER_SIN_DISPOSITIVO', `el teléfono del repartidor ${detalle}`);
  }
  if (!miembroActivo) return bloqueo('RIDER_INACTIVO', 'no hay un repartidor activo en el comercio');
  if (paquete !== 'com.lataba.rider') return bloqueo('RIDER_PAQUETE', `el paquete tiene que ser com.lataba.rider y es ${paquete}`);
  return permitido;
}

/** La dirección elegida en el checkout tiene que ser la aprobada. */
export function evaluarDireccion(direccionElegida, { env = process.env } = {}) {
  const esperada = direccionPermitida(env).descripcionEsperada;
  if (!esperada) {
    return bloqueo('DIRECCION_SIN_CONFIGURAR', 'no hay dirección de prueba aprobada: configurala con el bootstrap antes de comprar');
  }
  const elegida = String(direccionElegida || '').trim();
  if (!elegida) return bloqueo('DIRECCION_AUSENTE', 'el checkout no muestra ninguna dirección');
  const normalizar = (v) => v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  if (!normalizar(elegida).includes(normalizar(esperada))) {
    return bloqueo('DIRECCION_DISTINTA', 'la dirección del checkout no es la aprobada para la prueba');
  }
  return permitido;
}

/** El medio de pago: efectivo o coordinar. Nunca Mercado Pago. */
export function evaluarPago(metodo) {
  const valor = String(metodo || '').trim().toLowerCase();
  if (!valor) return bloqueo('PAGO_AUSENTE', 'no se pudo determinar el medio de pago');
  if (!PAGOS_PERMITIDOS.includes(valor)) {
    return bloqueo('PAGO_NO_AUTORIZADO', `esta prueba sólo usa ${PAGOS_PERMITIDOS.join(' o ')}, y llegó «${valor}»`);
  }
  return permitido;
}

/*
 * ACÁ VIVÍA `evaluarSesion`, que miraba el archivo de la sesión guardada —si
 * existía, si sus cookies habían vencido— y bloqueaba la corrida. Se fue con el
 * modo autónomo, y por una razón: una sesión ya no se juzga por su archivo sino
 * por lo que la aplicación contesta con ella puesta, y si no sirve no se
 * bloquea nada, se renueva. Eso lo deciden `evaluarPanelAprovisionado` y
 * `evaluarClienteAprovisionado`, en `sesiones.mjs`, con la página abierta
 * delante. Dejar acá la versión vieja habría dado dos autoridades para la misma
 * pregunta.
 */

/*
 * Y ACÁ VIVÍA `evaluarPedidosAbiertos`, que frenaba la prueba entera si el
 * comercio tenía cualquier pedido sin cerrar. Era la respuesta correcta cuando
 * el harness no sabía distinguir un pedido de otro en el teléfono. Ahora sí
 * sabe —todo se busca por código y por uuid, y cada toque revalida qué pedido
 * está en pantalla— y el repartidor puede llevar hasta tres entregas a la vez,
 * así que un viaje ajeno abierto ya no le quita el suyo. Lo que sí se mide es
 * el CUPO, y la decisión final la toma el Panel, que deshabilita al repartidor
 * sin lugar.
 */

/** No puede haber dos corridas a la vez ni una anterior sin cerrar. */
export function evaluarConcurrencia({ lockPrevio }) {
  if (!lockPrevio) return permitido;
  return bloqueo(
    'CORRIDA_ANTERIOR_ABIERTA',
    `hay una corrida sin cerrar (${lockPrevio.runId}, ${lockPrevio.estado}): diagnosticala antes de crear otro pedido`,
  );
}

/** El decremento de stock: exactamente uno, ni más ni menos. */
export function evaluarDecremento({ antes, despues, cantidad = PRODUCTO_AUTORIZADO.cantidad }) {
  const esperado = Number(antes) - cantidad;
  if (Number(despues) === esperado) return permitido;
  return bloqueo('P0_STOCK_DECREMENT_FAILURE', `stock ${antes} → ${despues}, y tenía que quedar en ${esperado}`);
}

/** Junta todas las compuertas y devuelve la primera que bloquea. */
export function primerBloqueo(resultados) {
  return resultados.find((resultado) => resultado && resultado.ok === false) || permitido;
}
