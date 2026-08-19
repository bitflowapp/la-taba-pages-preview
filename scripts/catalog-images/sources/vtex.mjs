/*
 * Adaptador VTEX.
 *
 * Muchas tiendas oficiales argentinas corren sobre VTEX y publican su catálogo
 * en `/api/catalog_system/pub/products/search/<categoria>`. Eso da títulos,
 * marca declarada e imagen sin scrapear HTML, que es frágil y cambia de forma.
 *
 * ALCANCE. Este archivo SÓLO trae y normaliza lo que la tienda publica. No
 * decide si una fuente está permitida (eso es la allowlist), ni si el candidato
 * corresponde al SKU (eso es presentation.mjs), ni descarga imágenes (eso es
 * fetch). Un adaptador que además opina es un adaptador que no se puede
 * reemplazar.
 */

const PAGE_SIZE = 50;
const MAX_PAGES = 20;
const USER_AGENT = 'TABA-catalog-images/1 (+contacto comercial del negocio)';

async function fetchJson(url, { timeoutMs = 30_000 } = {}) {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  // VTEX responde 206 en las búsquedas paginadas: es un rango, no un error.
  if (!response.ok && response.status !== 206) {
    throw new Error(`VTEX ${response.status} en ${url}`);
  }
  return response.json();
}

/**
 * Todos los productos de una categoría, paginando hasta que la tienda deja de
 * devolver filas. El tope de páginas existe para que un catálogo enorme o una
 * paginación rota no dejen el proceso girando para siempre.
 */
export async function fetchCategory(storeHost, categoryPath) {
  const productos = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const url = `https://${storeHost}/api/catalog_system/pub/products/search/${categoryPath}?_from=${from}&_to=${to}`;
    const lote = await fetchJson(url);
    if (!Array.isArray(lote) || lote.length === 0) break;
    productos.push(...lote);
    if (lote.length < PAGE_SIZE) break;
  }
  return productos;
}

/**
 * Reduce un producto VTEX a lo que el matcher necesita. Se queda con la PRIMERA
 * imagen de la primera variante: es la que la tienda usa como packshot. Cuando
 * hay más, se anotan para que la revisión humana pueda mirarlas.
 */
export function normalizeProduct(raw, { categoryPath, storeHost, groupId }) {
  const item = Array.isArray(raw?.items) ? raw.items[0] : null;
  const imagenes = Array.isArray(item?.images) ? item.images : [];
  const principal = imagenes[0]?.imageUrl || null;
  return {
    groupId,
    storeHost,
    categoryPath,
    productId: String(raw?.productId || ''),
    title: String(raw?.productName || ''),
    brandDeclared: String(raw?.brand || ''),
    linkText: String(raw?.linkText || ''),
    productUrl: raw?.link || (raw?.linkText ? `https://${storeHost}/${raw.linkText}/p` : null),
    ean: String(item?.ean || '').trim() || null,
    imageUrl: principal,
    imageCount: imagenes.length,
    alternateImages: imagenes.slice(1).map((image) => image.imageUrl),
  };
}

/** Cosecha un grupo entero de la allowlist. Devuelve candidatos sin juzgar. */
export async function harvestGroup(group, { onCategory = () => {} } = {}) {
  const salida = [];
  for (const categoria of group.categories) {
    const path = typeof categoria === 'string' ? categoria : categoria.path;
    let crudos = [];
    let error = null;
    try {
      crudos = await fetchCategory(group.storeHost, path);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    onCategory({ path, cantidad: crudos.length, error });
    for (const crudo of crudos) {
      const normalizado = normalizeProduct(crudo, {
        categoryPath: path,
        storeHost: group.storeHost,
        groupId: group.id,
      });
      if (!normalizado.imageUrl) continue;
      normalizado.envasePorDefecto = typeof categoria === 'string' ? null : (categoria.envasePorDefecto ?? null);
      salida.push(normalizado);
    }
  }
  return salida;
}
