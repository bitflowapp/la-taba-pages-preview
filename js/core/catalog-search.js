/*
 * Buscar en la góndola, con las palabras que usa el cliente.
 *
 * POR QUÉ EXISTE (medido en producción el 2026-08-25, antes del lanzamiento)
 * -------------------------------------------------------------------------
 * Dos defectos que sólo se ven escribiendo en el buscador de verdad:
 *
 *   «energética» → 0 resultados. La categoría se llama «Energizantes» y la
 *   comparación era `incluye`, así que la palabra más natural para pedir un
 *   Red Bull no encontraba ninguno. Tres energizantes en el catálogo,
 *   invisibles para quien no adivine el vocabulario del sistema.
 *
 *   «500 ml» → devolvía botellas de 1,5 L. La capacidad entra al índice como
 *   `1500ml` y `'1500ml'.includes('500ml')` es verdadero. Un cliente que busca
 *   el formato chico recibía el familiar, que cuesta el triple.
 *
 * Y una ausencia: «1,5» no encontraba nada, porque el litraje se guardaba
 * convertido a mililitros y el número que la tarjeta muestra no existía en el
 * índice.
 *
 * Módulo puro: recibe productos y texto, devuelve booleanos. Sin DOM, sin estado.
 */
import { formatCapacity, packagingLabel } from './product-presentation.js';
import { CATEGORY_SEARCH_SYNONYMS } from './store-taxonomy.js';

/**
 * El texto comparable. Saca acentos, baja a minúsculas, y unifica el litraje:
 * «1,5 L» y «1500 ml» son la misma cosa y tienen que indexarse igual.
 */
export function normalizeSearchText(value) {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.,]+/g, ' ');
  const millilitres = normalized.replace(/(\d+(?:[.,]\d+)?)\s*l\b/g, (_, valor) => (
    `${Math.round(Number(String(valor).replace(',', '.')) * 1000)}ml`
  ));
  return millilitres.replace(/(\d+)\s*ml\b/g, '$1ml').replace(/\s+/g, ' ').trim();
}

/*
 * Cómo pide la gente cada familia de producto.
 *
 * No son etiquetas del catálogo: son las palabras que alguien escribe con el
 * pulgar mientras decide. La categoría dice «Energizantes» y el cliente escribe
 * «energética»; dice «Limpieza» y escribe «artículos de limpieza».
 *
 * Se agregan al ÍNDICE del producto, no a la consulta: así la regla de que
 * todos los términos tienen que coincidir sigue valiendo igual, y una palabra
 * de más nunca ensancha una búsqueda de dos palabras.
 *
 * La tabla vive en `core/store-taxonomy.js`, junto al nombre y al rubro de cada
 * categoría, para que sumar «Limpieza» no obligue a acordarse de este archivo.
 *
 * Deliberadamente NO están «cola» ni «tónica», ni los nombres de producto
 * —«lavandina», «shampoo», «papel higiénico»—. Los primeros harían que media
 * góndola respondiera a una búsqueda de marca; los segundos son SUBCATEGORÍA
 * del SKU y ya entran al índice por ese campo, con la ventaja de que devuelven
 * el producto pedido y no el rubro entero. Un sinónimo que trae de más es peor
 * que uno que falta, porque el que falta se nota y el que sobra no.
 */
const SINONIMOS_POR_CATEGORIA = CATEGORY_SEARCH_SYNONYMS;

/** Las palabras con las que se pide una versión sin azúcar. */
const SINONIMOS_SIN_AZUCAR = ['zero', 'sin azucar', 'light', 'dietetica', 'diet'];
const MARCAS_SIN_AZUCAR = /zero|black|light|sugarfree|sin azucar|diet/;

function claveCategoria(product) {
  return normalizeSearchText(product?.categoryId || product?.categoryName || '').replace(/\s+/g, '-');
}

/**
 * Todo lo que hace encontrable a un producto, ya normalizado.
 *
 * Incluye el litraje en las DOS formas en las que una persona lo escribe: la
 * canónica en mililitros («1500ml», que es a lo que se reduce «1,5 L») y el
 * número suelto tal como lo muestra la tarjeta («1,5»), que de otro modo no
 * existiría en el índice porque la normalización se lo come.
 */
