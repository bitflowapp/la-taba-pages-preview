/*
 * Importador comercial: de la planilla del negocio al catálogo, sin inventar.
 *
 * POR QUÉ EXISTE
 * --------------
 * El importador técnico (`import-product-catalog.mjs`) da de alta productos
 * NUEVOS desde un CSV de veintiún columnas. No sirve para lo que hace falta
 * ahora, que es lo contrario: los productos ya existen, están identificados,
 * tienen foto y categoría, y lo único que les falta es lo que sólo el negocio
 * puede decidir —precio, stock y si se publican—.
 *
 * Este importador toma la planilla de cuatro columnas, la cruza contra el
 * catálogo técnico y produce un plan. NO INVENTA NINGÚN DATO: cada campo
 * técnico sale del catálogo que ya existe y cada campo comercial de la
 * planilla. Una celda vacía es «no lo decidí todavía», nunca un cero.
 *
 * FALLA CERRADO. Un solo error bloquea la importación ENTERA: no existe la
 * importación parcial. Cargar 60 precios y que 3 queden mal es peor que no
 * cargar ninguno, porque los 3 se descubren vendiendo.
 *
 *   node scripts/import-commercial-catalog.mjs planilla.csv              # dry-run
 *   node scripts/import-commercial-catalog.mjs planilla.csv --apply ...  # aplica
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseCsv, PRODUCT_PRICE_MAX, POSTGRES_INTEGER_MAX } from './validate-product-catalog.mjs';
import { rowsToObjects, PROCUREMENT_SUFFIX } from './catalog-readiness.mjs';
import { STORE_CATEGORIES, findCategory, slugifyCategoryName } from '../js/core/store-taxonomy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRODUCTS_CSV = path.join(ROOT, 'catalog/products.csv');

export const SHEET_REQUIRED_COLUMNS = Object.freeze(['sku', 'precio', 'stock', 'publicar']);

/*
 * ALTA PROPUESTA: LAS COLUMNAS QUE HACEN FALTA PARA CREAR UN PRODUCTO.
 *
 * Hasta acá, una fila con un SKU desconocido frenaba la importación entera con
 * «un SKU desconocido no se da de alta por acá», y estaba bien: la planilla de
 * cuatro columnas —sku, precio, stock, publicar— no alcanza para crear nada. No
 * dice qué es el producto, en qué góndola va, ni si lleva alcohol.
 *
 * Con la tienda 24/7 eso pasó a ser un cuello real: incorporar un rubro nuevo
 * son decenas de artículos que todavía no existen, y el único camino era el
 * pipeline de catálogo, que es de investigación y no de operación.
 *
 * La regla que se conserva es la que importaba: UNA FILA NUEVA NO SE INSERTA
 * SÓLO PORQUE TIENE UN NOMBRE. Para proponer un alta la planilla tiene que
 * traer TODAS estas columnas —presentes en el encabezado, aunque alguna celda
 * quede vacía— y cada fila nueva tiene que completar las obligatorias. Sin el
 * encabezado completo, el comportamiento es el de siempre: un SKU desconocido
 * es un error, no un alta silenciosa.
 */
export const ALTA_COLUMNS = Object.freeze(['nombre', 'categoria', 'subcategoria', 'alcohol', 'imagen']);

/** Un SKU estable: minúsculas, dígitos y guiones. Es el identificador para siempre. */
export const STABLE_SKU_PATTERN = /^[a-z0-9][a-z0-9-]{2,79}$/;

/**
 * Nombre de un producto nuevo. No hay valor por defecto: un producto sin nombre
 * no es un producto incompleto, es una fila.
 */
export function parseSheetName(raw) {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (text === '') return { empty: true };
  if (text.length < 2 || text.length > 120) {
    return { error: `nombre «${text}»: tiene que tener entre 2 y 120 caracteres.` };
  }
  return { value: text };
}

/**
 * Categoría de un producto nuevo, contra la taxonomía de la tienda.
 *
 * Acepta el nombre visible («Limpieza») o el id («limpieza»), porque quien llena
 * la planilla ve el nombre y quien exporta del sistema ve el id. Devuelve las
 * dos formas: el id lo usa la vitrina y el NOMBRE es lo que se guarda en
 * `products.category`.
 *
 * Una categoría que la taxonomía no declara se rechaza. Es la compuerta que
 * impide publicar en una góndola que no existe: el producto se guardaría igual
 * y después no aparecería en ninguna sección, que es el defecto que la
 * migración 20260818040000 documentó y costó ocho categorías huérfanas.
 */
export function parseSheetCategory(raw) {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (text === '') return { empty: true };
  const categoria = findCategory(text.toLowerCase()) || findCategory(slugifyCategoryName(text));
  if (!categoria || categoria.legacy) {
    const validas = STORE_CATEGORIES.map((entry) => entry.name).join(', ');
    return { error: `categoria «${text}»: no es una categoría de la tienda. Las válidas son: ${validas}.` };
  }
  return { value: { id: categoria.id, name: categoria.name, alcoholic: categoria.alcoholic } };
}

/** Subcategoría: opcional, y es lo que hace encontrable al producto por su tipo. */
export function parseSheetSubcategory(raw) {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (text === '') return { empty: true };
  if (text.length > 80) return { error: `subcategoria «${text}»: hasta 80 caracteres.` };
  return { value: text };
}

