// Muestra los nombres únicos de La Anónima que interesan, por categoría, para construir reglas de matching.
import { readdirSync, readFileSync } from 'node:fs';
import { parseCsv } from './parse-csv.mjs';

const dir = 'artifacts/catalog-pricing-images-20261024/fuentes/laanonima';
const KEYS = /coca|sprite|fanta|seven|7-up|7up|pepsi|villav|benedict|aquarius|red bull|monster|speed|gatorade|powerade|manaos|paso de los|villa del sur|quilmes|brahma|budwei|stella|corona|andes origen|patagonia|fernet|1882|gancia|dr\.? lemon|trapiche|dada|cafayate|toro|gordon|skyy/i;

const seen = new Map();
for (const f of readdirSync(dir).filter((x) => x.endsWith('.csv'))) {
  const cat = f.replace('.csv', '');
  if (f === 'nombres-unicos.txt.csv') continue;
  const rows = parseCsv(readFileSync(`${dir}/${f}`, 'utf8'));
  const hdr = rows[0];
  const iN = hdr.indexOf('nombre'), iM = hdr.indexOf('marca'), iC = hdr.indexOf('codigo'), iR = hdr.indexOf('precioRegular'), iP = hdr.indexOf('precioPromo'), iL = hdr.indexOf('precioPorUnidad');
  for (const r of rows.slice(1)) {
    const nombre = r[iN];
    if (!nombre || !KEYS.test(nombre)) continue;
    const key = `${cat}|${r[iC]}`;
    if (seen.has(key)) continue;
    seen.set(key, { cat, codigo: r[iC], marca: r[iM], nombre, regular: r[iR], promo: r[iP], litro: r[iL] });
  }
}
const out = [...seen.values()].sort((a, b) => a.cat.localeCompare(b.cat) || a.codigo.localeCompare(b.codigo));
console.log('filas únicas:', out.length);
for (const r of out) console.log(`${r.cat} | ${r.codigo} | ${r.marca} | ${r.nombre} | reg=${r.regular} promo=${r.promo ?? '-'} | ${r.litro ?? ''}`);
