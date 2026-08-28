/*
 * LA TAXONOMÍA DE LA TIENDA. UN SOLO ARCHIVO PARA AGREGAR UN RUBRO.
 *
 * POR QUÉ EXISTE
 * --------------
 * Hasta acá, sumar una categoría a TABA obligaba a tocar cinco lugares que no
 * se conocen entre sí y que nadie recuerda enteros:
 *
 *   · `core/catalog-store.js`        — TONE_BY_CATEGORY y UNIT_BY_CATEGORY, dos
 *                                      mapas con una entrada por categoría; una
 *                                      categoría ausente caía silenciosamente
 *                                      en los valores de `gaseosas`;
 *   · `core/beverage-home-sections.js` — el orden de la home y la lista
 *                                      congelada de secciones;
 *   · `core/catalog-search.js`       — los sinónimos con los que la gente pide
 *                                      esa familia;
 *   · `ui.js`                        — el glifo del chip de categoría;
 *   · la base                        — el vocabulario cerrado que acepta
 *                                      `products_verified_canonical_category`.
 *
 * Cinco listas que decían lo mismo cinco veces, y ninguna sabía de las otras.
 * La consecuencia medible está escrita en la migración
 * `20260818040000_gondola_beverage_taxonomy.sql`: durante meses no hubo forma de
 * publicar un fernet en su categoría porque dos de esas listas se habían
 * desfasado y nadie lo vio.
 *
 * Acá vive UNA declaración por categoría, y las cinco superficies la leen. Sumar
 * «Limpieza» es agregar una entrada; el checkout, el carrito y el pedido no se
 * enteran, porque ninguno pregunta por la categoría —lo único que miran es
 * `is_alcoholic`, que sigue siendo la autoridad de su propia compuerta—.
 *
 * QUÉ NO ES
 * ---------
 * No es el catálogo. No declara ningún producto, precio ni stock. Una categoría
 * declarada acá y sin productos no aparece en ninguna superficie del cliente:
 * la home y la tira de chips publican sólo lo que tiene algo detrás.
 *
 * No es una regla legal. `alcoholic: true` marca qué categorías implican alcohol
 * cuando la fila del catálogo no trae bandera explícita. Habilitar la venta
 * sigue siendo `businesses.alcohol_sales_enabled`, que este archivo no toca.
 *
 * EL VOCABULARIO ANTERIOR NO SE RENOMBRA
 * --------------------------------------
 * Hay filas guardadas, favoritos y enlaces con ids de taxonomías previas. Viven
 * en `LEGACY_CATEGORIES` y siguen resolviendo nombre, tono y alcohol. Clasificar
 * de más nunca quita una restricción; renombrar un id productivo sí rompe datos.
 */

/**
 * Los rubros. Ordenan la góndola: primero la bebida —que es de donde viene este
 * comercio y sigue siendo su especialidad— y después el resto de la tienda.
 * `order` es el que decide la posición en la home y en la tira de categorías.
 */
export const STORE_DEPARTMENTS = Object.freeze([
  Object.freeze({ id: 'bebidas', name: 'Bebidas', tone: 'drink' }),
  Object.freeze({ id: 'alimentos', name: 'Alimentos y almacén', tone: 'food' }),
  Object.freeze({ id: 'limpieza', name: 'Limpieza y hogar', tone: 'cleaning' }),
  Object.freeze({ id: 'cuidado-personal', name: 'Higiene y cuidado personal', tone: 'care' }),
  Object.freeze({ id: 'mascotas', name: 'Mascotas', tone: 'pets' }),
  Object.freeze({ id: 'general', name: 'Otros', tone: 'generic' }),
]);

const DEPARTMENT_BY_ID = new Map(STORE_DEPARTMENTS.map((department) => [department.id, department]));

/*
 * SOBRE LOS SINÓNIMOS.
 *
 * Son las palabras con las que alguien PIDE LA FAMILIA, no un producto. La
 * categoría dice «Energizantes» y el cliente escribe «energética»; dice
 * «Limpieza» y escribe «artículos de limpieza».
 *
 * Deliberadamente NO entran los nombres de producto —«lavandina», «shampoo»,
 * «papel higiénico»—: ésos son subcategoría del SKU y ya viajan al índice por
 * ahí. Ponerlos acá haría que buscar «lavandina» devolviera la góndola entera de
 * limpieza. Un sinónimo que trae de más es peor que uno que falta, porque el que
 * falta se nota y el que sobra no.
 */