/**
 * Clasificación alcohólica. SIEMPRE EXPLÍCITA, nunca inferida.
 *
 * Es la única columna del alta que no admite quedar vacía ni siquiera para un
 * producto que no se va a publicar. Un vacío que se lee como «no» convierte
 * cualquier descuido en una botella sin +18; un vacío que se lee como «sí»
 * bloquea una lavandina. Las dos lecturas son inventar, así que no se inventa.
 */
export function parseSheetAlcohol(raw) {
  const text = String(raw ?? '').trim().toLowerCase();
  if (text === '') return { empty: true };
  if (['si', 'sí', 'yes', 'true', '1', 'x'].includes(text)) return { value: true };
  if (['no', 'false', '0'].includes(text)) return { value: false };
  return { error: `alcohol «${raw}»: escribí «si» o «no». No se infiere de la categoría ni del nombre.` };
}

/**
 * Estado de la imagen. «no» es una respuesta válida: un producto sin foto puede
 * existir y no puede publicarse, que es exactamente la política vigente.
 * `commercial:gate` sigue siendo quien detecta un comprable sin imagen.
 */
export function parseSheetImage(raw) {
  const text = String(raw ?? '').trim().toLowerCase();
  if (text === '') return { empty: true };
  if (['si', 'sí', 'yes', 'true', '1', 'x'].includes(text)) return { value: true };
  if (['no', 'false', '0'].includes(text)) return { value: false };
  return { error: `imagen «${raw}»: escribí «si» o «no» según si el producto ya tiene su foto verificada.` };
}

/** El nombre plegado, para detectar que dos filas nombran lo mismo. */
export function foldedProductName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Un SKU de QA nunca puede entrar por acá. El 8 de agosto dos fixtures de
// staging llegaron a la góndola publicada y una persona real compró «QA TEST
// iPhone - compra de prueba» ×3. El catálogo técnico no los tiene, así que
// «SKU desconocido» ya los frenaría; esta regla existe igual para que el
// mensaje diga la verdad en vez de mandar a revisar un id que nadie escribió
// mal, y para cubrir el día que un fixture SÍ esté en el catálogo.
export const QA_SKU_PATTERNS = Object.freeze([
  /-staging-only$/i,
  /^qa[-_]/i,
  /\bqa\b/i,
  /\b(test|prueba|sintetic[ao]|synthetic|fixture|dummy)\b/i,
]);

export function looksLikeQaSku(sku, name = '') {
  const haystack = `${sku} ${name}`;
  return QA_SKU_PATTERNS.some((pattern) => pattern.test(haystack));
}

/**
 * Precio de planilla. Devuelve `{ value }`, `{ empty: true }` o `{ error }`.
 *
 * La distinción entre vacío y cero es la razón de ser de esta función. En
 * JavaScript `Number('')` es 0 y `Number(null)` es 0: cualquier conversión
 * ingenua convierte «todavía no lo decidí» en «vale cero pesos», y un cero
 * pasa cualquier validación de «es un número». Acá el vacío nunca llega a ser
 * un número.
 */
export function parseSheetPrice(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return { empty: true };
  // Se rechaza explícitamente lo que un Excel en español produce sin avisar:
  // separador de miles, coma decimal, signo y notación científica.
  if (/[,$\s]/.test(text)) {
    return { error: `precio «${text}»: escribilo sin puntos de mil, sin coma y sin signo. Ej: 3900 o 3900.50` };
  }
  if (/e/i.test(text)) return { error: `precio «${text}»: notación científica no aceptada.` };
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    return { error: `precio «${text}»: sólo dígitos y hasta dos decimales.` };
  }
  const value = Number(text);
  if (!Number.isFinite(value)) return { error: `precio «${text}»: no es un número finito.` };
  if (value <= 0) return { error: `precio «${text}»: tiene que ser mayor a cero.` };
  if (value > PRODUCT_PRICE_MAX) return { error: `precio «${text}»: fuera de rango.` };
  return { value };
}

/** Stock de planilla. El cero SÍ es válido y significa agotado. */
export function parseSheetStock(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return { empty: true };
  if (/^-/.test(text)) return { error: `stock «${text}»: no puede ser negativo.` };
  if (/[.,]/.test(text)) return { error: `stock «${text}»: tiene que ser un entero de unidades.` };
  if (/e/i.test(text)) return { error: `stock «${text}»: notación científica no aceptada.` };
  if (!/^\d+$/.test(text)) return { error: `stock «${text}»: sólo dígitos.` };
  const value = Number(text);
  if (!Number.isSafeInteger(value)) return { error: `stock «${text}»: no es un entero seguro.` };
  if (value > POSTGRES_INTEGER_MAX) return { error: `stock «${text}»: fuera de rango.` };
  return { value };
}

/** Publicar. Vacío es «no lo decidí»: nunca publica y nunca despublica. */
export function parseSheetPublish(raw) {
  const text = String(raw ?? '').trim().toLowerCase();
  if (text === '') return { empty: true };
  if (['si', 'sí', 'yes', 'true', '1', 'x'].includes(text)) return { value: true };
  if (['no', 'false', '0'].includes(text)) return { value: false };
  return { error: `publicar «${raw}»: escribí «si» o «no».` };
}

export function readCatalogIndex(productsCsv) {
  const index = new Map();
  for (const product of rowsToObjects(productsCsv)) {
    const sku = String(product.sku || '').trim();
    if (sku) index.set(sku, product);
  }
  return index;
}

/**
 * Construye el plan. Función pura: no lee disco ni red, así que se puede
 * probar entera sin base de datos.
 */
