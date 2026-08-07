// ─────────────────────────────────────────────────────────────────────────────
// Destino de una historia · resuelto contra el catálogo VIVO de TABA2.
// -----------------------------------------------------------------------------
// Una historia no guarda precio, ni ahorro, ni "quedan 3". Guarda a QUÉ apunta,
// y todo lo demás se deriva del catálogo cada vez que se pregunta. Es la misma
// decisión que ya toma `core/combos.js`: un número guardado en la pieza
// promocional envejece en silencio y termina prometiendo algo que el mostrador
// no puede sostener.
//
// De acá salen las tres respuestas que necesitan el Panel y el visor:
//   1. ¿el destino EXISTE y se puede abrir?     → `exists`
//   2. ¿hay algo comprable ahí AHORA?           → `purchasable`
//   3. ¿arrastra la restricción +18 del catálogo? → `ageRestricted` / `minimumAge`
//
// Es una HOJA pura: recibe catálogo y combos por parámetro, no toca state ni
// DOM, así que se testea sin navegador.
import { isPurchasableBeverageProduct, isVisibleBeverageProduct } from './beverage-home-sections.js';
import { STORY_CTA_TYPES } from './stories.js';

export const STORY_MINIMUM_AGE = 18;

function productMinimumAge(product) {
  const declared = Number(product?.minimumAge ?? product?.minimum_age);
  return Number.isFinite(declared) && declared > STORY_MINIMUM_AGE ? Math.trunc(declared) : STORY_MINIMUM_AGE;
}

function findProduct(products, id) {
  const wanted = String(id);
  return (Array.isArray(products) ? products : []).find((product) => String(product?.id || '') === wanted) || null;
}

function findCombo(combos, id) {
  const wanted = String(id);
  return (Array.isArray(combos) ? combos : []).find((combo) => String(combo?.comboId || '') === wanted) || null;
}

function categoryProducts(products, categoryId) {
  const catalog = Array.isArray(products) ? products : [];
  if (categoryId === 'all') return catalog.filter(isVisibleBeverageProduct);
  return catalog.filter((product) => product?.categoryId === categoryId && isVisibleBeverageProduct(product));
}

function resolveProductDestination(products, id, { kind }) {
  const product = findProduct(products, id);
  if (!product || !isVisibleBeverageProduct(product)) {
    return { kind, id, label: '', exists: false, purchasable: false, ageRestricted: false, minimumAge: STORY_MINIMUM_AGE };
  }
  return {
    kind,
    id,
    label: String(product.name || id),
    exists: true,
    purchasable: isPurchasableBeverageProduct(product),
    ageRestricted: Boolean(product.alcoholic),
    minimumAge: productMinimumAge(product),
  };
}

function resolveComboDestination(combos, id) {
  const combo = findCombo(combos, id);
  if (!combo) {
    return { kind: 'combo', id, label: '', exists: false, purchasable: false, ageRestricted: false, minimumAge: STORY_MINIMUM_AGE };
  }
  return {
    kind: 'combo',
    id,
    label: String(combo.name || id),
    exists: true,
    // Un combo "comprable" es el que `core/combos.js` pudo PRECIAR: todos sus
    // componentes con precio confirmado y stock. Uno bloqueado se puede seguir
    // mostrando en el catálogo, pero una historia no puede invitar a mirarlo:
    // llevaría a una ficha que sólo sabe decir por qué no está disponible.
    purchasable: combo.available === true,
    ageRestricted: Boolean(combo.ageRestricted),
    minimumAge: Number(combo.minimumAge) > 0 ? Number(combo.minimumAge) : STORY_MINIMUM_AGE,
  };
}

function resolveCategoryDestination(products, categories, id) {
  const inCategory = categoryProducts(products, id);
  const known = id === 'all'
    || (Array.isArray(categories) && categories.some((category) => String(category?.id || '') === id))
    || inCategory.length > 0;
  const purchasables = inCategory.filter(isPurchasableBeverageProduct);
  const named = (Array.isArray(categories) ? categories : [])
    .find((category) => String(category?.id || '') === id);
  return {
    kind: 'category',
    id,
    label: id === 'all' ? 'Todo el catálogo' : String(named?.name || id),
    exists: known,
    purchasable: purchasables.length > 0,
    // Un rubro es +18 sólo si TODO lo que hoy se puede comprar ahí es
    // alcohólico ("cervezas", "whisky"). Un rubro mixto no se anuncia como
    // alcohólico: el aviso pierde sentido si aparece donde no corresponde, y el
    // control real sigue estando en la ficha y en el carrito.
    ageRestricted: purchasables.length > 0 && purchasables.every((product) => Boolean(product.alcoholic)),
    minimumAge: purchasables.length
      ? Math.max(STORY_MINIMUM_AGE, ...purchasables.filter((p) => p.alcoholic).map(productMinimumAge), STORY_MINIMUM_AGE)
      : STORY_MINIMUM_AGE,
  };
}

