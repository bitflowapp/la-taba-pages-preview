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
    sold_as_pack: true,
    stock: 8,
    units_per_pack: esperado ? esperado.unitsPerPack : 1,
    ...extra,
  };
}

const LOS_CUATRO = () => SKUS_OBJETIVO.map((sku) => producto(sku));
const ASSETS_DE = (skus) => skus.map((sku) => ({ sku }));

test('los 4 objetivos, tal como están en producción → PASA', () => {
  const { ok, errores, seleccionados } = validarLoteObjetivo({
    assets: ASSETS_DE(SKUS_OBJETIVO),
    productos: LOS_CUATRO(),
  });
  assert.deepEqual(errores, []);
  assert.equal(ok, true);
  assert.equal(seleccionados.length, 4);
});

test('CONTROL NEGATIVO: falta uno de los 4 → FALLA', () => {
  const productos = LOS_CUATRO().filter((p) => p.sku !== 'sprite-botella-pet-500-ml-pack-x12');
  const { ok, errores } = validarLoteObjetivo({ assets: ASSETS_DE(SKUS_OBJETIVO), productos });
  assert.equal(ok, false);
  assert.match(errores.join(' '), /falta el producto objetivo sprite-botella-pet-500-ml-pack-x12/);
});

test('CONTROL NEGATIVO: uno dejó de ser sold_as_pack → FALLA', () => {
  const productos = LOS_CUATRO();
  productos[0].sold_as_pack = false;
  const { ok, errores } = validarLoteObjetivo({ assets: ASSETS_DE(SKUS_OBJETIVO), productos });
  assert.equal(ok, false);
  assert.match(errores.join(' '), /dejó de venderse como pack/);
});

test('CONTROL NEGATIVO: units_per_pack distinto → FALLA, y dice por qué importa', () => {
  const productos = LOS_CUATRO();
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
  const productos = [...LOS_CUATRO(), quinto];

  const { ok, errores, seleccionados } = validarLoteObjetivo({
    assets: ASSETS_DE(SKUS_OBJETIVO),
    productos,
  });
  assert.equal(ok, true, errores.join(' | '));
  assert.equal(seleccionados.length, 4, 'el quinto no entra al lote');
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
    productos: [...LOS_CUATRO(), ...muchos],
  });
  assert.equal(ok, true, 'el conjunto se elige por lista, no por propiedad');
  assert.equal(seleccionados.length, 4);
});

test('CONTROL NEGATIVO: el lote intenta incluir un SKU extra → FALLA', () => {
  const { ok, errores } = validarLoteObjetivo({
    assets: ASSETS_DE([...SKUS_OBJETIVO, 'quilmes-clasica-lata-473ml-pack-6']),
    productos: LOS_CUATRO(),
  });
  assert.equal(ok, false);
  assert.match(errores.join(' '), /incluye un SKU que no es objetivo: quilmes-clasica-lata-473ml-pack-6/);
});

test('CONTROL NEGATIVO: el lote deja afuera un objetivo → FALLA', () => {
  const { ok, errores } = validarLoteObjetivo({
    assets: ASSETS_DE(SKUS_OBJETIVO.slice(0, 3)),
    productos: LOS_CUATRO(),
  });
  assert.equal(ok, false);
  assert.match(errores.join(' '), /no incluye el objetivo/);
});

test('CONTROL NEGATIVO: el lote nombra un objetivo dos veces → FALLA', () => {
  const { ok, errores } = validarLoteObjetivo({
    assets: ASSETS_DE([...SKUS_OBJETIVO, SKUS_OBJETIVO[0]]),
    productos: LOS_CUATRO(),
  });
  assert.equal(ok, false);
  assert.match(errores.join(' '), /más de una vez/);
});

test('CONTROL NEGATIVO: catálogo vacío → FALLA con los 4 faltantes', () => {
  const { ok, errores } = validarLoteObjetivo({ assets: [], productos: [] });
  assert.equal(ok, false);
  assert.equal(errores.filter((e) => /falta el producto objetivo/.test(e)).length, 4);
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
