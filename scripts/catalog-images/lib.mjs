import crypto from 'node:crypto';

export const IMAGE_AUDIT_COLUMNS = Object.freeze([
  'external_id',
  'sku',
  'source_url',
  'source_type',
  'rights_status',
  'rights_reference',
  'expected_sha256',
  'variant_verified',
  'capacity_verified',
  'package_verified',
  'pack_verified',
  'status',
  'checked_at',
  'notes',
]);

const SOURCE_TYPES = new Set([
  'fabricante',
  'marca',
  'distribuidor_oficial',
  'proveedor_aprobado',
  'propio',
]);
const RIGHTS_STATUSES = new Set([
  'APROBADOS',
  'PENDIENTE_DERECHOS',
  'NO_AUTORIZADOS',
  'PROPIO',
  'LICENCIA_COMERCIAL',
  'PERMISO_DOCUMENTADO',
]);
const REVIEW_STATUSES = new Set([
  'APROBADA',
  'REVISAR_DATOS',
  'REVISAR_IMAGEN',
  'SIN_IMAGEN',
  'PENDIENTE_DERECHOS',
]);
const SAFE_PRODUCT_ASSET_PATTERN = /^assets\/(?:products|catalog\/products|catalog\/thumbnails)\/[a-z0-9_-]+\.webp$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const ASSET_KINDS = new Set(['master', 'thumbnail']);

export function recordsFromCsvRows(rows = []) {
  const [rawHeader = [], ...records] = rows;
  const header = rawHeader.map((value, index) => (
    index === 0 ? String(value).replace(/^\uFEFF/, '').trim() : String(value).trim()
  ));
  return {
    header,
    records: records.map((values) => Object.fromEntries(
      header.map((column, index) => [column, String(values[index] || '').trim()]),
    )),
  };
}

