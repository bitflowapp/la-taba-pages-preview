// ─────────────────────────────────────────────────────────────────────────────
// Growth engine · PLACEMENTS.
// -----------------------------------------------------------------------------
// El puente entre el motor y la vidriera: arma la vista de catálogo que
// consume la elegibilidad, aplica las reglas de contexto de cada superficie y
// produce el marcado HTML de las piezas. ui.js sólo pregunta "¿qué va acá?" y
// pinta; si la respuesta es null, pinta EXACTAMENTE lo que pintaba antes del
// motor (fallback = la tienda actual, ya auditada).
//
// Reglas por superficie:
//   · hero: la mejor campaña de hero; la pieza por defecto no lleva imagen
//     inline y conserva la banda del CSS + preload del shell.
//   · door (banners intercalados): ranking multi-slot con diversidad, nunca
//     un rubro que ya tiene carrusel en pantalla.
//   · catalog-inline: UNA pieza dentro de la grilla; jamás la categoría que
//     ya se está mirando (salvo combo, que es un armado con ahorro real),
//     jamás durante una búsqueda, jamás con menos de 4 productos.
//
// Todo el texto visible pasa por escape; las imágenes van por estilo inline
// (resolución relativa al documento, la lección del hero está en ui.js).
import { getState, money } from '../state.js';
import { getCustomerCatalogProducts } from '../core/catalog-store.js';
import { isPurchasableBeverageProduct } from '../core/beverage-home-sections.js';
import { chargeableCombos } from '../core/combos.js';
import { COMBO_MANIFEST } from '../combos-data.js';
import { GROWTH_CAMPAIGNS } from './campaigns-data.js';
import {
  getGrowthAffinity,
  getGrowthRenderEpoch,
  selectGrowthCampaigns,
} from './engine.js';
import { normalizedAffinity } from './intent-model.js';
import { CATEGORY_INTENT_THRESHOLD } from './growth-config.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// ── Vista de catálogo ────────────────────────────────────────────────────────
// Derivada del estado vivo y memoizada por referencia del array de productos:
// renderAll llama varios placements por pintado y la vista es la misma.
const catalogViewMemo = new WeakMap();

export function buildGrowthCatalogView(state = getState()) {
  const productsRef = state.products;
  if (Array.isArray(productsRef) && catalogViewMemo.has(productsRef)) {
    return catalogViewMemo.get(productsRef);
  }
  const products = getCustomerCatalogProducts(productsRef);
  const purchasable = products.filter(isPurchasableBeverageProduct);
  const view = {
    purchasableCategoryIds: new Set(purchasable.map((product) => product.categoryId).filter(Boolean)),
    purchasableBrandKeys: new Set(
      purchasable.map((product) => String(product.brand || '').trim().toLowerCase()).filter(Boolean),
    ),
    purchasableProductIds: new Set(purchasable.map((product) => product.id)),
    chargeableComboIds: new Set(
      chargeableCombos(COMBO_MANIFEST, products).map((combo) => combo.comboId),
    ),
  };
  if (Array.isArray(productsRef)) catalogViewMemo.set(productsRef, view);
  return view;
}

// Categorías presentes en el carrito (productos + combos): la señal de
// complementariedad del ranking.
export function growthCartCategoryIds(state = getState()) {
  const byId = new Map((state.products || []).map((product) => [product.id, product]));
  const result = new Set();
  for (const line of state.cart || []) {
    const category = byId.get(line?.productId)?.categoryId;
    if (category) result.add(category);
  }
  const comboById = new Map(COMBO_MANIFEST.map((combo) => [combo.comboId, combo]));
  for (const line of state.comboSelections || []) {
    const category = comboById.get(line?.comboId)?.categoryId;
    if (category) result.add(category);
  }
  return [...result];
}

function findCampaignById(campaignId) {
  return GROWTH_CAMPAIGNS.find((campaign) => campaign.id === campaignId) || null;
}

export { findCampaignById as growthCampaignById };

// ── Marcado ──────────────────────────────────────────────────────────────────

function ctaAttributes(campaign) {
  if (campaign.kind === 'combo' && campaign.comboId) {
    return `data-combo-detail="${escapeHtml(campaign.comboId)}"`;
  }
  if (campaign.brand) {
    return `data-brand-query="${escapeHtml(campaign.brand)}"`;
  }
  return `data-category-id="${escapeHtml(campaign.categoryIds[0] || 'all')}"`;
}

function growthAttributes(campaign, placement) {
  return `data-growth-campaign="${escapeHtml(campaign.id)}" data-growth-placement="${escapeHtml(placement)}"`;
}

function inlineMedia(campaign, className) {
  const image = campaign.creative.image;
  if (!image) return '';
  const focus = campaign.creative.focus ? `;background-position:${campaign.creative.focus}` : '';
  return `<span class="${className}" aria-hidden="true" style="background-image:url('${encodeURI(image)}')${focus}"></span>`;
}

