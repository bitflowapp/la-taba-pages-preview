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
/*
 * `import ... from` y también `export ... from`.
 *
 * El re-export es una dependencia estática igual que el import, y por no
 * mirarlo este guard daba verde sobre un grafo incompleto: `js/data.js` es una
 * sola línea, `export { ... } from './beverage-demo-data.js'`, así que el
 * recorrido se cortaba ahí y los tres módulos de abajo —41 KB y 115 KB de
 * catálogo entre ellos— nunca se contaron.
 *
 * Cómo se vio: con la caché caliente y el borde contestando 503 a los módulos,
 * la tienda NO ARRANCA. El módulo que falta se pide por red, la red contesta
 * mal, no hay copia guardada y el grafo entero se cae. Es exactamente el
 * defecto que este guard existe para impedir.
 */
const DEPENDENCIA_ESTATICA = /^[^\S\n]*(?:import|export)\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/gm;

const worker = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const listados = new Set(
  [...worker.matchAll(/'\.\/([^']+)'/g)].map((match) => match[1].split('?')[0]),
);

const visitados = new Set();
const faltantes = new Map();
const inexistentes = [];

for (const entrada of ENTRADAS) recorrer(entrada, []);

/*
 * Segundo recorrido, y este NO corta el gate: los módulos que están en el
 * precache pero sólo se alcanzan por import dinámico.
 *
 * Precachear un módulo sin precachear lo que importa no sirve de nada: sin red
 * no evalúa igual. Hoy pasa con el panel del negocio —`production-operations.js`
 * está en la lista y sus 31 imports estáticos no—, y eso no es un camino del
 * cliente: se avisa para que quede a la vista y se decida, en vez de bloquear un
 * gate del storefront por deuda de otra superficie.
 */
const visitadosCliente = new Set(visitados);
const faltantesCliente = new Map(faltantes);
for (const listado of listados) {
  if (listado.endsWith('.js') && fs.existsSync(path.join(ROOT, listado))) recorrer(listado, ['precache']);
}
const faltantesDiferidos = [...faltantes.keys()].filter((rel) => !faltantesCliente.has(rel));

// Espejo del control anterior: una entrada de la lista que ya no existe rompe
// `cache.addAll()` entero y deja al worker sin instalar nunca.
const rotas = [...listados].filter((rel) => (
  rel.endsWith('.js') && !rel.startsWith('http') && !fs.existsSync(path.join(ROOT, rel))
));

const problemas = [];
if (faltantesCliente.size) {
  problemas.push(`${faltantesCliente.size} módulo(s) del grafo estático del CLIENTE fuera del precache de sw.js:`);
  for (const [rel, cadena] of faltantesCliente) problemas.push(`  · ${rel}   importado desde ${cadena[cadena.length - 1]}`);
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

if (faltantesDiferidos.length) {
  console.warn(
    `aviso: ${faltantesDiferidos.length} import(s) estáticos de módulos que están en el precache pero`
    + ' sólo se cargan por import dinámico (panel del negocio) no están precacheados.'
    + ' Sin red esos módulos no evalúan igual. No es un camino del cliente:'
    + ` ${faltantesDiferidos.slice(0, 3).join(', ')}…`,
  );
}

console.log(`precache completo: ${visitadosCliente.size} módulos del grafo estático del cliente, todos en sw.js.`);

function recorrer(relativo, cadena) {
  if (visitados.has(relativo)) return;
  visitados.add(relativo);
  const absoluto = path.join(ROOT, relativo);
  if (!fs.existsSync(absoluto)) {
    inexistentes.push(`${relativo} (desde ${cadena[cadena.length - 1] || 'entrada'})`);
    return;
  }
  const fuente = fs.readFileSync(absoluto, 'utf8');
  for (const match of fuente.matchAll(DEPENDENCIA_ESTATICA)) {
    const especificador = match[1];
    if (!especificador.startsWith('.')) continue;
    const hijo = path
      .relative(ROOT, path.resolve(path.dirname(absoluto), especificador))
      .replace(/\\/g, '/');
    if (!listados.has(hijo) && !faltantes.has(hijo)) faltantes.set(hijo, [...cadena, relativo]);
    recorrer(hijo, [...cadena, relativo]);
  }
}
