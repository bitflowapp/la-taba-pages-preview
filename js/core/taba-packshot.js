/*
 * Qué dibujo le toca a un producto que no tiene fotografía publicable.
 *
 * POR QUÉ EXISTE
 * --------------
 * Hasta el 2026-08-25 la respuesta era una sola para todos: el mismo envase
 * gris, treinta veces en la misma pantalla. Con la góndola de lanzamiento eso
 * dejó de ser aceptable —una vidriera donde todo se ve igual no se lee como un
 * comercio—, así que TABA dibujó su propia lámina por producto.
 *
 * QUÉ NO CAMBIA
 * -------------
 * La regla de derechos. Una fotografía oficial publicable SIEMPRE gana: este
 * módulo se consulta únicamente cuando `productPhotoIsOfficial` dijo que no. La
 * lámina es obra propia del comercio (`PROPIO`), generada desde
 * `catalog/lamina-taba/especificacion.json`, y su procedencia la verifica
 * `npm run check` regenerándola y comparando byte a byte.
 *
 * LA CLAVE ES EL SKU, NO EL ID
 * ----------------------------
 * En producción `product.id` es un UUID: cambia entre entornos y no dice nada.
 * El SKU es el identificador comercial estable —`coca-cola-original-2250ml`— y
 * es el que la especificación nombra. `externalId` lo repite, y en las fixturas
 * de demo el `id` ya ES el slug; por eso se prueban los tres, en ese orden.
 *
 * Módulo puro: recibe un producto, devuelve una ruta. Sin DOM, sin estado.
 */
import { LAMINA_GENERICA, LAMINAS_TABA } from './taba-packshot-manifest.js';

/** El respaldo del respaldo: un producto sin pieza propia igual tiene envase. */
export { LAMINA_GENERICA };

function clave(valor) {
  return String(valor || '').trim().toLowerCase();
}

/**
 * La lámina propia de TABA para este producto.
 * Devuelve siempre una ruta: nunca deja una tarjeta sin imagen.
 */
export function laminaDeProducto(product) {
  for (const candidato of [product?.sku, product?.externalId, product?.id]) {
    const encontrada = LAMINAS_TABA[clave(candidato)];
    if (encontrada) return encontrada;
  }
  return LAMINA_GENERICA;
}

/** ¿Este producto tiene una lámina dibujada para él, y no la genérica? */
export function tieneLaminaPropia(product) {
  return laminaDeProducto(product) !== LAMINA_GENERICA;
}

/** Los SKU con lámina propia. Lo usan los tests y la auditoría de góndola. */
export function skusConLamina() {
  return Object.keys(LAMINAS_TABA);
}
