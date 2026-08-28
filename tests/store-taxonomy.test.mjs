/*
 * LA TAXONOMÍA ES UNA SOLA, Y ESTE ARCHIVO LO OBLIGA.
 *
 * El defecto que la migración 20260818040000 documentó no fue una categoría mal
 * escrita: fue que el MISMO vocabulario vivía en cinco archivos y dos de ellos se
 * quedaron viejos sin que nada avisara. Durante meses no hubo forma de publicar
 * un fernet en su categoría, y se descubrió mirando la góndola, no fallando una
 * prueba.
 *
 * `js/core/store-taxonomy.js` volvió a dejar una sola declaración por categoría.
 * Lo que este archivo verifica es lo que un módulo compartido NO puede
 * garantizar solo: que esa declaración y la BASE —que es un archivo aparte,
 * escrito en otro lenguaje— sigan diciendo lo mismo.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  ALCOHOLIC_CATEGORY_IDS,
  CATEGORY_GLYPH_KEYS,
  LEGACY_CATEGORIES,
  STORE_CATEGORIES,
  STORE_CATEGORY_SECTIONS,
  categoryDefaults,
  departmentOf,
  findCategory,
  isAlcoholicCategory,
  slugifyCategoryName,
  storeCategoryOptions,
} from '../js/core/store-taxonomy.js';
import { normalizeCatalogProduct } from '../js/core/catalog-store.js';

const migracion = fs.readFileSync(
  new URL('../supabase/migrations/20260828120000_catalogo_multirubro.sql', import.meta.url),
  'utf8',
);
const ui = fs.readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');

/**
 * Los nombres que la restricción acepta, leídos del SQL.
 *
 * Se extraen del bloque de `products_verified_canonical_beverage_category` y no
 * de una lista copiada acá: una lista copiada volvería a ser el sexto lugar
 * donde el vocabulario puede desfasarse, que es justo lo que se está evitando.
 */
function vocabularioDeLaBase(nombreDeRestriccion) {
  const bloque = migracion.slice(migracion.indexOf(`add constraint ${nombreDeRestriccion} check (`));
  const cierre = bloque.indexOf('\n  );');
  assert.ok(cierre > 0, `no se encontró el cierre de ${nombreDeRestriccion}`);
  return bloque.slice(0, cierre);
}

const VOCABULARIO = vocabularioDeLaBase('products_verified_canonical_beverage_category');
const COHERENCIA = vocabularioDeLaBase('products_verified_alcohol_coherence');

