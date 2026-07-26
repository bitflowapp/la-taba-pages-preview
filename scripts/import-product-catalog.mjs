import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  POSTGRES_INTEGER_MAX,
  PRODUCT_PRICE_MAX,
  parseCatalogBoolean,
  parseCatalogTags,
  validateCatalog,
} from './validate-product-catalog.mjs';
import { findManifestSource } from './catalog-images/lib.mjs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseImportArgs(args = []) {
  const unknownFlags = args.filter((argument) => (
    argument.startsWith('--')
    && !['--dry-run', '--apply', '--business-id'].includes(argument)
  ));
  if (unknownFlags.length) throw new Error(`Flag desconocido: ${unknownFlags[0]}.`);

  const dryRun = args.includes('--dry-run');
  const apply = args.includes('--apply');
  if (dryRun === apply) {
    throw new Error('Elegí exactamente un modo: --dry-run o --apply.');
  }

  const positionals = args.filter((argument, index) => (
    !argument.startsWith('--')
    && args[index - 1] !== '--business-id'
  ));
  const businessFlagIndex = args.indexOf('--business-id');
  const businessId = businessFlagIndex >= 0 ? args[businessFlagIndex + 1] : '';
  if (businessFlagIndex >= 0 && (!businessId || businessId.startsWith('--'))) {
    throw new Error('--business-id requiere un UUID.');
  }
  if (positionals.length !== 1) {
    throw new Error('Indicá exactamente un archivo CSV.');
  }

  return {
    file: positionals[0],
    mode: apply ? 'apply' : 'dry-run',
    businessId,
  };
}

export function createCatalogImportPlan(text, {
  businessId,
  fileExists = fs.existsSync,
  imageManifest,
} = {}) {
  if (!UUID_PATTERN.test(String(businessId || ''))) {
    return {
      errors: ['business_id debe ser un UUID válido.'],
      entries: [],
    };
  }

  const validation = validateCatalog(text, { fileExists, imageManifest });
  if (validation.errors.length) {
    return {
      errors: validation.errors,
      entries: [],
    };
  }

  const entries = validation.products
    .map((product) => mapCatalogProduct(
      product,
      businessId,
      findManifestSource(imageManifest, product.external_id, product.sku),
    ))
    .sort((left, right) => compareText(left.row.external_id, right.row.external_id)
      || compareText(left.row.sku, right.row.sku));
  const payload = entries.map((entry) => entry.row);

  return {
    errors: [],
    entries,
    catalogSha256: sha256(text),
    payloadSha256: sha256(stableStringify(payload)),
    requestedAvailableCount: entries.filter((entry) => entry.requestedAvailable).length,
    businessId,
  };
}

export function mapCatalogProduct(product, businessId, manifestSource) {
  const alcoholic = parseCatalogBoolean(product.alcoholic) === true;
  const featured = parseCatalogBoolean(product.featured) === true;
  const tags = parseCatalogTags(product.tags);
  if (featured && !tags.includes('destacado')) tags.push('destacado');
  tags.sort();

  return {
    requestedAvailable: parseCatalogBoolean(product.available) === true,
    assetRegistration: {
      external_id: manifestSource.externalId,
      sku: manifestSource.sku,
      safe_sku: manifestSource.safeSku,
      identity_sha256: manifestSource.identitySha256,
      master_path: manifestSource.assets.master.path,
      master_sha256: manifestSource.assets.master.sha256,
      master_binding_sha256: manifestSource.assets.master.bindingSha256,
      thumbnail_path: manifestSource.assets.thumbnail.path,
      thumbnail_sha256: manifestSource.assets.thumbnail.sha256,
      thumbnail_binding_sha256: manifestSource.assets.thumbnail.bindingSha256,
      source_sha256: manifestSource.sourceSha256,
      source_url: manifestSource.sourceUrl,
      rights_status: manifestSource.rightsStatus,
      rights_reference: manifestSource.rightsReference,
    },
    row: {
      business_id: businessId,
      external_id: product.external_id,
      sku: product.sku,
      brand: product.brand,
      name: product.name,
      variant: product.variant,
      presentation: product.variant,
      category: product.category,
      subcategory: product.subcategory,
      capacity_value: Number(product.capacity_value),
      capacity_unit: product.capacity_unit.toLowerCase(),
      capacity: `${normalizeDecimal(product.capacity_value)} ${product.capacity_unit.toLowerCase()}`,
      packaging_type: product.package_type,
      units_per_pack: Number(product.units_per_pack),
      price: Number(product.price),
      stock: Number(product.stock),
      chilled: parseCatalogBoolean(product.chilled) === true,
      is_alcoholic: alcoholic,
      minimum_age: alcoholic ? Number(product.minimum_age) : null,
      sort_order: Number(product.sort_order),
      image_url: manifestSource.assets.master.path,
      image_sha256: manifestSource.assets.master.sha256,
      image_thumbnail_url: manifestSource.assets.thumbnail.path,
      image_thumbnail_sha256: manifestSource.assets.thumbnail.sha256,
      source_image_sha256: manifestSource.sourceSha256,
      tags,
      is_active: true,
      available: false,
      is_verified: false,
      verified_at: null,
      verified_by: null,
    },
  };
}

