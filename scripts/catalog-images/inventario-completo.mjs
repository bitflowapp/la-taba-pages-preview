import fs from 'node:fs/promises';
import path from 'node:path';
import { loadCatalogSkus } from './catalog-skus.mjs';
import { RETAIL_UNIDADES } from '../../catalog/retail-unidades.mjs';
import { PRODUCTOS_PROPUESTOS } from '../../catalog/gondola-retail-final-proposal.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const leer = async (ruta) => JSON.parse(await fs.readFile(path.join(ROOT, ruta), 'utf8'));
const [catalogo, auditoria, manifiesto] = await Promise.all([
  loadCatalogSkus(ROOT),
  leer('docs/catalog/gondola-publica-imagenes.json'),
  leer('docs/catalog/image-manifest.json'),
]);

const auditPorSku = new Map(auditoria.filas.map((fila) => [fila.sku, fila]));
const fuentePorSku = new Map(manifiesto.sources.map((fuente) => [fuente.sku, fuente]));
const gtinPorSku = new Map(
  [...RETAIL_UNIDADES, ...PRODUCTOS_PROPUESTOS]
    .filter((fila) => fila.gtin)
    .map((fila) => [fila.sku, fila.gtin]),
);

const filas = catalogo.skus.map((producto) => {
  const actual = auditPorSku.get(producto.sku);
  const fuente = fuentePorSku.get(producto.sku);
  return {
    sku: producto.sku,
    nombre: producto.name,
    marca: producto.brand,
    variante: producto.variant,
    capacidad: `${producto.capacityValue} ${producto.capacityUnit}`,
    envase: producto.packagingType,
    presentacion: producto.soldAsPack ? `Pack x${producto.unitsPerPack}` : 'Unidad',
    unidadOPack: producto.soldAsPack ? 'PACK' : 'UNIDAD',
    gtin: gtinPorSku.get(producto.sku) || '',
    disponible: producto.available,
    imageUrlActual: actual?.imageUrl || producto.imageUrl || '',
    tipoActual: actual?.tipo || 'FALLBACK',
    imageUrlPreparada: fuente?.assets?.master?.path || '',
    tipoPreparado: fuente ? 'REAL' : 'FALLBACK',
    fuente: fuente?.sourceUrl || '',
    sourceType: fuente?.sourceType || '',
  };
});

const contar = (campo) => Object.fromEntries(
  ['REAL', 'FALLBACK', 'INCORRECT', 'MISSING'].map((tipo) => [
    tipo,
    filas.filter((fila) => fila[campo] === tipo).length,
  ]),
);
const informe = {
  schemaVersion: 1,
  generadoEl: new Date().toISOString(),
  autoridad: '72 SKU reconciliados por scripts/catalog-images/catalog-skus.mjs; producción pública para disponible/imagen actual',
  nota: 'Para SKU no visibles por RLS, tipoActual=FALLBACK significa que la fotografía actual no es comprobable públicamente; tipoPreparado refleja los assets exactos listos en este lote.',
  total: filas.length,
  comprables: filas.filter((fila) => fila.disponible).length,
  before: contar('tipoActual'),
  prepared: contar('tipoPreparado'),
  filas,
};

const columnas = Object.keys(filas[0]);
const csv = (valor) => {
  const texto = String(valor ?? '');
  return /[",\r\n]/.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto;
};
await fs.writeFile(
  path.join(ROOT, 'docs/catalog/inventario-completo-imagenes.json'),
  `${JSON.stringify(informe, null, 2)}\n`,
  'utf8',
);
await fs.writeFile(
  path.join(ROOT, 'docs/catalog/inventario-completo-imagenes.csv'),
  `${columnas.join(',')}\n${filas.map((fila) => columnas.map((columna) => csv(fila[columna])).join(',')).join('\n')}\n`,
  'utf8',
);
console.log(`Inventario completo: ${filas.length} SKU · ${informe.comprables} comprables`);
console.log(`Antes: ${JSON.stringify(informe.before)} · preparado: ${JSON.stringify(informe.prepared)}`);
