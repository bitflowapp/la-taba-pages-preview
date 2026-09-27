import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
import {
  CATALOG_IMAGE_MAX_BYTES,
  buildApprovedPaths,
  buildStagingPaths,
  normalizeUuid,
  sha256Hex,
  validateNormalizedWebp,
  validateOriginalImage,
  validateSourceProvenance,
} from '../_shared/catalog-image-contract.js';

type SupabaseClient = ReturnType<typeof createClient>;
type ImageRequest = {
  body: Record<string, unknown>;
  user: SupabaseClient;
  admin: SupabaseClient;
  actorUserId: string;
};
type ImageUploadRow = {
  id: string;
  business_id: string;
  product_id: string;
  uploaded_by: string;
  source_type: string;
  source_url: string | null;
  source_domain: string;
  original_mime: string;
  original_bytes: number;
  source_sha256: string;
  master_sha256: string;
  thumbnail_sha256: string;
  staging_source_path: string;
  staging_master_path: string;
  staging_thumbnail_path: string;
  public_master_path: string;
  public_thumbnail_path: string;
  previous_master_path: string | null;
  previous_thumbnail_path: string | null;
  status: 'pending' | 'approved' | 'rejected';
  license_status: 'pending' | 'approved' | 'rejected';
  upload_completed_at: string | null;
  review_previewed_at: string | null;
  review_previewed_by: string | null;
  catalog_asset_id: string | null;
  cleanup_status: 'pending' | 'complete' | 'retry_needed';
};

const SUPABASE_URL = requiredEnvironment('SUPABASE_URL');
const SUPABASE_ANON_KEY = requiredEnvironment('SUPABASE_ANON_KEY');
const SERVICE_ROLE_KEY = requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY');
const STAGING_BUCKET = 'catalog-image-staging';
const PUBLIC_BUCKET = 'catalog-images';
const UPLOAD_LIMIT = 100;
const SIGNED_PREVIEW_SECONDS = 300;
const PRODUCT_ALLOWED_ORIGIN = 'https://la-taba-commercial-pilot.pages.dev';

Deno.serve(async (request) => {
  const cors = corsHeaders(request);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: cors ? 204 : 403, headers: cors || undefined });
  }
  if (!cors) return json({ ok: false, code: 'ORIGIN_NOT_ALLOWED' }, 403, null);
  if (request.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405, cors);
  if (Number(request.headers.get('content-length') || 0) > 64 * 1024) {
    return json({ ok: false, code: 'REQUEST_TOO_LARGE' }, 413, cors);
  }

  const authorization = request.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    return json({ ok: false, code: 'AUTH_REQUIRED' }, 401, cors);
  }

  let requestBody: string;
  try { requestBody = await request.text(); } catch { return json({ ok: false, code: 'INVALID_REQUEST' }, 400, cors); }
  if (new TextEncoder().encode(requestBody).length > 64 * 1024) {
    return json({ ok: false, code: 'REQUEST_TOO_LARGE' }, 413, cors);
  }
  let body: Record<string, unknown>;
  try { body = JSON.parse(requestBody); } catch { return json({ ok: false, code: 'INVALID_REQUEST' }, 400, cors); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ ok: false, code: 'INVALID_REQUEST' }, 400, cors);
  }

  const user = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: userData, error: userError } = await user.auth.getUser();
    const actorUserId = normalizeUuid(userData?.user?.id);
    if (userError || !actorUserId) return json({ ok: false, code: 'AUTH_REQUIRED' }, 401, cors);

    switch (body.action) {
      case 'list':
        return json(await listUploads({ body, user, admin, actorUserId }), 200, cors);
      case 'preview':
        return json(await previewUpload({ body, user, admin, actorUserId }), 200, cors);
      case 'prepare':
        return json(await prepareUpload({ body, user, admin, actorUserId }), 200, cors);
      case 'complete':
        return json(await completeUpload({ body, user, admin, actorUserId }), 200, cors);
      case 'approve':
        return json(await approveUpload({ body, user, admin, actorUserId }), 200, cors);
      case 'reject':
      case 'cancel':
        return json(await rejectUpload({ body, user, admin, actorUserId }), 200, cors);
      default:
        return json({ ok: false, code: 'INVALID_ACTION' }, 400, cors);
    }
  } catch (error: unknown) {
    const details = (error && typeof error === 'object') ? error as Record<string, unknown> : {};
    const code = String(details.catalogImageCode || '');
    const status = Number(details.catalogImageStatus || 0);
    if (code && status) return json({ ok: false, code }, status, cors);
    console.error('catalog-image-manager request failed', String(details.code || 'INTERNAL_ERROR'));
    return json({ ok: false, code: 'CATALOG_IMAGE_REQUEST_FAILED' }, 500, cors);
  }
});

