// Parser CSV mínimo (RFC con comillas) + resumen de clasificación de imágenes.
import { readFileSync } from 'node:fs';

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let f = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { f += '"'; i++; }
        else q = false;
      } else f += c;
    } else if (c === '"') {
      q = true;
    } else if (c === ',') {
      row.push(f); f = '';
    } else if (c === '\n') {
      row.push(f); rows.push(row); row = []; f = '';
    } else if (c !== '\r') {
      f += c;
    }
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

if (process.argv[1] && process.argv[1].endsWith('parse-csv.mjs')) {
  const target = process.argv[2] ?? 'docs/catalog/gondola-publica-imagenes.csv';
  const rows = parseCsv(readFileSync(target, 'utf8'));
  const hdr = rows[0];
  const idx = {
    sku: hdr.indexOf('sku'),
    clasif: hdr.indexOf('clasificacion'),
    tipo: hdr.indexOf('tipo'),
    url: hdr.indexOf('image_url'),
    motivo: hdr.indexOf('motivo'),
    derechos: hdr.indexOf('derechos'),
    nombre: hdr.indexOf('nombre'),
  };
  const data = rows.slice(1).filter((r) => r.length > 3);
  const m = {};
  for (const r of data) m[r[idx.clasif]] = (m[r[idx.clasif]] ?? 0) + 1;
  console.log('TOTAL filas:', data.length);
  console.log('Por clasificacion:', JSON.stringify(m, null, 2));
  const otros = data.filter((r) => r[idx.clasif] !== 'OFFICIAL_EXACT' && r[idx.clasif] !== 'AUTHORIZED_EXACT');
  console.log('\nNo exactas:');
  for (const r of otros) {
    console.log(`- ${r[idx.sku]} | ${r[idx.clasif]} | tipo=${r[idx.tipo]} | ${(r[idx.motivo] ?? '').slice(0, 100)}`);
  }
}
