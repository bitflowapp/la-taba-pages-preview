#!/usr/bin/env node
/*
 * TABA — LA TIENDA SE PRUEBA A SÍ MISMA, DE PUNTA A PUNTA, CON UN SOLO COMANDO.
 *
 * Recepción → publicación → cliente → checkout → pedido → Panel → preparación →
 * repartidor → seguimiento → llegada → PIN → entregado → stock N-1 → reabrir
 * todo y comprobar que sobrevivió.
 *
 * NADIE OPERA UNA PANTALLA MIENTRAS ESTO CORRE. No se pide un Enter, no se
 * espera un «listo», no se pide una contraseña, no se pide copiar un PIN y no
 * se pide cambiar al teléfono. La corrida termina sola: PASS, FAIL o BLOCKED.
 *
 * LA ÚNICA COSA QUE UNA PERSONA TIENE QUE DECIR
 * ---------------------------------------------
 * Cuántas botellas hay realmente sobre el mostrador, y sólo cuando hay que
 * recibir mercadería. Eso no se puede medir por software y no se inventa:
 * `atestacion-fisica.mjs` exige las dos declaraciones que tienen que coincidir.
 *
 *   $env:TABA2_E2E_PHYSICAL_QTY="6"
 *   $env:TABA2_E2E_PHYSICAL_CONFIRMATION="I_CONFIRM_6_PHYSICAL_UNITS_EXIST"
 *   $env:TABA2_PRODUCTION_SALE_E2E="I_AUTHORIZE_ONE_REAL_PRODUCTION_ORDER"
 *   npm run e2e:production-sale:auto -- --production --create-real-order `
 *       --confirmado-por-humano --auto
 *
 * Sin las cuatro llaves de autorización esto es un ENSAYO: mide, valida,
 * comprueba las sesiones y no crea ningún pedido ni carga ningún stock.
 *
 * QUÉ NO PUEDE HACER, POR CONSTRUCCIÓN
 * ------------------------------------
 * Escribir en PostgreSQL. La única puerta a la base es `db-solo-lectura.mjs`,
 * que rechaza todo lo que no sea un SELECT. Cada efecto de esta prueba lo
 * produce un botón de la aplicación; la base sólo se lee, para comprobar que el
 * botón hizo lo que dijo.
 */
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PRODUCCION, PRODUCTO_AUTORIZADO, RIDER } from './contrato.mjs';
import { evaluarAtestacion, leerAtestacionFisica } from './atestacion-fisica.mjs';
import { consultar, lit } from './db-solo-lectura.mjs';
import { construirReporte, crearEvidencia } from './evidencia.mjs';
import {
  evaluarAutorizacion, evaluarConcurrencia, evaluarNegocio, evaluarRider, primerBloqueo,
} from './guards.mjs';
import {
  IDENTIDAD_PANEL, NEGOCIO_ID, correoDelPanel, evaluarRolDelPanel,
} from './identidades.mjs';
import { CASOS, ETAPAS, decidirPlan, describirPlan, stockEsperadoAntesDeVender } from './maquina-de-estado.mjs';
import { cerrarLock, generarRunId, leerLock, tomarLock } from './lock.mjs';
import { esperarEnLaVitrina, leerMovimientos, leerProducto, publicarEnTienda, recibirMercaderia } from './panel-mercaderia.mjs';
import { inspeccionarRider } from './precheck.mjs';
import { asegurarSesionCliente, asegurarSesionPanel, guardarEstado } from './sesiones.mjs';
import { ejecutarVentaReal } from './venta-real.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const banderas = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')[0]));

const pasos = [];
const tiempos = {};
const anotarPaso = (nombre, estado, detalle = '') => {
  pasos.push({ nombre, estado, detalle });
  return estado === 'PASS';
};

