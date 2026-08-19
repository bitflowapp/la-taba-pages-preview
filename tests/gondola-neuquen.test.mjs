import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GONDOLA, CRITERIO_PRECIO, precioDeVenta, CATEGORIAS_CON_ALCOHOL } from '../catalog/gondola-neuquen.mjs';
import {
  CATEGORIAS_GONDOLA,
  construirLote,
  revisarContratoDeVitrina,
  revisarCoherenciaDePrecios,
} from '../scripts/gondola-neuquen-plan.mjs';
import { GONDOLA_CATEGORY_NAMES, ALCOHOL_REQUIRED_CATEGORIES, ALCOHOL_FORBIDDEN_CATEGORIES } from '../scripts/validate-product-catalog.mjs';
import { categories as categoriasDeLaVitrina } from '../js/approved-beverage-demo-data.js';
import { normalizeCatalogProduct, applyRetailCatalogModel, isProductOrderable, isProductVisibleToCustomer } from '../js/core/catalog-store.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const UUID_DE_PRUEBA = '00000000-0000-4000-8000-0000000000aa';

/*
 * La góndola comercial de Neuquén.
 *
 * Lo que se prueba acá no es «el archivo existe»: es que cada fila sobreviva el
 * viaje entero —base → `rowToCatalogProduct` → catálogo del cliente → góndola—
 * y llegue comprable. Ese viaje tiene tres compuertas silenciosas que devuelven
 * `null` o descartan el producto sin decir nada, y las tres tienen su caso.
 */

/** El mismo slug que aplica `slugifyCategory` del repositorio de Supabase. */
function slugificarCategoria(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'otros';
}

test('el surtido entra en el rango pedido y está equilibrado', () => {
  const conAlcohol = GONDOLA.filter((p) => p.alcoholic);
  const sinAlcohol = GONDOLA.filter((p) => !p.alcoholic);
  assert.ok(sinAlcohol.length >= 20 && sinAlcohol.length <= 35, `sin alcohol: ${sinAlcohol.length}`);
  assert.ok(conAlcohol.length >= 15 && conAlcohol.length <= 30, `con alcohol: ${conAlcohol.length}`);
  assert.equal(GONDOLA.length, conAlcohol.length + sinAlcohol.length);
});

test('cada fila cumple el contrato que la vitrina exige', () => {
  assert.deepEqual(revisarContratoDeVitrina(GONDOLA), []);
});

test('ninguna categoría de la góndola queda huérfana en la vitrina', () => {
  // Éste es el defecto que motivó la migración 20260818040000: la base aceptaba
  // nombres cuyo slug no existía en la vitrina, y el producto se publicaba
  // fuera de toda sección, con el slug crudo de nombre de categoría.
  const idsDeLaVitrina = new Set(categoriasDeLaVitrina.map((c) => c.id));
  for (const nombre of CATEGORIAS_GONDOLA) {
    const id = slugificarCategoria(nombre);
    assert.ok(idsDeLaVitrina.has(id), `«${nombre}» slugifica a «${id}», que la vitrina no conoce`);
  }
  for (const p of GONDOLA) {
    const id = slugificarCategoria(p.category);
    assert.ok(idsDeLaVitrina.has(id), `${p.sku} caería en la categoría inexistente «${id}»`);
  }
});

test('el validador del repo y la góndola declaran el mismo vocabulario', () => {
  assert.deepEqual([...GONDOLA_CATEGORY_NAMES].sort(), [...CATEGORIAS_GONDOLA].sort());
});

test('la base y el cliente parten el alcohol por la misma línea', () => {
  for (const nombre of CATEGORIAS_GONDOLA) {
    const conAlcohol = CATEGORIAS_CON_ALCOHOL.includes(nombre);
    assert.equal(ALCOHOL_REQUIRED_CATEGORIES.has(nombre), conAlcohol, nombre);
    assert.equal(ALCOHOL_FORBIDDEN_CATEGORIES.has(nombre), !conAlcohol, nombre);
  }
});