export function searchHaystack(product = {}) {
  const capacidad = formatCapacity(
    product.capacityValue ?? product.capacity_value,
    product.capacityUnit ?? product.capacity_unit ?? 'ml',
  );
  const litros = Number(product.capacityValue ?? product.capacity_value);
  const unidad = String(product.capacityUnit ?? product.capacity_unit ?? 'ml').toLowerCase();
  const numeroDeLitros = unidad === 'ml' && Number.isFinite(litros) && litros >= 1000
    ? String(litros / 1000).replace('.', ',')
    : '';

  const partes = [
    product.brand,
    product.name,
    product.variant,
    product.presentation,
    product.unitLabel,
    product.capacity,
    capacidad,
    packagingLabel(product.packageType || product.packagingType || product.packaging_type || ''),
    product.subcategory,
    product.categoryName,
    product.categoryId,
    ...(Array.isArray(product.tags) ? product.tags : []),
    ...(SINONIMOS_POR_CATEGORIA[claveCategoria(product)] || []),
    ...(Number(product.unitsPerPack ?? product.units_per_pack) > 1 ? ['pack', 'packs'] : ['unidad', 'suelta']),
  ].filter(Boolean);

  const texto = normalizeSearchText(partes.join(' '));
  const extras = [];
  if (numeroDeLitros) extras.push(numeroDeLitros);
  if (MARCAS_SIN_AZUCAR.test(texto)) extras.push(...SINONIMOS_SIN_AZUCAR);
  return extras.length ? `${texto} ${normalizeSearchText(extras.join(' '))}` : texto;
}

/** Un término de capacidad: «500ml», «2250ml». */
const TERMINO_DE_CAPACIDAD = /^\d+ml$/;

/*
 * EL CÓDIGO DEL PRODUCTO, COMO BÚSQUEDA EXACTA Y NADA MÁS.
 *
 * Con un catálogo de decenas de bebidas nadie escribe un SKU. Con cientos de
 * artículos sí: quien atiende el mostrador tiene el código en la planilla, en la
 * etiqueta de góndola o en el código de barras, y lo pega en el buscador.
 *
 * Es una comparación EXACTA contra `sku`, `externalId` y `gtin`, no un término
 * más del índice. Meter el SKU en el haystack parece más generoso y lo que hace
 * es ensuciar: `coca-cola-original-pet-500ml-pack-12` aporta las palabras
 * «pet», «pack» y «12», así que buscar «12» empezaría a devolver productos por
 * un pedazo de su identificador. Un código se sabe entero o no se sabe.
 */
function normalizeCode(value) {
  return String(value || '').trim().toLowerCase();
}

export function productMatchesCode(product, query) {
  const code = normalizeCode(query);
  if (!code) return false;
  return [product?.sku, product?.externalId, product?.external_id, product?.gtin, product?.id]
    .some((candidate) => candidate && normalizeCode(candidate) === code);
}

/**
 * ¿Este producto responde a lo que se escribió?
 *
 * Todos los términos tienen que coincidir, y coinciden por PRINCIPIO DE PALABRA:
 * «coc» encuentra Coca-Cola, pero «tónica» no encuentra Gatorade por estar
 * adentro de «isotónica». Buscar por dentro de la palabra parece más generoso y
 * lo que hace es traer cosas que nadie pidió.
 *
 * Los términos de CAPACIDAD son más estrictos todavía: coinciden como palabra
 * entera. «500ml» adentro de «1500ml» es una coincidencia de dígitos, no de
 * tamaño, y era la que le vendía el familiar a quien pedía el chico.
 *
 * Un código exacto es la única puerta de atrás, y sólo abre con el código
 * completo.
 */
export function productMatchesQuery(product, query) {
  const consulta = normalizeSearchText(query);
  if (!consulta) return true;
  if (productMatchesCode(product, query)) return true;
  const conBordes = ` ${searchHaystack(product)} `;
  return consulta.split(' ').filter(Boolean).every((termino) => (
    TERMINO_DE_CAPACIDAD.test(termino)
      ? conBordes.includes(` ${termino} `)
      : conBordes.includes(` ${termino}`)
  ));
}
