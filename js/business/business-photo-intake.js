// Panel › Catálogo › Cargar fotos en lote.
// ---------------------------------------------------------------------------
// Con fotos propias sacadas en el local, subir 45 de a una es una tarde. Esto
// toma varias a la vez, reconoce el producto por el NOMBRE DEL ARCHIVO y las
// sube por el mismo camino que la carga individual (`catalog-image-manager`:
// normalización en el navegador, zona privada, vista previa).
//
// LO QUE NO HACE: no aprueba nada. Cada foto queda «pendiente de revisión» y el
// dueño o el encargado la mira y la aprueba con derecho PROPIO en la ficha del
// producto. Sin clave de servicio: usa la sesión de quien está en el Panel.
//
// NOMBRES (catalog/photo-capture/README.md): `<sku>__front.jpg` o `<sku>.jpg`.
// El SKU tiene que coincidir EXACTO con el de un producto: nada de parecidos.
// `<sku>__alternate.jpg` se reconoce y se deja afuera (una foto por producto).
import { escapeHtml } from '../ui.js';

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PHOTO_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
const EXTENSION = /\.(jpe?g|png|webp)$/i;

/** El SKU que nombra un archivo, o `null` si el nombre no sigue la convención. */
export function skuFromPhotoName(name) {
  const base = String(name || '').trim().split(/[\\/]/).pop() || '';
  if (!EXTENSION.test(base)) return null;
  const stem = base.replace(EXTENSION, '').toLowerCase();
  const match = /^([a-z0-9][a-z0-9-]{2,79})(?:__(front|alternate))?$/.exec(stem);
  if (!match) return null;
  return { sku: match[1], kind: match[2] || 'front' };
}

/**
 * El plan de la carga: una fila por archivo, con qué producto le corresponde o
 * por qué no se sube. Puro, para probarlo sin navegador.
 *
 * `products` son las filas del catálogo (id, sku, available, is_verified);
 * `uploads` la cola de revisión (product_id, status).
 */
export function planPhotoIntake(files = [], products = [], uploads = []) {
  const bySku = new Map(products.map((product) => [String(product.sku || '').toLowerCase(), product]));
  const pendingReview = new Set(uploads.filter((upload) => upload?.status === 'pending').map((upload) => String(upload.product_id)));
  const taken = new Set();
  return files.map((file, index) => {
    const name = String(file?.name || `archivo ${index + 1}`);
    const row = { index, name, size: Number(file?.size || 0), sku: '', productId: '', productName: '', status: 'ready', message: '' };
    const parsed = skuFromPhotoName(name);
    if (!parsed) return { ...row, status: 'bad_name', message: 'El nombre no sigue la convención <sku>__front.jpg.' };
    row.sku = parsed.sku;
    if (parsed.kind === 'alternate') return { ...row, status: 'alternate', message: 'Foto alternativa: por ahora se sube sólo la del frente.' };
    if (!PHOTO_TYPES.includes(String(file?.type || '').toLowerCase())) {
      return { ...row, status: 'bad_type', message: 'Usá JPG, PNG o WebP.' };
    }
    if (row.size <= 0 || row.size > PHOTO_MAX_BYTES) return { ...row, status: 'too_big', message: 'La foto tiene que pesar hasta 5 MB.' };
    const product = bySku.get(parsed.sku);
    if (!product) return { ...row, status: 'unknown_sku', message: 'No hay ningún producto con ese SKU exacto.' };
    row.productId = String(product.id);
    row.productName = String(product.name || '');
    if (taken.has(parsed.sku)) return { ...row, status: 'duplicate', message: 'Ya hay otra foto para este producto en esta carga.' };
    taken.add(parsed.sku);
    if (product.available || product.is_verified) {
      return { ...row, status: 'published', message: 'Está publicado: volvelo a borrador para cambiar la foto.' };
    }
    if (pendingReview.has(row.productId)) {
      return { ...row, status: 'pending_review', message: 'Ya tiene una foto esperando revisión: revisala o rechazala primero.' };
    }
    return row;
  });
}

export function summarizePhotoPlan(plan = []) {
  const ready = plan.filter((row) => row.status === 'ready').length;
  return { total: plan.length, ready, skipped: plan.length - ready };
}

const STATUS_TONE = Object.freeze({
  ready: 'success', uploaded: 'success', failed: 'danger', bad_name: 'danger', bad_type: 'danger', too_big: 'danger',
  unknown_sku: 'danger', duplicate: 'warning', published: 'warning', pending_review: 'warning', alternate: 'neutral',
});

const STATUS_LABEL = Object.freeze({
  ready: 'Lista para subir', uploaded: 'Subida · pendiente de revisión', failed: 'No se subió', bad_name: 'Nombre inválido',
  bad_type: 'Formato no admitido', too_big: 'Muy pesada', unknown_sku: 'SKU desconocido', duplicate: 'Repetida',
  published: 'Producto publicado', pending_review: 'Ya hay una pendiente', alternate: 'Alternativa',
});