/** Los nombres entrecomillados de un bloque SQL, sin duplicados. */
function nombresDe(sql) {
  return [...new Set([...sql.matchAll(/'([^']+)'/g)].map((match) => match[1]))];
}

test('el nombre de cada categoría slugifica exactamente a su id', () => {
  /*
   * Es el contrato que une los dos lados: la base guarda el NOMBRE
   * (`products.category = 'Aguas saborizadas'`) y el cliente lo slugifica para
   * obtener el id con el que dibuja el chip. Si un nombre no vuelve a su id, el
   * producto se publica y no aparece en ninguna sección —exactamente el defecto
   * de la 20260818040000, que costó ocho categorías huérfanas—.
   */
  for (const categoria of STORE_CATEGORIES) {
    assert.equal(
      slugifyCategoryName(categoria.name),
      categoria.id,
      `«${categoria.name}» slugifica a «${slugifyCategoryName(categoria.name)}» y no a «${categoria.id}»`,
    );
  }
});

test('todo nombre de la taxonomía lo acepta el vocabulario de la base', () => {
  const aceptados = new Set(nombresDe(VOCABULARIO));
  const rechazados = STORE_CATEGORIES
    .map((categoria) => categoria.name)
    .filter((name) => !aceptados.has(name));
  assert.deepEqual(
    rechazados,
    [],
    `categorías que el cliente ofrece y la base rechazaría: ${rechazados.join(', ')}`,
  );
});

test('la base no acepta ningún nombre que la taxonomía no conozca', () => {
  // La dirección contraria: un nombre suelto en el SQL es una categoría que se
  // puede guardar y que ninguna superficie del cliente sabe dibujar. Termina en
  // un chip con el slug crudo, que es lo que ya pasó con «energeticas».
  const conocidos = new Set([
    ...STORE_CATEGORIES.map((categoria) => categoria.name),
    ...LEGACY_CATEGORIES.map((categoria) => categoria.name),
  ]);
  const desconocidos = nombresDe(VOCABULARIO).filter((name) => !conocidos.has(name));
  assert.deepEqual(
    desconocidos,
    [],
    `nombres aceptados por la base que el cliente no sabe dibujar: ${desconocidos.join(', ')}`,
  );
});

test('la partición de alcohol de la base es la misma que la del cliente', () => {
  const conAlcoholSql = COHERENCIA.slice(0, COHERENCIA.indexOf('and is_alcoholic is true'));
  const sinAlcoholSql = COHERENCIA.slice(
    COHERENCIA.indexOf('and is_alcoholic is true'),
    COHERENCIA.indexOf('and is_alcoholic is false'),
  );

  for (const nombre of nombresDe(conAlcoholSql)) {
    assert.equal(
      isAlcoholicCategory(slugifyCategoryName(nombre)),
      true,
      `la base exige alcohol en «${nombre}» y el cliente no lo infiere`,
    );
  }
  for (const nombre of nombresDe(sinAlcoholSql)) {
    assert.equal(
      isAlcoholicCategory(slugifyCategoryName(nombre)),
      false,
      `la base prohíbe alcohol en «${nombre}» y el cliente lo infiere igual`,
    );
  }
});

test('ningún rubro que no es bebida lleva alcohol', () => {
  /*
   * Que TABA abra las 24 horas no puede convertir un rubro nuevo en algo con
   * edad mínima. Un shampoo con `alcoholic: true` heredaría el +18, la
   * confirmación de mayoría de edad y la compuerta de expendio: una lavandina
   * dejaría de poder venderse porque `alcohol_sales_enabled` está en false.
   */
  const conAlcoholFueraDeBebida = STORE_CATEGORIES
    .filter((categoria) => categoria.alcoholic && categoria.department !== 'bebidas')
    .map((categoria) => categoria.id);
  assert.deepEqual(conAlcoholFueraDeBebida, []);

  for (const id of ['snacks', 'golosinas', 'almacen', 'limpieza', 'higiene-personal', 'hogar', 'mascotas', 'otros']) {
    const producto = normalizeCatalogProduct({
      id: `sku-${id}`, name: `Producto de ${id}`, categoryId: id, price: 1200, stock: 4, available: true,
    });
    assert.equal(producto.alcoholic, false, `${id} no puede inferir alcohol`);
    assert.equal(producto.minimumAge, null, `${id} no puede exigir edad`);
  }
});

test('los ocho rubros del encargo están declarados y se pueden elegir', () => {
  // La lista mínima del encargo, con el id con el que viaja cada uno. «Bebidas»
  // y «Aguas y gaseosas» ya existían como el rubro histórico, así que lo que se
  // verifica acá es lo que faltaba.
  const RUBROS = [
    ['snacks', 'Snacks'],
    ['golosinas', 'Golosinas'],
    ['almacen', 'Almacén'],
    ['limpieza', 'Limpieza'],
    ['higiene-personal', 'Higiene personal'],
    ['hogar', 'Hogar'],
    ['mascotas', 'Mascotas'],
    ['otros', 'Otros'],
  ];
  const ofrecidas = new Map(storeCategoryOptions().map((categoria) => [categoria.id, categoria.name]));
  for (const [id, name] of RUBROS) {
    assert.equal(ofrecidas.get(id), name, `falta ${id} entre las categorías elegibles`);
    assert.ok(findCategory(id), `${id} no está declarada`);
    assert.ok(departmentOf(id), `${id} no tiene rubro`);
  }
  // Y la bebida sigue entera: el rubro histórico no perdió ninguna categoría.
  for (const id of ['gaseosas', 'aguas', 'cervezas', 'fernet', 'vinos', 'destilados', 'hielo']) {
    assert.equal(departmentOf(id)?.id, 'bebidas', `${id} dejó de ser bebida`);
  }
});

test('cada categoría tiene un glifo que existe de verdad en la tira', () => {
  /*
   * Un glifo que no existe no rompe nada visible: `categoryGlyph` cae al icono
   * genérico de grilla. Por eso hace falta una prueba —la fila de chips se veía
   * «casi bien» con media docena de categorías compartiendo el mismo cuadrado—.
   */
  for (const [categoryId, glyph] of Object.entries(CATEGORY_GLYPH_KEYS)) {
    assert.ok(
      ui.includes(`\n  ${glyph}: \``) || ui.includes(`\n  '${glyph}': \``),
      `la categoría ${categoryId} pide el glifo «${glyph}» y ui.js no lo define`,
    );
  }
});

test('una categoría desconocida no hereda el tono de una gaseosa', () => {
  // Heredar los valores de `gaseosas` era inofensivo mientras todo era bebida.
  // Con limpieza e higiene en góndola, sería etiquetar un detergente como bebida.
  assert.deepEqual(categoryDefaults('rubro-que-no-existe'), {
    tone: 'generic', unit: 'unidad', unitLabel: 'Unidad',
  });
  assert.equal(categoryDefaults('limpieza').tone, 'cleaning');
  assert.equal(categoryDefaults('gaseosas').tone, 'drink');
  assert.equal(categoryDefaults('cervezas').tone, 'alcoholic');
  // El vocabulario anterior conserva el suyo: hay datos guardados con esos ids.
  assert.deepEqual(categoryDefaults('promos'), { tone: 'promo', unit: 'promo', unitLabel: 'Promo' });
});

test('las secciones de la home se derivan de la taxonomía y no se duplican', () => {
  const ids = STORE_CATEGORY_SECTIONS.map((section) => section.id);
  assert.equal(new Set(ids).size, ids.length, 'hay dos secciones con el mismo id');
  const enSecciones = STORE_CATEGORY_SECTIONS.flatMap((section) => section.categoryIds);
  assert.deepEqual(
    [...enSecciones].sort(),
    STORE_CATEGORIES.map((categoria) => categoria.id).sort(),
    'toda categoría viva tiene que caer en exactamente una sección',
  );
});

test('la lista de alcohol no perdió ni ganó ids al derivarse', () => {
  // El conjunto exacto que el cliente venía infiriendo antes de que la lista se
  // derivara de la taxonomía. Sumar uno agrega una restricción y es seguro;
  // perder uno le saca el +18 a una góndola entera, y por eso se fija.
  assert.deepEqual([...ALCOHOLIC_CATEGORY_IDS].sort(), [
    'aperitivos',
    'cervezas',
    'destilados',
    'espumantes',
    'fernet',
    'gins-y-vodkas',
    'vinos',
    'vinos-y-espumantes',
    'whisky-y-destilados',
  ]);
});
