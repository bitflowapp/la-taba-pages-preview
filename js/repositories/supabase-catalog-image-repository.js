import { normalizeCatalogImageFile } from '../core/catalog-image-upload.js';

const ERROR_COPY = Object.freeze({
  AUTH_REQUIRED: 'Volvé a iniciar sesión para cargar imágenes.',
  OWNER_ADMIN_REQUIRED: 'Sólo el dueño o un administrador puede gestionar imágenes.',
  PRODUCT_NOT_FOUND: 'No encontramos el producto de este negocio.',
  PRODUCT_MUST_REMAIN_DRAFT: 'La imagen sólo se puede cambiar mientras el producto siga como borrador.',
  COMMERCIAL_PRODUCT_REQUIRED: 'Sólo se pueden asociar imágenes a productos comerciales.',
  SOURCE_URL_REQUIRED: 'Ingresá la URL original de la imagen.',
  SOURCE_URL_MUST_BE_HTTPS: 'La fuente externa debe usar HTTPS y no incluir credenciales.',
  UNSUPPORTED_FILE_TYPE_OR_SIZE: 'Usá un JPG, PNG o WebP de hasta 5 MB.',
  IMAGE_DIMENSIONS_TOO_LARGE: 'La imagen tiene dimensiones demasiado grandes.',
  IMAGE_VALIDATION_FAILED: 'El archivo no pasó la validación de imagen, tamaño o resolución.',
  RIGHTS_EVIDENCE_REQUIRED: 'Elegí el tipo de derecho e ingresá su referencia verificable.',
  IMAGE_NOT_READY_FOR_APPROVAL: 'La imagen todavía no terminó de cargarse para revisión.',
  DUPLICATE_UPLOAD_REQUEST: 'La solicitud ya fue recibida. Actualizá la lista de imágenes.',
  IMAGE_REVIEW_IN_PROGRESS: 'Este producto ya tiene una imagen pendiente de revisión o almacenamiento. Terminá o rechazá esa revisión primero.',
  IMAGE_STORAGE_PENDING: 'La imagen ya quedó aprobada y asociada, pero falta completar su almacenamiento público. Reintentá desde la cola de imágenes.',
  IMAGE_ASSOCIATION_CHANGED: 'La asociación de la imagen cambió. Actualizá el catálogo antes de continuar.',
});

export function createSupabaseCatalogImageRepository({ client, businessId }) {
  const available = typeof client?.functions?.invoke === 'function' && Boolean(businessId);

  async function invoke(body) {
    if (!available) {
      return { ok: false, code: 'IMAGE_SERVICE_UNAVAILABLE', message: 'El servicio de imágenes no está disponible.' };
    }
    try {
      const { data, error } = await client.functions.invoke('catalog-image-manager', { body });
      if (error) {
        const code = await edgeErrorCode(error);
        return { ok: false, code, message: ERROR_COPY[code] || 'No se pudo completar la gestión de imágenes.' };
      }
      if (!data?.ok) {
        const code = String(data?.code || 'CATALOG_IMAGE_REQUEST_FAILED');
        return { ok: false, code, message: ERROR_COPY[code] || 'No se pudo completar la gestión de imágenes.' };
      }
      return { ok: true, data };
    } catch (_) {
      return { ok: false, code: 'SERVER_UNAVAILABLE', message: 'No se pudo conectar con el servicio de imágenes.' };
    }
  }

  return Object.freeze({
    async listCatalogImageUploads({ productId = '' } = {}) {
      return invoke({
        action: 'list',
        business_id: businessId,
        ...(productId ? { product_id: productId } : {}),
      });
    },

    getCatalogImagePreview: ({ uploadId } = {}) => invoke({
      action: 'preview',
      upload_id: uploadId,
    }),

    async uploadCatalogImage({ productId, file, sourceType, sourceUrl = '' } = {}) {
      if (!productId) return { ok: false, code: 'INVALID_REQUEST', message: 'Falta el producto de destino.' };
      let variants;
      try { variants = await normalizeCatalogImageFile(file); }
      catch (error) {
        return { ok: false, code: 'INVALID_IMAGE', message: error?.message || 'No se pudo leer la imagen.' };
      }

      const prepared = await invoke({
        action: 'prepare',
        business_id: businessId,
        product_id: productId,
        source_type: sourceType,
        source_url: sourceUrl.trim() || null,
        original_mime: variants.sourceMime,
        original_bytes: variants.sourceBytes.length,
        idempotency_key: crypto.randomUUID(),
      });
      if (!prepared.ok) return prepared;

      const uploadId = prepared.data.upload_id;
      const parts = [
        ['source', variants.sourceFile, variants.sourceMime],
        ['master', variants.master, 'image/webp'],
        ['thumbnail', variants.thumbnail, 'image/webp'],
      ];
      for (const [kind, blob, contentType] of parts) {
        const signed = prepared.data.uploads?.[kind];
        if (!signed?.path || !signed?.token) {
          await invoke({ action: 'cancel', upload_id: uploadId, reason: 'Faltó una URL de carga segura.' });
          return { ok: false, code: 'SIGNED_UPLOAD_UNAVAILABLE', message: 'No se pudo iniciar la carga segura.' };
        }
        const { error } = await client.storage.from('catalog-image-staging')
          .uploadToSignedUrl(signed.path, signed.token, blob, { contentType, upsert: false });
        if (error) {
          await invoke({ action: 'cancel', upload_id: uploadId, reason: 'Carga interrumpida.' });
          return { ok: false, code: 'IMAGE_UPLOAD_FAILED', message: 'La carga se interrumpió. El producto sigue sin cambios.' };
        }
      }

      return invoke({ action: 'complete', upload_id: uploadId });
    },

    approveCatalogImageUpload: ({ uploadId, rightsStatus, rightsReference } = {}) => invoke({
      action: 'approve',
      upload_id: uploadId,
      rights_status: rightsStatus,
      rights_reference: String(rightsReference || '').trim(),
    }),

    rejectCatalogImageUpload: ({ uploadId, reason } = {}) => invoke({
      action: 'reject',
      upload_id: uploadId,
      reason: String(reason || '').trim(),
    }),
  });
}

async function edgeErrorCode(error) {
  try {
    const response = error?.context;
    if (response && typeof response.clone === 'function') {
      const payload = await response.clone().json();
      return String(payload?.code || 'CATALOG_IMAGE_REQUEST_FAILED');
    }
  } catch (_) {
    // The raw edge response is intentionally not exposed in the Panel.
  }
  return 'CATALOG_IMAGE_REQUEST_FAILED';
}
