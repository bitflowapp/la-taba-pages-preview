/*
 * ─────────────────────────────────────────────────────────────────────────────
 * COMPUERTA DE AISLAMIENTO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * POR QUÉ EXISTE
 * --------------
 * La hamburguesería nació reciclando otro sistema, así que el riesgo es
 * concreto y no teórico: alguien copia un `runtime-config.js` o un `.env` de un
 * worktree ajeno para «probar rápido», y de golpe los pedidos entran a la base
 * de un comercio que está VENDIENDO. Eso no se deshace.
 *
 * DE LISTA NEGRA A LISTA BLANCA
 * -----------------------------
 * La primera versión enumeraba proyectos prohibidos. Servía hasta que apareciera
 * uno nuevo: un proyecto creado mañana no está en la lista y pasa la compuerta.
 *
 * Ahora la regla es al revés: toda referencia a un proyecto Supabase que aparezca
 * en este repositorio tiene que ser UNA DE LAS DECLARADAS en
 * `supabase/proyectos.json`. Cualquier otra falla, se llame como se llame. La
 * lista blanca es versionada, así que agregar un proyecto es un cambio que se ve
 * en el diff y que alguien tiene que aprobar.
 *
 * NOMBRAR LA PROCEDENCIA EN UN COMENTARIO ESTÁ PERMITIDO
 * -----------------------------------------------------
 * Todo este proyecto salió de reciclar otro, y cada módulo dice de dónde vino y
 * qué se cambió. Esa procedencia es documentación que hay que conservar. Lo que
 * se prohíbe es APUNTAR: una URL, un identificador o una configuración en el
 * código que se EJECUTA. Por eso se quitan los comentarios antes de buscar.
 *
 * Los secretos, en cambio, se buscan en el archivo ENTERO: una clave comentada
 * sigue siendo una clave que está en el repositorio.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { extname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

const ejecutar = promisify(execFile);

const RAIZ = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

// ── La lista blanca ─────────────────────────────────────────────────────────

const declarados = JSON.parse(await readFile(join(RAIZ, 'supabase', 'proyectos.json'), 'utf8'));
const REFERENCIAS_PROPIAS = new Set(
  Object.entries(declarados)
    .filter(([clave, valor]) => !clave.startsWith('_') && valor?.ref)
    .map(([, valor]) => valor.ref),
);

if (REFERENCIAS_PROPIAS.size === 0) {
  console.error('✖ supabase/proyectos.json no declara ninguna referencia. La compuerta no puede validar nada.');
  process.exit(1);
}

/**
 * Una referencia de proyecto Supabase son 20 letras minúsculas. El patrón busca
 * cualquiera que aparezca dentro de una URL de supabase.co o de una asignación
 * de PROJECT_REF: buscar la cadena suelta daría falsos positivos con cualquier
 * identificador de 20 caracteres.
 */
