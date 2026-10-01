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
import { cardTitle, formatCapacity, packagingLabel } from './product-presentation.js';
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

/*
 * LA MARCA ESCRITA DE CORRIDO.
 *
 * «Coca-Cola» se indexa como dos palabras, «coca» y «cola», así que quien
 * escribe «cocacola» —sin guion, que es como sale con el pulgar— no encontraba
 * ninguna. Lo mismo «redbull», «lays» (el apóstrofo parte «Lay’s» en «lay» y
 * «s») y «bon aqua». Medido contra las 46 fichas reales: cuatro marcas de las
 * más pedidas devolvían cero.
 *
 * Se agrega la forma pegada de la marca y del título como una palabra MÁS del
 * índice. No ensancha ninguna búsqueda que ya funcionaba: sigue valiendo que
 * cada término coincide por principio de palabra.
 */
function pegar(texto) {
  return normalizeSearchText(texto).replace(/[^a-z0-9]+/g, '');
}

function formasPegadas(product) {
  const formas = new Set();
  for (const fuente of [product.brand, cardTitle(product)]) {
    // Una sola palabra ya está en el índice tal cual: pegarla no agrega nada.
    if (!/\s/.test(normalizeSearchText(fuente))) continue;
    const pegada = pegar(fuente);
    if (pegada.length >= 4) formas.add(pegada);
  }
  return [...formas];
}

/*
 * «Vino tinto» es como se pide un Malbec. El catálogo guarda el cepaje —que es
 * el dato— y no el color, así que «tinto» devolvía cero con cinco vinos en
 * góndola. El color se deduce del cepaje, que lo determina sin ambigüedad; un
 * vino cuyo cepaje no está en la lista no recibe ninguno: no se adivina.
 */
const CEPAJES_TINTOS = /\b(malbec|cabernet|merlot|syrah|shiraz|bonarda|tempranillo|tannat|pinot noir|petit verdot|red blend|blend tinto)\b/;
const CEPAJES_BLANCOS = /\b(chardonnay|sauvignon blanc|torrontes|chenin|viognier|semillon|blend blanco)\b/;

function colorDeVino(product, texto) {
  if (!/^vinos/.test(claveCategoria(product))) return [];
  const colores = [];
  if (CEPAJES_TINTOS.test(texto) && !/\btinto\b/.test(texto)) colores.push('tinto');
  if (CEPAJES_BLANCOS.test(texto) && !/\bblanco\b/.test(texto)) colores.push('blanco');
  return colores;
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
  extras.push(...formasPegadas(product));
  extras.push(...colorDeVino(product, texto));
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
  const consulta = normalizeSearchQuery(query);
  if (!consulta) return true;
  if (productMatchesCode(product, query)) return true;
  const conBordes = ` ${searchHaystack(product)} `;
  const porTerminos = consulta.split(' ').filter(Boolean).every((termino) => (
    TERMINO_DE_CAPACIDAD.test(termino)
      ? conBordes.includes(` ${termino} `)
      : conBordes.includes(` ${termino}`)
  ));
  if (porTerminos) return true;
  // La marca partida donde no va —«bon aqua», «red bull energy»— es la misma
  // marca: se compara la consulta entera, pegada, contra las formas pegadas.
  const pegada = /^[a-z ]+$/.test(consulta) ? consulta.replace(/ /g, '') : '';
  return pegada.length >= 4 && pegada !== consulta && conBordes.includes(` ${pegada}`);
}

/*
 * LA CONSULTA, COMO LA ESCRIBE UNA PERSONA.
 *
 * El índice habla en mililitros y con coma decimal; el cliente escribe «1
 * litro», «2 litros», «710 cc», «2.25» o «litro y medio». Medido contra la
 * góndola real, las cinco devolvían cero. No son productos que falten: son
 * maneras de decir un tamaño que el catálogo sí tiene.
 *
 * Esto traduce la CONSULTA, no el índice: ninguna ficha gana una palabra que no
 * le corresponde.
 */
export function normalizeSearchQuery(query) {
  const texto = String(query || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\blitro y medio\b/g, '1,5 l')
    .replace(/\bmedio litro\b/g, '500 ml')
    .replace(/(\d+(?:[.,]\d+)?)\s*(?:litros?|lts?)\b/g, '$1 l')
    .replace(/\bun litro\b/g, '1 l')
    .replace(/\blitro\b/g, '1 l')
    .replace(/(\d+)\s*cc\b/g, '$1 ml')
    // «2.25» es «2,25»: el número suelto del índice lleva coma, como la tarjeta.
    .replace(/(\d)\.(\d)/g, '$1,$2')
    // «Agua tónica» es una tónica: sin esto «agua» exigía un agua mineral.
    .replace(/\bagua tonica\b/g, 'tonica');
  return normalizeSearchText(texto);
}

