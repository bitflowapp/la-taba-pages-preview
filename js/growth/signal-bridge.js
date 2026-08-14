// ─────────────────────────────────────────────────────────────────────────────
// Growth engine · BRIDGE DE SEÑALES.
// -----------------------------------------------------------------------------
// El único módulo del motor que mira el DOM y el estado vivo. Observa, no
// interviene: ningún listener de acá hace preventDefault, ninguno reordena
// nada, ninguno toca el checkout. Si este módulo entero muere, la tienda
// queda exactamente como está hoy.
//
// Señales que captura y de dónde:
//   · category_view   → diff de state.activeCategory (categoría real).
//   · search_match    → diff de state.searchQuery, asentada (600 ms) y
//                       contrastada contra el catálogo; la query NO se
//                       persiste, sólo las categorías/marca que matcheó.
//   · product_view    → click en [data-product-detail] (la ficha se abre).
//   · add/remove cart → diff de state.cart y state.comboSelections.
//   · purchase        → diff de state.lastOrderId (pedido confirmado).
//   · promo_click     → click en [data-growth-campaign].
//   · impresiones     → IntersectionObserver al 50% visible, deduplicadas
//                       por época en el engine.
//
// Épocas de render: entrar a una vista o cambiar de categoría abre una época
// nueva (la vidriera puede reacomodarse); dentro de una época las selecciones
// están memoizadas y ningún re-render mueve piezas bajo el dedo.
import { getState, subscribe, updateState } from '../state.js';
import {
  SEARCH_MAX_MATCHED_KEYS,
  SEARCH_MIN_QUERY_LENGTH,
  SEARCH_SETTLE_MS,
} from './growth-config.js';
import {
  bumpGrowthRenderEpoch,
  growthNow,
  recordCampaignClick,
  recordCampaignImpression,
  recordGrowthSignal,
} from './engine.js';
import { growthCampaignById } from './placements.js';
import { trackGrowthEvent } from './analytics.js';
import { COMBO_MANIFEST } from '../combos-data.js';

const VIRTUAL_CATEGORIES = new Set(['all', 'favorites', 'popular', 'promos']);

let started = false;
let searchTimer = 0;
let impressionObserver = null;
let domObserver = null;

function productIndex(products) {
  return new Map((Array.isArray(products) ? products : []).map((product) => [product.id, product]));
}

function cartQuantities(cart) {
  const map = new Map();
  for (const line of Array.isArray(cart) ? cart : []) {
    if (!line?.productId) continue;
    map.set(line.productId, (map.get(line.productId) || 0) + (Number(line.quantity) || 0));
  }
  return map;
}

function comboQuantities(selections) {
  const map = new Map();
  for (const line of Array.isArray(selections) ? selections : []) {
    if (!line?.comboId) continue;
    map.set(line.comboId, (map.get(line.comboId) || 0) + (Number(line.quantity) || 0));
  }
  return map;
}

function productSignalTargets(product) {
  return {
    categoryId: product?.categoryId || '',
    brand: String(product?.brand || '').trim().toLowerCase(),
    productId: product?.id || '',
  };
}

