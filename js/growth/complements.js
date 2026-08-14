// ─────────────────────────────────────────────────────────────────────────────
// Growth engine · GRAFO DE COMPLEMENTOS.
// -----------------------------------------------------------------------------
// Qué categoría acompaña a cuál, con la taxonomía REAL del catálogo TABA2
// (js/taba2-commercial-pending-data.js — autoridad comercial). Reglas por
// categoría, configurables y legibles: nada de veinte productos hardcodeados.
//
// Regla heredada de core/cart-recommendations.js y NO negociable: los
// complementos jamás apuntan a una categoría con alcohol. Sugerir "otra
// botella" no es complementar, y una canasta sin alcohol no recibe alcohol
// por la puerta de atrás.

// Debe coincidir con ALCOHOLIC_CATEGORY_IDS de core/catalog-store.js (ids de
// autoridad). Si el catálogo suma una categoría alcohólica nueva, el test de
// guardia de growth-complements la exige acá también.
export const ALCOHOL_CATEGORY_IDS = Object.freeze([
  'cervezas',
  'fernet',
  'aperitivos',
  'vinos',
  'espumantes',
  'destilados',
]);

const ALCOHOL_SET = new Set(ALCOHOL_CATEGORY_IDS);

// categoría del carrito/navegación → categorías que la completan, en orden de
// relevancia comercial. Sólo destinos sin alcohol.
export const COMPLEMENT_RULES = Object.freeze({
  fernet: Object.freeze(['gaseosas', 'hielo']),
  destilados: Object.freeze(['mixers', 'hielo', 'energizantes']),
  aperitivos: Object.freeze(['mixers', 'gaseosas', 'hielo']),
  cervezas: Object.freeze(['hielo']),
  espumantes: Object.freeze(['hielo']),
  vinos: Object.freeze([]),
  gaseosas: Object.freeze(['hielo']),
  energizantes: Object.freeze(['hielo']),
  mixers: Object.freeze(['hielo']),
  isotonicas: Object.freeze([]),
  aguas: Object.freeze([]),
  'aguas-saborizadas': Object.freeze([]),
  hielo: Object.freeze([]),
});

export function isAlcoholCategory(categoryId) {
  return ALCOHOL_SET.has(String(categoryId || '').trim().toLowerCase());
}

/**
 * Complementos de un conjunto de categorías origen, deduplicados, en orden de
 * primera aparición (la relevancia declarada en la regla se respeta) y NUNCA
 * incluyendo una categoría que ya está en el origen: si el carrito ya tiene
 * hielo, el hielo dejó de ser un faltante.
 */
export function complementCategories(sourceCategoryIds = []) {
  const sources = new Set(
    (Array.isArray(sourceCategoryIds) ? sourceCategoryIds : [])
      .map((id) => String(id || '').trim().toLowerCase())
      .filter(Boolean),
  );
  const result = [];
  for (const source of sources) {
    for (const target of COMPLEMENT_RULES[source] || []) {
      if (sources.has(target) || result.includes(target)) continue;
      if (isAlcoholCategory(target)) continue; // cinturón y tiradores
      result.push(target);
    }
  }
  return result;
}

/**
 * 0..1: qué tan complementaria es una campaña respecto de las categorías del
 * carrito. 1 si toca el primer complemento sugerido, decae por posición.
 */
export function complementBoost(campaignCategoryIds = [], cartCategoryIds = []) {
  const complements = complementCategories(cartCategoryIds);
  if (!complements.length) return 0;
  const targets = (Array.isArray(campaignCategoryIds) ? campaignCategoryIds : [])
    .map((id) => String(id || '').trim().toLowerCase());
  let best = 0;
  for (const target of targets) {
    const index = complements.indexOf(target);
    if (index < 0) continue;
    best = Math.max(best, 1 - (index * 0.25));
  }
  return Math.max(0, Math.min(1, best));
}
