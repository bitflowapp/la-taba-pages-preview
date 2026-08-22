/*
 * RECEPCIÓN Y PUBLICACIÓN, POR EL PANEL Y POR NINGÚN OTRO LADO.
 *
 * Las dos operaciones que tocan mercadería se hacen acá, y las dos se hacen
 * exactamente como las haría quien atiende el local: entrando a la pantalla,
 * pasando el código de barras, escribiendo la cantidad y apretando el botón.
 * No hay una llamada directa a `apply_inventory_movement` ni a
 * `set_commercial_product_publication` en este archivo, y no la tiene que
 * haber: si el botón está roto, la prueba tiene que fallar. Una prueba que
 * llama a la RPC por su cuenta certifica el servidor y deja el Panel sin
 * probar, que es justamente donde apareció el defecto de la clave de
 * idempotencia.
 *
 * LO QUE SE COMPRUEBA DESPUÉS, EN LA BASE, EN SÓLO LECTURA
 * -------------------------------------------------------
 * Que el ledger sumó EXACTAMENTE un movimiento y el stock EXACTAMENTE la
 * cantidad atestiguada. Dos movimientos es una falla, no un detalle: significa
 * que una recepción física se contó dos veces.
 *
 * POR QUÉ NO SE PRUEBA LA IDEMPOTENCIA APRETANDO DOS VECES
 * -------------------------------------------------------
 * Porque no probaría lo que parece. La clave de la recepción lleva una «sal de
 * sesión» que el Panel RENUEVA en cuanto el servidor confirma —tiene que
 * hacerlo: recibir seis botellas hoy y otras seis mañana es legítimo—. O sea
 * que un segundo click DESPUÉS de un éxito es, por diseño, otra operación con
 * otra clave, y cargaría seis unidades más. Lo que la idempotencia protege es
 * el reintento de quien NO vio respuesta, y eso se prueba sin tocar producción:
 * `tests/idempotency-key-contract.test.mjs` verifica que la misma operación
 * produce la misma clave mientras la sal no cambie. Acá se comprueba el efecto:
 * un movimiento, ni más ni menos.
 */
import { PRODUCTO_AUTORIZADO } from './contrato.mjs';
import { NEGOCIO_ID } from './identidades.mjs';
import { consultar, lit } from './db-solo-lectura.mjs';

const ESPERA_PANTALLA = 30_000;
const ESPERA_SERVIDOR = 60_000;

export class OperacionDeMercaderiaFallida extends Error {
  constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; }
}

const fallar = (codigo, mensaje) => { throw new OperacionDeMercaderiaFallida(codigo, mensaje); };

/** Lo que la base dice del producto autorizado, ahora. */
export async function leerProducto() {
  const filas = await consultar(`select id::text as id, external_id, name, sku, stock, available,
      is_verified, is_active, price::text as price, is_alcoholic, price_status, catalog_origin
    from public.products
    where business_id = ${lit(NEGOCIO_ID)} and external_id = ${lit(PRODUCTO_AUTORIZADO.externalId)}`);
  return filas[0] || null;
}

/** Los movimientos del producto, del más nuevo al más viejo. */
export async function leerMovimientos(productoId) {
  return consultar(`select id::text as id, movement_type, quantity_delta, previous_stock, resulting_stock,
      idempotency_key, operator_id::text as operator_id, created_at::text as created_at
    from public.inventory_movements
    where business_id = ${lit(NEGOCIO_ID)} and product_id = ${lit(productoId)}
    order by created_at desc`);
}

/**
 * Abre una pantalla del centro de operación.
 *
 * En pantallas angostas la navegación vive detrás de «Más», así que si el botón
 * no está a la vista se abre esa hoja antes de buscarlo de nuevo. Fallar por no
 * encontrar un botón que existe pero está plegado sería un falso rojo.
 */