export async function applyCatalogImport(client, plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new Error('El plan de importación debe ser un objeto no nulo.');
  }
  if (!Array.isArray(plan.errors) || plan.errors.length) {
    throw new Error('No se puede importar un catálogo inválido.');
  }
  if (!Array.isArray(plan.entries) || !plan.entries.length) {
    throw new Error('No se puede importar un catálogo vacío.');
  }
  if (!UUID_PATTERN.test(String(plan.businessId || ''))) {
    throw new Error('El plan de importación no tiene un business_id válido.');
  }
  if (!client?.rpc) throw new Error('Cliente Supabase inválido.');

  const assets = plan.entries.map((entry) => entry.assetRegistration);
  const payload = plan.entries.map((entry) => stageProductPayload(entry.row));
  assertImportPayloadNumbers(payload);
  const imported = await client.rpc('import_catalog_batch', {
    p_business_id: plan.businessId,
    p_assets: assets,
    p_products: payload,
  });
  if (imported?.error) {
    throw new Error(`Supabase rechazó la importación atómica: ${imported.error.message || 'error desconocido'}`);
  }
  const data = imported?.data;
  assertAtomicImportResponse(data, payload);
  return {
    imported: data.length,
    rows: data,
    payloadSha256: plan.payloadSha256,
  };
}

function assertImportPayloadNumbers(payload) {
  for (const row of payload) {
    const price = Number(row?.price);
    const capacityValue = Number(row?.capacity_value);
    if (
      !/^\d+(?:\.\d{1,2})?$/.test(String(row?.price ?? ''))
      || !Number.isFinite(price)
      || price <= 0
      || price > PRODUCT_PRICE_MAX
    ) {
      throw new Error(`Precio fuera de rango antes del RPC para ${row?.external_id || 'producto'}.`);
    }
    if (
      !/^\d+(?:\.\d+)?$/.test(String(row?.capacity_value ?? ''))
      || !Number.isFinite(capacityValue)
      || capacityValue <= 0
    ) {
      throw new Error(`Capacidad no finita o inválida antes del RPC para ${row?.external_id || 'producto'}.`);
    }
    for (const [field, minimum] of [
      ['stock', 0],
      ['sort_order', 0],
      ['units_per_pack', 1],
    ]) {
      const value = Number(row?.[field]);
      if (
        !Number.isInteger(value)
        || value < minimum
        || value > POSTGRES_INTEGER_MAX
      ) {
        throw new Error(`${field} fuera de rango antes del RPC para ${row?.external_id || 'producto'}.`);
      }
    }
    const minimumAge = row?.minimum_age;
    if (
      row?.is_alcoholic === true
      && (
        !Number.isInteger(Number(minimumAge))
        || Number(minimumAge) < 18
        || Number(minimumAge) > 99
      )
    ) {
      throw new Error(`minimum_age fuera de rango antes del RPC para ${row?.external_id || 'producto'}.`);
    }
    if (row?.is_alcoholic !== true && minimumAge !== null) {
      throw new Error(`minimum_age inesperado antes del RPC para ${row?.external_id || 'producto'}.`);
    }
  }
}

function assertAtomicImportResponse(data, payload) {
  if (!Array.isArray(data)) {
    throw new Error('Supabase no devolvió una respuesta de importación no nula.');
  }
  if (data.length !== payload.length) {
    throw new Error(`Supabase devolvió ${data.length} de ${payload.length} filas esperadas.`);
  }
  const expected = new Set(payload.map((row) => `${row.external_id}\u0000${row.sku}`));
  const seen = new Set();
  for (const row of data) {
    const key = `${row?.staged_external_id || ''}\u0000${row?.staged_sku || ''}`;
    if (
      !expected.has(key)
      || seen.has(key)
      || row?.staged_is_verified !== false
      || row?.staged_available !== false
      || !UUID_PATTERN.test(String(row?.product_id || ''))
    ) {
      throw new Error('Supabase devolvió una respuesta de importación inconsistente.');
    }
    seen.add(key);
  }
}

