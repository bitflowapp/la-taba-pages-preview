import assert from 'node:assert/strict';
import test from 'node:test';

import gate, { isAuthorized, sha256Hex } from '../deploy/qa-preview-gate/_worker.js';

const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`;
const assets = { fetch: async () => new Response('<!doctype html>ok', { status: 200, headers: { 'Content-Type': 'text/html' } }) };

test('la puerta falla cerrada si el proyecto no tiene el secreto configurado', async () => {
  const response = await gate.fetch(new Request('https://qa.example/'), { ASSETS: assets });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('sin credenciales pide usuario y contraseña y no sirve el sitio', async () => {
  const env = { ASSETS: assets, PREVIEW_ACCESS_SHA256: await sha256Hex('qa:correcta') };
  const response = await gate.fetch(new Request('https://qa.example/'), env);
  assert.equal(response.status, 401);
  assert.match(response.headers.get('www-authenticate'), /^Basic realm="La Taba QA"/);
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  assert.doesNotMatch(await response.text(), /<!doctype/i);
});

test('una contraseña equivocada, un usuario equivocado o basura se rechazan', async () => {
  const expected = await sha256Hex('qa:correcta');
  for (const authorization of [basic('qa', 'incorrecta'), basic('otro', 'correcta'), 'Basic ###', 'Bearer abc', basic('qa', '')]) {
    const request = new Request('https://qa.example/', { headers: { authorization } });
    assert.equal(await isAuthorized(request, expected), false, authorization);
  }
});

test('con la credencial correcta sirve el archivo y agrega las cabeceras del preview', async () => {
  const env = { ASSETS: assets, PREVIEW_ACCESS_SHA256: await sha256Hex('qa:correcta') };
  const response = await gate.fetch(new Request('https://qa.example/pago/resultado', {
    headers: { authorization: basic('qa', 'correcta') },
  }), env);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '<!doctype html>ok');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  assert.match(response.headers.get('vary'), /Authorization/);
});

test('detrás de la puerta el shell, sw.js y version.json se revalidan siempre, y una cabecera propia se respeta', async () => {
  // Sin worker, Pages sirve los estáticos con `max-age=0, must-revalidate`; detrás de la puerta llegan sin
  // Cache-Control y un navegador podía quedarse con un shell o un version.json viejos.
  const env = { ASSETS: assets, PREVIEW_ACCESS_SHA256: await sha256Hex('qa:correcta') };
  const authorization = basic('qa', 'correcta');
  const plain = await gate.fetch(new Request('https://qa.example/sw.js', { headers: { authorization } }), env);
  assert.equal(plain.headers.get('cache-control'), 'private, no-cache');
  const own = await gate.fetch(new Request('https://qa.example/runtime-config.js', { headers: { authorization } }), {
    ...env, ASSETS: { fetch: async () => new Response('x', { status: 200, headers: { 'Cache-Control': 'no-store' } }) },
  });
  assert.equal(own.headers.get('cache-control'), 'no-store');
});

test('un hash mal formado nunca autoriza', async () => {
  const request = new Request('https://qa.example/', { headers: { authorization: basic('qa', 'x') } });
  assert.equal(await isAuthorized(request, 'no-es-un-hash'), false);
  assert.equal(await isAuthorized(request, ''), false);
});
