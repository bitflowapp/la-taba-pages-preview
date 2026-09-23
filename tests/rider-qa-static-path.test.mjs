import assert from 'node:assert/strict';
import test from 'node:test';
import { riderQaStaticPath } from '../scripts/e2e-staging/rider-qa-static-path.mjs';

test('QA server serves every imported stylesheet and app asset', () => {
  for (const path of ['/', '/styles.css', '/styles/tracking.css',
    '/styles/responsive.css', '/js/app.js', '/assets/icon.svg']) {
    assert.ok(riderQaStaticPath(path), path);
  }
});

test('QA server rejects unrelated or traversing paths', () => {
  for (const path of ['/secrets.txt', '/other/page.css', '/styles/../../private.txt']) {
    assert.equal(riderQaStaticPath(path), null, path);
  }
});
