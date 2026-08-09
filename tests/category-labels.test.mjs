// El chip de categoría es lo primero que lee una persona en la góndola.
//
// Medido en staging: dos de doce productos llegan con `category_name` igual al
// id, así que el chip decía «energeticas» —minúscula, sin acento— al lado de
// «Cervezas» y «Gaseosas». El dato lo arregla el negocio; la góndola, mientras
// tanto, no puede mostrar un slug crudo, porque el día que se carguen
// categorías nuevas vuelve a pasar.
import test from 'node:test';
import assert from 'node:assert/strict';

import { nombreVisibleDeCategoria } from '../js/ui.js';

test('un nombre que es el propio id no se muestra como slug', () => {
  const visible = nombreVisibleDeCategoria('energeticas', 'energeticas');
  assert.notEqual(visible, 'energeticas');
  assert.match(visible, /^[A-ZÁÉÍÓÚÑ]/);
});

test('un nombre bueno del backend se respeta tal cual', () => {
  assert.equal(nombreVisibleDeCategoria('cervezas', 'Cervezas'), 'Cervezas');
  assert.equal(nombreVisibleDeCategoria('gaseosas', 'Gaseosas'), 'Gaseosas');
});

test('si el id está en el diccionario que la app ya conoce, gana ese nombre', () => {
  // `energizantes` sí existe en el catálogo de categorías de la aplicación.
  assert.equal(nombreVisibleDeCategoria('energizantes', 'energizantes'), 'Energizantes');
});

test('los guiones del id se leen como palabras, no como guiones', () => {
  const visible = nombreVisibleDeCategoria('aguas-saborizadas', 'aguas-saborizadas');
  assert.ok(!visible.includes('-'), `no debería quedar un guion: ${visible}`);
  assert.match(visible, /^Aguas saborizadas$/);
});

test('no se inventa ortografía: sin acento en el dato, sin acento en pantalla', () => {
  // «energeticas» no está en el diccionario —la app conoce «energizantes»—, así
  // que se capitaliza y nada más. Ponerle el acento sería escribir por el
  // negocio, y el negocio es el que decide cómo se llama su categoría.
  assert.equal(nombreVisibleDeCategoria('energeticas', 'energeticas'), 'Energeticas');
});

test('un nombre vacío tampoco deja el chip mudo', () => {
  assert.equal(nombreVisibleDeCategoria('cervezas', ''), 'Cervezas');
  assert.equal(nombreVisibleDeCategoria('cervezas', null), 'Cervezas');
});
