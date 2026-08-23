/*
 * ¿El CLI que este repositorio fija puede leer `supabase/config.toml`?
 *
 * POR QUÉ EXISTE
 * --------------
 * El 2026-08-22 el archivo declaraba `[local_smtp]`. El CLI fijado no conoce esa
 * clave, así que `supabase start` ni siquiera llegaba a levantar nada:
 *
 *     failed to parse config: 'config.config' has invalid keys: local_smtp
 *
 * Con eso se caía el job entero de migraciones y pgTAP —162 aserciones y el
 * simulacro de restauración— sin haber corrido una sola. Y se caía en TODAS las
 * ramas, porque el archivo vive en `main`: ningún PR podía llegar a verde, y el
 * motivo estaba doce pasos adentro del log de un job que no habla de config.
 *
 * Un error de vocabulario no debería costar un job de quince minutos. Esto lo
 * atrapa en `npm run check`, en dos segundos y sin Docker.
 *
 * QUÉ COMPRUEBA, Y POR QUÉ ESO Y NO MÁS
 * -------------------------------------
 * El espacio de nivel superior de cada sección: `[auth.email.template.invite]`
 * cuenta como `auth`. Es exactamente el eje donde falla un renombre —
 * `local_smtp` inventa un espacio que el CLI no tiene— y es el único que se
 * puede afirmar sin red: las subsecciones y las claves sueltas varían entre
 * versiones menores, y una lista de todas ellas envejecería mintiendo.
 *
 * La lista de abajo NO se escribe a mano: sale del propio CLI fijado.
 *
 *     supabase init --force            # en un directorio vacío
 *     grep -oE '^\[[^]]+\]' supabase/config.toml \
 *       | sed 's/^\[//;s/\]$//' | cut -d. -f1 | sort -u
 *
 * `init` da el piso, no el techo: emite los espacios que el proyecto vacío usa.
 * `functions` no aparece ahí —un proyecto sin funciones no lo escribe— y sin
 * embargo el CLI lo acepta; está en la lista porque se comprobó contra el CLI
 * real, con nuestras dos secciones puestas, y el parseo pasó. Cualquier espacio
 * que se agregue así lleva la misma deuda: comprobarlo, no suponerlo.
 *
 * Y está atada a la versión: si alguien mueve `SUPABASE_CLI_VERSION` en el
 * workflow sin volver a derivarla, esto falla y dice cómo rehacerla. Un
 * vocabulario que no sabe de qué versión habla no comprueba nada.
 *
 *   node scripts/check-supabase-config.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const CONFIG = path.join(ROOT, 'supabase/config.toml');
const WORKFLOW = path.join(ROOT, '.github/workflows/ci.yml');

/** La versión contra la que se derivó el vocabulario de abajo. */
const CLI_DERIVADO_DE = '2.101.0';

/**
 * Espacios de nivel superior que acepta ese CLI. Derivados de su propio
 * `supabase init`, no copiados de la documentación.
 */
const ESPACIOS = new Set([
  'analytics',
  'api',
  'auth',
  'db',
  'edge_runtime',
  'experimental',
  // No lo emite `init`; comprobado contra el CLI 2.101.0 con nuestras dos
  // secciones `[functions.*]` presentes: parsea sin quejarse.
  'functions',
  'inbucket',
  'realtime',
  'storage',
  'studio',
]);

/**
 * Renombres conocidos: nombre que alguien podría escribir → el que el CLI
 * fijado entiende. Sirven para que el error diga qué poner, en vez de dejar a
 * la próxima persona buscando el nombre correcto a ciegas.
 */
const RENOMBRES = new Map([
  ['local_smtp', 'inbucket'],
]);

const problemas = [];

const versionFijada = (() => {
  const workflow = fs.readFileSync(WORKFLOW, 'utf8');
  const encontrada = workflow.match(/SUPABASE_CLI_VERSION:\s*'?([\d.]+)'?/);
  if (!encontrada) {
    problemas.push(`${path.relative(ROOT, WORKFLOW)} no declara SUPABASE_CLI_VERSION.`);
    return null;
  }
  return encontrada[1];
})();

if (versionFijada && versionFijada !== CLI_DERIVADO_DE) {
  problemas.push(
    `El workflow fija el CLI ${versionFijada} y el vocabulario de este guion se derivó del `
    + `${CLI_DERIVADO_DE}. Volver a derivarlo con ese CLI —el encabezado del archivo dice cómo— `
    + 'y actualizar CLI_DERIVADO_DE. Un vocabulario de otra versión no comprueba nada.',
  );
}

const config = fs.readFileSync(CONFIG, 'utf8');
const secciones = [];
config.split('\n').forEach((linea, indice) => {
  // Sólo encabezados de sección al principio de la línea: lo que está dentro de
  // un comentario o de un valor no declara nada.
  const encontrada = linea.match(/^\[([^\]]+)\]\s*$/);
  if (encontrada) secciones.push({ nombre: encontrada[1].trim(), numero: indice + 1 });
});

if (!secciones.length) problemas.push('El config no declara ninguna sección: ¿se leyó el archivo correcto?');

const vistas = new Map();
for (const { nombre, numero } of secciones) {
  if (vistas.has(nombre)) {
    problemas.push(`Línea ${numero}: la sección [${nombre}] ya estaba declarada en la línea ${vistas.get(nombre)}.`);
  }
  vistas.set(nombre, numero);

  const espacio = nombre.split('.')[0];
  if (ESPACIOS.has(espacio)) continue;
  const sugerido = RENOMBRES.get(espacio);
  problemas.push(
    `Línea ${numero}: [${nombre}] usa el espacio «${espacio}», que el CLI ${CLI_DERIVADO_DE} no conoce`
    + `${sugerido ? `; el nombre que entiende es «${sugerido}»` : ''}. `
    + 'Tal como está, `supabase start` falla al parsear y se lleva puesto el job de migraciones.',
  );
}

if (problemas.length) {
  console.error('El config de Supabase no lo puede leer el CLI que fija este repositorio:');
  for (const problema of problemas) console.error(`  ${problema}`);
  process.exit(1);
}

console.log(
  `config de Supabase legible por el CLI ${CLI_DERIVADO_DE}: `
  + `${secciones.length} secciones en ${ESPACIOS.size} espacios conocidos.`,
);
