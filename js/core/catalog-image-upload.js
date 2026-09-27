import {
  CATALOG_IMAGE_MAX_BYTES,
  validateCatalogSourceImage,
  validateNormalizedCatalogWebp,
} from './catalog-image-contract.js';

export async function normalizeCatalogImageFile(file, {
  createImageBitmapImpl = globalThis.createImageBitmap,
  canvasFactory = (size) => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    return canvas;
  },
} = {}) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('Elegí un archivo de imagen.');
  if (file.size > CATALOG_IMAGE_MAX_BYTES) throw new Error('La imagen original supera 5 MB.');
  if (typeof createImageBitmapImpl !== 'function') throw new Error('Este navegador no puede procesar imágenes.');

  const sourceBytes = new Uint8Array(await file.arrayBuffer());
  const sourceCheck = validateCatalogSourceImage({
    bytes: sourceBytes,
    declaredMime: String(file.type || ''),
    declaredSize: file.size,
  });
  if (!sourceCheck.ok) throw new Error(sourceImageError(sourceCheck.code));

  let bitmap;
  try {
    bitmap = await createImageBitmapImpl(file, { imageOrientation: 'from-image' });
    if (!bitmap.width || !bitmap.height) throw new Error('La imagen no tiene dimensiones válidas.');
    const master = await drawContainedWebp(bitmap, 1000, canvasFactory);
    const thumbnail = await drawContainedWebp(bitmap, 400, canvasFactory);
    const masterCheck = validateNormalizedCatalogWebp({
      bytes: new Uint8Array(await master.arrayBuffer()), width: 1000, height: 1000,
    });
    const thumbnailCheck = validateNormalizedCatalogWebp({
      bytes: new Uint8Array(await thumbnail.arrayBuffer()), width: 400, height: 400,
    });
    if (!masterCheck.ok || !thumbnailCheck.ok) throw new Error('No se pudo preparar la imagen en WebP.');
    return {
      sourceFile: file,
      sourceBytes,
      sourceMime: sourceCheck.mime,
      master,
      thumbnail,
    };
  } catch (error) {
    if (error instanceof Error && error.message) throw error;
    throw new Error('No se pudo abrir la imagen seleccionada.');
  } finally {
    bitmap?.close?.();
  }
}

async function drawContainedWebp(bitmap, size, canvasFactory) {
  const canvas = canvasFactory(size);
  if (!canvas) throw new Error('No se pudo crear la imagen normalizada.');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext?.('2d', { alpha: false });
  if (!context) throw new Error('No se pudo preparar el fondo de la imagen.');

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size, size);
  const scale = Math.min(size / bitmap.width, size / bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const left = Math.floor((size - width) / 2);
  const top = Math.floor((size - height) / 2);
  context.drawImage(bitmap, left, top, width, height);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
  if (!blob || blob.type !== 'image/webp' || blob.size > CATALOG_IMAGE_MAX_BYTES) {
    throw new Error('No se pudo generar un WebP válido de hasta 5 MB.');
  }
  return blob;
}

function sourceImageError(code) {
  if (code === 'FILE_TOO_LARGE') return 'La imagen original supera 5 MB.';
  if (code === 'MIME_MISMATCH' || code === 'UNSUPPORTED_FILE_TYPE') return 'Usá una imagen JPG, PNG o WebP válida.';
  if (code === 'IMAGE_DIMENSIONS_TOO_LARGE') return 'La imagen tiene dimensiones demasiado grandes.';
  return 'El archivo no es una imagen válida.';
}