export function validateImageSourceAudit(header = [], records = []) {
  const errors = [];
  const duplicateColumns = header.filter((column, index) => header.indexOf(column) !== index);
  for (const column of new Set(duplicateColumns)) {
    errors.push(`La columna ${column || '(vacÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­a)'} estÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡ repetida en la auditorÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­a de imÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡genes.`);
  }
  for (const column of IMAGE_AUDIT_COLUMNS) {
    if (!header.includes(column)) errors.push(`Falta la columna ${column} en la auditorÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­a de imÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡genes.`);
  }

  const seenExternalIds = new Set();
  const seenSkus = new Set();
  const seenSafeSkus = new Set();
  const approved = [];

  records.forEach((source, index) => {
    const line = index + 2;
    if (!REVIEW_STATUSES.has(source.status)) {
      errors.push(`LÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­nea ${line}: status de revisiÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n invÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡lido.`);
      return;
    }
    if (source.status !== 'APROBADA') return;

    for (const field of [
      'external_id',
      'sku',
      'source_url',
      'source_type',
      'rights_status',
      'rights_reference',
      'expected_sha256',
      'checked_at',
    ]) {
      if (!source[field]) errors.push(`LÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­nea ${line}: ${field} estÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡ vacÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­o para una fuente APROBADA.`);
    }
    if (!/^https:\/\//i.test(source.source_url)) {
      errors.push(`LÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­nea ${line}: source_url debe usar HTTPS.`);
    }
    if (!SOURCE_TYPES.has(source.source_type)) {
      errors.push(`LÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­nea ${line}: source_type no autorizado.`);
    }
    if (!RIGHTS_STATUSES.has(source.rights_status)) {
      errors.push(`LÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­nea ${line}: rights_status no acredita uso comercial.`);
    }
    if (!isSha256(source.expected_sha256)) {
      errors.push(`LÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­nea ${line}: expected_sha256 debe contener 64 caracteres hexadecimales.`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(source.checked_at)) {
      errors.push(`LÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­nea ${line}: checked_at debe usar YYYY-MM-DD.`);
    }
    for (const flag of [
      'variant_verified',
      'capacity_verified',
      'package_verified',
      'pack_verified',
    ]) {
      if (source[flag] !== 'true') {
        errors.push(`LÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­nea ${line}: ${flag} debe ser true para una fuente APROBADA.`);
      }
    }

    const safeSku = normalizeSku(source.sku);
    if (!safeSku) errors.push(`LÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­nea ${line}: SKU no apto para nombre de archivo.`);
    if (seenExternalIds.has(source.external_id)) errors.push(`LÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­nea ${line}: external_id duplicado.`);
    if (seenSkus.has(source.sku)) errors.push(`LÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­nea ${line}: SKU duplicado.`);
    if (safeSku && seenSafeSkus.has(safeSku)) {
      errors.push(`LÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­nea ${line}: el SKU colisiona al normalizarse (${safeSku}).`);
    }
    seenExternalIds.add(source.external_id);
    seenSkus.add(source.sku);
    if (safeSku) seenSafeSkus.add(safeSku);
    approved.push({ ...source, safeSku });
  });

  approved.sort((left, right) => compareText(left.sku, right.sku));
  return { errors, approved };
}

export function validateFinalImageManifest(manifest, { allowEmpty = false } = {}) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || manifest.schemaVersion !== 1) {
    return {
      errors: ['El manifiesto final debe usar schemaVersion 1.'],
      sources: [],
    };
  }
  if (!Array.isArray(manifest.sources)) {
    return {
      errors: ['El manifiesto final debe contener un array sources.'],
      sources: [],
    };
  }

  const sources = manifest.sources;
  if (!sources.length && !allowEmpty) {
    errors.push('El manifiesto final no contiene imÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡genes aprobadas.');
  }

  const externalIds = new Set();
  const skus = new Set();
  const assetPaths = new Set();
  sources.forEach((source, index) => {
    const label = source?.sku || `entrada ${index + 1}`;
    if (!source || typeof source !== 'object') {
      errors.push(`Manifiesto ${label}: entrada invÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡lida.`);
      return;
    }
    for (const field of [
      'externalId',
      'sku',
      'checkedAt',
      'sourceSha256',
      'sourceType',
      'sourceUrl',
      'rightsStatus',
      'rightsReference',
    ]) {
      if (!String(source[field] || '').trim()) {
        errors.push(`Manifiesto ${label}: ${field} vacÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­o.`);
      }
    }
    if (externalIds.has(source.externalId)) {
      errors.push(`Manifiesto ${label}: externalId duplicado.`);
    }
    if (skus.has(source.sku)) errors.push(`Manifiesto ${label}: SKU duplicado.`);
    externalIds.add(source.externalId);
    skus.add(source.sku);

    if (!isSha256(source.sourceSha256)) {
      errors.push(`Manifiesto ${label}: sourceSha256 invÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡lido.`);
    }
    const expectedIdentitySha256 = catalogImageIdentitySha256(source);
    if (
      !isSha256(source.identitySha256)
      || source.identitySha256 !== expectedIdentitySha256
    ) {
      errors.push(`Manifiesto ${label}: identitySha256 no vincula externalId, SKU y fuente.`);
    }
    if (!/^https:\/\//i.test(String(source.sourceUrl || ''))) {
      errors.push(`Manifiesto ${label}: sourceUrl debe usar HTTPS.`);
    }
    if (!SOURCE_TYPES.has(source.sourceType)) {
      errors.push(`Manifiesto ${label}: sourceType no autorizado.`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(source.checkedAt || ''))) {
      errors.push(`Manifiesto ${label}: checkedAt debe usar YYYY-MM-DD.`);
    }
    if (!RIGHTS_STATUSES.has(source.rightsStatus)) {
      errors.push(`Manifiesto ${label}: rightsStatus no acredita uso comercial.`);
    }
    if (source.safeSku !== normalizeSku(source.sku)) {
      errors.push(`Manifiesto ${label}: safeSku no coincide con el SKU normalizado.`);
    }

    for (const [kind, expectedSize] of [['master', 1000], ['thumbnail', 400]]) {
      const asset = source.assets?.[kind];
      if (!asset || typeof asset !== 'object') {
        errors.push(`Manifiesto ${label}: asset ${kind} ausente.`);
        continue;
      }
      if (!isSafeProductAssetPath(asset.path)) {
        errors.push(`Manifiesto ${label}: ruta ${kind} insegura.`);
      } else if (assetPaths.has(asset.path)) {
        errors.push(`Manifiesto ${label}: ruta ${asset.path} duplicada.`);
      } else {
        assetPaths.add(asset.path);
      }
      if (!isSha256(asset.sha256)) {
        errors.push(`Manifiesto ${label}: SHA-256 ${kind} invÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡lido.`);
      }
      if (asset.width !== expectedSize || asset.height !== expectedSize) {
        errors.push(`Manifiesto ${label}: ${kind} debe medir ${expectedSize}x${expectedSize}.`);
      }
      const expectedPath = catalogAssetPath(source, kind, asset.sha256);
      if (asset.path !== expectedPath) {
        errors.push(`Manifiesto ${label}: nombre ${kind} no vincula identidad, fuente y contenido.`);
      }
      const expectedBindingSha256 = catalogAssetBindingSha256(source, kind, asset);
      if (
        !isSha256(asset.bindingSha256)
        || asset.bindingSha256 !== expectedBindingSha256
      ) {
        errors.push(`Manifiesto ${label}: bindingSha256 ${kind} invÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡lido.`);
      }
    }
    if (
      source.assets?.master?.path
      && source.assets.master.path === source.assets?.thumbnail?.path
    ) {
      errors.push(`Manifiesto ${label}: master y thumbnail deben ser archivos distintos.`);
    }
  });

  return { errors, sources };
}

