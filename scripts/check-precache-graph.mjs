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
 * Segundo recorrido, y ESTE TAMBIÉN CORTA: los módulos que están en el precache
 * pero sólo se alcanzan por import dinámico.
 *
 * Precachear un módulo sin precachear lo que importa no sirve de nada: sin red
 * no evalúa igual. Durante un tiempo esto fue sólo un aviso porque el caso era
 * el panel del negocio —`production-operations.js` en la lista y sus 34 imports
 * estáticos afuera— y no se quiso bloquear un gate del storefront por deuda de
 * otra superficie.
 *
 * Ya no es deuda: esos 34 módulos entraron a la lista, y el Panel abre sin red.
 * Dejarlo como aviso sería garantizar que vuelva a romperse con el próximo
 * módulo nuevo —el aviso no lo leyó nadie durante meses—. La superficie
 * operativa de un comercio no es menos importante que la del cliente: es la que
 * se usa cuando hay que aceptar un pedido con mala señal.
 */
const visitadosCliente = new Set(visitados);
const faltantesCliente = new Map(faltantes);
for (const listado of listados) {
  if (listado.endsWith('.js') && fs.existsSync(path.join(ROOT, listado))) recorrer(listado, ['precache']);
}

/*
 * LOS CUATRO DEL BACK OFFICE ENTRAN JUNTOS O NO ENTRA NINGUNO.
 *
 * `cargarBackOffice()` los pide con UN `Promise.all`. Si uno falla, la promesa
 * entera se rechaza y el back office no entra: el Panel del negocio no abre.
 *
 * Eso convierte a los cuatro en una unidad, aunque se pidan por import
 * dinámico. Y como el recorrido de arriba parte de lo que YA está en la lista,
 * un módulo de ese grupo que falte es invisible: no está listado, así que nadie
 * lo recorre.
 *
 * Fue exactamente lo que pasó. Con los 35 módulos del Panel precacheados, el
 * Panel seguía sin abrir sin red por UN archivo: `js/sandbox-tools.js`, una
 * herramienta de demostración de 9 KB que no tiene nada que ver con vender.
 * Se vio con el worker encendido y el borde tirando los módulos; no se ve
 * leyendo el código.
 */
const BACK_OFFICE = 'js/back-office.js';
const IMPORT_DINAMICO = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
const fuenteBackOffice = fs.readFileSync(path.join(ROOT, BACK_OFFICE), 'utf8');
for (const match of fuenteBackOffice.matchAll(IMPORT_DINAMICO)) {
  if (!match[1].startsWith('.')) continue;
  const rel = path
    .relative(ROOT, path.resolve(path.dirname(path.join(ROOT, BACK_OFFICE)), match[1]))
    .replace(/\\/g, '/');
  if (!listados.has(rel) && !faltantes.has(rel)) faltantes.set(rel, [BACK_OFFICE]);
  recorrer(rel, [BACK_OFFICE]);
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
if (faltantesDiferidos.length) {
  problemas.push(
    `${faltantesDiferidos.length} módulo(s) del grafo diferido (panel del negocio) fuera del precache de sw.js.`
    + ' Sin red el import estático no resuelve y el Panel no abre:',
  );
  for (const rel of faltantesDiferidos) {
    const cadena = faltantes.get(rel);
    problemas.push(`  · ${rel}   importado desde ${cadena[cadena.length - 1]}`);
  }
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

console.log(
  `precache completo: ${visitadosCliente.size} módulos del grafo estático del cliente`
  + ` y ${visitados.size - visitadosCliente.size} del grafo diferido (panel del negocio), todos en sw.js.`,
);

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
