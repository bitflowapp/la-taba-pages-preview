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

  assert.ok(indexHtml.includes('<script src="js/pwa-update.js?v=3"></script>'));
  assert.ok(indexHtml.includes('<script src="js/startup-recovery.js?v=2"></script>'));
  assert.match(indexHtml, /<link rel="stylesheet" href="styles\.css\?v=50"\s*\/?>/);
  assert.ok(indexHtml.includes('<script type="module" src="js/app.js?v=43"></script>'));
  assert.ok(!indexHtml.includes('src="/js/'));
  assert.ok(!indexHtml.includes('href="/js/'));
  assert.ok(!indexHtml.includes('src="/assets/'));
});

test('service worker precaches the versioned showcase graph', () => {
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

  for (const asset of [
    './styles.css?v=50',
    './styles/showcase.css?v=50',
    './js/app.js?v=43',
    './js/core/showcase-mode.js',
    './js/showcase-fixtures.js',
    './js/showcase.js',
  ]) {
    assert.ok(worker.includes(`'${asset}'`), `${asset} should be precached`);
  }
});

/*
 * El `?v` de `styles.css` no protege a las hojas que ese archivo importa: cada
 * `@import` es su propia URL y su propio `?v`. Si el shell rota y los imports
 * no, el navegador sirve las hojas VIEJAS —misma URL— contra el HTML nuevo, y
 * el SW precachea una versión que nadie pide nunca.
 *
 * Pasó de verdad: la rotación a v46 movió index.html y sw.js y dejó los trece
 * `@import` en v45. Online no se nota, porque network-first siempre trae la
 * hoja fresca. Se ve cuando el cliente vuelve con caché encima, que es el caso
 * que importa. Estas dos afirmaciones lo cierran de las dos puntas.
 */
test('la cadena de CSS versionado cierra: shell, @imports y precache dicen lo mismo', () => {
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const stylesheet = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  const shellVersion = indexHtml.match(/href="styles\.css\?v=(\d+)"/)?.[1];
  assert.ok(shellVersion, 'index.html debería cargar styles.css con un ?v');
  assert.ok(
    worker.includes(`'./styles.css?v=${shellVersion}'`),
    `sw.js precachea styles.css en otra versión que la que pide index.html (?v=${shellVersion})`,
  );

  const imports = [...stylesheet.matchAll(/@import url\("\.\/(styles\/[^"?]+\.css)\?v=(\d+)"\)/g)];
  assert.ok(imports.length > 0, 'styles.css debería importar hojas versionadas');

  for (const [, file, version] of imports) {
    assert.equal(
      version,
      shellVersion,
      `styles.css importa ${file} en ?v=${version} y el shell va en ?v=${shellVersion}: ` +
        'el navegador serviría esa hoja desde la caché vieja',
    );
    assert.ok(
      worker.includes(`'./${file}?v=${version}'`),
      `${file} lo importa styles.css y falta en el precache de sw.js en ?v=${version}: ` +
        'sin red el importador se queda sin esa hoja',
    );
  }
});

// El fetch handler es network-first y devuelve `Response.error()` para un GET
// mismo-origen que no está en caché. Un import ESTÁTICO ausente del manifiesto
// no degrada: impide que su importador evalúe, y el cliente pierde el mapa
// entero justo cuando se quedó sin señal. El grafo de `js/map` tiene que cerrar.
test('el precache cierra el grafo de imports estáticos del mapa', () => {
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const precached = new Set(
    [...worker.matchAll(/'\.\/(js\/[^']+?\.js)(?:\?[^']*)?'/g)].map((match) => match[1]),
  );

  const pending = [...precached].filter((module) => module.startsWith('js/map/'));
  assert.ok(pending.length > 0, 'el manifiesto debería precachear los módulos de mapa');

  const visited = new Set();
  while (pending.length) {
    const module = pending.shift();
    if (visited.has(module)) continue;
    visited.add(module);

    const source = fs.readFileSync(path.join(root, module), 'utf8');
    const specifiers = [...source.matchAll(/^\s*(?:import|export)\s[^'"]*['"](\.[^'"]+)['"]/gm)]
      .map((match) => match[1])
      .filter((specifier) => specifier.endsWith('.js'));

    for (const specifier of specifiers) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(module), specifier));
      assert.ok(
        precached.has(target),
        `${target} lo importa ${module} de forma estática y falta en el precache de sw.js`,
      );
      // La capa de mapa cierra sobre sí misma. Lo que importa hacia afuera se
      // exige precacheado pero no se recorre: el resto del manifiesto tiene su
      // propia deuda, anterior a esta integración y documentada aparte.
      if (target.startsWith('js/map/')) pending.push(target);
    }
  }
});
