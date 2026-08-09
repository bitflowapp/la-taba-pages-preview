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
  // El nombre lo pone el diccionario, no una transformación del slug, así que
  // acá sí aparece la ortografía que el negocio declaró.
  assert.equal(nombreVisibleDeCategoria('energizantes', 'energizantes'), 'Energizantes');
  assert.equal(nombreVisibleDeCategoria('cervezas', 'cervezas'), 'Cervezas');
});

/*
 * OJO al leer esta prueba: qué devuelve `nombreVisibleDeCategoria` para un id
 * dado depende de QUÉ DICCIONARIO esté cargado, y en la suite completa alguna
 * prueba anterior puede instalar un catálogo de test distinto del de
 * producción. Por eso acá no se fija ninguna cadena para ids que puedan estar o
 * no en el diccionario: se prueba el contrato.
 *
 * Verificado aparte en el navegador, contra el catálogo real: «energeticas»
 * -que no está en el diccionario de la app, que conoce «energizantes»- queda
 * «Energeticas», capitalizado y sin acento.
 */

test('los guiones del id se leen como palabras, no como guiones', () => {
  const visible = nombreVisibleDeCategoria('aguas-saborizadas', 'aguas-saborizadas');
  assert.ok(!visible.includes('-'), `no debería quedar un guion: ${visible}`);
  assert.match(visible, /^Aguas saborizadas$/);
});

test('con un id que nadie conoce, se capitaliza y nada más: no se inventa ortografía', () => {
  // Una categoría que el negocio invente mañana y que no esté en ningún
  // diccionario. Se la deja legible, pero no se le agregan acentos ni se le
  // cambian palabras: cómo se llama lo decide el negocio, no el storefront.
  assert.equal(nombreVisibleDeCategoria('sidras-artesanales', 'sidras-artesanales'), 'Sidras artesanales');
  assert.equal(nombreVisibleDeCategoria('bebida-rara', 'bebida-rara'), 'Bebida rara');
});

test('un nombre vacío tampoco deja el chip mudo', () => {
  assert.equal(nombreVisibleDeCategoria('cervezas', ''), 'Cervezas');
  assert.equal(nombreVisibleDeCategoria('cervezas', null), 'Cervezas');
});
