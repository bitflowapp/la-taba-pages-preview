// ─────────────────────────────────────────────────────────────────────────────
// Destino comprable · CONTRATO ÚNICO de las piezas editoriales.
// -----------------------------------------------------------------------------
// P1-2 de la auditoría comercial: el hero ya exigía que su CTA cayera en una
// categoría con producto comprable, pero banners e historias sólo exigían que
// el destino EXISTIERA. Resultado medido: dos banners ("El mejor whisky",
// "Fernet y amargos") y una historia (Jack Daniel's → whisky) invitaban a
// rubros donde no se podía comprar nada — "Precio próximamente" en todo.
//
// Este módulo fija UNA definición de "destino comprable" para toda pieza que
// promete una acción de compra (hero, banners, historias y cualquier CTA
// promocional futura). "Comprable" NO se redefine acá: es exactamente
// `isPurchasableBeverageProduct` — precio publicado, disponible, con stock y
// visible —, el mismo predicado que habilita el botón "Agregar" y que arma la
// fila de categorías de la home.
//
// Es una HOJA pura: recibe el catálogo por parámetro y no toca state ni DOM,
// así que puede testearse sin navegador.
import { isPurchasableBeverageProduct } from './beverage-home-sections.js';

// Igualdad exacta de marca tras normalizar caja y acentos: acá no se comparan
// cadenas parecidas sino la misma marca. Es un subconjunto estricto de lo que
// encuentra la búsqueda del catálogo, así que un destino que este predicado
// aprueba siempre trae resultados al ejecutar esa búsqueda.
function normalizeBrandText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * ¿El destino declarado tiene al menos un producto comprable AHORA?
 *
 * Destinos admitidos (uno por llamada):
 *   { categoryId }  → rubro del catálogo (`'all'` = catálogo completo);
 *   { brandQuery }  → marca exacta (la misma búsqueda que dispara el banner);
 *   { productId }   → producto puntual (CTA de historia product/offer/add).
 *
 * Sin destino declarado devuelve `false`: una pieza que promete compra sin
 * decir hacia dónde es exactamente el link muerto que el diseño prohíbe.
 */
export function hasPurchasableDestination(products, destination = {}) {
  const catalog = Array.isArray(products) ? products : [];
  if (destination.productId) {
    const id = String(destination.productId);
    return catalog.some((product) => (
      String(product?.id || '') === id && isPurchasableBeverageProduct(product)
    ));
  }
  if (destination.categoryId) {
    const categoryId = String(destination.categoryId);
    if (categoryId === 'all') return catalog.some(isPurchasableBeverageProduct);
    return catalog.some((product) => (
      product?.categoryId === categoryId && isPurchasableBeverageProduct(product)
    ));
  }
  if (destination.brandQuery) {
    const brand = normalizeBrandText(destination.brandQuery);
    return Boolean(brand) && catalog.some((product) => (
      normalizeBrandText(product?.brand) === brand && isPurchasableBeverageProduct(product)
    ));
  }
  return false;
}

/**
 * Traduce la CTA normalizada de una historia (core/stories.js) al destino que
 * entiende `hasPurchasableDestination`: `category` filtra el catálogo por
 * rubro; `product` y `add` apuntan a un producto puntual. Una acción
 * desconocida devuelve `null` y la pieza se trata como sin destino resoluble.
 */
export function storyCtaDestination(cta) {
  if (!cta || !cta.target) return null;
  if (cta.action === 'category') return { categoryId: String(cta.target) };
  if (cta.action === 'product' || cta.action === 'add') return { productId: String(cta.target) };
  return null;
}