/*
 * TOLERANCIA A ERRORES DE TIPEO — sólo cuando la búsqueda exacta no trae nada.
 *
 * «heiniken», «kilmes», «schweps», «pesi», «cervesa»: diecisiete maneras reales
 * de escribir mal una marca que el local SÍ vende devolvían una góndola vacía.
 * Un teclado de teléfono produce eso todo el tiempo, y «No encontramos nada» le
 * dice al cliente que el producto no existe.
 *
 * Tres reglas la mantienen honesta:
 *
 *   1 · Es un RESPALDO. Si la búsqueda exacta encuentra algo, esto no corre: no
 *       se mezclan parecidos entre resultados buenos.
 *   2 · Compara contra las palabras que la ficha ya tiene. No agrega etiquetas,
 *       así que un producto que el local no vende sigue sin aparecer: «vodka»
 *       no se parece a nada del índice y sigue devolviendo cero. Un hueco de
 *       surtido sigue siendo un hueco.
 *   3 · Quien llama lo DICE en pantalla («Esto es lo más parecido»): un
 *       resultado aproximado nunca se presenta como exacto.
 *
 * Los números y los tamaños no se aproximan: «500 ml» es 500 ml.
 */
const LARGO_MINIMO_APROXIMABLE = 4;
const LARGO_MINIMO_DE_PREFIJO = 5;

function toleranciaPara(largo) {
  return largo >= 9 ? 2 : 1;
}

/** Cómo SUENA una palabra, para que «kilmes» y «quilmes» sean la misma. */
function claveFonetica(palabra) {
  return palabra
    // «ch» es un sonido propio: sin apartarlo, «chica» sonaba igual que «coca».
    .replace(/ch/g, 'x')
    .replace(/ph/g, 'f')
    .replace(/qu/g, 'k')
    .replace(/c(?=[ei])/g, 's')
    .replace(/c/g, 'k')
    .replace(/z/g, 's')
    .replace(/v/g, 'b')
    .replace(/ll/g, 'y')
    .replace(/w/g, 'u')
    .replace(/h/g, '')
    .replace(/y$/g, 'i')
    .replace(/(.)\1+/g, '$1');
}

/** Distancia de edición con transposiciones, cortada en `tope`. */
function distancia(a, b, tope) {
  if (Math.abs(a.length - b.length) > tope) return tope + 1;
  let previa2 = null;
  let previa = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const actual = [i];
    let minimo = i;
    for (let j = 1; j <= b.length; j += 1) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      let valor = Math.min(previa[j] + 1, actual[j - 1] + 1, previa[j - 1] + costo);
      if (previa2 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        valor = Math.min(valor, previa2[j - 2] + 1);
      }
      actual.push(valor);
      if (valor < minimo) minimo = valor;
    }
    if (minimo > tope) return tope + 1;
    previa2 = previa;
    previa = actual;
  }
  return previa[b.length];
}

const palabrasPorProducto = new WeakMap();

function palabrasDelIndice(product) {
  const guardable = product && typeof product === 'object';
  let palabras = guardable ? palabrasPorProducto.get(product) : null;
  if (!palabras) {
    palabras = [...new Set(searchHaystack(product).split(' '))]
      .filter((palabra) => palabra.length >= 3 && /^[a-z]+$/.test(palabra))
      .map((palabra) => ({ palabra, fonetica: claveFonetica(palabra) }));
    if (guardable) palabrasPorProducto.set(product, palabras);
  }
  return palabras;
}

function terminoSeParece(termino, palabras) {
  if (termino.length < LARGO_MINIMO_APROXIMABLE || !/^[a-z]+$/.test(termino)) return false;
  const tope = toleranciaPara(termino.length);
  const fonetico = claveFonetica(termino);
  return palabras.some(({ palabra, fonetica }) => {
    // Misma pronunciación desde el principio: «coka» es «coca».
    if (fonetico.length >= 3 && fonetica.startsWith(fonetico)) return true;
    // La palabra entera, con una letra de más, de menos o cambiada.
    if (Math.abs(palabra.length - termino.length) <= tope
      && (distancia(termino, palabra, tope) <= tope || distancia(fonetico, fonetica, tope) <= tope)) return true;
    // Todavía se está escribiendo: se compara contra el principio de la palabra.
    if (termino.length < LARGO_MINIMO_DE_PREFIJO || palabra.length <= termino.length) return false;
    return [termino.length, termino.length + 1].some((largo) => (
      largo <= palabra.length && distancia(termino, palabra.slice(0, largo), 1) <= 1
    ));
  });
}

/**
 * ¿Este producto se PARECE a lo que se escribió? Usar sólo cuando
 * `productMatchesQuery` no devolvió nada para ningún producto.
 */
export function productMatchesQueryLoosely(product, query) {
  const consulta = normalizeSearchQuery(query);
  if (!consulta) return false;
  const conBordes = ` ${searchHaystack(product)} `;
  const palabras = palabrasDelIndice(product);
  let aproximados = 0;
  const todos = consulta.split(' ').filter(Boolean).every((termino) => {
    if (TERMINO_DE_CAPACIDAD.test(termino)) return conBordes.includes(` ${termino} `);
    if (conBordes.includes(` ${termino}`)) return true;
    if (!terminoSeParece(termino, palabras)) return false;
    aproximados += 1;
    return true;
  });
  return todos && aproximados > 0;
}

/**
 * La búsqueda entera: exacta primero y, sólo si no hay nada, parecida.
 * Devuelve cuál de las dos fue para que la pantalla lo diga.
 */
export function searchProducts(products, query) {
  const lista = Array.isArray(products) ? products : [];
  if (!normalizeSearchQuery(query)) return { products: lista, approximate: false };
  const exactos = lista.filter((product) => productMatchesQuery(product, query));
  if (exactos.length) return { products: exactos, approximate: false };
  const parecidos = lista.filter((product) => productMatchesQueryLoosely(product, query));
  return { products: parecidos, approximate: parecidos.length > 0 };
}