async function assertOwnerAdmin({ user, businessId }: { user: SupabaseClient; businessId: string }): Promise<void> {
  const { data, error } = await user.rpc('has_business_role', {
    target_business_id: businessId,
    roles: ['owner', 'admin'],
  });
  if (error || data !== true) fail('OWNER_ADMIN_REQUIRED', 403);
}

async function listUploads({ body, user, admin, actorUserId }: ImageRequest) {
  const businessId = normalizeUuid(body.business_id);
  const productId = body.product_id ? normalizeUuid(body.product_id) : '';
  if (!businessId || (body.product_id && !productId)) fail('INVALID_REQUEST', 400);
  await assertOwnerAdmin({ user, businessId });

  let query = admin.from('catalog_image_uploads')
    .select('id,business_id,product_id,source_type,source_url,source_domain,original_mime,original_bytes,source_sha256,master_sha256,thumbnail_sha256,status,license_status,rights_status,rights_reference,reviewed_at,reviewed_by,rejection_reason,upload_completed_at,public_master_path,public_thumbnail_path,cleanup_status,created_at')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(UPLOAD_LIMIT);
  if (productId) query = query.eq('product_id', productId);
  const { data, error } = await query;
  if (error) fail('IMAGE_QUEUE_UNAVAILABLE', 503);

  const uploads = [];
  for (const row of data || []) {
    let publicUrl = '';
    if (row.status === 'approved' && row.public_master_path) {
      publicUrl = admin.storage.from(PUBLIC_BUCKET).getPublicUrl(row.public_master_path).data.publicUrl;
    }
    uploads.push({
      id: row.id,
      business_id: row.business_id,
      product_id: row.product_id,
      source_type: row.source_type,
      source_url: row.source_url,
      source_domain: row.source_domain,
      original_mime: row.original_mime,
      original_bytes: row.original_bytes,
      status: row.status,
      license_status: row.license_status,
      rights_status: row.rights_status,
      rights_reference: row.rights_reference,
      reviewed_at: row.reviewed_at,
      reviewed_by: row.reviewed_by,
      rejection_reason: row.rejection_reason,
      upload_completed_at: row.upload_completed_at,
      cleanup_status: row.cleanup_status,
      preview_url: '',
      public_url: publicUrl,
      created_at: row.created_at,
    });
  }
  return { ok: true, uploads, requested_by: actorUserId };
}

async function previewUpload({ body, user, admin, actorUserId }: ImageRequest) {
  const uploadId = normalizeUuid(body.upload_id);
  if (!uploadId) fail('INVALID_REQUEST', 400);
  const row = await getUpload(admin, uploadId);
  await assertOwnerAdmin({ user, businessId: row.business_id });
  if (row.status !== 'pending' || !row.upload_completed_at) fail('IMAGE_PREVIEW_NOT_AVAILABLE', 409);
  const { data, error } = await admin.storage.from(STAGING_BUCKET)
    .createSignedUrl(row.staging_master_path, SIGNED_PREVIEW_SECONDS);
  if (error || !data?.signedUrl) fail('IMAGE_PREVIEW_UNAVAILABLE', 503);
  const { error: auditError } = await admin.from('catalog_image_uploads')
    .update({ review_previewed_at: new Date().toISOString(), review_previewed_by: actorUserId })
    .eq('id', uploadId).eq('status', 'pending').not('upload_completed_at', 'is', null);
  if (auditError) fail('IMAGE_PREVIEW_UNAVAILABLE', 503);
  return {
    ok: true,
    upload_id: row.id,
    preview_url: data.signedUrl,
    preview_expires_at: new Date(Date.now() + SIGNED_PREVIEW_SECONDS * 1000).toISOString(),
  };
}

