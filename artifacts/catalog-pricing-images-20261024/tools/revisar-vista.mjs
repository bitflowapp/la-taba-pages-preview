// Vista rápida de revisión: coincidencias + propuesta en tabla de texto.
import { readFileSync } from 'node:fs';
import { parseCsv } from './parse-csv.mjs';

const base = 'artifacts/catalog-pricing-images-20261024';
const modo = process.argv[2] ?? 'todo';

if (modo === 'todo' || modo === 'coincidencias') {
  const rows = parseCsv(readFileSync(`${base}/coincidencias.csv`, 'utf8'));
  const h = rows[0];
  const iS = h.indexOf('sku'), iT = h.indexOf('tienda'), iN = h.indexOf('nombreCompetidor'), iR = h.indexOf('precioRegular'), iL = h.indexOf('precioListaDIA'), iT2 = h.indexOf('tipoCoincidencia'), iNo = h.indexOf('nota');
  console.log('═══ COINCIDENCIAS ═══');
  for (const r of rows.slice(1)) {
    const nota = r[iNo] ? ` · nota: ${r[iNo]}` : '';
    console.log(`${String(r[iS]).padEnd(34)} ${String(r[iT]).padEnd(12)} ${(r[iT2] ?? '').padEnd(7)} $${String(r[iR]).padStart(9)} ${String(r[iN]).slice(0, 46).padEnd(46)}${nota}`);
  }
}
if (modo === 'todo' || modo === 'propuesta') {
  const j = JSON.parse(readFileSync(`${base}/propuesta-precios.json`, 'utf8'));
  console.log('\n═══ PROPUESTA (estado general: ' + j.estadoGeneral + ') ═══');
  for (const r of j.filas) {
    const comp = r.comparadorMasBarato === '' ? '   —   ' : `$${String(r.comparadorMasBarato).padStart(8)}`;
    console.log(`${r.estado.padEnd(30)} vigente $${String(r.precioVigenteTABA).padStart(6)}  comp ${comp} (${r.tiendaMasBarata.padEnd(9)})  vigente..: ${String(r.descuentoVigenteVsMasBaratoPct).padStart(6)}%  ${r.sku}`);
  }
}