/**
 * Hero contextual. La pieza por defecto (sin `creative.image`) devuelve ''
 * en la media inline: el CSS pinta la banda curada de siempre y el preload
 * del shell sigue siendo el archivo correcto.
 */
export function growthHeroMarkup(campaign) {
  const { creative } = campaign;
  const aria = [creative.title, creative.subtitle, creative.ctaLabel].filter(Boolean).join('. ');
  const media = creative.image
    ? inlineMedia(campaign, 'home-hero-promo-media has-growth-media')
    : '<span class="home-hero-promo-media" aria-hidden="true"></span>';
  return `
    <button class="home-hero-promo" type="button" ${ctaAttributes(campaign)} ${growthAttributes(campaign, 'hero')} aria-label="${escapeHtml(aria)}">
      ${media}
      <span class="home-hero-promo-copy">
        <small>${escapeHtml(creative.eyebrow)}</small>
        <strong>${escapeHtml(creative.title)}</strong>
        ${creative.subtitle ? `<span class="home-hero-promo-sub">${escapeHtml(creative.subtitle)}</span>` : ''}
        <span class="home-hero-promo-cta">${escapeHtml(creative.ctaLabel)} <span aria-hidden="true">→</span></span>
      </span>
    </button>`;
}

/** Puerta editorial (banner intercalado), misma composición que la actual. */
export function growthDoorMarkup(campaign) {
  const { creative } = campaign;
  const aria = `${creative.title}. ${creative.ctaLabel}`;
  const focus = creative.focus ? `;--banner-focus:${creative.focus}` : '';
  const media = creative.image
    ? `<span class="home-brand-banner-media" aria-hidden="true" style="background-image:url('${encodeURI(creative.image)}')${focus}"></span>`
    : '';
  return `
    <button class="home-brand-banner ${creative.image ? 'has-media' : ''}" type="button" ${ctaAttributes(campaign)} ${growthAttributes(campaign, 'door')} aria-label="${escapeHtml(aria)}">
      ${media}
      <small>${escapeHtml(creative.eyebrow)}</small>
      <strong>${escapeHtml(creative.title)}</strong>
      <span>${escapeHtml(creative.ctaLabel)} <span aria-hidden="true">→</span></span>
    </button>`;
}

/**
 * Pieza única dentro de la grilla del catálogo. Para combos muestra el ahorro
 * REAL derivado del catálogo vivo (core/combos.js); si el combo dejó de ser
 * cobrable la elegibilidad ya la sacó antes de llegar acá.
 */
export function growthInlineMarkup(campaign, { resolvedCombo = null } = {}) {
  const { creative } = campaign;
  const saving = resolvedCombo?.hasRealSaving
    ? `<em class="growth-inline-saving">Ahorrás ${money(resolvedCombo.savings)}</em>`
    : '';
  const priceLine = resolvedCombo?.chargeable
    ? `<span class="growth-inline-price">${money(resolvedCombo.promotionalPrice)}</span>`
    : '';
  const aria = [creative.title, creative.subtitle, resolvedCombo?.hasRealSaving
    ? `Ahorrás ${money(resolvedCombo.savings)}`
    : '', creative.ctaLabel].filter(Boolean).join('. ');
  return `
    <button class="growth-inline-card ${creative.image ? 'has-media' : ''}" type="button" ${ctaAttributes(campaign)} ${growthAttributes(campaign, 'catalog-inline')} aria-label="${escapeHtml(aria)}">
      ${inlineMedia(campaign, 'growth-inline-media')}
      <span class="growth-inline-copy">
        <small>${escapeHtml(creative.eyebrow)}</small>
        <strong>${escapeHtml(creative.title)}</strong>
        ${creative.subtitle ? `<span class="growth-inline-sub">${escapeHtml(creative.subtitle)}</span>` : ''}
        <span class="growth-inline-foot">
          ${priceLine}${saving}
          <span class="growth-inline-cta">${escapeHtml(creative.ctaLabel)} <span aria-hidden="true">→</span></span>
        </span>
      </span>
    </button>`;
}

// ── Selección por superficie ─────────────────────────────────────────────────

export function growthHeroSelection(state = getState()) {
  const ranked = selectGrowthCampaigns({
    placement: 'hero',
    campaigns: GROWTH_CAMPAIGNS,
    catalogView: buildGrowthCatalogView(state),
    promotions: state.promotions,
    cartCategoryIds: growthCartCategoryIds(state),
    slots: 1,
  });
  return ranked[0] || null;
}

/**
 * Puertas intercaladas de la home, ya filtradas para no repetir un rubro que
 * tiene carrusel propio en pantalla. Devuelve las entradas rankeadas; ui.js
 * las consume en orden.
 */
