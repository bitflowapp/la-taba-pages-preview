import { escapeHtml } from '../ui.js';

export function normalizeCatalogProduct(row = {}) {
  const stock = row.stock === null || row.stock === undefined ? null : Number(row.stock);
  return {
    sku: String(row.sku || ''), name: String(row.name || ''), brand: String(row.brand || ''),
    variant: String(row.variant || ''), category: String(row.category || ''),
    packaging: String(row.packaging_type || ''), capacity: String(row.capacity || ''),
    price: Number(row.price || 0), priceStatus: String(row.price_status || 'pending'),
    stock: Number.isSafeInteger(stock) ? stock : null,
    available: row.available === true, merchantAvailable: row.merchant_available === true,
    verified: row.is_verified === true, active: row.is_active === true,
    alcoholic: row.is_alcoholic === true, hasApprovedImage: Boolean(row.image_url && row.catalog_asset_id),
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

export function catalogPublicationReadiness(product) {
  if (product.available) return { ready: true, reason: '' };
  if (product.catalogOrigin !== 'commercial' || !product.active) return { ready: false, reason: 'Producto inactivo o fuera del catálogo comercial.' };
  if (product.priceStatus !== 'confirmed' || product.price <= 0) return { ready: false, reason: 'Falta confirmar el precio.' };
  if (product.stock === null) return { ready: false, reason: 'Falta contar el stock.' };
  if (product.stock === 0) return { ready: false, reason: 'El producto está agotado.' };
  if (!product.hasApprovedImage) return { ready: false, reason: 'Falta una imagen aprobada.' };
  if (!product.verified) return { ready: false, reason: 'Falta verificar la ficha comercial.' };
  if (product.alcoholic) return { ready: false, reason: 'La venta de alcohol requiere habilitación comercial.' };
  return { ready: true, reason: '' };
}

export function renderCatalogEditor({ products = [], phase = 'idle', message = '', busy = false } = {}) {
  const normalized = products.map(normalizeCatalogProduct);
  const rows = normalized.map((product) => {
    const readiness = catalogPublicationReadiness(product);
    const priceConfirmed = product.priceStatus === 'confirmed' && product.price > 0;
    return `<article class="business-catalog-row" data-catalog-row="${escapeHtml(product.sku)}">
      <div class="business-catalog-identity"><h3>${escapeHtml(product.name)}</h3>
        <span>${escapeHtml([product.brand, product.category, product.packaging, product.capacity].filter(Boolean).join(' · '))}</span>
        <small>SKU: ${escapeHtml(product.sku)}</small></div>
      <div class="business-catalog-state"><span class="status-pill ${priceConfirmed ? 'success' : 'warning'}">${priceConfirmed ? 'Precio confirmado' : 'Precio pendiente'}</span>
        <span class="status-pill ${product.stock === null ? 'warning' : product.stock === 0 ? 'danger' : 'success'}">${escapeHtml(catalogStockLabel(product.stock))}</span>
        <span class="status-pill ${product.available ? 'success' : 'warning'}">${product.available ? 'Disponible · publicado' : 'No disponible · borrador'}</span></div>
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