test('ningún precio está escrito a mano: todos salen del costo medido', () => {
  for (const p of GONDOLA) {
    assert.ok(p.costoMayorista > 0, `${p.sku} sin costo de reposición`);
    assert.equal(
      p.price,
      precioDeVenta({ costoMayorista: p.costoMayorista, unitsPerPack: p.unitsPerPack, soldAsPack: p.soldAsPack }),
      `${p.sku}: el precio no se deriva del costo`,
    );
    assert.equal(p.price % CRITERIO_PRECIO.redondeoA, 0, `${p.sku}: no cae en un escalón de $${CRITERIO_PRECIO.redondeoA}`);
    assert.ok(p.price > p.costoMayorista, `${p.sku}: se vendería por debajo del costo`);
  }
});

test('todo costo derivado trae escrita su justificación', () => {
  // Un costo que no se midió pero se dedujo es legítimo; uno que aparece sin
  // decir de dónde salió es un número inventado.
  for (const p of GONDOLA) {
    if (p.derivado === null) continue;
    assert.ok(p.derivado.length > 80, `${p.sku}: la justificación del costo derivado es demasiado corta`);
    assert.match(p.derivado, /mayorista|stock|costo/i, p.sku);
  }
});

test('un pack nunca sale más caro por litro que su unidad suelta', () => {
  assert.deepEqual(revisarCoherenciaDePrecios(GONDOLA), []);
});

test('no hay productos de prueba, ni textos de relleno, ni SKU repetidos', () => {
  const skus = new Set();
  for (const p of GONDOLA) {
    assert.ok(!skus.has(p.sku), `SKU repetido: ${p.sku}`);
    skus.add(p.sku);
    const texto = `${p.sku} ${p.name} ${p.description} ${p.brand} ${p.tags.join(' ')}`;
    assert.doesNotMatch(texto, /\b(test|qa|dummy|fixture|placeholder|lorem|staging|sample|tbd|xxx)\b/i, p.sku);
    assert.doesNotMatch(texto, /\bprueba\b/i, p.sku);
  }
});

test('el stock inicial es operativo, no infinito', () => {
  for (const p of GONDOLA) {
    assert.ok(Number.isInteger(p.stock), `${p.sku}: stock no entero`);
    assert.ok(p.stock >= 4 && p.stock <= 24, `${p.sku}: stock ${p.stock} fuera del tramo operativo 4..24`);
  }
});

/*
 * El viaje completo. Se arma la fila EXACTAMENTE como la va a guardar el lote y
 * se la hace pasar por el catálogo del cliente. Si `presentation` no fuera igual
 * a `variant`, o si `capacity` no fuera `capacity_value` + `capacity_unit`, el
 * producto se caería en silencio y la góndola tendría un hueco.
 */
function comoLaGuardaLaBase(p) {
  return {
    id: p.sku,
    sku: p.sku,
    externalId: p.externalId,
    name: p.name,
    brand: p.brand,
    description: p.description,
    categoryId: slugificarCategoria(p.category),
    subcategory: p.subcategory,
    variant: p.variant,
    presentation: p.presentation,
    capacityValue: p.capacityValue,
    capacityUnit: p.capacityUnit,
    capacity: p.capacity,
    unitsPerPack: p.unitsPerPack,
    soldAsPack: p.soldAsPack,
    price: p.price,
    pricePending: false,
    priceStatus: 'confirmed',
    stock: p.stock,
    available: true,
    alcoholic: p.alcoholic,
    minimumAge: p.minimumAge,
    tags: [...p.tags],
    sortOrder: p.sortOrder,
  };
}

