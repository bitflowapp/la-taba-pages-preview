/*
 * ¿Lo que hay instalado en `node_modules` es lo que fija `package-lock.json`?
 *
 * POR QUÉ EXISTE
 * --------------
 * El 2026-08-23, con los otros defectos ya reparados, el job web llegó por
 * primera vez en días al paso de E2E y murió con 460 de 462 pruebas así:
 *
 *     Error: browserType.launch: Executable doesn't exist at
 *     <cache de Playwright del runner>/chromium_headless_shell-1234/...
 *     Executable doesn't exist at .../webkit-2336/pw_run.sh
 *
 * Pero el paso que descarga navegadores había terminado bien, y había bajado
 * los que corresponden al Playwright fijado:
 *
 *     Chrome Headless Shell ... (playwright chromium-headless-shell v1223)
 *     WebKit 26.4 (playwright webkit v2287)
 *
 * 1223 contra 1234. 2287 contra 2336. Los navegadores no faltaban: eran los de
 * OTRA versión de Playwright, porque entre un paso y el otro `node_modules`
 * cambió abajo de los pies.
 *
 * Lo cambió el paso anterior, `npm run test:webhook`, que corría Deno con
 * `--node-modules-dir=auto`. Con esa bandera Deno ve el `package.json` de la
 * raíz, lo trata como proyecto Node y materializa `node_modules` resolviendo
 * los RANGOS de `package.json` contra el registro —el `package-lock.json` no lo
 * lee—. `@playwright/test: ^1.60.0` resolvía a 1.62.1 y pisaba el 1.60.0 que
 * `npm ci` había puesto:
 *
 *     Initialize playwright@1.62.1
 *     Initialize @playwright/test@1.62.1
 *     Initialize playwright-core@1.62.1
 *
 * Lo peor no es el pisotón: es que npm no se entera. Su propio
 * `node_modules/.package-lock.json` sigue diciendo 1.60.0 mientras el disco
 * tiene 1.62.1. Medido acá: cero diferencias en la contabilidad de npm, versión
 * distinta en el paquete. Por eso nadie lo vio, y por eso el síntoma aparecía a
 * ocho minutos de distancia, en un paso que no tiene nada que ver.
 *
 * La causa está reparada en `scripts/run-mercadopago-webhook-tests.mjs`. Esto
 * es la guardia: cualquier herramienta que vuelva a escribir `node_modules` por
 * afuera de npm se ve acá, en segundos, y no ocho minutos después disfrazada de
 * «falta un navegador».
 *
 * QUÉ COMPRUEBA
 * -------------
 * La versión en disco de cada paquete instalado contra la que fija el lockfile.
 * Sólo lo que EXISTE: los paquetes opcionales de otras plataformas faltan a
 * propósito y no son un defecto. La deriva de versión sí.
 *
 *   node scripts/check-node-modules-pinned.mjs
 *   node scripts/check-node-modules-pinned.mjs /otra/raiz
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const RAIZ = path.resolve(process.argv[2] || path.join(import.meta.dirname, '..'));

function leerJson(archivo) {
  try {
    return JSON.parse(fs.readFileSync(archivo, 'utf8'));
  } catch {
    return null;
  }
}

const lockfile = leerJson(path.join(RAIZ, 'package-lock.json'));
if (!lockfile || !lockfile.packages) {
  console.error(`No se pudo leer ${path.join(RAIZ, 'package-lock.json')}: sin lockfile no hay nada que comprobar.`);
  process.exit(1);
}

const derivas = [];
const ausentes = [];
let comprobados = 0;

for (const [clave, fijado] of Object.entries(lockfile.packages)) {
  // La entrada '' es el paquete raíz; los `link: true` son workspaces.
  if (!clave.startsWith('node_modules/') || fijado.link) continue;
  if (!fijado.version) continue;

  const enDisco = leerJson(path.join(RAIZ, clave, 'package.json'));
  if (!enDisco) {
    // Falta. Sólo importa si el lockfile no la marcó opcional: las binarias de
    // otras plataformas (`@img/sharp-linux-arm64`, `@esbuild/darwin-x64`) no se
    // instalan acá y eso es correcto.
    if (!fijado.optional && !fijado.os && !fijado.cpu) ausentes.push({ clave, fijado: fijado.version });
    continue;
  }

  comprobados += 1;
  if (enDisco.version !== fijado.version) {
    derivas.push({ clave, fijado: fijado.version, enDisco: enDisco.version });
  }
}

if (derivas.length === 0 && ausentes.length === 0) {
  console.log(`node_modules coincide con package-lock.json: ${comprobados} paquetes comprobados.`);
  process.exit(0);
}

console.error('node_modules NO coincide con package-lock.json.');
console.error('');
for (const { clave, fijado, enDisco } of derivas) {
  console.error(`  ${clave}`);
  console.error(`    lockfile: ${fijado}`);
  console.error(`    en disco: ${enDisco}`);
}
for (const { clave, fijado } of ausentes) {
  console.error(`  ${clave}`);
  console.error(`    lockfile: ${fijado}`);
  console.error('    en disco: no está');
}
console.error('');
console.error('  Algo escribió node_modules por afuera de npm. El sospechoso conocido es una');
console.error('  herramienta que resuelve los RANGOS de package.json en vez del lockfile:');
console.error('  Deno con --node-modules-dir=auto lo hacía, y subía @playwright/test de');
console.error('  1.60.0 a 1.62.1 sin que npm se enterara. Ver');
console.error('  scripts/run-mercadopago-webhook-tests.mjs.');
console.error('');
console.error('  Con Playwright esto no se ve acá sino ocho minutos después: los navegadores');
console.error('  que descargó el paso de instalación son los de la versión fijada, y la que');
console.error('  corre las pruebas pide otros. «Executable doesn\'t exist».');
console.error('');
console.error('  Para volver al estado fijado: npm ci');
process.exit(1);
