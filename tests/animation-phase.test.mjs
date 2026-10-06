import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { lockAmbientAnimationPhase } from '../js/map/animation_phase.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function animation({ iterations = Infinity, playState = 'running', startTime = 4_812 } = {}) {
  return { playState, startTime, effect: { getTiming: () => ({ iterations }) } };
}

test('el latido infinito queda anclado al reloj de la página', () => {
  const pulso = animation();
  const puntoEnVivo = animation({ startTime: null });
  const scope = { getAnimations: ({ subtree }) => (subtree ? [pulso, puntoEnVivo] : []) };
  assert.equal(lockAmbientAnimationPhase(scope), 2);
  assert.equal(pulso.startTime, 0);
  assert.equal(puntoEnVivo.startTime, 0);
  // Ya anclado: la segunda pasada no lo vuelve a tocar.
  assert.equal(lockAmbientAnimationPhase(scope), 0);
});

test('una animación de una vuelta, una pausada o una cancelada no se toca', () => {
  const entrada = animation({ iterations: 1 });
  const pausada = animation({ playState: 'paused' });
  const cancelada = animation({ playState: 'idle' });
  const scope = { getAnimations: () => [entrada, pausada, cancelada] };
  assert.equal(lockAmbientAnimationPhase(scope), 0);
  assert.equal(entrada.startTime, 4_812);
  assert.equal(pausada.startTime, 4_812);
  assert.equal(cancelada.startTime, 4_812);
});

test('sin API de animaciones —o con una que falla— no rompe el redibujo', () => {
  assert.equal(lockAmbientAnimationPhase(null), 0);
  assert.equal(lockAmbientAnimationPhase({}), 0);
  assert.equal(lockAmbientAnimationPhase({ getAnimations() { throw new Error('sin timeline'); } }), 0);
  const rebelde = animation();
  Object.defineProperty(rebelde, 'startTime', { get: () => 9, set() { throw new Error('inactiva'); } });
  assert.equal(lockAmbientAnimationPhase({ getAnimations: () => [rebelde] }), 0);
});

test('el redibujo estable y el mapa anclan la fase; el SW la tiene offline', () => {
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  assert.match(ui, /replacement\.replaceWith\(shell\);\s*(?:\/\/[^\n]*\n\s*)*lockAmbientAnimationPhase\(shell\);/);
  const mapa = fs.readFileSync(path.join(root, 'js/map/maplibre_tracking_map.js'), 'utf8');
  assert.equal((mapa.match(/lockAmbientAnimationPhase\(state\.shell\)/g) || []).length, 3);
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.match(sw, /'\.\/js\/map\/animation_phase\.js'/);
});