test('los 52 sobreviven el viaje hasta la góndola y quedan comprables', () => {
  const catalogo = applyRetailCatalogModel(
    GONDOLA.map((p) => normalizeCatalogProduct(comoLaGuardaLaBase(p))).filter(Boolean),
  );
  for (const p of GONDOLA) {
    const enGondola = catalogo.find((c) => c.id === p.sku);
    assert.ok(enGondola, `${p.sku} no llegó al catálogo del cliente`);
    assert.ok(isProductVisibleToCustomer(enGondola), `${p.sku} no se muestra al cliente`);
    assert.ok(isProductOrderable(enGondola), `${p.sku} no se puede agregar al carrito`);
    assert.equal(enGondola.price, p.price, `${p.sku}: el precio cambió en el camino`);
  }
});

test('el pack se queda en góndola y no se convierte en una unidad sin precio', () => {
  // Es el defecto que cerró la migración 109: `units_per_pack > 1` significaba
  // «trae seis» y «no se vende» a la vez, así que la góndola escondía el pack y
  // publicaba en su lugar una unidad derivada SIN precio.
  const catalogo = applyRetailCatalogModel(
    GONDOLA.map((p) => normalizeCatalogProduct(comoLaGuardaLaBase(p))).filter(Boolean),
  );
  for (const pack of GONDOLA.filter((p) => p.soldAsPack)) {
    const enGondola = catalogo.find((c) => c.id === pack.sku);
    assert.ok(enGondola, `${pack.sku} desapareció de la góndola`);
    assert.notEqual(enGondola.procurementOnly, true, `${pack.sku} quedó marcado como abastecimiento`);
    assert.ok(isProductOrderable(enGondola), `${pack.sku} no se puede comprar`);
  }
  const sinPrecio = catalogo.filter((c) => c.pricePending === true);
  assert.deepEqual(sinPrecio.map((c) => c.id), [], 'quedaron unidades derivadas sin precio');
});

test('la categoría con alcohol le pone +18 a cada producto que lo lleva', () => {
  const catalogo = GONDOLA.map((p) => normalizeCatalogProduct(comoLaGuardaLaBase(p))).filter(Boolean);
  for (const p of GONDOLA) {
    const enGondola = catalogo.find((c) => c.id === p.sku);
    assert.equal(enGondola.alcoholic, p.alcoholic, p.sku);
    assert.equal(enGondola.minimumAge, p.alcoholic ? 18 : null, p.sku);
  }
});

// ── El lote SQL ──────────────────────────────────────────────────────────────

test('el lote es una sola transacción y no publica sin firma', () => {
  assert.throws(() => construirLote(GONDOLA, { verificadoPor: '', publicar: true }),
    /uuid de la persona/, 'publicó sin quien firme la verificación');
  assert.throws(() => construirLote(GONDOLA, { verificadoPor: 'no-es-un-uuid', publicar: true }),
    /uuid de la persona/);

  const lote = construirLote(GONDOLA, { verificadoPor: UUID_DE_PRUEBA, publicar: true });
  assert.equal((lote.match(/^begin;$/gm) || []).length, 1);
  assert.equal((lote.match(/^commit;$/gm) || []).length, 1);
  assert.doesNotMatch(lote, /^rollback;$/m);
  assert.match(lote, /on conflict \(business_id, external_id\) do update/);
  assert.match(lote, new RegExp(`verified_by[^\\n]*${UUID_DE_PRUEBA}`, 'i'));
});

test('sin publicar es sin publicar: ni verificado ni disponible', () => {
  const lote = construirLote(GONDOLA, { publicar: false });
  assert.match(lote, /NO PUBLICA/);
  assert.match(lote, /false, null, null,\s*\n?\s*false, now\(\)/);
});

test('LICENSE GATE · el alcohol entra catalogado y NO comprable por omisión', () => {
  // Verificar los datos maestros de un fernet y tener permiso municipal para
  // venderlo son dos cosas distintas. La primera la firma quien mira la ficha;
  // la segunda la otorga el municipio y no se puede suponer.
  const lote = construirLote(GONDOLA, { verificadoPor: UUID_DE_PRUEBA });
  assert.match(lote, /LICENSE GATE/);
  // `available` se resuelve por fila dentro del propio SQL, no viene aplicado.
  assert.match(lote, /^\s*not e\.is_alcoholic, now\(\)$/m);
  assert.doesNotMatch(lote, /^\s*true, now\(\)$/m);
});