const runId = generarRunId();
const evidencia = crearEvidencia(runId, { raiz: RAIZ });
const autorizacion = evaluarAutorizacion({ flags: banderas, env: process.env });
const modo = autorizacion.ok ? 'AUTOMÁTICO — VENTA REAL' : 'AUTOMÁTICO — ENSAYO (no escribe nada)';
const puedeAprovisionar = autorizacion.ok || banderas.has('aprovisionar');

let salida = 2;
let navegador = null;
let planDeLaCorrida = null;
let lockTomado = false;
let resultadoFinal = { ok: false, codigo: 'SIN_EJECUTAR' };

console.log(`\nTABA — PRUEBA AUTOMÁTICA DE VENTA REAL · ${runId}`);
console.log(`modo: ${modo}`);
if (!autorizacion.ok) console.log(`  (${autorizacion.codigo}: ${autorizacion.mensaje})`);
console.log('');

try {
  evidencia.hito('inicio', modo);

  // ══ 1 · Nada empieza con una corrida anterior sin cerrar ═══════════════════
  const lockPrevio = leerLock(RAIZ);
  const concurrencia = evaluarConcurrencia({ lockPrevio });

  // ══ 2 · La fotografía, en sólo lectura ════════════════════════════════════
  const inicio = Date.now();
  const [negocio] = await consultar(`select id::text as id, name, status, is_active, ordering_enabled,
      ordering_verified, delivery_enabled, alcohol_sales_enabled, hours_enforced,
      delivery_fee::text as delivery_fee, minimum_delivery_subtotal::text as minimo
    from public.businesses where id = ${lit(NEGOCIO_ID)}`);
  const producto = await leerProducto();
  const abiertos = await consultar(`select public_code, status, created_at::text as created_at
    from public.orders where status not in ('delivered','cancelled','canceled','rejected') order by created_at`);
  const [panelMiembro] = await consultar(`select bm.role, bm.is_active, bm.user_id::text as user_id
    from public.business_members bm join auth.users u on u.id = bm.user_id
    where bm.business_id = ${lit(NEGOCIO_ID)} and lower(u.email) = ${lit(correoDelPanel())}`);
  const [riderMiembro] = await consultar(`select bm.user_id::text as user_id, u.email
    from public.business_members bm join auth.users u on u.id = bm.user_id
    where bm.business_id = ${lit(NEGOCIO_ID)} and bm.role = 'rider' and bm.is_active
    order by bm.created_at limit 1`);
  /*
   * EL CUPO DEL REPARTIDOR, QUE ES LO QUE DE VERDAD DECIDE SI UN PEDIDO VIEJO
   * ESTORBA. LT-0001 quedó `on_the_way` y durante un tiempo se lo trató como un
   * bloqueo: no lo es. Un repartidor lleva hasta tres entregas a la vez, y todo
   * este harness correlaciona por código de pedido, así que un viaje ajeno
   * abierto no le hace perder el suyo. Lo que sí bloquearía es quedarse SIN
   * cupo.
   *
   * Se CUENTA acá y se DECIDE en el Panel: quien manda es la opción del selector
   * de repartidores, que el propio Panel deshabilita cuando no hay lugar, y
   * `ofrecerAlRepartidor` la respeta. Preguntarle el máximo a la base habría
   * sido invocar una función desde el runner de sólo lectura —que la rechaza,
   * con razón: no distingue una que devuelve 3 de una que escribe—.
   */
  const [cupo] = riderMiembro
    ? await consultar(`select count(*)::int as activos from public.orders o
        where o.assigned_rider_user_id = ${lit(riderMiembro.user_id)}
          and o.status in ('assigned','picked_up','on_the_way','arrived','arriving')`)
    : [{ activos: null }];
  const telefono = inspeccionarRider();
  tiempos.precheck = Date.now() - inicio;
  evidencia.hito('precheck', `stock ${producto?.stock} · publicado ${producto?.available}`);

  // ══ 3 · La atestación física y el plan ════════════════════════════════════
  const atestacion = leerAtestacionFisica(process.env);
  const plan = decidirPlan({ producto, lockPrevio, atestacion });
  planDeLaCorrida = plan;

  console.log('── Precheck ──');
  console.log(`  comercio ....... ${negocio?.name} · ${negocio?.status} · pedidos ${negocio?.ordering_enabled ? 'abiertos' : 'CERRADOS'} · alcohol ${negocio?.alcohol_sales_enabled}`);
  console.log(`  producto ....... ${producto?.name} · stock ${producto?.stock} · publicado ${producto?.available} · $${producto?.price}`);
  console.log(`  pedidos vivos .. ${abiertos.length}${abiertos.length ? ` (${abiertos.map((p) => `${p.public_code}:${p.status}`).join(', ')})` : ''}`);
  console.log(`  identidad panel  ${panelMiembro ? `${correoDelPanel()} · rol ${panelMiembro.role} · activa=${panelMiembro.is_active}` : 'NO EXISTE — falta el alta'}`);
  console.log(`  repartidor ..... ${riderMiembro ? riderMiembro.email : 'sin repartidor activo'} · entregas activas ${cupo.activos ?? '?'}/${RIDER.maximoDeEntregasActivas} · teléfono ${telefono.dispositivoConectado ? `conectado (${telefono.paquete} ${telefono.version || ''}, batería ${telefono.bateria ?? '?'}%)` : 'AUSENTE en adb'}`);
  console.log(`  atestación ..... ${atestacion.ok ? `${atestacion.cantidad} unidad(es)` : atestacion.mensaje}`);
  console.log(`  plan ........... ${describirPlan(plan)}`);
  console.log('');

  // ══ 4 · Las compuertas ════════════════════════════════════════════════════
  const compuertas = {
    concurrencia,
    plan: plan.bloqueo || { ok: true, codigo: null, mensaje: '' },
    negocio: evaluarNegocio(negocio),
    atestacion: evaluarAtestacion(atestacion, { hace_falta: plan.requiereAtestacion }),
    identidadPanel: evaluarRolDelPanel(panelMiembro?.is_active ? panelMiembro.role : ''),
    repartidor: evaluarRider({
      miembroActivo: Boolean(riderMiembro),
      paquete: telefono.paquete,
      dispositivoConectado: telefono.dispositivoConectado,
    }),
    cupoDelRepartidor: Number(cupo.activos) < RIDER.maximoDeEntregasActivas
      ? { ok: true, codigo: null, mensaje: '' }
      : {
        ok: false,
        codigo: 'RIDER_SIN_CUPO',
        mensaje: `el repartidor lleva ${cupo.activos} de ${RIDER.maximoDeEntregasActivas} entregas activas: cerrá una antes de la prueba`,
      },
  };
  for (const [nombre, resultado] of Object.entries(compuertas)) {
    console.log(`  ${resultado.ok ? 'OK  ' : 'MAL '} ${nombre}${resultado.ok ? '' : ` · ${resultado.codigo}: ${resultado.mensaje}`}`);
  }
  const bloqueo = primerBloqueo(Object.values(compuertas));
  anotarPaso('Precheck', bloqueo.ok ? 'PASS' : 'BLOCKED', bloqueo.ok ? describirPlan(plan) : `${bloqueo.codigo}: ${bloqueo.mensaje}`);

  evidencia.guardarJson('precheck.json', {
    runId,
    modo,
    generadoUtc: new Date().toISOString(),
    negocio,
    producto,
    pedidosAbiertos: abiertos,
    identidadPanel: panelMiembro || null,
    repartidor: { miembro: riderMiembro || null, telefono, cupo },
    atestacion: { ok: atestacion.ok, cantidad: atestacion.cantidad, mensaje: atestacion.mensaje },
    plan: { caso: plan.caso, etapas: plan.etapas, motivo: plan.motivo, cantidadARecibir: plan.cantidadARecibir ?? null },
    compuertas,
  });

  /*
   * UN ENSAYO NO SE DETIENE EN EL PRIMER PROBLEMA.
   *
   * Cuando no hay autorización para comprar, lo útil no es el primer bloqueo:
   * es la lista completa de lo que falta, en una sola corrida. Así quien vuelve
   * a intentarlo resuelve todo junto en vez de descubrir el siguiente obstáculo
   * después de cada arreglo. La corrida REAL sí se planta en el primero: ahí
   * seguir sería empezar a escribir con una compuerta cerrada.
   */
  const bloqueosDelEnsayo = Object.entries(compuertas)
    .filter(([, resultado]) => !resultado.ok)
    .map(([nombre, resultado]) => `${nombre}: ${resultado.codigo}`);

  if (!bloqueo.ok && autorizacion.ok) {
    resultadoFinal = { ok: false, codigo: bloqueo.codigo, mensaje: bloqueo.mensaje, bloqueada: true };
  } else {
    // ══ 5 · Las sesiones, sin que nadie las inicie ══════════════════════════
    navegador = await chromium.launch();
    evidencia.anotar('abriendo las sesiones guardadas');

    let sesionPanel = null;
    let sesionCliente = null;
    try {
      sesionPanel = await asegurarSesionPanel({ navegador, raiz: RAIZ, anotar: evidencia.anotar });
      anotarPaso('Business auth', 'PASS', sesionPanel.reingresada ? 'sesión renovada con la credencial guardada' : 'sesión guardada reutilizada');
    } catch (error) {
      anotarPaso('Business auth', 'BLOCKED', `${error.codigo || 'SESION'}: ${String(error.message).slice(0, 180)}`);
      if (autorizacion.ok) throw Object.assign(new Error(error.message), { codigo: error.codigo || 'AUTH_BUSINESS' });
      bloqueosDelEnsayo.push(`sesionPanel: ${error.codigo || 'AUTH_BUSINESS'}`);
    }

    try {
      /*
       * Fabricar el cliente ESCRIBE en producción —una identidad anónima, un
       * perfil y una dirección—. En un ensayo eso no puede pasar sin permiso:
       * o hay sesión guardada, o se pide `--aprovisionar`.
       */
      sesionCliente = await asegurarSesionCliente({
        navegador, raiz: RAIZ, anotar: evidencia.anotar, permitirFabricar: puedeAprovisionar,
      });
      anotarPaso('Customer auth', 'PASS', sesionCliente.rehecha
        ? `cliente de prueba fabricado (dirección ${String(sesionCliente.direccionId).slice(0, 8)}…)`
        : 'sesión guardada reutilizada');
    } catch (error) {
      anotarPaso('Customer auth', 'BLOCKED', `${error.codigo || 'SESION'}: ${String(error.message).slice(0, 180)}`);
      if (autorizacion.ok) throw Object.assign(new Error(error.message), { codigo: error.codigo || 'AUTH_CUSTOMER' });
      bloqueosDelEnsayo.push(`sesionCliente: ${error.codigo || 'AUTH_CUSTOMER'}`);
    }

    evidencia.hito('sesiones listas');

    // ══ 6 · El ensayo termina acá ═══════════════════════════════════════════
    if (!autorizacion.ok) {
      for (const nombre of ['Reception', 'Publication', 'Customer cart', 'Checkout', 'Order created',
        'Business intake', 'Accepted', 'Preparing', 'Ready', 'Rider offered', 'Rider accepted',
        'Picked up', 'On the way', 'Tracking', 'Arrived', 'PIN', 'Delivered', 'Stock N-1', 'Persistence']) {
        anotarPaso(nombre, 'SKIP', 'ensayo');
      }
      resultadoFinal = bloqueosDelEnsayo.length
        ? {
          ok: false,
          ensayo: true,
          bloqueada: true,
          codigo: bloqueosDelEnsayo.length === 1 ? bloqueosDelEnsayo[0].split(': ')[1] : 'VARIOS',
          faltantes: bloqueosDelEnsayo,
          mensaje: `faltan ${bloqueosDelEnsayo.length}: ${bloqueosDelEnsayo.join(' · ')}`,
        }
        : { ok: true, ensayo: true, plan: plan.caso };
    } else {
      // ══ 7 · De acá para abajo se escribe de verdad ════════════════════════
      tomarLock({ runId, modo, raiz: RAIZ });
      lockTomado = true;

      const stockInicial = Number(producto.stock);
      const stockEsperado = stockEsperadoAntesDeVender({ plan, stockActual: stockInicial });

      if (plan.etapas.includes(ETAPAS.RECEPCION)) {
        evidencia.anotar(`recepción física atestiguada: ${plan.cantidadARecibir} unidad(es)`);
        const recepcion = await recibirMercaderia(sesionPanel.pagina, {
          cantidad: plan.cantidadARecibir,
          referencia: `E2E ${runId}`,
          evidencia,
        });
        evidencia.hito('recepción', `${recepcion.stockAntes} → ${recepcion.stockDespues}`);
        evidencia.guardarJson('recepcion.json', recepcion);
        anotarPaso('Reception', 'PASS', `${recepcion.stockAntes} → ${recepcion.stockDespues} · 1 movimiento`);
      } else {
        anotarPaso('Reception', 'SKIP', `${plan.caso}: el stock ya estaba cargado, no se recibe de nuevo`);
      }

      if (plan.etapas.includes(ETAPAS.PUBLICACION)) {
        const publicacion = await publicarEnTienda(sesionPanel.pagina, { evidencia });
        evidencia.hito('publicación', publicacion.yaEstaba ? 'ya estaba publicado' : 'publicado');
        anotarPaso('Publication', 'PASS', publicacion.yaEstaba ? 'ya estaba publicado' : `publicado con stock ${publicacion.stock}`);
        const enVitrina = await esperarEnLaVitrina(sesionCliente.pagina, { host: PRODUCCION.host });
        if (!enVitrina) {
          throw Object.assign(new Error('el producto se publicó pero la tienda no lo muestra'), { codigo: 'NO_LLEGA_A_LA_VITRINA' });
        }
      } else {
        anotarPaso('Publication', 'SKIP', `${plan.caso}: ya estaba publicado`);
      }

      const productoAntesDeVender = await leerProducto();
      if (Number(productoAntesDeVender.stock) !== stockEsperado) {
        throw Object.assign(
          new Error(`antes de vender el stock tenía que ser ${stockEsperado} y es ${productoAntesDeVender.stock}`),
          { codigo: 'P0_STOCK_ANTES_DE_VENDER' },
        );
      }

      resultadoFinal = await ejecutarVentaReal({
        runId,
        evidencia,
        anotarPaso,
        tiempos,
        host: PRODUCCION.host,
        producto: PRODUCTO_AUTORIZADO,
        navegador,
        contextoCliente: sesionCliente.contexto,
        contextoPanel: sesionPanel.contexto,
        cliente: sesionCliente.pagina,
        panel: sesionPanel.pagina,
        direccionId: sesionCliente.direccionId,
        stockAntes: stockEsperado,
        riderUserId: riderMiembro?.user_id || '',
        rutaSesionCliente: sesionCliente.rutaEstado,
        rutaSesionPanel: sesionPanel.rutaEstado,
      });
      evidencia.hito('venta', resultadoFinal.ok ? `PASS ${resultadoFinal.codigo || ''}` : `FAIL ${resultadoFinal.codigo}`);

      const movimientos = await leerMovimientos(producto.id);
      evidencia.guardarJson('inventario.json', {
        stockInicial, stockEsperadoAntesDeVender: stockEsperado, movimientos: movimientos.slice(0, 10),
      });
    }

    // Las sesiones se vuelven a guardar SIEMPRE: el refresh token rotó.
    for (const sesion of [sesionPanel, sesionCliente]) {
      if (sesion?.contexto) await guardarEstado(sesion.contexto, sesion.rutaEstado).catch(() => {});
    }
  }
} catch (error) {
  const codigo = error?.codigo || 'EXCEPCION';
  console.error(`\n${autorizacion.ok ? 'EXCEPCIÓN' : 'ENSAYO DETENIDO'}: ${String(error?.message || error).slice(0, 400)}`);
  /*
   * En un ensayo nadie escribió nada, así que quedarse sin sesión no es una
   * falla del producto: es un aprovisionamiento que falta. Se informa como
   * BLOCKED, que es lo que un ensayo puede decir con honestidad.
   */
  const esBloqueo = !autorizacion.ok && !lockTomado;
  anotarPaso('Ejecución', esBloqueo ? 'BLOCKED' : 'FAIL', `${codigo}: ${String(error?.message || error).slice(0, 180)}`);
  resultadoFinal = {
    ok: false, codigo, mensaje: String(error?.message || error).slice(0, 400), bloqueada: esBloqueo,
  };
} finally {
  await navegador?.close().catch(() => {});
}

