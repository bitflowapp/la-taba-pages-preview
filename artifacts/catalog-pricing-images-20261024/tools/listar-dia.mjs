// Lista filas únicas de DIA resultados.csv por consulta.
import { readFileSync } from 'node:fs';
import { parseCsv } from './parse-csv.mjs';

const rows = parseCsv(readFileSync('artifacts/catalog-pricing-images-20261024/fuentes/dia/resultados.csv', 'utf8'));
const hdr = rows[0];
const iS = hdr.indexOf('skuBuscado'), iP = hdr.indexOf('producto'), iPr = hdr.indexOf('precio'), iL = hdr.indexOf('precioLista');
const seen = new Set();
const out = [];
for (const r of rows.slice(1)) {
  const k = `${r[iS]}|${r[iP]}|${r[iPr]}`;
  if (seen.has(k)) continue;
  seen.add(k);
  out.push(`${r[iS]} || ${r[iP]} || $${r[iPr]}${r[iL] && r[iL] !== r[iPr] ? ` (lista ${r[iL]})` : ''}`);
}
console.log(out.length + ' filas únicas');
console.log(out.slice(0, 330).join('\n'));
