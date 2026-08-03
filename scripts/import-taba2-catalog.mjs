import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DEFAULT_FILE = path.join(ROOT, 'catalog/products.json');
const mode = process.argv.find((value) => ['validate', 'plan', 'apply-local', 'apply-staging'].includes(value)) || 'validate';
const catalogFile = process.argv.find((value) => value.endsWith('.json')) || DEFAULT_FILE;

if (mode === 'apply-staging' && process.env.TABA2_ALLOW_STAGING_APPLY !== '1') {
  console.error('apply-staging bloqueado: requiere TABA2_ALLOW_STAGING_APPLY=1 y una integración autorizada.');
  process.exit(2);
}

const products = JSON.parse(await fs.readFile(path.resolve(catalogFile), 'utf8'));
const report = validate(products);
const summary = {
  mode,
  source: path.relative(ROOT, path.resolve(catalogFile)).replaceAll('\\', '/'),
  products: products.length,
  pendingPrices: products.filter((product) => product.price_status === 'pending').length,
  reviewOnly: products.filter((product) => product.catalog_status === 'review_only').length,
  rejected: products.filter((product) => product.catalog_status === 'rejected').length,
  errors: report.errors,
  warnings: report.warnings,
};

if (mode === 'validate') {
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = report.errors.length ? 1 : 0;
} else if (mode === 'plan') {
  console.log(JSON.stringify({ ...summary, changes: products.map(changeFor) }, null, 2));
  process.exitCode = report.errors.length ? 1 : 0;
} else if (mode === 'apply-local') {
  if (report.errors.length) {
    console.error(JSON.stringify(summary, null, 2));
    process.exit(1);
  }
  const destination = path.join(ROOT, 'catalog/import-plan.json');
  await fs.writeFile(destination, `${JSON.stringify({ ...summary, changes: products.map(changeFor) }, null, 2)}\n`);
  console.log(`Plan local generado en ${path.relative(ROOT, destination)}. No se modificó una base de datos.`);
} else {
  console.error('apply-staging autorizado por entorno, pero este importador no tiene un adaptador de staging configurado; no se aplicó ningún cambio.');
  process.exit(2);
}

function validate(items) {
  const errors = [];
  const warnings = [];
  if (!Array.isArray(items)) return { errors: ['El catálogo debe ser un array JSON.'], warnings };
  const ids = new Set();
  const skus = new Set();
  for (const product of items) {
    const label = product?.sku || product?.id || 'producto sin SKU';
    if (!product?.id || !product?.sku || !product?.brand || !product?.name || !product?.category_id) {
      errors.push(`${label}: faltan campos de identidad obligatorios.`);
    }
    if (ids.has(product?.id)) errors.push(`${label}: id duplicado.`);
    if (skus.has(product?.sku)) errors.push(`${label}: SKU duplicado.`);
    ids.add(product?.id);
    skus.add(product?.sku);
    if (product?.catalog_status === 'rejected') {
      if (product?.is_active === true) errors.push(`${label}: un activo rechazado no puede estar activo.`);
      continue;
    }
    if (product?.price_status === 'pending') {
      if (product.price != null || product.regular_price != null) errors.push(`${label}: un precio pendiente debe ser null.`);
      if (product.is_active === true) warnings.push(`${label}: visible de revisión, pero no publicable hasta derechos e inventario.`);
    } else if (!(Number.isFinite(product?.price) && product.price > 0)) {
      errors.push(`${label}: precio confirmado inválido.`);
    }
    if (product?.catalog_status === 'review_only' && product?.image_rights_status !== 'pending_review') {
      errors.push(`${label}: review_only exige image_rights_status=pending_review.`);
    }
    if (product?.catalog_status === 'review_only') warnings.push(`${label}: no se aplicará a producción.`);
  }
  return { errors, warnings };
}

function changeFor(product) {
  return {
    sku: product.sku,
    operation: product.catalog_status === 'rejected' ? 'reject' : product.catalog_status === 'review_only' ? 'hold_for_rights' : 'upsert',
    price_status: product.price_status,
    rights_status: product.image_rights_status,
  };
}
