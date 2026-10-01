/*
 * El pulido del catálogo, como contrato.
 *
 * Cada caso de este archivo salió de MIRAR las 46 fichas reales en la tienda en
 * modo producción (2026-09-30) y es un defecto que ninguna prueba veía:
 * renglones de marca repetidos, nombres cortados, un control invisible, un
 * adorno que tartamudeaba el scroll. Lo que se puede afirmar sin navegador vive
 * acá; lo que hay que medir en pantalla, en tests/e2e/catalog-polish.spec.mjs.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { brandAddsToTitle, cardPresentationLine, cardTitle } from '../js/core/product-presentation.js';
import { resolveRuntimeConfig } from '../js/core/runtime-config.js';
import { homeNameNeedsTwoLines } from '../js/ui.js';
import { money } from '../js/state.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const snapshot = JSON.parse(read('tests/fixtures/catalog-cp-46.json'));
const productos = snapshot.products.map((row) => ({
  name: row.name,
  brand: row.brand,
  variant: row.variant,
  presentation: row.presentation,
  capacityValue: row.capacity_value,
  capacityUnit: row.capacity_unit,
  packagingType: row.packaging_type,
  unitsPerPack: row.units_per_pack,
}));
const porNombre = (nombre) => productos.find((producto) => producto.name === nombre);

// ─── Renglón de marca ─────────────────────────────────────────────────────────

test('el renglón de marca no repite una marca que el título ya dice', () => {
  assert.equal(brandAddsToTitle(porNombre('Fernet Branca 750 ml')), false, '«BRANCA» sobre «Fernet Branca»');
  assert.equal(brandAddsToTitle(porNombre('Hielo Cristal 4 kg')), false, '«CRISTAL» sobre «Hielo Cristal»');
  assert.equal(brandAddsToTitle(porNombre('Lay’s Clásicas 40 g')), false);
  assert.equal(brandAddsToTitle(porNombre('Coca-Cola Sabor Original 2,25 L')), false);
  // Con las 46 fichas reales ninguna tarjeta necesita el renglón: todas quedan del mismo alto.
  assert.deepEqual(productos.filter(brandAddsToTitle).map((producto) => producto.name), []);
});

test('la marca sigue apareciendo cuando NO está en el título, y no se confunde con un pedazo de palabra', () => {
  assert.equal(brandAddsToTitle({ name: 'Levité Pomelo 1,5 L', brand: 'Villa del Sur' }), true);
  assert.equal(brandAddsToTitle({ name: 'Brancamenta', brand: 'Branca' }), true, '«branca» dentro de otra palabra no cuenta');
  assert.equal(brandAddsToTitle({ name: 'Algo', brand: '' }), false);
  assert.equal(brandAddsToTitle({}), false);
});

// ─── Presentación ─────────────────────────────────────────────────────────────

test('un envase retornable se dice: cambia la compra', () => {
  const brahma = porNombre('Brahma Chopp Rubia 1 L');
  assert.equal(brahma.packagingType, 'Botella retornable');
  assert.equal(cardPresentationLine(brahma), '1 L · Retornable');
  // Si el nombre ya lo dice, no se repite.
  assert.equal(cardPresentationLine({ ...brahma, name: 'Brahma Chopp Rubia Retornable 1 L' }), '1 L');
  // Y una botella común sigue sin nombrarse.
  assert.equal(cardPresentationLine(porNombre('Coca-Cola Sabor Original 2,25 L')), '2,25 L');
});

// ─── Vidriera: nombres largos ─────────────────────────────────────────────────

test('en la vidriera, un nombre que no entra en un renglón comparte los dos con la presentación', () => {
  const largos = ['Coca-Cola Sin Azúcar', 'Brahma Chopp Rubia', 'Red Bull Energy Drink', 'Monster Mango Loco',
    'Stella Artois Rubia', 'Patagonia Lager del Sur', 'Glaciar Con Gas Baja en Sodio', 'Schweppes Pomelo Sin Azúcar'];
  for (const titulo of largos) assert.equal(homeNameNeedsTwoLines(titulo), true, `«${titulo}» se cortaba a una línea`);
  const cortos = ['Coca-Cola', 'Pepsi Black', 'Aperol', 'Fanta Naranja', 'Sprite Sin Azúcar', 'Heineken Lager', 'Corona Extra'];
  for (const titulo of cortos) assert.equal(homeNameNeedsTwoLines(titulo), false, `«${titulo}» entra en un renglón`);
  assert.equal(homeNameNeedsTwoLines(''), false);
});

test('ningún título real del catálogo queda sin clasificar', () => {
  const titulos = productos.map((producto) => cardTitle(producto));
  assert.equal(titulos.length, 46);
  for (const titulo of titulos) assert.equal(typeof homeNameNeedsTwoLines(titulo), 'boolean');
});

test('la hoja reserva el MISMO alto para el nombre largo que para nombre + presentación', () => {
  const css = read('styles/brand-home.css');
  const bloque = /@media \(max-width: 479px\) \{\s*body\[data-active-view="home"\] \.home-best-copy \.home-best-name \{([^}]+)\}/.exec(css);
  assert.ok(bloque, 'falta la regla del nombre largo');
  assert.match(bloque[1], /height: 33\.6px;/, 'el bloque tiene que medir 18 + 15,6 px: si cambia, se mueve el pliegue');
  assert.match(bloque[1], /-webkit-line-clamp: 2;/);
});

test('el título de la tarjeta del catálogo reserva dos renglones y permite tres', () => {
  const css = read('styles/brand-home.css');
  const regla = /\.app-view\[data-view="catalog"\] \.product-body h3 \{([^}]+)\}/.exec(css);
  assert.ok(regla);
  assert.match(regla[1], /min-height: 2\.35em;/);
  assert.match(regla[1], /-webkit-line-clamp: 3;/, 'con dos, «Schweppes Pomelo Sin Azúcar» se cortaba a 390 px');
});

// ─── Orden ────────────────────────────────────────────────────────────────────

test('a igual puntaje, la grilla desempata por el orden comercial de los rubros', () => {
  const ui = read('js/ui.js');
  assert.match(ui, /const CATEGORY_RANK = new Map\(STORE_CATEGORY_ORDER\.map\(\(id, index\) => \[id, index\]\)\);/);
  assert.match(ui, /score\(b\) - score\(a\) \|\| categoryRank\(a\) - categoryRank\(b\)/);
  // «Menor precio» no desempata por rubro: ahí manda el precio.
  assert.match(ui, /if \(sortBy === 'price_asc'\) return arr\.sort\(comparePricedAscending\);/);
});

// ─── El corazón de favoritos ──────────────────────────────────────────────────

test('el ícono de favoritos del catálogo no hereda la tinta clara de la góndola', () => {
  const css = read('styles/brand-home.css');
  const reposo = /\.app-view\[data-view="catalog"\] \.product-favorite \{\s*color: (#[0-9a-f]{6});\s*\}/.exec(css);
  assert.ok(reposo, 'el corazón volvió a pedir un token que en el alcance del cliente es claro');
  assert.equal(reposo[1], '#14161a');
  assert.match(css, /\.app-view\[data-view="catalog"\] \.product-favorite\.is-favorite \{\s*color: var\(--taba-red\);/);
});

// ─── Performance ──────────────────────────────────────────────────────────────

test('el brillo de la góndola no escribe mientras se scrollea', () => {
  const motion = read('js/motion.js');
  const setScrolled = motion.slice(motion.indexOf('const setScrolled = '), motion.indexOf('const onScroll = '));
  assert.match(setScrolled, /settleShelfGlow\(\);/);
  assert.doesNotMatch(setScrolled, /[^e]applyShelfGlow\(\)/, 'el scroll volvió a escribir el brillo en cada cuadro');
  assert.match(motion, /const GLOW_STEPS = 1;/, 'dos niveles: encendido o apagado');
  assert.match(motion, /glow >= GLOW_ON_AT \? 1 : glow <= GLOW_OFF_AT \? 0 : \(previous \?\? 0\)/, 'falta la histéresis');
  assert.match(setScrolled, /if \(documentRef\.body\.dataset\.motionScrolled !== scrolled\)/, 'el atributo se reescribía en cada cuadro');
});

test('la recolección de movimiento no reescribe lo que ya está escrito', () => {
  const motion = read('js/motion.js');
  assert.ok(
    motion.includes("if (node.dataset.motionReveal !== 'card') node.dataset.motionReveal = 'card';"),
    'la marca de entrada se reescribe en cada render',
  );
  assert.ok(
    motion.includes("if (node.style.getPropertyValue('--motion-index') !== order) node.style.setProperty('--motion-index', order);"),
    'el índice de entrada se reescribe en cada render',
  );
  assert.ok(
    motion.includes("if (!node.classList.contains('is-motion-visible')) node.classList.add('is-motion-visible');"),
    'la clase de entrada se reescribe en cada render',
  );
});

test('una tarjeta pide la miniatura en el teléfono; la ficha sigue pidiendo el master', () => {
  const ui = read('js/ui.js');
  assert.match(ui, /const CARD_IMAGE_SIZES = '\(max-width: 700px\) 130px, 260px';/);
  // 130 px × densidad 3 = 390 ≤ 400: gana la miniatura de 400w.
  assert.ok(130 * 3 <= 400);
  assert.doesNotMatch(ui, /\) 4[45]vw, 260px/, 'un `sizes` en vw hace que un teléfono @3x baje el master de cada tarjeta');
  assert.match(ui, /variant === 'modal' \? '\(max-width: 700px\) 92vw, 560px' : CARD_IMAGE_SIZES/);
});

test('el formateador de moneda se reutiliza y sigue dando el mismo texto', () => {
  const original = Intl.NumberFormat;
  let construidos = 0;
  // eslint-disable-next-line no-global-assign
  Intl.NumberFormat = function contador(...args) { construidos += 1; return new original(...args); };
  try {
    const primero = money(1234567);
    for (let i = 0; i < 50; i += 1) money(i * 100);
    assert.ok(construidos <= 1, `se construyeron ${construidos} formateadores para 51 precios`);
    assert.match(primero, /1\.234\.567/);
  } finally {
    Intl.NumberFormat = original;
  }
  assert.match(money(0), /0/);
  assert.equal(money(2500), money('2500'));
});

test('la configuración de despliegue se resuelve una vez por contenido, no por llamada', () => {
  const fuente = { mode: 'production', repository: {
    provider: 'supabase', supabaseUrl: 'https://taba-test.supabase.co', publishableKey: 'sb_publishable_test_key',
    businessId: '00000000-0000-4000-8000-000000000001', pollMs: 5000,
  } };
  const a = resolveRuntimeConfig(fuente);
  assert.equal(resolveRuntimeConfig(fuente), a, 'la misma configuración se volvió a validar');
  assert.equal(resolveRuntimeConfig(structuredClone(fuente)), a, 'un objeto distinto con el mismo contenido es la misma configuración');
  // Una mutación EN EL LUGAR —que es lo que hacen las pruebas— no puede devolver lo viejo.
  fuente.repository.supabaseUrl = 'https://otro-proyecto.supabase.co';
  const b = resolveRuntimeConfig(fuente);
  assert.notEqual(b, a);
  assert.equal(b.repository?.supabaseUrl, 'https://otro-proyecto.supabase.co');
  assert.equal(resolveRuntimeConfig(null).status, 'absent');
  assert.equal(resolveRuntimeConfig(undefined), resolveRuntimeConfig(null));
});
