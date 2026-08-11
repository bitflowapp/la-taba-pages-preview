/*
 * ¿El sitio publicado sirve de verdad todo lo que promete?
 *
 * Pide UNA POR UNA las entradas del precache al origen público y compara los
 * bytes con el paquete local. Dos cosas que sólo se ven así:
 *
 *  · un 404 en cualquier entrada deja `cache.addAll()` sin completar y el
 *    worker no se instala nunca —el cliente se queda con el anterior—;
 *  · un archivo que responde 200 pero con los bytes VIEJOS es la "mezcla de
 *    assets" que ningún gate local puede detectar.
 *
 * Uso: node scripts/verify-staging-served.mjs [base] [dir]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const BASE = (process.argv[2] || 'https://taba2-staging.pages.dev').replace(/\/$/, '');
const DIR = path.resolve(process.argv[3] || 'dist_release');

const worker = fs.readFileSync(path.join(DIR, 'sw.js'), 'utf8');
const entradas = [...new Set([...worker.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]))]
  .filter((entrada) => entrada && !entrada.endsWith('/'));

const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const problemas = [];
let iguales = 0;

// De a diez: el origen es una CDN, pero tampoco hace falta martillarla.
for (let i = 0; i < entradas.length; i += 10) {
  const lote = entradas.slice(i, i + 10);
  await Promise.all(lote.map(async (entrada) => {
    const rel = entrada.split('?')[0];
    const local = path.join(DIR, rel);
    let respuesta;
    try {
      respuesta = await fetch(`${BASE}/${entrada}`, { cache: 'no-store' });
    } catch (error) {
      problemas.push(`${entrada} — no respondió: ${error.message}`);
      return;
    }
    if (!respuesta.ok) {
      problemas.push(`${entrada} — HTTP ${respuesta.status}`);
      return;
    }
    if (!fs.existsSync(local)) {
      problemas.push(`${entrada} — no existe en el paquete local`);
      return;
    }
    const servido = sha(Buffer.from(await respuesta.arrayBuffer()));
    const esperado = sha(fs.readFileSync(local));
    if (servido !== esperado) problemas.push(`${entrada} — bytes distintos (servido ${servido.slice(0, 12)}… vs paquete ${esperado.slice(0, 12)}…)`);
    else iguales += 1;
  }));
}

console.log(`entradas del precache comprobadas contra ${BASE}: ${entradas.length}`);
console.log(`idénticas al paquete publicado: ${iguales}`);
if (problemas.length) {
  console.error(`\nDIFERENCIAS (${problemas.length}):`);
  problemas.forEach((linea) => console.error(`  ✗ ${linea}`));
  process.exit(1);
}
console.log('el origen sirve exactamente el paquete: sin 404 y sin mezcla de versiones.');
