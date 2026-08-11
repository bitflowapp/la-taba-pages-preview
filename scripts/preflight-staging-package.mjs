/*
 * Preflight del paquete que se sube a staging. Se planta antes de publicar.
 *
 * Comprueba, sobre `dist_release` ya construido:
 *
 *  1. que NO se cuele ninguna ruta que el sitio no publica (catalog, data,
 *     docs, tests, scripts, supabase, package.json, README);
 *  2. que `runtime-config.js` sea el VIVO byte a byte y no la plantilla del
 *     repositorio, que falla cerrada y apagaría staging;
 *  3. que todo lo que el service worker promete precachear exista en el
 *     paquete —`cache.addAll()` es todo o nada: un 404 deja al worker sin
 *     instalar nunca—;
 *  4. que las versiones servidas sean las del candidato y no una mezcla.
 *
 * Uso:
 *   node scripts/preflight-staging-package.mjs <dir> <runtime-config-vivo>
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [dir = 'dist_release', vivo = 'artifacts/ci/staging-v61/preserva/runtime-config.live.js'] = process.argv.slice(2);
const RAIZ = path.resolve(dir);
const PROHIBIDAS = ['catalog', 'data', 'docs', 'tests', 'scripts', 'supabase', 'package.json', 'package-lock.json', 'README.md', '.env', 'node_modules'];
const ESPERADO = { app: '?v=41', css: '?v=49', recovery: '?v=2', cache: 'la-taba-runtime-v61-cliente-comercial-mapa-permanente' };

const fallas = [];
const ok = [];
const sha = (archivo) => crypto.createHash('sha256').update(fs.readFileSync(archivo)).digest('hex');

// 1 · rutas prohibidas
const colados = PROHIBIDAS.filter((entrada) => fs.existsSync(path.join(RAIZ, entrada)));
if (colados.length) fallas.push(`se colaron rutas que el sitio no publica: ${colados.join(', ')}`);
else ok.push(`sin rutas prohibidas (${PROHIBIDAS.length} comprobadas)`);

// 2 · runtime-config vivo, byte a byte
const enPaquete = path.join(RAIZ, 'runtime-config.js');
if (!fs.existsSync(vivo)) {
  fallas.push(`no está la copia del runtime-config vivo en ${vivo}: sin eso no se puede publicar`);
} else if (!fs.existsSync(enPaquete)) {
  fallas.push('el paquete no trae runtime-config.js');
} else {
  const hashVivo = sha(vivo);
  const hashPaquete = sha(enPaquete);
  const bytes = fs.statSync(enPaquete).size;
  if (hashVivo !== hashPaquete) {
    fallas.push(`runtime-config.js NO es el vivo (paquete ${hashPaquete.slice(0, 16)}… vs vivo ${hashVivo.slice(0, 16)}…)`);
  } else if (/PROJECT_REF|sb_publishable_\.\.\./.test(fs.readFileSync(enPaquete, 'utf8'))) {
    fallas.push('runtime-config.js es la plantilla vacía del repositorio: publicarla apaga staging');
  } else {
    ok.push(`runtime-config.js vivo preservado: ${bytes} B, sha256 ${hashVivo.slice(0, 16)}…`);
  }
}

// 3 · el precache tiene que existir entero dentro del paquete
const worker = fs.readFileSync(path.join(RAIZ, 'sw.js'), 'utf8');
const precache = [...worker.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]);
const ausentes = precache
  .map((entrada) => entrada.split('?')[0])
  .filter((rel) => rel && !fs.existsSync(path.join(RAIZ, rel)));
if (ausentes.length) fallas.push(`el worker precachea ${ausentes.length} archivo(s) que no están en el paquete: ${ausentes.slice(0, 6).join(', ')}`);
else ok.push(`precache completo: ${precache.length} entradas, todas presentes`);

// 4 · versiones del candidato, sin mezcla
const index = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
const hoja = fs.readFileSync(path.join(RAIZ, 'styles.css'), 'utf8');
const comprobar = (nombre, condicion, detalle) => (condicion ? ok.push(detalle) : fallas.push(`${nombre}: ${detalle}`));
comprobar('index/app', index.includes(`js/app.js${ESPERADO.app}`), `index.html carga app.js${ESPERADO.app}`);
comprobar('index/recovery', index.includes(`js/startup-recovery.js${ESPERADO.recovery}`), `index.html carga startup-recovery.js${ESPERADO.recovery}`);
comprobar('index/css', index.includes(`styles.css${ESPERADO.css}`), `index.html carga styles.css${ESPERADO.css}`);
comprobar('sw/cache', worker.includes(ESPERADO.cache), `sw.js declara ${ESPERADO.cache}`);

const versionesSueltas = new Set([
  ...[...index.matchAll(/\?v=(\d+)/g)].map((m) => m[1]),
  ...[...hoja.matchAll(/\?v=(\d+)/g)].map((m) => m[1]),
  ...[...worker.matchAll(/\?v=(\d+)/g)].map((m) => m[1]),
]);
// 49 (cadena CSS), 41 (app), 3 (pwa-update) y 2 (startup-recovery) son las
// cuatro del candidato. Cualquier otra es una mezcla con un artefacto anterior.
const permitidas = new Set(['49', '41', '3', '2']);
const intrusas = [...versionesSueltas].filter((v) => !permitidas.has(v));
if (intrusas.length) fallas.push(`mezcla de versiones: aparecen ?v=${intrusas.join(', ?v=')} además de las del candidato`);
else ok.push(`sin mezcla de versiones: sólo ${[...versionesSueltas].sort().map((v) => `?v=${v}`).join(' ')}`);

const total = fs.readdirSync(RAIZ, { recursive: true }).filter((rel) => fs.statSync(path.join(RAIZ, rel)).isFile()).length;
ok.push(`${total} archivos en el paquete`);

console.log(ok.map((linea) => `  ok · ${linea}`).join('\n'));
if (fallas.length) {
  console.error(`\nPREFLIGHT DETENIDO (${fallas.length}):`);
  fallas.forEach((linea) => console.error(`  ✗ ${linea}`));
  process.exit(1);
}
console.log('\npreflight en verde: el paquete se puede publicar.');
