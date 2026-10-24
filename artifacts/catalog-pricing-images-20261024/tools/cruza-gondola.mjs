// Cruza docs/catalog/gondola-publica-imagenes.json contra catalog/gondola-neuquen.mjs (GONDOLA, 52 SKU).
import { readFileSync } from 'node:fs';
import { parseCsv } from './parse-csv.mjs';

const j = JSON.parse(readFileSync('docs/catalog/gondola-publica-imagenes.json', 'utf8'));
const arr = Array.isArray(j) ? j : (j.products ?? j.rows ?? Object.values(j)[0]);
console.log('JSON kind:', Array.isArray(j) ? 'array' : Object.keys(j).join(','));
console.log('filas JSON:', arr.length);
const sample = arr[0];
console.log('claves:', Object.keys(sample).join(','));

const csv = parseCsv(readFileSync('docs/catalog/gondola-publica-imagenes.csv', 'utf8'));
const hdr = csv[0];
const iS = hdr.indexOf('sku'), iC = hdr.indexOf('clasificacion'), iT = hdr.indexOf('tipo'), iO = hdr.indexOf('origen_imagen');
const csvMap = new Map();
for (const r of csv.slice(1)) if (r.length > 3) csvMap.set(r[iS], { clasif: r[iC], tipo: r[iT], origen: r[iO] });

// SKUs del gondola-neuquen.mjs (campos sku: "...") — extraer por regex para no ejecutar nada.
const mjs = readFileSync('catalog/gondola-neuquen.mjs', 'utf8');
const skus = [...mjs.matchAll(/\bsku:\s*'([^']+)'/g)].map((m) => m[1]);
console.log('SKUs góndola:', skus.length);

let missing = [];
for (const s of skus) {
  if (!csvMap.has(s)) missing.push(s);
}
console.log('SKUs de la góndola SIN fila en CSV de vidriera:', missing.length);
for (const s of missing) console.log(' -', s);

// y cuántos SKUs publicables hoy están cubiertos con imagen real exacta
const exactos = [...csvMap.entries()].filter(([, v]) => v.clasif === 'OFFICIAL_EXACT' || v.clasif === 'AUTHORIZED_EXACT');
console.log('exactas en CSV:', exactos.length);
