import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function extractHoverCoarseMediaBlock(content) {
  const mediaStart = content.indexOf('@media (hover: none), (pointer: coarse)');
  assert.notEqual(mediaStart, -1, 'missing hover/pointer media query');
  let depth = 0;
  let end = -1;
  for (let index = mediaStart; index < content.length; index += 1) {
    const char = content[index];
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  assert.notEqual(end, -1, 'could not close hover/pointer media query block');
  return content.slice(mediaStart, end + 1);
}

test('bloque táctil no incluye la superficie de mapa de MapLibre', () => {
  const source = read('styles.css');
  const block = extractHoverCoarseMediaBlock(source);
  const normalized = block.replace(/\s+/g, ' ');

  assert.ok(normalized.includes('button'), 'button');
  assert.ok(normalized.includes('a,'), 'a');
  assert.ok(normalized.includes('[role="button"]'), '[role="button"]');
  assert.ok(normalized.includes('[data-nav-view]'), '[data-nav-view]');
  assert.ok(normalized.includes('[data-cart-inc]'), '[data-cart-inc]');
  assert.ok(normalized.includes('[data-cart-dec]'), '[data-cart-dec]');
  assert.ok(normalized.includes('[data-cart-remove]'), '[data-cart-remove]');
  assert.ok(normalized.includes('[data-floating-cart]'), '[data-floating-cart]');
  assert.ok(normalized.includes('.product-card'), '.product-card');
  assert.ok(normalized.includes('.recommendation-card'), '.recommendation-card');
  assert.ok(normalized.includes('.quantity-control'), '.quantity-control');
  assert.ok(normalized.includes('.mobile-nav'), '.mobile-nav');
  assert.ok(normalized.includes('.tracking-menu-button'), '.tracking-menu-button');
  assert.ok(normalized.includes('.tracking-map-recenter'), '.tracking-map-recenter');
  assert.ok(normalized.includes('.product-favorite'), '.product-favorite');
  assert.ok(normalized.includes('.home-favorite-button'), '.home-favorite-button');

  assert.ok(!normalized.includes('.real-map-shell'), 'real map shell excluded');
  assert.ok(!normalized.includes('.real-map-canvas'), 'real map canvas excluded');
  assert.ok(!normalized.includes('.maplibregl-map'), 'maplibre map excluded');
  assert.ok(!normalized.includes('.maplibregl-canvas'), 'maplibre canvas excluded');
});

test('no hay listeners globales de touchstart/touchend con preventDefault en js', () => {
  const files = [];
  const collectJs = (baseDir) => {
    for (const entry of fs.readdirSync(path.join(baseDir), { withFileTypes: true })) {
      const next = path.join(baseDir, entry.name);
      if (entry.isDirectory()) collectJs(next);
      else if (entry.isFile() && next.endsWith('.js')) files.push(next);
    }
  };
  collectJs(path.join(root, 'js'));

  const dangerousPattern = /addEventListener\(\s*['"]touch(?:start|end)['"][\s\S]{0,120}?preventDefault/;
  const offenders = files
    .map((file) => {
      const source = fs.readFileSync(file, 'utf8');
      const match = source.match(dangerousPattern);
      return match ? path.relative(root, file) : null;
    })
    .filter(Boolean);
  assert.deepEqual(offenders, []);
});