async function prepareUpload({ body, user, admin, actorUserId }: ImageRequest) {
  const businessId = normalizeUuid(body.business_id);
  const productId = normalizeUuid(body.product_id);
  const idempotencyKey = normalizeUuid(body.idempotency_key);
  const originalMime = String(body.original_mime || '');
  const originalBytes = Number(body.original_bytes);
  if (!businessId || !productId || !idempotencyKey) fail('INVALID_REQUEST', 400);
  await assertOwnerAdmin({ user, businessId });
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(originalMime)
      || !Number.isInteger(originalBytes) || originalBytes < 1 || originalBytes > CATALOG_IMAGE_MAX_BYTES) {
    fail('UNSUPPORTED_FILE_TYPE_OR_SIZE', 400);
  }

  const provenance = validateSourceProvenance({
    sourceType: String(body.source_type || ''),
    sourceUrl: String(body.source_url || ''),
  });
  if (!provenance.ok) fail(provenance.code, 400);
  const { data: product, error: productError } = await admin.from('products')
    .select('id,business_id,sku,external_id,catalog_origin,available,is_verified')
    .eq('id', productId).eq('business_id', businessId).maybeSingle();
  if (productError || !product) fail('PRODUCT_NOT_FOUND', 404);
  if (product.catalog_origin !== 'commercial') fail('COMMERCIAL_PRODUCT_REQUIRED', 409);
  if (product.available || product.is_verified) fail('PRODUCT_MUST_REMAIN_DRAFT', 409);
  if (!String(product.sku || '').trim()) fail('PRODUCT_IDENTITY_INCOMPLETE', 409);

  const uploadId = crypto.randomUUID().toLowerCase();
  const paths = buildStagingPaths({ businessId, productId, uploadId, sourceMime: originalMime });
  const { error: insertError } = await admin.from('catalog_image_uploads').insert({
    id: uploadId,
    business_id: businessId,
    product_id: productId,
    uploaded_by: actorUserId,
    source_type: body.source_type,
    source_url: provenance.sourceUrl,
    source_domain: provenance.sourceDomain,
    original_mime: originalMime,
    original_bytes: originalBytes,
    staging_source_path: paths.source,
    staging_master_path: paths.master,
    staging_thumbnail_path: paths.thumbnail,
    idempotency_key: idempotencyKey,
    status: 'pending',
    license_status: 'pending',
  });
  if (insertError) {
    if (insertError.code === '23505') {
      fail(insertError.message?.includes('catalog_image_uploads_one_open_review_per_product')
        ? 'IMAGE_REVIEW_IN_PROGRESS' : 'DUPLICATE_UPLOAD_REQUEST', 409);
    }
    fail('IMAGE_UPLOAD_PREPARE_FAILED', 409);
  }

  try {
    const signedUploads = {};
    for (const [kind, path, contentType] of [
      ['source', paths.source, originalMime],
      ['master', paths.master, 'image/webp'],
      ['thumbnail', paths.thumbnail, 'image/webp'],
    ]) {
      const { data: signed, error } = await admin.storage.from(STAGING_BUCKET)
        .createSignedUploadUrl(path, { upsert: false });
      if (error || !signed?.token) throw new Error('SIGNED_UPLOAD_UNAVAILABLE');
      signedUploads[kind] = { path, token: signed.token, content_type: contentType };
    }
    return { ok: true, upload_id: uploadId, uploads: signedUploads, max_bytes: CATALOG_IMAGE_MAX_BYTES };
  } catch {
    await admin.storage.from(STAGING_BUCKET).remove([paths.source, paths.master, paths.thumbnail]);
    await admin.from('catalog_image_uploads').delete().eq('id', uploadId);
    fail('SIGNED_UPLOAD_UNAVAILABLE', 503);
  }
}

