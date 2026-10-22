import { escapeHtml } from '../ui.js';
import { resolveCatalogImageUrl } from '../core/catalog-image-contract.js';
import { imageAttributionFor, rightsReferenceRequiresAttribution } from '../core/image-attribution.js';
import { resolveRuntimeConfig } from '../core/runtime-config.js';
import {
  centsToApiString, describePricing, fromCents, parseMoneyText, PRICING_EXPLANATION, roundMoney, toCents,
} from './catalog-pricing.js';

// Copia del tope de `catalog-sheet-reader.js` (2 MB y 2000 filas). El lector se
// carga recién al importar, así que no se importa desde acá; un test fija que
// los dos números sigan iguales.
const SHEET_LIMITS_COPY = 'hasta 2 MB y 2000 filas';
const SHEET_ACCEPT = '.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv';

export function normalizeCatalogProduct(row = {}) {
  const stock = row.stock === null || row.stock === undefined ? null : Number(row.stock);
  const supabaseUrl = resolveRuntimeConfig().repository?.supabaseUrl || '';
  return {
    id: String(row.id || ''),
    sku: String(row.sku || ''), externalId: String(row.external_id || ''), name: String(row.name || ''), brand: String(row.brand || ''),
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
    // Privado del comercio: llega sólo por `get_catalog_costs` (dueño o encargado).
    unitCost: roundMoney(row.unit_cost ?? null),
    // Precio regular («Antes $ X»). El que se cobra es SIEMPRE `price`.
    compareAtPrice: roundMoney(row.compare_at_price ?? null),
  };
}

export function catalogStockLabel(stock) {
  if (stock === null || stock === undefined) return 'Sin contar';
  if (stock === 0) return 'Agotado';
  return `${stock} ${stock === 1 ? 'unidad' : 'unidades'}`;
}

/**
 * La fila editada → el pedazo de lote que se manda, o el motivo para no mandarlo.
 *
 * Precio y stock: vacío no cambia nada (el precio no se borra; se vuelve a
 * pendiente por otro camino). Costo y precio regular (sólo cuando el Panel los
 * puede leer, si no llegan `undefined`): el campo muestra lo guardado, así que
 * vaciarlo es borrar el costo o terminar la promo. Los importes aceptan punto o
 * coma decimal con la regla de `parseMoneyText` («1.234» es ambiguo).
 */
export function buildCommercialEdit(product, { price = '', stock = '', cost, compareAt } = {}) {
  const patch = { sku: product.sku };
  const priceText = String(price ?? '').trim();
  const stockText = String(stock ?? '').trim();
  const confirmed = product.priceStatus === 'confirmed' && product.price > 0;
  let nextPrice = confirmed ? toCents(product.price) : null;
  if (priceText) {
    const parsed = parseMoneyText(priceText);
    if (parsed.error || !parsed.cents) {
      return { error: `${product.name}: ingresá un precio positivo, con hasta dos decimales y sin separador de miles. Ej.: 1500 o 1500,50.` };
    }
    if (product.priceStatus !== 'confirmed' || parsed.cents !== toCents(product.price)) patch.price = centsToApiString(parsed.cents);
    nextPrice = parsed.cents;
  }
  if (stockText) {
    if (!/^\d+$/.test(stockText) || Number(stockText) > 2147483647) {
      return { error: `${product.name}: el stock contado debe ser un entero no negativo.` };
    }
    if (Number(stockText) !== product.stock) patch.stock = Number(stockText);
  }
  if (cost !== undefined && cost !== null) {
    const costText = String(cost).trim();
    const current = toCents(product.unitCost);
    if (!costText) {
      if (current !== null) patch.unit_cost = null;
    } else {
      const parsed = parseMoneyText(costText);
      if (parsed.error || parsed.cents === undefined) {
        return { error: `${product.name}: el costo tiene que ser un importe de cero o más, con hasta dos decimales y sin separador de miles. Ej.: 1000 o 1000,50.` };
      }
      if (parsed.cents !== current) patch.unit_cost = centsToApiString(parsed.cents);
    }
  }
  if (compareAt !== undefined && compareAt !== null) {
    const regularText = String(compareAt).trim();
    const current = toCents(product.compareAtPrice);
    let nextRegular = current;
    if (!regularText) {
      if (current !== null) patch.compare_at_price = null;
      nextRegular = null;
    } else {
      const parsed = parseMoneyText(regularText);
      if (parsed.error || !parsed.cents) {
        return { error: `${product.name}: el precio regular (antes) tiene que ser un importe mayor que cero, con hasta dos decimales y sin separador de miles.` };
      }
      if (parsed.cents !== current) patch.compare_at_price = centsToApiString(parsed.cents);
      nextRegular = parsed.cents;
    }
    if (nextRegular !== null && nextRegular <= (nextPrice ?? toCents(product.price) ?? 0)) {
      return { error: `${product.name}: el precio regular (antes) tiene que ser mayor que el precio de venta. Si terminó la promo, dejalo vacío.` };
    }
  }
  return { value: Object.keys(patch).length > 1 ? patch : null };
}

