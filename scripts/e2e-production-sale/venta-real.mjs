/*
 * EL RECORRIDO REAL: COMPRAR, PROCESAR, ENTREGAR.
 *
 * Cada paso hace su acción por la MISMA superficie que usaría una persona y
 * después la confirma leyendo la base en sólo lectura. La pantalla dice lo que
 * muestra; la base dice lo que pasó. Cuando no coinciden, gana la base y el
 * paso falla — no se repara nada.
 *
 * TODO SE CORRELACIONA POR IDENTIDAD, NUNCA POR POSICIÓN
 * -----------------------------------------------------
 * Ni «el último pedido», ni «el primer botón», ni «la dirección que dice
 * Mendoza».
 *
 * CADA SUPERFICIE USA SU PROPIA LLAVE, Y HAY QUE USAR LA DE CADA UNA. El Panel
 * identifica sus botones por el CÓDIGO PÚBLICO del pedido
 * (`data-production-business-next="LT-0002"`), porque su modelo de vista llama
 * `order.id` al código y guarda el uuid aparte en `order.backendId`. Buscar el
 * uuid ahí no encuentra nada: pasó el 2026-08-22 y costó un pedido real parado
 * en «recibido». La dirección del checkout sí va por uuid
 * (`data-customer-address-id`), y el teléfono por código público.
 *
 * Esto no es prolijidad: el comercio puede tener otros pedidos vivos —los tenía
 * el día que se escribió esto— y «avanzar el primero» habría movido el pedido
 * de otra persona.
 *
 * Nada de esperas ciegas: cada transición se espera con un sondeo acotado que
 * además mide cuánto tardó, y esos tiempos van al reporte.
 */
import { PRODUCCION } from './contrato.mjs';
import { registrarSecretoDeLaCorrida } from './evidencia.mjs';
import { consultar, lit } from './db-solo-lectura.mjs';
import { evaluarDecremento, evaluarDireccion, evaluarPago } from './guards.mjs';
import { DIRECCION_DE_PRUEBA, NEGOCIO_ID, evaluarDireccionPorIdentidad } from './identidades.mjs';
import { anotarPedidoEnLock } from './lock.mjs';
import * as rider from './rider.mjs';
import {
  contextoCliente as nuevoContextoCliente, contextoPanel as nuevoContextoPanel, guardarEstado,
} from './sesiones.mjs';

const ESPERA = {
  pedidoEnPanel: 120_000, transicion: 90_000, oferta: 120_000, entrega: 120_000, telefono: 180_000,
};
const INTERVALO = 2_000;

/*
 * El orden en que avanza un pedido. Sirve para una sola pregunta, y es la que
 * hace falta al reanudar: ¿este paso ya quedó atrás? Sin esto, retomar un
 * pedido que ya estaba en «listo» se quedaba esperando el botón de «aceptar»,
 * que el Panel —con razón— ya no dibuja.
 */
const ORDEN_DE_ESTADOS = Object.freeze([
  'received', 'submitted', 'accepted', 'preparing', 'ready',
  'assigned', 'picked_up', 'on_the_way', 'arriving', 'arrived', 'delivered',
]);

export function yaPaso(estadoActual, objetivo) {
  const actual = ORDEN_DE_ESTADOS.indexOf(String(estadoActual || ''));
  const meta = ORDEN_DE_ESTADOS.indexOf(String(objetivo || ''));
  return actual !== -1 && meta !== -1 && actual >= meta;
}

export class PasoFallido extends Error {
  constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; }
}

/** Sondeo acotado: pregunta cada dos segundos hasta que se cumpla o venza. */
export async function esperarHasta(descripcion, condicion, limite) {
  const desde = Date.now();
  let ultimo = null;
  while (Date.now() - desde < limite) {
    ultimo = await condicion();
    if (ultimo) return { ok: true, ms: Date.now() - desde, valor: ultimo };
    await new Promise((resolver) => { setTimeout(resolver, INTERVALO); });
  }
  return { ok: false, ms: Date.now() - desde, valor: ultimo, descripcion };
}

const leerPedido = async (codigo) => {
  const filas = await consultar(`select public_code, status, total::text as total, id::text as id,
      assigned_rider_user_id is not null as tiene_rider, payment_method,
      delivery_location_confirmed_at is not null as punto_confirmado
    from public.orders where public_code = ${lit(codigo)}`);
  return filas[0] || null;
};

/*
 * EN QUÉ ESTADO ESTÁ LA OFERTA, Y SI TODAVÍA SIRVE.
 *
 * Que una oferta figure «pendiente» no alcanza para darla por buena. Cada oferta
 * guarda la revisión del pedido que esperaba (`expected_order_revision`), y el
 * servidor rechaza aceptarla si el pedido cambió desde entonces. En el teléfono
 * eso se ve como «La solicitud cambió. Actualizamos la lista.» y el botón de
 * aceptar no hace nada, para siempre.
 *
 * QUÉ LA VUELVE OBSOLETA, MEDIDO EL 2026-08-22: que el CLIENTE abra su pantalla
 * de seguimiento. Eso rota su token de acceso, deja un `tracking_access_recovered`
 * y sube la revisión del pedido —de 7 a 8, en LT-0002— tres minutos después de
 * haberse ofrecido. O sea que un cliente mirando dónde viene su pedido invalida
 * la oferta que el repartidor tiene en pantalla. Es un hallazgo del producto y
 * está anotado como tal; acá se lo detecta y se lo resuelve por la vía normal:
 * retirar la oferta vencida y volver a ofrecer.
 */
