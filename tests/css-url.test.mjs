import assert from 'node:assert/strict';
import test from 'node:test';
import { cssUrlValue } from '../js/core/css-url.js';

// El valor va dentro de style="background-image:url('…')": no puede traer nada que cierre el
// url(), la comilla o el atributo. encodeURI deja pasar ' ( ) y con eso alcanzaba para escribir
// CSS propio en el estilo en línea de una historia publicada por el backend.

test('escapa la comilla simple y los paréntesis que encodeURI deja pasar', () => {
  assert.equal(
    cssUrlValue("x');background-image:url('y"),
    'x%27%29;background-image:url%28%27y',
  );
});

test('un valor legítimo con paréntesis sigue siendo la misma URL', () => {
  const url = 'https://abc.supabase.co/storage/v1/object/public/stories/foto(1).webp';
  assert.equal(cssUrlValue(url), 'https://abc.supabase.co/storage/v1/object/public/stories/foto%281%29.webp');
  assert.equal(decodeURI(cssUrlValue(url)), url);
});

test('nada que cierre el url(), la comilla o el atributo sobrevive', () => {
  const salida = cssUrlValue('a\'b"c(d)e\\f\ng<h>i`j{k}l m');
  assert.match(salida, /^[^'"()\\\s<>`{}]*$/, salida);
});

test('una cadena que no se puede codificar devuelve vacío y no rompe el render', () => {
  assert.equal(cssUrlValue('\ud800'), '');
  assert.equal(cssUrlValue(null), '');
  assert.equal(cssUrlValue(undefined), '');
});
