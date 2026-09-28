import { escapeHtml } from '../ui.js';
import { resolveCatalogImageUrl } from '../core/catalog-image-contract.js';
import { imageAttributionFor, rightsReferenceRequiresAttribution } from '../core/image-attribution.js';
import { resolveRuntimeConfig } from '../core/runtime-config.js';

export function normalizeCatalogProduct(row = {}) {
  const stock = row.stock === null || row.stock === undefined ? null : Number(row.stock);
  const supabaseUrl = resolveRuntimeConfig().repository?.supabaseUrl || '';
  return {
    id: String(row.id || ''),
    sku: String(row.sku || ''), name: String(row.name || ''), brand: String(row.brand || ''),
    variant: String(row.variant || ''), category: String(row.category || ''),
    packaging: String(row.packaging_type || ''), capacity: String(row.capacity || ''),
    price: Number(row.price || 0), priceStatus: String(row.price_status || 'pending'),
    stock: Number.isSafeInteger(stock) ? stock : null,
    available: row.available === true, merchantAvailable: row.merchant_available === true,
    verified: row.is_verified === true, active: row.is_active === true,
    alcoholic: row.is_alcoholic === true, hasApprovedImage: Boolean(row.image_url && row.catalog_asset_id),
    imageUrl: resolveCatalogImageUrl(row.image_url || '', supabaseUrl),
    imageThumbnailUrl: resolveCatalogImageUrl(row.image_thumbnail_url || '', supabaseUrl),
    sourceImageSha256: String(row.source_image_sha256 || ''),
    catalogOrigin: String(row.catalog_origin || ''),
  };
}

export function catalogStockLabel(stock) {
  if (stock === null || stock === undefined) return 'Sin contar';
  if (stock === 0) return 'Agotado';
  return `${stock} ${stock === 1 ? 'unidad' : 'unidades'}`;
}

export function buildCommercialEdit(product, { price = '', stock = '' } = {}) {
  const patch = { sku: product.sku };
  const priceText = String(price).trim();
  const stockText = String(stock).trim();
  if (priceText) {
    if (!/^\d+(?:\.\d{1,2})?$/.test(priceText) || Number(priceText) <= 0 || Number(priceText) > 9999999999.99) {
      return { error: `${product.name}: ingresá un precio positivo, sin separador de miles y con hasta dos decimales.` };
    }
    if (product.priceStatus !== 'confirmed' || Number(priceText) !== product.price) patch.price = priceText;
  }
  if (stockText) {
    if (!/^\d+$/.test(stockText) || Number(stockText) > 2147483647) {
      return { error: `${product.name}: el stock contado debe ser un entero no negativo.` };
    }
    if (Number(stockText) !== product.stock) patch.stock = Number(stockText);
  }
  return { value: Object.keys(patch).length > 1 ? patch : null };
}

// La foto asociada es la de la última revisión aprobada del producto: aprobar
// reemplaza la asociación. Si esa revisión declara una licencia CC, la tienda
// tiene que mostrar el crédito (core/image-attribution.js) antes de publicar.
export function catalogImageAttributionStatus(product, imageUploads = []) {
  if (!product?.hasApprovedImage) return { required: false, ready: true };
  const approved = imageUploads
    .filter((upload) => upload?.product_id === product.id && upload?.status === 'approved')
    .sort((a, b) => String(b.reviewed_at || b.created_at || '').localeCompare(String(a.reviewed_at || a.created_at || '')))[0];
  const required = rightsReferenceRequiresAttribution(approved?.rights_reference);
  return { required, ready: !required || Boolean(imageAttributionFor(product)) };
}

