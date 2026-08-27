/*
 * ¿POR QUÉ TODAVÍA NO SE PUEDE COBRAR? UNA SOLA RESPUESTA, Y FALLA CERRADO.
 *
 * El estado comercial vivía repartido en seis comandos que hay que acordarse de
 * correr y saber leer. Esto los junta y contesta una sola cosa, con CUATRO
 * estados que NO son lo mismo:
 *
 *   COMMERCIAL NOT READY ..... hay algo roto, o falta infraestructura que se
 *                              puede desplegar hoy
 *   TECHNICALLY READY ........ el software y la infraestructura están; faltan
 *                              datos que sólo puede aportar una persona
 *   READY TO ENABLE PAYMENT .. está TODO cargado y verificado, y el interruptor
 *                              sigue apagado A PROPÓSITO, esperando autorización
 *   READY FOR REAL PAYMENT ... se puede cobrar de verdad, hoy
 *
 * El tercero existe para deshacer un abrazo mortal: encender el proveedor exige
 * haber probado, probar exigía el proveedor encendido, y la compuerta pedía el
 * proveedor encendido para dar verde. Separar «listo para encender» de «ya
 * encendido» rompe el círculo sin crear ninguna forma de cobrar antes de la
 * autorización explícita.
 *
 * FALLA CERRADO. Un chequeo que no se puede establecer cuenta como bloqueo,
 * nunca como aprobado: si no se pudo leer producción, la respuesta es NOT READY.
 *
 * NO LEE NINGÚN SECRETO. Del lado de Mercado Pago delega en
 * `scripts/mercadopago/verificar-configuracion.mjs`, que ya sabe contestar por
 * presencia y huella sin que ningún valor viaje.
 *
 *   npm run commercial:gate
 *   npm run commercial:gate -- --json
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { censar } from './censo-produccion.mjs';
import { consultar, lit } from '../e2e-production-sale/db-solo-lectura.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NEGOCIO = '00000000-0000-4000-8000-000000000001';
const HOST = process.env.TABA_PUBLIC_ORIGIN || 'https://la-taba.pages.dev';
const REF_PRODUCCION = 'wwcpogltfgzgkrlilbcd';
const REF_STAGING = 'ukxqbgswjlibmnjemrzd';

/**
 * Los desenlaces de un chequeo. La diferencia entre ellos es QUIÉN lo cierra, y
 * por eso son cuatro y no dos.
 *
 *   BLOQUEADO ............ algo roto, o infraestructura que falta y se puede
 *                          desplegar hoy. Lo cierra este equipo, programando.
 *   FALTA_DATO_HUMANO .... falta un dato que sólo una persona puede aportar.
 *   ESPERA_AUTORIZACION .. está TODO listo y el interruptor sigue apagado a
 *                          propósito. Lo cierra una decisión, no un trabajo.
 *   INFO ................. vale saberlo y no impide cobrar.
 */
export const OK = 'ok';
export const INFO = 'info';
export const FALTA_DATO_HUMANO = 'falta_dato_humano';
export const ESPERA_AUTORIZACION = 'espera_autorizacion';
export const BLOQUEADO = 'bloqueado';

const chequeo = (id, estado, detalle, quien = '') => ({ id, estado, detalle, quien });

/**
 * Decide el estado global. Pura, para poder probar los cuatro desenlaces sin
 * tocar producción.
 *
 * EL ORDEN NO ES ARBITRARIO. Va de lo que impide todo a lo que sólo espera una
 * firma: un bloqueo no se resuelve esperando una credencial, y una credencial
 * que falta no se resuelve autorizando nada.
 *
 * `INFO` no participa: si participara, doce productos a medio cargar impedirían
 * cobrar los treinta y tres que están completos, que es exactamente al revés de
 * lo que le conviene al negocio.
 */
export function veredicto(chequeos) {
  if (chequeos.some((c) => c.estado === BLOQUEADO)) return 'COMMERCIAL NOT READY';
  if (chequeos.some((c) => c.estado === FALTA_DATO_HUMANO)) return 'TECHNICALLY READY';
  if (chequeos.some((c) => c.estado === ESPERA_AUTORIZACION)) return 'READY TO ENABLE PAYMENT';
  return 'READY FOR REAL PAYMENT';
}

async function traer(url) {
  const respuesta = await fetch(url, { redirect: 'follow' });
  return { ok: respuesta.ok, estado: respuesta.status, cuerpo: respuesta.ok ? await respuesta.text() : '' };
}