function normalizeSearchTerm(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Búsqueda asentada → categorías y marca que realmente matchean el catálogo.
 * Cota dura de claves bumpeadas: una query genérica no infla medio perfil.
 */
function emitSearchSignals(query, products) {
  const term = normalizeSearchTerm(query);
  if (term.length < SEARCH_MIN_QUERY_LENGTH) return;
  const categoryHits = new Map();
  let brandHit = '';
  for (const product of products) {
    const haystack = normalizeSearchTerm(
      [product.brand, product.name, product.variant, ...(product.tags || [])].filter(Boolean).join(' '),
    );
    if (!haystack.includes(term)) continue;
    if (product.categoryId) {
      categoryHits.set(product.categoryId, (categoryHits.get(product.categoryId) || 0) + 1);
    }
    const brand = normalizeSearchTerm(product.brand);
    if (!brandHit && brand && (brand === term || brand.includes(term) || term.includes(brand))) {
      brandHit = String(product.brand).trim().toLowerCase();
    }
  }
  const topCategories = [...categoryHits.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, SEARCH_MAX_MATCHED_KEYS);
  topCategories.forEach(([categoryId], index) => {
    recordGrowthSignal({
      type: 'search_match',
      categoryId,
      brand: index === 0 ? brandHit : '',
      weightMultiplier: [1, 0.6, 0.4][index] || 0.4,
    });
  });
}

function diffCartSignals(prev, next, products) {
  const index = productIndex(products);
  const before = cartQuantities(prev.cart);
  const after = cartQuantities(next.cart);
  for (const [productId, quantity] of after) {
    const delta = quantity - (before.get(productId) || 0);
    if (delta <= 0) continue;
    const product = index.get(productId);
    recordGrowthSignal({ type: 'add_to_cart', ...productSignalTargets(product) });
    trackGrowthEvent('add_to_cart', {
      productId,
      categoryId: product?.categoryId || '',
      quantity: delta,
    }, growthNow());
  }
  for (const [productId, quantity] of before) {
    if ((after.get(productId) || 0) >= quantity) continue;
    const product = index.get(productId);
    recordGrowthSignal({ type: 'remove_from_cart', ...productSignalTargets(product) });
  }

  const combosBefore = comboQuantities(prev.comboSelections);
  const combosAfter = comboQuantities(next.comboSelections);
  for (const [comboId, quantity] of combosAfter) {
    if (quantity <= (combosBefore.get(comboId) || 0)) continue;
    recordGrowthSignal({ type: 'add_to_cart', categoryId: comboCategory(comboId) });
    trackGrowthEvent('add_to_cart', { comboId, categoryId: comboCategory(comboId) }, growthNow());
  }
  for (const [comboId, quantity] of combosBefore) {
    if ((combosAfter.get(comboId) || 0) >= quantity) continue;
    recordGrowthSignal({ type: 'remove_from_cart', categoryId: comboCategory(comboId) });
  }
}

let comboCategoryIndex = null;
function comboCategory(comboId) {
  if (!comboCategoryIndex) {
    comboCategoryIndex = new Map(COMBO_MANIFEST.map((combo) => [combo.comboId, combo.categoryId]));
  }
  return comboCategoryIndex.get(comboId) || '';
}

function emitPurchaseSignals(order, products) {
  if (!order || !Array.isArray(order.items)) return;
  const index = productIndex(products);
  for (const item of order.items) {
    const product = index.get(item?.productId);
    recordGrowthSignal({ type: 'purchase', ...productSignalTargets(product || { id: item?.productId }) });
  }
  trackGrowthEvent('purchase', { orderItems: order.items.length }, growthNow());
}

function watchState() {
  let prev = {
    activeCategory: getState().activeCategory,
    searchQuery: getState().searchQuery,
    cart: getState().cart,
    comboSelections: getState().comboSelections,
    lastOrderId: getState().lastOrderId,
  };
  subscribe((state) => {
    try {
      const next = {
        activeCategory: state.activeCategory,
        searchQuery: state.searchQuery,
        cart: state.cart,
        comboSelections: state.comboSelections,
        lastOrderId: state.lastOrderId,
      };

      if (next.activeCategory !== prev.activeCategory) {
        // Cambiar de categoría abre una época nueva de vidriera.
        bumpGrowthRenderEpoch();
        if (!VIRTUAL_CATEGORIES.has(next.activeCategory)) {
          recordGrowthSignal({ type: 'category_view', categoryId: next.activeCategory });
        }
      }

      if (next.searchQuery !== prev.searchQuery) {
        if (searchTimer) clearTimeout(searchTimer);
        const query = next.searchQuery;
        if (String(query || '').trim().length >= SEARCH_MIN_QUERY_LENGTH) {
          searchTimer = setTimeout(() => {
            searchTimer = 0;
            try {
              emitSearchSignals(query, getState().products);
            } catch (_) { /* señal perdida, tienda intacta */ }
          }, SEARCH_SETTLE_MS);
        }
      }

      if (next.cart !== prev.cart || next.comboSelections !== prev.comboSelections) {
        diffCartSignals(prev, next, state.products);
      }

      if (next.lastOrderId && next.lastOrderId !== prev.lastOrderId) {
        const order = (state.orders || []).find((entry) => entry.id === next.lastOrderId);
        emitPurchaseSignals(order, state.products);
      }

      prev = next;
    } catch (_) {
      // El bridge JAMÁS voltea un render: los listeners de state corren en
      // cadena y una excepción acá cortaría los siguientes.
    }
  });
}

function watchClicks(documentRef) {
  documentRef.addEventListener('click', (event) => {
    try {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      const growthNode = target.closest('[data-growth-campaign]');
      if (growthNode) {
        const campaign = growthCampaignById(growthNode.dataset.growthCampaign);
        if (campaign) {
          recordCampaignClick(campaign, growthNode.dataset.growthPlacement || '');
        }
      }

      const detailId = target.closest('[data-product-detail]')?.dataset.productDetail;
      if (detailId) {
        const product = getState().products.find((entry) => entry.id === detailId);
        if (product) {
          recordGrowthSignal({ type: 'product_view', ...productSignalTargets(product) });
          trackGrowthEvent('product_view', {
            productId: product.id,
            categoryId: product.categoryId || '',
          }, growthNow());
        }
      }
    } catch (_) { /* observación perdida, interacción intacta */ }
  });
}

// Impresiones honestas: sólo cuenta lo que estuvo de verdad en pantalla
// (≥50% visible). El engine deduplica por época, así que un re-render que
// vuelve a crear el nodo no infla el contador.
function watchImpressions(documentRef, windowRef) {
  if (typeof windowRef.IntersectionObserver !== 'function') return;
  impressionObserver = new windowRef.IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting || entry.intersectionRatio < 0.5) continue;
      const node = entry.target;
      impressionObserver.unobserve(node);
      const campaign = growthCampaignById(node.dataset.growthCampaign);
      if (campaign) {
        recordCampaignImpression(campaign, node.dataset.growthPlacement || '');
      }
    }
  }, { threshold: [0.5] });

  const scan = () => {
    for (const node of documentRef.querySelectorAll('[data-growth-campaign]:not([data-growth-observed])')) {
      node.setAttribute('data-growth-observed', 'true');
      impressionObserver.observe(node);
    }
  };
  scan();
  if (typeof windowRef.MutationObserver === 'function') {
    domObserver = new windowRef.MutationObserver(scan);
    domObserver.observe(documentRef.body, { childList: true, subtree: true });
  }
}

