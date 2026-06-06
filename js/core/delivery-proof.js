const DEFAULT_MAX_DIMENSION = 1024;
const DEFAULT_JPEG_QUALITY = 0.7;
// Límite conservador para guardar el proof completo en localStorage sin inflar el estado.
export const MAX_DELIVERY_PROOF_DATA_URL_BYTES = 768 * 1024;
const DEFAULT_MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const VALID_SOURCES = new Set(['camera', 'file']);
const DATA_URL_PATTERN = /^data:image\/(?:jpeg|jpg|png|webp);base64,[a-z0-9+/=\s]+$/i;

export function validateProofFile(file, { maxBytes = DEFAULT_MAX_SOURCE_BYTES } = {}) {
  if (!file) return { ok: false, message: 'Selecciona una foto del pedido entregado.' };
  if (!String(file.type || '').toLowerCase().startsWith('image/')) {
    return { ok: false, message: 'El comprobante debe ser una imagen.' };
  }
  const size = Number(file.size);
  if (Number.isFinite(size) && size > maxBytes) {
    return { ok: false, message: 'La foto es demasiado grande. Probá con otra imagen.' };
  }
  return { ok: true, message: '' };
}

export function targetProofDimensions(width, height, maxDimension = DEFAULT_MAX_DIMENSION) {
  const sourceWidth = Math.max(1, Math.floor(Number(width) || 1));
  const sourceHeight = Math.max(1, Math.floor(Number(height) || 1));
  const maxSide = Math.max(sourceWidth, sourceHeight);
  if (maxSide <= maxDimension) return { width: sourceWidth, height: sourceHeight };
  const scale = maxDimension / maxSide;
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

export async function compressDeliveryProofImage(file, {
  maxDimension = DEFAULT_MAX_DIMENSION,
  quality = DEFAULT_JPEG_QUALITY,
  maxDataUrlBytes = MAX_DELIVERY_PROOF_DATA_URL_BYTES,
} = {}) {
  const validation = validateProofFile(file);
  if (!validation.ok) return validation;

  try {
    const image = await decodeImage(file);
    const stages = buildCompressionStages(maxDimension, quality);
    let lastOversize = null;
    try {
      for (const stage of stages) {
        const candidate = compressDeliveryProofImageAtStage(image, stage);
        if (!candidate.ok) return candidate;
        if (candidate.byteSize <= maxDataUrlBytes) {
          return candidate;
        }
        lastOversize = candidate;
      }
    } finally {
      if (typeof image.close === 'function') image.close();
    }

    if (lastOversize) {
      return {
        ok: false,
        message: `La foto sigue siendo demasiado grande para guardarla en este dispositivo. Probá con una imagen más chica.`,
      };
    }

    return { ok: false, message: 'No se pudo procesar la foto. Probá con otra imagen.' };
  } catch (_) {
    return { ok: false, message: 'No se pudo procesar la foto. Probá con otra imagen.' };
  }
}

export function buildDeliveryProof(photoDataUrl, {
  capturedAt = new Date().toISOString(),
  source = 'file',
} = {}) {
  return normalizeDeliveryProof({ photoDataUrl, capturedAt, source });
}

export function normalizeDeliveryProof(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const photoDataUrl = String(raw.photoDataUrl || '').trim();
  if (!isValidProofDataUrl(photoDataUrl)) return null;

  const capturedAt = normalizeIsoDate(raw.capturedAt);
  if (!capturedAt) return null;

  const source = VALID_SOURCES.has(raw.source) ? raw.source : 'file';
  return { photoDataUrl, capturedAt, source };
}

export function hasDeliveryProof(order) {
  return Boolean(normalizeDeliveryProof(order?.deliveryProof));
}

export function attachDeliveryProofToOrder(order, proof) {
  const normalized = normalizeDeliveryProof(proof);
  if (!order || typeof order !== 'object' || !normalized) return null;
  return { ...order, deliveryProof: normalized };
}

export function formatDeliveryProofTime(proof, locale = 'es-AR') {
  const normalized = normalizeDeliveryProof(proof);
  if (!normalized) return '';
  const date = new Date(normalized.capturedAt);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function isValidProofDataUrl(value) {
  return DATA_URL_PATTERN.test(String(value || '').trim());
}

function normalizeIsoDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

function estimateDataUrlBytes(dataUrl) {
  const encoded = String(dataUrl || '').split(',')[1] || '';
  return Math.floor((encoded.replace(/\s/g, '').length * 3) / 4);
}

function buildCompressionStages(maxDimension, quality) {
  const stages = [
    { maxDimension, quality },
    { maxDimension: Math.min(maxDimension, 900), quality: Math.min(quality, 0.6) },
    { maxDimension: Math.min(maxDimension, 768), quality: Math.min(quality, 0.55) },
    { maxDimension: Math.min(maxDimension, 640), quality: Math.min(quality, 0.5) },
  ];
  const seen = new Set();
  return stages.filter((stage) => {
    const key = `${stage.maxDimension}:${stage.quality}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compressDeliveryProofImageAtStage(image, { maxDimension, quality }) {
  const size = targetProofDimensions(image.width, image.height, maxDimension);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) {
    return { ok: false, message: 'No se pudo procesar la foto. Probá con otra imagen.' };
  }
  context.drawImage(image, 0, 0, size.width, size.height);
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  if (!isValidProofDataUrl(dataUrl) || !dataUrl.startsWith('data:image/jpeg')) {
    return { ok: false, message: 'No se pudo procesar la foto. Probá con otra imagen.' };
  }
  return {
    ok: true,
    dataUrl,
    width: size.width,
    height: size.height,
    byteSize: estimateDataUrlBytes(dataUrl),
    message: 'Foto de entrega adjunta.',
  };
}

async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch (_) {
      return decodeImageWithElement(file);
    }
  }
  return decodeImageWithElement(file);
}

function decodeImageWithElement(file) {
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      reject(new Error('image decoder unavailable'));
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image decode failed'));
    };
    image.src = url;
  });
}