export function catalogPublicationReadiness(product, { imageUploads = [] } = {}) {
  if (product.available) return { ready: true, reason: '' };
  if (product.catalogOrigin !== 'commercial' || !product.active) return { ready: false, reason: 'Producto inactivo o fuera del catálogo comercial.' };
  if (product.priceStatus !== 'confirmed' || product.price <= 0) return { ready: false, reason: 'Falta confirmar el precio.' };
  if (product.stock === null) return { ready: false, reason: 'Falta contar el stock.' };
  if (product.stock === 0) return { ready: false, reason: 'El producto está agotado.' };
  if (!product.hasApprovedImage) return { ready: false, reason: 'Falta una imagen aprobada.' };
  if (!catalogImageAttributionStatus(product, imageUploads).ready) {
    return { ready: false, reason: 'La foto tiene licencia CC y la tienda todavía no muestra su crédito.' };
  }
  if (!product.verified) return { ready: false, reason: 'Falta verificar la ficha comercial.' };
  if (product.alcoholic) return { ready: false, reason: 'La venta de alcohol requiere habilitación comercial.' };
  return { ready: true, reason: '' };
}

export function renderCatalogEditor({
  products = [], imageUploads = [], canManageImages = false,
  phase = 'idle', message = '', imageMessage = '', busy = false,
} = {}) {
  const normalized = products.map(normalizeCatalogProduct);
  const rows = normalized.map((product) => {
    const readiness = catalogPublicationReadiness(product, { imageUploads });
    const priceConfirmed = product.priceStatus === 'confirmed' && product.price > 0;
    const rowMarkup = `<article class="business-catalog-row" data-catalog-row="${escapeHtml(product.sku)}">
      <div class="business-catalog-identity"><h3>${escapeHtml(product.name)}</h3>
        <span>${escapeHtml([product.brand, product.category, product.packaging, product.capacity].filter(Boolean).join(' · '))}</span>
        <small>SKU: ${escapeHtml(product.sku)}</small></div>
      <div class="business-catalog-state"><span class="status-pill ${priceConfirmed ? 'success' : 'warning'}">${priceConfirmed ? 'Precio confirmado' : 'Precio pendiente'}</span>
        <span class="status-pill ${product.stock === null ? 'warning' : product.stock === 0 ? 'danger' : 'success'}">${escapeHtml(catalogStockLabel(product.stock))}</span>
        <span class="status-pill ${product.available ? 'success' : 'warning'}">${product.available ? 'Disponible · publicado' : 'No disponible · borrador'}</span>
        <span class="status-pill ${product.hasApprovedImage ? 'success' : 'warning'}">${product.hasApprovedImage ? 'Imagen asociada' : 'Imagen pendiente'}</span></div>
      <div class="business-catalog-fields">
        <label>Precio (ARS)<input data-catalog-price type="text" inputmode="decimal" value="${priceConfirmed ? escapeHtml(String(product.price)) : ''}" placeholder="Sin confirmar" ${busy ? 'disabled' : ''}></label>
        <label>Stock contado<input data-catalog-stock type="text" inputmode="numeric" value="${product.stock === null ? '' : escapeHtml(String(product.stock))}" placeholder="Sin contar" ${busy ? 'disabled' : ''}></label>
        <button class="secondary-button compact" type="button" data-catalog-save="${escapeHtml(product.sku)}" ${busy ? 'disabled' : ''}>Guardar</button>
      </div>
      <div class="business-catalog-publication">${product.available
        ? `<button class="secondary-button compact" type="button" data-catalog-publication="${escapeHtml(product.sku)}" data-publish="false" ${busy ? 'disabled' : ''}>Pasar a borrador</button>`
        : readiness.ready
          ? `<button class="primary-button compact" type="button" data-catalog-publication="${escapeHtml(product.sku)}" data-publish="true" ${busy ? 'disabled' : ''}>Publicar y habilitar</button>`
          : `<small>${escapeHtml(readiness.reason)}</small>`}</div>
    </article>`;
    const imageManager = canManageImages
      ? renderCatalogImageManager(product, imageUploads, { busy, imageMessage })
      : '';
    return rowMarkup.replace('</article>', imageManager + '</article>');
  }).join('');
  return `<section class="business-ops-panel business-catalog-editor"><header><div><p class="eyebrow">Centro operativo</p><h2>Catálogo</h2>
    <p>Completá precio y stock sin publicar automáticamente. El botón de publicación aparece cuando la ficha está lista.</p></div></header>
    <div class="business-catalog-toolbar"><strong data-catalog-visible-count>${normalized.length} productos</strong>
      <input data-catalog-search type="search" aria-label="Buscar producto" placeholder="Buscar nombre, marca o SKU" autocomplete="off">
      <button class="ghost-button compact" type="button" data-catalog-refresh ${busy ? 'disabled' : ''}>Actualizar</button>
      <button class="primary-button compact" type="button" data-catalog-save-all ${busy || !normalized.length ? 'disabled' : ''}>Guardar cambios de la lista</button></div>
    ${phase === 'loading' ? '<p role="status">Cargando productos…</p>' : ''}
    ${message ? `<p role="status">${escapeHtml(message)}</p>` : ''}
    <div class="business-catalog-list">${rows || (phase === 'ready' ? '<p>No hay productos para este negocio.</p>' : '')}</div>
  </section>`;
}

