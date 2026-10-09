/*
 * LA PWA NO SIRVE CONTENIDO MEZCLADO ENTRE VERSIONES.
 *
 * Un documento nuevo que pide `styles/campaigns.css?v=80` mientras el precache
 * del service worker guarda `?v=79` (o al revés) es exactamente una pantalla
 * armada con dos releases: el HTML de uno y la hoja del otro. Esta prueba exige
 * que cada URL versionada que el documento pide esté, con la MISMA versión, en
 * el precache; que ningún archivo figure con dos versiones; y que la identidad
 * firmada del release sea la del `CACHE_NAME` que está escrito.
 *
 * El contenido se compara además en `scripts/check-release-identity.mjs`; esta
 * prueba cubre la costura de las versiones, que es donde se desalinean primero.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const sw = read('sw.js');
const precache = [...sw.matchAll(/'(\.\/[^']+\?v=\d+)'/g)].map((match) => match[1]);
const byPath = new Map();
for (const entry of precache) {
  const [path, version] = entry.split('?v=');
  byPath.set(path, [...(byPath.get(path) || []), version]);
}

function requestedVersions(file) {
  const text = read(file);
  const out = [];
  for (const match of text.matchAll(/(?:href|src)="([^"#]+\?v=\d+)"/g)) out.push(match[1]);
  for (const match of text.matchAll(/@import url\("([^"]+\?v=\d+)"\)/g)) out.push(match[1]);
  return out;
}

test('ningún archivo del precache figura con dos versiones', () => {
  assert.ok(byPath.size >= 15, 'el precache versionado no se pudo leer');
  for (const [path, versions] of byPath) {
    assert.equal(new Set(versions).size, 1, `${path} está precacheado con versiones ${versions.join(' y ')}`);
  }
});

for (const file of ['index.html', 'styles.css', 'pago/resultado/index.html', 'pago/pendiente/index.html', 'pago/error/index.html']) {
  test(`${file}: toda URL versionada que pide está precacheada con la misma versión`, () => {
    const requested = requestedVersions(file);
    assert.ok(requested.length > 0, `${file}: no pide ningún archivo versionado`);
    for (const url of requested) {
      if (/^https?:/.test(url)) continue;
      const clean = url.replace(/^\.\//, '').replace(/^\//, '').replace(/^\.\.\/\.\.\//, '');
      // Las rutas del documento son relativas a su carpeta; el precache, a la raíz.
      const key = `./${clean.split('?v=')[0]}`;
      const version = clean.split('?v=')[1];
      const cached = byPath.get(key);
      if (!cached) continue; // no es parte del precache (p. ej. scripts de recuperación con otra política)
      assert.deepEqual(cached, [version], `${file} pide ${key}?v=${version} y el precache tiene ${cached.join(',')}`);
    }
  });
}

test('la identidad firmada es la del CACHE_NAME escrito en sw.js', () => {
  const name = /const CACHE_NAME = '([^']+)'/.exec(sw)?.[1];
  assert.ok(name, 'sw.js no declara CACHE_NAME');
  const identity = JSON.parse(read('release-identity.json'));
  assert.equal(identity.cacheName ?? identity.CACHE_NAME ?? identity.cache_name, name,
    'release-identity.json firma otra identidad: volver a firmar con check-release-identity --write');
});

test('el módulo de campañas y su hoja viajan en el mismo release que el motor', () => {
  for (const asset of ['./js/campaigns/campaign-engine.js', './js/campaigns/campaign-product.js', './js/campaigns/campaign-motion.js']) {
    assert.ok(sw.includes(`'${asset}'`), `${asset} no está en el precache`);
  }
  assert.ok(byPath.has('./styles/campaigns.css'), 'la hoja de campañas no está en el precache versionado');
});
