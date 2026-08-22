/*
 * TABA — PRUEBA DE VENTA REAL, DE PUNTA A PUNTA.
 *
 * Compra UN producto en la tienda publicada, lo procesa desde el Panel, lo
 * entrega con el teléfono del repartidor y comprueba que el stock bajó
 * exactamente uno. Todo por las MISMAS superficies que usa una persona: nada
 * de escribir estados en la base.
 *
 * La base se usa sólo para mirar (db-solo-lectura.mjs no puede hacer otra
 * cosa) y para dos preguntas: cómo estaba antes y cómo quedó después. Si el
 * flujo real no produjo el efecto esperado, eso es una falla del producto y se
 * reporta como tal; el harness no repara nada.
 *
 *   node scripts/e2e-production-sale/index.mjs                 (ensayo, no compra)
 *   node scripts/e2e-production-sale/index.mjs --production \
 *        --create-real-order --confirmado-por-humano           (compra UNA vez)
 *
 * El modo real exige además TABA2_PRODUCTION_SALE_E2E en el entorno. Las cuatro
 * llaves juntas, o no hay pedido.
 */
import process from 'node:process';
import { direccionPermitida, PRODUCCION, PRODUCTO_AUTORIZADO } from './contrato.mjs';
import { construirReporte, crearEvidencia } from './evidencia.mjs';
import { evaluarAutorizacion, evaluarConcurrencia, primerBloqueo } from './guards.mjs';
import { cerrarLock, generarRunId, leerLock, tomarLock } from './lock.mjs';
import { correrPrecheck } from './precheck.mjs';

const banderas = new Set();
for (const argumento of process.argv.slice(2)) {
  if (argumento.startsWith('--')) banderas.add(argumento.slice(2).split('=')[0]);
}

const pasos = [];
const tiempos = {};
const anotarPaso = (nombre, estado, detalle = '') => {
  pasos.push({ nombre, estado, detalle });
  return estado === 'PASS';
};

const autorizacion = evaluarAutorizacion({ flags: banderas, env: process.env });
const modo = autorizacion.ok ? 'VENTA REAL' : 'ENSAYO (no crea pedido)';
const runId = generarRunId();
const evidencia = crearEvidencia(runId);

console.log(`\nTABA PRODUCTION SALE E2E · ${runId}`);
console.log(`modo: ${modo}`);
if (!autorizacion.ok) console.log(`  (${autorizacion.codigo}: ${autorizacion.mensaje})`);
console.log('');

// ── Concurrencia: una corrida sin cerrar frena la próxima ────────────────────
const lockPrevio = leerLock();
const concurrencia = evaluarConcurrencia({ lockPrevio });
if (!concurrencia.ok) {
  anotarPaso('Precheck', 'BLOCKED', concurrencia.mensaje);
  const { texto } = construirReporte({ runId, pasos, tiempos, modo, resumen: `PRODUCTION SALE E2E BLOCKED · ${concurrencia.codigo}` });
  console.log(`\n${texto}\n`);
  process.exit(2);
}

// ── Precheck ─────────────────────────────────────────────────────────────────
const inicio = Date.now();
const precheck = await correrPrecheck();
tiempos.precheck = Date.now() - inicio;

const compuertas = precheck.compuertas;
const bloqueoPrecheck = primerBloqueo(Object.values(compuertas));

console.log('── Precheck ──');
console.log(`  comercio ....... ${precheck.negocio?.name} · ${precheck.negocio?.status} · pedidos ${precheck.negocio?.ordering_enabled ? 'abiertos' : 'CERRADOS'} · alcohol ${precheck.negocio?.alcohol_sales_enabled}`);
console.log(`  producto ....... ${precheck.producto?.name} · stock ${precheck.producto?.stock} · publicado ${precheck.producto?.available} · $${precheck.producto?.price}`);
console.log(`  catálogo ....... ${precheck.conteos?.visibles} visibles · ${precheck.conteos?.pedidos_totales} pedido(s) · ${precheck.conteos?.pedidos_abiertos} abierto(s)`);
console.log(`  repartidor ..... dispositivo ${precheck.rider?.dispositivoConectado ? 'conectado' : 'AUSENTE'} · ${precheck.rider?.paquete || 'sin paquete'} ${precheck.rider?.version || ''} · batería ${precheck.rider?.bateria ?? '?'}%`);
console.log(`  sesión cliente . ${precheck.sesiones.customer.existe ? `guardada hace ${precheck.sesiones.customer.edadHoras}h · verificada=${precheck.sesiones.customer.verificada}` : 'FALTA'}`);
console.log(`  sesión panel ... ${precheck.sesiones.business.existe ? `guardada hace ${precheck.sesiones.business.edadHoras}h · verificada=${precheck.sesiones.business.verificada}` : 'FALTA'}`);
console.log(`  dirección ...... ${direccionPermitida().descripcionEsperada || 'SIN CONFIGURAR'}`);
for (const [nombre, resultado] of Object.entries(compuertas)) {
  console.log(`  ${resultado.ok ? 'OK  ' : 'MAL '} ${nombre}${resultado.ok ? '' : ` · ${resultado.codigo}: ${resultado.mensaje}`}`);
}

