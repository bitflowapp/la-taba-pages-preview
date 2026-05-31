import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsPath = path.join(root, 'docs/image-sources.md');

test('real image assets are local, documented, and lightweight', () => {
  assert.equal(fs.existsSync(docsPath), true, 'docs/image-sources.md should exist');
  const docs = fs.readFileSync(docsPath, 'utf8');
  const matches = [...docs.matchAll(/`(assets\/(?:hero|products)\/[^`]+\.webp)`/g)];
  const relativePaths = [...new Set(matches.map((match) => match[1]))];

  assert.ok(relativePaths.length >= 6, 'expected documented hero/product images');
  assert.ok(docs.includes('https://www.pexels.com/license/'));

  for (const relativePath of relativePaths) {
    const filePath = path.join(root, relativePath);
    assert.equal(fs.existsSync(filePath), true, `${relativePath} should exist`);
    assert.ok(fs.statSync(filePath).size < 220 * 1024, `${relativePath} should stay below 220 KB`);
  }
});