function watchViewChanges(documentRef, windowRef) {
  // La vista activa vive en body[data-active-view]; cambiarla abre época.
  if (typeof windowRef.MutationObserver !== 'function') return;
  let lastView = documentRef.body?.dataset.activeView || '';
  const observer = new windowRef.MutationObserver(() => {
    const view = documentRef.body?.dataset.activeView || '';
    if (view !== lastView) {
      lastView = view;
      bumpGrowthRenderEpoch();
      // El observer corre DESPUÉS del pintado de la navegación, así que la
      // época nueva necesita su repintado: un commit vacío notifica a los
      // suscriptores y la vidriera se recalcula con la intención acumulada.
      // Sin bucle: si la vista no cambió, este callback no vuelve a entrar.
      try {
        updateState(() => {});
      } catch (_) { /* sin repintado extra, la próxima interacción lo trae */ }
    }
  });
  observer.observe(documentRef.body, { attributes: true, attributeFilter: ['data-active-view'] });

  windowRef.addEventListener('taba:checkout-session-started', () => {
    try {
      trackGrowthEvent('checkout_start', {}, growthNow());
    } catch (_) { /* nada */ }
  });
}

/**
 * Punto de entrada único, llamado una vez desde bootstrap. Inofensivo si se
 * llama dos veces o si el DOM no está: cada watcher se protege solo.
 */
export function initGrowthBridge({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
} = {}) {
  if (started || !documentRef?.body || !windowRef) return false;
  started = true;
  try {
    watchState();
    watchClicks(documentRef);
    watchImpressions(documentRef, windowRef);
    watchViewChanges(documentRef, windowRef);
    return true;
  } catch (_) {
    return false;
  }
}
