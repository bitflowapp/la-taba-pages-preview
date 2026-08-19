/*
 * Aprobar una fuente ya mirada.
 *
 * Aprobar no es un cálculo: es alguien que abrió la imagen y dijo que muestra
 * este producto y no otro. Por eso este paso es un guion aparte, pide quién
 * revisó, y se niega a aprobar lo que el pipeline dejó fuera del alcance de
 * derechos. Sin este archivo, `stage-candidates` tendría que decidir por una
 * persona, y ahí es donde se cuelan las fotos equivocadas.
 *
 *   node scripts/catalog-images/approve.mjs --revisado-por "Nombre" --sku a --sku b
 *   node scripts/catalog-images/approve.mjs --revisado-por "Nombre" --todas-las-revisables
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parseCsv } from '../validate-product-catalog.mjs';
import { recordsFromCsvRows, IMAGE_AUDIT_COLUMNS } from './lib.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const AUDIT = path.join(ROOT, 'docs/catalog/image-source-audit.csv');
const HOY = new Date().toISOString().slice(0, 10);

function args(name) {
  const salida = [];
  process.argv.forEach((valor, indice) => {
    if (valor === `--${name}`) salida.push(process.argv[indice + 1]);
  });
  return salida.filter(Boolean);
}

const revisadoPor = args('revisado-por')[0];
const pedidos = new Set(args('sku'));
const todas = process.argv.includes('--todas-las-revisables');

if (!revisadoPor) {
  console.error('ERROR Falta --revisado-por. Una aprobación sin responsable no es una aprobación.');
  process.exit(1);
}
if (!pedidos.size && !todas) {
  console.error('ERROR Indicá --sku o --todas-las-revisables.');
  process.exit(1);
}

const { records } = recordsFromCsvRows(parseCsv(await fs.readFile(AUDIT, 'utf8')));
const cambiadas = [];
const rechazadas = [];

for (const fila of records) {
  if (!fila.sku) continue;
  const elegida = todas ? fila.status === 'REVISAR_IMAGEN' : pedidos.has(fila.sku);
  if (!elegida) continue;

  // Una fila sin derechos en alcance no se aprueba ni pidiéndolo explícitamente.
  // Mirar la foto resuelve si es el producto correcto, no si se puede publicar.
  if (fila.status === 'PENDIENTE_DERECHOS' || !fila.rights_status) {
    rechazadas.push(`${fila.sku}: sin derechos en alcance (${fila.status}). Mirar la foto no arregla los derechos.`);
    continue;
  }
  if (fila.status === 'APROBADA') continue;

  fila.status = 'APROBADA';
  fila.checked_at = HOY;
  fila.notes = `${fila.notes || ''} · revisada visualmente por ${revisadoPor} el ${HOY}`.replace(/^ · /, '');
  cambiadas.push(fila.sku);
}

for (const motivo of rechazadas) console.error(`NO SE APRUEBA ${motivo}`);

const escapar = (valor) => {
  const texto = String(valor ?? '');
  return /[",\n]/.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto;
};
const csv = [
  IMAGE_AUDIT_COLUMNS.join(','),
  ...records.filter((fila) => fila.sku).map((fila) => IMAGE_AUDIT_COLUMNS.map((c) => escapar(fila[c])).join(',')),
].join('\n');
await fs.writeFile(AUDIT, `${csv}\n`, 'utf8');

console.log(`Aprobadas: ${cambiadas.length}`);
for (const sku of cambiadas) console.log(`  ${sku}`);
if (rechazadas.length) process.exitCode = 1;
