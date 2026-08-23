import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'styles/tracking.css'), 'utf8');

/*
 * «VOLVER AL RIDER» NO PUEDE ALCANZAR EL BOTÓN DE RECENTRADO.
 *
 * El 2026-08-23 el gate de E2E corrió por primera vez en días y perdió esta
 * prueba a 320 px, por un píxel:
 *
 *     Error: 320px: el CTA no pisa el recentrado
 *     Expected: <= 243
 *     Received:    244
 *
 * No era del navegador ni del gate: la píldora medía 170 px en la máquina de
 * quien la escribió y 186 en el runner. `system-ui` resuelve a fuentes
 * distintas y el mismo texto ocupa 16 px más. El diseño tenía 6 de margen.
 *
 * Debajo del margen había un error de aritmética. La píldora va CENTRADA, así
 * que cada píxel del control de la esquina hay que reservarlo DOS veces —uno de
 * cada lado—; `max-width` reservaba `100% - 118px` cuando el recentrado ocupa
 * 15 + 46 = 61, o sea 122 como mínimo. Medido con el marcado real: con la
 * píldora clavada en su máximo, su borde derecho caía 1 px ADENTRO del
 * recentrado. El clamp casi nunca llegaba a actuar, así que el error dormía.
 *
 * Y cuando actuaba era peor: con `white-space: nowrap` y sin `overflow`, el
 * contenido medía 419 px dentro de una caja de 200 y las letras cruzaban por
 * encima del recentrado mientras la caja —lo que mide una prueba— juraba que
 * no lo tocaba.
 *
 * Esta prueba comprueba la aritmética, no el píxel: el píxel lo mide el E2E.
 * Es la que avisa en segundos si alguien mueve el recentrado sin mover la
 * reserva, que es como volvería a pasar.
 */

/** El bloque de una regla, por selector exacto y a nivel superior. */
function bloque(selector) {
  const indice = css.indexOf(`\n${selector} {`);
  assert.notEqual(indice, -1, `no se encontró la regla ${selector}`);
  const fin = css.indexOf('\n}', indice);
  return css.slice(indice, fin);
}

/*
 * El valor MÁS GRANDE que declara cualquier regla del recentrado, no el último.
 * La hoja lo redefine cuatro veces —15/48, 14/46, 15/46, 15/46— y las dos
 * últimas están calificadas por el estado del pedido, así que cuál gana depende
 * de si el rider está llegando o en camino. Contra el peor caso, no contra el
 * que toque hoy.
 */
function mayorDeclarado(propiedad) {
  const reglas = [...css.matchAll(/\.tracking-map-recenter\s*\{([^}]*)\}/g)];
  const valores = reglas
    .map((regla) => regla[1].match(new RegExp(`(?:^|\\n)\\s*${propiedad}:\\s*([^;]+);`)))
    .filter(Boolean)
    .map((encontrado) => Number.parseFloat(encontrado[1]));
  assert.ok(valores.length > 0, `ninguna regla del recentrado declara ${propiedad}`);
  assert.ok(valores.every(Number.isFinite), `${propiedad} no está en px`);
  return Math.max(...valores);
}

test('la reserva del CTA cubre el recentrado DOS veces, porque va centrado', () => {
  const huella = mayorDeclarado('right') + mayorDeclarado('width');

  const maxWidth = bloque('.tracking-map-follow-cta').match(/max-width:\s*calc\(100% - (\d+(?:\.\d+)?)px\)/);
  assert.ok(maxWidth, '.tracking-map-follow-cta tiene que acotarse contra el ancho del escenario');
  const reserva = Number(maxWidth[1]);

  assert.ok(
    reserva >= huella * 2,
    `el CTA reserva ${reserva}px y el recentrado ocupa ${huella}px de cada lado: hacen falta ${huella * 2}px`,
  );
});

test('el CTA está centrado: es lo que obliga a reservar el doble', () => {
  // Si algún día deja de estar centrado, la cuenta de arriba deja de ser la
  // correcta y esta prueba tiene que fallar para que alguien la rehaga.
  const cta = bloque('.tracking-map-follow-cta');
  assert.match(cta, /left:\s*50%/);
  assert.match(cta, /transform:\s*translateX\(-50%\)/);
});

test('si el texto no entra se recorta adentro, no se derrama sobre el control', () => {
  const etiqueta = bloque('.tracking-map-follow-cta > span');
  assert.match(etiqueta, /overflow:\s*hidden/);
  assert.match(etiqueta, /text-overflow:\s*ellipsis/);
  // Sin esto un ítem flex no se encoge por debajo de su contenido y
  // `text-overflow` no llega a aplicarse nunca.
  assert.match(etiqueta, /min-width:\s*0/);
});

test('en pantallas angostas la píldora se ajusta para no depender del recorte', () => {
  /*
   * El recorte de arriba es la garantía; esto es para que no haga falta usarla.
   * A 320 px la etiqueta entera queda al filo con la tipografía del runner.
   */
  const inicio = css.indexOf('@media (max-width: 400px) {');
  assert.notEqual(inicio, -1, 'falta el bloque para pantallas angostas');
  const angosto = [css.slice(inicio, css.indexOf('\n}\n', css.indexOf('.tracking-map-follow-cta svg', inicio)))];
  assert.match(angosto[0], /\.tracking-map-follow-cta \{/);
  assert.match(angosto[0], /font-size:\s*0\.84rem/);
  assert.match(angosto[0], /padding:\s*0 12px 0 10px/);
});
