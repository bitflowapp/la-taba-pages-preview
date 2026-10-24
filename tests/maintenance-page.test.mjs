// La página de mantenimiento preparada para la-taba.pages.dev (deploy/maintenance/): neutra y capaz de retirar la
// tienda anterior de los teléfonos que la tienen instalada.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (file) => fs.readFileSync(new URL(`../deploy/maintenance/${file}`, import.meta.url), 'utf8');

test('la página no publica precios, productos ni datos del comercio', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /\$\s?\d|\bARS\b|\b\d{7,}\b|@|wa\.me|https?:\/\//, 'precio, teléfono, correo o enlace');
  assert.doesNotMatch(html, /\b(?:agregar|carrito|mendoza|neuqu[eé]n)\b/i, 'producto o dirección');
  assert.match(html, /<html lang="es">/);
  assert.match(html, /name="robots" content="noindex"/);
  assert.match(html, /no se toman pedidos ni se cobra nada/);
  assert.doesNotMatch(html, /<script/i, 'no registra ningún worker nuevo ni carga código');
});

test('el worker de mantenimiento borra las cachés, se da de baja y recarga las pestañas', () => {
  const sw = read('sw.js');
  assert.match(sw, /skipWaiting\(\)/);
  assert.match(sw, /caches\.delete\(key\)/);
  assert.match(sw, /registration\.unregister\(\)/);
  assert.match(sw, /client\.navigate\(client\.url\)/);
  assert.doesNotMatch(sw, /addEventListener\('fetch'/, 'no intercepta pedidos: todo va a la red');
});

test('la página y el worker no se guardan en caché y no se indexan', () => {
  const headers = read('_headers');
  assert.match(headers, /^\/\*\n(?:.*\n)*?\s+X-Robots-Tag: noindex/m);
  assert.match(headers, /^\/sw\.js\n\s+Cache-Control: no-cache, no-store/m);
});
