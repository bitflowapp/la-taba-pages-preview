import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

import {
  TABA_MAP_BACKGROUND,
  TABA_MAP_LABEL_HALO,
  applyTabaMapTheme,
  isExcludedLayer,
  tabaMapPaintOverrides,
} from '../js/map/taba_map_theme.js';

// Volcado real del estilo Positron de OpenFreeMap (2026-08): el tema se
// verifica contra las 55 capas reales, no contra una maqueta.
const positron = JSON.parse(fs.readFileSync(
  new URL('./fixtures/openfreemap-positron-style.json', import.meta.url),
  'utf8',
));

/* WCAG relative luminance → ratio de contraste. */
function contrastRatio(hexA, hexB) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (hex) => {
    const raw = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16));
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const [light, dark] = [luminance(hexA), luminance(hexB)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

test('el tema cubre todas las capas del Positron real salvo los escudos de ruta', () => {
  const overrides = tabaMapPaintOverrides(positron.layers);
  const themedIds = new Set(overrides.map((entry) => entry.layerId));
  for (const layer of positron.layers) {
    if (isExcludedLayer(layer.id)) {
      assert.ok(!themedIds.has(layer.id), `el escudo ${layer.id} no debe teñirse`);
    } else {
      assert.ok(themedIds.has(layer.id), `la capa ${layer.id} quedó sin tema`);
    }
  }
});

test('los escudos de ruta quedan intactos: su texto vive sobre la chapa clara del sprite', () => {
  assert.equal(isExcludedLayer('highway-shield-non-us'), true);
  assert.equal(isExcludedLayer('highway-shield-us-interstate'), true);
  assert.equal(isExcludedLayer('road_shield_us'), true);
  assert.equal(isExcludedLayer('label_city'), false);
});

test('no se sacrifica legibilidad por oscurecer: cada texto rinde AA sobre el fondo', () => {
  // 4,5:1 es el AA de texto normal; los nombres del mapa son chicos, así que el
  // umbral no se relaja a "texto grande".
  const overrides = tabaMapPaintOverrides(positron.layers);
  const textColors = overrides.filter((entry) => entry.property === 'text-color');
  assert.ok(textColors.length >= 15, 'hay overrides de texto');
  for (const { layerId, value } of textColors) {
    const ratio = contrastRatio(value, TABA_MAP_BACKGROUND);
    assert.ok(ratio >= 4.5, `${layerId}: ${value} da ${ratio.toFixed(2)}:1 sobre el fondo`);
  }
});

test('todo texto lleva halo grafito que lo despega de la trama', () => {
  const overrides = tabaMapPaintOverrides(positron.layers);
  const withText = new Set(overrides.filter((e) => e.property === 'text-color').map((e) => e.layerId));
  const withHalo = new Set(overrides.filter((e) => e.property === 'text-halo-color').map((e) => e.layerId));
  for (const layerId of withText) {
    assert.ok(withHalo.has(layerId), `${layerId} sin halo`);
  }
  for (const { value } of overrides.filter((e) => e.property === 'text-halo-color')) {
    assert.equal(value, TABA_MAP_LABEL_HALO);
  }
});

test('la jerarquía vial se lee por luminancia: menor < avenida < autopista', () => {
  const overrides = tabaMapPaintOverrides(positron.layers);
  const lineColor = (id) => overrides.find((e) => e.layerId === id && e.property === 'line-color')?.value;
  const luminance = (hex) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
  const minor = luminance(lineColor('highway_minor'));
  const major = luminance(lineColor('highway_major_inner'));
  const motorway = luminance(lineColor('highway_motorway_inner'));
  assert.ok(minor < major, 'la avenida es más clara que la calle');
  assert.ok(major < motorway, 'la autopista es más clara que la avenida');
  // Y el casing es más oscuro que el propio fondo: separa sin iluminar.
  const casing = luminance(lineColor('highway_major_casing'));
  const background = luminance(TABA_MAP_BACKGROUND);
  assert.ok(casing < background, 'el casing se hunde respecto del fondo');
});

test('el único dorado del lienzo son los nombres de avenidas, y también rinde AA', () => {
  const overrides = tabaMapPaintOverrides(positron.layers);
  const golden = overrides.filter((entry) => (
    entry.property === 'text-color' && /^#c9a/.test(String(entry.value))
  ));
  assert.equal(golden.length, 1);
  assert.equal(golden[0].layerId, 'highway-name-major');
  assert.ok(contrastRatio(golden[0].value, TABA_MAP_BACKGROUND) >= 4.5);
});

test('el fondo del mapa es el mismo negro del shell: el mapa se funde, no flota', () => {
  const overrides = tabaMapPaintOverrides(positron.layers);
  const background = overrides.find((entry) => entry.layerId === 'background');
  assert.deepEqual(background, {
    layerId: 'background',
    property: 'background-color',
    value: TABA_MAP_BACKGROUND,
  });
  // #14161a es --taba-ink en styles/tokens.css; si la marca cambia el negro,
  // este test avisa que el mapa quedó desalineado.
  const tokens = fs.readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');
  assert.match(tokens, /--taba-ink:\s*#14161a\b/);
});

test('una capa desconocida cae al tema por familia y una familia desconocida queda intacta', () => {
  const overrides = tabaMapPaintOverrides([
    { id: 'nueva_calle', type: 'line', 'source-layer': 'transportation' },
    { id: 'nuevo_poi', type: 'symbol', 'source-layer': 'poi' },
    { id: 'rareza', type: 'fill-extrusion', 'source-layer': '3d' },
  ]);
  assert.ok(overrides.some((e) => e.layerId === 'nueva_calle' && e.property === 'line-color'));
  assert.ok(overrides.some((e) => e.layerId === 'nuevo_poi' && e.property === 'text-color'));
  assert.ok(!overrides.some((e) => e.layerId === 'rareza'), 'sin regla no se inventa pintura');
});

test('applyTabaMapTheme aplica sobre el mapa y una capa que falla no arrastra al resto', () => {
  const applied = [];
  const map = {
    getStyle: () => ({ layers: positron.layers }),
    setPaintProperty: (id, property, value) => {
      if (id === 'water') throw new Error('capa caprichosa');
      applied.push({ id, property, value });
    },
  };
  const count = applyTabaMapTheme(map);
  // 55 capas del Positron real → 69 overrides (los symbol llevan color + halo),
  // menos el que la capa caprichosa rechaza.
  assert.ok(count >= 60, `aplicó ${count} overrides`);
  assert.ok(!applied.some((entry) => entry.id === 'water'));
  assert.ok(applied.some((entry) => entry.id === 'background'));
  // Un mapa sin API no rompe: devuelve 0.
  assert.equal(applyTabaMapTheme(null), 0);
  assert.equal(applyTabaMapTheme({}), 0);
});
