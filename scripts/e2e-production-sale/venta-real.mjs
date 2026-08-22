/*
 * El recorrido real: comprar, procesar, entregar.
 *
 * Cada paso hace su acción por la MISMA superficie que usaría una persona y
 * después la confirma leyendo la base en sólo lectura. La UI dice lo que
 * muestra; la base dice lo que pasó. Cuando no coinciden, gana la base y el
 * paso falla — no se repara nada.
 *
 * Nada de esperas ciegas: cada transición se espera con un sondeo acotado que
 * además mide cuánto tardó, y esos tiempos van al reporte.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { direccionPermitida, PRODUCCION, RUTAS } from './contrato.mjs';
import { consultar, lit } from './db-solo-lectura.mjs';
import { evaluarDecremento, evaluarDireccion, evaluarPago } from './guards.mjs';
import { anotarPedidoEnLock } from './lock.mjs';
import * as rider from './rider.mjs';

const ESPERA = { pedidoEnPanel: 90_000, transicion: 60_000, oferta: 90_000, entrega: 90_000 };
const INTERVALO = 2_000;

class PasoFallido extends Error {
  constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; }
}

/** Sondeo acotado: pregunta cada dos segundos hasta que se cumpla o venza. */
async function esperarHasta(descripcion, condicion, limite) {
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
      assigned_rider_user_id is not null as tiene_rider, payment_method
    from public.orders where public_code = ${lit(codigo)}`);
  return filas[0] || null;
};

const leerStock = async (externalId) => {
  const filas = await consultar(`select stock from public.products
    where business_id = ${lit(PRODUCCION.businessId)} and external_id = ${lit(externalId)}`);
  return filas[0] ? Number(filas[0].stock) : null;
};

export async function ejecutarVentaReal({ runId, evidencia, precheck, anotarPaso, tiempos, host, producto }) {
  const navegador = await chromium.launch();
  const contextoCliente = await navegador.newContext({
    viewport: { width: 430, height: 932 },
    storageState: path.join(process.cwd(), RUTAS.sesionCustomer),
  });
  const contextoPanel = await navegador.newContext({
    viewport: { width: 1280, height: 900 },
    storageState: path.join(process.cwd(), RUTAS.sesionBusiness),
  });
  const cliente = await contextoCliente.newPage();
  const panel = await contextoPanel.newPage();
  let codigo = null;
  let pinLeido = false;

  const cerrar = async () => {
    await contextoCliente.close().catch(() => {});
    await contextoPanel.close().catch(() => {});
    await navegador.close().catch(() => {});
  };

  try {
    // ── 1 · el cliente arma el carrito ───────────────────────────────────────
    await cliente.goto(`${host}/#catalog`, { waitUntil: 'networkidle', timeout: 90_000 });
    await cliente.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 60_000 });
    await cliente.waitForSelector('[data-product-grid] .product-card', { timeout: 30_000 });
    const tarjeta = cliente.locator('[data-product-grid] .product-card')
      .filter({ hasText: producto.nombreVisible }).first();
    if (await tarjeta.count() === 0) throw new PasoFallido('PRODUCTO_NO_VISIBLE', `la góndola no muestra ${producto.nombreVisible}`);
    await tarjeta.scrollIntoViewIfNeeded();
    const textoTarjeta = await tarjeta.innerText();
    if (!textoTarjeta.includes(producto.presentacionVisible)) {
      throw new PasoFallido('PRESENTACION_DISTINTA', `la tarjeta no dice ${producto.presentacionVisible}`);
    }
    await evidencia.guardarTexto('01-product.txt', textoTarjeta);
    await tarjeta.screenshot({ path: evidencia.ruta('01-product.png') });
    await tarjeta.locator('[data-add-product]').first().click();
    await cliente.waitForTimeout(1200);
    anotarPaso('Customer cart', 'PASS', `1 × ${producto.nombreVisible}`);

    // ── 2 · carrito y checkout ───────────────────────────────────────────────
    await cliente.evaluate(() => { window.location.hash = '#cart'; });
    await cliente.waitForTimeout(3000);
    await cliente.screenshot({ path: evidencia.ruta('02-cart.png'), fullPage: true });
    const textoCarrito = await cliente.locator('[data-view="cart"]').innerText();
    const unidades = await cliente.locator('[data-cart-list] .cart-item').count();
    if (unidades !== 1) throw new PasoFallido('CARRITO_INESPERADO', `el carrito tiene ${unidades} líneas y tenía que tener 1`);
    const cantidadEnCarrito = await cliente.locator('[data-cart-list] .cart-item .quantity-control strong').first().innerText();
    if (cantidadEnCarrito.trim() !== String(producto.cantidad)) {
      throw new PasoFallido('CANTIDAD_INESPERADA', `el carrito dice ${cantidadEnCarrito} y tenía que decir ${producto.cantidad}`);
    }

    const direccionMostrada = (textoCarrito.match(/Entregar en\s*\n?([^\n]+)/) || [])[1]
      || (textoCarrito.match(/Dirección[^\n]*\n([^\n]+)/) || [])[1] || '';
    const compuertaDireccion = evaluarDireccion(direccionMostrada);
    if (!compuertaDireccion.ok) throw new PasoFallido(compuertaDireccion.codigo, compuertaDireccion.mensaje);

    // El medio de pago es un <select>, no un grupo de radios.
    const metodo = await cliente.locator('select[name="paymentMethod"]').first().inputValue().catch(() => '');
    const compuertaPago = evaluarPago(metodo);
    if (!compuertaPago.ok) throw new PasoFallido(compuertaPago.codigo, compuertaPago.mensaje);
    await cliente.screenshot({ path: evidencia.ruta('03-checkout-before-create.png'), fullPage: true });
    anotarPaso('Checkout', 'PASS', `pago ${metodo} · dirección verificada`);

    // ── 3 · el último cartel antes de comprar ────────────────────────────────
    const total = await cliente.locator('[data-order-summary] .summary-row.total strong').first()
      .innerText().catch(() => '(no leído)');
    console.log('\n  ── REAL PRODUCTION ORDER ──');
    console.log(`  Producto: ${producto.nombreVisible} ${producto.presentacionVisible}`);
    console.log(`  Cantidad: ${producto.cantidad}`);
    console.log(`  Precio:   $${producto.precioEsperado}`);
    console.log(`  Total:    $${total}`);
    console.log(`  Dirección: ${direccionPermitida().descripcionEsperada}`);
    console.log(`  Pago:     ${metodo}`);
    console.log('  CREATE ORDER? — autorizado por bandera y variable de entorno\n');

    const pedidosAntes = new Set((await consultar('select public_code from public.orders')).map((f) => f.public_code));
    const stockAntes = precheck.stockBefore;

    // ── 4 · confirmar ────────────────────────────────────────────────────────
    /*
     * OJO CON ESTE BOTÓN. `[data-checkout-submit]` NUNCA está deshabilitado:
     * se midió sin perfil, sin dirección y hasta con el carrito vacío, y
     * siempre responde. Su handler llama derecho a `createOrder()`, que es una
     * escritura real contra producción — tocarlo «para ver qué pasa» crea un
     * pedido. Por eso la compuerta NO se pregunta al botón: se pregunta por la
     * ausencia de `[data-profile-block]`, que es lo que el checkout dibuja
     * cuando falta el perfil o la dirección.
     */
    const bloques = await cliente.locator('[data-profile-block]').count();
    if (bloques > 0) {
      const motivo = await cliente.locator('[data-profile-block]').first().getAttribute('data-profile-block');
      throw new PasoFallido('CHECKOUT_BLOQUEADO', `el checkout está bloqueado por «${motivo}»: completá el perfil o la dirección antes de la prueba`);
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
    await cliente.screenshot({ path: evidencia.ruta('04-order-created.png'), fullPage: true });
    const pedido = await leerPedido(codigo);
    evidencia.guardarJson('order.json', { runId, codigo, id: pedido?.id, total: pedido?.total, metodo: pedido?.payment_method, creadoUtc: new Date().toISOString() });
    anotarPaso('Order created', 'PASS', `${codigo} · $${pedido?.total}`);

    // ── 5 · el Panel lo recibe y lo procesa ──────────────────────────────────
    await panel.goto(`${host}/#business`, { waitUntil: 'networkidle', timeout: 90_000 });
    const enPanel = await esperarHasta('el pedido en el Panel', async () => {
      const texto = await panel.locator('body').innerText().catch(() => '');
      return texto.includes(codigo) ? texto : null;
    }, ESPERA.pedidoEnPanel);
    if (!enPanel.ok) throw new PasoFallido('PEDIDO_NO_LLEGA_AL_PANEL', `el Panel no muestra ${codigo}`);
    tiempos['pedido creado → visible en el Panel'] = enPanel.ms;
    await panel.screenshot({ path: evidencia.ruta('05-business-new.png'), fullPage: true });
    anotarPaso('Business intake', 'PASS', `${codigo} visible en ${enPanel.ms} ms`);

    const avanzar = async (etiqueta, estadoEsperado, nombrePaso) => {
      const boton = panel.getByRole('button', { name: etiqueta }).first();
      if (await boton.count() === 0) throw new PasoFallido('SIN_ACCION_PANEL', `el Panel no ofrece «${etiqueta}»`);
      const desde = Date.now();
      await boton.click();
      const llego = await esperarHasta(`estado ${estadoEsperado}`, async () => {
        const actual = await leerPedido(codigo);
        return actual?.status === estadoEsperado ? actual : null;
      }, ESPERA.transicion);
      if (!llego.ok) throw new PasoFallido('TRANSICION_FALLIDA', `${codigo} no llegó a ${estadoEsperado}`);
      tiempos[`${nombrePaso}`] = Date.now() - desde;
      anotarPaso(nombrePaso, 'PASS', estadoEsperado);
    };
    await avanzar(/Aceptar/i, 'accepted', 'Accepted');
    await avanzar(/Preparar|En preparación/i, 'preparing', 'Preparing');
    await avanzar(/Listo/i, 'ready', 'Ready');
    await panel.screenshot({ path: evidencia.ruta('06-business-ready.png'), fullPage: true });

    // ── 6 · se le ofrece al repartidor ───────────────────────────────────────
    const ofrecer = panel.getByRole('button', { name: /Ofrecer|Asignar/i }).first();
    if (await ofrecer.count() === 0) throw new PasoFallido('SIN_OFERTA', 'el Panel no ofrece asignar repartidor');
    const desdeOferta = Date.now();
    await ofrecer.click();
    const ofrecido = await esperarHasta('oferta registrada', async () => {
      const eventos = await consultar(`select type from public.order_events e
        join public.orders o on o.id = e.order_id where o.public_code = ${lit(codigo)} and e.type = 'order.rider_offered' limit 1`);
      return eventos.length ? eventos[0] : null;
    }, ESPERA.oferta);
    if (!ofrecido.ok) throw new PasoFallido('OFERTA_NO_REGISTRADA', 'no se registró la oferta al repartidor');
    tiempos['listo → oferta al repartidor'] = Date.now() - desdeOferta;
    anotarPaso('Rider offered', 'PASS');

    // ── 7 · el teléfono ──────────────────────────────────────────────────────
    rider.despertarPantalla();
    rider.traerAlFrente();
    rider.capturarPantalla(evidencia.ruta('07-rider-offer.png'));
    const aceptado = await esperarHasta('el repartidor acepta', async () => {
      const estado = rider.estadoRider();
      if (estado.pedido === codigo) return estado;
      const oferta = estado.ofertas.find((texto) => texto.includes(codigo));
      if (oferta) rider.tocar('Aceptar oferta', { permitirSinPedido: true });
      return null;
    }, ESPERA.oferta);
    if (!aceptado.ok) throw new PasoFallido('RIDER_NO_ACEPTA', 'el teléfono no tomó el pedido de esta corrida');
    tiempos['oferta → aceptada en el teléfono'] = aceptado.ms;
    rider.capturarPantalla(evidencia.ruta('08-rider-accepted.png'));
    anotarPaso('Rider accepted', 'PASS');

    rider.tocar('Confirmar retiro', { codigoEsperado: codigo });
    const retirado = await esperarHasta('retirado', async () => {
      const actual = await leerPedido(codigo);
      return ['picked_up', 'on_the_way'].includes(actual?.status) ? actual : null;
    }, ESPERA.transicion);
    if (!retirado.ok) throw new PasoFallido('SIN_RETIRO', 'el pedido no pasó a retirado');
    tiempos['aceptado → retirado'] = retirado.ms;
    anotarPaso('Picked up', 'PASS', retirado.valor.status);

    // ── 8 · el cliente ve el seguimiento ─────────────────────────────────────
    /*
     * Lo que el cliente ve NO es el estado crudo: los mapeadores colapsan
     * `accepted` en «preparing», y `assigned`/`picked_up` en «on_the_way». Esos
     * tres estados son indistinguibles desde esta superficie, así que la
     * evidencia fina sale del Panel y de la base; acá se comprueba lo que una
     * persona vería de verdad.
     */
    await cliente.evaluate(() => { window.location.hash = '#tracking'; });
    const seguimiento = await esperarHasta('seguimiento del cliente', async () => {
      const estado = await cliente.locator('[data-tracking-status]').first().getAttribute('data-tracking-status').catch(() => null);
      return estado ? { estado } : null;
    }, ESPERA.transicion);
    if (!seguimiento.ok) throw new PasoFallido('SIN_TRACKING', 'el cliente no ve el seguimiento del pedido');
    await cliente.screenshot({ path: evidencia.ruta('09-customer-tracking.png'), fullPage: true });
    anotarPaso('Tracking', 'PASS', `el cliente ve «${seguimiento.valor.estado}»`);

    // ── 9 · el repartidor avisa que llegó ────────────────────────────────────
    /*
     * El orden importa y no es el intuitivo: la tarjeta del código de entrega
     * SÓLO se dibuja cuando el pedido está en `arrived`/`arriving`, y
     * desaparece al confirmarse la entrega. O sea que el cliente ve el PIN
     * recién después de que el repartidor marca que llegó. Leerlo antes es
     * esperar algo que la tienda todavía no muestra.
     */
    rider.tocar('Llegué', { codigoEsperado: codigo });
    const llego = await esperarHasta('llegada registrada', async () => {
      const actual = await leerPedido(codigo);
      return ['arrived', 'arriving'].includes(actual?.status) ? actual : null;
    }, ESPERA.transicion);
    if (!llego.ok) throw new PasoFallido('SIN_LLEGADA', 'el pedido no pasó a llegada');
    tiempos['retirado → llegada'] = llego.ms;

    // ── 10 · el PIN, leído de la pantalla del cliente ────────────────────────
    await cliente.reload({ waitUntil: 'networkidle' });
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
    // La captura se toma con el número ya tapado en el DOM: la imagen que queda
    // en disco nunca contuvo el código.
    await cliente.locator('[data-delivery-code-card] strong[data-delivery-code]').first()
      .evaluate((nodo) => { nodo.textContent = '• • • •'; nodo.setAttribute('data-delivery-code', '****'); });
    await cliente.screenshot({ path: evidencia.ruta('10-pin-visible-redacted.png'), fullPage: true });
    anotarPaso('PIN', 'PASS', 'leído de la pantalla del cliente');

    // ── 11 · entrega ─────────────────────────────────────────────────────────
    rider.escribirPin(pin, { codigoEsperado: codigo });
    const desdePin = Date.now();
    rider.tocar('Confirmar entrega', { codigoEsperado: codigo });
    const entregado = await esperarHasta('entregado', async () => {
      const actual = await leerPedido(codigo);
      return actual?.status === 'delivered' ? actual : null;
    }, ESPERA.entrega);
    if (!entregado.ok) throw new PasoFallido('SIN_ENTREGA', 'el pedido no llegó a entregado');
    tiempos['PIN → entregado'] = Date.now() - desdePin;
    rider.capturarPantalla(evidencia.ruta('11-rider-delivered.png'));
    await cliente.reload({ waitUntil: 'networkidle' });
    await cliente.waitForTimeout(3000);
    await cliente.screenshot({ path: evidencia.ruta('12-customer-delivered.png'), fullPage: true });
    anotarPaso('Delivered', 'PASS');

    // ── 12 · el stock, exacto ────────────────────────────────────────────────
    const stockDespues = await leerStock(producto.externalId);
    const decremento = evaluarDecremento({ antes: stockAntes, despues: stockDespues });
    if (!decremento.ok) {
      anotarPaso('Stock N-1', 'FAIL', decremento.mensaje);
      throw new PasoFallido(decremento.codigo, decremento.mensaje);
    }
    anotarPaso('Stock N-1', 'PASS', `${stockAntes} → ${stockDespues}`);

    // ── 13 · persistencia ────────────────────────────────────────────────────
    await contextoCliente.close();
    await contextoPanel.close();
    const clienteNuevo = await (await navegador.newContext({
      viewport: { width: 430, height: 932 },
      storageState: path.join(process.cwd(), RUTAS.sesionCustomer),
    })).newPage();
    await clienteNuevo.goto(`${host}/#tracking`, { waitUntil: 'networkidle', timeout: 90_000 });
    await clienteNuevo.waitForTimeout(4000);
    const textoCliente = await clienteNuevo.locator('body').innerText();
    const pedidoFinal = await leerPedido(codigo);
    const stockFinal = await leerStock(producto.externalId);
    // El Rider se relanza SIN force-stop: si el teléfono tuviera otra entrega en
    // curso, matarle el proceso le corta el GPS a un pedido ajeno.
    rider.traerAlFrente();
    const estadoRiderFinal = rider.estadoRider();
    const persistencia = /entregado|delivered/i.test(textoCliente)
      && pedidoFinal?.status === 'delivered'
      && stockFinal === stockDespues
      && estadoRiderFinal.pedido !== codigo;
    anotarPaso('Persistence', persistencia ? 'PASS' : 'FAIL',
      `cliente=${/entregado/i.test(textoCliente) ? 'entregado' : '?'} · base=${pedidoFinal?.status} · stock=${stockFinal} · repartidor sin el pedido=${estadoRiderFinal.pedido !== codigo}`);
    if (!persistencia) throw new PasoFallido('PERSISTENCIA', 'algo no sobrevivió a reabrir las tres superficies');

    await cerrar();
    return { ok: true, codigo, stockAntes, stockDespues, pinLeido };
  } catch (error) {
    await cerrar();
    const codigoFalla = error instanceof PasoFallido ? error.codigo : 'EXCEPCION';
    anotarPaso('Resultado', 'FAIL', `${codigoFalla}: ${String(error.message).slice(0, 160)}`);
    return { ok: false, codigo: codigoFalla, pedido: codigo, mensaje: String(error.message).slice(0, 400), pinLeido };
  }
}
