/*
 * El documento de autorización del cobro real controlado.
 *
 * Lo escribe y lo firma una persona con autoridad sobre el comercio (el titular o quien él designe por escrito), FUERA
 * del repositorio (el repositorio es público). Ningún valor de este documento lo elige ingeniería: el importe, el
 * producto, la cuenta compradora y quién asume las comisiones los decide el titular. Acá sólo se valida que esté
 * completo, que sea coherente y se calcula la huella (sha256) que la base de datos guarda como prueba de qué se autorizó.
 *
 * Funciones puras: sin red, sin base de datos, sin reloj implícito (la fecha llega por parámetro).
 */
import { createHash } from 'node:crypto';

export const ESQUEMA = 'taba-autorizacion-cobro-real/1';
export const PENDIENTE = '__COMPLETAR__';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLLECTOR = /^[1-9][0-9]{4,19}$/;
export const TOPE_PILOTO_ARS = 50_000; // el mismo tope que la restricción de la base: atrapa un cero de más, no fija precios.

export function plantilla(destino = 'production') {
  return {
    esquema: ESQUEMA,
    destino,
    comercio: { id: PENDIENTE, slug: PENDIENTE },
    vendedor: {
      collector_id: PENDIENTE,
      titular: PENDIENTE,
      cuenta_mercado_pago: PENDIENTE,
    },
    comprador: {
      cliente_taba_id: PENDIENTE,
      cuenta_mercado_pago: PENDIENTE,
      distinta_del_vendedor: false,
    },
    compra: {
      concepto: PENDIENTE,
      items: [{ producto_id: PENDIENTE, sku: PENDIENTE, cantidad: 1 }],
      importe_ars: PENDIENTE,
      entrega: 'retiro',
    },
    comisiones: { las_asume: PENDIENTE, detalle: PENDIENTE },
    devolucion: { via: PENDIENTE, quien: PENDIENTE, importe_ars: PENDIENTE },
    abortar_si: PENDIENTE,
    vigencia_minutos: PENDIENTE,
    autoriza: { nombre: PENDIENTE, cargo: PENDIENTE, fecha: PENDIENTE },
    declaraciones: {
      dinero_real: false,
      una_sola_compra: false,
      devolucion_incluida: false,
      importe_elegido_por_el_titular: false,
    },
  };
}

function canonico(valor) {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;
  if (valor && typeof valor === 'object') {
    return `{${Object.keys(valor).sort().map((clave) => `${JSON.stringify(clave)}:${canonico(valor[clave])}`).join(',')}}`;
  }
  return JSON.stringify(valor);
}

export const huella = (documento) => createHash('sha256').update(canonico(documento)).digest('hex');

const texto = (valor, minimo = 3) => typeof valor === 'string' && valor.trim().length >= minimo && !valor.includes(PENDIENTE);
const pesos = (valor) => typeof valor === 'number' && Number.isFinite(valor) && valor > 0
  && Math.abs(valor * 100 - Math.round(valor * 100)) < 1e-9;