async function completeUpload({ body, user, admin, actorUserId }: ImageRequest) {
  const uploadId = normalizeUuid(body.upload_id);
  if (!uploadId) fail('INVALID_REQUEST', 400);
  const row = await getUpload(admin, uploadId);
  await assertOwnerAdmin({ user, businessId: row.business_id });
  if (row.uploaded_by !== actorUserId) fail('UPLOAD_OWNER_MISMATCH', 403);
  if (row.status !== 'pending') fail('IMAGE_UPLOAD_NOT_PENDING', 409);
  if (row.upload_completed_at) return { ok: true, upload_id: uploadId, already_complete: true };

  const [source, master, thumbnail] = await Promise.all([
    readStagingObject(admin, row.staging_source_path),
    readStagingObject(admin, row.staging_master_path),
    readStagingObject(admin, row.staging_thumbnail_path),
  ]);
  const original = validateOriginalImage({
    bytes: source.bytes,
    declaredMime: row.original_mime,
    maxBytes: CATALOG_IMAGE_MAX_BYTES,
  });
  const masterCheck = validateNormalizedWebp({ bytes: master.bytes, expectedWidth: 1000, expectedHeight: 1000 });
  const thumbnailCheck = validateNormalizedWebp({ bytes: thumbnail.bytes, expectedWidth: 400, expectedHeight: 400 });
  if (!original.ok || source.bytes.length !== row.original_bytes || !masterCheck.ok || !thumbnailCheck.ok) {
    const rejection = await admin.rpc('reject_catalog_image_upload', {
      p_upload_id: uploadId,
      p_actor_user_id: actorUserId,
      p_reason: 'El archivo no pasó la validación de formato, tamaño o resolución.',
    });
    if (!rejection.error) await cleanupStaging(admin, row);
    fail('IMAGE_VALIDATION_FAILED', 422);
  }

  const hashes = await Promise.all([
    sha256Hex(source.bytes), sha256Hex(master.bytes), sha256Hex(thumbnail.bytes),
  ]);
  const { error } = await admin.rpc('complete_catalog_image_upload', {
    p_upload_id: uploadId,
    p_actor_user_id: actorUserId,
    p_source_sha256: hashes[0],
    p_master_sha256: hashes[1],
    p_thumbnail_sha256: hashes[2],
    p_source_bytes: source.bytes.length,
    p_master_bytes: master.bytes.length,
    p_thumbnail_bytes: thumbnail.bytes.length,
  });
  if (error) fail('IMAGE_UPLOAD_FINALIZE_FAILED', 409);
  return {
    ok: true,
    upload_id: uploadId,
    status: 'pending',
    license_status: 'pending',
  };
}

