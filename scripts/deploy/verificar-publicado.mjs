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
 *   node scripts/deploy/verificar-publicado.mjs --esperar-runtime <cacheName>
 *   node scripts/deploy/verificar-publicado.mjs --host https://otra.pages.dev
 *
 * Con `--esperar-commit` o `--esperar-runtime` CONSULTA HASTA QUE CONVERJA:
 * ver `esperarConvergencia` más abajo para por qué, y para qué se reintenta y
 * qué no. `--intervalo-ms` y `--timeout-ms` ajustan la espera; el techo existe
 * siempre, y vencerlo es un fallo real.
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

export async function verificar({
  host = HOST_POR_DEFECTO,
  esperarCommit = null,
  esperarRuntime = null,
  buscar = fetch,
} = {}) {
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

  /*
   * El commit y el runtime se comprueban por separado a propósito. El commit
   * dice QUÉ código se construyó; el runtime es el nombre de la caché del
   * service worker, o sea lo que decide si al visitante le llega la versión
   * nueva o la que ya tenía guardada. Un artefacto con el commit correcto y el
   * runtime viejo se publica sin que nadie lo note y no invalida ninguna caché.
   */
  if (esperarRuntime && version?.runtime) {
    revisiones.push(version.runtime === esperarRuntime
      ? ok('el runtime publicado es el esperado', version.runtime)
      : mal('el runtime publicado es el esperado', `publicado ${version.runtime}, esperado ${esperarRuntime}`));
  } else if (esperarRuntime) {
    revisiones.push(mal('el runtime publicado es el esperado', 'el sitio no publica version.json: no se puede comprobar'));
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

/*
 * LO QUE UNA PROPAGACIÓN PUEDE CAUSAR — Y SÓLO ESO — SE REINTENTA.
 *
 * Cloudflare Pages sube el deployment y RECIÉN DESPUÉS mueve el alias de
 * producción. En el medio —segundos— `la-taba.pages.dev` sigue sirviendo el
 * despliegue anterior, entero y coherente consigo mismo. El 2026-08-27 el
 * smoke corrió un segundo después de publicar, leyó `31c900b` esperando
 * `820ad4e`, y dejó en rojo un despliegue que estaba perfectamente bien.
 *
 * La cura NO es dormir un rato fijo. Nadie sabe cuánto tarda, y un número
 * generoso paga el peor caso en CADA release para cubrir el que casi nunca
 * pasa. Se consulta hasta que converja, con techo.
 *
 * Y se reintenta SÓLO esto. Un runtime-config apuntando a staging, un catálogo
 * que no contesta o un shell que no llega no mejoran esperando: son defectos, y
 * gastar el timeout en ellos nada más retrasa el rojo. Ésos fallan en el primer
 * intento. Es la diferencia entre esperar una propagación y tapar un error.
 */
const REINTENTABLES = new Set([
  'version.json publicado',
  'el commit publicado es el esperado',
  'el runtime publicado es el esperado',
  // Las dos mitades del sello pueden llegar desfasadas mientras el borde
  // cambia: version.json ya nuevo y sw.js todavía viejo, o al revés.
  'el worker coincide con version.json',
]);

const DORMIR = (ms) => new Promise((listo) => { setTimeout(listo, ms); });

/**
 * Consulta hasta que producción publique lo esperado, o hasta que se venza el
 * techo. Devuelve lo mismo que `verificar()` más `intentos`, `transcurridoMs` y
 * `agotado`. NUNCA devuelve `sano: true` por haberse cansado: si al vencer el
 * plazo producción sigue vieja, eso baja como fallo.
 */
export async function esperarConvergencia({
  host = HOST_POR_DEFECTO,
  esperarCommit = null,
  esperarRuntime = null,
  intervaloMs = 5_000,
  timeoutMs = 180_000,
  buscar = fetch,
  dormir = DORMIR,
  ahora = () => Date.now(),
  registrar = () => {},
} = {}) {
  const arranque = ahora();
  let intento = 0;

  for (;;) {
    intento += 1;
    const resultado = await verificar({ host, esperarCommit, esperarRuntime, buscar });
    const transcurridoMs = ahora() - arranque;
    const fallidas = resultado.revisiones.filter((r) => !r.pasa);

    registrar({
      intento,
      transcurridoMs,
      commitObservado: resultado.version?.commit ?? null,
      commitEsperado: esperarCommit,
      runtimeObservado: resultado.version?.runtime ?? null,
      runtimeEsperado: esperarRuntime,
      fallidas: fallidas.map((r) => r.nombre),
    });

    const cerrar = (agotado) => ({ ...resultado, intentos: intento, transcurridoMs, agotado });
    if (resultado.sano) return cerrar(false);

    // Un defecto que esperar no arregla: rojo ya, sin gastar el plazo.
    if (fallidas.some((r) => !REINTENTABLES.has(r.nombre))) return cerrar(false);

    // Sin margen para otra vuelta completa, esta fue la última palabra.
    if (transcurridoMs + intervaloMs >= timeoutMs) return cerrar(true);

    await dormir(intervaloMs);
  }
}

function argumento(nombre) {
  const i = process.argv.indexOf(nombre);
  return i === -1 ? null : process.argv[i + 1];
}

function numero(nombre, porDefecto) {
  const crudo = argumento(nombre);
  if (crudo === null) return porDefecto;
  const valor = Number(crudo);
  if (!Number.isFinite(valor) || valor <= 0) {
    console.error(`${nombre} tiene que ser un número de milisegundos mayor que cero, y llegó "${crudo}"`);
    process.exit(2);
  }
  return valor;
}

const segundos = (ms) => `${(Math.round(ms / 100) / 10).toFixed(1)}s`;

const invocadoDirectamente = process.argv[1]?.endsWith('verificar-publicado.mjs');
if (invocadoDirectamente) {
  const host = argumento('--host') || process.env.TABA_PUBLIC_ORIGIN || HOST_POR_DEFECTO;
  const esperarCommit = argumento('--esperar-commit') || null;
  const esperarRuntime = argumento('--esperar-runtime') || null;
  const intervaloMs = numero('--intervalo-ms', 5_000);
  const timeoutMs = numero('--timeout-ms', 180_000);

  // Sin nada que esperar no hay nada que reintentar: mirar qué hay publicado
  // tiene que contestar de una, como siempre.
  const espera = Boolean(esperarCommit || esperarRuntime);

  console.log(`TIENDA PUBLICADA · ${host}\n`);
  if (espera) {
    console.log(`  esperando  commit ${esperarCommit?.slice(0, 7) ?? '—'} · runtime ${esperarRuntime ?? '—'}`);
    console.log(`  hasta      ${segundos(timeoutMs)}, consultando cada ${segundos(intervaloMs)}\n`);
  }

  const registrar = ({ intento, transcurridoMs, commitObservado, runtimeObservado, fallidas }) => {
    console.log(
      `  intento ${String(intento).padStart(2)} · ${segundos(transcurridoMs).padStart(6)}`
      + ` · publicado ${commitObservado?.slice(0, 7) ?? '(sin sello)'} / ${runtimeObservado ?? '(sin sello)'}`
      + (fallidas.length ? ` · falta: ${fallidas.join(', ')}` : ' · converge'),
    );
  };

  const resultado = espera
    ? await esperarConvergencia({ host, esperarCommit, esperarRuntime, intervaloMs, timeoutMs, registrar })
    : { ...(await verificar({ host })), intentos: 1, transcurridoMs: 0, agotado: false };

  const { revisiones, version, sano, intentos, transcurridoMs, agotado } = resultado;
  if (espera) console.log('');
  for (const { nombre, pasa, detalle } of revisiones) {
    console.log(`  ${pasa ? 'OK  ' : 'MAL '} ${nombre}${detalle ? ` · ${detalle}` : ''}`);
  }
  if (version) {
    console.log('\n  commit publicado   ', version.commit);
    console.log('  runtime publicado  ', version.runtime);
    console.log('  construido         ', version.builtAt);
  }
  if (espera) {
    console.log(`\n  intentos            ${intentos} en ${segundos(transcurridoMs)}`);
  }
  if (agotado) {
    console.log(
      `\nPRODUCCIÓN NO CONVERGIÓ en ${segundos(timeoutMs)}.`
      + ` Sigue publicando ${version?.commit?.slice(0, 7) ?? 'algo sin sello'}`
      + ` cuando se esperaba ${esperarCommit?.slice(0, 7) ?? esperarRuntime}.`,
    );
  }
  console.log(`\n${sano ? 'PUBLICADO Y SANO' : 'PUBLICADO CON PROBLEMAS'}`);
  process.exit(sano ? 0 : 1);
}