test('habilitar el alcohol es una decisión explícita y queda escrita en el lote', () => {
  const lote = construirLote(GONDOLA, { verificadoPor: UUID_DE_PRUEBA, alcoholComprable: true });
  assert.match(lote, /ALCOHOL COMPRABLE/);
  assert.doesNotMatch(lote, /LICENSE GATE/);
  assert.match(lote, /^\s*true, now\(\)$/m);
});

test('los 23 con alcohol están declarados y son los que la compuerta frena', () => {
  const conAlcohol = GONDOLA.filter((p) => p.alcoholic);
  assert.equal(conAlcohol.length, 23);
  for (const p of conAlcohol) {
    assert.equal(p.minimumAge, 18, `${p.sku} sin edad mínima`);
    assert.ok(CATEGORIAS_CON_ALCOHOL.includes(p.category), `${p.sku} en una categoría sin alcohol`);
  }
  // Y ninguno sin alcohol se cuela en la compuerta.
  for (const p of GONDOLA.filter((x) => !x.alcoholic)) {
    assert.equal(p.minimumAge, null, `${p.sku} sin alcohol y con edad mínima`);
  }
});

test('el lote se planta si falta la migración de taxonomía', () => {
  const lote = construirLote(GONDOLA, { verificadoPor: UUID_DE_PRUEBA });
  assert.match(lote, /20260818040000/);
  assert.match(lote, /raise exception/);
});