async function approveUpload({ body, user, admin, actorUserId }: ImageRequest) {
  const uploadId = normalizeUuid(body.upload_id);
  if (!uploadId) fail('INVALID_REQUEST', 400);
  const row = await getUpload(admin, uploadId);
  await assertOwnerAdmin({ user, businessId: row.business_id });
  if (row.status === 'approved') return resumeApprovedUpload({ row, admin });

  const rightsStatus = String(body.rights_status || '');
  const rightsReference = String(body.rights_reference || '').trim().slice(0, 300);
  if (!['PROPIO', 'LICENCIA_COMERCIAL', 'PERMISO_DOCUMENTADO'].includes(rightsStatus)
      || !rightsReference) fail('RIGHTS_EVIDENCE_REQUIRED', 400);
  if (row.status !== 'pending' || !row.upload_completed_at) fail('IMAGE_NOT_READY_FOR_APPROVAL', 409);
  if (
    row.review_previewed_by !== actorUserId
    || !row.review_previewed_at
    || Date.now() - Date.parse(row.review_previewed_at) > SIGNED_PREVIEW_SECONDS * 1000
  ) fail('IMAGE_PREVIEW_REQUIRED', 409);
  if (row.source_type === 'business_owned_photo' && rightsStatus !== 'PROPIO') {
    fail('OWN_IMAGE_REQUIRES_PROPIO_RIGHTS', 400);
  }
  if (row.source_type !== 'business_owned_photo' && rightsStatus === 'PROPIO') {
    fail('EXTERNAL_SOURCE_REQUIRES_LICENSE_OR_PERMISSION', 400);
  }
  if (!row.source_sha256 || !row.master_sha256 || !row.thumbnail_sha256) {
    fail('IMAGE_UPLOAD_METADATA_MISSING', 409);
  }

  const [source, master, thumbnail] = await Promise.all([
    readStagingObject(admin, row.staging_source_path),
    readStagingObject(admin, row.staging_master_path),
    readStagingObject(admin, row.staging_thumbnail_path),
  ]);
  if (
    source.bytes.length !== row.original_bytes
    || await sha256Hex(source.bytes) !== row.source_sha256
    || await sha256Hex(master.bytes) !== row.master_sha256
    || await sha256Hex(thumbnail.bytes) !== row.thumbnail_sha256
    || !validateOriginalImage({ bytes: source.bytes, declaredMime: row.original_mime }).ok
    || !validateNormalizedWebp({ bytes: master.bytes, expectedWidth: 1000, expectedHeight: 1000 }).ok
    || !validateNormalizedWebp({ bytes: thumbnail.bytes, expectedWidth: 400, expectedHeight: 400 }).ok
  ) fail('IMAGE_CHANGED_AFTER_REVIEW', 409);

  const paths = buildApprovedPaths({
    businessId: row.business_id,
    productId: row.product_id,
    masterSha256: row.master_sha256,
    thumbnailSha256: row.thumbnail_sha256,
  });
  const { data, error } = await admin.rpc('approve_catalog_image_upload', {
    p_upload_id: uploadId,
    p_actor_user_id: actorUserId,
    p_rights_status: rightsStatus,
    p_rights_reference: rightsReference,
  });
  if (error || !data?.catalog_asset_id) fail('IMAGE_APPROVAL_FAILED', 409);
  return publishApprovedObjects({ row: { ...row, ...{
    catalog_asset_id: data.catalog_asset_id,
    public_master_path: paths.master,
    public_thumbnail_path: paths.thumbnail,
    previous_master_path: data.old_master_path || null,
    previous_thumbnail_path: data.old_thumbnail_path || null,
    cleanup_status: 'pending',
  } }, admin });
}

async function resumeApprovedUpload({ row, admin }: { row: ImageUploadRow; admin: SupabaseClient }) {
  if (row.cleanup_status === 'complete') {
    return { ok: true, upload_id: row.id, catalog_asset_id: row.catalog_asset_id,
      status: 'approved', image_associated: true, cleanup_status: 'complete' };
  }
  const { data: product, error: productError } = await admin.from('products')
    .select('id,business_id,available,is_verified,catalog_asset_id,image_url,image_sha256,image_thumbnail_url,image_thumbnail_sha256,source_image_sha256')
    .eq('id', row.product_id).eq('business_id', row.business_id).maybeSingle();
  if (productError || !product || product.available || product.is_verified
      || product.catalog_asset_id !== row.catalog_asset_id
      || product.image_sha256 !== row.master_sha256
      || product.image_thumbnail_sha256 !== row.thumbnail_sha256
      || product.source_image_sha256 !== row.source_sha256) {
    fail('IMAGE_ASSOCIATION_CHANGED', 409);
  }
  const { data: asset, error: assetError } = await admin.from('catalog_assets')
    .select('id,product_id,master_storage_path,thumbnail_storage_path')
    .eq('id', row.catalog_asset_id).maybeSingle();
  if (assetError || !asset || asset.product_id !== row.product_id
      || asset.master_storage_path !== row.public_master_path
      || asset.thumbnail_storage_path !== row.public_thumbnail_path) {
    fail('IMAGE_ASSOCIATION_CHANGED', 409);
  }
  return publishApprovedObjects({ row, admin });
}