/**
 * El veredicto de Mercado Pago, pedido a quien ya es la autoridad.
 *
 * Ese guion SALE CON CÓDIGO 1 cuando el veredicto es DISABLED —es su forma de
 * ser usable como compuerta— así que `execFileSync` lanza. Un lanzamiento acá NO
 * significa «no sé»: significa «contestó que no». Lo que importa es si en la
 * salida hay un veredicto legible; recién si no lo hay se cuenta como no saber.
 */
function veredictoMercadoPago() {
  let salida = '';
  let fallo = null;
  try {
    salida = execFileSync(
      process.execPath,
      [path.join(ROOT, 'scripts/mercadopago/verificar-configuracion.mjs'), '--ref=produccion'],
      { encoding: 'utf8', cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
    salida = String(error?.stdout || '');
    fallo = error;
  }
  const linea = salida.split('\n').find((l) => l.startsWith('VEREDICTO:')) || '';
  const dictamen = linea.replace('VEREDICTO:', '').trim();
  const activas = funcionesActivas(salida);
  if (!dictamen) {
    return { veredicto: 'DESCONOCIDO', activas: [], error: fallo?.message || 'sin veredicto en la salida' };
  }
  return { veredicto: dictamen, activas };
}

/*
 * LAS SIETE FUNCIONES, POR NOMBRE. NO «SIETE CUALESQUIERA».
 *
 * Contar no alcanza: cinco correctas y dos faltantes dan el mismo número que
 * cinco correctas más dos de otra cosa, y la que falte va a fallar recién cuando
 * alguien la necesite, con plata real de por medio.
 *
 * Las siete son obligatorias para declarar READY FOR REAL PAYMENT, incluidas
 * `refund` y `cancel-payment`. No es una precaución: el Panel del comercio
 * DIBUJA el control de devolución (`data-payment-refund-confirm`) y
 * `supabase_order_repository` invoca las dos funciones. Cobrar sin poder
 * devolver deja al dueño tocando un botón que falla, que es peor que no
 * ofrecerlo.
 *
 * `verificar-configuracion.mjs` las llama «opcionales» porque su veredicto
 * responde otra pregunta —si el proyecto PUEDE cobrar—. Para poder OPERAR hacen
 * falta las siete, y esa diferencia se decide acá.
 */
export const FUNCIONES_OBLIGATORIAS = Object.freeze([
  'mercadopago-create-checkout-session',
  'mercadopago-create-preference',
  'mercadopago-checkout-status',
  'mercadopago-webhook',
  'mercadopago-payment-worker',
  'mercadopago-refund',
  'mercadopago-cancel-payment',
]);

/**
 * Cuáles de la lista aparecen ACTIVE en la salida del verificador.
 *
 * Se compara por TOKEN exacto y no con una expresión regular armada por
 * interpolación: `mercadopago-refund` no puede contar por una línea de
 * `mercadopago-refund-v2` ni al revés, y partir la línea en palabras deja eso
 * fuera de discusión sin depender de cómo se escapó una barra invertida.
 */
export function funcionesActivas(salida, esperadas = FUNCIONES_OBLIGATORIAS) {
  const lineas = String(salida).split('\n');
  return esperadas.filter((nombre) => lineas.some((linea) => {
    const palabras = linea.trim().split(/\s+/);
    return palabras.includes(nombre) && palabras.includes('ACTIVE');
  }));
}

export async function correrCompuerta() {
  const chequeos = [];

  // ── 1 · el software publicado ──────────────────────────────────────────────
  let versionPublicada = null;
  try {
    const sello = await traer(`${HOST}/version.json`);
    const pareceHtml = /^\s*<(?:!doctype|html)/i.test(sello.cuerpo);
    versionPublicada = sello.ok && !pareceHtml ? JSON.parse(sello.cuerpo) : null;
    chequeos.push(versionPublicada
      ? chequeo('release', OK, `producción publica ${versionPublicada.commit.slice(0, 7)} · ${versionPublicada.runtime}`)
      : chequeo('release', BLOQUEADO, 'producción no publica un version.json legible'));
  } catch (error) {
    chequeos.push(chequeo('release', BLOQUEADO, `no se pudo leer version.json: ${error.message}`));
  }

  // ── 2 · el frontend apunta a producción, y a nada más ──────────────────────
  try {
    const config = await traer(`${HOST}/runtime-config.js`);
    const apuntaAProduccion = config.cuerpo.includes(REF_PRODUCCION);
    const apuntaAStaging = config.cuerpo.includes(REF_STAGING);
    const negocioCorrecto = config.cuerpo.includes(NEGOCIO);
    if (!config.ok) chequeos.push(chequeo('frontend', BLOQUEADO, `runtime-config HTTP ${config.estado}`));
    else if (apuntaAStaging) chequeos.push(chequeo('frontend', BLOQUEADO, 'el runtime-config publicado menciona el ref de STAGING'));
    else if (!apuntaAProduccion) chequeos.push(chequeo('frontend', BLOQUEADO, 'el runtime-config no apunta al Supabase de producción'));
    else if (!negocioCorrecto) chequeos.push(chequeo('frontend', BLOQUEADO, 'el runtime-config apunta a otro negocio'));
    else chequeos.push(chequeo('frontend', OK, 'apunta al Supabase y al negocio de producción, sin staging'));
  } catch (error) {
    chequeos.push(chequeo('frontend', BLOQUEADO, `no se pudo leer runtime-config: ${error.message}`));
  }

  // ── 3 · el catálogo ────────────────────────────────────────────────────────
  let censo = null;
  try {
    censo = await censar();
  } catch (error) {
    chequeos.push(chequeo('catalogo', BLOQUEADO, `no se pudo censar producción: ${error.message}`));
  }

  if (censo) {
    const comprables = censo.productos.filter((p) => p.comprable);
    chequeos.push(comprables.length > 0
      ? chequeo('catalogo', OK, `${comprables.length} producto(s) comprable(s) de ${censo.productos.length}`)
      : chequeo('catalogo', FALTA_DATO_HUMANO, 'no hay ningún producto comprable', 'el comercio: precio, stock y publicación'));

    /*
     * UN COMPRABLE SIN FOTO BLOQUEA; UNO OCULTO SIN FOTO, NO.
     *
     * La diferencia es si alguien lo ve. Un producto publicado sin imagen es un
     * hueco en la góndola que el cliente mira y toca, y arrancar a cobrar así es
     * una decisión que nadie tomó. Uno que no es comprable puede esperar su foto
     * todo lo que haga falta: nadie lo está mirando.
     *
     * Es una regla de ESTA compuerta y no de la comprabilidad del frontend: allá
     * la foto no impide vender, y cambiarlo tocaría el catálogo entero para
     * resolver una pregunta de arranque comercial.
     */
    const sinFoto = comprables.filter((p) => !p.conImagen);
    chequeos.push(sinFoto.length === 0
      ? chequeo('imagenes', OK, 'todos los comprables tienen foto')
      : chequeo('imagenes', BLOQUEADO,
        `${sinFoto.length} producto(s) COMPRABLE(S) sin image_url: el cliente los ve vacíos`));

    const precioRaro = comprables.filter((p) => !(Number(p.price) > 0) || p.price_status === 'pending');
    chequeos.push(precioRaro.length === 0
      ? chequeo('precios', OK, `${comprables.length} precio(s) confirmado(s) y mayores que cero`)
      : chequeo('precios', BLOQUEADO, `${precioRaro.length} comprable(s) con precio inválido o pendiente`));

    const sinStock = comprables.filter((p) => !(Number(p.stock) > 0));
    chequeos.push(sinStock.length === 0
      ? chequeo('stock', OK, 'ningún comprable quedó sin unidades')
      : chequeo('stock', BLOQUEADO, `${sinStock.length} comprable(s) publicado(s) con stock 0`));

    /*
     * UN PRODUCTO A MEDIO CARGAR NO IMPIDE VENDER LOS QUE ESTÁN COMPLETOS.
     *
     * Mientras siga sin ser comprable no le hace daño a nadie: no está en la
     * góndola y nadie puede ponerlo en el carrito. Exigir el catálogo entero
     * para empezar a cobrar sería atarle las manos al negocio por doce
     * productos que hoy no vende igual. Se informa, y no bloquea.
     *
     * Lo que SÍ bloquea es lo de más arriba: un producto COMPRABLE con precio,
     * stock o foto inválidos, porque ése el cliente lo ve y lo toca.
     */
    const incompletos = censo.productos.filter((p) => p.bucket === 'incompletos');
    const incompletoComprable = incompletos.filter((p) => p.comprable);
    if (incompletoComprable.length > 0) {
      chequeos.push(chequeo('catalogo_incompleto', BLOQUEADO,
        `${incompletoComprable.length} producto(s) incompleto(s) están comprables`));
    } else if (incompletos.length > 0) {
      chequeos.push(chequeo('catalogo_incompleto', INFO,
        `${incompletos.length} producto(s) esperan un dato del comercio, y ninguno es comprable`,
        'Walter, cuando quiera sumarlos: precio, stock o publicación'));
    } else {
      chequeos.push(chequeo('catalogo_incompleto', OK, 'no quedan productos a medio cargar'));
    }

    /*
     * EL ALCOHOL NO ES UN PENDIENTE: ES UNA COMPUERTA QUE TIENE QUE SEGUIR CERRADA.
     * Que esté apagado cuenta como OK, y que se hubiera encendido sin la
     * habilitación acreditada sería un bloqueo.
     */
    const alcoholComprable = censo.productos.filter((p) => p.is_alcoholic === true && p.comprable);
    if (censo.alcoholHabilitado || alcoholComprable.length > 0) {
      chequeos.push(chequeo('alcohol', BLOQUEADO,
        `alcohol_sales_enabled=${censo.alcoholHabilitado} y ${alcoholComprable.length} alcohólico(s) comprable(s): `
        + 'la habilitación de expendio no está acreditada en este repositorio'));
    } else {
      chequeos.push(chequeo('alcohol', OK, 'alcohol_sales_enabled=false y 0 alcohólicos comprables, como corresponde'));
    }

    const promosVivas = censo.combos.filter((c) => c.is_active === true && c.approval_status === 'approved');
    const promosPendientes = censo.combos.filter((c) => c.approval_status !== 'approved');
    chequeos.push(promosPendientes.length === 0
      ? chequeo('promociones', OK, `${promosVivas.length} promoción(es) aprobada(s), ninguna pendiente`)
      // Una promoción sin aprobar no está vigente: no cambia ningún precio ni
      // impide cobrar los productos sueltos.
      : chequeo('promociones', INFO,
        `${promosPendientes.length} promoción(es) esperan aprobación`, 'el comercio'));
  }

  // ── 4 · el negocio ─────────────────────────────────────────────────────────
  try {
    const [negocio] = await consultar(
      `select id, name from public.businesses where id = ${lit(NEGOCIO)}`,
    );
    chequeos.push(negocio
      ? chequeo('negocio', OK, `negocio canónico presente · ${negocio.name}`)
      : chequeo('negocio', BLOQUEADO, 'el negocio canónico no existe en producción'));
  } catch (error) {
    chequeos.push(chequeo('negocio', BLOQUEADO, `no se pudo leer el negocio: ${error.message}`));
  }

  // ── 5 · Mercado Pago ───────────────────────────────────────────────────────
  const mp = veredictoMercadoPago();
  if (mp.veredicto === 'PRODUCTION') {
    chequeos.push(chequeo('mercadopago', OK, 'configurado en modo PRODUCTION'));
  } else if (mp.veredicto === 'DISABLED') {
    chequeos.push(chequeo('mercadopago', FALTA_DATO_HUMANO,
      'DISABLED: faltan los secretos productivos',
      // La Public Key NO está en esta lista: se auditó el código y no se usa en
      // ningún lado. La integración es Checkout Pro por redirección a
      // `init_point`, así que el navegador nunca habla con el SDK de Mercado
      // Pago. Pedirla sería inventar un requisito.
      'Walter: Access Token, webhook secret, collector_id y application_id'));
  } else if (mp.veredicto === 'TEST') {
    chequeos.push(chequeo('mercadopago', FALTA_DATO_HUMANO,
      'en modo TEST: sirve para probar, no para cobrar', 'Walter: credenciales productivas'));
  } else {
    chequeos.push(chequeo('mercadopago', BLOQUEADO,
      `no se pudo establecer el estado de Mercado Pago${mp.error ? `: ${mp.error}` : ''}`));
  }
  /*
   * LAS FUNCIONES EDGE NO SON UN DATO HUMANO: SON INFRAESTRUCTURA NUESTRA.
   *
   * Se pueden desplegar SIN secretos y sin habilitar cobros, porque fallan
   * cerrado por contrato: `requireEnv` lanza «Missing required server
   * configuration» ante cualquier secreto ausente. Verificado el 2026-08-27
   * contra producción con las siete ya desplegadas: el webhook contesta
   * HTTP 503 `PAYMENT_UNAVAILABLE` y el veredicto sigue siendo DISABLED.
   *
   * Por eso que falten es un BLOQUEO técnico y no una espera: llamar
   * «technically ready» a un sistema al que le falta la infraestructura
   * productiva sería mentir sobre de quién es el trabajo pendiente.
   */
  const faltantes = FUNCIONES_OBLIGATORIAS.filter((nombre) => !mp.activas.includes(nombre));
  chequeos.push(faltantes.length === 0
    ? chequeo('mp_functions', OK, `las ${FUNCIONES_OBLIGATORIAS.length} funciones Edge obligatorias, ACTIVE`)
    : chequeo('mp_functions', BLOQUEADO,
      `faltan ${faltantes.length} función(es) Edge: ${faltantes.join(', ')}. `
      + 'Es infraestructura nuestra y se despliega sin secretos, porque falla cerrado'));

  // ── 6 · el comercio habilitado para cobrar ─────────────────────────────────
  try {
    const [pagos] = await consultar(`
      select count(*) total,
             count(*) filter (where enabled) habilitados,
             count(*) filter (where collector_id is not null and application_id is not null) completos
        from public.business_payment_settings where business_id = ${lit(NEGOCIO)}`);
    const habilitados = Number(pagos?.habilitados || 0);
    const completos = Number(pagos?.completos || 0);
    const total = Number(pagos?.total || 0);
    if (habilitados > 0) {
      chequeos.push(chequeo('proveedor_pago', OK, `${habilitados} proveedor(es) de pago en línea habilitado(s)`));
    } else if (completos > 0) {
      /*
       * Acá está todo cargado y el interruptor sigue apagado. NO es un
       * problema: es el paso donde el sistema espera una decisión humana. Que
       * tenga su propio estado es lo que permite decir «listo para encender»
       * sin haber encendido nada.
       */
      chequeos.push(chequeo('proveedor_pago', ESPERA_AUTORIZACION,
        `la configuración del comercio está completa y enabled = false`,
        'Walter: autorización explícita para empezar a cobrar'));
    } else {
      chequeos.push(chequeo('proveedor_pago', FALTA_DATO_HUMANO,
        `sin proveedor de pago en línea (${total} fila(s) cargada(s))`,
        'Walter: collector_id y application_id de su cuenta'));
    }
  } catch (error) {
    chequeos.push(chequeo('proveedor_pago', BLOQUEADO, `no se pudo leer business_payment_settings: ${error.message}`));
  }

  return { chequeos, veredicto: veredicto(chequeos), censo, versionPublicada };
}

if (process.argv[1]?.endsWith('compuerta-comercial.mjs')) {
  let resultado;
  try {
    resultado = await correrCompuerta();
  } catch (error) {
    // Hasta el fallo inesperado cierra: nunca se sale por verde sin saber.
    console.error('COMMERCIAL NOT READY');
    console.error(`  la compuerta no pudo correr entera: ${error.message}`);
    process.exit(1);
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ veredicto: resultado.veredicto, chequeos: resultado.chequeos }, null, 2));
  } else {
    const icono = {
      [OK]: 'OK    ', [INFO]: 'INFO  ', [FALTA_DATO_HUMANO]: 'FALTA ',
      [ESPERA_AUTORIZACION]: 'ESPERA', [BLOQUEADO]: 'BLOQUE',
    };
    console.log(`COMPUERTA COMERCIAL · ${HOST}\n`);
    for (const c of resultado.chequeos) {
      console.log(`  ${icono[c.estado]} ${c.id.padEnd(20)} ${c.detalle}`);
      if (c.quien) console.log(`         ${' '.repeat(20)} lo cierra → ${c.quien}`);
    }
    console.log('');
    console.log(`VEREDICTO: ${resultado.veredicto}`);
    if (resultado.veredicto === 'TECHNICALLY READY') {
      console.log('  El software está listo. Lo que falta no se programa: son datos');
      console.log('  que tiene que aportar una persona. Están listados arriba.');
    }
    if (resultado.veredicto === 'READY TO ENABLE PAYMENT') {
      console.log('  Todo cargado y verificado. El interruptor sigue apagado a propósito:');
      console.log('  encenderlo es una decisión, no una tarea. Ver la línea ESPERA.');
    }
    if (resultado.veredicto === 'COMMERCIAL NOT READY') {
      console.log('  Hay algo roto o que no se pudo establecer. Ver las líneas BLOQUE.');
    }
    const informativas = resultado.chequeos.filter((c) => c.estado === INFO).length;
    if (informativas) console.log(`  (${informativas} línea(s) INFO: se saben, y no impiden cobrar.)`);
  }

  process.exit(resultado.veredicto === 'READY FOR REAL PAYMENT' ? 0 : 1);
}