export function buildCommercialPlan(sheetCsv, {
  catalog,
  imageExists = () => true,
  alcoholHabilitado = false,
} = {}) {
  const errors = [];
  const rows = parseCsv(String(sheetCsv ?? ''));
  if (!rows.length) return { errors: ['La planilla no tiene encabezado.'], rows: [], summary: emptySummary() };

  const header = rows[0].map((value, index) => (
    index === 0 ? value.replace(/^﻿/, '').trim().toLowerCase() : value.trim().toLowerCase()
  ));
  for (const column of SHEET_REQUIRED_COLUMNS) {
    if (!header.includes(column)) errors.push(`Falta la columna obligatoria «${column}».`);
  }
  /*
   * El MODO ALTA se enciende con el encabezado, no con una fila.
   *
   * O están las cinco columnas de alta, o no está ninguna. Media planilla —con
   * «nombre» y sin «alcohol», por ejemplo— es la forma más fácil de crear un
   * producto con una clasificación que nadie escribió, así que se rechaza el
   * encabezado antes de mirar una sola fila.
   */
  const columnasDeAlta = ALTA_COLUMNS.filter((column) => header.includes(column));
  const permiteAltas = columnasDeAlta.length === ALTA_COLUMNS.length;
  if (columnasDeAlta.length && !permiteAltas) {
    const faltan = ALTA_COLUMNS.filter((column) => !header.includes(column));
    errors.push(
      `Para proponer altas hacen falta las cinco columnas ${ALTA_COLUMNS.join(', ')}; faltan: ${faltan.join(', ')}.`,
    );
  }
  const duplicatedColumns = header.filter((column, index) => header.indexOf(column) !== index);
  for (const column of new Set(duplicatedColumns)) {
    errors.push(`La columna «${column}» está repetida.`);
  }
  if (errors.length) return { errors, rows: [], summary: emptySummary() };

  const entries = rows.slice(1).map((values, index) => ({
    line: index + 2,
    values: Object.fromEntries(header.map((column, columnIndex) => [column, (values[columnIndex] ?? '').trim()])),
  }));

  /*
   * NUNCA SE TOCA UN PRODUCTO POR SU NOMBRE. El apareo es por SKU y sólo por
   * SKU. Este índice existe para lo contrario: para RECHAZAR un alta que
   * duplicaría un producto que ya está en góndola con otro identificador, que es
   * cómo nacen los catálogos con la misma lavandina cargada tres veces.
   */
  const nombresDelCatalogo = new Map();
  for (const [sku, product] of catalog) {
    const clave = `${foldedProductName(product.name)}|${String(product.category_id || '').trim().toLowerCase()}`;
    if (clave.startsWith('|')) continue;
    if (!nombresDelCatalogo.has(clave)) nombresDelCatalogo.set(clave, sku);
  }

  const seen = new Map();
  const nombresPropuestos = new Map();
  const planned = [];
  const altas = [];
  for (const { line, values } of entries) {
    const sku = String(values.sku || '').trim();
    if (!sku) {
      errors.push(`Línea ${line}: sku vacío.`);
      continue;
    }
    if (seen.has(sku)) {
      errors.push(`Línea ${line}: el SKU «${sku}» ya aparece en la línea ${seen.get(sku)}. Dejá una sola fila por producto.`);
      continue;
    }
    seen.set(sku, line);

    const product = catalog.get(sku);
    if (looksLikeQaSku(sku, product?.name || '')) {
      errors.push(`Línea ${line}: «${sku}» parece un producto de prueba. No entra al catálogo comercial.`);
      continue;
    }
    if (PROCUREMENT_SUFFIX.test(sku)) {
      errors.push(`Línea ${line}: «${sku}» es un pack de abastecimiento, no un producto de góndola.`);
      continue;
    }
    if (!product) {
      if (!permiteAltas) {
        errors.push(`Línea ${line}: el SKU «${sku}» no existe en el catálogo. Un SKU desconocido no se da de alta por acá.`);
        continue;
      }
      const alta = buildAltaPropuesta({
        line, sku, values, nombresDelCatalogo, nombresPropuestos, errors,
      });
      if (alta) altas.push(alta);
      continue;
    }
    // Un SKU que YA existe se modifica; las columnas de alta se ignoran a
    // propósito. Cambiar la categoría o la clasificación alcohólica de un
    // producto vivo es otra decisión y no viaja por esta planilla: el importador
    // no puede convertir una gaseosa en un fernet ni al revés.

    const price = parseSheetPrice(values.precio);
    const stock = parseSheetStock(values.stock);
    const publish = parseSheetPublish(values.publicar);
    for (const parsed of [price, stock, publish]) {
      if (parsed.error) errors.push(`Línea ${line} (${sku}): ${parsed.error}`);
    }
    if (price.error || stock.error || publish.error) continue;

    const before = {
      price: normalizeStoredPrice(product.price),
      /*
       * El catálogo del REPOSITORIO no guarda unidades, así que acá vale null y
       * la planilla tiene que traer el stock para poder publicar. El catálogo de
       * PRODUCCIÓN sí las tiene, y entonces el «antes» es el de verdad y el diff
       * puede decir «stock 12 → 24» en vez de «— → 24».
       */
      stock: normalizeStoredStock(product.stock),
      published: String(product.publication_status || '').trim() === 'published',
    };
    const after = {
      price: price.empty ? before.price : price.value,
      stock: stock.empty ? before.stock : stock.value,
      published: publish.empty ? before.published : publish.value,
    };

    // Publicar exige las tres patas. Sin ellas el producto aparece en la
    // tienda y no se puede comprar, que es la peor de las dos opciones: ocupa
    // lugar en la góndola y frustra a quien lo toca.
    //
    // La compuerta corre sólo cuando la planilla PIDE publicar. Conservar una
    // publicación que ya existía no es pedirla: si corriera también ahí,
    // cambiarle el precio a un producto ya publicado lo bloquearía por «falta
    // stock», porque el stock no vive en el catálogo técnico. Lo encontró el
    // propio test de esta regla.
    if (publish.value === true) {
      /*
       * EL ALCOHOL NO SE PUBLICA POR PLANILLA.
       *
       * Publicar una bebida alcohólica no es cargar un dato: es afirmar que el
       * local tiene la habilitación de expendio acreditada. Esa decisión vive en
       * `businesses.alcohol_sales_enabled`, la toma una persona, y este camino
       * no puede tomarla por ella ni siquiera si la planilla lo pide. Con la
       * compuerta cerrada, una fila que intente publicar alcohol frena la
       * importación ENTERA —como cualquier otro error— en vez de colarse.
       */
      if (product.is_alcoholic === true && !alcoholHabilitado) {
        errors.push(`Línea ${line} (${sku}): es una bebida alcohólica y la venta de alcohol está cerrada `
          + '(alcohol_sales_enabled = false). Publicarla es una habilitación comercial, no un dato de planilla.');
        continue;
      }
      const faltan = [];
      if (after.price === null) faltan.push('precio');
      if (after.stock === null) faltan.push('stock');
      if (!imageExists(product)) faltan.push('foto');
      if (faltan.length) {
        errors.push(`Línea ${line} (${sku}): no se puede publicar sin ${faltan.join(', ')}.`);
        continue;
      }
      if (after.stock === 0) {
        errors.push(`Línea ${line} (${sku}): publicar con stock 0 deja un producto visible que nadie puede comprar. Cargá stock o poné publicar=no.`);
        continue;
      }
    }

    planned.push({
      line,
      sku,
      name: product.name || '',
      category: product.category_id || '',
      before,
      after,
      changes: describeChanges(before, after),
      // Lo que de verdad le importa al negocio: si después de esto se puede
      // comprar o no. Un cambio de precio que deja el producto igual de
      // invendible no es una mejora, y así se ve.
      comprabilidad: { antes: esComprable(before), despues: esComprable(after) },
      notes: values.notas || '',
    });
  }

  if (errors.length) return { errors, rows: [], altas: [], summary: emptySummary() };

  const touched = planned.filter((row) => row.changes.length);
  return {
    errors: [],
    rows: planned,
    altas,
    summary: {
      sheetRows: planned.length,
      altas: altas.length,
      altasConPrecio: altas.filter((alta) => alta.precio !== null).length,
      altasConAlcohol: altas.filter((alta) => alta.alcohol).length,
      changed: touched.length,
      unchanged: planned.length - touched.length,
      priceChanges: touched.filter((row) => row.changes.includes('precio')).length,
      stockChanges: touched.filter((row) => row.changes.includes('stock')).length,
      publishChanges: touched.filter((row) => row.changes.includes('publicacion')).length,
      // Los que NO están en la planilla no se tocan: no entran al payload.
      seVuelvenComprables: planned.filter((r) => !r.comprabilidad.antes && r.comprabilidad.despues).length,
      dejanDeSerComprables: planned.filter((r) => r.comprabilidad.antes && !r.comprabilidad.despues).length,
      siguenSinPoderVenderse: planned.filter((r) => !r.comprabilidad.antes && !r.comprabilidad.despues).length,
      untouchedCatalogSkus: catalog.size - planned.length,
      sheetSha256: sha256(String(sheetCsv ?? '')),
    },
  };
}

