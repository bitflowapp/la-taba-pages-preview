/*
 * Verificación de la compra de control y de su devolución, a partir de lo que la base ya registró.
 *
 * Funciones puras: reciben una instantánea (leída por el CLI con la llave de servicio, sin tokens ni datos de pagador) y
 * devuelven una lista de comprobaciones. Estados:
 *   PASS    la evidencia está y coincide
 *   FAIL    la evidencia contradice lo autorizado o falta algo que tendría que estar
 *   MANUAL  sólo una persona puede comprobarlo (la pantalla del comprador, la cuenta del vendedor): se dice cómo
 * Nunca se da por devuelto dinero sin evidencia del proveedor: una devolución aprobada sin identificador, un importe que
 * no coincide o un caso ambiguo abierto son FAIL.
 */
const pesos = (valor) => Math.round(Number(valor) * 100);
const igual = (a, b) => pesos(a) === pesos(b);
const check = (id, estado, titulo, detalle = '') => ({ id, estado, titulo, detalle });
const suma = (filas, campo) => filas.reduce((total, fila) => total + pesos(fila[campo] ?? 0), 0) / 100;
const abiertos = (discrepancias) => (discrepancias || []).filter((d) => d.status !== 'resolved');
const DEVUELTO = new Set(['approved']);
const NO_RESUELTO = new Set(['requested', 'ambiguous', 'processing']);

function unico(lista, etiqueta) {
  return lista.length === 1 ? { ok: true, valor: lista[0] } : { ok: false, detalle: `${etiqueta}: ${lista.length}` };
}

/**
 * @param snapshot { authorization, session, intents, payments, attempts, receipts, outbox, orders, reservations,
 *                   refunds, discrepancies, stockNow: [{id, sku, stock}], settings }
 * @param opts { baselineStock?: {[productId]: number}, integratorOwnerId?: string }
 */