/**
 * Ganancia, margen y recargo de lo que la persona está escribiendo, sin
 * guardar nada. Un campo vacío de precio usa el precio confirmado (vaciarlo no
 * lo cambia); vacíos de costo o precio regular cuentan como «sin costo» y «sin
 * promo», que es lo que se guardaría.
 */
export function catalogPricingDraft(product, { price, cost, compareAt } = {}) {
  const read = (text, fallback) => {
    const value = String(text ?? '').trim();
    if (!value) return { value: fallback };
    const parsed = parseMoneyText(value);
    return parsed.error || parsed.cents === undefined ? { invalid: true } : { value: fromCents(parsed.cents) };
  };
  const confirmed = product.priceStatus === 'confirmed' && product.price > 0;
  const priceRead = read(price, confirmed ? product.price : null);
  const costRead = cost === undefined ? { value: product.unitCost } : read(cost, null);
  const regularRead = compareAt === undefined ? { value: product.compareAtPrice } : read(compareAt, null);
  if (priceRead.invalid || costRead.invalid || regularRead.invalid) return { invalid: true };
  return describePricing({ price: priceRead.value, cost: costRead.value, compareAtPrice: regularRead.value });
}

/** El renglón de cuentas debajo de los campos. Se redibuja mientras se escribe. */
export function renderCatalogPricingSummary(pricing) {
  if (!pricing || pricing.invalid) {
    return '<span data-pricing-invalid>Revisá los importes: números con hasta dos decimales, sin separador de miles.</span>';
  }
  const parts = [];
  if (pricing.hasPrice && pricing.hasCost) {
    parts.push(`<span data-pricing-profit>Ganancia por unidad: ${escapeHtml(pricing.labels.profit)}</span>`);
    parts.push(`<span data-pricing-margin>Margen sobre venta: ${escapeHtml(pricing.labels.margin)}</span>`);
    parts.push(`<span data-pricing-markup>Recargo sobre costo: ${escapeHtml(pricing.labels.markup)}</span>`);
  } else {
    parts.push(`<span data-pricing-missing>${escapeHtml(pricing.labels.summary)}</span>`);
  }
  if (pricing.labels.promo) parts.push(`<span data-pricing-promo>Promo: ${escapeHtml(pricing.labels.promo)}</span>`);
  const warnings = pricing.warnings.map((warning) => `<strong data-pricing-warning>${escapeHtml(warning)}</strong>`).join(' ');
  return parts.join(' · ') + (warnings ? ` ${warnings}` : '');
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

/**
 * ¿Se puede publicar desde el Panel, y cómo?
 *
 *   mode 'publish' → ficha ya verificada: `set_commercial_product_publication`.
 *   mode 'verify'  → primera publicación (o después de cambiar la foto): la
 *                    ficha se verifica y se publica en el mismo paso, con el
 *                    MISMO contrato que la planilla (`apply_commercial_catalog_batch`
 *                    con publish = true). Ya no hace falta la terminal.
 *
 * El servidor vuelve a exigir todo: precio, stock, foto válida y licencia de alcohol.
 */
export function catalogPublicationReadiness(product, { imageUploads = [], alcoholEnabled = false } = {}) {
  if (product.available) return { ready: true, reason: '', mode: 'published' };
  if (product.catalogOrigin !== 'commercial' || !product.active) return { ready: false, reason: 'Producto inactivo o fuera del catálogo comercial.' };
  if (product.priceStatus !== 'confirmed' || product.price <= 0) return { ready: false, reason: 'Falta confirmar el precio.' };
  if (product.stock === null) return { ready: false, reason: 'Falta contar el stock.' };
  if (product.stock === 0) return { ready: false, reason: 'El producto está agotado.' };
  if (!product.hasApprovedImage) return { ready: false, reason: 'Falta una imagen aprobada.' };
  if (!catalogImageAttributionStatus(product, imageUploads).ready) {
    return { ready: false, reason: 'La foto tiene licencia CC y la tienda todavía no muestra su crédito.' };
  }
  if (product.alcoholic && !alcoholEnabled) return { ready: false, reason: 'La venta de alcohol requiere habilitación comercial.' };
  if (!product.verified) return { ready: true, reason: '', mode: 'verify' };
  return { ready: true, reason: '', mode: 'publish' };
}

export function renderCatalogEditor({
  products = [], imageUploads = [], canManageImages = false,
  phase = 'idle', message = '', imageMessage = '', busy = false,
  alcoholEnabled = false, pendingReopenSku = '', photoIntake = '',
  pricingAvailable = false, pricingNotice = '', sheetImport = null, canImport = false,
} = {}) {
  const normalized = products.map(normalizeCatalogProduct);
  const rows = normalized.map((product) => {
    const readiness = catalogPublicationReadiness(product, { imageUploads, alcoholEnabled });
    const priceConfirmed = product.priceStatus === 'confirmed' && product.price > 0;
    const saveButton = `<button class="secondary-button compact" type="button" data-catalog-save="${escapeHtml(product.sku)}" ${busy ? 'disabled' : ''}>Guardar</button>`;
    // Costo y precio regular van en una segunda grilla dentro de la MISMA
    // celda de la fila: la fila es una grilla de cuatro columnas y un hijo más
    // la desarma.
    const pricingFields = pricingAvailable
      ? `<div class="business-catalog-fields business-catalog-cost-fields">
          <label>Costo (ARS)<input data-catalog-cost type="text" inputmode="decimal" value="${product.unitCost === null ? '' : escapeHtml(String(product.unitCost))}" placeholder="Sin cargar" ${busy ? 'disabled' : ''}></label>
          <label>Precio regular (antes)<input data-catalog-compare-at type="text" inputmode="decimal" value="${product.compareAtPrice === null ? '' : escapeHtml(String(product.compareAtPrice))}" placeholder="Sin promo" ${busy ? 'disabled' : ''}></label>
          ${saveButton}
        </div>
        <p class="form-hint business-catalog-pricing" data-catalog-pricing-summary aria-live="polite">${renderCatalogPricingSummary(catalogPricingDraft(product))}</p>`
      : '';
    const rowMarkup = `<article class="business-catalog-row" data-catalog-row="${escapeHtml(product.sku)}">
      <div class="business-catalog-identity"><h3>${escapeHtml(product.name)}</h3>
        <span>${escapeHtml([product.brand, product.category, product.packaging, product.capacity].filter(Boolean).join(' · '))}</span>
        <small>SKU: ${escapeHtml(product.sku)}</small></div>
      <div class="business-catalog-state"><span class="status-pill ${priceConfirmed ? 'success' : 'warning'}">${priceConfirmed ? 'Precio confirmado' : 'Precio pendiente'}</span>
        <span class="status-pill ${product.stock === null ? 'warning' : product.stock === 0 ? 'danger' : 'success'}">${escapeHtml(catalogStockLabel(product.stock))}</span>
        <span class="status-pill ${product.available ? 'success' : 'warning'}">${product.available ? 'Disponible · publicado' : 'No disponible · borrador'}</span>
        <span class="status-pill ${product.hasApprovedImage ? 'success' : 'warning'}">${product.hasApprovedImage ? 'Imagen asociada' : 'Imagen pendiente'}</span></div>
      <div class="business-catalog-editing">
      <div class="business-catalog-fields">
        <label>Precio de venta (ARS)<input data-catalog-price type="text" inputmode="decimal" value="${priceConfirmed ? escapeHtml(String(product.price)) : ''}" placeholder="Sin confirmar" ${busy ? 'disabled' : ''}></label>
        <label>Stock contado<input data-catalog-stock type="text" inputmode="numeric" value="${product.stock === null ? '' : escapeHtml(String(product.stock))}" placeholder="Sin contar" ${busy ? 'disabled' : ''}></label>
        ${pricingAvailable ? '' : saveButton}
      </div>${pricingFields}
      </div>
      <div class="business-catalog-publication">${product.available
        ? `<button class="secondary-button compact" type="button" data-catalog-publication="${escapeHtml(product.sku)}" data-publish="false" ${busy ? 'disabled' : ''}>Ocultar de la tienda</button>`
        : readiness.ready && readiness.mode === 'verify'
          ? `<button class="primary-button compact" type="button" data-catalog-verify-publish="${escapeHtml(product.sku)}" ${busy ? 'disabled' : ''}>Verificar ficha y publicar</button>
             <small>Revisá nombre, presentación, precio y foto: al publicar quedan como la ficha oficial del producto.</small>`
          : readiness.ready
            ? `<button class="primary-button compact" type="button" data-catalog-publication="${escapeHtml(product.sku)}" data-publish="true" ${busy ? 'disabled' : ''}>Publicar y habilitar</button>`
            : `<small>${escapeHtml(readiness.reason)}</small>`}
        ${canManageImages && (product.verified || product.available) && product.externalId
          ? (pendingReopenSku === product.sku
            ? `<p class="production-intake-error" role="alert">Vuelve a borrador: deja de verse en la tienda hasta que lo verifiques y publiques de nuevo.</p>
               <button class="ghost-button compact" type="button" data-catalog-reopen="${escapeHtml(product.sku)}" data-confirmed="true" ${busy ? 'disabled' : ''}>Sí, volver a borrador</button>
               <button class="text-button" type="button" data-catalog-reopen-cancel>No</button>`
            : `<button class="text-button" type="button" data-catalog-reopen="${escapeHtml(product.sku)}" ${busy ? 'disabled' : ''}>Cambiar foto o ficha (vuelve a borrador)</button>`)
          : ''}</div>
    </article>`;
    const imageManager = canManageImages
      ? renderCatalogImageManager(product, imageUploads, { busy, imageMessage })
      : '';
    return rowMarkup.replace('</article>', imageManager + '</article>');
  }).join('');
  const pricingIntro = pricingAvailable
    ? `<p class="form-hint" data-catalog-pricing-explanation>${escapeHtml(PRICING_EXPLANATION)} El costo es privado: la tienda no lo muestra. El precio regular es el «Antes» de una promo: se cobra siempre el precio de venta.</p>`
    : (pricingNotice && phase === 'ready' ? `<p class="form-hint" data-catalog-pricing-notice>${escapeHtml(pricingNotice)}</p>` : '');
  return `<section class="business-ops-panel business-catalog-editor"><header><div><p class="eyebrow">Centro operativo</p><h2>Catálogo</h2>
    <p>Completá precio y stock sin publicar automáticamente. El botón de publicación aparece cuando la ficha está lista.</p>
    ${pricingIntro}</div></header>
    <div class="business-catalog-toolbar"><strong data-catalog-visible-count>${normalized.length} productos</strong>
      <input data-catalog-search type="search" aria-label="Buscar producto" placeholder="Buscar nombre, marca o SKU" autocomplete="off">
      <button class="ghost-button compact" type="button" data-catalog-refresh ${busy ? 'disabled' : ''}>Actualizar</button>
      <button class="primary-button compact" type="button" data-catalog-save-all ${busy || !normalized.length ? 'disabled' : ''}>Guardar cambios de la lista</button></div>
    ${phase === 'loading' ? '<p role="status">Cargando productos…</p>' : ''}
    ${message ? `<p role="status">${escapeHtml(message)}</p>` : ''}
    ${canImport ? renderCatalogImport(sheetImport || {}, { busy }) : ''}
    ${canManageImages ? photoIntake : ''}
    <div class="business-catalog-list">${rows || (phase === 'ready' ? '<p>No hay productos para este negocio.</p>' : '')}</div>
  </section>`;
}

// ── Importar planilla ───────────────────────────────────────────────────────

const IMPORT_STATUS = Object.freeze({
  change: ['Se aplica', 'success'],
  unchanged: ['Sin cambios', 'success'],
  blocked: ['No se publica', 'warning'],
  error: ['Con error · no se aplica', 'danger'],
  unknown: ['SKU desconocido · no se aplica', 'danger'],
});
const IMPORT_RESULT = Object.freeze({
  applied: ['Aplicado', 'success'],
  failed: ['No se aplicó', 'danger'],
  skipped: ['No se intentó', 'warning'],
});
const IMPORT_ORDER = Object.freeze({ error: 0, unknown: 0, failed: 0, blocked: 1, skipped: 1, change: 2, applied: 2, unchanged: 3 });
/** Tope de filas dibujadas: una planilla de 2000 filas no puede volver pesado cada redibujo del Panel. */
const IMPORT_VISIBLE_ROWS = 300;

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

function renderImportRow(row) {
  const [statusLabel, statusTone] = row.result ? IMPORT_RESULT[row.result.status] || IMPORT_STATUS.change : IMPORT_STATUS[row.status] || IMPORT_STATUS.error;
  const changes = row.changes?.length
    ? `<ul>${row.changes.map((change) => `<li>${escapeHtml(change.label)}: ${escapeHtml(change.before)} → ${escapeHtml(change.after)}</li>`).join('')}</ul>`
    : `<span>${row.status === 'error' || row.status === 'unknown' ? '—' : 'Sin cambios'}</span>`;
  const pricing = row.pricing && row.pricing.hasPrice && row.pricing.hasCost
    ? `<small>Margen sobre venta ${escapeHtml(row.pricing.labels.margin)} · Recargo sobre costo ${escapeHtml(row.pricing.labels.markup)}${row.pricing.labels.promo ? ` · Promo: ${escapeHtml(row.pricing.labels.promo)}` : ''}</small>`
    : '';
  const notes = (row.notes || []).map((note) => `<small>${escapeHtml(note)}</small>`).join('');
  const errors = (row.errors || []).map((error) => `<p class="production-intake-error">${escapeHtml(error)}</p>`).join('');
  const result = row.result?.message ? `<small data-catalog-import-result="${escapeHtml(row.result.status)}">${escapeHtml(row.result.message)}</small>` : '';
  return `<tr data-catalog-import-row="${escapeHtml(row.sku)}" data-catalog-import-status="${escapeHtml(row.result?.status || row.status)}">
      <td>${escapeHtml(String(row.line))}</td>
      <td><strong>${escapeHtml(row.name || 'Sin nombre')}</strong><br><small>SKU: ${escapeHtml(row.sku || 'sin SKU')}</small></td>
      <td>${changes}${pricing}${notes}</td>
      <td><span class="status-pill ${statusTone}">${escapeHtml(statusLabel)}</span>${errors}${result}</td>
    </tr>`;
}

function renderImportPlan(plan, state) {
  const summary = plan.summary;
  const counts = [
    plural(summary.rows, 'fila leída', 'filas leídas'),
    plural(summary.changes, 'con cambios', 'con cambios'),
    summary.unchanged ? plural(summary.unchanged, 'sin cambios', 'sin cambios') : '',
    summary.blocked ? plural(summary.blocked, 'que no se puede publicar', 'que no se pueden publicar') : '',
    summary.errors ? plural(summary.errors, 'con error', 'con errores') : '',
    summary.unknown ? plural(summary.unknown, 'con SKU desconocido', 'con SKU desconocido') : '',
  ].filter(Boolean).join(' · ');
  const rows = (state.outcome?.rows || plan.rows)
    .filter((row) => row.result || row.status !== 'unchanged')
    .map((row, index) => ({ row, index, order: IMPORT_ORDER[row.result?.status || row.status] ?? 2 }))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map(({ row }) => row);
  const visible = rows.slice(0, IMPORT_VISIBLE_ROWS);
  const source = [state.fileName ? `«${state.fileName}»` : '', state.sheetName ? `hoja «${state.sheetName}»` : '', `encabezado en la fila ${plan.headerRow}`]
    .filter(Boolean).join(' · ');
  const outcome = state.outcome
    ? `<p class="${state.outcome.ok ? 'form-hint' : 'production-intake-error'}" role="status" data-catalog-import-outcome>${escapeHtml(state.outcome.message)}</p>`
    : '';
  return `<div class="business-catalog-import-preview">
      <p data-catalog-import-source>${escapeHtml(source)}</p>
      <p data-catalog-import-summary>${escapeHtml(counts)}</p>
      ${(plan.notices || []).map((notice) => `<p class="form-hint" data-catalog-import-notice>${escapeHtml(notice)}</p>`).join('')}
      ${outcome}
      ${visible.length ? `<div class="business-catalog-import-table"><table>
        <caption>${state.outcome ? 'Resultado de la planilla' : 'Vista previa: nada se guardó todavía'}</caption>
        <thead><tr><th scope="col">Fila</th><th scope="col">Producto</th><th scope="col">Qué cambia</th><th scope="col">Estado</th></tr></thead>
        <tbody>${visible.map(renderImportRow).join('')}</tbody>
      </table></div>` : '<p class="form-hint">Ninguna fila cambia algo del catálogo.</p>'}
      ${rows.length > visible.length ? `<p class="form-hint">Se muestran ${visible.length} de ${rows.length} filas: primero las que tienen problemas.</p>` : ''}
    </div>`;
}

/**
 * El bloque «Importar planilla». `state` lo maneja el centro operativo:
 * { phase: 'idle'|'reading'|'preview'|'applying'|'done'|'error', fileName,
 *   sheetName, plan, outcome, message, error }.
 */
export function renderCatalogImport(state = {}, { busy = false } = {}) {
  const phase = String(state?.phase || 'idle');
  const working = phase === 'reading' || phase === 'applying';
  const disabled = busy || working ? 'disabled' : '';
  const plan = state?.plan?.ok ? state.plan : null;
  const pending = plan && phase === 'preview' ? plan.patches.length : 0;
  let actions = '';
  if (phase === 'applying') {
    actions = '<button class="primary-button compact" type="button" data-catalog-import-apply disabled aria-busy="true">Aplicando cambios…</button>';
  } else if (phase === 'preview' && plan) {
    actions = (pending
      ? `<button class="primary-button compact" type="button" data-catalog-import-apply ${disabled}>Aplicar ${plural(pending, 'cambio', 'cambios')}</button>`
      : '')
      + `<button class="ghost-button compact" type="button" data-catalog-import-discard ${disabled}>Descartar</button>`;
  } else if (phase === 'done' || phase === 'error') {
    actions = `<button class="ghost-button compact" type="button" data-catalog-import-discard ${disabled}>${phase === 'done' ? 'Cerrar el resultado' : 'Empezar de nuevo'}</button>`;
  }
  const status = phase === 'reading'
    ? '<p role="status">Leyendo la planilla…</p>'
    : phase === 'applying' ? '<p role="status">Aplicando los cambios. No cierres esta pantalla.</p>' : '';
  const message = state?.message
    ? `<p class="${state.error ? 'production-intake-error' : 'form-hint'}" role="${state.error ? 'alert' : 'status'}" data-catalog-import-message>${escapeHtml(state.message)}</p>`
    : '';
  return `<details class="business-catalog-import" data-catalog-import${phase === 'idle' ? '' : ' open'}>
    <summary><strong>Importar planilla</strong> <span>Precios, costos, stock y promos desde Excel o CSV</span></summary>
    <div class="business-catalog-import-body">
      <p class="form-hint">Subí la planilla de productos (.xlsx o .csv, ${SHEET_LIMITS_COPY}). Primero ves qué cambia en cada producto: nada se guarda hasta que tocás «Aplicar».</p>
      <p class="form-hint">Una celda vacía no cambia nada. Para borrar un costo o terminar una promo, escribí «quitar» en esa celda. «¿Disponible para vender?» en Sí publica sólo si el producto tiene precio, stock y foto aprobada.</p>
      <div class="business-catalog-import-picker">
        <label>Archivo de planilla<input type="file" data-catalog-import-file accept="${SHEET_ACCEPT}" ${disabled}></label>
        <button class="secondary-button compact" type="button" data-catalog-import-read ${disabled}>Revisar planilla</button>
      </div>
      ${status}${message}
      ${plan ? renderImportPlan(plan, state) : ''}
      <div class="business-catalog-import-actions">${actions}</div>
    </div>
  </details>`;
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
    + (product.verified || product.available
      ? '<p class="form-hint">Para cambiar la foto, primero volvé el producto a borrador con «Cambiar foto o ficha».</p>'
      : '')
    + '<form data-catalog-image-form="' + escapeHtml(product.id) + '" novalidate' + (product.verified || product.available ? ' hidden' : '') + '>'
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
