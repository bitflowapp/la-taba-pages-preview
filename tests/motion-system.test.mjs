import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { getMotionDiagnostics, initMotion, isMotionReduced } from '../js/motion.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const tokens = fs.readFileSync(path.join(ROOT, 'styles/tokens.css'), 'utf8');
const motion = fs.readFileSync(path.join(ROOT, 'styles/motion.css'), 'utf8');

test('motion tokens are centralized and stay within commercial timing budgets', () => {
  for (const token of [
    '--motion-duration-instant',
    '--motion-duration-fast',
    '--motion-duration-base',
    '--motion-duration-slow',
    '--motion-ease-standard',
    '--motion-ease-enter',
    '--motion-ease-exit',
    '--motion-ease-emphasized',
  ]) assert.match(tokens, new RegExp(`${token}\\s*:`), token);
  assert.match(tokens, /--motion-duration-modal:\s*360ms/);
  assert.doesNotMatch(motion, /animation-duration:\s*(?:[5-9]\d{2}|\d{4,})ms/);
});

test('reduced motion removes movement while retaining visible state feedback', () => {
  assert.match(motion, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(motion, /\.motion-ready \[data-motion-reveal\]\.is-motion-visible[\s\S]*?opacity:\s*1/);
  assert.match(motion, /\.motion-skeleton[\s\S]*?background:\s*var\(--taba-subtle\)/);
  assert.match(motion, /animation:\s*none\s*!important/);
});

test('motion controller is safe without a browser DOM and exposes diagnostics', () => {
  const controller = initMotion(undefined, undefined);
  assert.equal(controller.getDiagnostics().active, false);
  assert.equal(getMotionDiagnostics().active, false);
  assert.equal(isMotionReduced(undefined), false);
  controller.destroy();
});

test('one shared observer and cleanup API are present for dynamic renders', () => {
  assert.match(fs.readFileSync(path.join(ROOT, 'js/motion.js'), 'utf8'), /new windowRef\.IntersectionObserver/);
  assert.match(fs.readFileSync(path.join(ROOT, 'js/motion.js'), 'utf8'), /new windowRef\.MutationObserver/);
  assert.match(fs.readFileSync(path.join(ROOT, 'js/motion.js'), 'utf8'), /observer\?\.disconnect/);
  assert.match(fs.readFileSync(path.join(ROOT, 'js/motion.js'), 'utf8'), /mutationObserver\?\.disconnect/);
});

test('only the loading skeleton is allowed an infinite visual loop', () => {
  const infiniteMatches = motion.match(/animation:[^;]*infinite/g) || [];
  // El único otro loop es el spinner acotado al estado real de envío del checkout.
  assert.equal(infiniteMatches.length, 2);
  assert.match(motion, /\.motion-skeleton[\s\S]*?animation:[^;]*infinite/);
  assert.match(motion, /\[data-motion-busy\][\s\S]*?animation:[^;]*infinite/);
});
