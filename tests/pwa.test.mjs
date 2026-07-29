import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('PWA and GitHub Pages entry points exist', () => {
  for (const relativePath of ['.nojekyll', 'manifest.webmanifest', 'sw.js', 'index.html']) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), true, `${relativePath} should exist`);
  }
});

test('manifest is relative and PWA-ready for GitHub Pages', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));

  assert.ok(manifest.name);
  assert.ok(manifest.short_name);
  assert.ok(manifest.start_url);
  assert.equal(manifest.display, 'standalone');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);
  assert.ok(!manifest.start_url.startsWith('/'));
  assert.ok(!manifest.scope || !manifest.scope.startsWith('/'));
  assert.ok(manifest.icons.every((icon) => typeof icon.src === 'string' && !icon.src.startsWith('/')));
});

test('index.html loads the module entry point and avoids root-absolute asset paths', () => {
  const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.ok(indexHtml.includes('<script src="js/pwa-update.js?v=2"></script>'));
  assert.ok(indexHtml.includes('<script src="js/startup-recovery.js?v=1"></script>'));
  assert.ok(indexHtml.includes('<script type="module" src="js/app.js?v=35"></script>'));
  assert.ok(!indexHtml.includes('src="/js/'));
  assert.ok(!indexHtml.includes('href="/js/'));
  assert.ok(!indexHtml.includes('src="/assets/'));
});
