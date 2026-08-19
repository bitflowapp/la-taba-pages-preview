/*
 * Qué fotos de producto pueden viajar en el paquete. En positivo.
 *
 * POR QUÉ EN POSITIVO
 * -------------------
 * Antes el empaquetado copiaba `assets/` entero y descontaba una lista de
 * bloqueados. Esa forma funciona sólo mientras el auditor conozca cada archivo:
 * el día que aparece uno que nadie declaró, la resta no lo alcanza y el archivo
 * sale publicado. Acá se invierte: se escribe la lista de lo que SÍ puede
 * viajar, y el empaquetado copia esa lista. Lo que no está, no viaja, y no hace
 * falta que nadie lo haya previsto.
 *
 * ALCANCE. Gobierna `assets/products/` y `assets/catalog/`, que es donde la
 * base pone las rutas de las fotos de producto. La decoración del sitio
 * (`assets/promos/`, `assets/brand/`) es otra pregunta y se lista aparte, sin
 * decidirla acá.
 *
 *   node scripts/catalog-images/build-public-asset-manifest.mjs
 *   node scripts/catalog-images/build-public-asset-manifest.mjs --check
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { auditProductImageRights, decorativeImages } from '../lib/publishable-image-rights.mjs';
import { sha256, stableJson } from './lib.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SALIDA = path.join(ROOT, 'catalog/PUBLIC-PRODUCT-ASSETS.json');
const soloVerificar = process.argv.includes('--check');

const auditoria = auditProductImageRights(ROOT);
const publicables = auditoria.filter((imagen) => imagen.publishable);

const entradas = [];
for (const imagen of publicables) {
  const bytes = await fs.readFile(path.join(ROOT, imagen.path));
  entradas.push({
    bytes: bytes.length,
    derechos: imagen.rights,
    ruta: imagen.path,
    sha256: sha256(bytes),
  });
}
entradas.sort((a, b) => (a.ruta < b.ruta ? -1 : 1));

const bloqueadasPorMotivo = {};
for (const imagen of auditoria) {
  if (imagen.publishable) continue;
  bloqueadasPorMotivo[imagen.rights] = (bloqueadasPorMotivo[imagen.rights] || 0) + 1;
}

const manifiesto = {
  bloqueadas: auditoria.length - publicables.length,
  bloqueadasPorMotivo,
  decorativas: {
    cantidad: decorativeImages(ROOT).length,
    doc: 'Imágenes de sitio, no de producto. Viajan por su propia decisión y no las gobierna este manifiesto.',
  },
  doc: 'Las ÚNICAS fotos de producto que el empaquetado puede copiar. Generado por scripts/catalog-images/build-public-asset-manifest.mjs; no editar a mano.',
  fotosDeProductoAuditadas: auditoria.length,
  publicables: entradas,
  schemaVersion: 1,
};

const texto = stableJson(manifiesto);
if (soloVerificar) {
  const enDisco = await fs.readFile(SALIDA, 'utf8').catch(() => null);
  if (enDisco !== texto) {
    console.error('ERROR PUBLIC-PRODUCT-ASSETS.json está desactualizado. Correr sin --check.');
    process.exit(1);
  }
  console.log(`PUBLIC-PRODUCT-ASSETS.json al día: ${entradas.length} publicables, ${manifiesto.bloqueadas} bloqueadas.`);
  process.exit(0);
}

await fs.writeFile(SALIDA, texto, 'utf8');
console.log(`Manifiesto público: ${path.relative(ROOT, SALIDA).replaceAll('\\', '/')}`);
console.log(`  publicables: ${entradas.length}`);
console.log(`  bloqueadas:  ${manifiesto.bloqueadas} (${Object.entries(bloqueadasPorMotivo).map(([k, v]) => `${v} ${k}`).join(', ')})`);
console.log(`  decorativas fuera de este control: ${manifiesto.decorativas.cantidad}`);