const estadoDeLaOferta = async (pedidoId) => {
  const [pedido] = await consultar(`select revision, assigned_rider_user_id is not null as tiene_rider
    from public.orders where id = ${lit(pedidoId)}`);
  if (pedido?.tiene_rider) return { tieneRider: true, hayOferta: false, vigente: false };
  const [oferta] = await consultar(`select id::text as id, status, expected_order_revision
    from public.rider_order_offers where order_id = ${lit(pedidoId)} order by offered_at desc limit 1`);
  if (!oferta || oferta.status !== 'pending') {
    return { tieneRider: false, hayOferta: false, vigente: false, ultimoEstado: oferta?.status || null };
  }
  const vigente = Number(oferta.expected_order_revision) === Number(pedido.revision);
  return {
    tieneRider: false,
    hayOferta: true,
    vigente,
    ofertaId: oferta.id,
    revisionEsperada: Number(oferta.expected_order_revision),
    revisionActual: Number(pedido.revision),
  };
};

const leerStock = async (externalId) => {
  const filas = await consultar(`select stock from public.products
    where business_id = ${lit(NEGOCIO_ID)} and external_id = ${lit(externalId)}`);
  return filas[0] ? Number(filas[0].stock) : null;
};

/**
 * El recorrido completo. Recibe las dos sesiones ya abiertas: quién es cada uno
 * y cómo se autenticó es problema de `sesiones.mjs`, no de acá.
 */