/**
 * Las categorías que la tienda conoce, en orden comercial.
 *
 * Campos:
 *   id          · el id estable. Es el que viaja en la fila del catálogo y en la
 *                 URL. NO se renombra.
 *   name        · lo que lee una persona. Su slug tiene que dar exactamente `id`
 *                 —la base guarda el NOMBRE y el cliente lo slugifica—, y hay un
 *                 test que lo verifica categoría por categoría.
 *   department  · a qué rubro pertenece.
 *   alcoholic   · si la categoría implica alcohol cuando la fila no trae bandera.
 *   section     · con qué otras categorías comparte carrusel en la home.
 *                 Compartir `section.id` es fusionarse: `aguas` y
 *                 `aguas-saborizadas` son un solo rail «Aguas».
 *   glyph       · clave del icono en `ui.js`.
 *   synonyms    · cómo se pide la familia.
 *   unit        · unidad de venta por defecto de la categoría.
 */
export const STORE_CATEGORIES = Object.freeze([
  // ── Bebidas ───────────────────────────────────────────────────────────────
  category({
    id: 'gaseosas', name: 'Gaseosas', department: 'bebidas',
    section: { id: 'gaseosas', title: 'Gaseosas' }, glyph: 'gaseosas',
    synonyms: ['gaseosa', 'gaseosas', 'refresco'],
  }),
  category({
    id: 'cervezas', name: 'Cervezas', department: 'bebidas', alcoholic: true,
    section: { id: 'cervezas', title: 'Cervezas' }, glyph: 'cervezas',
    synonyms: ['cerveza', 'cervezas', 'birra'],
  }),
  category({
    id: 'aguas', name: 'Aguas', department: 'bebidas',
    section: { id: 'aguas', title: 'Aguas' }, glyph: 'aguas',
    synonyms: ['agua', 'aguas', 'agua mineral', 'mineral'],
  }),
  category({
    id: 'aguas-saborizadas', name: 'Aguas saborizadas', department: 'bebidas',
    section: { id: 'aguas', title: 'Aguas' }, glyph: 'aguas',
    synonyms: ['agua saborizada', 'saborizada', 'saborizadas'],
  }),
  category({
    id: 'jugos', name: 'Jugos', department: 'bebidas',
    section: { id: 'jugos', title: 'Jugos' }, glyph: 'jugos',
    synonyms: ['jugo', 'jugos'],
  }),
  category({
    id: 'energizantes', name: 'Energizantes', department: 'bebidas',
    section: { id: 'energizantes', title: 'Energizantes' }, glyph: 'energeticas',
    synonyms: ['energizante', 'energizantes', 'energetica', 'energeticas', 'energetico', 'energeticos', 'energia'],
  }),
  category({
    id: 'isotonicas', name: 'Isotónicas', department: 'bebidas',
    section: { id: 'isotonicas', title: 'Isotónicas' }, glyph: 'isotonicas',
    synonyms: ['isotonica', 'isotonicas', 'bebida deportiva', 'deportiva', 'hidratante'],
  }),
  category({
    id: 'fernet', name: 'Fernet', displayName: 'Fernet y amargos', department: 'bebidas', alcoholic: true,
    section: { id: 'fernet-y-aperitivos', title: 'Fernet y aperitivos' }, glyph: 'fernet',
    synonyms: ['fernet', 'amargo', 'amargos'],
  }),
  category({
    id: 'aperitivos', name: 'Aperitivos', department: 'bebidas', alcoholic: true,
    section: { id: 'fernet-y-aperitivos', title: 'Fernet y aperitivos' }, glyph: 'aperitivos',
    synonyms: ['aperitivo', 'aperitivos', 'vermouth', 'vermut'],
  }),
  category({
    id: 'vinos', name: 'Vinos', department: 'bebidas', alcoholic: true,
    section: { id: 'vinos-y-espumantes', title: 'Vinos y espumantes' }, glyph: 'vinos-y-espumantes',
    synonyms: ['vino', 'vinos'],
  }),
  category({
    id: 'espumantes', name: 'Espumantes', displayName: 'Espumantes y sidras', department: 'bebidas', alcoholic: true,
    section: { id: 'vinos-y-espumantes', title: 'Vinos y espumantes' }, glyph: 'vinos-y-espumantes',
    synonyms: ['espumante', 'espumantes', 'sidra', 'sidras', 'champagne'],
  }),
  category({
    id: 'destilados', name: 'Destilados', department: 'bebidas', alcoholic: true,
    section: { id: 'destilados', title: 'Destilados' }, glyph: 'whisky-y-destilados',
    synonyms: ['destilado', 'destilados', 'bebida blanca', 'bebidas blancas'],
  }),
  category({
    id: 'mixers', name: 'Mixers', department: 'bebidas',
    section: { id: 'mixers', title: 'Mixers' }, glyph: 'mixers',
    synonyms: ['mixer', 'mixers', 'trago', 'tragos'],
  }),
  category({
    id: 'hielo', name: 'Hielo', department: 'bebidas',
    section: { id: 'hielo', title: 'Hielo' }, glyph: 'hielo-y-extras',
    synonyms: ['hielo'],
  }),

  // ── El resto de la tienda ─────────────────────────────────────────────────
  //
  // TABA 24/7 no es una tienda de bebidas con un estante de más: estas ocho
  // categorías son el resto del recorrido de una tienda de conveniencia, y van
  // DESPUÉS de la bebida porque el comercio sigue siendo especialista en eso.
  // El orden de la home lo decide `sort_order` del producto dentro de cada
  // carrusel; esta lista sólo ordena los carruseles entre sí.
  category({
    id: 'snacks', name: 'Snacks', department: 'alimentos',
    section: { id: 'snacks', title: 'Snacks' }, glyph: 'picadas-y-deli', tone: 'food',
    synonyms: ['snack', 'snacks', 'picada', 'picadas', 'copetin'],
  }),
  category({
    id: 'golosinas', name: 'Golosinas', department: 'alimentos',
    section: { id: 'golosinas', title: 'Golosinas' }, glyph: 'picadas-y-deli', tone: 'candy',
    synonyms: ['golosina', 'golosinas', 'kiosco', 'dulce', 'dulces'],
  }),
  category({
    id: 'almacen', name: 'Almacén', department: 'alimentos',
    section: { id: 'almacen', title: 'Almacén' }, glyph: 'almacen', tone: 'food',
    synonyms: ['almacen', 'despensa', 'comestible', 'comestibles', 'alimento', 'alimentos'],
  }),
  category({
    id: 'limpieza', name: 'Limpieza', department: 'limpieza',
    section: { id: 'limpieza', title: 'Limpieza' }, glyph: 'limpieza', tone: 'cleaning',
    synonyms: ['limpieza', 'articulos de limpieza', 'productos de limpieza'],
  }),
  category({
    id: 'higiene-personal', name: 'Higiene personal', department: 'cuidado-personal',
    section: { id: 'higiene-personal', title: 'Higiene personal' }, glyph: 'higiene', tone: 'care',
    synonyms: ['higiene', 'higiene personal', 'cuidado personal', 'perfumeria', 'tocador'],
  }),
  category({
    id: 'hogar', name: 'Hogar', department: 'limpieza',
    section: { id: 'hogar', title: 'Hogar' }, glyph: 'hogar', tone: 'home',
    synonyms: ['hogar', 'bazar'],
  }),
  category({
    id: 'mascotas', name: 'Mascotas', department: 'mascotas',
    section: { id: 'mascotas', title: 'Mascotas' }, glyph: 'mascotas', tone: 'pets',
    synonyms: ['mascota', 'mascotas'],
  }),
  category({
    id: 'otros', name: 'Otros', department: 'general',
    section: { id: 'otros', title: 'Otros' }, glyph: 'all', tone: 'generic',
    synonyms: ['otro', 'otros', 'varios'],
  }),
]);