function renderCatalogImageManager(product, imageUploads, { busy = false, imageMessage = '' } = {}) {
  const uploads = imageUploads.filter((upload) => upload.product_id === product.id).slice(0, 5);
  const history = uploads.map((upload) => {
    const storagePending = upload.status === 'approved' && upload.cleanup_status !== 'complete';
    const status = storagePending
      ? 'Aprobada · almacenamiento pendiente'
      : upload.status === 'approved' ? 'Aprobada'
        : upload.status === 'rejected' ? 'Rechazada' : 'Pendiente de revisión';
    const previewReady = Boolean(
      upload.preview_url
      && Date.parse(upload.preview_expires_at || '') > Date.now(),
    );
    const preview = upload.status === 'pending' && previewReady
      ? '<img class="business-catalog-image-preview" src="' + escapeHtml(upload.preview_url)
        + '" alt="Vista previa privada de ' + escapeHtml(product.name) + '" loading="lazy" decoding="async">'
      : '';
    const previewButton = upload.status === 'pending' && upload.upload_completed_at
      ? '<button class="secondary-button compact" type="button" data-catalog-image-preview="' + escapeHtml(upload.id)
        + '" ' + (busy ? 'disabled' : '') + '>Vista previa privada</button>'
      : '';
    const storageRetry = storagePending
      ? '<button class="secondary-button compact" type="button" data-catalog-image-approve="' + escapeHtml(upload.id)
        + '" ' + (busy ? 'disabled' : '') + '>Reintentar almacenamiento</button>'
      : '';
    const source = upload.source_url
      ? '<a href="' + escapeHtml(upload.source_url) + '" target="_blank" rel="noopener noreferrer">Abrir fuente original</a>'
      : '<span>Foto propia del negocio</span>';
    const rights = upload.status === 'approved' && upload.rights_status
      ? '<small>' + escapeHtml(upload.rights_status) + ' · ' + escapeHtml(upload.rights_reference || '') + '</small>'
      : '';
    let review = '';
    if (upload.status === 'pending' && upload.upload_completed_at && previewReady) {
      review = '<div class="business-catalog-image-review">'
        + '<label>Derecho de uso<select data-catalog-image-rights-status required ' + (busy ? 'disabled' : '') + '>'
        + '<option value="">Seleccioná evidencia</option>'
        + '<option value="PROPIO">Foto propia del negocio</option>'
        + '<option value="LICENCIA_COMERCIAL">Licencia comercial</option>'
        + '<option value="PERMISO_DOCUMENTADO">Permiso documentado</option>'
        + '</select></label>'
        + '<label>Referencia de autorización<input type="text" data-catalog-image-rights-reference maxlength="300" placeholder="Referencia verificable" ' + (busy ? 'disabled' : '') + '></label>'
        + '<button class="primary-button compact" type="button" data-catalog-image-approve="' + escapeHtml(upload.id) + '" ' + (busy ? 'disabled' : '') + '>Aprobar y asociar</button>'
        + '</div>';
    }
    const reject = upload.status === 'pending'
      ? '<div class="business-catalog-image-reject"><label>Motivo para rechazar<input type="text" data-catalog-image-reject-reason maxlength="300" placeholder="Identidad, calidad o licencia" ' + (busy ? 'disabled' : '') + '></label>'
        + '<button class="secondary-button compact" type="button" data-catalog-image-reject="' + escapeHtml(upload.id) + '" ' + (busy ? 'disabled' : '') + '>Rechazar imagen</button></div>'
      : '';
    return '<article class="business-catalog-image-review-item" data-catalog-image-status="' + escapeHtml(upload.status) + '">'
      + '<div><strong>' + status + '</strong><span>' + escapeHtml(upload.source_type || '') + ' · ' + escapeHtml(upload.source_domain || 'Foto propia') + '</span>' + source + rights + '</div>'
      + preview + previewButton + storageRetry
      + (upload.status === 'pending' && upload.upload_completed_at && !previewReady
        ? '<small>La aprobación requiere abrir y revisar esta vista previa privada.</small>' : '')
      + (upload.rejection_reason ? '<small>' + escapeHtml(upload.rejection_reason) + '</small>' : '')
      + review + reject + '</article>';
  }).join('');
  const attribution = catalogImageAttributionStatus(product, imageUploads);
  const attributionNote = !attribution.required ? ''
    : attribution.ready
      ? '<small data-catalog-image-attribution="ready">Licencia CC: la ficha pública muestra el crédito de la foto.</small>'
      : '<small data-catalog-image-attribution="missing">Licencia CC sin crédito en la tienda: no se puede publicar.</small>';
  const active = product.hasApprovedImage && product.imageThumbnailUrl
    ? '<img class="business-catalog-image-preview" src="' + escapeHtml(product.imageThumbnailUrl)
      + '" alt="Imagen aprobada de ' + escapeHtml(product.name) + '" loading="lazy" decoding="async">'
    : '<span class="business-catalog-image-empty">Sin imagen aprobada</span>';
  return '<details class="business-catalog-image-manager" data-catalog-image-product="' + escapeHtml(product.id) + '">'
    + '<summary><strong>Imagen</strong><span class="status-pill ' + (product.hasApprovedImage ? 'success' : 'warning') + '">'
    + (product.hasApprovedImage ? 'Aprobada' : 'Pendiente') + '</span></summary>'
    + '<div class="business-catalog-image-body">' + active + attributionNote
    + '<form data-catalog-image-form="' + escapeHtml(product.id) + '" novalidate>'
    + '<label>Archivo de imagen<input type="file" data-catalog-image-file accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" ' + (busy ? 'disabled' : '') + '></label>'
    + '<label>Tipo de fuente<select data-catalog-image-source-type required ' + (busy ? 'disabled' : '') + '>'
    + '<option value="">Seleccioná fuente</option><option value="brand">Marca</option>'
    + '<option value="manufacturer">Fabricante</option><option value="official_distributor">Distribuidor oficial</option>'
    + '<option value="retail_reference">Retail de referencia</option><option value="business_owned_photo">Foto propia</option>'
    + '</select></label>'
    + '<label>URL de origen (vacía para foto propia)<input type="url" data-catalog-image-source-url maxlength="2048" placeholder="https://…" ' + (busy ? 'disabled' : '') + '></label>'
    + '<button class="secondary-button compact" type="button" data-catalog-image-upload="' + escapeHtml(product.id) + '" ' + (busy ? 'disabled' : '') + '>Subir para revisión</button>'
    + '</form>'
    + (imageMessage ? '<p role="status">' + escapeHtml(imageMessage) + '</p>' : '')
    + '<p class="business-catalog-image-private-note">La imagen queda privada hasta que un owner/admin apruebe los derechos y la asocie. Subirla no cambia precio, stock ni publicación.</p>'
    + '<div class="business-catalog-image-review-list">' + (history || '<small>Sin cargas de imágenes para este producto.</small>') + '</div>'
    + '</div></details>';
}
