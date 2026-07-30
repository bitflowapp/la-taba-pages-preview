import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const guide = fs.readFileSync(path.join(root, 'docs', 'LA_TABA_DEMO_WALTER.md'), 'utf8');

test('la guía comercial usa una URL canónica que activa demo, reset y pitch', () => {
  assert.match(
    guide,
    /URL de la demo:\*\*\s+`http:\/\/127\.0\.0\.1:8080\/\?demo=1&reset=1&pitch=1`/i,
  );
  assert.doesNotMatch(
    guide,
    /URL de la demo:\*\*\s+`[^`?]*\?reset=1&pitch=1`/i,
  );
});