export async function ejecutarVentaReal({
  runId, evidencia, anotarPaso, tiempos, host = PRODUCCION.host, producto,
  navegador, contextoCliente, contextoPanel, cliente, panel,
  direccionId, stockAntes, riderUserId, rutaSesionCliente, rutaSesionPanel,
  reanudarCodigo = null,
}) {
  let codigo = null;
  let pedidoId = null;
  let pinLeido = false;

  try {
    /*
     * REANUDAR ES SALTEAR LA COMPRA, NO REPETIRLA.
     *
     * Si la corrida anterior ya creó el pedido y se cayó después, volver a
     * comprar dejaría DOS ventas reales donde el dueño autorizó una. Se toma el
     * pedido que ya existe y se sigue desde el Panel.
     */
    if (reanudarCodigo) {
      const existente = await leerPedido(reanudarCodigo);
      if (!existente) throw new PasoFallido('PEDIDO_A_REANUDAR_INEXISTENTE', `${reanudarCodigo} no existe`);
      codigo = existente.public_code;
      pedidoId = existente.id;
      anotarPedidoEnLock({ runId, pedido: codigo });
      evidencia.guardarJson('pedido.json', {
        runId, codigo, id: pedidoId, total: existente.total, metodo: existente.payment_method,
        reanudado: true, estadoAlReanudar: existente.status, reanudadoUtc: new Date().toISOString(),
      });
      for (const nombre of ['Customer cart', 'Checkout']) {
        anotarPaso(nombre, 'SKIP', `reanudación de ${codigo}: la compra ya había ocurrido`);
      }
      anotarPaso('Order created', 'PASS', `${codigo} · $${existente.total} · reanudado desde «${existente.status}»`);
    } else {
    // ── 1 · el cliente arma el carrito ───────────────────────────────────────
    await cliente.goto(`${host}/#catalog`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await cliente.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 60_000 });
    await cliente.waitForSelector('[data-product-grid] .product-card', { timeout: 45_000 });
    const tarjeta = cliente.locator('[data-product-grid] .product-card')
      .filter({ hasText: producto.nombreVisible }).first();
    if (await tarjeta.count() === 0) {
      throw new PasoFallido('PRODUCTO_NO_VISIBLE', `la góndola no muestra ${producto.nombreVisible}`);
    }
    await tarjeta.scrollIntoViewIfNeeded();
    const textoTarjeta = await tarjeta.innerText();
    if (!textoTarjeta.includes(producto.presentacionVisible)) {
      throw new PasoFallido('PRESENTACION_DISTINTA', `la tarjeta no dice ${producto.presentacionVisible}`);
    }
    evidencia.guardarTexto('01-producto.txt', textoTarjeta);
    await tarjeta.screenshot({ path: evidencia.ruta('01-producto.png') });
    await tarjeta.locator('[data-add-product]').first().click();
    await cliente.waitForTimeout(1500);
    anotarPaso('Customer cart', 'PASS', `1 × ${producto.nombreVisible}`);

    // ── 2 · carrito ──────────────────────────────────────────────────────────
    await cliente.evaluate(() => { window.location.hash = '#cart'; });
    await cliente.waitForTimeout(3500);
    await cliente.screenshot({ path: evidencia.ruta('02-carrito.png'), fullPage: true });

    const lineas = await cliente.locator('[data-cart-list] .cart-item').count();
    if (lineas !== 1) throw new PasoFallido('CARRITO_INESPERADO', `el carrito tiene ${lineas} líneas y tenía que tener 1`);
    const cantidadEnCarrito = await cliente.locator('[data-cart-list] .cart-item .quantity-control strong').first().innerText();
    if (cantidadEnCarrito.trim() !== String(producto.cantidad)) {
      throw new PasoFallido('CANTIDAD_INESPERADA', `el carrito dice ${cantidadEnCarrito} y tenía que decir ${producto.cantidad}`);
    }

    // ── 3 · la dirección, elegida POR IDENTIDAD ──────────────────────────────
    const eleccion = await elegirDireccionAprobada(cliente, direccionId);
    const compuertaDireccion = evaluarDireccionPorIdentidad({
      idElegido: eleccion.idElegido, idAprobado: direccionId, ubicacionConfirmada: eleccion.confirmada,
    });
    if (!compuertaDireccion.ok) throw new PasoFallido(compuertaDireccion.codigo, compuertaDireccion.mensaje);
    /*
     * Segunda lectura, por texto. El uuid ya decidió; esto sirve para el caso
     * raro en que la dirección aprobada se haya editado y ahora apunte a otra
     * puerta. Si alguien fijó la variable heredada, manda esa.
     */
    if (process.env.TABA2_E2E_DIRECCION_TEXTO) {
      const porTexto = evaluarDireccion(eleccion.texto);
      if (!porTexto.ok) throw new PasoFallido(porTexto.codigo, porTexto.mensaje);
    } else if (!eleccion.texto.toLowerCase().includes(DIRECCION_DE_PRUEBA.calle.toLowerCase())) {
      throw new PasoFallido(
        'DIRECCION_TEXTO_DISTINTO',
        `la dirección aprobada ya no dice «${DIRECCION_DE_PRUEBA.calle}»: dice «${eleccion.texto.slice(0, 120)}»`,
      );
    }

    // ── 4 · el medio de pago ─────────────────────────────────────────────────
    const metodo = await elegirPago(cliente);
    const compuertaPago = evaluarPago(metodo);
    if (!compuertaPago.ok) throw new PasoFallido(compuertaPago.codigo, compuertaPago.mensaje);
    await cliente.screenshot({ path: evidencia.ruta('03-checkout.png'), fullPage: true });
    anotarPaso('Checkout', 'PASS', `pago ${metodo} · dirección ${String(direccionId).slice(0, 8)}…`);

    const total = await cliente.locator('[data-order-summary] .summary-row.total strong').first()
      .innerText().catch(() => '(no leído)');
    evidencia.anotar(`pedido a punto de crearse: ${producto.nombreVisible} ${producto.presentacionVisible} × ${producto.cantidad} · total ${total} · pago ${metodo}`);

    const pedidosAntes = new Set((await consultar('select public_code from public.orders')).map((f) => f.public_code));

    // ── 5 · confirmar ────────────────────────────────────────────────────────
    /*
     * OJO CON ESTE BOTÓN. `[data-checkout-submit]` NUNCA está deshabilitado: se
     * midió sin perfil, sin dirección y hasta con el carrito vacío, y siempre
     * responde. Su handler llama derecho a `createOrder()`, que es una escritura
     * real contra producción. Por eso la compuerta NO se le pregunta al botón:
     * se pregunta por la ausencia de `[data-profile-block]`, que es lo que el
     * checkout dibuja cuando falta el perfil o la dirección.
     */
    const bloques = await cliente.locator('[data-profile-block]').count();
    if (bloques > 0) {
      const motivo = await cliente.locator('[data-profile-block]').first().getAttribute('data-profile-block');
      throw new PasoFallido('CHECKOUT_BLOQUEADO', `el checkout está bloqueado por «${motivo}»`);
    }
    const confirmar = cliente.locator('[data-checkout-submit]').first();
    if (await confirmar.count() === 0) throw new PasoFallido('SIN_BOTON_CONFIRMAR', 'no aparece el botón de confirmar');
    await confirmar.click();

    const aparecio = await esperarHasta('pedido nuevo en la base', async () => {
      const filas = await consultar('select public_code, status, created_at::text as created_at from public.orders order by created_at desc limit 5');
      return filas.find((fila) => !pedidosAntes.has(fila.public_code)) || null;
    }, ESPERA.pedidoEnPanel);
    if (!aparecio.ok) throw new PasoFallido('PEDIDO_NO_CREADO', 'el pedido no apareció después de confirmar');
    codigo = aparecio.valor.public_code;
    tiempos['confirmar → pedido creado'] = aparecio.ms;
    anotarPedidoEnLock({ runId, pedido: codigo });

    const pedido = await leerPedido(codigo);
    pedidoId = pedido?.id || null;
    if (!pedidoId) throw new PasoFallido('PEDIDO_SIN_ID', `no se pudo leer el uuid de ${codigo}`);
    if (pedido.punto_confirmado !== true) {
      throw new PasoFallido('PEDIDO_SIN_PUNTO', `${codigo} se creó sin punto de entrega confirmado`);
    }
    await cliente.screenshot({ path: evidencia.ruta('04-pedido-creado.png'), fullPage: true });
    evidencia.guardarJson('pedido.json', {
      runId, codigo, id: pedidoId, total: pedido.total, metodo: pedido.payment_method, creadoUtc: new Date().toISOString(),
    });
    anotarPaso('Order created', 'PASS', `${codigo} · $${pedido.total}`);
    }

    // ── 6 · el Panel lo recibe ───────────────────────────────────────────────
    await panel.goto(`${host}/#business`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await panel.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 60_000 });
    await irAPedidos(panel);
    const enPanel = await esperarHasta('el pedido en el Panel', async () => (
      await panel.locator(`[data-production-business-next="${codigo}"], [data-production-business-cancel="${codigo}"]`).count() > 0
    ), ESPERA.pedidoEnPanel);
    if (!enPanel.ok) throw new PasoFallido('PEDIDO_NO_LLEGA_AL_PANEL', `el Panel no muestra ${codigo}`);
    tiempos['pedido creado → visible en el Panel'] = enPanel.ms;
    await panel.screenshot({ path: evidencia.ruta('05-panel-nuevo.png'), fullPage: true });
    anotarPaso('Business intake', 'PASS', `${codigo} visible en ${enPanel.ms} ms`);

    // ── 7 · aceptar, preparar, listo ─────────────────────────────────────────
    for (const [estado, nombrePaso] of [['accepted', 'Accepted'], ['preparing', 'Preparing'], ['ready', 'Ready']]) {
      const desde = Date.now();
      await avanzarEnElPanel(panel, { codigo, hasta: estado });
      tiempos[nombrePaso] = Date.now() - desde;
      anotarPaso(nombrePaso, 'PASS', estado);
    }
    await panel.screenshot({ path: evidencia.ruta('06-panel-listo.png'), fullPage: true });

    // ── 8 · se le ofrece al repartidor ───────────────────────────────────────
    const desdeOferta = Date.now();
    /*
     * Al reanudar, el pedido puede venir YA ofrecido: la corrida anterior llegó
     * hasta acá. Volver a ofrecerlo no sólo es innecesario —el Panel deja de
     * dibujar el bloque de asignación mientras hay una oferta viva, así que
     * fallaría—: sería mandarle una segunda notificación al repartidor por el
     * mismo viaje.
     */
    const oferta = await estadoDeLaOferta(pedidoId);
    if (oferta.tieneRider) {
      anotarPaso('Rider offered', 'PASS', 'el pedido ya tiene repartidor asignado');
    } else if (oferta.hayOferta && oferta.vigente) {
      anotarPaso('Rider offered', 'PASS', 'ya estaba ofrecido y la oferta sigue vigente: no se ofrece de nuevo');
    } else {
      if (oferta.hayOferta && !oferta.vigente) {
        /*
         * La oferta quedó atada a una revisión vieja: el teléfono no la puede
         * aceptar aunque la muestre. Se retira por el Panel y se ofrece de nuevo.
         */
        evidencia.anotar(`la oferta esperaba la revisión ${oferta.revisionEsperada} y el pedido va por la ${oferta.revisionActual}: se retira y se vuelve a ofrecer`);
        await retirarOferta(panel, { ofertaId: oferta.ofertaId });
      }
      await ofrecerAlRepartidor(panel, { codigo, riderUserId });
    const ofrecido = await esperarHasta('oferta registrada', async () => {
      const filas = await consultar(`select assigned_rider_user_id::text as rider, status
        from public.orders where id = ${lit(pedidoId)}`);
      if (filas[0]?.rider) return filas[0];
      const ofertas = await consultar(`select status from public.rider_order_offers
        where order_id = ${lit(pedidoId)} order by offered_at desc limit 1`);
      return ofertas[0] || null;
    }, ESPERA.oferta);
      if (!ofrecido.ok) throw new PasoFallido('OFERTA_NO_REGISTRADA', 'no se registró la oferta al repartidor');
      tiempos['listo → oferta al repartidor'] = Date.now() - desdeOferta;
      anotarPaso('Rider offered', 'PASS');
    }

    // ── 9 · el teléfono ──────────────────────────────────────────────────────
    rider.despertarPantalla();
    rider.traerAlFrente();
    /*
     * La aplicación abre ofreciendo activar huella o rostro, y hasta que alguien
     * responde esa hoja tapa la pantalla entera: sin esto el harness se queda
     * esperando una oferta que no puede ver. Sólo se toca «ahora no»; aceptar
     * está en la lista negra.
     */
    const declinadas = rider.despejarInvitaciones();
    if (declinadas.length) evidencia.anotar(`teléfono: se declinaron ${declinadas.length} invitación(es) de la aplicación`);
    rider.capturarPantalla(evidencia.ruta('07-rider-oferta.png'));

    const aceptado = await esperarHasta('el repartidor toma el pedido', async () => {
      const fila = await leerPedido(codigo);
      if (fila?.tiene_rider) return fila;
      const estado = rider.estadoRider();
      if (estado.pedido === codigo) return estado;
      /*
       * Si la oferta salió RECHAZADA, no se reintenta: el pedido queda en
       * «listo» —intacto, para volver a ofrecerlo— y esto se reporta como falla.
       * Reintentar sobre una oferta rechazada sería insistir sobre una decisión
       * que el sistema ya tomó.
       */
      const [oferta] = await consultar(`select ro.status from public.rider_order_offers ro
        where ro.order_id = ${lit(pedidoId)} order by ro.offered_at desc limit 1`);
      if (oferta && ['rejected', 'declined', 'withdrawn', 'expired'].includes(oferta.status)) {
        throw new PasoFallido('OFERTA_RECHAZADA', `la oferta de ${codigo} quedó en «${oferta.status}»: el pedido sigue listo para volver a ofrecerse`);
      }
      rider.aceptarOfertaDe(codigo);
      rider.seleccionarPedido(codigo, { tolerante: true });
      return null;
    }, ESPERA.telefono);
    if (!aceptado.ok) throw new PasoFallido('RIDER_NO_ACEPTA', `el teléfono no tomó ${codigo}`);
    tiempos['oferta → aceptada en el teléfono'] = aceptado.ms;
    rider.capturarPantalla(evidencia.ruta('08-rider-aceptado.png'));
    anotarPaso('Rider accepted', 'PASS');

    // ── 10 · retiro y camino ─────────────────────────────────────────────────
    const retirado = await avanzarEnElTelefono({
      codigo,
      etiquetas: ['Confirmar retiro', 'Registrar retiro', 'Retiré el pedido', 'Retirar pedido'],
      estados: ['picked_up', 'on_the_way'],
    });
    tiempos['aceptado → retirado'] = retirado.ms;
    anotarPaso('Picked up', 'PASS', retirado.estado);

    if (retirado.estado === 'picked_up') {
      const enCamino = await avanzarEnElTelefono({
        codigo, etiquetas: ['Salir en camino', 'En camino', 'Iniciar viaje'], estados: ['on_the_way'],
      });
      tiempos['retirado → en camino'] = enCamino.ms;
      anotarPaso('On the way', 'PASS', enCamino.estado);
    } else {
      anotarPaso('On the way', 'PASS', 'el retiro ya dejó el pedido en camino');
    }

    // ── 11 · el cliente ve el seguimiento ────────────────────────────────────
    /*
     * Lo que el cliente ve NO es el estado crudo: los mapeadores colapsan
     * `accepted` en «preparando», y `assigned`/`picked_up` en «en camino». Esos
     * tres estados son indistinguibles desde esta superficie, así que la
     * evidencia fina sale del Panel y de la base; acá se comprueba lo que una
     * persona vería de verdad.
     */
    await cliente.evaluate(() => { window.location.hash = '#tracking'; });
    const seguimiento = await esperarHasta('seguimiento del cliente', async () => {
      const estado = await cliente.locator('[data-tracking-status]').first()
        .getAttribute('data-tracking-status').catch(() => null);
      return estado ? { estado } : null;
    }, ESPERA.transicion);
    if (!seguimiento.ok) throw new PasoFallido('SIN_TRACKING', 'el cliente no ve el seguimiento del pedido');
    await cliente.screenshot({ path: evidencia.ruta('09-cliente-seguimiento.png'), fullPage: true });
    anotarPaso('Tracking', 'PASS', `el cliente ve «${seguimiento.valor.estado}»`);

    // ── 12 · el repartidor avisa que llegó ───────────────────────────────────
    /*
     * El orden importa y no es el intuitivo: la tarjeta del código de entrega
     * SÓLO se dibuja cuando el pedido está en llegada, y desaparece al
     * confirmarse la entrega. O sea que el cliente ve el PIN recién después de
     * que el repartidor marca que llegó. Leerlo antes es esperar algo que la
     * tienda todavía no muestra.
     */
    const llego = await avanzarEnElTelefono({
      codigo, etiquetas: ['Llegué', 'Marcar llegada', 'Llegué al domicilio'], estados: ['arrived', 'arriving'],
    });
    tiempos['en camino → llegada'] = llego.ms;
    anotarPaso('Arrived', 'PASS', llego.estado);

    // ── 13 · el PIN, leído de la pantalla del cliente ────────────────────────
    await cliente.reload({ waitUntil: 'domcontentloaded' });
    await cliente.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 60_000 });
    await cliente.evaluate(() => { window.location.hash = '#tracking'; });
    const conPin = await esperarHasta('código de entrega en pantalla', async () => {
      const nodo = cliente.locator('[data-delivery-code-card] strong[data-delivery-code]').first();
      if (await nodo.count() === 0) return null;
      const valor = await nodo.getAttribute('data-delivery-code');
      return /^\d{4}$/.test(String(valor || '')) ? valor : null;
    }, ESPERA.entrega);
    if (!conPin.ok) throw new PasoFallido('SIN_PIN', 'el cliente no ve el código de entrega');
    const pin = conPin.valor;
    pinLeido = true;
    /*
     * Antes de hacer nada con él: el valor exacto queda registrado como secreto
     * de la corrida, así que desde este instante desaparece de cualquier texto
     * que vaya a disco —el registro, el informe, la línea de tiempo— aparezca
     * donde aparezca. El patrón de cuatro dígitos es la red; esto es la certeza.
     */
    registrarSecretoDeLaCorrida(pin);
    // La captura se toma con el número ya tapado en el DOM: la imagen que queda
    // en disco nunca contuvo el código.
    await cliente.locator('[data-delivery-code-card] strong[data-delivery-code]').first()
      .evaluate((nodo) => { nodo.textContent = '• • • •'; nodo.setAttribute('data-delivery-code', '****'); });
    await cliente.screenshot({ path: evidencia.ruta('10-pin-tapado.png'), fullPage: true });
    anotarPaso('PIN', 'PASS', 'leído de la pantalla del cliente, nunca de la base');

    // ── 14 · entrega ─────────────────────────────────────────────────────────
    rider.seleccionarPedido(codigo, { tolerante: true });
    rider.escribirPin(pin, { codigoEsperado: codigo });
    const desdePin = Date.now();
    rider.tocar('Confirmar entrega', { codigoEsperado: codigo });
    const entregado = await esperarHasta('entregado', async () => {
      const actual = await leerPedido(codigo);
      return actual?.status === 'delivered' ? actual : null;
    }, ESPERA.entrega);
    if (!entregado.ok) throw new PasoFallido('SIN_ENTREGA', 'el pedido no llegó a entregado');
    tiempos['PIN → entregado'] = Date.now() - desdePin;
    rider.capturarPantalla(evidencia.ruta('11-rider-entregado.png'));
    await cliente.reload({ waitUntil: 'domcontentloaded' });
    await cliente.waitForTimeout(4000);
    await cliente.screenshot({ path: evidencia.ruta('12-cliente-entregado.png'), fullPage: true });
    anotarPaso('Delivered', 'PASS');

    // ── 15 · el stock, exacto ────────────────────────────────────────────────
    const stockDespues = await leerStock(producto.externalId);
    const decremento = evaluarDecremento({ antes: stockAntes, despues: stockDespues });
    if (!decremento.ok) {
      anotarPaso('Stock N-1', 'FAIL', decremento.mensaje);
      throw new PasoFallido(decremento.codigo, decremento.mensaje);
    }
    anotarPaso('Stock N-1', 'PASS', `${stockAntes} → ${stockDespues}`);

    // ── 16 · persistencia: cerrar todo y volver a abrir ──────────────────────
    const persistencia = await comprobarPersistencia({
      navegador, contextoCliente, contextoPanel, rutaSesionCliente, rutaSesionPanel,
      host, codigo, pedidoId, producto, stockDespues, evidencia,
    });
    anotarPaso('Persistence', persistencia.ok ? 'PASS' : 'FAIL', persistencia.detalle);
    if (!persistencia.ok) throw new PasoFallido('PERSISTENCIA', persistencia.detalle);

    return { ok: true, codigo, pedidoId, stockAntes, stockDespues, pinLeido };
  } catch (error) {
    const codigoFalla = error instanceof PasoFallido ? error.codigo : 'EXCEPCION';
    anotarPaso('Resultado', 'FAIL', `${codigoFalla}: ${String(error.message).slice(0, 200)}`);
    return {
      ok: false, codigo: codigoFalla, pedido: codigo, pedidoId, mensaje: String(error.message).slice(0, 400), pinLeido,
    };
  }
}

