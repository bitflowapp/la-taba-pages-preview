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

/** El comercio tiene que estar realmente abierto y sin alcohol habilitado. */
export function evaluarNegocio(negocio) {
  if (!negocio) return bloqueo('NEGOCIO_INEXISTENTE', 'no se pudo leer el comercio');
  if (negocio.is_active !== true) return bloqueo('NEGOCIO_INACTIVO', 'el comercio no está activo');
  if (negocio.ordering_enabled !== true) return bloqueo('PEDIDOS_CERRADOS', 'ordering_enabled es false');
  if (negocio.ordering_verified !== true) return bloqueo('PEDIDOS_NO_VERIFICADOS', 'ordering_verified es false');
  if (negocio.alcohol_sales_enabled !== false) return bloqueo('ALCOHOL_HABILITADO', 'alcohol_sales_enabled dejó de ser false: fuera del alcance');
  return permitido;
}

/** El repartidor tiene que existir, estar activo y ser el de producción. */
export function evaluarRider({ miembroActivo, paquete, dispositivoConectado } = {}) {
  if (!dispositivoConectado) return bloqueo('RIDER_SIN_DISPOSITIVO', 'el Moto G15 no aparece en adb');
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

/** Las sesiones guardadas tienen que existir y estar vivas. */
export function evaluarSesion({ nombre, existe, vencida, verificada }) {
  if (!existe) return bloqueo('AUTH_SESSION_MISSING', `falta la sesión de ${nombre}: corré el bootstrap`);
  if (vencida) return bloqueo('AUTH_SESSION_EXPIRED', `la sesión de ${nombre} venció: volvé a correr el bootstrap`);
  if (!verificada) return bloqueo('AUTH_SESSION_INVALID', `la sesión de ${nombre} no quedó verificada contra producción`);
  return permitido;
}

/**
 * El repartidor no puede tener otra entrega en curso.
 *
 * No es una precaución teórica: el 2026-08-22 el teléfono tenía LT-0001 abierto
 * en «Yendo al cliente», con el botón «Llegué» en pantalla. Con una entrega
 * ajena cargada, la app muestra ESE pedido y el harness no tendría forma de
 * distinguir sus propios toques de los que avanzarían el pedido de otra
 * persona. Se frena antes, y quien cierre LT-0001 lo hace con su propio gate.
 */
export function evaluarPedidosAbiertos(pedidosAbiertos = []) {
  if (!pedidosAbiertos.length) return permitido;
  const detalle = pedidosAbiertos.map((p) => `${p.public_code} (${p.status})`).join(', ');
  return bloqueo(
    'PEDIDO_ABIERTO_PREVIO',
    `hay ${pedidosAbiertos.length} pedido(s) sin cerrar: ${detalle}. El repartidor ya tiene una entrega en curso y la app muestra ESA: cerralos antes de la prueba, con su propio gate.`,
  );
}

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
