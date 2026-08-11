/*
 * Todo import ESTÁTICO del cliente tiene que estar en el precache del worker.
 *
 * Por qué es un gate y no una recomendación: sin red, el navegador no puede
 * resolver un import estático que no está en la caché. No degrada la pantalla
 * que lo usaba —falla el módulo entero y la aplicación NO ARRANCA—. Con el
 * worker en modo network-first el defecto es invisible mientras haya señal, así
 * que sólo aparece en la visita que más necesitaba que funcionara.
 *
 * Se descubrió integrando dos ramas: un módulo nuevo (`production-cart-storage`)
 * entró al grafo sin entrar a la lista, y al buscarlo aparecieron otros
 * dieciséis que ya faltaban desde antes.
 *
 * Los imports DINÁMICOS quedan fuera a propósito: se piden por red cuando hacen
 * falta y el worker los cachea al pasar. Precargarlos anularía el diferido.
 *
 * Uso: node scripts/check-precache-graph.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Las tres cosas que `index.html` carga por sí mismo.
const ENTRADAS = ['js/app.js', 'js/startup-recovery.js', 'js/pwa-update.js'];
const IMPORT_ESTATICO = /^[^\S\n]*import\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/gm;

const worker = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const listados = new Set(
  [...worker.matchAll(/'\.\/([^']+)'/g)].map((match) => match[1].split('?')[0]),
);

const visitados = new Set();
const faltantes = new Map();
const inexistentes = [];

for (const entrada of ENTRADAS) recorrer(entrada, []);

// Espejo del control anterior: una entrada de la lista que ya no existe rompe
// `cache.addAll()` entero y deja al worker sin instalar nunca.
const rotas = [...listados].filter((rel) => (
  rel.endsWith('.js') && !rel.startsWith('http') && !fs.existsSync(path.join(ROOT, rel))
));

const problemas = [];
if (faltantes.size) {
  problemas.push(`${faltantes.size} módulo(s) del grafo estático fuera del precache de sw.js:`);
  for (const [rel, cadena] of faltantes) problemas.push(`  · ${rel}   importado desde ${cadena[cadena.length - 1]}`);
}
if (rotas.length) {
  problemas.push(`${rotas.length} entrada(s) del precache apuntan a archivos que no existen:`);
  rotas.forEach((rel) => problemas.push(`  · ${rel}`));
}
if (inexistentes.length) {
  problemas.push(`${inexistentes.length} import(s) que no resuelven a un archivo:`);
  inexistentes.forEach((linea) => problemas.push(`  · ${linea}`));
}

if (problemas.length) {
  console.error(problemas.join('\n'));
  process.exit(1);
}

console.log(`precache completo: ${visitados.size} módulos del grafo estático, todos en sw.js.`);

function recorrer(relativo, cadena) {
  if (visitados.has(relativo)) return;
  visitados.add(relativo);
  const absoluto = path.join(ROOT, relativo);
  if (!fs.existsSync(absoluto)) {
    inexistentes.push(`${relativo} (desde ${cadena[cadena.length - 1] || 'entrada'})`);
    return;
  }
  const fuente = fs.readFileSync(absoluto, 'utf8');
  for (const match of fuente.matchAll(IMPORT_ESTATICO)) {
    const especificador = match[1];
    if (!especificador.startsWith('.')) continue;
    const hijo = path
      .relative(ROOT, path.resolve(path.dirname(absoluto), especificador))
      .replace(/\\/g, '/');
    if (!listados.has(hijo) && !faltantes.has(hijo)) faltantes.set(hijo, [...cadena, relativo]);
    recorrer(hijo, [...cadena, relativo]);
  }
}