// ── Piezas del recorrido ─────────────────────────────────────────────────────

/** Elige la dirección aprobada por su uuid y devuelve lo que quedó elegido. */
async function elegirDireccionAprobada(cliente, direccionId) {
  const tarjeta = cliente.locator(`[data-customer-address-id="${direccionId}"]`).first();
  if (await tarjeta.count() === 0) {
    throw new PasoFallido('DIRECCION_NO_OFRECIDA', 'el checkout no ofrece la dirección aprobada para la prueba');
  }
  const radio = tarjeta.locator('[data-customer-address-action="select"]').first();
  if (await radio.count() && !(await radio.isChecked().catch(() => false))) {
    await radio.check({ force: true }).catch(async () => { await tarjeta.click(); });
    await cliente.waitForTimeout(2000);
  }
  const definitiva = cliente.locator(`[data-customer-address-id="${direccionId}"]`).first();
  const clases = await definitiva.getAttribute('class') || '';
  const marcada = clases.includes('is-selected')
    || await definitiva.locator('[data-customer-address-action="select"]').first().isChecked().catch(() => false);
  return {
    idElegido: marcada ? direccionId : '',
    confirmada: (await definitiva.getAttribute('data-address-location')) === 'confirmed',
    texto: (await definitiva.innerText().catch(() => '')).replace(/\s+/g, ' ').trim(),
  };
}