async function publishApprovedObjects({ row, admin }: { row: ImageUploadRow; admin: SupabaseClient }) {
  if (!row.master_sha256 || !row.thumbnail_sha256
      || !row.public_master_path || !row.public_thumbnail_path
      || row.status !== 'approved' || !row.catalog_asset_id) {
    fail('IMAGE_ASSOCIATION_CHANGED', 409);
  }
  try {
    await ensurePublicObject({
      admin, path: row.public_master_path, stagingPath: row.staging_master_path,
      expectedSha: row.master_sha256, expectedWidth: 1000, expectedHeight: 1000,
    });
    await ensurePublicObject({
      admin, path: row.public_thumbnail_path, stagingPath: row.staging_thumbnail_path,
      expectedSha: row.thumbnail_sha256, expectedWidth: 400, expectedHeight: 400,
    });
    const cleanup = await cleanupAfterApproval(admin, row);
    return {
      ok: true,
      upload_id: row.id,
      catalog_asset_id: row.catalog_asset_id,
      status: 'approved',
      image_associated: true,
      cleanup_status: cleanup ? 'complete' : 'retry_needed',
    };
  } catch (error) {
    const details = (error && typeof error === 'object') ? error as Record<string, unknown> : {};
    if (details.catalogImageCode) throw error;
    fail('IMAGE_STORAGE_PENDING', 503);
  }
}

async function rejectUpload({ body, user, admin, actorUserId }: ImageRequest) {
  const uploadId = normalizeUuid(body.upload_id);
  if (!uploadId) fail('INVALID_REQUEST', 400);
  const row = await getUpload(admin, uploadId);
  await assertOwnerAdmin({ user, businessId: row.business_id });
  const reason = String(body.reason || (body.action === 'cancel' ? 'Carga cancelada por el operador.' : '')).trim();
  if (!reason || reason.length > 300) fail('REJECTION_REASON_REQUIRED', 400);
  const { data, error } = await admin.rpc('reject_catalog_image_upload', {
    p_upload_id: uploadId,
    p_actor_user_id: actorUserId,
    p_reason: reason,
  });
  if (error) fail('IMAGE_REJECTION_FAILED', 409);
  const cleanup = await cleanupStagingPaths(admin, [
    data.source_path, data.master_path, data.thumbnail_path,
  ]);
  await admin.from('catalog_image_uploads').update({ cleanup_status: cleanup ? 'complete' : 'retry_needed' })
    .eq('id', uploadId);
  return { ok: true, upload_id: uploadId, status: 'rejected', cleanup_status: cleanup ? 'complete' : 'retry_needed' };
}

async function ensurePublicObject({
  admin, path, stagingPath, expectedSha, expectedWidth, expectedHeight,
}: {
  admin: SupabaseClient;
  path: string;
  stagingPath: string;
  expectedSha: string;
  expectedWidth: number;
  expectedHeight: number;
}): Promise<void> {
  const publicBucket = admin.storage.from(PUBLIC_BUCKET);
  const { data: existing, error: existingError } = await publicBucket.download(path);
  if (!existingError && existing) {
    const bytes = new Uint8Array(await existing.arrayBuffer());
    if (await sha256Hex(bytes) !== expectedSha
        || !validateNormalizedWebp({ bytes, expectedWidth, expectedHeight }).ok) {
      fail('PUBLIC_IMAGE_COLLISION', 409);
    }
    return;
  }

  const staged = await readStagingObject(admin, stagingPath);
  if (await sha256Hex(staged.bytes) !== expectedSha
      || !validateNormalizedWebp({ bytes: staged.bytes, expectedWidth, expectedHeight }).ok) {
    fail('IMAGE_CHANGED_AFTER_REVIEW', 409);
  }
  const { error } = await publicBucket.upload(path, staged.bytes, {
    contentType: 'image/webp',
    cacheControl: '31536000',
    upsert: false,
  });
  if (!error) return;
  const { data: raced, error: readError } = await publicBucket.download(path);
  if (readError || !raced) throw new Error('PUBLIC_IMAGE_COLLISION');
  const actualBytes = new Uint8Array(await raced.arrayBuffer());
  if (await sha256Hex(actualBytes) !== expectedSha
      || !validateNormalizedWebp({ bytes: actualBytes, expectedWidth, expectedHeight }).ok) {
    throw new Error('PUBLIC_IMAGE_COLLISION');
  }
}