export function renderPhotoIntake({ plan = null, progress = '', busy = false } = {}) {
  const summary = plan ? summarizePhotoPlan(plan) : null;
  return `<details class="business-catalog-image-manager business-photo-intake" data-photo-intake ${plan ? 'open' : ''}>
    <summary><strong>Cargar fotos en lote</strong><span class="status-pill neutral">Fotos propias</span></summary>
    <div class="business-catalog-image-body">
      <p class="form-hint">Nombrá cada archivo con el SKU del producto: <code>&lt;sku&gt;__front.jpg</code>. Las fotos quedan privadas y pendientes de revisión: después aprobás cada una con derecho «Foto propia del negocio».</p>
      <label>Fotos<input type="file" multiple data-photo-intake-files accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" ${busy ? 'disabled' : ''}></label>
      <div class="button-row">
        <button class="secondary-button compact" type="button" data-photo-intake-plan ${busy ? 'disabled' : ''}>Revisar archivos</button>
        ${summary?.ready ? `<button class="primary-button compact" type="button" data-photo-intake-upload ${busy ? 'disabled' : ''}>Subir ${summary.ready} ${summary.ready === 1 ? 'foto' : 'fotos'} para revisión</button>` : ''}
        ${plan ? `<button class="ghost-button compact" type="button" data-photo-intake-clear ${busy ? 'disabled' : ''}>Limpiar</button>` : ''}
      </div>
      ${progress ? `<p role="status" aria-live="polite">${escapeHtml(progress)}</p>` : ''}
      ${plan ? `<ul class="business-photo-intake-list">${plan.map((row) => `<li data-photo-intake-row="${escapeHtml(row.status)}">
        <span><strong>${escapeHtml(row.name)}</strong>${row.productName ? ` → ${escapeHtml(row.productName)}` : ''}</span>
        <span class="status-pill ${STATUS_TONE[row.status] || 'neutral'}">${escapeHtml(STATUS_LABEL[row.status] || row.status)}</span>
        ${row.message ? `<small>${escapeHtml(row.message)}</small>` : ''}
      </li>`).join('')}</ul>` : ''}
    </div>
  </details>`;
}

// ── Estado y acciones ────────────────────────────────────────────────────────
let files = [];
let plan = null;
let progress = '';

export function resetPhotoIntake() {
  files = [];
  plan = null;
  progress = '';
}

export function photoIntakeState() {
  return { plan, progress };
}

/**
 * `deps`: { context, products, uploads, isBusy, setBusy, refreshCatalog }.
 * Devuelve `null` si el clic no es de esta sección.
 */
export async function handlePhotoIntakeAction(target, deps) {
  if (!target?.closest) return null;
  const done = (ok, message) => ({ handled: true, ok, message });
  const elevated = ['owner', 'admin'].includes(String(deps?.context?.role || '').toLowerCase());
  if (target.closest('[data-photo-intake-clear]')) {
    resetPhotoIntake();
    deps.context.onChange();
    return done(true, '');
  }
  if (target.closest('[data-photo-intake-plan]')) {
    if (!elevated) return done(false, 'Sólo el dueño o el encargado suben fotos del catálogo.');
    const input = target.closest('[data-photo-intake]')?.querySelector('[data-photo-intake-files]');
    files = [...(input?.files || [])];
    if (!files.length) return done(false, 'Elegí una o más fotos.');
    plan = planPhotoIntake(files, deps.products(), deps.uploads());
    const summary = summarizePhotoPlan(plan);
    progress = `${summary.ready} de ${summary.total} listas para subir.`;
    deps.context.onChange();
    return done(true, progress);
  }
  if (target.closest('[data-photo-intake-upload]')) {
    if (!elevated) return done(false, 'Sólo el dueño o el encargado suben fotos del catálogo.');
    if (!plan) return done(false, 'Primero revisá los archivos.');
    if (deps.isBusy()) return done(false, 'Ya hay una actualización en curso.');
    const ready = plan.filter((row) => row.status === 'ready');
    let uploaded = 0;
    let failed = 0;
    deps.setBusy(true);
    try {
      for (const row of ready) {
        progress = `Subiendo ${uploaded + failed + 1} de ${ready.length}: ${row.name}`;
        deps.context.onChange();
        let response;
        try {
          response = await deps.context.uploadCatalogImage({
            productId: row.productId, file: files[row.index], sourceType: 'business_owned_photo', sourceUrl: '',
          });
        } catch (error) {
          response = { ok: false, message: error?.message || 'Error de conexión.' };
        }
        plan = plan.map((item) => (item.index === row.index
          ? { ...item, status: response?.ok ? 'uploaded' : 'failed', message: response?.ok ? '' : String(response?.message || 'No se pudo subir.') }
          : item));
        if (response?.ok) uploaded += 1; else failed += 1;
      }
    } finally {
      deps.setBusy(false);
    }
    await deps.refreshCatalog();
    progress = `Subidas ${uploaded}${failed ? `, sin subir ${failed}` : ''}. Revisá cada una en su producto y aprobala con «Foto propia del negocio».`;
    deps.context.onChange();
    return done(failed === 0, progress);
  }
  return null;
}
