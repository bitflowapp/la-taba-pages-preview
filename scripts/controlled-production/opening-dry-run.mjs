// Ensayo de apertura: qué pasaría si se aplicara la planilla y se pidiera la
// verificación de plataforma. NO ESCRIBE NADA.
//
//   npm run opening:dry-run
//   npm run opening:dry-run -- --sheet catalog/opening/planilla-apertura-cp.csv --min-products 5
//
// 1. valida la planilla contra el catálogo real de CP con el importador
//    comercial (el mismo plan que aplicaría `opening:publish -- --apply`);
// 2. proyecta cómo quedarían precios, stock y publicación con ese plan;
// 3. dice qué compuertas quedarían pendientes y si la plataforma podría
//    verificar el comercio en ese momento.
//
// La proyección es sólo eso: la autoridad sigue siendo la base cuando se aplica.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REAL_BUSINESS_SLUG, connectControlledProduction, parseMinProducts, presentFrom, readOpeningReadiness,
  readOption, renderOpeningLines, resolveBusiness,
} from './opening-tools.mjs';
import { presentOpeningItem } from '../../js/core/store-opening-readiness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DEFAULT_SHEET = 'catalog/opening/planilla-apertura-cp.csv';

export function parseDryRunArgs(args = []) {
  const known = ['--business', '--sheet', '--min-products'];
  const unknown = args.filter((arg) => arg.startsWith('--') && !known.includes(arg));
  if (unknown.length) throw Error(`Flag desconocido: ${unknown[0]}`);
  return {
    business: readOption(args, '--business', REAL_BUSINESS_SLUG),
    sheet: readOption(args, '--sheet', DEFAULT_SHEET),
    minProducts: parseMinProducts(args, 1),
  };
}

/**
 * El catálogo después de la planilla. `products` son las filas actuales;
 * `planRows` las del plan del importador (con `after`). Mismos predicados que
 * `get_store_opening_readiness`: vendible = activo y sin alcohol (o alcohol
 * habilitado); con precio = confirmado y mayor a cero; con stock = contado y
 * mayor a cero; publicado = disponible.
 */
export function projectCatalog({ products = [], planRows = [], alcoholOpen = false, minProducts = 1 }) {
  const after = new Map(planRows.map((row) => [row.sku, row.after || {}]));
  let withPrice = 0;
  let withStock = 0;
  let published = 0;
  for (const product of products) {
    const sellable = product.is_active !== false && (!product.is_alcoholic || alcoholOpen);
    if (!sellable) continue;
    const planned = after.get(product.sku);
    const price = planned ? planned.price : (product.price_status === 'confirmed' ? Number(product.price) : null);
    const stock = planned ? planned.stock : product.stock;
    const isPublished = planned ? Boolean(planned.published) : Boolean(product.available);
    if (price !== null && price !== undefined && Number(price) > 0) withPrice += 1;
    if (stock !== null && stock !== undefined && Number(stock) > 0) withStock += 1;
    if (isPublished) published += 1;
  }
  return {
    withPrice, withStock, published,
    statuses: {
      CATALOG_PRICES: withPrice >= minProducts ? 'pass' : 'pending',
      CATALOG_STOCK: withStock >= minProducts ? 'pass' : 'pending',
      CATALOG_PUBLISHED: published >= minProducts ? 'pass' : 'pending',
    },
  };
}

/** Qué quedaría pendiente: lo de hoy, con las tres compuertas de catálogo proyectadas. */
export function projectedPending(items = [], statuses = {}) {
  return items
    .filter((item) => item.blocking)
    .map((item) => ({ ...item, status: statuses[item.code] || item.status }))
    .filter((item) => item.status !== 'pass')
    .map((item) => item.code);
}

async function main(args) {
  let options;
  try { options = parseDryRunArgs(args); } catch (error) { console.error(`ERROR ${error.message}`); process.exitCode = 2; return; }
  const { admin } = await connectControlledProduction();
  const business = await resolveBusiness(admin, options.business);
  const payload = await readOpeningReadiness(admin, business.id, options.minProducts);
  const presented = presentFrom(payload);

  console.log(`ENSAYO DE APERTURA — ${business.name} (${business.slug}). No se escribe nada.`);
  console.log('');
  console.log('HOY');
  for (const line of renderOpeningLines(presented)) console.log(line);

  const plan = spawnSync(process.execPath, [path.join(ROOT, 'scripts/import-commercial-catalog.mjs'),
    path.resolve(options.sheet), '--catalogo', 'cp', '--business', business.id, '--json'],
  { cwd: ROOT, encoding: 'utf8', timeout: 240_000, windowsHide: true });
  let parsed = null;
  try { parsed = JSON.parse(plan.stdout); } catch (_) { parsed = null; }
  console.log('');
  console.log(`PLANILLA ${options.sheet}`);
  if (!parsed) {
    console.log('✗ No se pudo validar la planilla contra el catálogo real.');
    console.log(String(plan.stderr || plan.stdout || '').split('\n').slice(-5).join('\n'));
    process.exitCode = 1;
    return;
  }
  if (parsed.errors?.length) {
    console.log(`✗ INVALID: ${parsed.errors.length} fila(s) rechazada(s). Aplicarla no escribiría nada.`);
    for (const error of parsed.errors.slice(0, 30)) console.log(`  ${error}`);
    process.exitCode = 1;
    return;
  }
  const summary = parsed.summary || {};
  console.log(`✓ VALID · ${summary.sheetRows} filas · precio ${summary.priceChanges} · stock ${summary.stockChanges} · publicación ${summary.publishChanges} · se vuelven comprables ${summary.seVuelvenComprables}`);

  const { data: products, error } = await admin.from('products')
    .select('sku,is_active,is_alcoholic,price,price_status,stock,available').eq('business_id', business.id);
  if (error) throw Error(`PRODUCTS_READ:${error.code || 'ERROR'}`);
  const alcoholOpen = payload.items.find((item) => item.code === 'ALCOHOL_POLICY')?.status === 'pass';
  const projection = projectCatalog({ products, planRows: parsed.rows || [], alcoholOpen, minProducts: options.minProducts });
  const pendingAfter = projectedPending(payload.items, projection.statuses);
  const commercialAfter = pendingAfter.filter((code) => code !== 'PLATFORM_VERIFICATION');

  console.log('');
  console.log('DESPUÉS DE APLICAR LA PLANILLA (proyección)');
  console.log(`  con precio ${projection.withPrice} · con stock ${projection.withStock} · publicados ${projection.published} (mínimo ${options.minProducts})`);
  if (commercialAfter.length) {
    console.log('  Seguiría faltando:');
    for (const code of commercialAfter) {
      const item = presentOpeningItem({ ...payload.items.find((row) => row.code === code), status: 'pending' });
      console.log(`  ✗ ${item.title}${item.where ? ` → ${item.where}` : ''}`);
    }
    console.log('');
    console.log('VERIFICACIÓN DE PLATAFORMA (simulada): la base la RECHAZARÍA (OPENING_NOT_READY).');
  } else {
    console.log('');
    console.log('VERIFICACIÓN DE PLATAFORMA (simulada): pasaría. Después, el dueño abre el local desde el Panel.');
  }
  console.log('');
  console.log('DRY-RUN: no se escribió nada.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => { console.error(`OPENING_DRY_RUN_FAILED: ${error.message}`); process.exitCode = 2; });
}