test('el lote lleva las 52 filas y ninguna comilla suelta', () => {
  const lote = construirLote(GONDOLA, { verificadoPor: UUID_DE_PRUEBA });
  for (const p of GONDOLA) assert.ok(lote.includes(`'${p.sku}'`), `falta ${p.sku} en el lote`);
  // Cada apóstrofo de un dato —Gordon's— tiene que viajar duplicado, o el
  // literal se corta ahí y el resto de la fila se interpreta como SQL.
  assert.match(lote, /Gordon''s/);
  assert.equal((lote.match(/'/g) || []).length % 2, 0, 'quedó una comilla sin cerrar');
});

// ── La migración ─────────────────────────────────────────────────────────────

const migracion = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260818040000_gondola_beverage_taxonomy.sql'),
  'utf8',
);

test('la migración admite las trece categorías de la góndola', () => {
  for (const nombre of GONDOLA_CATEGORY_NAMES) {
    assert.match(migracion, new RegExp(`'${nombre}'`, 'u'), nombre);
  }
});

test('la migración conserva el vocabulario anterior', () => {
  for (const nombre of ['Promos', 'Jugos', 'Energéticas', 'Vinos y espumantes', 'Gins y vodkas', 'Whisky y destilados', 'Picadas y deli', 'Hielo y extras']) {
    assert.match(migracion, new RegExp(`'${nombre}'`, 'u'), nombre);
  }
});

test('la migración no toca ni una fila', () => {
  // Es una ampliación de vocabulario. Si despublicara o reescribiera algo, un
  // catálogo que hoy funciona dejaría de funcionar al aplicarla.
  assert.doesNotMatch(migracion, /^\s*update\s+public\./mi);
  assert.doesNotMatch(migracion, /^\s*insert\s+into\s+public\./mi);
  assert.doesNotMatch(migracion, /^\s*delete\s+from/mi);
});

test('la migración vuelve a declarar las dos restricciones que reemplaza', () => {
  assert.match(migracion, /products_verified_canonical_beverage_category/);
  assert.match(migracion, /products_verified_alcohol_coherence/);
  assert.equal((migracion.match(/add constraint products_verified_canonical_beverage_category/g) || []).length, 1);
  assert.equal((migracion.match(/add constraint products_verified_alcohol_coherence/g) || []).length, 1);
});

// ── La autoridad comercial de imagen ─────────────────────────────────────────

const autorizaciones = JSON.parse(
  fs.readFileSync(path.join(root, 'catalog/autorizaciones-comerciales.json'), 'utf8'),
);

test('la autorización comercial está registrada con su alcance y su procedencia', () => {
  const [autorizacion] = autorizaciones.autorizaciones;
  assert.ok(autorizacion, 'no hay ninguna autorización registrada');
  assert.match(autorizacion.id, /^TABA-AUT-\d{4}-\d{2}-\d{3}$/);
  assert.ok(autorizacion.declarada_por, 'una autorización sin quien la declare no es trazable');
  assert.ok(autorizacion.declarada_el, 'una autorización sin fecha no es trazable');
  assert.ok(autorizacion.canal, 'hace falta por qué canal llegó');
  assert.ok(autorizacion.cubre.length > 0 && autorizacion.no_cubre.length > 0,
    'el alcance se define tanto por lo que cubre como por lo que no');
  assert.ok(['PROPIO', 'LICENCIA_COMERCIAL', 'PERMISO_DOCUMENTADO'].includes(autorizacion.habilita_rights_status),
    'sólo puede habilitar uno de los tres estados que acepta catalog_assets_rights_valid');
});

test('la autorización no reetiqueta ningún asset por sí sola', () => {
  // El origen de un archivo es un hecho y no cambia porque aparezca un permiso
  // nuevo: una foto del CDN de una cadena minorista sigue siendo de esa cadena.
  const [autorizacion] = autorizaciones.autorizaciones;
  assert.match(autorizaciones.invariante, /no reetiqueta/i);

  // La lista arrancó vacía y creció el 2026-08-18 con los cuatro packs, que sí
  // vienen del embotellador. Lo que se comprueba no es que esté vacía —eso era
  // el estado de ese día, no una regla— sino la condición que la hace legítima:
  // cada SKU que la autorización dice cubrir tiene que existir en el manifiesto
  // del pipeline, con derechos publicables y citando este mismo id. Una lista
  // que crece sin respaldo es exactamente el reetiquetado que el invariante
  // prohíbe.
  const pipeline = JSON.parse(fs.readFileSync(path.join(root, 'docs/catalog/image-manifest.json'), 'utf8'));
  const porSku = new Map((pipeline.sources || []).map((fuente) => [fuente.sku, fuente]));
  for (const sku of autorizacion.assets_cubiertos) {
    const fuente = porSku.get(sku);
    assert.ok(fuente, `${sku} está declarado como cubierto y no tiene asset en el manifiesto`);
    assert.equal(fuente.rightsStatus, autorizacion.habilita_rights_status,
      `${sku} tiene que declarar el estado que esta autorización habilita`);
    assert.equal(fuente.rightsReference, autorizacion.id,
      `${sku} tiene que citar la autorización que lo cubre`);
    assert.equal(['marca', 'fabricante', 'propio'].includes(fuente.sourceType), true,
      `${sku} viene de ${fuente.sourceType}, y la autorización cubre marca, embotellador o importador`);
  }

  const manifiesto = JSON.parse(fs.readFileSync(path.join(root, 'catalog/image-manifest.json'), 'utf8'));
  const reetiquetados = (manifiesto.sources || []).filter(
    (fuente) => ['PROPIO', 'LICENCIA_COMERCIAL', 'PERMISO_DOCUMENTADO'].includes(fuente.rights_status),
  );
  assert.deepEqual(reetiquetados.map((f) => f.sku), [],
    'ninguna fuente heredada puede quedar marcada como publicable sin su evidencia');
});

test('ningún producto de la góndola sale con imagen: no hay asset que la autoridad cubra', () => {
  // La góndola se publica sin fotografías a propósito. El día que lleguen los
  // packshots de las marcas, cada uno entra por catalog_assets citando el id de
  // la autorización, y este test cambia junto con esa carga.
  for (const p of GONDOLA) {
    assert.equal(p.imageUrl, undefined, `${p.sku} declara una imagen y no hay ninguna autorizada`);
  }
});