export function findManifestSource(manifest, externalId, sku) {
  const sources = Array.isArray(manifest?.sources) ? manifest.sources : [];
  return sources.find((source) => (
    source.externalId === externalId
    && source.sku === sku
  )) || null;
}

export function isSafeProductAssetPath(value) {
  const candidate = String(value || '');
  return SAFE_PRODUCT_ASSET_PATTERN.test(candidate)
    && !candidate.includes('..')
    && !candidate.includes('\\');
}

export function isSha256(value) {
  return SHA256_PATTERN.test(String(value || ''));
}

export function catalogImageIdentitySha256({
  externalId,
  sku,
  sourceSha256,
} = {}) {
  return sha256(Buffer.from([
    'taba-image-identity-v1',
    lengthPrefixed(externalId),
    lengthPrefixed(sku),
    String(sourceSha256 || '').toLowerCase(),
  ].join('\n'), 'utf8'));
}

export function catalogAssetPath(source = {}, kind, assetSha256) {
  if (!ASSET_KINDS.has(kind)) return '';
  const safeSku = normalizeSku(source.sku);
  const identitySha256 = catalogImageIdentitySha256(source);
  const assetHash = String(assetSha256 || '').toLowerCase();
  if (!safeSku || !isSha256(identitySha256) || !isSha256(assetHash)) return '';
  const marker = kind === 'thumbnail' ? 'thumb-' : '';
  const directory = kind === 'thumbnail' ? 'assets/catalog/thumbnails' : 'assets/catalog/products';
  return `${directory}/${safeSku}-${identitySha256.slice(0, 16)}-${marker}${assetHash.slice(0, 16)}.webp`;
}

export function catalogAssetBindingSha256(source = {}, kind, asset = {}) {
  if (!ASSET_KINDS.has(kind)) return '';
  const identitySha256 = catalogImageIdentitySha256(source);
  return sha256(Buffer.from([
    'taba-image-asset-binding-v1',
    identitySha256,
    kind,
    String(source.sourceSha256 || '').toLowerCase(),
    String(asset.sha256 || '').toLowerCase(),
    `${asset.width}x${asset.height}`,
    lengthPrefixed(asset.path),
  ].join('\n'), 'utf8'));
}

export function rawSourceFileName(source = {}) {
  const safeSku = normalizeSku(source.sku);
  const identitySha256 = catalogImageIdentitySha256(source);
  const sourceSha256 = String(source.sourceSha256 || '').toLowerCase();
  if (!safeSku || !isSha256(identitySha256) || !isSha256(sourceSha256)) return '';
  return `${safeSku}-${identitySha256.slice(0, 16)}.${sourceSha256}.source`;
}

export function normalizeSku(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 80);
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function stableJson(value) {
  return `${JSON.stringify(sortObject(value), null, 2)}\n`;
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sortObject(value[key])]),
    );
  }
  return value;
}

function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function lengthPrefixed(value) {
  const text = String(value || '');
  return `${Buffer.byteLength(text, 'utf8')}:${text}`;
}
