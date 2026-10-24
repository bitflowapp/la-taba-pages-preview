/*
 * La sonda del planificador, entera y en un solo lugar.
 *
 * QUÉ REPARA
 * ----------
 * El flujo `scheduler-watchdog.yml` resolvía la configuración y hacía la
 * consulta dentro de un bloque de shell. Dos consecuencias, las dos medidas:
 *
 *   1. Llevaba 133 corridas fallando —cada diez minutos, desde hacía días— con
 *      un único mensaje: «Falta configurar SUPABASE_URL (variable) o
 *      SUPABASE_ANON_KEY (secreto)». La «o» es el problema: no decía CUÁL de
 *      las dos faltaba, así que quien fuera a arreglarlo tenía que adivinar
 *      entre una variable y un secreto, que se cargan en pantallas distintas.
 *
 *   2. Nada de eso se podía probar. El resto del camino tiene pruebas; este
 *      tramo no, y es el que decide si el vigía existe.
 *
 * DE DÓNDE SALE LA CONFIGURACIÓN
 * ------------------------------
 * Por orden, y diciendo siempre cuál usó:
 *
 *   1. `SUPABASE_URL` y `SUPABASE_ANON_KEY` del entorno —la variable y el
 *      secreto del repositorio—. Es la fuente explícita y gana siempre.
 *   2. El `runtime-config.js` que el sitio publicado ya le entrega a CUALQUIER
 *      navegador que lo visite.
 *
 * El segundo camino no es un atajo ni afloja nada. Esa clave es publicable por
 * diseño: viaja en el JavaScript de la tienda y la autoridad real es RLS, no la
 * clave. Leerla de ahí tiene además dos propiedades que el secreto no tiene: no
 * puede quedar desincronizada de la que produccion usa de verdad, y no hay nada
 * que provisionar para que el vigía empiece a existir. Comprobado contra el
 * servidor real: la RPC responde 200 con esa clave.
 *
 * Lo que NO hace: pedir `service_role`. La sonda sólo lee un reloj; un monitor
 * que se lleva la llave del administrador para mirar la hora es una superficie
 * de ataque a cambio de nada.
 *
 * LA CLAVE NO SE IMPRIME. Ni entera, ni en un error, ni en el volcado de una
 * respuesta. Publicable no es lo mismo que «da igual dónde quede».
 *
 *   node scripts/scheduler-watchdog-probe.mjs
 *
 * Salida 0 = el barrido corre al día. 1 = incidente, o no se pudo saber.
 */
import process from 'node:process';

import { productionTarget, readEnvironments, retiredRefs } from './lib/environments.mjs';
import { report } from './scheduler-watchdog-report.mjs';

const ORIGEN_PUBLICO_POR_DEFECTO = 'https://la-taba.pages.dev';
const TIEMPO_LIMITE_MS = 20_000;

/** Un valor de entorno sólo cuenta si trae algo que no sea espacio. */
function delEntorno(entorno, nombre) {
  const valor = (entorno[nombre] ?? '').trim();
  return valor === '' ? null : valor;
}

/**
 * La configuración publicada por el sitio, que es la que recibe el navegador.
 * Devuelve null si no se pudo leer: quien llama decide si eso es fatal.
 */
export async function configDelSitioPublicado(origen, buscar = fetch) {
  let cuerpo;
  try {
    const respuesta = await buscar(`${origen}/runtime-config.js`, { redirect: 'follow' });
    if (!respuesta.ok) return null;
    cuerpo = await respuesta.text();
  } catch {
    return null;
  }
  const url = cuerpo.match(/supabaseUrl:\s*'([^']+)'/)?.[1];
  const clave = cuerpo.match(/publishableKey:\s*'([^']+)'/)?.[1];
  if (!url || !clave) return null;
  return { url, clave };
}

/**
 * Resuelve la configuración y dice de dónde salió.
 * @returns {Promise<{url: string, clave: string, origen: string} | {faltan: string[]}>}
 */
export async function resolverConfiguracion({ entorno = process.env, buscar = fetch } = {}) {
  const url = delEntorno(entorno, 'SUPABASE_URL');
  const clave = delEntorno(entorno, 'SUPABASE_ANON_KEY');
  if (url && clave) return { url, clave, origen: 'variable y secreto del repositorio' };

  const publicado = await configDelSitioPublicado(
    delEntorno(entorno, 'TABA_PUBLIC_ORIGIN') || ORIGEN_PUBLICO_POR_DEFECTO,
    buscar,
  );
  if (publicado) {
    return {
      url: url || publicado.url,
      clave: clave || publicado.clave,
      origen: 'runtime-config.js del sitio publicado',
    };
  }

  // Nombrar lo que falta, una por una: la variable y el secreto se cargan en
  // pantallas distintas de GitHub y «o» obliga a adivinar.
  const faltan = [];
  if (!url) faltan.push('SUPABASE_URL');
  if (!clave) faltan.push('SUPABASE_ANON_KEY');
  return { faltan };
}

