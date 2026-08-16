// Lee la respuesta de `check_scheduler_watchdog` y decide si hay incidente.
//
// Vivia como un `python3 -c '…'` incrustado en el YAML del flujo. Funcionaba
// -en el runner de Ubuntu hay python3- pero era la unica pieza del camino de
// release que no corre con el runtime del repositorio, y por estar dentro de un
// bloque YAML con comillas escapadas no habia forma de ejercitarla: un error de
// parseo se descubria cuando el reloj externo fallara, que es justo cuando hace
// falta que ande.
//
// Acá es un modulo con pruebas. La decision no cambia: la condicion la mide el
// servidor contra su base, este proceso solo la lee y la reporta.
//
//   stdin  el JSON que devuelve la RPC
//   exit 0 el barrido corre al dia
//   exit 1 dejo de correr, o la respuesta no se puede leer

import process from 'node:process';

/** Campos que se muestran, en el orden en que se leen. */
const CAMPOS = [
  ['servicio      ', 'service'],
  ['ultima corrida', 'last_run_at'],
  ['antiguedad    ', 'age_seconds'],
  ['atrasado desde', 'stale_after_seconds'],
  ['accion        ', 'action'],
];

/**
 * @param {string} raw respuesta cruda de la RPC
 * @returns {{lines: string[], healthy: boolean}}
 */
export function report(raw) {
  let estado;
  try {
    estado = JSON.parse(raw);
  } catch {
    return {
      lines: ['::error::La sonda no devolvio JSON: no se puede saber si el barrido corre.'],
      healthy: false,
    };
  }
  // PostgREST devuelve el resultado escalar de una RPC directamente, pero una
  // funcion que devuelve setof llega envuelta en un arreglo. Se aceptan las dos
  // formas en vez de fallar por la envoltura.
  if (Array.isArray(estado)) estado = estado[0];
  if (estado === null || typeof estado !== 'object') {
    return {
      lines: ['::error::La sonda devolvio un cuerpo vacio: no se puede saber si el barrido corre.'],
      healthy: false,
    };
  }

  const lines = CAMPOS.map(([etiqueta, clave]) => `${etiqueta}  ${estado[clave]}`);

  // `healthy` ausente NO es sano. Un campo que falta significa que la respuesta
  // no es la que este reporte sabe leer, y eso se trata como incidente.
  if (estado.healthy !== true) {
    lines.push('::error::El barrido de alertas dejo de correr: el sistema ya no se revisa solo.');
    return { lines, healthy: false };
  }
  lines.push('El barrido corre al dia.');
  return { lines, healthy: true };
}

const invocadoDirectamente = process.argv[1]?.endsWith('scheduler-watchdog-report.mjs');
if (invocadoDirectamente) {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const { lines, healthy } = report(raw);
  for (const line of lines) console.log(line);
  process.exit(healthy ? 0 : 1);
}