export function verificarCompra(snapshot, { baselineStock = null, integratorOwnerId = null } = {}) {
  const { authorization: auth, session, intents = [], payments = [], attempts = [], receipts = [], outbox = [],
    orders = [], reservations = [], refunds = [], discrepancies = [], stockNow = [], settings = {} } = snapshot;
  const out = [];

  const intentRes = unico(intents, 'intenciones de pago de la sesión');
  const intent = intentRes.valor;
  out.push(check('autorizacion_consumida',
    auth?.status === 'consumed' && intentRes.ok && auth.consumed_by_intent_id === intent.id ? 'PASS' : 'FAIL',
    'La autorización se consumió con exactamente esta compra',
    `estado ${auth?.status}; ${intentRes.ok ? `intención ${intent.id}` : intentRes.detalle}`));
  if (!intentRes.ok || !auth) return finalizar(out);

  out.push(check('comprador_correcto', session.customer_id === auth.customer_id ? 'PASS' : 'FAIL',
    'La compra la hizo el cliente autorizado', session.customer_id === auth.customer_id ? '' : 'otro cliente creó la sesión'));

  const importeOk = igual(intent.expected_amount, auth.amount) && igual(session.total, auth.amount) && intent.currency === 'ARS';
  out.push(check('importe_calculado_por_el_servidor', importeOk ? 'PASS' : 'FAIL',
    'El servidor calculó el importe autorizado',
    `autorizado ${auth.amount}; sesión ${session.total}; intención ${intent.expected_amount} ${intent.currency}`));

  const preferencias = attempts.filter((a) => a.attempt_type === 'preference');
  out.push(check('una_unica_preferencia',
    preferencias.length === 1 && preferencias[0].preference_id ? 'PASS' : 'FAIL',
    'Se generó una única preferencia de pago', `preferencias: ${preferencias.length}`));

  const aprobados = payments.filter((p) => p.status === 'approved' || p.status === 'refunded' || p.status === 'charged_back');
  const pago = aprobados.length === 1 ? aprobados[0] : null;
  const pagoOk = pago && igual(pago.amount, auth.amount) && pago.currency === 'ARS' && pago.is_financing === true && !pago.validation_error;
  out.push(check('pago_autentico_aprobado', pagoOk ? 'PASS' : 'FAIL',
    'Hay un único pago aprobado (el que financia el pedido), del importe autorizado, sin errores de validación',
    pago ? `pago ${pago.provider_payment_id}: ${pago.status} ${pago.amount} ${pago.currency}` : `pagos aprobados: ${aprobados.length} de ${payments.length}`));
  if (!pago) return finalizar(out);

  const modoVivo = auth.environment === 'production' ? intent.live_mode === true : true;
  out.push(check('entorno_correcto',
    pago.environment === auth.environment && modoVivo ? 'PASS' : 'FAIL',
    auth.environment === 'production' ? 'El pago es de producción (live_mode)' : 'El pago es de prueba',
    `entorno ${pago.environment}; live_mode ${intent.live_mode}`));

  const cobradorOk = String(pago.seller_id) === String(auth.seller_collector_id)
    && String(settings.collector_id) === String(auth.seller_collector_id)
    && (!integratorOwnerId || String(pago.seller_id) !== String(integratorOwnerId));
  out.push(check('cobrador_correcto', cobradorOk ? 'PASS' : 'FAIL',
    'El dinero lo cobra la cuenta autorizada, distinta de la integradora',
    `cobrador ${pago.seller_id}; autorizado ${auth.seller_collector_id}; configurado ${settings.collector_id}${integratorOwnerId ? `; integradora ${integratorOwnerId}` : ''}`));

  const leidoDelProveedor = Boolean(pago.provider_event_at) && Boolean(intent.raw_response_hash)
    && Date.parse(pago.last_seen_at) >= Date.parse(intent.approved_at || pago.first_seen_at);
  out.push(check('verificado_directamente_con_el_proveedor', leidoDelProveedor ? 'PASS' : 'FAIL',
    'El backend leyó el pago al proveedor (no confió en el navegador)',
    `evento del proveedor ${pago.provider_event_at || '—'}; hash de respuesta ${intent.raw_response_hash ? 'sí' : 'no'}`));

  const delPago = receipts.filter((r) => String(r.resource_id) === String(pago.provider_payment_id));
  const validos = delPago.filter((r) => r.signature_valid === true && r.processing_status !== 'rejected_signature');
  const procesados = validos.filter((r) => r.processing_status === 'completed' || r.processing_status === 'duplicate');
  out.push(check('aviso_de_pago',
    validos.length === 0 ? 'PASS' : procesados.length === validos.length ? 'PASS' : 'FAIL',
    'La notificación se recibió y procesó, o el barrido del proveedor recuperó el pago',
    validos.length === 0 ? 'sin aviso válido: el pedido lo armó el barrido del proveedor'
      : `${validos.length} aviso(s) válido(s), ${procesados.length} procesado(s); firmas inválidas: ${delPago.length - validos.length}`));

  const unPedido = orders.length === 1 && intent.order_id === orders[0].id && session.completed_order_id === orders[0].id
    && igual(orders[0].total, auth.amount) && !orders[0].cancelled_at;
  out.push(check('un_solo_pedido', unPedido ? 'PASS' : 'FAIL', 'Se registró un único pedido por el importe autorizado',
    `pedidos: ${orders.map((o) => `${o.public_code} ${o.total} ${o.status}`).join('; ') || 'ninguno'}`));

  const porProducto = new Map();
  for (const r of reservations.filter((x) => x.status === 'converted')) porProducto.set(r.product_id, (porProducto.get(r.product_id) || 0) + r.quantity);
  const esperado = new Map(auth.items.map((i) => [i.product_id, i.quantity]));
  const convertidas = [...esperado].every(([id, q]) => porProducto.get(id) === q) && porProducto.size === esperado.size
    && !reservations.some((r) => r.status === 'active');
  let stockDetalle = 'reservas convertidas una sola vez';
  let stockEstado = convertidas ? 'PASS' : 'FAIL';
  if (convertidas && baselineStock) {
    const mal = [...esperado].filter(([id, q]) => {
      const ahora = stockNow.find((s) => s.id === id)?.stock;
      return baselineStock[id] === undefined || ahora !== baselineStock[id] - q;
    });
    if (mal.length) { stockEstado = 'FAIL'; stockDetalle = `el stock no bajó exactamente una vez: ${mal.map(([id]) => id).join(', ')}`; }
    else stockDetalle += '; el stock bajó exactamente la cantidad comprada';
  } else if (convertidas) {
    stockEstado = 'MANUAL';
    stockDetalle = 'reservas convertidas una sola vez; falta la línea base de stock para comprobar el descuento (--linea-base)';
  }
  out.push(check('stock_una_sola_vez', stockEstado, 'El stock se descontó una sola vez', stockDetalle));

  const pagos = payments.length;
  out.push(check('sin_duplicados', aprobados.length === 1 && orders.length === 1 && refunds.length === 0 ? 'PASS' : 'FAIL',
    'Sin cobros, pedidos ni devoluciones duplicados', `pagos ${pagos}, aprobados ${aprobados.length}, pedidos ${orders.length}, devoluciones ${refunds.length}`));

  const pendientes = outbox.filter((o) => !['completed', 'cancelled'].includes(o.status));
  const casos = abiertos(discrepancies);
  out.push(check('conciliacion_limpia', pendientes.length === 0 && casos.length === 0 ? 'PASS' : 'FAIL',
    'Conciliación: cola vacía y ninguna discrepancia abierta',
    `cola pendiente ${pendientes.length}; discrepancias abiertas ${casos.length}${casos.length ? ` (${casos.map((c) => c.kind).join(', ')})` : ''}`));

  out.push(check('estado_visible_para_el_comprador', 'MANUAL', 'El comprador ve el estado real del pedido',
    `El comprador abre «Mis pedidos» en su dispositivo y ve el pedido ${orders[0]?.public_code || ''} como recibido y pagado.`));
  out.push(check('cuenta_que_recibio_el_dinero', 'MANUAL', 'El titular ve el cobro en su cuenta de Mercado Pago',
    `En la app de Mercado Pago del titular: operación n.º ${pago.provider_payment_id}, ${pago.amount} ARS, «Aprobado», y la fecha de liberación del dinero. Quien recibe es el titular autorizado, no la integradora.`));
  return finalizar(out);
}