const mismaCuenta = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/** Devuelve la lista de problemas (vacía = el documento está completo y es coherente). */
export function validar(documento, { hoy = new Date().toISOString().slice(0, 10) } = {}) {
  const errores = [];
  const falta = (ruta, motivo) => errores.push({ ruta, motivo });
  if (!documento || typeof documento !== 'object') return [{ ruta: '', motivo: 'el documento no es un objeto JSON' }];
  const d = documento;
  if (d.esquema !== ESQUEMA) falta('esquema', `debe ser ${ESQUEMA}`);
  if (!['qa', 'production'].includes(d.destino)) falta('destino', 'qa o production');

  if (!UUID.test(d.comercio?.id || '')) falta('comercio.id', 'UUID del comercio');
  if (!texto(d.comercio?.slug)) falta('comercio.slug', 'el slug del comercio (se repite al autorizar)');

  if (!COLLECTOR.test(String(d.vendedor?.collector_id ?? ''))) falta('vendedor.collector_id', 'el número de usuario de Mercado Pago del vendedor (5 a 20 dígitos)');
  if (!texto(d.vendedor?.titular, 5)) falta('vendedor.titular', 'nombre completo o razón social del titular que recibe el dinero');
  if (!texto(d.vendedor?.cuenta_mercado_pago, 5)) falta('vendedor.cuenta_mercado_pago', 'el correo o alias con el que el titular reconoce su cuenta');

  if (!UUID.test(d.comprador?.cliente_taba_id || '')) falta('comprador.cliente_taba_id', 'UUID de la cuenta de cliente de La Taba que va a comprar');
  if (!texto(d.comprador?.cuenta_mercado_pago, 5)) falta('comprador.cuenta_mercado_pago', 'el correo de la cuenta de Mercado Pago con la que se paga');
  if (d.comprador?.distinta_del_vendedor !== true) falta('comprador.distinta_del_vendedor', 'debe declararse true: Mercado Pago no cobra a un usuario con su propia cuenta');
  if (texto(d.comprador?.cuenta_mercado_pago, 5) && texto(d.vendedor?.cuenta_mercado_pago, 5)
    && mismaCuenta(d.comprador.cuenta_mercado_pago, d.vendedor.cuenta_mercado_pago)) falta('comprador.cuenta_mercado_pago', 'es la misma cuenta que la del vendedor');
  if (mismaCuenta(d.comprador?.cuenta_mercado_pago ?? '', d.vendedor?.collector_id ?? '')) falta('comprador.cuenta_mercado_pago', 'coincide con el número de usuario del vendedor');

  if (!texto(d.compra?.concepto, 5)) falta('compra.concepto', 'qué se compra, en palabras (no un producto comercial elegido por ingeniería)');
  const items = d.compra?.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 5) falta('compra.items', 'entre 1 y 5 productos');
  else {
    const vistos = new Set();
    items.forEach((item, i) => {
      if (!UUID.test(item?.producto_id || '')) falta(`compra.items[${i}].producto_id`, 'UUID del producto');
      else if (vistos.has(item.producto_id.toLowerCase())) falta(`compra.items[${i}].producto_id`, 'producto repetido');
      else vistos.add(item.producto_id.toLowerCase());
      if (!texto(item?.sku, 2)) falta(`compra.items[${i}].sku`, 'SKU del producto');
      if (!Number.isInteger(item?.cantidad) || item.cantidad < 1 || item.cantidad > 10) falta(`compra.items[${i}].cantidad`, 'entero entre 1 y 10');
    });
  }
  if (!pesos(d.compra?.importe_ars)) falta('compra.importe_ars', 'importe exacto en ARS, con hasta 2 decimales, escrito por el titular');
  else if (d.compra.importe_ars > TOPE_PILOTO_ARS) falta('compra.importe_ars', `el piloto no admite más de ARS ${TOPE_PILOTO_ARS}`);
  if (d.compra?.entrega !== 'retiro') falta('compra.entrega', 'el piloto es una compra con retiro en el local');

  if (!['vendedor', 'integradora'].includes(d.comisiones?.las_asume)) falta('comisiones.las_asume', 'vendedor o integradora');
  if (!texto(d.comisiones?.detalle, 10)) falta('comisiones.detalle', 'cómo se informa y se concilia la comisión');

  if (!['api', 'panel_del_vendedor'].includes(d.devolucion?.via)) falta('devolucion.via', 'api o panel_del_vendedor');
  if (!texto(d.devolucion?.quien, 3)) falta('devolucion.quien', 'quién ejecuta la devolución');
  if (!pesos(d.devolucion?.importe_ars)) falta('devolucion.importe_ars', 'importe a devolver, exacto');
  else if (pesos(d.compra?.importe_ars) && d.devolucion.importe_ars > d.compra.importe_ars) falta('devolucion.importe_ars', 'no puede superar el importe de la compra');

  if (!texto(d.abortar_si, 20)) falta('abortar_si', 'las condiciones concretas para abortar (al menos una oración)');
  if (!Number.isInteger(d.vigencia_minutos) || d.vigencia_minutos < 5 || d.vigencia_minutos > 1440) falta('vigencia_minutos', 'entero entre 5 y 1440');

  if (!texto(d.autoriza?.nombre, 5)) falta('autoriza.nombre', 'nombre y apellido de quien autoriza');
  if (!texto(d.autoriza?.cargo, 3)) falta('autoriza.cargo', 'titular del comercio o designado por escrito');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.autoriza?.fecha || '')) falta('autoriza.fecha', 'AAAA-MM-DD');
  else if (Math.abs(Date.parse(d.autoriza.fecha) - Date.parse(hoy)) > 86_400_000) falta('autoriza.fecha', `debe ser de hoy (${hoy}) o de un día contiguo: una autorización vieja no vale`);

  for (const clave of ['dinero_real', 'una_sola_compra', 'devolucion_incluida', 'importe_elegido_por_el_titular']) {
    if (d.declaraciones?.[clave] !== true) falta(`declaraciones.${clave}`, 'debe declararse true por quien autoriza');
  }
  const pendiente = JSON.stringify(d).includes(PENDIENTE);
  if (pendiente) falta('', `quedan campos con ${PENDIENTE}`);
  return errores;
}