async function cleanupAfterApproval(admin: SupabaseClient, row: ImageUploadRow): Promise<boolean> {
  const activePaths = new Set([row.public_master_path, row.public_thumbnail_path]);
  const paths = [
    ...[row.previous_master_path, row.previous_thumbnail_path]
      .filter((path) => isApprovedProductPath(path, row.business_id, row.product_id) && !activePaths.has(path)),
    row.staging_source_path, row.staging_master_path, row.staging_thumbnail_path,
  ];
  const ok = await cleanupStagingPaths(admin, paths);
  await admin.from('catalog_image_uploads')
    .update({ cleanup_status: ok ? 'complete' : 'retry_needed' })
    .eq('id', row.id);
  return ok;
}

async function cleanupStaging(admin: SupabaseClient, row: ImageUploadRow): Promise<boolean> {
  const ok = await cleanupStagingPaths(admin, [
    row.staging_source_path, row.staging_master_path, row.staging_thumbnail_path,
  ]);
  await admin.from('catalog_image_uploads')
    .update({ cleanup_status: ok ? 'complete' : 'retry_needed' })
    .eq('id', row.id);
  return ok;
}

async function cleanupStagingPaths(admin: SupabaseClient, paths: Array<string | null | undefined>): Promise<boolean> {
  const staging = paths.filter((path): path is string => typeof path === 'string' && path.includes('/pending/'));
  const approved = paths.filter((path): path is string => typeof path === 'string'
    && path.startsWith('business/') && !path.includes('/pending/'));
  const removals = [];
  if (staging.length) removals.push(admin.storage.from(STAGING_BUCKET).remove(staging));
  if (approved.length) removals.push(admin.storage.from(PUBLIC_BUCKET).remove(approved));
  const results = await Promise.all(removals);
  return results.every((result) => !result.error);
}

function isApprovedProductPath(path: unknown, businessId: string, productId: string): path is string {
  const prefix = 'business/' + businessId + '/products/' + productId + '/';
  return typeof path === 'string' && path.startsWith(prefix)
    && /^(?:[a-f0-9]{64}|thumb-[a-f0-9]{64})[.]webp$/.test(path.slice(prefix.length));
}

async function getUpload(admin: SupabaseClient, uploadId: string): Promise<ImageUploadRow> {
  const { data, error } = await admin.from('catalog_image_uploads')
    .select('*').eq('id', uploadId).maybeSingle();
  if (error || !data) fail('IMAGE_UPLOAD_NOT_FOUND', 404);
  return data as ImageUploadRow;
}

async function readStagingObject(admin: SupabaseClient, path: string): Promise<{ blob: Blob; bytes: Uint8Array }> {
  const { data, error } = await admin.storage.from(STAGING_BUCKET).download(path);
  if (error || !data) fail('IMAGE_UPLOAD_OBJECT_MISSING', 422);
  if (data.size > CATALOG_IMAGE_MAX_BYTES) fail('FILE_TOO_LARGE', 422);
  return { blob: data, bytes: new Uint8Array(await data.arrayBuffer()) };
}

function fail(code: string, status: number): never {
  const error = Object.assign(new Error(code), {
    catalogImageCode: code,
    catalogImageStatus: status,
  });
  throw error;
}

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(name + ' is required by catalog-image-manager');
  return value;
}

function corsHeaders(request: Request): Record<string, string> | null {
  const origin = request.headers.get('origin') || '';
  if (!origin) return {};
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (origin !== PRODUCT_ALLOWED_ORIGIN && !local) return null;
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    'cache-control': 'no-store',
    vary: 'Origin',
  };
}

function json(value: unknown, status: number, cors: Record<string, string> | null) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(cors || {}) },
  });
}
