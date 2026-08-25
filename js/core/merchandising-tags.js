/*
 * Cómo destaca el comercio un producto sin tocarle el precio.
 *
 * POR QUÉ ESTE CANAL Y NO EL MOTOR DE PROMOCIONES
 * -----------------------------------------------
 * La Taba tiene un motor de promociones completo y bien escrito, y en producción
 * no llega al cliente: `state.js` lo alimenta con `isDemoMode() ? SEMILLA : []`,
 * así que en la tienda real la lista está vacía y no hay fuente que la llene.
 * Darle una exigiría tabla, RLS, RPC y migración — trabajo de backend que no se
 * empieza la semana que el comercio abre.
 *
 * Las ETIQUETAS, en cambio, ya viajan de la base a la tarjeta. `products.tags`
 * es una columna que el comercio escribe, el repositorio la lee y la tarjeta la
 * dibuja. Es el único canal de merchandising que hoy llega vivo a producción, y
 * no toca el precio: destacar deja de ser una operación de riesgo comercial.
 *
 * LA TRAMPA CARA, para quien vaya a usarlo
 * ----------------------------------------
 * El disparador `products_fail_close_master_change` cuenta `tags` como DATO
 * MAESTRO. Escribir una etiqueta de merchandising baja `available=false` e
 * `is_verified=false` igual que si cambiaras un precio: la tienda queda con ese
 * producto fuera de venta hasta que se lo vuelve a publicar. Es BEFORE UPDATE y
 * pisa lo que escribas en la misma sentencia, así que la operación es de DOS
 * pasos —primero las etiquetas, después re-verificar— y nunca de uno.
 * Está documentado en docs/comercial/ofertas-de-lanzamiento.md.
 *
 * VOCABULARIO CERRADO, a propósito
 * --------------------------------
 * Una etiqueta que no está acá no dibuja nada. Es lo que evita que el día que
 * alguien escriba `oferta!!!` o `2x1` la góndola prometa algo que el checkout no
 * va a cobrar: acá sólo se puede DESTACAR, y un descuento real sigue exigiendo
 * un precio real.
 *
 * Módulo puro: recibe etiquetas, devuelve texto. Sin DOM, sin estado.
 */

/**
 * Qué dice la pastilla de cada etiqueta, en orden de precedencia.
 *
 * `popular` decía «Más pedido», y el comercio no tiene ninguna métrica de
 * ventas que respalde ese ranking: la tienda abrió hace días y el único pedido
 * real no se entregó. Dice «Recomendado», que es lo que la etiqueta significa
 * de verdad —una elección del local— y lo mismo que ya dice el rail de la home.
 */
const ETIQUETAS_DE_VIDRIERA = Object.freeze([
  ['lanzamiento', 'Lanzamiento'],
  ['oferta-finde', 'Oferta del finde'],
  ['promo', 'Promo'],
  ['promoción', 'Promo'],
  ['promocion', 'Promo'],
  ['combo', 'Combo'],
  ['destacado', 'Destacado'],
  ['más vendido', 'Recomendado'],
  ['mas vendido', 'Recomendado'],
  ['popular', 'Recomendado'],
]);

function normalizar(valor) {
  return String(valor || '').trim().toLowerCase();
}

/** Las etiquetas de un producto, normalizadas y sin repetir. */
export function tagSetOf(product = {}) {
  const tags = Array.isArray(product.tags) ? product.tags : [];
  return new Set(tags.map(normalizar).filter(Boolean));
}

/**
 * La pastilla de merchandising de un producto, o cadena vacía.
 * Gana la primera etiqueta del vocabulario que el producto lleve.
 */
export function merchandisingBadge(product = {}) {
  const etiquetas = tagSetOf(product);
  for (const [tag, texto] of ETIQUETAS_DE_VIDRIERA) {
    if (etiquetas.has(tag)) return texto;
  }
  return '';
}

/** ¿El comercio eligió este producto para la vidriera? */
export function isFeaturedByMerchant(product = {}) {
  const etiquetas = tagSetOf(product);
  return ['destacado', 'promo', 'promoción', 'promocion', 'lanzamiento', 'oferta-finde']
    .some((tag) => etiquetas.has(tag));
}

/** Las etiquetas que este canal reconoce. La usan el Panel y los tests. */
export const ETIQUETAS_RECONOCIDAS = Object.freeze(ETIQUETAS_DE_VIDRIERA.map(([tag]) => tag));