/*
 * EL CONTRATO DE UN ALTA PROPUESTA.
 *
 * Una fila nueva NO se inserta sólo porque tiene un nombre. Para que exista un
 * producto hace falta poder contestar, con datos que alguien escribió a
 * propósito, estas siete preguntas:
 *
 *   1. ¿Con qué identificador se lo va a reconocer para siempre?  (sku estable)
 *   2. ¿Qué es?                                                    (nombre)
 *   3. ¿En qué góndola va?                                         (categoría)
 *   4. ¿Qué tipo de producto es dentro de esa góndola?             (subcategoría)
 *   5. ¿Lleva alcohol?                                             (explícito)
 *   6. ¿Cuánto cuesta y cuánto hay?                                (precio, stock)
 *   7. ¿Se publica, y tiene con qué?                               (publicar, imagen)
 *
 * Las cinco primeras son obligatorias. Precio y stock pueden quedar vacíos: un
 * producto puede existir sin estar a la venta, y de hecho es el estado en el que
 * nace —oculto, no comprable— salvo que la planilla pida publicarlo y traiga
 * todo lo que hace falta.
 *
 * LO QUE ESTA FUNCIÓN TIENE PROHIBIDO, y cada prohibición tiene su ensayo:
 *
 *   · publicar alcohol. Un alta con alcohol se propone SIEMPRE oculta, aunque
 *     `alcohol_sales_enabled` esté en true: dar de alta y publicar una botella
 *     en el mismo renglón de una planilla no es cargar un dato, es afirmar una
 *     habilitación de expendio sobre un producto que nadie vio todavía;
 *   · contradecir la góndola. Si la categoría lleva alcohol y la fila dice que
 *     no —o al revés— la fila se rechaza en vez de elegir una de las dos;
 *   · crear un SKU que ya existe, o dos veces el mismo en la misma planilla;
 *   · duplicar por nombre un producto que ya está en la misma categoría;
 *   · inventar un identificador. El SKU lo escribe una persona y tiene que ser
 *     estable: minúsculas, dígitos y guiones.
 */
