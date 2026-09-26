import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('la entrada y la vista Rider web quedan reservadas a demo/showcase', () => {
  assert.match(
    html,
    /<button[^>]*data-demo-only[^>]*data-open-admin-view="rider"[^>]*>Vista rider<\/button>/i,
  );
  assert.match(
    html,
    /<section[^>]*data-view="rider"[^>]*data-demo-only[^>]*>/i,
  );
});

test('producción no publica login ni workspace Rider web', () => {
  assert.doesNotMatch(html, /data-production-auth-card="rider"/i);
  assert.doesNotMatch(html, /data-production-auth-form="rider"/i);
  assert.doesNotMatch(html, /data-production-workspace="rider"/i);
});
