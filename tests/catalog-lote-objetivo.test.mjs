/*
 * Qué productos puede tocar el lote de asociación.
 *
 * Este archivo existe por un fallo real: la comprobación elegía los productos
 * por la PROPIEDAD «sold_as_pack = true» y exigía que fueran exactamente 4. Eso
 * era cierto mirando el catálogo con la clave publicable, que no ve los
 * alcohólicos, y se rompió con una sesión de owner, que ve el quinto pack
 * legítimo (`quilmes-clasica-lata-473ml-pack-6`).
 *
 * La prueba que faltaba no era «cuento 4»: era «un pack ajeno aparece y no pasa
 * nada». Está abajo.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  disponibilidadTrasPublicar,
  fueraDelLote,
  OBJETIVOS,
  SKUS_OBJETIVO,
  validarLoteObjetivo,
} from '../scripts/catalog-images/lote-objetivo.mjs';

/** Un producto de producción con la forma que devuelve PostgREST. */
function producto(sku, extra = {}) {
  const esperado = OBJETIVOS.get(sku);
  return {
    available: true,
    catalog_asset_id: null,
    image_url: null,
    is_active: true,
    is_verified: true,
    sku,
    sold_as_pack: esperado ? esperado.unitsPerPack > 1 : true,
    stock: 8,
    units_per_pack: esperado ? esperado.unitsPerPack : 1,
    ...extra,
  };
}

const EL_LOTE = () => SKUS_OBJETIVO.map((sku) => producto(sku));
const ASSETS_DE = (skus) => skus.map((sku) => ({ sku }));

test('los objetivos del lote, tal como están en producción → PASA', () => {
  const { ok, errores, seleccionados } = validarLoteObjetivo({
    assets: ASSETS_DE(SKUS_OBJETIVO),
    productos: EL_LOTE(),
  });
  assert.deepEqual(errores, []);
  assert.equal(ok, true);
  assert.equal(seleccionados.length, SKUS_OBJETIVO.length);
});

test('CONTROL NEGATIVO: falta uno del lote → FALLA', () => {
  const productos = EL_LOTE().filter((p) => p.sku !== 'sprite-botella-pet-500-ml-pack-x12');
  const { ok, errores } = validarLoteObjetivo({ assets: ASSETS_DE(SKUS_OBJETIVO), productos });
  assert.equal(ok, false);
  assert.match(errores.join(' '), /falta el producto objetivo sprite-botella-pet-500-ml-pack-x12/);
});

test('CONTROL NEGATIVO: un pack que pasa a venderse por unidad → FALLA', () => {
  const productos = EL_LOTE();
  const pack = productos.find((p) => p.units_per_pack > 1);
  pack.sold_as_pack = false;
  const { ok, errores } = validarLoteObjetivo({ assets: ASSETS_DE(SKUS_OBJETIVO), productos });
  assert.equal(ok, false);
  assert.match(errores.join(' '), /se vende por unidad y su fotografía es de un pack/);
});

test('CONTROL NEGATIVO: una unidad que pasa a venderse como pack → FALLA', () => {
  // El eje que importa no es «ser pack»: es que la cantidad que se vende sea la
  // que la fotografía anuncia. Una botella sola en la foto y un pack en la
  // góndola le miente al cliente igual que al revés.
  const productos = EL_LOTE();
  const unidad = productos.find((p) => p.units_per_pack === 1);
  unidad.sold_as_pack = true;
  const { ok, errores } = validarLoteObjetivo({ assets: ASSETS_DE(SKUS_OBJETIVO), productos });
  assert.equal(ok, false);
  assert.match(errores.join(' '), /se vende como pack y su fotografía es de una unidad suelta/);
});

test('CONTROL NEGATIVO: units_per_pack distinto → FALLA, y dice por qué importa', () => {
  const productos = EL_LOTE();
  productos[0].units_per_pack = 6; // el packshot anuncia x12
  const { ok, errores } = validarLoteObjetivo({ assets: ASSETS_DE(SKUS_OBJETIVO), productos });
  assert.equal(ok, false);
  assert.match(errores.join(' '), /trae 6 unidades y el packshot anuncia 12/);
  assert.match(errores.join(' '), /la foto pasaría a mentir/);
});

test('un quinto pack legítimo que NO es objetivo → PASA y queda afuera', () => {
  // Éste es el caso que rompió el guion: el pack de Quilmes existe, es un pack
  // de verdad, y no tiene nada que ver con estas cuatro fotografías.
  const quinto = {
    available: false,
    catalog_asset_id: null,
    image_url: null,
    is_active: true,
    is_verified: true,
    sku: 'quilmes-clasica-lata-473ml-pack-6',
    sold_as_pack: true,
    stock: 4,
    units_per_pack: 6,
  };
  const productos = [...EL_LOTE(), quinto];

  const { ok, errores, seleccionados } = validarLoteObjetivo({
    assets: ASSETS_DE(SKUS_OBJETIVO),
    productos,
  });
  assert.equal(ok, true, errores.join(' | '));
  assert.equal(seleccionados.length, SKUS_OBJETIVO.length, 'el ajeno no entra al lote');
  assert.equal(seleccionados.some((p) => p.sku === quinto.sku), false);

  const ajenos = fueraDelLote(productos);
  assert.deepEqual(ajenos.map((p) => p.sku), [quinto.sku], 'y queda listado como ajeno, para poder demostrar que no se movió');
});