/*
 * VOCABULARIO ANTERIOR.
 *
 * Ids que salieron de taxonomías previas y siguen existiendo en filas guardadas,
 * catálogos importados, favoritos y enlaces compartidos. No se muestran como
 * categorías nuevas —no entran a `STORE_CATEGORIES`— pero sí resuelven nombre,
 * tono, glifo y alcohol, que es lo que se necesita para no dibujar un slug crudo
 * ni perder un +18.
 */
export const LEGACY_CATEGORIES = Object.freeze([
  legacy({ id: 'promos', name: 'Promos', tone: 'promo', glyph: 'promos', unit: 'promo', unitLabel: 'Promo' }),
  legacy({ id: 'energeticas', name: 'Energéticas', tone: 'drink', glyph: 'energeticas' }),
  legacy({ id: 'picadas-y-deli', name: 'Picadas y deli', tone: 'food', glyph: 'picadas-y-deli' }),
  legacy({ id: 'hielo-y-extras', name: 'Hielo y extras', tone: 'ice', glyph: 'hielo-y-extras' }),
  legacy({ id: 'jugos-y-saborizadas', name: 'Jugos y saborizadas', tone: 'drink', glyph: 'jugos' }),
  legacy({ id: 'complementos', name: 'Complementos', tone: 'ice', glyph: 'hielo-y-extras' }),
  legacy({ id: 'vinos-y-espumantes', name: 'Vinos y espumantes', tone: 'alcoholic', glyph: 'vinos-y-espumantes', alcoholic: true }),
  legacy({ id: 'gins-y-vodkas', name: 'Gins y vodkas', tone: 'alcoholic', glyph: 'gins-y-vodkas', alcoholic: true }),
  legacy({ id: 'whisky-y-destilados', name: 'Whisky y destilados', tone: 'alcoholic', glyph: 'whisky-y-destilados', alcoholic: true }),
]);

