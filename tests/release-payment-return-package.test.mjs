import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
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

  // Antes esto miraba la FORMA: buscaba el literal '50' dentro de una lista
  // escrita a mano. Esa lista dejó de existir —las versiones permitidas ahora se
  // derivan de `ESPERADO`, justamente para que no pueda volver a exigirse una
  // versión y prohibirse la misma— así que buscar el literal medía el andamio y
  // no la propiedad. Acá se ejecutan las declaraciones reales del guion y se
  // comprueba lo que el test siempre quiso decir: que la versión que el
  // candidato exige sea una de las que el paquete puede servir.
  // La invariante general vive en `tests/preflight-staging-package.test.mjs`.
  const bloques = [
    /const ESPERADO = \{[\s\S]*?\};/,
    /const VERSIONES_EXTRA = \[[\s\S]*?\];/,
    /const permitidas = new Set\(\[[\s\S]*?\]\);/,
  ].map((patron) => {
    const encontrado = patron.exec(preflight);
    assert.ok(encontrado, `el preflight ya no declara ${patron}`);
    return encontrado[0];
  });
  const sandbox = {};
  const fuenteVm = bloques.join('\n') + '\nvar permitidasFinal = [...permitidas];';
  vm.runInNewContext(fuenteVm, sandbox, { timeout: 1000 });

  assert.ok(
    sandbox.permitidasFinal.includes('50'),
    `el preflight exige styles.css?v=50 y no lo permite (permitidas: ${sandbox.permitidasFinal.join(', ')})`,
  );
});
