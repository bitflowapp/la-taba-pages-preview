// En teléfono, el control de orden tiene que decir QUÉ orden está aplicado.
//
// POR QUÉ EXISTE ESTE ARCHIVO
// ---------------------------
// Por debajo de 560px el `<select>` de orden se dibuja con `opacity: 0` y
// ocupando toda la caja del control. Es un patrón correcto —conserva el objetivo
// táctil de 44px, el menú nativo del sistema y el nombre accesible—, pero deja
// una consecuencia: el texto visible es LO ÚNICO que puede declarar el estado.
//
// Y ese texto era la palabra fija «Ordenar». Una persona abría el control,
// elegía «Menor precio», y el control seguía diciendo «Ordenar». La grilla se
// reordenaba, así que había una señal indirecta, pero el control no declaraba lo
// suyo: en una lista larga, ya desplazada, no queda ninguna forma de saber qué
// orden está aplicado sin volver a abrir el menú.
//
// El valor se había ocultado a propósito —«el valor largo ya no compite por
// 40px y deja de recortarse»—, así que el arreglo no es sólo mostrarlo: hay que
// darle el ancho. Las dos columnas eran 1fr y 1fr y «Filtros» no necesita la
// mitad de la fila.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function extractMediaBlock(content, header) {
  const start = content.indexOf(header);
  assert.notEqual(start, -1, `falta el bloque ${header}`);
  let depth = 0;
  for (let index = start; index < content.length; index += 1) {
    if (content[index] === '{') depth += 1;
    else if (content[index] === '}') {
      depth -= 1;
      if (depth === 0) return content.slice(start, index + 1);
    }
  }
  throw new Error(`no cierra el bloque ${header}`);
}

function ruleBody(css, selector) {
  const pattern = new RegExp(`(^|[},])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm');
  const match = css.match(pattern);
  assert.ok(match, `no existe la regla ${selector}`);
  return match[2].replace(/\s+/g, ' ').trim();
}

test('el markup tiene dónde escribir el orden aplicado', () => {
  const html = read('index.html');
  assert.match(
    html,
    /<span class="sort-value" data-sort-value><\/span>/,
    'falta el span del valor de orden',
  );
  // Vive DENTRO de la etiqueta del control, no suelto: así hereda el color, el
  // tamaño y el `nowrap` del resto y no abre una segunda fila.
  const label = html.match(/<span class="sort-field-label">[\s\S]*?<\/span>\s*<\/span>/);
  assert.ok(label, 'no se encontró la etiqueta del control de orden');
  assert.match(label[0], /data-sort-value/);
});

test('el select nativo conserva su nombre accesible y sus opciones', () => {
  const html = read('index.html');
  // El arreglo es visual. Si algún día alguien reemplaza el `<select>` por un
  // menú dibujado a mano, esto falla y obliga a mirar la accesibilidad.
  assert.match(html, /<select data-sort-select aria-label="Ordenar productos">/);
  for (const value of ['recommended', 'price_asc', 'popular']) {
    assert.match(html, new RegExp(`<option value="${value}">`), `falta la opción ${value}`);
  }
});

test('en escritorio el valor no se duplica: lo muestra el propio select', () => {
  const css = read('styles/catalog.css');
  assert.match(ruleBody(css, '.sort-value'), /display: none/);
});

test('en teléfono se ve el valor elegido y no la palabra fija', () => {
  const block = extractMediaBlock(read('styles/responsive.css'), '@media (max-width: 560px)');

  // La palabra fija se retira…
  assert.match(
    block,
    /\.sort-label-full,\s*\n?\s*\.sort-label-short\s*\{[^}]*display:\s*none/,
    'las etiquetas fijas deberían ocultarse en teléfono',
  );
  // …y el valor ocupa su lugar.
  assert.match(ruleBody(block, '.sort-value'), /display: inline/);

  // El `select` sigue invisible y cubriendo todo: es lo que hace que este
  // arreglo sea necesario, y si deja de ser cierto el test tiene que enterarse.
  assert.match(ruleBody(block, '.catalog-controls .sort-field select'), /opacity: 0/);
});

test('el orden recibe el ancho que necesita sin desbordar la fila', () => {
  const block = extractMediaBlock(read('styles/responsive.css'), '@media (max-width: 560px)');
  const columnas = ruleBody(block, '.catalog-controls');
  assert.match(columnas, /grid-template-columns:\s*minmax\(0, 0\.82fr\) minmax\(0, 1\.18fr\)/);

  // Las dos columnas siguen siendo `minmax(0, …)`: sin eso una palabra larga
  // ensancha la grilla y produce scroll horizontal, que es un fallo duro.
  assert.equal((columnas.match(/minmax\(0,/g) || []).length, 2);

  // Y el valor se recorta antes que empujar.
  const valor = ruleBody(read('styles/catalog.css'), '.sort-value');
  assert.match(valor, /overflow: hidden/);
  assert.match(valor, /text-overflow: ellipsis/);
  assert.match(valor, /white-space: nowrap/);
  assert.match(valor, /min-width: 0/);
});

test('el texto sale de la propia option, no de una segunda lista de etiquetas', () => {
  const ui = read('js/ui.js');
  const bloque = ui.slice(ui.indexOf('[data-sort-value]') - 400, ui.indexOf('[data-sort-value]') + 500);
  assert.match(bloque, /select\.options/, 'el texto debería leerse de las options del select');
  assert.match(bloque, /option\.value === select\.value/);
  // Nada de un diccionario paralelo de etiquetas: si mañana cambia el texto de
  // una opción en el HTML, el control tiene que seguirlo solo.
  assert.doesNotMatch(bloque, /Recomendados|Menor precio|Destacados/);
});