function stageProductPayload(row) {
  const {
    business_id: _businessId,
    is_verified: _isVerified,
    verified_at: _verifiedAt,
    verified_by: _verifiedBy,
    ...payload
  } = row;
  return payload;
}

function normalizeDecimal(value) {
  const number = Number(value);
  return Number.isInteger(number) ? String(number) : String(number);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function validateImportCredentials(env = {}) {
  const url = env.SUPABASE_URL || '';
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '';
  const accessToken = env.SUPABASE_ACCESS_TOKEN || '';
  if (!/^https:\/\//i.test(url)) throw new Error('Falta SUPABASE_URL HTTPS.');
  if (!publishableKey) throw new Error('Falta SUPABASE_PUBLISHABLE_KEY o SUPABASE_ANON_KEY.');
  if (/^sb_secret_/i.test(publishableKey) || jwtRole(publishableKey) === 'service_role') {
    throw new Error('No uses una clave secreta/service_role en este importador.');
  }
  if (!accessToken) throw new Error('Falta SUPABASE_ACCESS_TOKEN de un owner/admin autenticado.');
  if (jwtRole(accessToken) !== 'authenticated') {
    throw new Error('SUPABASE_ACCESS_TOKEN debe ser un JWT de usuario authenticated.');
  }
  return { accessToken, publishableKey, url };
}

function importClientFromEnvironment(env = process.env) {
  const { accessToken, publishableKey, url } = validateImportCredentials(env);

  return createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

async function main() {
  let options;
  try {
    options = parseImportArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR ${error.message}`);
    console.error('Uso: node scripts/import-product-catalog.mjs archivo.csv --business-id UUID (--dry-run|--apply)');
    process.exitCode = 2;
    return;
  }

  const businessId = options.businessId || process.env.TABA_BUSINESS_ID || '';
  let text;
  try {
    text = fs.readFileSync(path.resolve(options.file), 'utf8');
  } catch (error) {
    console.error(`ERROR No se pudo leer ${options.file}: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  let plan;
  try {
    plan = createCatalogImportPlan(text, {
      businessId,
      fileExists: (candidate) => fs.existsSync(path.resolve(candidate)),
      imageManifest: readImageManifest(),
    });
  } catch (error) {
    console.error(`ERROR ${error.message}`);
    process.exitCode = 1;
    return;
  }
  for (const error of plan.errors) console.error(`ERROR ${error}`);
  if (plan.errors.length) {
    process.exitCode = 1;
    return;
  }

  console.log(`Plan válido: ${plan.entries.length} producto(s).`);
  console.log(`CSV sha256=${plan.catalogSha256}`);
  console.log(`Payload sha256=${plan.payloadSha256}`);
  console.log(`Intención CSV: ${plan.requestedAvailableCount} producto(s) disponibles tras revisión.`);
  for (const entry of plan.entries) {
    console.log([
      'PLAN',
      entry.row.external_id,
      entry.row.sku,
      entry.row.category,
      `requested_available=${entry.requestedAvailable}`,
      'stored_available=false',
      'stored_verified=false',
    ].join(' | '));
  }
  console.log('Seguridad: todas las filas se escribirán available=false e is_verified=false.');

  if (options.mode === 'dry-run') {
    console.log('Dry-run completo; no se conectó a Supabase.');
    return;
  }

  try {
    const result = await applyCatalogImport(importClientFromEnvironment(), plan);
    console.log(`Importación aplicada: ${result.imported} fila(s) despublicadas.`);
    console.log('Pendiente: verificación humana y publicación separada.');
  } catch (error) {
    console.error(`ERROR ${error.message}`);
    process.exitCode = 1;
  }
}

function readImageManifest() {
  const manifestPath = path.resolve('docs/catalog/image-manifest.json');
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`No se pudo leer ${manifestPath}: ${error.message}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  await main();
}

function jwtRole(value) {
  const [, payload = ''] = String(value || '').split('.');
  if (!payload) return '';
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).role || '';
  } catch {
    return '';
  }
}

function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
