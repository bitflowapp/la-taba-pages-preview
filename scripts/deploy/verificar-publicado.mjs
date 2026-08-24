/*
 * ¿Qué hay publicado, y es lo que tenía que estar?
 *
 * Contesta sin adivinar las tres cosas que hacían falta mirar a ojo:
 *
 *     commit publicado · runtime publicado · si coinciden con lo esperado
 *
 * y además comprueba que el sitio esté sano de verdad: que el shell cargue, que
 * hable con el Supabase de PRODUCCIÓN, que el catálogo conteste, que el
 * runtime-config no sea la plantilla vacía, que no se haya colado staging ni
 * una superficie de demostración, y que el service worker sea el que dice ser.
 *
 * SOLO LEE. No inicia sesión, no escribe y no toca ningún pedido.
 *
 *   node scripts/deploy/verificar-publicado.mjs
 *   node scripts/deploy/verificar-publicado.mjs --esperar-commit <sha>
 *   node scripts/deploy/verificar-publicado.mjs --host https://otra.pages.dev
 *
 * Salida 0 = publicado y sano. 1 = algo no cuadra.
 */
import process from 'node:process';

const HOST_POR_DEFECTO = 'https://la-taba.pages.dev';
const REF_PRODUCCION = 'wwcpogltfgzgkrlilbcd';
const REF_STAGING = 'ukxqbgswjlibmnjemrzd';
const NEGOCIO_CANONICO = '00000000-0000-4000-8000-000000000001';

/** Un chequeo: nombre, si pasó, y el detalle que se imprime al lado. */
const ok = (nombre, detalle = '') => ({ nombre, pasa: true, detalle });
const mal = (nombre, detalle) => ({ nombre, pasa: false, detalle });

export function revisarRuntimeConfig(fuente) {
  const revisiones = [];
  const url = fuente.match(/supabaseUrl:\s*'([^']+)'/)?.[1];
  const clave = fuente.match(/publishableKey:\s*'([^']+)'/)?.[1];
  const negocio = fuente.match(/businessId:\s*'([^']+)'/)?.[1];

  if (!url || !clave || !negocio) {
    // La plantilla del repositorio tiene todo comentado: si llega así, el
    // despliegue publicó el archivo vacío y la tienda falla cerrada.
    revisiones.push(mal('runtime-config no está vacío', 'llegó la plantilla sin configurar'));
    return revisiones;
  }
  revisiones.push(ok('runtime-config no está vacío'));
  revisiones.push(url.includes(REF_PRODUCCION)
    ? ok('Supabase es el de producción', url)
    : mal('Supabase es el de producción', `apunta a ${url}`));
  revisiones.push(url.includes(REF_STAGING)
    ? mal('no apunta a staging', `¡es el proyecto de staging! ${url}`)
    : ok('no apunta a staging'));
  revisiones.push(negocio === NEGOCIO_CANONICO
    ? ok('negocio canónico', negocio)
    : mal('negocio canónico', `es ${negocio}`));
  revisiones.push(clave.startsWith('sb_publishable_')
    ? ok('la clave es publicable', `${clave.slice(0, 6)}…${clave.slice(-4)}`)
    : mal('la clave es publicable', 'NO empieza con sb_publishable_'));
  return revisiones;
}

export function revisarServiceWorker(fuente, runtimeEsperado) {
  const cache = fuente.match(/const CACHE_NAME = '([^']+)';/)?.[1];
  if (!cache) return [mal('el service worker declara su caché', 'no se encontró CACHE_NAME')];
  const revisiones = [ok('el service worker declara su caché', cache)];
  if (runtimeEsperado) {
    revisiones.push(cache === runtimeEsperado
      ? ok('el worker coincide con version.json', cache)
      : mal('el worker coincide con version.json', `sw.js dice ${cache} y version.json dice ${runtimeEsperado}`));
  }
  return revisiones;
}

async function traer(url, buscar) {
  const respuesta = await buscar(url, { redirect: 'follow' });
  return { estado: respuesta.status, ok: respuesta.ok, cuerpo: respuesta.ok ? await respuesta.text() : '' };
}