/** Fija el medio de pago y devuelve el que quedó. Mercado Pago queda afuera. */
async function elegirPago(cliente) {
  const selector = cliente.locator('select[name="paymentMethod"]').first();
  if (await selector.count() === 0) return '';
  const opciones = await selector.locator('option').evaluateAll((nodos) => nodos.map((n) => n.value));
  const elegida = ['cash', 'coordinate'].find((valor) => opciones.includes(valor));
  if (elegida) {
    await selector.selectOption(elegida);
    await cliente.waitForTimeout(1200);
  }
  return String(await selector.inputValue().catch(() => '')).trim().toLowerCase();
}

async function irAPedidos(panel) {
  const boton = panel.locator('[data-production-orders-view]').first();
  if (await boton.count() === 0) {
    const mas = panel.locator('[data-panel-more-toggle]').first();
    if (await mas.count()) { await mas.click(); await panel.waitForTimeout(600); }
  }
  const definitivo = panel.locator('[data-production-orders-view]').first();
  if (await definitivo.count()) { await definitivo.click(); await panel.waitForTimeout(1500); }
}

/**
 * Avanza el pedido de ESTA corrida hasta el estado pedido.
 *
 * El botón se busca por el CÓDIGO PÚBLICO del pedido —que es lo que el Panel
 * escribe en el atributo—, y su `data-next-status` dice a dónde lleva. Se aprieta y se espera a que la BASE lo confirme; la pantalla no
 * alcanza como prueba.
 */