/**
 * @param snapshot el mismo de verificarCompra (con refunds y el pago ya leído después de devolver)
 * @param opts { importeDevuelto: number (lo autorizado), operacion: n.º de pago autorizado a devolver, baselineStock, entregado: boolean }
 */
export function verificarDevolucion(snapshot, { importeDevuelto, operacion = null, baselineStock = null, entregado = false } = {}) {
  const { authorization: auth, intents = [], payments = [], refunds = [], orders = [], discrepancies = [],
    stockNow = [] } = snapshot;
  const out = [];
  const intent = intents[0];
  const pago = payments.find((p) => p.status === 'approved' || p.status === 'refunded' || p.status === 'charged_back');
  out.push(check('compra_original', intent && pago && auth?.status === 'consumed' ? 'PASS' : 'FAIL',
    'Existe la compra de control que se devuelve', pago ? `pago ${pago.provider_payment_id}` : 'sin pago aprobado'));
  if (!intent || !pago) return finalizar(out);
  out.push(check('operacion_autorizada', operacion !== null && String(pago.provider_payment_id) === String(operacion) ? 'PASS' : 'FAIL',
    'La operación devuelta es la que el titular autorizó', `autorizada ${operacion ?? '—'}; devuelta ${pago.provider_payment_id}`));

  const pedidas = refunds.filter((r) => r.status !== 'rejected' && r.status !== 'failed');
  out.push(check('solicitud_con_clave_de_idempotencia', pedidas.length > 0 && pedidas.every((r) => r.idempotency_key) ? 'PASS' : 'FAIL',
    'La devolución se pidió con clave de idempotencia', `solicitudes: ${pedidas.length}`));

  const sinResolver = refunds.filter((r) => NO_RESUELTO.has(r.status));
  out.push(check('sin_resultado_ambiguo', sinResolver.length === 0 ? 'PASS' : 'FAIL',
    'Ninguna devolución quedó en un estado ambiguo (no se declara devuelto lo que no se sabe)',
    sinResolver.length ? sinResolver.map((r) => `${r.id}:${r.status}`).join(', ') : ''));

  const aprobadas = refunds.filter((r) => DEVUELTO.has(r.status));
  const sinEvidencia = aprobadas.filter((r) => !r.provider_refund_id);
  out.push(check('evidencia_del_proveedor', aprobadas.length > 0 && sinEvidencia.length === 0 ? 'PASS' : 'FAIL',
    'Cada devolución registrada como aprobada trae el identificador del proveedor',
    `aprobadas ${aprobadas.length}; sin identificador del proveedor ${sinEvidencia.length}`));

  const total = suma(aprobadas, 'amount');
  out.push(check('importe_exacto', importeDevuelto !== undefined && igual(total, importeDevuelto) ? 'PASS' : 'FAIL',
    'La suma devuelta es exactamente la autorizada', `devuelto ${total}; autorizado ${importeDevuelto}`));

  const completa = igual(total, pago.amount);
  const estadoPagoOk = completa ? pago.status === 'refunded' : pago.status === 'approved';
  out.push(check('estado_real_en_el_proveedor', estadoPagoOk && igual(pago.refunded_amount ?? 0, total) ? 'PASS' : 'FAIL',
    'El pago, leído de nuevo al proveedor, refleja la devolución',
    `estado ${pago.status}; devuelto según el proveedor ${pago.refunded_amount}; según La Taba ${total}`));

  out.push(check('intencion_consistente', igual(intent.refunded_amount ?? 0, total) && (!completa || intent.internal_status === 'refunded') ? 'PASS' : 'FAIL',
    'La intención de pago coincide con las devoluciones aprobadas', `refunded_amount ${intent.refunded_amount}; estado ${intent.internal_status}`));

  const casos = abiertos(discrepancies);
  out.push(check('conciliacion_de_la_devolucion', casos.length === 0 ? 'PASS' : 'FAIL',
    'Ninguna discrepancia abierta', casos.length ? casos.map((c) => c.kind).join(', ') : ''));

  const origen = [...new Set(aprobadas.map((r) => r.origin || 'api'))].join(', ');
  out.push(check('origen_de_la_devolucion', 'PASS', 'Origen registrado', origen || '—'));

  const pedido = orders[0];
  if (pedido) {
    const cancelado = pedido.status === 'cancelled';
    out.push(check('pedido_cerrado', cancelado ? 'PASS' : 'FAIL', 'El pedido con el pago devuelto quedó cancelado',
      `pedido ${pedido.public_code}: ${pedido.status}`));
    if (!entregado && baselineStock && cancelado) {
      const mal = auth.items.filter((i) => stockNow.find((s) => s.id === i.product_id)?.stock !== baselineStock[i.product_id]);
      out.push(check('stock_devuelto', mal.length === 0 ? 'PASS' : 'FAIL', 'El stock volvió a su valor previo (el producto no se entregó)',
        mal.length ? mal.map((i) => i.product_id).join(', ') : ''));
    } else {
      out.push(check('stock_devuelto', 'MANUAL', 'Stock', 'Si el producto se entregó, el stock no vuelve; si no, comparar con la línea base (--linea-base).'));
    }
  }
  return finalizar(out);
}

function finalizar(checks) {
  return { ok: !checks.some((c) => c.estado === 'FAIL'), manual: checks.filter((c) => c.estado === 'MANUAL').length, checks };
}

export function imprimir({ checks, ok, manual }, escribir = console.log) {
  for (const c of checks) escribir(`${c.estado.padEnd(6)} ${c.titulo}${c.detalle ? `\n       ${c.detalle}` : ''}`);
  escribir(`\nRESULTADO: ${ok ? 'sin fallas' : 'HAY FALLAS'}${manual ? ` · ${manual} comprobación(es) manual(es) pendientes` : ''}`);
}