export function buildAltaPropuesta({ line, sku, values, nombresDelCatalogo, nombresPropuestos, errors }) {
  const rechazar = (motivo) => {
    errors.push(`Línea ${line} (${sku}): ${motivo}`);
    return null;
  };

  if (!STABLE_SKU_PATTERN.test(sku)) {
    return rechazar(
      `«${sku}» no es un SKU estable. Usá minúsculas, números y guiones, de 3 a 80 caracteres. `
      + 'Es el identificador del producto para siempre: no se corrige después sin romper el historial.',
    );
  }

  const nombre = parseSheetName(values.nombre);
  const categoria = parseSheetCategory(values.categoria);
  const subcategoria = parseSheetSubcategory(values.subcategoria);
  const alcohol = parseSheetAlcohol(values.alcohol);
  const imagen = parseSheetImage(values.imagen);
  const price = parseSheetPrice(values.precio);
  const stock = parseSheetStock(values.stock);
  const publish = parseSheetPublish(values.publicar);

  let malformada = false;
  for (const parsed of [nombre, categoria, subcategoria, alcohol, imagen, price, stock, publish]) {
    if (parsed.error) { rechazar(parsed.error); malformada = true; }
  }
  if (malformada) return null;

  const faltantes = [];
  if (nombre.empty) faltantes.push('nombre');
  if (categoria.empty) faltantes.push('categoria');
  if (alcohol.empty) faltantes.push('alcohol');
  if (faltantes.length) {
    return rechazar(
      `es un producto nuevo y le faltan ${faltantes.join(', ')}. Una fila nueva no se da de alta sin eso.`,
    );
  }

  // La góndola y la clasificación tienen que decir lo mismo. Es la misma
  // partición que exige `products_verified_alcohol_coherence` en la base, así
  // que discrepar acá sería proponer una fila que la base va a rechazar.
  if (categoria.value.alcoholic !== alcohol.value) {
    return rechazar(
      `la categoría «${categoria.value.name}» ${categoria.value.alcoholic ? 'lleva' : 'no lleva'} alcohol `
      + `y la fila dice «${alcohol.value ? 'si' : 'no'}». Corregí la categoría o la clasificación: no se elige por vos.`,
    );
  }

  const claveDeNombre = `${foldedProductName(nombre.value)}|${categoria.value.id}`;
  const existente = nombresDelCatalogo.get(claveDeNombre);
  if (existente) {
    return rechazar(
      `ya hay un producto llamado «${nombre.value}» en ${categoria.value.name}, con SKU «${existente}». `
      + 'Si es el mismo, usá su SKU para modificarlo; si es otro, diferenciá el nombre.',
    );
  }
  const repetido = nombresPropuestos.get(claveDeNombre);
  if (repetido) {
    return rechazar(`repite el nombre «${nombre.value}» de la línea ${repetido} en la misma categoría.`);
  }
  nombresPropuestos.set(claveDeNombre, line);

  /*
   * UN ALTA NACE OCULTA. SIEMPRE.
   *
   * Publicar no es cargar un dato: es afirmar que la ficha está completa, que la
   * foto es la del envase, que el precio es el que se cobra y —si lleva
   * alcohol— que el local tiene la habilitación de expendio acreditada. La base
   * lo dice con la misma dureza: publicar exige `is_verified`, y un producto
   * verificado tiene que cumplir el contrato de identidad comercial completo,
   * que una planilla de nueve columnas no puede acreditar.
   *
   * Así que crear y publicar son dos pasadas, y el importador lo dice en vez de
   * ignorar la celda: primero se cargan los productos, después se los revisa, y
   * recién entonces la misma planilla —con el SKU ya existente— los publica por
   * el camino de siempre, con sus compuertas de precio, stock, foto y alcohol.
   */
  if (publish.value === true) {
    return rechazar(
      'un producto nuevo no se publica en el mismo renglón en el que se crea. Poné «publicar=no» para '
      + 'darlo de alta oculto, revisá la ficha, y publicalo en una segunda pasada con el SKU ya cargado.',
    );
  }

  return {
    line,
    sku,
    nombre: nombre.value,
    categoriaId: categoria.value.id,
    categoria: categoria.value.name,
    subcategoria: subcategoria.empty ? '' : subcategoria.value,
    alcohol: alcohol.value,
    // El +18 no es una preferencia: si lleva alcohol, la edad mínima es 18 y la
    // fija el contrato, no la planilla.
    edadMinima: alcohol.value ? 18 : null,
    precio: price.empty ? null : price.value,
    stock: stock.empty ? null : stock.value,
    tieneImagen: imagen.value === true,
    // Un alta nunca nace publicada: ver arriba. El campo se conserva explícito
    // para que el informe y el payload digan la verdad en vez de omitirla.
    publicar: false,
    notas: values.notas || '',
  };
}

function emptySummary() {
  return {
    sheetRows: 0,
    altas: 0,
    altasConPrecio: 0,
    altasConAlcohol: 0,
    changed: 0,
    unchanged: 0,
    priceChanges: 0,
    stockChanges: 0,
    publishChanges: 0,
    seVuelvenComprables: 0,
    dejanDeSerComprables: 0,
    siguenSinPoderVenderse: 0,
    untouchedCatalogSkus: 0,
    sheetSha256: '',
  };
}