async function avanzarEnElPanel(panel, { codigo, hasta }) {
  const limite = Date.now() + ESPERA.transicion * 2;
  while (Date.now() < limite) {
    const actual = await leerPedido(codigo);
    if (yaPaso(actual?.status, hasta)) return actual;
    if (['cancelled', 'canceled', 'rejected'].includes(actual?.status)) {
      throw new PasoFallido('PEDIDO_CANCELADO', `${codigo} quedó en ${actual.status} camino a ${hasta}`);
    }
    await irAPedidos(panel);
    const boton = panel.locator(`[data-production-business-next="${codigo}"]`).first();
    if (await boton.count() > 0 && await boton.isEnabled().catch(() => false)) {
      await boton.click();
      await panel.waitForTimeout(2500);
    } else {
      await panel.waitForTimeout(INTERVALO);
    }
  }
  const ultimo = await leerPedido(codigo);
  throw new PasoFallido('TRANSICION_FALLIDA', `${codigo} no llegó a ${hasta}: quedó en ${ultimo?.status}`);
}

/** Retira una oferta vencida, por el mismo botón que usaría el comercio. */
async function retirarOferta(panel, { ofertaId }) {
  await irAPedidos(panel);
  const boton = panel.locator(`[data-production-offer-withdraw="${ofertaId}"]`).first();
  const limite = Date.now() + ESPERA.transicion;
  while (Date.now() < limite && await boton.count() === 0) {
    await panel.waitForTimeout(INTERVALO);
    await irAPedidos(panel);
  }
  if (await boton.count() === 0) {
    throw new PasoFallido('SIN_RETIRAR_OFERTA', 'el Panel no ofrece retirar la oferta vencida');
  }
  await boton.click();
  await panel.waitForTimeout(3000);
}