evidencia.guardarJson('precheck.json', {
  runId,
  modo,
  generadoUtc: new Date().toISOString(),
  negocio: precheck.negocio,
  producto: precheck.producto,
  conteos: precheck.conteos,
  pedidosAbiertos: precheck.pedidosAbiertos,
  rider: precheck.rider,
  sesiones: precheck.sesiones,
  stockBefore: precheck.stockBefore,
  compuertas,
});

anotarPaso('Precheck', bloqueoPrecheck.ok ? 'PASS' : 'BLOCKED', bloqueoPrecheck.ok ? `stock_before=${precheck.stockBefore}` : `${bloqueoPrecheck.codigo}: ${bloqueoPrecheck.mensaje}`);

// ── El ensayo termina acá: informa y no compra ───────────────────────────────
if (!autorizacion.ok) {
  const listo = bloqueoPrecheck.ok;
  for (const nombre of ['Customer cart', 'Checkout', 'Order created', 'Business intake', 'Accepted', 'Preparing',
    'Ready', 'Rider offered', 'Rider accepted', 'Picked up', 'Tracking', 'PIN', 'Delivered', 'Stock N-1', 'Persistence']) {
    anotarPaso(nombre, 'SKIP', 'ensayo');
  }
  const resumen = listo
    ? 'PRODUCTION SALE E2E — DRY RUN GREEN'
    : `PRODUCTION SALE E2E — DRY RUN BLOCKED · ${bloqueoPrecheck.codigo}`;
  const reporte = construirReporte({ runId, pasos, tiempos, modo, resumen });
  evidencia.guardarTexto('report.md', reporte.markdown);
  evidencia.guardarJson('result.json', { runId, modo, resumen, pasos, tiempos, stockBefore: precheck.stockBefore });
  evidencia.volcarRegistro();
  console.log(`\n${reporte.texto}\n`);
  console.log(`evidencia: ${evidencia.directorio}`);
  if (listo) {
    console.log('\nPara la corrida REAL (crea UN pedido de producción):');
    console.log('  $env:TABA2_PRODUCTION_SALE_E2E="I_AUTHORIZE_ONE_REAL_PRODUCTION_ORDER"');
    console.log('  npm run e2e:production-sale -- --production --create-real-order --confirmado-por-humano');
    console.log('  Remove-Item Env:\\TABA2_PRODUCTION_SALE_E2E');
  }
  process.exit(listo ? 0 : 2);
}

// ── De acá para abajo se compra de verdad ────────────────────────────────────
if (!bloqueoPrecheck.ok) {
  console.error(`\nNO SE CREA NINGÚN PEDIDO: ${bloqueoPrecheck.codigo} · ${bloqueoPrecheck.mensaje}`);
  const reporte = construirReporte({ runId, pasos, tiempos, modo, resumen: `PRODUCTION SALE E2E BLOCKED · ${bloqueoPrecheck.codigo}` });
  evidencia.guardarTexto('report.md', reporte.markdown);
  evidencia.volcarRegistro();
  process.exit(2);
}

tomarLock({ runId, modo });
try {
  const { ejecutarVentaReal } = await import('./venta-real.mjs');
  const resultado = await ejecutarVentaReal({
    runId,
    evidencia,
    precheck,
    anotarPaso,
    tiempos,
    host: PRODUCCION.host,
    producto: PRODUCTO_AUTORIZADO,
  });
  const reporte = construirReporte({
    runId, pasos, tiempos, modo,
    resumen: resultado.ok ? 'PRODUCTION SALE E2E PASS' : `PRODUCTION SALE E2E FAIL · ${resultado.codigo}`,
  });
  evidencia.guardarTexto('report.md', reporte.markdown);
  evidencia.guardarJson('result.json', { runId, modo, pasos, tiempos, ...resultado });
  evidencia.volcarRegistro();
  console.log(`\n${reporte.texto}\n`);
  cerrarLock({ runId, estado: resultado.ok ? 'ok' : 'fallido' });
  process.exit(resultado.ok ? 0 : 1);
} catch (error) {
  // Una excepción NO habilita reparar nada: se deja el lock puesto y se pide
  // que una persona mire qué quedó a medias.
  console.error(`\nEXCEPCIÓN: ${String(error.message || error).slice(0, 400)}`);
  anotarPaso('Ejecución', 'FAIL', 'excepción durante la venta');
  const reporte = construirReporte({ runId, pasos, tiempos, modo, resumen: 'PRODUCTION SALE E2E FAIL · EXCEPCION' });
  evidencia.guardarTexto('report.md', reporte.markdown);
  evidencia.volcarRegistro();
  cerrarLock({ runId, estado: 'excepcion' });
  console.error(`\nEl lock quedó puesto a propósito. Revisá ${evidencia.directorio} y el estado del pedido antes de volver a correr.`);
  process.exit(1);
}