/**
 * ¿Con estos tres valores se puede comprar? Es la misma regla que
 * `core/beverage-home-sections.isPurchasableBeverageProduct` aplica en la
 * tienda, reducida a lo que una planilla puede cambiar.
 */
export function esComprable(estado) {
  return Boolean(estado.published && estado.price !== null && estado.price > 0
    && estado.stock !== null && estado.stock > 0);
}

function describeChanges(before, after) {
  const changes = [];
  if (before.price !== after.price) changes.push('precio');
  if (before.stock !== after.stock) changes.push('stock');
  if (before.published !== after.published) changes.push('publicacion');
  return changes;
}

// El precio guardado se lee igual de estricto que el de la planilla: una fila
// del catálogo con `price` vacío vale `null`, no cero. Si esto devolviera 0, un
// producto sin precio se leería como «ya tenía precio 0» y la planilla parecería
// no cambiar nada.
export function normalizeStoredPrice(raw) {
  const text = String(raw ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Stock guardado. Ausente es `null` —«no lo sé»—, nunca 0: confundir los dos
 * haría que un producto sin dato pareciera «ya estaba en cero» y que la planilla
 * no cambia nada. Es la misma distinción que hace `normalizeStoredPrice`.
 */
export function normalizeStoredStock(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export function renderChangeReport(plan) {
  const lines = [];
  const money = (value) => (value === null ? '—' : `$ ${value}`);
  const stock = (value) => (value === null ? '—' : String(value));
  const flag = (value) => (value ? 'publicado' : 'oculto');

  for (const row of plan.rows) {
    if (!row.changes.length) continue;
    const parts = [];
    if (row.changes.includes('precio')) parts.push(`precio ${money(row.before.price)} → ${money(row.after.price)}`);
    if (row.changes.includes('stock')) parts.push(`stock ${stock(row.before.stock)} → ${stock(row.after.stock)}`);
    if (row.changes.includes('publicacion')) parts.push(`${flag(row.before.published)} → ${flag(row.after.published)}`);
    lines.push(`  ${row.sku.padEnd(38)} ${parts.join(' · ')}`);
  }
  return lines;
}

/**
 * QUÉ SE CREARÍA, EXACTAMENTE.
 *
 * El dry-run de una modificación puede mostrar un diff porque el «antes» existe.
 * El de un alta no: lo único honesto es escribir la ficha completa del producto
 * que se va a insertar, campo por campo, para que quien aprueba lea lo mismo que
 * la base va a guardar.
 */
export function renderAltaReport(plan) {
  const lines = [];
  for (const alta of plan.altas || []) {
    lines.push(`  ${alta.sku}`);
    lines.push(`      nombre ....... ${alta.nombre}`);
    lines.push(`      categoria .... ${alta.categoria} (${alta.categoriaId})`);
    lines.push(`      subcategoria . ${alta.subcategoria || '—'}`);
    lines.push(`      alcohol ...... ${alta.alcohol ? `SI · edad minima ${alta.edadMinima}` : 'no'}`);
    lines.push(`      precio ....... ${alta.precio === null ? '— (pendiente)' : `$ ${alta.precio}`}`);
    lines.push(`      stock ........ ${alta.stock === null ? '— (sin cargar)' : String(alta.stock)}`);
    lines.push(`      imagen ....... ${alta.tieneImagen ? 'si' : 'no'}`);
    lines.push(`      publicacion .. ${alta.publicar ? 'PUBLICADO' : 'oculto'}`);
    if (alta.notas) lines.push(`      notas ........ ${alta.notas}`);
  }
  return lines;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Convierte el plan en el payload del RPC. Sólo viajan las celdas que la
 * planilla DECIDIÓ: una celda vacía no viaja, y lo que no viaja no se toca.
 * Es la misma regla que impone el servidor, expresada acá para que el payload
 * no pueda contradecirla ni por accidente.
 */
export function planToRpcRows(plan) {
  return plan.rows
    .filter((row) => row.changes.length)
    .map((row) => {
      const payload = { sku: row.sku };
      if (row.changes.includes('precio')) payload.price = String(row.after.price);
      if (row.changes.includes('stock')) payload.stock = row.after.stock;
      if (row.changes.includes('publicacion')) payload.publish = row.after.published;
      return payload;
    });
}

/**
 * Las altas, en la forma que espera la RPC. Viaja la ficha entera —no hay
 * «celda que no viaja» como en una modificación— porque un producto que no
 * existe no tiene un valor anterior que conservar.
 */
export function planToAltaRows(plan) {
  return (plan.altas || []).map((alta) => ({
    sku: alta.sku,
    name: alta.nombre,
    category: alta.categoria,
    subcategory: alta.subcategoria || null,
    is_alcoholic: alta.alcohol,
    minimum_age: alta.edadMinima,
    price: alta.precio === null ? null : String(alta.precio),
    stock: alta.stock,
    publish: alta.publicar,
  }));
}

export async function applyCommercialImport(client, plan, businessId) {
  if (!Array.isArray(plan?.errors) || plan.errors.length) {
    throw new Error('No se aplica un plan con errores.');
  }
  const rows = planToRpcRows(plan);
  const altas = planToAltaRows(plan);
  if (!rows.length && !altas.length) throw new Error('El plan no cambia nada: no hay nada que aplicar.');
  if (!client?.rpc) throw new Error('Cliente Supabase inválido.');

  /*
   * UNA LLAMADA ES UNA TRANSACCIÓN, y por eso las altas y las modificaciones
   * viajan juntas.
   *
   * Partirlas en dos llamadas dejaría una ventana con los productos nuevos ya
   * creados y los precios sin actualizar, o al revés. Con planillas de decenas
   * de filas eso es una góndola a medias que alguien tiene que reconstruir a
   * mano. `apply_commercial_catalog_plan` hace las dos cosas en la misma
   * transacción: aplica todo o no aplica nada.
   */
  const result = await client.rpc('apply_commercial_catalog_plan', {
    p_business_id: businessId,
    p_creates: altas,
    p_updates: rows,
  });
  if (result?.error) {
    throw new Error(`El servidor rechazó el lote y lo deshizo entero: ${result.error.message || 'error desconocido'}`);
  }
  const applied = result?.data && typeof result.data === 'object' ? result.data : {};
  const creadas = Number(applied.created ?? 0);
  const actualizadas = Number(applied.updated ?? 0);
  if (creadas !== altas.length || actualizadas !== rows.length) {
    throw new Error(
      `El servidor aplicó ${creadas} altas y ${actualizadas} modificaciones; `
      + `se esperaban ${altas.length} y ${rows.length}.`,
    );
  }
  return { applied: creadas + actualizadas, created: creadas, updated: actualizadas, rows: applied.rows || [] };
}

export const CATALOGOS = Object.freeze(['repo', 'produccion']);

export function parseCommercialImportArgs(args = []) {
  const known = ['--dry-run', '--apply', '--json', '--target', '--catalogo'];
  const unknown = args.filter((argument) => argument.startsWith('--') && !known.includes(argument));
  if (unknown.length) throw new Error(`Flag desconocido: ${unknown[0]}.`);
  const apply = args.includes('--apply');
  const targetIndex = args.indexOf('--target');
  const target = targetIndex >= 0 ? args[targetIndex + 1] : '';
  if (targetIndex >= 0 && (!target || target.startsWith('--'))) {
    throw new Error('--target requiere un destino.');
  }
  if (apply && !target) {
    throw new Error('--apply exige --target: aplicar sin decir a dónde es exactamente lo que este importador evita.');
  }
  /*
   * CONTRA QUÉ CATÁLOGO SE VALIDA.
   *
   * `repo` es el histórico y sigue siendo el valor por defecto para no cambiarle
   * el significado a ninguna invocación que ya exista. `produccion` es el que
   * sirve para una planilla real: medido el 2026-08-27, el CSV del repositorio y
   * la tienda publicada comparten 7 SKU de 72, así que validar contra el repo
   * rechaza casi todo lo que está vendiendo.
   */
  const catalogoIndex = args.indexOf('--catalogo');
  const catalogo = catalogoIndex >= 0 ? args[catalogoIndex + 1] : 'repo';
  if (!CATALOGOS.includes(catalogo)) {
    throw new Error(`--catalogo tiene que ser ${CATALOGOS.join(' o ')}, y llegó «${catalogo || '(vacío)'}».`);
  }
  const positionals = args.filter((argument, index) => (
    !argument.startsWith('--') && args[index - 1] !== '--target' && args[index - 1] !== '--catalogo'
  ));
  if (positionals.length !== 1) throw new Error('Indicá exactamente un archivo CSV.');
  return { file: positionals[0], mode: apply ? 'apply' : 'dry-run', target, catalogo };
}

async function main(args) {
  let options;
  try {
    options = parseCommercialImportArgs(args);
  } catch (error) {
    console.error(`ERROR ${error.message}`);
    console.error('Uso: node scripts/import-commercial-catalog.mjs planilla.csv [--apply --target <destino>]');
    process.exitCode = 2;
    return;
  }

  let sheetCsv;
  try {
    sheetCsv = fs.readFileSync(path.resolve(options.file), 'utf8');
  } catch (error) {
    console.error(`ERROR No se pudo leer ${options.file}: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  let catalog;
  let alcoholHabilitado = false;
  let imageExists;
  if (options.catalogo === 'produccion') {
    const modulo = await import('./comercial/catalogo-de-produccion.mjs');
    catalog = await modulo.leerCatalogoDeProduccion();
    alcoholHabilitado = await modulo.leerAlcoholHabilitado();
    imageExists = modulo.tieneImagen;
    console.log(`Catálogo: PRODUCCIÓN · ${catalog.size} SKU · alcohol_sales_enabled=${alcoholHabilitado}`);
  } else {
    catalog = readCatalogIndex(fs.readFileSync(PRODUCTS_CSV, 'utf8'));
    imageExists = (product) => {
      const master = String(product.image_master || '').trim();
      return Boolean(master) && fs.existsSync(path.join(ROOT, master));
    };
    console.log(`Catálogo: repositorio · ${catalog.size} SKU`);
  }

  const plan = buildCommercialPlan(sheetCsv, { catalog, imageExists, alcoholHabilitado });

  if (options.mode === 'dry-run' && args.includes('--json')) {
    console.log(JSON.stringify(plan, null, 2));
    if (plan.errors.length) process.exitCode = 1;
    return;
  }

  if (plan.errors.length) {
    console.error('');
    console.error('INVALID');
    console.error(`  ${plan.errors.length} fila(s) rechazada(s). NO SE ESCRIBIÓ NADA.`);
    console.error('');
    for (const error of plan.errors) console.error(`  ERROR ${error}`);
    console.error('');
    console.error('Falla cerrado a propósito: una importación a medias deja precios mal en la góndola.');
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log('VALID');
  console.log(`  productos encontrados ....... ${plan.summary.sheetRows}`);
  console.log(`  altas propuestas ............ ${plan.summary.altas}`);
  console.log(`  filas rechazadas ............ 0`);
  console.log(`  productos NO mencionados .... ${plan.summary.untouchedCatalogSkus} (quedan intactos)`);
  console.log(`  precios que cambian ......... ${plan.summary.priceChanges}`);
  console.log(`  stock que cambia ............ ${plan.summary.stockChanges}`);
  console.log(`  publicación que cambia ...... ${plan.summary.publishChanges}`);
  console.log('');
  console.log('  IMPACTO SOBRE COMPRABILIDAD');
  console.log(`    se vuelven comprables ..... ${plan.summary.seVuelvenComprables}`);
  console.log(`    dejan de ser comprables ... ${plan.summary.dejanDeSerComprables}`);
  console.log(`    siguen sin poder venderse . ${plan.summary.siguenSinPoderVenderse}`);
  console.log('');
  console.log(`  sha256 de la planilla ....... ${plan.summary.sheetSha256.slice(0, 16)}…`);
  console.log('');
  const report = renderChangeReport(plan);
  if (report.length) {
    console.log(`MODIFICACIONES (${plan.summary.changed}):`);
    for (const line of report) console.log(line);
  } else {
    console.log('MODIFICACIONES: ninguna. La planilla no mueve ningún producto existente.');
  }
  const sinCambio = plan.rows.filter((row) => !row.changes.length);
  if (sinCambio.length) {
    console.log('');
    console.log(`SIN CAMBIO (${sinCambio.length}): ${sinCambio.map((row) => row.sku).slice(0, 12).join(', ')}${sinCambio.length > 12 ? '…' : ''}`);
  }
  const altaReport = renderAltaReport(plan);
  if (altaReport.length) {
    console.log('');
    console.log(`ALTAS PROPUESTAS (${plan.summary.altas}) — esto es exactamente lo que se crearía:`);
    for (const line of altaReport) console.log(line);
    console.log('');
    console.log(`  Las ${plan.summary.altas} nacen OCULTAS y no comprables. ${plan.summary.altasConPrecio} traen precio`
      + `${plan.summary.altasConAlcohol ? ` y ${plan.summary.altasConAlcohol} llevan alcohol` : ''}.`);
    console.log('  Publicar es una segunda pasada, con el SKU ya cargado y la ficha revisada.');
  }
  console.log('');
  console.log(`  precio ....... ${plan.summary.priceChanges}`);
  console.log(`  stock ........ ${plan.summary.stockChanges}`);
  console.log(`  publicación .. ${plan.summary.publishChanges}`);
  console.log(`  sin cambios .. ${plan.summary.unchanged}`);
  console.log(`  intactos ..... ${plan.summary.untouchedCatalogSkus} SKU del catálogo que la planilla no menciona`);

  if (options.mode === 'dry-run') {
    console.log('');
    console.log('Dry-run: no se escribió nada. Para aplicar: --apply --target <destino>');
    return;
  }

  if (options.target !== 'supabase') {
    console.error('');
    console.error(`ERROR Destino «${options.target}» desconocido. El único destino de aplicación es --target supabase.`);
    console.error('  Para ejercitarlo contra una base descartable: node scripts/run-commercial-import-drill.mjs');
    process.exitCode = 2;
    return;
  }

  const rows = planToRpcRows(plan);
  const altas = planToAltaRows(plan);
  if (!rows.length && !altas.length) {
    console.log('');
    console.log('No hay nada que aplicar: la planilla no cambia ningún valor y no propone ningún alta.');
    return;
  }

  console.log('');
  console.log(`Aplicando ${altas.length} alta(s) y ${rows.length} modificación(es) en UNA transacción. Si una falla, no se aplica ninguna.`);
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const { url, publishableKey, accessToken, businessId } = readCommercialCredentials(process.env);
    const client = createClient(url, publishableKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const result = await applyCommercialImport(client, plan, businessId);
    console.log(`Aplicado: ${result.created} alta(s) y ${result.updated} modificación(es).`);
    console.log('El resto del catálogo quedó intacto: sólo viajaron los SKU de la planilla.');
  } catch (error) {
    console.error(`ERROR ${error.message}`);
    process.exitCode = 1;
  }
}

export function readCommercialCredentials(env = {}) {
  const url = env.SUPABASE_URL || '';
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '';
  const accessToken = env.SUPABASE_ACCESS_TOKEN || '';
  const businessId = env.TABA_BUSINESS_ID || '';
  if (!/^https:\/\//i.test(url)) throw new Error('Falta SUPABASE_URL HTTPS.');
  if (!publishableKey) throw new Error('Falta SUPABASE_PUBLISHABLE_KEY o SUPABASE_ANON_KEY.');
  if (/^sb_secret_/i.test(publishableKey)) {
    throw new Error('No uses una clave secreta en este importador: alcanza con la publicable y el token del dueño.');
  }
  if (!accessToken) throw new Error('Falta SUPABASE_ACCESS_TOKEN de un owner/admin autenticado.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(businessId)) {
    throw new Error('Falta TABA_BUSINESS_ID con un UUID válido.');
  }
  return { url, publishableKey, accessToken, businessId };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await main(process.argv.slice(2));
}