export function growthDoorSelection(excludeCategoryIds = [], state = getState(), slots = 4) {
  const excluded = new Set(excludeCategoryIds);
  const campaigns = GROWTH_CAMPAIGNS.filter((campaign) => {
    if (!campaign.placements.includes('door')) return true; // lo filtra la elegibilidad
    // Puertas de marca conviven con el carrusel del rubro (la marca es un
    // motivo propio); las de rubro no repiten carrusel.
    if (campaign.brand) return true;
    return !campaign.categoryIds.some((id) => excluded.has(id));
  });
  return selectGrowthCampaigns({
    placement: 'door',
    campaigns,
    catalogView: buildGrowthCatalogView(state),
    promotions: state.promotions,
    cartCategoryIds: growthCartCategoryIds(state),
    slots,
  });
}

/**
 * Pieza inline del catálogo. Contexto que la apaga: búsqueda activa, grilla
 * corta, categorías virtuales sin lectura comercial (favoritos) o cuando la
 * única candidata es redundante con lo que ya se mira.
 */
export function growthCatalogInlineSelection(state = getState()) {
  const query = String(state.searchQuery || '').trim();
  if (query) return null;
  const activeCategory = String(state.activeCategory || 'all');
  if (activeCategory === 'favorites') return null;

  const affinity = getGrowthAffinity();
  const campaigns = GROWTH_CAMPAIGNS.filter((campaign) => {
    if (!campaign.placements.includes('catalog-inline')) return false;
    const targetsActive = campaign.categoryIds.includes(activeCategory);
    // La categoría que ya se está mirando sólo se refuerza con un combo (un
    // armado con ahorro real); repetirle su propia puerta editorial es ruido.
    if (targetsActive && campaign.kind !== 'combo') return false;
    if (campaign.requiresIntent === 'category') {
      const best = Math.max(0, ...campaign.categoryIds.map((id) => Number(affinity.categories[id]) || 0));
      if (normalizedAffinity(best) < CATEGORY_INTENT_THRESHOLD) return false;
    }
    return true;
  });
  if (!campaigns.length) return null;

  // El contexto de complemento acá incluye la categoría navegada: mirar
  // fernet sin nada en el carrito ya vuelve relevantes la cola y el hielo.
  const cartCategories = growthCartCategoryIds(state);
  const contextCategories = activeCategory !== 'all' && !['popular', 'promos'].includes(activeCategory)
    ? [...new Set([...cartCategories, activeCategory])]
    : cartCategories;

  const ranked = selectGrowthCampaigns({
    placement: 'catalog-inline',
    campaigns,
    catalogView: buildGrowthCatalogView(state),
    promotions: state.promotions,
    cartCategoryIds: contextCategories,
    slots: 1,
  });
  const winner = ranked[0];
  if (!winner) return null;

  let resolvedCombo = null;
  if (winner.campaign.kind === 'combo') {
    resolvedCombo = chargeableCombos(COMBO_MANIFEST, getCustomerCatalogProducts(state.products))
      .find((combo) => combo.comboId === winner.campaign.comboId) || null;
    if (!resolvedCombo) return null;
  }
  return { ...winner, resolvedCombo };
}

/**
 * Orden personalizado de los carruseles de la home. Devuelve null en cold
 * start o sin afinidad clara: el orden comercial de siempre sigue mandando.
 * Con intención real, el rubro que la persona busca sube; el resto conserva
 * su orden relativo (sort estable sobre el índice original).
 *
 * Memoizado por época igual que las selecciones: agregar al carrito desde la
 * home re-renderiza, pero el orden de las secciones no puede saltar en vivo.
 */
let sectionOrderMemo = { epoch: -1, key: '', ids: null };

export function growthHomeSectionOrder(sections = []) {
  const epoch = getGrowthRenderEpoch();
  const key = sections.map((section) => section.id).join('|');
  if (sectionOrderMemo.epoch === epoch && sectionOrderMemo.key === key) {
    if (!sectionOrderMemo.ids) return null;
    const byId = new Map(sections.map((section) => [section.id, section]));
    return sectionOrderMemo.ids.map((id) => byId.get(id)).filter(Boolean);
  }
  const affinity = getGrowthAffinity();
  const scored = sections.map((section, index) => {
    const best = Math.max(0, ...(section.categoryIds || []).map((id) => Number(affinity.categories[id]) || 0));
    return { section, index, score: normalizedAffinity(best) };
  });
  const hasIntent = scored.some((entry) => entry.score >= CATEGORY_INTENT_THRESHOLD);
  const ordered = hasIntent
    ? scored.sort((a, b) => (b.score - a.score) || (a.index - b.index)).map((entry) => entry.section)
    : null;
  sectionOrderMemo = { epoch, key, ids: ordered ? ordered.map((section) => section.id) : null };
  return ordered;
}