// ══ 8 · El informe ══════════════════════════════════════════════════════════
const resumen = (() => {
  if (resultadoFinal.ensayo && resultadoFinal.ok) return 'PRODUCTION SALE E2E — DRY RUN GREEN';
  if (resultadoFinal.ensayo) {
    return `PRODUCTION SALE E2E — DRY RUN BLOCKED · ${(resultadoFinal.faltantes || []).join(' · ') || resultadoFinal.codigo}`;
  }
  if (resultadoFinal.bloqueada) return `PRODUCTION SALE E2E — BLOCKED · ${resultadoFinal.codigo}`;
  if (resultadoFinal.ok) return 'PRODUCTION SALE E2E — PASS';
  return `PRODUCTION SALE E2E — FAIL · ${resultadoFinal.codigo}`;
})();

const reporte = construirReporte({ runId, pasos, tiempos, modo, resumen });
evidencia.guardarTexto('report.md', reporte.markdown);
evidencia.guardarJson('result.json', { runId, modo, resumen, pasos, tiempos, resultado: resultadoFinal });
evidencia.volcarRegistro();
console.log(`\n${reporte.texto}\n`);
console.log(`evidencia: ${evidencia.directorio}`);

if (lockTomado) cerrarLock({ runId, estado: resultadoFinal.ok ? 'ok' : 'fallido', raiz: RAIZ });
if (lockTomado && !resultadoFinal.ok) {
  console.error('\nEl lock quedó puesto a propósito: mirá el pedido de esta corrida antes de volver a correr.');
}

