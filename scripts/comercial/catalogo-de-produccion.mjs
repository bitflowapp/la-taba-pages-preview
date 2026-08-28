/*
 * EL CATÁLOGO CONTRA EL QUE SE VALIDA UNA PLANILLA TIENE QUE SER EL QUE ESTÁ VENDIENDO.
 *
 * `import-commercial-catalog.mjs` cruzaba la planilla contra
 * `catalog/products.csv` —el catálogo del REPOSITORIO—. Medido el 2026-08-27
 * contra la tienda publicada:
 *
 *     72 SKU en producción · 92 en el CSV · 7 en común
 *     de esos 7, los 7 precios difieren
 *
 * Con esa fuente, una planilla de Walter con SKU reales se rechaza entera: se
 * probó con ocho productos vivos y los ocho salieron «el SKU no existe en el
 * catálogo». El importador fallaba cerrado —correcto, no corrompió nada— pero
 * medía contra la fuente equivocada.
 *
 * Este módulo arma el mismo índice que `readCatalogIndex`, con las mismas
 * claves, leyendo PRODUCCIÓN. La lectura pasa por `db-solo-lectura`, que
 * rechaza toda sentencia que no sea un SELECT.
 *
 * NO INVENTA NADA: cada campo es el que está guardado. Lo único que hace es
 * traducir dos nombres al vocabulario que ya espera el planificador
 * —`available` → `publication_status`, `category` → `category_id`— para no
 * tener que tocar la función pura que ya está probada.
 */
import { consultar, lit } from '../e2e-production-sale/db-solo-lectura.mjs';

export const NEGOCIO_CANONICO = '00000000-0000-4000-8000-000000000001';

/**
 * Traduce una fila de `public.products` a la forma que consume
 * `buildCommercialPlan`. Pura: se prueba sin base.
 */
export function filaAEntradaDeCatalogo(fila) {
  return {
    sku: String(fila.sku || '').trim(),
    name: fila.name || '',
    category_id: fila.category || '',
    // `price_status = 'pending'` es «todavía no lo decidió el comercio». Que no
    // llegue como número es lo que hace que el diff diga «— → $ 2890» en vez de
    // fingir que antes valía algo.
    price: fila.price_status === 'pending' ? '' : fila.price,
    stock: fila.stock,
    publication_status: fila.available === true ? 'published' : 'hidden',
    is_alcoholic: fila.is_alcoholic === true,
    image_url: fila.image_url || '',
  };
}

/** Índice `sku → producto` leído de producción, con la misma forma que el del CSV. */
export async function leerCatalogoDeProduccion(negocioId = NEGOCIO_CANONICO) {
  const filas = await consultar(`
    select sku, name, category, price, price_status, stock, available, is_alcoholic, image_url
      from public.products
     where business_id = ${lit(negocioId)}`);

  const indice = new Map();
  for (const fila of filas) {
    const entrada = filaAEntradaDeCatalogo(fila);
    if (entrada.sku) indice.set(entrada.sku, entrada);
  }
  return indice;
}

/** ¿La venta de alcohol está habilitada? La decide el comercio, no una planilla. */
export async function leerAlcoholHabilitado(negocioId = NEGOCIO_CANONICO) {
  const [negocio] = await consultar(
    `select alcohol_sales_enabled from public.businesses where id = ${lit(negocioId)}`,
  );
  return negocio?.alcohol_sales_enabled === true;
}

/** Una foto de verdad publicada. Sin esto, publicar deja un hueco en la góndola. */
export function tieneImagen(producto) {
  return Boolean(String(producto?.image_url || '').trim());
}