export async function abrirVista(panel, vista) {
  const boton = panel.locator(`[data-business-ops-view="${vista}"]`).first();
  if (await boton.count() === 0) {
    const mas = panel.locator('[data-panel-more-toggle]').first();
    if (await mas.count()) {
      await mas.click();
      await panel.waitForTimeout(600);
    }
  }
  const definitivo = panel.locator(`[data-business-ops-view="${vista}"]`).first();
  if (await definitivo.count() === 0) {
    fallar('PANEL_SIN_VISTA', `el Panel no ofrece la pantalla «${vista}»: revisá el rol de la identidad`);
  }
  await definitivo.click();
  await panel.waitForTimeout(1200);
}

/**
 * Pasa el código de barras y espera a que el Panel reconozca el producto.
 *
 * El resultado se lee del bloque que el Panel dibuja, no de la base: lo que
 * importa acá es que quien opera VEA el producto correcto antes de escribir una
 * cantidad. Un escáner que muestra otra cosa es un error de operación esperando
 * a pasar.
 */
export async function escanear(panel, gtin) {
  const campo = panel.locator('[data-barcode-input]').first();
  await campo.waitFor({ timeout: ESPERA_PANTALLA });
  await campo.fill(String(gtin));
  await panel.locator('[data-business-scan-test]').first().click();

  const resultado = panel.locator('.business-scan-result').first();
  await resultado.waitFor({ timeout: ESPERA_PANTALLA });
  const limite = Date.now() + ESPERA_PANTALLA;
  let texto = '';
  while (Date.now() < limite) {
    texto = (await resultado.innerText().catch(() => '')).replace(/\s+/g, ' ');
    if (texto.includes(PRODUCTO_AUTORIZADO.nombreVisible)) break;
    await panel.waitForTimeout(1000);
  }
  if (!texto.includes(PRODUCTO_AUTORIZADO.nombreVisible)) {
    fallar('ESCANEO_SIN_PRODUCTO', `el Panel no reconoció ${gtin} como ${PRODUCTO_AUTORIZADO.nombreVisible}: leyó «${texto.slice(0, 160)}»`);
  }
  const invalido = await panel.locator('.business-scan-result.is-invalid').count();
  if (invalido) fallar('ESCANEO_INVALIDO', 'el Panel marcó el código como inválido');
  return texto;
}

/**
 * ESCRIBIR LA CANTIDAD Y CONFIRMAR, EN EL MISMO TURNO, SIN VENTANA EN EL MEDIO.
 *
 * El 2026-08-22, con seis botellas atestiguadas, esta recepción cargó UNA. El
 * ledger lo dejó a la vista: la clave del movimiento decía `...-1-in-r0-...`, o
 * sea que el Panel leyó `1` del campo, y la referencia quedó nula.
 *
 * La causa no es que `fill()` falle. Es que el centro de operación se REDIBUJA
 * solo —cuando se resuelve el escaneo y después, periódicamente— y al
 * redibujarse vuelve a emitir el formulario con sus valores por defecto,
 * borrando lo que el operador acababa de tipear. El primer intento de arreglo
 * fue escribir, esperar y releer; el campo pasó la relectura y IGUAL llegó en
 * `1` al click, porque el redibujado siguiente cayó en el medio.
 *
 * Que un valor tipeado sobreviva o no depende de si un refresco cae justo ahí,
 * y esa carrera no se gana esperando: se gana no dejando ningún hueco. Acá se
 * escribe el campo, se comprueba y se aprieta el botón dentro de UNA sola
 * ejecución sincrónica en la página. JavaScript es de un solo hilo: ningún
 * redibujado puede colarse entre la comprobación y el click.
 *
 * (Esto le pasa igual a una persona: tipear 6, que el Panel refresque y que el
 * botón cargue 1. Queda anotado como hallazgo del producto, no del harness.)
 */