if (resultadoFinal.ok) salida = 0;
else salida = resultadoFinal.bloqueada ? 2 : 1;

if (resultadoFinal.ensayo && Array.isArray(resultadoFinal.faltantes)) {
  console.log('\nPara que el ensayo dé verde falta:');
  for (const faltante of resultadoFinal.faltantes) console.log(`  · ${faltante}`);
}

console.log(`\nteléfono: ${RIDER.serie} · paquete ${RIDER.paquete}`);
console.log(`identidad del Panel: ${IDENTIDAD_PANEL.nombreHumano} <${correoDelPanel()}> · rol ${IDENTIDAD_PANEL.rol}`);

if (resultadoFinal.ensayo) {
  const hayQueRecibir = planDeLaCorrida?.caso === CASOS.RECIBIR_PUBLICAR_VENDER;
  console.log('\nPara la corrida REAL (crea UN pedido de producción):');
  if (hayQueRecibir) {
    console.log('  $env:TABA2_E2E_PHYSICAL_QTY="<las unidades que contaste>"');
    console.log('  $env:TABA2_E2E_PHYSICAL_CONFIRMATION="I_CONFIRM_<esas mismas>_PHYSICAL_UNITS_EXIST"');
  }
  console.log('  $env:TABA2_PRODUCTION_SALE_E2E="I_AUTHORIZE_ONE_REAL_PRODUCTION_ORDER"');
  console.log('  npm run e2e:production-sale:auto -- --production --create-real-order --confirmado-por-humano --auto');
}

process.exit(salida);
