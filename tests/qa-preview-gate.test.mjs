import assert from 'node:assert/strict';
import test from 'node:test';

import gate, { isAuthorized, sha256Hex, sessionToken, hasValidSession, SESSION_COOKIE } from '../deploy/qa-preview-gate/_worker.js';

const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`;
const assets = { fetch: async () => new Response('<!doctype html>ok', { status: 200, headers: { 'Content-Type': 'text/html' } }) };
const envWith = async () => ({ ASSETS: assets, PREVIEW_ACCESS_SHA256: await sha256Hex('qa:correcta') });
const navigate = (url, headers = {}) => new Request(url, { headers: { 'sec-fetch-mode': 'navigate', accept: 'text/html', ...headers } });
const cookieOf = response => (response.headers.get('set-cookie') || '').split(';')[0];
const login = (fields) => new Request('https://qa.example/__acceso', {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-mode': 'navigate' },
  body: new URLSearchParams(fields).toString(),
});

test('la puerta falla cerrada si el proyecto no tiene el secreto configurado', async () => {
  const response = await gate.fetch(new Request('https://qa.example/'), { ASSETS: assets });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('sin credenciales pide usuario y contraseña y no sirve el sitio', async () => {
  const response = await gate.fetch(new Request('https://qa.example/'), await envWith());
  assert.equal(response.status, 401);
  assert.match(response.headers.get('www-authenticate'), /^Basic realm="La Taba QA"/);
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  assert.doesNotMatch(await response.text(), /<!doctype html>ok/i);
});

test('una contraseña equivocada, un usuario equivocado o basura se rechazan', async () => {
  const expected = await sha256Hex('qa:correcta');
  for (const authorization of [basic('qa', 'incorrecta'), basic('otro', 'correcta'), 'Basic ###', 'Bearer abc', basic('qa', '')]) {
    const request = new Request('https://qa.example/', { headers: { authorization } });
    assert.equal(await isAuthorized(request, expected), false, authorization);
  }
});

test('con la credencial correcta sirve el archivo y agrega las cabeceras del preview', async () => {
  const response = await gate.fetch(new Request('https://qa.example/pago/resultado', {
    headers: { authorization: basic('qa', 'correcta') },
  }), await envWith());
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '<!doctype html>ok');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  assert.match(response.headers.get('vary'), /Authorization/);
});

test('detrás de la puerta el shell, sw.js y version.json se revalidan siempre, y una cabecera propia se respeta', async () => {
  // Sin worker, Pages sirve los estáticos con `max-age=0, must-revalidate`; detrás de la puerta llegan sin
  // Cache-Control y un navegador podía quedarse con un shell o un version.json viejos.
  const env = await envWith();
  const authorization = basic('qa', 'correcta');
  const plain = await gate.fetch(new Request('https://qa.example/sw.js', { headers: { authorization } }), env);
  assert.equal(plain.headers.get('cache-control'), 'private, no-cache');
  const own = await gate.fetch(new Request('https://qa.example/runtime-config.js', { headers: { authorization } }), {
    ...env, ASSETS: { fetch: async () => new Response('x', { status: 200, headers: { 'Cache-Control': 'no-store' } }) },
  });
  assert.equal(own.headers.get('cache-control'), 'no-store');
});

test('una navegación sin acceso va al formulario (así el service worker no tapa la puerta con la caché)', async () => {
  // Un service worker no puede mostrar el diálogo de HTTP Basic: con un 401 volvía a la shell guardada y el
  // revisor seguía viendo una versión vieja sin enterarse. Una redirección sí la deja pasar (opaqueredirect).
  const response = await gate.fetch(navigate('https://qa.example/#business?x=1'), await envWith());
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/__acceso?volver=%2F');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const deep = await gate.fetch(navigate('https://qa.example/pago/resultado?payment_id=1'), await envWith());
  assert.equal(deep.headers.get('location'), '/__acceso?volver=%2Fpago%2Fresultado%3Fpayment_id%3D1');
});

test('el formulario se sirve sin credencial, sin caché y sin el sitio adentro', async () => {
  const response = await gate.fetch(navigate('https://qa.example/__acceso?volver=%2F'), await envWith());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  const html = await response.text();
  assert.match(html, /<form method="post" action="\/__acceso">/);
  assert.match(html, /name="volver" value="\/"/);
  assert.doesNotMatch(html, /<!doctype html>ok/i);
});

test('la clave correcta da una cookie de sesión segura y vuelve a donde estaba; la equivocada no', async () => {
  const env = await envWith();
  const ok = await gate.fetch(login({ usuario: 'qa', clave: 'correcta', volver: '/pago/resultado?payment_id=1' }), env);
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/pago/resultado?payment_id=1');
  const setCookie = ok.headers.get('set-cookie');
  assert.match(setCookie, new RegExp(`^${SESSION_COOKIE}=v1\\.\\d+\\.[0-9a-f]{64}; `));
  for (const flag of ['Path=/', 'Secure', 'HttpOnly', 'SameSite=Lax', 'Max-Age=2592000']) assert.ok(setCookie.includes(flag), flag);
  const bad = await gate.fetch(login({ usuario: 'qa', clave: 'incorrecta', volver: '/' }), env);
  assert.equal(bad.status, 401);
  assert.equal(bad.headers.get('set-cookie'), null);
  assert.match(await bad.text(), /Usuario o clave incorrectos/);
});

test('con la cookie se sirve todo, también lo que pide el service worker; una cookie falsa, vencida o de otra clave no', async () => {
  const env = await envWith();
  const ok = await gate.fetch(login({ usuario: 'qa', clave: 'correcta', volver: '/' }), env);
  const cookie = cookieOf(ok);
  const page = await gate.fetch(navigate('https://qa.example/', { cookie }), env);
  assert.equal(page.status, 200);
  const sw = await gate.fetch(new Request('https://qa.example/sw.js', { headers: { cookie } }), env);
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get('vary'), /Cookie/);
  const expired = `${SESSION_COOKIE}=${await sessionToken(env.PREVIEW_ACCESS_SHA256, Date.now() - 1000)}`;
  const forged = cookie.replace(/[0-9a-f]$/, c => (c === '0' ? '1' : '0'));
  const otherKey = `${SESSION_COOKIE}=${await sessionToken(await sha256Hex('qa:otra'), Date.now() + 60_000)}`;
  for (const value of [expired, forged, otherKey, `${SESSION_COOKIE}=basura`]) {
    assert.equal(await hasValidSession(new Request('https://qa.example/', { headers: { cookie: value } }), env.PREVIEW_ACCESS_SHA256), false, value);
    const refused = await gate.fetch(new Request('https://qa.example/sw.js', { headers: { cookie: value } }), env);
    assert.equal(refused.status, 401, value);
  }
});

test('una navegación autorizada con HTTP Basic también deja la cookie, para que el service worker pueda actualizarse', async () => {
  const env = await envWith();
  const response = await gate.fetch(navigate('https://qa.example/', { authorization: basic('qa', 'correcta') }), env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie') || '', new RegExp(`^${SESSION_COOKIE}=v1\\.`));
});

test('el destino de vuelta sólo puede ser una ruta del mismo sitio', async () => {
  const env = await envWith();
  for (const volver of ['https://otro.example/', '//otro.example/x', '/\\otro.example', 'javascript:alert(1)', '/__acceso']) {
    const response = await gate.fetch(login({ usuario: 'qa', clave: 'correcta', volver }), env);
    assert.equal(response.headers.get('location'), '/', volver);
  }
});

test('un hash mal formado nunca autoriza', async () => {
  const request = new Request('https://qa.example/', { headers: { authorization: basic('qa', 'x') } });
  assert.equal(await isAuthorized(request, 'no-es-un-hash'), false);
  assert.equal(await isAuthorized(request, ''), false);
});