export async function escribirYConfirmar(pagina, { cantidad, referencia, accion }) {
  return pagina.evaluate(({ qty, ref, acc }) => {
    const raiz = document.querySelector('[data-business-ops-center]');
    if (!raiz) return { ok: false, motivo: 'no está el centro de operación en pantalla' };
    const campo = raiz.querySelector('[name="packageQuantity"]');
    const boton = raiz.querySelector(`[data-inventory-confirm="${acc}"]`);
    if (!campo || !boton) return { ok: false, motivo: 'faltan el campo de cantidad o el botón de confirmar' };

    // El `value` nativo, para que los frameworks que escuchan `input` lo vean.
    const ponerValor = (elemento, valor) => {
      const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      descriptor.set.call(elemento, valor);
      elemento.dispatchEvent(new Event('input', { bubbles: true }));
      elemento.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const referenciaCampo = raiz.querySelector('[name="reason"]');
    if (referenciaCampo && ref) ponerValor(referenciaCampo, ref);
    ponerValor(campo, String(qty));

    // La última comprobación, en el mismo turno que el click.
    if (campo.value !== String(qty)) {
      return { ok: false, motivo: `el campo quedó en «${campo.value}» y la atestación dice ${qty}` };
    }
    boton.click();
    return { ok: true, cantidadLeida: campo.value, referenciaLeida: referenciaCampo?.value || '' };
  }, { qty: cantidad, ref: referencia, acc: accion });
}

/**
 * Carga la recepción física.
 *
 * `cantidad` viene de la atestación humana y de ningún otro lado: este módulo
 * no la deduce, no la sugiere y no tiene un valor por defecto.
 */
export async function recibirMercaderia(panel, { cantidad, referencia, evidencia }) {
  if (!Number.isInteger(cantidad) || cantidad < 1) {
    fallar('CANTIDAD_NO_ATESTIGUADA', 'no hay una cantidad física atestiguada para recibir');
  }

  const antes = await leerProducto();
  if (!antes) fallar('PRODUCTO_INEXISTENTE', 'el producto autorizado no existe');
  const movimientosAntes = await leerMovimientos(antes.id);
  const stockAntes = Number(antes.stock);

  await abrirVista(panel, 'inventory-receive');
  await escanear(panel, PRODUCTO_AUTORIZADO.gtin);

  await evidencia?.capturar?.(panel, 'recepcion-antes-de-confirmar');

  const escrito = await escribirYConfirmar(panel, {
    cantidad,
    referencia: String(referencia || '').slice(0, 160),
    accion: 'purchase_receipt',
  });
  if (!escrito.ok) fallar('CANTIDAD_NO_QUEDO_ESCRITA', `${escrito.motivo}: no se confirmó nada`);

  // El efecto se espera en la BASE, no en la pantalla: la pantalla puede decir
  // «guardado» y el servidor haber rechazado.
  const limite = Date.now() + ESPERA_SERVIDOR;
  let despues = antes;
  let movimientos = movimientosAntes;
  while (Date.now() < limite) {
    await panel.waitForTimeout(2000);
    despues = await leerProducto();
    movimientos = await leerMovimientos(antes.id);
    if (movimientos.length !== movimientosAntes.length) break;
  }

  const nuevos = movimientos.length - movimientosAntes.length;
  if (nuevos === 0) {
    const aviso = await panel.locator('.business-ops-feedback, [role="alert"]').first().innerText().catch(() => '');
    fallar('RECEPCION_SIN_EFECTO', `el servidor no registró ningún movimiento${aviso ? `; el Panel dice «${aviso.replace(/\s+/g, ' ').slice(0, 200)}»` : ''}`);
  }
  if (nuevos !== 1) {
    fallar('P0_RECEPCION_DUPLICADA', `una recepción física generó ${nuevos} movimientos: el inventario quedó contado de más`);
  }

  const stockDespues = Number(despues.stock);
  if (stockDespues !== stockAntes + cantidad) {
    fallar('P0_STOCK_INESPERADO', `stock ${stockAntes} → ${stockDespues} y tenía que quedar en ${stockAntes + cantidad}`);
  }

  const movimiento = movimientos[0];
  if (movimiento.movement_type !== 'purchase_receipt') {
    fallar('MOVIMIENTO_DE_OTRO_TIPO', `el movimiento quedó como «${movimiento.movement_type}» y tenía que ser una recepción`);
  }
  if (Number(movimiento.resulting_stock) !== stockDespues) {
    fallar('LEDGER_INCONSISTENTE', `el ledger dice que quedó en ${movimiento.resulting_stock} y el producto dice ${stockDespues}`);
  }
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(String(movimiento.idempotency_key || ''))) {
    fallar('CLAVE_FUERA_DE_CONTRATO', 'el movimiento se guardó con una clave de idempotencia que no cumple el contrato');
  }

  return {
    stockAntes,
    stockDespues,
    cantidad,
    movimientoId: movimiento.id,
    claveIdempotencia: movimiento.idempotency_key,
    operadorId: movimiento.operator_id,
  };
}

