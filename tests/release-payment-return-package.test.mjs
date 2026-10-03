import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('el paquete de release incluye las tres rutas de retorno de Mercado Pago', () => {
  const builder = read('scripts/create-release-folder.mjs');
  assert.match(builder, /['"]pago['"]/);

  for (const state of ['resultado', 'pendiente', 'error']) {
    const page = read(`pago/${state}/index.html`);
    assert.match(page, /href="\.\.\/\.\.\/styles\.css\?v=50"/);
    assert.match(page, /src="\.\.\/\.\.\/js\/payments\/mercadopago-return\.js"/);
  }
});

test('el worker conserva una página y el módulo del retorno para cada vuelta offline', () => {
  const worker = read('sw.js');
  for (const state of ['resultado', 'pendiente', 'error']) {
    assert.ok(worker.includes(`'./pago/${state}/index.html'`));
  }
  assert.ok(worker.includes("'./js/payments/mercadopago-return.js'"));
  assert.match(worker, /paymentReturnFallback/);
});

test('el preflight acepta la versión CSS que exige el candidato', () => {
  const preflight = read('scripts/preflight-staging-package.mjs');
  assert.match(preflight, /css:\s*'\?v=50'/);
  assert.match(preflight, /app:\s*'\?v=42'/);
  assert.match(preflight, /PERMITTED_VERSIONS = new Set\(\['50', '42', '3', '2'\]\)/);
  // El gate anterior tenía un 41 suelto y por eso rechazaba el candidato v42.
  assert.doesNotMatch(preflight, /'50',\s*'41'/);
});

test('el workflow de preview no puede publicar el template sin preflight', () => {
  const workflow = read('.github/workflows/preview-pages.yml');
  assert.match(workflow, /runtime-config\.live\.js/);
  assert.match(workflow, /check-runtime-config\.mjs/);
  assert.match(workflow, /preflight-staging-package\.mjs/);
  assert.match(workflow, /cp runtime-config\.live\.js dist_release\/runtime-config\.js/);
});
