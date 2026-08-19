/*
 * Fotografía del catálogo PRODUCTIVO, sólo lectura.
 *
 * POR QUÉ UNA FOTOGRAFÍA Y NO LEER LA BASE EN CADA PASO
 * ----------------------------------------------------
 * El pipeline de imágenes tiene que poder correr, revisarse y repetirse sin
 * red y sin credenciales: si cada paso consultara la base, el resultado
 * dependería del minuto en que se corrió y nadie podría reproducir una
 * revisión. La fotografía queda versionada y es el dato contra el que se
 * audita.
 *
 * LO QUE ESTE GUION NO PUEDE VER
 * ------------------------------
 * La clave publicable pasa por RLS, y RLS no devuelve los productos con
 * `available=false`. Hoy eso deja afuera los 23 alcohólicos, que están en la
 * base pero cerrados por la compuerta de licencia. No es un error de este
 * guion: es la compuerta funcionando. Esos SKU entran por
 * `catalog/gondola-neuquen.mjs`, que es el archivo que generó el lote que los
 * insertó, y quedan marcados con su procedencia.
 *
 *   node scripts/catalog-images/refresh-production-snapshot.mjs
 *
 * Variables: TABA_SUPABASE_URL y TABA_SUPABASE_PUBLISHABLE_KEY. Si faltan, se
 * leen del runtime-config publicado en TABA_PUBLIC_ORIGIN.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { stableJson } from './lib.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SALIDA = path.join(ROOT, 'catalog/production-catalog-snapshot.json');

const PRODUCTION_REF = 'wwcpogltfgzgkrlilbcd';
const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const ORIGEN_PUBLICO = process.env.TABA_PUBLIC_ORIGIN || 'https://la-taba.pages.dev';

/** Saca la configuración publicada del sitio. Es pública por diseño. */
async function configDelSitioPublicado() {
  const response = await fetch(`${ORIGEN_PUBLICO}/runtime-config.js`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`runtime-config.js respondió ${response.status}.`);
  const texto = await response.text();
  const url = texto.match(/supabaseUrl:\s*'([^']+)'/)?.[1];
  const key = texto.match(/publishableKey:\s*'([^']+)'/)?.[1];
  if (!url || !key) throw new Error('El runtime-config publicado no declara supabaseUrl y publishableKey.');
  return { url, key };
}

const desdeEntorno = process.env.TABA_SUPABASE_URL && process.env.TABA_SUPABASE_PUBLISHABLE_KEY
  ? { url: process.env.TABA_SUPABASE_URL, key: process.env.TABA_SUPABASE_PUBLISHABLE_KEY }
  : null;
const { url, key } = desdeEntorno || await configDelSitioPublicado();

// Compuerta de destino: este guion sólo mira producción. Un ref de staging acá
// significaría que la fotografía miente sobre qué catálogo se está auditando.
if (!url.includes(PRODUCTION_REF)) {
  console.error(`ABORTA: el destino no es el Supabase productivo (${PRODUCTION_REF}). Recibido: ${url}`);
  process.exit(1);
}
if (/^(eyJ|sb_secret_|service_role)/.test(key)) {
  console.error('ABORTA: la clave parece privilegiada. Este guion usa la clave publicable y nada más.');
  process.exit(1);
}

const consulta = new URL(`${url}/rest/v1/products`);
consulta.searchParams.set('select', '*');
consulta.searchParams.set('business_id', `eq.${BUSINESS_ID}`);
consulta.searchParams.set('order', 'sku.asc');
consulta.searchParams.set('limit', '500');

const response = await fetch(consulta, {
  headers: { apikey: key, authorization: `Bearer ${key}` },
  signal: AbortSignal.timeout(60_000),
});
if (!response.ok) {
  console.error(`ABORTA: la lectura respondió ${response.status}: ${await response.text()}`);
  process.exit(1);
}
const productos = await response.json();
if (!Array.isArray(productos) || productos.length === 0) {
  console.error('ABORTA: la lectura no devolvió productos. No se pisa la fotografía anterior con nada.');
  process.exit(1);
}

// La fotografía guarda sólo lo que el pipeline de imágenes necesita. Menos
// columnas es menos superficie para que un dato comercial viaje sin motivo.
const filas = productos.map((producto) => ({
  available: producto.available === true,
  brand: producto.brand || '',
  capacityUnit: producto.capacity_unit || '',
  capacityValue: producto.capacity_value ?? null,
  catalogAssetId: producto.catalog_asset_id || null,
  category: producto.category || '',
  externalId: producto.external_id || '',
  imageUrl: producto.image_url || null,
  isAlcoholic: producto.is_alcoholic === true,
  name: producto.name || '',
  packagingType: producto.packaging_type || '',
  price: producto.price ?? null,
  sku: producto.sku || '',
  soldAsPack: producto.sold_as_pack === true,
  unitsPerPack: producto.units_per_pack ?? 1,
  variant: producto.variant || '',
}));

await fs.writeFile(SALIDA, stableJson({
  businessId: BUSINESS_ID,
  doc: 'Sólo lectura. Lo que la clave publicable ve de products en producción. RLS oculta los available=false.',
  projectRef: PRODUCTION_REF,
  productos: filas,
  schemaVersion: 1,
  visiblesParaLaClavePublicable: filas.length,
}), 'utf8');

console.log(`Fotografía escrita: ${path.relative(ROOT, SALIDA).replaceAll('\\', '/')}`);
console.log(`Productos visibles con la clave publicable: ${filas.length}`);
console.log(`  con foto: ${filas.filter((f) => f.imageUrl).length} · packs: ${filas.filter((f) => f.soldAsPack).length}`);
