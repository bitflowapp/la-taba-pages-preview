/*
 * Ensayo de la fusión UX + Mercado Pago SIN integrar nada.
 *
 * 1. `git merge-tree --write-tree` arma el árbol fusionado en memoria (no toca
 *    ningún worktree ni rama; sólo escribe objetos sueltos en el repo).
 * 2. Resuelve los tres conflictos conocidos de identidad con una identidad
 *    nueva, mayor que las dos (v164), conservando los ?v= de la rama UX
 *    (Mercado Pago no tocó ninguno).
 * 3. Extrae a una carpeta temporal sólo lo que mide la identidad (sw.js,
 *    index.html y cada archivo del precache) y calcula el digest con la misma
 *    función que usa `check-release-identity`.
 *
 * Uso: node artifacts/ux-premium-20261024/tools/ensayar-fusion-mp.mjs [rama-mp]
 * Salida: qué conflictos hubo, si quedó alguno sin resolver y la identidad que
 * habría que firmar. NO es la integración: es la comprobación previa.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MP = process.argv[2] || 'origin/feature/mp-commercial-onboarding-20261024';
const NUEVA = 'la-taba-runtime-v164-ux-premium-mp-onboarding';
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const gitBuf = (...args) => execFileSync('git', args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });

let salida;
try {
  salida = git('merge-tree', '--write-tree', '--name-only', 'HEAD', MP);
} catch (error) {
  // merge-tree sale con 1 cuando hay conflictos; la salida sigue siendo válida.
  salida = String(error.stdout || '');
}
const [arbol, ...resto] = salida.split('\n');
const conflictos = resto.slice(0, resto.indexOf('')).filter(Boolean);
console.log(`árbol fusionado ${arbol.slice(0, 12)} · conflictos: ${conflictos.join(', ') || 'ninguno'}`);

const ESPERADOS = ['release-identity.json', 'scripts/preflight-staging-package.mjs', 'sw.js'];
const inesperados = conflictos.filter((archivo) => !ESPERADOS.includes(archivo));
if (inesperados.length) {
  console.error(`conflictos fuera de la identidad, revisar a mano: ${inesperados.join(', ')}`);
  process.exit(2);
}

const tmp = fs.mkdtempSync(path.join(process.env.TMP || os.tmpdir(), 'ensayo-fusion-mp-'));
const escribir = (relativo, contenido) => {
  const destino = path.join(tmp, relativo);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, contenido);
};

// Resolución: el lado UX (lleva ?v=82 / ?v=54) con la identidad nueva.
const swUx = git('show', 'HEAD:sw.js');
const sw = swUx.replace(/const CACHE_NAME = '[^']+';/, `const CACHE_NAME = '${NUEVA}';`);
if (sw === swUx) throw new Error('no encontré CACHE_NAME en sw.js');
escribir('sw.js', sw);
const preflight = git('show', 'HEAD:scripts/preflight-staging-package.mjs')
  .replace(/cache: '[^']+'/, `cache: '${NUEVA}'`);

// El resto, del árbol fusionado: index.html y cada archivo del precache.
escribir('index.html', gitBuf('show', `${arbol}:index.html`));
const precache = [...sw.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1].split('?')[0]).filter(Boolean);
let ausentes = 0;
for (const relativo of new Set(precache)) {
  try { escribir(relativo, gitBuf('show', `${arbol}:${relativo}`)); } catch { ausentes += 1; }
}

const { calcularIdentidad } = await import(new URL('../../../scripts/check-release-identity.mjs', import.meta.url));
const { identidad, fallas } = calcularIdentidad(tmp);
console.log(`identidad a firmar: ${identidad.cacheName} · ${identidad.assetCount} archivos · digest ${identidad.assetsDigest}`);
console.log(`preflight resuelto: ${/cache: '([^']+)'/.exec(preflight)[1]}`);
if (ausentes) console.log(`aviso: ${ausentes} ruta(s) del precache no están en el árbol fusionado`);
if (fallas.length) {
  console.error(fallas.join('\n'));
  process.exit(1);
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log('ensayo OK: los conflictos son sólo de identidad y se resuelven con una identidad nueva re-firmada.');
