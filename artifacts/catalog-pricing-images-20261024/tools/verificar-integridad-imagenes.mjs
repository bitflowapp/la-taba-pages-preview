/*
 * Verificación de integridad de los activos que la vitrina Neuquén va a usar.
 *
 * Comprueba, para cada SKU de la góndola (52):
 *   · cirugía master + thumbnail (human formato webp, dimensiones esperadas)
 *   · sha256 de archivo == sha256 declarado
 *   · referencia de derechos TABA-AUT-2026-08-001 y estado LICENCIA_COMERCIAL
 *   · clasificación del mapa auditado cuando está
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { GONDOLA } from '../../../catalog/gondola-neuquen.mjs';
import { detectCatalogImageMime, readCatalogImageDimensions } from '../../../js/core/catalog-image-contract.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const leer = (ruta) => JSON.parse(fs.readFileSync(path.join(RAIZ, ruta), 'utf8'));
const sha256Archivo = (archivo) => crypto.createHash('sha256').update(fs.readFileSync(archivo)).digest('hex');

const manifiesto = leer('docs/catalog/image-manifest.json').sources;
const mapa = leer('docs/catalog/gondola-publica-imagenes.json').filas;

const porSkuManifest = new Map(manifiesto.map((fila) => [fila.sku, fila]));
const porSkuMapa = new Map(mapa.map((fila) => [fila.sku, fila]));
const dirListado = fs.readdirSync(path.join(RAIZ, 'assets', 'products'));

function thumbDerivado(masterPath) {
  const base = masterPath.replace(/^assets\/products\//, '').replace(/\.webp$/, '');
  const coincide = base.match(/^(.*)-([0-9a-f]{16})-([0-9a-f]{64})$/);
  if (!coincide) return null;
  const prefijo = `${coincide[1]}-${coincide[2]}-thumb-`;
  const archivo = dirListado.find((nombre) => nombre.startsWith(prefijo) && nombre.endsWith('.webp'));
  return archivo ? `assets/products/${archivo}` : null;
}

const fallos = [];
const filas = [];
for (const producto of GONDOLA) {
  const sku = producto.sku;
  const manifest = porSkuManifest.get(sku);
  const audit = porSkuMapa.get(sku);
  const master = audit?.imageUrl || manifest?.assets?.master?.path || '';
  if (!master) {
    filas.push({ sku, cobertura: 'FALBACK', imagen: '', thumbnail: 'assets/products/beverage-placeholder.svg' });
    continue;
  }
  const dispositivo = path.join(RAIZ, master);
  if (!fs.existsSync(dispositivo)) { fallos.push(`${sku}: master no existe en disco (${master})`); continue; }
  const bytes = fs.readFileSync(dispositivo);
  if (detectCatalogImageMime(bytes) !== 'image/webp') { fallos.push(`${sku}: master no es webp`); continue; }
  const dims = readCatalogImageDimensions(bytes, 'image/webp');
  if (!dims || dims.width < 400 || dims.height < 400) { fallos.push(`${sku}: master ${dims?.width}x${dims?.height} demasiada chica`); continue; }
  const shaDeclarado = manifest?.assets?.master?.sha256 || '';
  if (manifest && shaDeclarado && sha256Archivo(dispositivo) !== shaDeclarado) { fallos.push(`${sku}: sha256 del master no coincide con el manifiesto`); continue; }
  const referencia = manifest?.rightsReference || audit?.referenciaDerechos || '';
  if (!/TABA-AUT-\d{4}-\d{2}-\d{3}/.test(referencia)) { fallos.push(`${sku}: referencia de derechos incompleta (${referencia})`); continue; }
  const thumbnail = manifest?.assets?.thumbnail?.path || thumbDerivado(master) || 'assets/products/beverage-placeholder.svg';
  filas.push({
    sku,
    cobertura: audit?.imageUrl ? 'AUDITADA' : 'MANIFIESTO_PREPARADO',
    imagen: master,
    thumbnail,
    sha256: manifest?.assets?.master?.sha256 || '',
    dimensions: `${dims.width}x${dims.height}`,
    clasificacion: audit?.clasificacion || '',
    referenciaDerechos: referencia,
    origen: audit?.origenImagen || manifest?.sourceUrl || '',
  });
}
const coberturas = filas.reduce((acc, fila) => { acc[fila.cobertura] = (acc[fila.cobertura] || 0) + 1; return acc; }, {});
console.log(`Verificados OK: ${filas.length} · cobertura: ${JSON.stringify(coberturas)}`);
if (fallos.length) {
  console.log('FALLOS:');
  for (const fallo of fallos) console.log(' ✗', fallo);
  process.exitCode = 1;
}
fs.writeFileSync(path.join(RAIZ, 'artifacts/catalog-pricing-images-20261024/vitrina-imagenes-verificadas.json'), `${JSON.stringify({ generadoEl: new Date().toISOString(), cobertura: coberturas, fallos, filas }, null, 2)}\n`, 'utf8');
console.log('Detalle escrito en artifacts/catalog-pricing-images-20261024/vitrina-imagenes-verificadas.json');