test('doscientos packs ajenos tampoco molestan', () => {
  const muchos = Array.from({ length: 200 }, (_, i) => ({
    sku: `pack-ajeno-${i}`,
    sold_as_pack: true,
    units_per_pack: 6,
  }));
  const { ok, seleccionados } = validarLoteObjetivo({
    assets: ASSETS_DE(SKUS_OBJETIVO),
    productos: [...EL_LOTE(), ...muchos],
  });
  assert.equal(ok, true, 'el conjunto se elige por lista, no por propiedad');
  assert.equal(seleccionados.length, SKUS_OBJETIVO.length);
});

test('CONTROL NEGATIVO: el lote intenta incluir un SKU extra → FALLA', () => {
  const { ok, errores } = validarLoteObjetivo({
    assets: ASSETS_DE([...SKUS_OBJETIVO, 'quilmes-clasica-lata-473ml-pack-6']),
    productos: EL_LOTE(),
  });
  assert.equal(ok, false);
  assert.match(errores.join(' '), /incluye un SKU que no es objetivo: quilmes-clasica-lata-473ml-pack-6/);
});

test('CONTROL NEGATIVO: el lote deja afuera un objetivo → FALLA', () => {
  const { ok, errores } = validarLoteObjetivo({
    assets: ASSETS_DE(SKUS_OBJETIVO.slice(0, 3)),
    productos: EL_LOTE(),
  });
  assert.equal(ok, false);
  assert.match(errores.join(' '), /no incluye el objetivo/);
});

test('CONTROL NEGATIVO: el lote nombra un objetivo dos veces → FALLA', () => {
  const { ok, errores } = validarLoteObjetivo({
    assets: ASSETS_DE([...SKUS_OBJETIVO, SKUS_OBJETIVO[0]]),
    productos: EL_LOTE(),
  });
  assert.equal(ok, false);
  assert.match(errores.join(' '), /más de una vez/);
});

test('CONTROL NEGATIVO: catálogo vacío → FALLA con todos los faltantes', () => {
  const { ok, errores } = validarLoteObjetivo({ assets: [], productos: [] });
  assert.equal(ok, false);
  assert.equal(errores.filter((e) => /falta el producto objetivo/.test(e)).length, SKUS_OBJETIVO.length);
});

test('los objetivos y sus cantidades son los del manifiesto de imágenes', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const manifiesto = JSON.parse(readFileSync(path.join(root, 'docs/catalog/image-manifest.json'), 'utf8'));
  assert.deepEqual(
    manifiesto.sources.map((f) => f.sku).sort(),
    [...SKUS_OBJETIVO].sort(),
    'el manifiesto y la lista de objetivos tienen que nombrar los mismos SKU',
  );
});

/*
 * LA DISPONIBILIDAD DESPUÉS DE REPUBLICAR.
 *
 * Este bloque existe por un fallo que no llegó a producción de milagro: el
 * aplicador le pasaba `p_available: true` a `publish_catalog_product` para los
 * diecinueve productos del lote. El pack x6 de Fanta está fuera de la góndola
 * por una decisión comercial del 2026-08-22, así que asociarle su fotografía
 * lo habría puesto de nuevo a la venta sin que nadie lo pidiera.
 */
test('un producto a la venta sigue a la venta', () => {
  assert.equal(disponibilidadTrasPublicar({ available: true, is_verified: true }), true);
});

test('un producto que alguien sacó de la góndola NO vuelve a la venta', () => {
  // Fuera de venta y VERIFICADO: es una decisión, no un accidente. Es el
  // estado exacto de fanta-naranja-botella-pet-1500-ml-pack-x6 en producción.
  assert.equal(disponibilidadTrasPublicar({ available: false, is_verified: true }), false);
});

test('un producto que una corrida cortada dejó a medias SÍ vuelve a la venta', () => {
  // Fuera de venta y SIN verificar: las dos cosas juntas las hace el
  // disparador, y volver a publicarlo es justamente la reparación.
  assert.equal(disponibilidadTrasPublicar({ available: false, is_verified: false }), true);
});

test('la regla no inventa disponibilidad cuando el dato no está', () => {
  // Sin `is_verified` no hay forma de distinguir la decisión del accidente.
  // Se elige el lado que no deja un producto fuera de venta por omisión.
  assert.equal(disponibilidadTrasPublicar({ available: false }), true);
  assert.equal(disponibilidadTrasPublicar({}), true);
});
