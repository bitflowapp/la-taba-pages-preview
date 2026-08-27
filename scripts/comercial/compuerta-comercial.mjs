/*
 * ¿POR QUÉ TODAVÍA NO SE PUEDE COBRAR? UNA SOLA RESPUESTA, Y FALLA CERRADO.
 *
 * El estado comercial vivía repartido en seis comandos que hay que acordarse de
 * correr y saber leer. Esto los junta y contesta una sola cosa, con tres
 * estados que NO son lo mismo:
 *
 *   READY FOR REAL PAYMENT ... se puede cobrar de verdad, hoy
 *   TECHNICALLY READY ........ el software está listo; faltan datos que sólo
 *                              puede aportar una persona (credenciales, precios)
 *   COMMERCIAL NOT READY ..... hay algo roto o desconocido del lado técnico
 *
 * La distinción existe porque «no está listo» esconde dos situaciones muy
 * distintas: una se arregla programando y la otra se arregla llamando a alguien.
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

/** Los tres desenlaces de un chequeo. El del medio es el que separa los estados. */
export const OK = 'ok';
export const FALTA_DATO_HUMANO = 'falta_dato_humano';
export const BLOQUEADO = 'bloqueado';

const chequeo = (id, estado, detalle, quien = '') => ({ id, estado, detalle, quien });

/**
 * Decide el estado global a partir de los chequeos. Pura, para poder probar los
 * tres desenlaces sin tocar producción.
 */
export function veredicto(chequeos) {
  if (chequeos.some((c) => c.estado === BLOQUEADO)) return 'COMMERCIAL NOT READY';
  if (chequeos.some((c) => c.estado === FALTA_DATO_HUMANO)) return 'TECHNICALLY READY';
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
  const desplegadas = (salida.match(/✓ mercadopago-/g) || []).length;
  if (!dictamen) return { veredicto: 'DESCONOCIDO', desplegadas: 0, error: fallo?.message || 'sin veredicto en la salida' };
  return { veredicto: dictamen, desplegadas };
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

    const sinFoto = comprables.filter((p) => !p.conImagen);
    chequeos.push(sinFoto.length === 0
      ? chequeo('imagenes', OK, 'todos los comprables tienen foto')
      : chequeo('imagenes', FALTA_DATO_HUMANO, `${sinFoto.length} comprable(s) sin foto`, 'quien cargue las fotos'));

    const precioRaro = comprables.filter((p) => !(Number(p.price) > 0) || p.price_status === 'pending');
    chequeos.push(precioRaro.length === 0
      ? chequeo('precios', OK, `${comprables.length} precio(s) confirmado(s) y mayores que cero`)
      : chequeo('precios', BLOQUEADO, `${precioRaro.length} comprable(s) con precio inválido o pendiente`));

    const sinStock = comprables.filter((p) => !(Number(p.stock) > 0));
    chequeos.push(sinStock.length === 0
      ? chequeo('stock', OK, 'ningún comprable quedó sin unidades')
      : chequeo('stock', BLOQUEADO, `${sinStock.length} comprable(s) publicado(s) con stock 0`));

    const incompletos = censo.productos.filter((p) => p.bucket === 'incompletos');
    chequeos.push(incompletos.length === 0
      ? chequeo('catalogo_incompleto', OK, 'no quedan productos a medio cargar')
      : chequeo('catalogo_incompleto', FALTA_DATO_HUMANO,
        `${incompletos.length} producto(s) esperan un dato del comercio`, 'Walter: precio, stock o publicación'));

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
      : chequeo('promociones', FALTA_DATO_HUMANO,
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
      'DISABLED: faltan los secretos productivos y las funciones desplegadas',
      'Walter: Access Token, Public Key, webhook secret, collector_id y application_id'));
  } else if (mp.veredicto === 'TEST') {
    chequeos.push(chequeo('mercadopago', FALTA_DATO_HUMANO,
      'en modo TEST: sirve para probar, no para cobrar', 'Walter: credenciales productivas'));
  } else {
    chequeos.push(chequeo('mercadopago', BLOQUEADO,
      `no se pudo establecer el estado de Mercado Pago${mp.error ? `: ${mp.error}` : ''}`));
  }
  chequeos.push(mp.desplegadas >= 5
    ? chequeo('mp_functions', OK, `${mp.desplegadas} función(es) Edge de Mercado Pago desplegada(s)`)
    : chequeo('mp_functions', FALTA_DATO_HUMANO,
      `${mp.desplegadas} de 5 funciones Edge obligatorias desplegadas`,
      'se despliegan recién con los secretos productivos cargados'));

  // ── 6 · el comercio habilitado para cobrar ─────────────────────────────────
  try {
    const [pagos] = await consultar(`
      select count(*) total,
             count(*) filter (where enabled) habilitados,
             count(*) filter (where collector_id is not null) con_collector
        from public.business_payment_settings where business_id = ${lit(NEGOCIO)}`);
    const habilitados = Number(pagos?.habilitados || 0);
    chequeos.push(habilitados > 0
      ? chequeo('proveedor_pago', OK, `${habilitados} proveedor(es) de pago en línea habilitado(s)`)
      : chequeo('proveedor_pago', FALTA_DATO_HUMANO,
        `sin proveedor de pago en línea (${Number(pagos?.total || 0)} fila(s) cargada(s))`,
        'Walter: collector_id y application_id de su cuenta'));
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
    const icono = { [OK]: 'OK    ', [FALTA_DATO_HUMANO]: 'FALTA ', [BLOQUEADO]: 'BLOQUE' };
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
    if (resultado.veredicto === 'COMMERCIAL NOT READY') {
      console.log('  Hay algo roto o que no se pudo establecer. Ver las líneas BLOQUE.');
    }
  }

  process.exit(resultado.veredicto === 'READY FOR REAL PAYMENT' ? 0 : 1);
}
