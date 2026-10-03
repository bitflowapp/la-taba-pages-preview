import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourcePath = 'C:\\1212\\taba-device-test-runtime\\secure-frontend-server.mjs';

test('runtime server never rewrites missing product images', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.doesNotMatch(source, /beverage-placeholder\.svg/);
  assert.doesNotMatch(source, /isMissingProductThumbnail/);
  assert.doesNotMatch(source, /productFallbackPath/);
  assert.doesNotMatch(source, /la-taba-pages/);
});

test('runtime server keeps private paths blocked and runtime config external', async () => {
  const source = await readFile(sourcePath, 'utf8');
  for (const segment of ['.git', '.env', '.local-staging', 'node_modules', 'supabase']) {
    assert.match(source, new RegExp(segment.replace('.', '\\.')));
  }
  assert.match(source, /pathname === '\/runtime-config\.js'/);
  assert.match(source, /target = runtimePath/);
});