/** Ofrece el pedido al repartidor de producción, elegido por su user_id. */
async function ofrecerAlRepartidor(panel, { codigo, riderUserId }) {
  await irAPedidos(panel);
  const tarjeta = panel.locator('.production-order-card')
    .filter({ has: panel.locator(`[data-production-business-assign="${codigo}"]`) }).first();
  const limite = Date.now() + ESPERA.oferta;
  while (Date.now() < limite && await tarjeta.count() === 0) {
    await panel.waitForTimeout(INTERVALO);
    await irAPedidos(panel);
  }
  if (await tarjeta.count() === 0) {
    throw new PasoFallido('SIN_OFERTA', 'el Panel no ofrece asignar repartidor para este pedido');
  }
  const selector = tarjeta.locator('[data-production-rider-select]').first();
  if (await selector.count() === 0) {
    throw new PasoFallido('SIN_RIDER_DISPONIBLE', 'el Panel no lista ningún repartidor activo con cupo');
  }
  if (riderUserId) {
    const opciones = await selector.locator('option')
      .evaluateAll((nodos) => nodos.map((n) => ({ valor: n.value, deshabilitada: n.disabled })));
    const elegido = opciones.find((o) => o.valor === riderUserId);
    if (!elegido) throw new PasoFallido('RIDER_NO_LISTADO', 'el repartidor de producción no aparece entre los asignables');
    if (elegido.deshabilitada) throw new PasoFallido('RIDER_SIN_CUPO', 'el repartidor de producción está sin cupo');
    await selector.selectOption(riderUserId);
  }
  await tarjeta.locator(`[data-production-business-assign="${codigo}"]`).first().click();
  await panel.waitForTimeout(2500);
}

/**
 * Toca en el teléfono la primera etiqueta que exista y espera el estado.
 *
 * Se prueban varias etiquetas porque el texto del botón depende del estado y de
 * la versión instalada; lo que NO varía es el estado que tiene que quedar en la
 * base, y eso es lo que se exige.
 */
