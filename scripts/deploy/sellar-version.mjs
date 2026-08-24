/*
 * El sello de versión: qué commit, qué runtime y cuándo se construyó.
 *
 * POR QUÉ
 * -------
 * La pregunta «¿lo que está publicado es lo que hay en main?» no se podía
 * contestar sin adivinar. El 2026-08-24 producción servía el runtime v84 y
 * `main` tenía el v85, y la única forma de saberlo era bajar `sw.js` y buscar
 * una constante a ojo. El commit no estaba en ninguna parte del sitio.
 *
 * Esto deja un archivo estático y público —`version.json`— que responde las
 * tres cosas de una. No es un endpoint: es un archivo más del artefacto, así
 * que no agrega superficie ni depende de que algo esté vivo.
 *
 * NO LLEVA SECRETOS. Commit, nombre de caché y fecha: nada de eso es sensible,
 * y los tres ya son deducibles del sitio publicado por otros medios. Lo único
 * que agrega es poder leerlos sin adivinar.
 *
 *   node scripts/deploy/sellar-version.mjs dist_release --commit <sha>
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '../..');

/** El nombre de caché versionado que declara el service worker. */
export function runtimeDeclarado(fuenteSw) {
  const encontrado = fuenteSw.match(/const CACHE_NAME = '([^']+)';/);
  if (!encontrado) throw new Error('sw.js no declara CACHE_NAME: el artefacto no se puede sellar');
  return encontrado[1];
}

export function sello({ commit, runtime, construidoEn }) {
  if (!commit || !/^[0-9a-f]{7,40}$/.test(commit)) {
    throw new Error(`commit inválido: ${JSON.stringify(commit)}`);
  }
  return { commit, runtime, builtAt: construidoEn };
}

function argumento(nombre) {
  const i = process.argv.indexOf(nombre);
  return i === -1 ? null : process.argv[i + 1];
}

const invocadoDirectamente = process.argv[1]?.endsWith('sellar-version.mjs');
if (invocadoDirectamente) {
  const destino = path.resolve(ROOT, process.argv[2] || 'dist_release');
  const commit = argumento('--commit') || process.env.GITHUB_SHA;
  const runtime = runtimeDeclarado(fs.readFileSync(path.join(destino, 'sw.js'), 'utf8'));
  const contenido = sello({ commit, runtime, construidoEn: new Date().toISOString() });
  fs.writeFileSync(path.join(destino, 'version.json'), `${JSON.stringify(contenido, null, 2)}\n`);
  console.log('sello de versión escrito en version.json');
  for (const [k, v] of Object.entries(contenido)) console.log(`  ${k.padEnd(9)} ${v}`);
}
