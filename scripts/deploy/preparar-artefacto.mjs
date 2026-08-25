/*
 * El artefacto de producción, armado en un solo comando auditable.
 *
 * Reemplaza la secuencia que hasta ahora se corría a mano —cuatro comandos, en
 * orden, documentados en GONDOLA-NEUQUEN.md §6— y que se desacoplaba de `main`
 * con sólo no ejecutarla. Cada paso sigue siendo el mismo guion de siempre:
 *
 *   1. vendor:build                     el bundle del cliente de Supabase
 *   2. create-release-folder.mjs        el árbol publicable, con la compuerta
 *                                       de derechos de las fotos
 *   3. build-production-runtime-config  DERIVA el runtime-config productivo y
 *                                       falla cerrado si no queda «production
 *                                       ready». Nunca se escribe a mano: un
 *                                       archivo escrito a mano al desplegar es
 *                                       exactamente donde entra un ref de
 *                                       staging.
 *   4. sellar-version.mjs               commit + runtime en version.json
 *   5. scan-production-artifacts        el contrato: que no viaje una
 *                                       credencial de servidor ni una
 *                                       superficie de otro entorno
 *
 * DE DÓNDE SALE LA CLAVE PUBLICABLE
 * ---------------------------------
 *   1. `SUPABASE_PUBLISHABLE_KEY` del entorno, si está.
 *   2. el `runtime-config.js` del sitio ya publicado.
 *
 * El segundo camino existe para no exigir un secreto más por un dato que ya es
 * público: esa clave viaja en el JavaScript de la tienda y la autoridad real es
 * RLS. Y no puede quedar desincronizada de la que producción usa de verdad.
 * Si el valor fuera inválido, el paso 3 no escribe nada y esto se planta: el
 * respaldo no afloja la compuerta, sólo evita una credencial redundante.
 *
 *   node scripts/deploy/preparar-artefacto.mjs --commit <sha>
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DESTINO = path.join(ROOT, 'dist_release');
const HOST_POR_DEFECTO = 'https://la-taba.pages.dev';
const REF_PRODUCCION = 'wwcpogltfgzgkrlilbcd';
const NEGOCIO_CANONICO = '00000000-0000-4000-8000-000000000001';

function correr(comando, argumentos) {
  execFileSync(comando, argumentos, { cwd: ROOT, stdio: 'inherit' });
}

function argumento(nombre) {
  const i = process.argv.indexOf(nombre);
  return i === -1 ? null : process.argv[i + 1];
}

/** La clave publicable que el sitio ya le entrega a cualquier navegador. */
async function claveDelSitioPublicado(origen) {
  const respuesta = await fetch(`${origen}/runtime-config.js`, { redirect: 'follow' });
  if (!respuesta.ok) throw new Error(`${origen}/runtime-config.js contestó ${respuesta.status}`);
  const clave = (await respuesta.text()).match(/publishableKey:\s*'([^']+)'/)?.[1];
  if (!clave) throw new Error(`${origen} no publica una clave en su runtime-config`);
  return clave;
}

const commit = argumento('--commit') || process.env.GITHUB_SHA;
if (!commit) {
  console.error('::error::Falta --commit (o GITHUB_SHA): el artefacto se sella con el commit que publica.');
  process.exit(2);
}

let clave = (process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
let origenDeLaClave = 'secreto SUPABASE_PUBLISHABLE_KEY';
if (!clave) {
  const origen = process.env.TABA_PUBLIC_ORIGIN || HOST_POR_DEFECTO;
  try {
    clave = await claveDelSitioPublicado(origen);
    origenDeLaClave = `runtime-config.js de ${origen}`;
  } catch (error) {
    console.error('::error::DEPLOY CONFIGURATION MISSING: SUPABASE_PUBLISHABLE_KEY');
    console.error(`  Tampoco se pudo leer del sitio publicado: ${error.message}`);
    console.error('  Es la clave PUBLICABLE (sb_publishable_…), no una secreta ni service_role.');
    process.exit(2);
  }
}

console.log(`clave publicable: ${origenDeLaClave}`);

console.log('\n· 1/5  bundle del cliente');
/*
 * El guion, no el alias. `npm` en Windows es `npm.cmd`, y desde Node 20
 * `execFileSync` se niega a ejecutar un `.cmd` sin shell (EINVAL): este paso se
 * plantaba antes del primero. Llamar al script que `npm run vendor:build`
 * llamaría corre lo mismo en las dos plataformas y sin intermediario.
 *
 * Importa porque cuando el despliegue automático está caído —hoy le faltan los
 * secretos de Cloudflare— la única forma de publicar es armar el artefacto a
 * mano desde la máquina del comercio, y esa máquina es Windows.
 */
correr(process.execPath, ['scripts/build-supabase-vendor.mjs']);

console.log('\n· 2/5  árbol publicable');
correr(process.execPath, ['scripts/create-release-folder.mjs']);

console.log('\n· 3/5  runtime-config productivo (derivado, no escrito a mano)');
// El archivo de clave vive sólo lo que dura el proceso y con permisos de dueño.
const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'taba-deploy-'));
const archivoClave = path.join(temporal, 'publishable.key');
try {
  fs.writeFileSync(archivoClave, clave, { mode: 0o600 });
  correr(process.execPath, [
    'scripts/build-production-runtime-config.mjs',
    '--key-file', archivoClave,
    '--out', path.join(DESTINO, 'runtime-config.js'),
  ]);
} finally {
  fs.rmSync(temporal, { force: true, recursive: true });
}

console.log('\n· 4/5  sello de versión');
correr(process.execPath, ['scripts/deploy/sellar-version.mjs', DESTINO, '--commit', commit]);

console.log('\n· 5/5  contrato del artefacto');
correr(process.execPath, [
  'scripts/scan-production-artifacts.mjs', DESTINO,
  '--expect-host', `${REF_PRODUCCION}.supabase.co`,
  '--business-id', NEGOCIO_CANONICO,
]);

const archivos = execFileSync('find', [DESTINO, '-type', 'f'], { encoding: 'utf8' }).trim().split('\n').length;
console.log(`\nArtefacto listo: ${archivos} archivos en dist_release, sellados con ${commit.slice(0, 7)}.`);