/** Lo que va a pasar, en palabras que el titular puede leer antes de firmar. */
export function resumen(d) {
  const importe = Number(d.compra.importe_ars).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
  const lineas = d.compra.items.map((item) => `  · ${item.cantidad} × ${item.sku}`).join('\n');
  return [
    `DESTINO: ${d.destino === 'production' ? 'PRODUCCIÓN — DINERO REAL' : 'QA — dinero ficticio'}`,
    `Se van a mover EXACTAMENTE ${importe}.`,
    `Los recibe: ${d.vendedor.titular} — cuenta de Mercado Pago n.º ${d.vendedor.collector_id} (${d.vendedor.cuenta_mercado_pago}).`,
    `Los paga: la cuenta ${d.comprador.cuenta_mercado_pago}, desde el cliente de La Taba ${d.comprador.cliente_taba_id}. No es la cuenta del vendedor.`,
    `Qué se compra: ${d.compra.concepto}, con retiro en el local:`,
    lineas,
    `Comisiones: las asume ${d.comisiones.las_asume}. ${d.comisiones.detalle}`,
    `Devolución: ${d.devolucion.quien} devuelve ${Number(d.devolucion.importe_ars).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })} ${d.devolucion.via === 'api' ? 'por la API de La Taba' : 'desde el panel de Mercado Pago del vendedor'}.`,
    `Se aborta si: ${d.abortar_si}`,
    `Vale ${d.vigencia_minutos} minutos desde que se firma en el sistema y se consume con la primera compra: no hay segunda oportunidad sin una autorización nueva.`,
    `Autoriza: ${d.autoriza.nombre} (${d.autoriza.cargo}) el ${d.autoriza.fecha}.`,
  ].join('\n');
}

/** Parámetros de la RPC authorize_live_pilot_payment, a partir del documento ya validado. */
export function parametrosRpc(d, { huellaDocumento = huella(d) } = {}) {
  return {
    p_business_id: d.comercio.id,
    p_environment: d.destino === 'production' ? 'production' : 'test',
    p_customer_id: d.comprador.cliente_taba_id,
    p_items: d.compra.items.map((item) => ({ product_id: item.producto_id, quantity: item.cantidad })),
    p_amount: d.compra.importe_ars,
    p_concept: d.compra.concepto,
    p_seller_collector_id: String(d.vendedor.collector_id),
    p_seller_holder: d.vendedor.titular,
    p_buyer_account: d.comprador.cuenta_mercado_pago,
    p_fee_bearer: d.comisiones.las_asume === 'vendedor' ? 'seller' : 'integrator',
    p_refund_plan: d.devolucion.via === 'api' ? 'api' : 'seller_panel',
    p_abort_conditions: d.abortar_si,
    p_authorized_by: `${d.autoriza.nombre} (${d.autoriza.cargo})`,
    p_authorization_sha256: huellaDocumento,
    p_valid_minutes: d.vigencia_minutos,
  };
}