const ALL_ENTRIES = Object.freeze([...STORE_CATEGORIES, ...LEGACY_CATEGORIES]);
const BY_ID = new Map(ALL_ENTRIES.map((entry) => [entry.id, entry]));

/** Los ids que implican alcohol sin bandera explícita en la fila. */
export const ALCOHOLIC_CATEGORY_IDS = Object.freeze(
  ALL_ENTRIES.filter((entry) => entry.alcoholic).map((entry) => entry.id),
);

/** Orden de las categorías vivas: el que usa la home y la tira de chips. */
export const STORE_CATEGORY_ORDER = Object.freeze(STORE_CATEGORIES.map((entry) => entry.id));

/**
 * Los carruseles de la home, en orden, cada uno con las categorías que fusiona.
 * Se deriva de `section` para que no exista una segunda lista que se pueda
 * desfasar de la primera —que es exactamente cómo se rompió la anterior—.
 */
export const STORE_CATEGORY_SECTIONS = Object.freeze((() => {
  const sections = new Map();
  for (const entry of STORE_CATEGORIES) {
    const existing = sections.get(entry.section.id);
    if (existing) existing.categoryIds.push(entry.id);
    else sections.set(entry.section.id, { id: entry.section.id, title: entry.section.title, categoryIds: [entry.id] });
  }
  return [...sections.values()].map((section) => Object.freeze({
    ...section,
    categoryIds: Object.freeze(section.categoryIds),
  }));
})());

/** Sinónimos de familia por id de categoría, para el índice de búsqueda. */
export const CATEGORY_SEARCH_SYNONYMS = Object.freeze(Object.fromEntries(
  STORE_CATEGORIES.filter((entry) => entry.synonyms.length).map((entry) => [entry.id, entry.synonyms]),
));

/** Clave de glifo por id de categoría, incluido el vocabulario anterior. */
export const CATEGORY_GLYPH_KEYS = Object.freeze(Object.fromEntries(
  ALL_ENTRIES.map((entry) => [entry.id, entry.glyph]),
));

/** `{ id, name }` de cada categoría viva, en orden comercial. */
export function storeCategoryOptions() {
  return STORE_CATEGORIES.map((entry) => ({ id: entry.id, name: entry.displayName }));
}

/** La declaración de una categoría, o `null` si el id no está declarado. */
export function findCategory(categoryId) {
  const id = String(categoryId || '').trim().toLowerCase();
  return BY_ID.get(id) || null;
}

export function isKnownCategory(categoryId) {
  return BY_ID.has(String(categoryId || '').trim().toLowerCase());
}

export function isAlcoholicCategory(categoryId) {
  return findCategory(categoryId)?.alcoholic === true;
}

/**
 * Tono y unidad por defecto de una categoría. Una categoría que no está
 * declarada NO cae en los valores de gaseosas —así se colaban productos de
 * limpieza etiquetados como bebida—: cae en el neutro de la tienda.
 */
export function categoryDefaults(categoryId) {
  const entry = findCategory(categoryId);
  if (!entry) return { tone: 'generic', unit: 'unidad', unitLabel: 'Unidad' };
  return { tone: entry.tone, unit: entry.unit, unitLabel: entry.unitLabel };
}

/** El rubro al que pertenece una categoría. `null` para el vocabulario anterior. */
export function departmentOf(categoryId) {
  const entry = findCategory(categoryId);
  return entry?.department ? DEPARTMENT_BY_ID.get(entry.department) || null : null;
}

/**
 * El slug canónico de un nombre de categoría. Es la MISMA transformación que
 * aplica el repositorio de producción sobre `products.category`, y por eso el
 * nombre declarado de cada categoría tiene que slugificar a su propio id.
 */
export function slugifyCategoryName(value) {
  const slug = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'otros';
}

function category({
  id,
  name,
  displayName = name,
  department,
  alcoholic = false,
  section,
  glyph,
  synonyms = [],
  tone,
  unit = 'unidad',
  unitLabel = 'Unidad',
}) {
  const fallbackTone = alcoholic ? 'alcoholic' : DEPARTMENT_BY_ID.get(department)?.tone || 'generic';
  return Object.freeze({
    id,
    name,
    displayName,
    department,
    alcoholic,
    section: Object.freeze({ ...section }),
    glyph,
    synonyms: Object.freeze([...synonyms]),
    tone: tone || fallbackTone,
    unit,
    unitLabel,
    legacy: false,
  });
}

function legacy({ id, name, tone, glyph, alcoholic = false, unit = 'unidad', unitLabel = 'Unidad' }) {
  return Object.freeze({
    id,
    name,
    displayName: name,
    department: '',
    alcoholic,
    section: Object.freeze({ id, title: name }),
    glyph,
    synonyms: Object.freeze([]),
    tone,
    unit,
    unitLabel,
    legacy: true,
  });
}
