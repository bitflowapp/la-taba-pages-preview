/*
 * PREFLIGHT del cobro real controlado: no mueve dinero, no crea operaciones financieras y se puede repetir las veces
 * que haga falta. Esta parte es pura: recibe lo que el CLI leyó (con la llave de servicio, sin credenciales ni datos del
 * pagador) y devuelve las comprobaciones. Lo que no se puede leer de la base (identidad de la integradora, firma del
 * webhook, llave final, respaldo) queda como MANUAL con el comando exacto que lo comprueba.
 */
import { classifyMercadoPago } from '../../controlled-production/ops-pulse.mjs';

const check = (id, estado, titulo, detalle = '') => ({ id, estado, titulo, detalle });
const centavos = (valor) => Math.round(Number(valor) * 100);
const DIA = 86_400_000;

/**
 * @param entrada { target, registro?: {status}, ahora: number, settings, conexion, estadoPiloto, sesionesAbiertas,
 *                  intencionesEntorno, discrepanciasAbiertas, mp: {outbox,intents,refunds,receipts}, productos?, documento? }
 */
export function evaluarPreflight(entrada) {
  const { target, registro, ahora, settings, conexion, estadoPiloto, sesionesAbiertas = 0, intencionesEntorno = 0,
    discrepanciasAbiertas = 0, mp = {}, productos, documento } = entrada;
  const entorno = target === 'production' ? 'production' : 'test';
  const out = [];

  if (target === 'production') {
    const listo = ['provisioned', 'active'].includes(registro?.status);
    out.push(check('entorno_registrado', listo ? 'PASS' : 'FAIL', 'Producción está en el registro de entornos',
      listo ? `estado ${registro.status}` : `estado ${registro?.status ?? 'sin registro'}: producción no existe todavía (PRODUCTION_NOT_PROVISIONED)`));
  } else {
    out.push(check('entorno_registrado', 'PASS', 'QA: proyecto de prueba con dinero ficticio', 'sin dinero real'));
  }

  const conectado = conexion?.status === 'connected' && conexion.environment === entorno
    && settings?.collector_id && String(conexion.seller_id) === String(settings.collector_id)
    && String(conexion.application_id) === String(settings.application_id);
  out.push(check('vendedor_conectado', conectado ? 'PASS' : 'FAIL', 'El vendedor está conectado y es el configurado en el comercio',
    conectado ? `vendedor ${conexion.seller_id}` : `conexión ${conexion?.status ?? 'ninguna'}; cobrador configurado ${settings?.collector_id ?? '—'}`));
  if (documento) {
    const coincide = String(documento.vendedor.collector_id) === String(settings?.collector_id);
    out.push(check('vendedor_es_el_autorizado', coincide ? 'PASS' : 'FAIL', 'El vendedor conectado es el que figura en la autorización',
      `autorizado ${documento.vendedor.collector_id}; conectado ${settings?.collector_id ?? '—'}`));
  }

  if (conexion?.expires_at) {
    const dias = (Date.parse(conexion.expires_at) - ahora) / DIA;
    out.push(check('credencial_vigente', dias >= 7 ? 'PASS' : 'FAIL', 'La credencial del vendedor no vence pronto',
      `vence en ${Math.floor(dias)} días${dias < 30 && dias >= 7 ? ' (se renueva sola con el refresh)' : ''}`));
  }

  out.push(check('interruptor_del_comercio', 'INFO', 'Interruptor de Mercado Pago del comercio',
    `${settings?.enabled ? 'ENCENDIDO' : 'apagado'} · entorno ${settings?.environment ?? '—'} · revisión ${settings?.production_review_status ?? '—'}`));
  if (target === 'production') {
    out.push(check('revision_productiva', settings?.production_review_status === 'approved' ? 'PASS' : 'FAIL',
      'La revisión productiva está aprobada (sin ella nada se cobra)', settings?.production_review_status ?? 'sin estado'));
  }
  out.push(check('entorno_del_comercio', settings?.environment === entorno ? 'PASS' : 'FAIL',
    'El comercio cobra en el entorno de este destino', `comercio: ${settings?.environment ?? '—'}; destino: ${entorno}`));

  out.push(check('candado_del_piloto', estadoPiloto?.pilot_lock_applies === true ? 'PASS' : 'FAIL',
    'El comercio está en modo piloto cerrado (el público no puede pagar)',
    `alcance: ${estadoPiloto?.scope ?? 'desconocido'}${estadoPiloto?.pilot_lock_applies === true ? '' : ' — abierto al público o sin candado'}`));
  const autorizaciones = estadoPiloto?.authorizations ?? [];
  const abiertas = autorizaciones.filter((a) => a.status === 'authorized');
  out.push(check('sin_autorizacion_abierta', abiertas.length === 0 ? 'PASS' : 'FAIL',
    'No queda una autorización anterior abierta', abiertas.length ? `abierta: ${abiertas[0].id} hasta ${abiertas[0].expires_at}` : ''));
  out.push(check('sin_compras_en_curso', sesionesAbiertas === 0 ? 'PASS' : 'FAIL',
    'No hay compras en curso (reservas activas)', `sesiones de pago abiertas: ${sesionesAbiertas}`));
  out.push(check('pagos_previos', intencionesEntorno === 0 ? 'PASS' : 'INFO', 'Pagos ya registrados en este entorno',
    intencionesEntorno === 0 ? 'ninguno: la compra de control será la primera' : `${intencionesEntorno} intención(es) de pago previas`));

  const clasificacion = classifyMercadoPago({ settings: settings ? [settings] : [], connections: conexion ? [conexion] : [], ...mp }, ahora);
  const avisos = clasificacion.warn.filter((w) => !w.startsWith('MP_SELLER_TOKEN_EXPIRING'));
  out.push(check('cola_y_conciliacion', avisos.length === 0 && discrepanciasAbiertas === 0 ? 'PASS' : 'FAIL',
    'Cola de pagos sana y ninguna discrepancia abierta', avisos.length || discrepanciasAbiertas
      ? `${avisos.join(', ')}${discrepanciasAbiertas ? ` · discrepancias abiertas: ${discrepanciasAbiertas}` : ''}` : 'sin avisos'));

  if (documento && productos) {
    let total = 0;
    const problemas = [];
    for (const item of documento.compra.items) {
      const p = productos.find((x) => x.id.toLowerCase() === item.producto_id.toLowerCase());
      if (!p) { problemas.push(`${item.sku}: no existe en el comercio`); continue; }
      if (p.sku !== item.sku) problemas.push(`${item.sku}: el SKU del catálogo es ${p.sku}`);
      if (!p.is_active || !p.available || p.price_status !== 'confirmed') problemas.push(`${item.sku}: no está a la venta con precio confirmado`);
      if (p.is_alcoholic) problemas.push(`${item.sku}: es alcohol (el piloto no pasa por la verificación de edad)`);
      if ((p.stock ?? 0) < item.cantidad) problemas.push(`${item.sku}: stock ${p.stock} < ${item.cantidad}`);
      total += centavos(p.price) * item.cantidad;
    }
    if (total !== centavos(documento.compra.importe_ars)) problemas.push(`el catálogo suma ${total / 100}, la autorización dice ${documento.compra.importe_ars}`);
    out.push(check('producto_de_la_prueba', problemas.length === 0 ? 'PASS' : 'FAIL',
      'El producto o concepto de la prueba existe, tiene stock y suma el importe autorizado',
      problemas.join('; ') || `suma ${total / 100} ARS`));
  }

  const manual = (id, titulo, detalle) => out.push(check(id, 'MANUAL', titulo, detalle));
  manual('integradora_distinta_del_vendedor', 'La integradora es una cuenta distinta del vendedor (dueña real en producción)',
    `node scripts/mercadopago/asistente-activacion.mjs integradora --target ${target === 'production' ? 'production' : 'qa'}`);
  manual('red_y_webhook', 'Sitio, redirección OAuth, webhook y CORS',
    `node scripts/mercadopago/asistente-activacion.mjs red --target ${target === 'production' ? 'production' : 'qa'}   (y webhook-firma --confirm <ref>)`);
  manual('configuracion_y_llave_final', 'Secretos y llave final en el estado esperado',
    `node scripts/mercadopago/verificar-configuracion.mjs --ref=${target === 'production' ? 'produccion --esperado=production' : 'qa'}`);
  manual('respaldo_reciente', 'Respaldo de menos de 26 h y restauración ensayada', 'node scripts/recovery/backup-freshness.mjs   ·   docs/audit/commercial-readiness-20261023/RESPALDOS-Y-RECUPERACION.md');
  manual('reversion_lista', 'Los 7 niveles de reversión están a mano', 'node scripts/mercadopago/asistente-activacion.mjs reversion --business <uuid> --slug <slug>');

  const fallas = out.filter((c) => c.estado === 'FAIL');
  return { ok: fallas.length === 0, fallas: fallas.length, manual: out.filter((c) => c.estado === 'MANUAL').length, checks: out };
}

export function imprimirPreflight({ checks, ok, fallas, manual }, escribir = console.log) {
  for (const c of checks) escribir(`${c.estado.padEnd(6)} ${c.titulo}${c.detalle ? `\n       ${c.detalle}` : ''}`);
  escribir(`\nPREFLIGHT: ${ok ? 'sin bloqueos' : `${fallas} BLOQUEO(S)`} · ${manual} comprobación(es) manual(es) · no se movió dinero ni se creó ninguna operación`);
}