/**
 * Publica el producto en la tienda.
 *
 * El botón sólo aparece cuando el Panel ya sabe que el servidor va a aceptar
 * —stock, verificación, precio, imagen, alcohol—. Si no aparece, se lee el
 * cartel que el Panel puso en su lugar y se reporta ESE motivo, en vez de
 * inventar uno.
 */
export async function publicarEnTienda(panel, { evidencia } = {}) {
  const antes = await leerProducto();
  if (!antes) fallar('PRODUCTO_INEXISTENTE', 'el producto autorizado no existe');
  if (antes.available === true) {
    return { yaEstaba: true, stock: Number(antes.stock) };
  }

  await abrirVista(panel, 'inventory-receive');
  await escanear(panel, PRODUCTO_AUTORIZADO.gtin);

  const boton = panel.locator('[data-commercial-publish="true"]').first();
  await panel.waitForTimeout(1500);
  if (await boton.count() === 0) {
    const cartel = (await panel.locator('.business-commercial-publication').first().innerText().catch(() => ''))
      .replace(/\s+/g, ' ').trim();
    fallar('SIN_BOTON_PUBLICAR', `el Panel no ofrece publicar${cartel ? `: «${cartel.slice(0, 200)}»` : ' y no explica por qué'}`);
  }

  await evidencia?.capturar?.(panel, 'publicacion-antes-de-confirmar');
  await boton.click();

  const limite = Date.now() + ESPERA_SERVIDOR;
  let despues = antes;
  while (Date.now() < limite) {
    await panel.waitForTimeout(2000);
    despues = await leerProducto();
    if (despues.available === true) break;
  }
  if (despues.available !== true) {
    const aviso = await panel.locator('.business-ops-feedback, [role="alert"]').first().innerText().catch(() => '');
    fallar('PUBLICACION_SIN_EFECTO', `el producto sigue oculto${aviso ? `; el Panel dice «${aviso.replace(/\s+/g, ' ').slice(0, 200)}»` : ''}`);
  }
  if (Number(despues.stock) !== Number(antes.stock)) {
    fallar('P0_PUBLICACION_TOCO_STOCK', `publicar cambió el stock de ${antes.stock} a ${despues.stock}: no tiene que tocarlo`);
  }

  return { yaEstaba: false, stock: Number(despues.stock) };
}

/**
 * ¿La tienda ya sirve el producto? Se mira desde AFUERA, con la vitrina
 * pública, porque publicar y que se vea son dos cosas distintas y la segunda es
 * la que le importa a quien compra.
 */
export async function esperarEnLaVitrina(cliente, { host, limiteMs = 90_000 }) {
  const limite = Date.now() + limiteMs;
  while (Date.now() < limite) {
    await cliente.goto(`${host}/#catalog`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await cliente.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 60_000 });
    await cliente.waitForTimeout(2500);
    const tarjeta = cliente.locator('[data-product-grid] .product-card')
      .filter({ hasText: PRODUCTO_AUTORIZADO.nombreVisible }).first();
    if (await tarjeta.count() > 0) return true;
  }
  return false;
}