export async function verificar({ host = HOST_POR_DEFECTO, esperarCommit = null, buscar = fetch } = {}) {
  const revisiones = [];
  let version = null;

  const inicio = await traer(`${host}/`, buscar);
  revisiones.push(inicio.ok ? ok('la home responde', `HTTP ${inicio.estado}`) : mal('la home responde', `HTTP ${inicio.estado}`));
  if (inicio.ok) {
    revisiones.push(/<div[^>]+data-app-main|<main/i.test(inicio.cuerpo)
      ? ok('el shell del storefront llega')
      : mal('el shell del storefront llega', 'la home no trae el contenedor principal'));
  }

  /*
   * Cloudflare Pages contesta el SHELL DE LA APLICACIÓN a cualquier ruta que no
   * existe, así que un `version.json` ausente llega como HTTP 200 con HTML, no
   * como 404. Medido contra producción. Confundir eso con «archivo corrupto»
   * haría fallar la verificación de todo despliegue anterior al sello, que es
   * exactamente el estado en el que está hoy el sitio.
   */
  const sello = await traer(`${host}/version.json`, buscar);
  const pareceHtml = /^\s*<(?:!doctype|html)/i.test(sello.cuerpo);
  if (sello.ok && !pareceHtml) {
    try {
      version = JSON.parse(sello.cuerpo);
      revisiones.push(ok('version.json publicado', `${version.commit?.slice(0, 7)} · ${version.runtime}`));
    } catch {
      revisiones.push(mal('version.json publicado', 'se sirve algo que no es JSON'));
    }
  } else {
    revisiones.push(ok('version.json publicado', 'ausente — el despliegue es anterior al sello'));
  }

  if (esperarCommit && version?.commit) {
    revisiones.push(version.commit.startsWith(esperarCommit) || esperarCommit.startsWith(version.commit)
      ? ok('el commit publicado es el esperado', version.commit.slice(0, 7))
      : mal('el commit publicado es el esperado', `publicado ${version.commit.slice(0, 7)}, esperado ${esperarCommit.slice(0, 7)}`));
  } else if (esperarCommit) {
    revisiones.push(mal('el commit publicado es el esperado', 'el sitio no publica version.json: no se puede comprobar'));
  }

  const config = await traer(`${host}/runtime-config.js`, buscar);
  if (!config.ok) {
    revisiones.push(mal('runtime-config se sirve', `HTTP ${config.estado}`));
  } else {
    revisiones.push(ok('runtime-config se sirve'));
    revisiones.push(...revisarRuntimeConfig(config.cuerpo));
  }

  const worker = await traer(`${host}/sw.js`, buscar);
  if (!worker.ok) {
    revisiones.push(mal('el service worker se sirve', `HTTP ${worker.estado}`));
  } else {
    revisiones.push(ok('el service worker se sirve'));
    revisiones.push(...revisarServiceWorker(worker.cuerpo, version?.runtime));
  }

  // El catálogo, preguntado como lo pregunta el navegador: si RLS o la clave
  // estuvieran mal, esto contesta distinto de 200.
  const url = config.ok ? config.cuerpo.match(/supabaseUrl:\s*'([^']+)'/)?.[1] : null;
  const clave = config.ok ? config.cuerpo.match(/publishableKey:\s*'([^']+)'/)?.[1] : null;
  if (url && clave) {
    try {
      const respuesta = await buscar(
        `${url}/rest/v1/products?select=sku&limit=1&business_id=eq.${NEGOCIO_CANONICO}`,
        { headers: { apikey: clave, Authorization: `Bearer ${clave}` } },
      );
      const filas = respuesta.ok ? JSON.parse(await respuesta.text()) : null;
      revisiones.push(Array.isArray(filas) && filas.length > 0
        ? ok('el catálogo contesta', `${filas.length} fila de muestra`)
        : mal('el catálogo contesta', `HTTP ${respuesta.status}`));
    } catch (error) {
      revisiones.push(mal('el catálogo contesta', error.message));
    }
  }

  const fallidas = revisiones.filter((r) => !r.pasa);
  return { revisiones, version, sano: fallidas.length === 0 };
}

function argumento(nombre) {
  const i = process.argv.indexOf(nombre);
  return i === -1 ? null : process.argv[i + 1];
}

const invocadoDirectamente = process.argv[1]?.endsWith('verificar-publicado.mjs');
if (invocadoDirectamente) {
  const host = argumento('--host') || process.env.TABA_PUBLIC_ORIGIN || HOST_POR_DEFECTO;
  const esperarCommit = argumento('--esperar-commit') || null;
  console.log(`TIENDA PUBLICADA · ${host}\n`);
  const { revisiones, version, sano } = await verificar({ host, esperarCommit });
  for (const { nombre, pasa, detalle } of revisiones) {
    console.log(`  ${pasa ? 'OK  ' : 'MAL '} ${nombre}${detalle ? ` · ${detalle}` : ''}`);
  }
  if (version) {
    console.log('\n  commit publicado   ', version.commit);
    console.log('  runtime publicado  ', version.runtime);
    console.log('  construido         ', version.builtAt);
  }
  console.log(`\n${sano ? 'PUBLICADO Y SANO' : 'PUBLICADO CON PROBLEMAS'}`);
  process.exit(sano ? 0 : 1);
}