const PATRONES_DE_REFERENCIA = [
  /https?:\/\/([a-z]{20})\.supabase\.(?:co|in)/gi,
  /\bdb\.([a-z]{20})\.supabase\.(?:co|in)/gi,
  /PROJECT_REF\s*[:=]\s*['"`]?([a-z]{20})\b/gi,
  /project[_-]?ref\s*[:=]\s*['"`]?([a-z]{20})\b/gi,
  /--project-ref[= ]+([a-z]{20})\b/gi,
];

/*
 * Secretos que nunca pueden estar en un repositorio que se sirve al navegador.
 *
 * El NOMBRE del rol `service_role` es legítimo en SQL —hay que otorgarle
 * permisos— y verlo no es una filtración. Lo que no puede estar es su CLAVE, o
 * sea la ASIGNACIÓN de un valor.
 */
const SECRETOS = [
  { patron: /service[_-]?role[_-]?key\s*[:=]\s*['"`][^'"`\s]{8,}/i, que: 'clave service_role asignada' },
  { patron: /\bsb_secret_[A-Za-z0-9_-]{10,}/, que: 'clave secreta de Supabase' },
  { patron: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./, que: 'JWT embebido' },
  { patron: /APP_USR-\d{6,}/, que: 'credencial productiva de Mercado Pago' },
  { patron: /\bTEST-\d{10,}-[a-f0-9]{6,}/i, que: 'credencial de prueba de Mercado Pago' },
];

const EXTENSIONES = new Set(['.js', '.mjs', '.ts', '.json', '.html', '.css', '.sql', '.sh', '.md', '.toml']);
/*
 * `vendor` queda afuera: es el cliente de Supabase minificado, 216 KB en una
 * sola linea. No es codigo nuestro y buscarle patrones de secreto es ruido caro
 * — una linea de ese tamano hace retroceder los regex.
 */
const IGNORADOS = new Set(['node_modules', '.git', '.tmp', 'test-results', '.secretos', 'dist', 'vendor']);

/* Este control nombra los patrones que busca; se excluye de buscárselos. */
const SE_EXCLUYE = new Set([
  'scripts/check-aislamiento-taba.mjs',
  'supabase/proyectos.json',
]);

/**
 * Quita los comentarios. No pretende ser un parser: alcanza para separar
 * procedencia escrita de código que se ejecuta.
 */
function sinComentarios(texto, extension) {
  if (extension === '.md') return '';                       // un documento es todo prosa
  if (extension === '.sql') return texto.replace(/--[^\n]*/g, '');
  if (extension === '.sh' || extension === '.toml') return texto.replace(/(^|\s)#[^\n]*/g, '$1');
  if (extension === '.css') return texto.replace(/\/\*[\s\S]*?\*\//g, '');
  if (extension === '.html') return texto.replace(/<!--[\s\S]*?-->/g, '');
  return texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/[^\n]*/gm, '');
}

async function* recorrer(directorio) {
  for (const entrada of await readdir(directorio)) {
    if (IGNORADOS.has(entrada)) continue;
    const ruta = join(directorio, entrada);
    if ((await stat(ruta)).isDirectory()) yield* recorrer(ruta);
    else if (EXTENSIONES.has(extname(ruta))) yield ruta;
  }
}

/*
 * LO QUE GIT IGNORA NO ESTÁ EN EL REPOSITORIO.
 *
 * Esta compuerta busca «secretos en el repositorio», y un archivo ignorado no lo
 * está. `runtime-config.js` es el caso concreto: lleva la clave publicable —que
 * por diseño viaja en cada petición del navegador y no es un secreto— y lo
 * genera el despliegue, no una persona.
 *
 * Se le PREGUNTA a Git en vez de reimplementar `.gitignore`. Reimplementarlo es
 * garantizar que algún día diga algo distinto de lo que Git realmente hace, y
 * ahí la compuerta empieza a mentir justo en la dirección peligrosa: creer que
 * un archivo está ignorado cuando en realidad se commiteó.
 */
async function ignoradosPorGit() {
  /*
   * `git ls-files` y no `git check-ignore --stdin`.
   *
   * El primer intento usó `execFile` con la opción `input`, que NO existe en
   * `execFile` —es de `execFileSync`—. El proceso quedaba esperando un stdin que
   * nunca se cerraba y la compuerta colgaba para siempre: un chequeo que no
   * termina es peor que uno que falla, porque nadie sabe si pasó.
   *
   * Esta forma no necesita stdin: Git enumera lo ignorado y se interseca.
   */
  try {
    const { stdout } = await ejecutar(
      'git',
      ['ls-files', '--others', '--ignored', '--exclude-standard'],
      { cwd: RAIZ, maxBuffer: 20 * 1024 * 1024 },
    );
    return new Set(
      stdout.split(/\r?\n/).map((l) => l.trim().replace(/\\/g, '/')).filter(Boolean),
    );
  } catch (_) {
    // Sin Git disponible se revisa todo. Es el lado seguro del error.
    return new Set();
  }
}

const hallazgos = [];
let revisados = 0;
let omitidos = 0;
const referenciasVistas = new Set();

const candidatos = [];
for await (const ruta of recorrer(RAIZ)) candidatos.push(ruta);

const ignorados = await ignoradosPorGit();

for (const ruta of candidatos) {
  const relativa = relative(RAIZ, ruta).replace(/\\/g, '/');
  if (ignorados.has(relativa)) { omitidos += 1; continue; }
  revisados += 1;
  const contenido = await readFile(ruta, 'utf8');

  for (const [indice, linea] of contenido.split('\n').entries()) {
    for (const control of SECRETOS) {
      if (control.patron.test(linea)) {
        hallazgos.push({ archivo: relativa, linea: indice + 1, que: control.que, texto: linea.trim().slice(0, 110) });
      }
    }
  }

  if (SE_EXCLUYE.has(relativa)) continue;

  const codigo = sinComentarios(contenido, extname(ruta));
  for (const [indice, linea] of codigo.split('\n').entries()) {
    for (const patron of PATRONES_DE_REFERENCIA) {
      patron.lastIndex = 0;
      let coincidencia;
      while ((coincidencia = patron.exec(linea)) !== null) {
        const ref = coincidencia[1].toLowerCase();
        referenciasVistas.add(ref);
        if (!REFERENCIAS_PROPIAS.has(ref)) {
          hallazgos.push({
            archivo: relativa,
            linea: indice + 1,
            que: `proyecto Supabase AJENO «${ref}» en código ejecutable`,
            texto: linea.trim().slice(0, 110),
          });
        }
      }
    }
  }
}

if (hallazgos.length) {
  console.error('\n✖ AISLAMIENTO ROTO\n');
  for (const hallazgo of hallazgos) {
    console.error(`  ${hallazgo.archivo}:${hallazgo.linea}  ${hallazgo.que}`);
    console.error(`    ${hallazgo.texto}\n`);
  }
  console.error('Sólo se admiten los proyectos declarados en supabase/proyectos.json:');
  for (const ref of REFERENCIAS_PROPIAS) console.error(`  · ${ref}`);
  console.error('\nVer docs/BACKEND.md §8.\n');
  process.exit(1);
}

const vistas = referenciasVistas.size
  ? ` · referencias vistas: ${[...referenciasVistas].join(', ')}`
  : '';
console.log(
  `✔ aislamiento verificado en ${revisados} archivos`
  + `${omitidos ? ` (${omitidos} ignorados por Git)` : ''}`
  + ` · sin secretos de servidor${vistas}`,
);