async function avanzarEnElTelefono({ codigo, etiquetas, estados }) {
  const desde = Date.now();
  const limite = desde + ESPERA.telefono;
  let ultimoError = '';
  while (Date.now() < limite) {
    const actual = await leerPedido(codigo);
    if (estados.includes(actual?.status)) return { ms: Date.now() - desde, estado: actual.status };
    rider.seleccionarPedido(codigo, { tolerante: true });
    const disponibles = rider.estadoRider().acciones;
    const etiqueta = etiquetas.find((texto) => disponibles.includes(texto));
    if (etiqueta) {
      try {
        rider.tocar(etiqueta, { codigoEsperado: codigo });
      } catch (error) {
        ultimoError = String(error.message).slice(0, 160);
      }
    }
    await new Promise((resolver) => { setTimeout(resolver, INTERVALO); });
  }
  const ultimo = await leerPedido(codigo);
  throw new PasoFallido(
    'RIDER_NO_AVANZA',
    `${codigo} no llegó a ${estados.join('/')}: quedó en ${ultimo?.status}`
    + `${ultimoError ? ` · último intento: ${ultimoError}` : ''}`,
  );
}

/**
 * Cierra las tres superficies y las vuelve a abrir.
 *
 * Es la única forma de distinguir «la pantalla lo dice» de «quedó guardado». Se
 * cierran los dos navegadores y se relanza la aplicación del repartidor. Recién
 * ACÁ se puede cerrar el proceso del teléfono: el pedido ya está entregado, así
 * que no hay ningún viaje publicando GPS al que cortarle la pierna.
 */
async function comprobarPersistencia({
  navegador, contextoCliente, contextoPanel, rutaSesionCliente, rutaSesionPanel,
  host, codigo, pedidoId, producto, stockDespues, evidencia,
}) {
  /*
   * Guardar ANTES de cerrar, y otra vez al final.
   *
   * El proyecto tiene rotación de refresh tokens con detección de reuso: cada
   * vez que un navegador refresca, el token anterior queda quemado. Si esta
   * comprobación cerrara los contextos sin guardar, los archivos de sesión
   * quedarían con tokens ya usados y la corrida SIGUIENTE los encontraría
   * revocados. Para el Panel eso sólo significa volver a entrar; para el
   * cliente significa perder la identidad anónima —con su perfil y su
   * dirección— y fabricar otra, dejando una fila más en producción cada vez.
   */
  await guardarEstado(contextoCliente, rutaSesionCliente).catch(() => {});
  await guardarEstado(contextoPanel, rutaSesionPanel).catch(() => {});
  await contextoCliente.close().catch(() => {});
  await contextoPanel.close().catch(() => {});

  const otroCliente = await nuevoContextoCliente(navegador, { estado: rutaSesionCliente });
  const otroPanel = await nuevoContextoPanel(navegador, { estado: rutaSesionPanel });

  const cliente = await otroCliente.newPage();
  await cliente.goto(`${host}/#tracking`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await cliente.waitForTimeout(6000);
  const textoCliente = await cliente.locator('body').innerText().catch(() => '');
  await cliente.screenshot({ path: evidencia.ruta('13-cliente-reabierto.png'), fullPage: true });

  const panel = await otroPanel.newPage();
  await panel.goto(`${host}/#business`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await panel.waitForTimeout(6000);
  const textoPanel = await panel.locator('body').innerText().catch(() => '');
  await panel.screenshot({ path: evidencia.ruta('14-panel-reabierto.png'), fullPage: true });

  const pedidoFinal = await leerPedido(codigo);
  const stockFinal = await leerStock(producto.externalId);

  let riderLibre = false;
  try {
    rider.reiniciarAplicacion();
    riderLibre = rider.estadoRider().pedido !== codigo;
  } catch (error) {
    evidencia.anotar(`no se pudo comprobar el teléfono tras reabrir: ${String(error.message).slice(0, 160)}`);
  }

  // El último token es el que tiene que quedar en el archivo, no el primero.
  await guardarEstado(otroCliente, rutaSesionCliente).catch(() => {});
  await guardarEstado(otroPanel, rutaSesionPanel).catch(() => {});
  await otroCliente.close().catch(() => {});
  await otroPanel.close().catch(() => {});

  const clienteEntregado = /entregad/i.test(textoCliente);
  const panelEntregado = /entregad/i.test(textoPanel) || pedidoFinal?.status === 'delivered';
  const ok = clienteEntregado && panelEntregado && pedidoFinal?.status === 'delivered'
    && stockFinal === stockDespues && riderLibre;
  return {
    ok,
    detalle: `cliente=${clienteEntregado ? 'entregado' : 'NO'} · panel=${panelEntregado ? 'entregado' : 'NO'}`
      + ` · base=${pedidoFinal?.status} · stock=${stockFinal} · repartidor sin el pedido=${riderLibre}`
      + ` · pedido ${String(pedidoId).slice(0, 8)}…`,
  };
}