/**
 * Resuelve la CTA normalizada de una historia contra el catálogo vivo.
 * Devuelve `null` cuando la CTA no existe o no declara destino: la historia se
 * trata entonces como editorial, sin botón.
 */
export function resolveStoryDestination(cta, { products = [], combos = [], categories = [] } = {}) {
  if (!cta || !cta.target) return null;
  const definition = STORY_CTA_TYPES[cta.type];
  if (!definition) return null;
  const id = String(cta.target);
  if (definition.destination === 'combo') return resolveComboDestination(combos, id);
  if (definition.destination === 'category') return resolveCategoryDestination(products, categories, id);
  return resolveProductDestination(products, id, { kind: definition.destination });
}

/**
 * Restricción de edad EFECTIVA de una historia.
 *
 * La declaración del Panel es un PISO, nunca un techo: si el destino real es
 * alcohólico la historia queda +18 aunque el formulario diga que no. No existe
 * un camino por el cual editar una historia relaje una restricción del
 * catálogo; el único sentido en el que la declaración puede mover la aguja es
 * agregando la advertencia donde el catálogo todavía no la impone.
 */
export function storyAgeRestriction(story, destination) {
  const derived = Boolean(destination?.ageRestricted);
  const declared = Boolean(story?.ageRestricted);
  const minimumAge = Math.max(
    STORY_MINIMUM_AGE,
    Number(destination?.minimumAge) > 0 ? Number(destination.minimumAge) : STORY_MINIMUM_AGE,
  );
  return { restricted: derived || declared, derived, declared, minimumAge };
}

/**
 * ¿Esta historia puede llegar a la vidriera?
 *
 * Una historia SIN CTA es editorial: no promete acción, así que le alcanza con
 * tener medio. Una historia CON CTA sólo se publica si su destino existe y
 * tiene algo comprable AHORA — el mismo criterio del hero y de los banners.
 * La que se apaga acá reaparece sola cuando el local publique el precio de su
 * destino: nadie tiene que acordarse de volver a encenderla.
 */
export function storyPublishability(story, context = {}) {
  if (!story) return { ok: false, reason: 'La historia no existe.' };
  if (!story.cta) return { ok: true, reason: '' };
  const destination = resolveStoryDestination(story.cta, context);
  if (!destination || !destination.exists) {
    return { ok: false, reason: 'El destino de la CTA no está en el catálogo publicado.' };
  }
  if (!destination.purchasable) {
    return {
      ok: false,
      reason: destination.kind === 'category'
        ? 'El rubro de destino no tiene ningún producto comprable ahora.'
        : 'El destino no tiene precio confirmado o no tiene stock.',
    };
  }
  return { ok: true, reason: '' };
}

/** Atajo booleano de `storyPublishability`. */
export function hasRealStoryDestination(story, context = {}) {
  return storyPublishability(story, context).ok;
}

/**
 * Opciones de destino para el formulario del Panel, construidas SÓLO con
 * contenido real y comprable. Es la garantía estructural de que nadie puede
 * tipear un destino inventado: el formulario no ofrece otra cosa.
 */
export function storyDestinationOptions({ products = [], combos = [], categories = [] } = {}) {
  const catalog = (Array.isArray(products) ? products : []).filter(isPurchasableBeverageProduct);
  const byCategory = new Set(catalog.map((product) => product.categoryId).filter(Boolean));
  return {
    product: catalog
      .map((product) => ({ id: String(product.id), label: String(product.name || product.id), ageRestricted: Boolean(product.alcoholic) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es')),
    combo: (Array.isArray(combos) ? combos : [])
      .filter((combo) => combo?.available === true)
      .map((combo) => ({ id: String(combo.comboId), label: String(combo.name || combo.comboId), ageRestricted: Boolean(combo.ageRestricted) })),
    category: [
      ...(catalog.length ? [{ id: 'all', label: 'Todo el catálogo', ageRestricted: false }] : []),
      ...(Array.isArray(categories) ? categories : [])
        .filter((category) => category?.id && category.id !== 'all' && byCategory.has(category.id))
        .map((category) => {
          const inCategory = catalog.filter((product) => product.categoryId === category.id);
          return {
            id: String(category.id),
            label: String(category.name || category.id),
            ageRestricted: inCategory.length > 0 && inCategory.every((product) => Boolean(product.alcoholic)),
          };
        }),
    ],
  };
}