/** Le pregunta al servidor por su propio reloj. */
export async function consultar({ url, clave, buscar = fetch, limiteMs = TIEMPO_LIMITE_MS }) {
  const reloj = new AbortController();
  const corte = setTimeout(() => reloj.abort(), limiteMs);
  try {
    const respuesta = await buscar(`${url}/rest/v1/rpc/check_scheduler_watchdog`, {
      method: 'POST',
      signal: reloj.signal,
      headers: {
        apikey: clave,
        Authorization: `Bearer ${clave}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_source: 'github_actions' }),
    });
    const cuerpo = await respuesta.text();
    if (!respuesta.ok) {
      return { fallo: `el servidor contestó ${respuesta.status}`, cuerpo };
    }
    return { cuerpo };
  } catch (error) {
    // `AbortError` es el plazo vencido; cualquier otra cosa es red caída.
    const motivo = error?.name === 'AbortError'
      ? `no contestó en ${Math.round(limiteMs / 1000)} s`
      : `no se pudo llegar al servidor (${error?.code || error?.name || 'error de red'})`;
    return { fallo: motivo };
  }
}

/** Todo junto: configuración, consulta y veredicto. Nunca imprime la clave. */
export async function sondear({ entorno = process.env, buscar = fetch, limiteMs = TIEMPO_LIMITE_MS } = {}) {
  const configuracion = await resolverConfiguracion({ entorno, buscar });
  if (configuracion.faltan) {
    return {
      lineas: [
        ...configuracion.faltan.map((nombre) => `::error::WATCHDOG CONFIGURATION MISSING: ${nombre}`),
        '',
        '  Se resuelve de dos maneras, y con cualquiera alcanza:',
        '',
        '    · cargando en el repositorio la variable SUPABASE_URL y el secreto',
        '      SUPABASE_ANON_KEY (Settings → Secrets and variables → Actions);',
        '    · o dejando que el sitio publicado sirva su runtime-config.js, de',
        '      donde esta sonda los lee sola. Ahora mismo no se pudo leer.',
        '',
        '  La clave es la publicable, la misma que el navegador ya recibe.',
        '  NO se necesita service_role: la sonda sólo lee un reloj.',
      ],
      sano: false,
    };
  }

  const { cuerpo, fallo } = await consultar({ ...configuracion, buscar, limiteMs });
  if (fallo) {
    return {
      lineas: [
        `configuración   ${configuracion.origen}`,
        `::error::La sonda no pudo preguntar: ${fallo}. No se puede saber si el barrido corre.`,
      ],
      sano: false,
    };
  }

  const { lines, healthy } = report(cuerpo);
  return { lineas: [`configuración   ${configuracion.origen}`, ...lines], sano: healthy };
}

/**
 * El vigía de PRODUCCIÓN, atado a deploy/environments.json.
 *
 * Del 21 al 23/10/2026 corrió y falló en cada pasada: leía el runtime-config de
 * la-taba.pages.dev, que apunta a un proyecto de Supabase que ya no existe, y
 * GitHub mandaba un correo por corrida. Un vigía que grita siempre se deja de
 * leer el día que importa.
 *
 *   · producción sin proyecto (`not_provisioned`): no hay barrido que vigilar.
 *     Sale 0 con un aviso, y si el sitio publicado apunta a un proyecto
 *     retirado lo dice, para que no se pierda de vista;
 *   · producción con proyecto: la sonda pregunta al proyecto del registro, y es
 *     incidente que el sitio publicado o la variable del repositorio apunten a
 *     otro lado.
 */
export async function vigiaDeProduccion({ registro = readEnvironments(), entorno = process.env, buscar = fetch, limiteMs = TIEMPO_LIMITE_MS } = {}) {
  const origen = delEntorno(entorno, 'TABA_PUBLIC_ORIGIN') || registro.environments.production.web.origin || ORIGEN_PUBLICO_POR_DEFECTO;
  const publicado = await configDelSitioPublicado(origen, buscar);
  const refPublicado = publicado?.url.match(/^https:\/\/([a-z]{20})\.supabase\.co\/?$/)?.[1] || null;

  if (registro.environments.production.status === 'not_provisioned') {
    const lineas = [
      '::warning::Producción todavía no tiene proyecto de Supabase (deploy/environments.json): no hay barrido que vigilar. El vigía queda en espera y se activa solo con el binding de producción.',
    ];
    if (refPublicado && retiredRefs(registro).has(refPublicado)) {
      lineas.push(`::warning::${origen} sigue publicando una tienda que apunta al proyecto retirado ${refPublicado}: retirarla o reemplazarla antes de cualquier difusión.`);
    }
    return { lineas, sano: true, enEspera: true };
  }

  const produccion = productionTarget({ registry: registro, allowProvisioned: true });
  const explicita = delEntorno(entorno, 'SUPABASE_URL');
  if (explicita && explicita.replace(/\/$/, '') !== produccion.supabaseUrl) {
    return { lineas: [`::error::La variable SUPABASE_URL del repositorio apunta a ${explicita}, no al proyecto de producción del registro (${produccion.ref}).`], sano: false };
  }
  const resultado = await sondear({ entorno: { ...entorno, SUPABASE_URL: produccion.supabaseUrl }, buscar, limiteMs });
  if (publicado && refPublicado !== produccion.ref) {
    return {
      lineas: [...resultado.lineas, `::error::${origen} publica una tienda que apunta a ${publicado.url}, no al proyecto de producción del registro (${produccion.ref}).`],
      sano: false,
    };
  }
  return resultado;
}

const invocadoDirectamente = process.argv[1]?.endsWith('scheduler-watchdog-probe.mjs');
if (invocadoDirectamente) {
  const { lineas, sano } = await vigiaDeProduccion();
  for (const linea of lineas) console.log(linea);
  process.exit(sano ? 0 : 1);
}
