/*
 * La lámina de góndola de TABA: que exista, que sea la de cada producto, y que
 * sea DEMOSTRABLEMENTE propia.
 *
 * El último punto es el que sostiene el modelo de derechos. `assets/products/`
 * está gobernado por una compuerta que sólo deja viajar una foto con derechos
 * declarados; la carpeta `taba/` entra como PROPIO por ser obra del comercio, y
 * la única forma de que eso no sea una promesa es reproducirlo: el generador
 * vuelve a dibujar cada archivo desde la especificación y se comparan los bytes.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { dibujarLamina, huellaContenido } from '../scripts/catalog-images/lamina-taba.mjs';
import { LAMINA_GENERICA, laminaDeProducto, skusConLamina, tieneLaminaPropia } from '../js/core/taba-packshot.js';
import { LAMINAS_TABA } from '../js/core/taba-packshot-manifest.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const spec = JSON.parse(fs.readFileSync(path.join(root, 'catalog/lamina-taba/especificacion.json'), 'utf8'));
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'catalog/production-catalog-snapshot.json'), 'utf8'));

test('cada lámina es exactamente lo que produce el generador: obra propia probada, no declarada', () => {
  for (const producto of spec.productos) {
    const svg = dibujarLamina({ ...producto, paleta: spec.paletas[producto.paleta] });
    const esperado = `assets/products/taba/${producto.sku}-${huellaContenido(svg)}.svg`;
    const enDisco = path.join(root, esperado);
    assert.ok(fs.existsSync(enDisco), `${producto.sku}: falta ${esperado} — correr npm run catalog:laminas`);
    assert.equal(fs.readFileSync(enDisco, 'utf8'), svg, `${producto.sku}: el archivo no es el que dibuja el generador`);
  }
});

test('no sobra ningún archivo en la carpeta de obra propia', () => {
  const permitidos = new Set([
    ...spec.productos.map((producto) => {
      const svg = dibujarLamina({ ...producto, paleta: spec.paletas[producto.paleta] });
      return `${producto.sku}-${huellaContenido(svg)}.svg`;
    }),
    path.basename(LAMINA_GENERICA),
  ]);
  const enDisco = fs.readdirSync(path.join(root, 'assets/products/taba'));
  for (const archivo of enDisco) {
    assert.ok(permitidos.has(archivo), `${archivo} no sale de la especificación: no se puede declarar propio`);
  }
  assert.equal(enDisco.length, permitidos.size);
});

test('el nombre del archivo lleva la huella del contenido: una caché vieja no puede servir un dibujo viejo', () => {
  for (const [sku, ruta] of Object.entries(LAMINAS_TABA)) {
    assert.match(ruta, /^assets\/products\/taba\/[a-z0-9-]+-[0-9a-f]{12}\.svg$/, sku);
  }
});

test('todos los productos visibles de producción tienen lámina, salvo los que ya tienen fotografía', () => {
  const conFoto = new Set(spec.sinLamina.skus);
  const sinCubrir = snapshot.productos
    .map((producto) => producto.sku)
    .filter((sku) => !conFoto.has(sku) && !skusConLamina().includes(sku));
  assert.deepEqual(sinCubrir, [], 'quedan productos con el dibujo genérico en la góndola de producción');
});

test('la lámina se resuelve por SKU, no por id: en producción el id es un UUID', () => {
  const producto = { id: '44210832-ec41-463b-b07a-4622dddf4fd9', sku: 'coca-cola-original-2250ml' };
  assert.match(laminaDeProducto(producto), /coca-cola-original-2250ml-/);
  assert.equal(tieneLaminaPropia(producto), true);

  // Las fixturas de demo traen el slug en el `id` y también tienen que resolver.
  assert.match(laminaDeProducto({ id: 'sprite-zero-2250ml' }), /sprite-zero-2250ml-/);
  // Y `externalId`, que es la tercera forma en que el catálogo nombra lo mismo.
  assert.match(laminaDeProducto({ externalId: 'fanta-naranja-2250ml' }), /fanta-naranja-2250ml-/);
});

test('un producto desconocido no se queda sin dibujo: cae a la lámina genérica', () => {
  assert.equal(laminaDeProducto({ sku: 'no-existe-999' }), LAMINA_GENERICA);
  assert.equal(laminaDeProducto({}), LAMINA_GENERICA);
  assert.equal(laminaDeProducto(null), LAMINA_GENERICA);
  assert.equal(tieneLaminaPropia({ sku: 'no-existe-999' }), false);
  assert.ok(fs.existsSync(path.join(root, LAMINA_GENERICA)));
});

test('ninguna lámina lleva texto: ni marca, ni capacidad, ni sello de cantidad', () => {
  for (const archivo of fs.readdirSync(path.join(root, 'assets/products/taba'))) {
    const svg = fs.readFileSync(path.join(root, 'assets/products/taba', archivo), 'utf8');
    assert.doesNotMatch(svg, /<text|<tspan|<foreignObject/i, `${archivo} dibuja texto`);
    assert.doesNotMatch(svg, /<image/i, `${archivo} incrusta un bitmap: dejaría de ser obra propia verificable`);
  }
});

test('el lienzo es blanco puro y cuadrado, como el packshot que acompaña', () => {
  for (const archivo of fs.readdirSync(path.join(root, 'assets/products/taba'))) {
    const svg = fs.readFileSync(path.join(root, 'assets/products/taba', archivo), 'utf8');
    assert.match(svg, /viewBox="0 0 1000 1000"/, archivo);
    assert.match(svg, /<rect width="1000" height="1000" fill="#FFFFFF"\/>/, archivo);
  }
});

test('cada pieza pesa poco: treinta dibujos no pueden costar una foto', () => {
  const carpeta = path.join(root, 'assets/products/taba');
  let total = 0;
  for (const archivo of fs.readdirSync(carpeta)) {
    const bytes = fs.statSync(path.join(carpeta, archivo)).size;
    assert.ok(bytes < 12 * 1024, `${archivo} pesa ${bytes} bytes`);
    total += bytes;
  }
  // Los 4 packshots reales del catálogo suman ~600 KB: las 31 láminas tienen
  // que costar una fracción de eso o el ahorro de la góndola se lo come el peso.
  assert.ok(total < 250 * 1024, `las láminas suman ${(total / 1024).toFixed(1)} KB`);
});

test('dos productos distintos nunca comparten el mismo dibujo', () => {
  const porContenido = new Map();
  const carpeta = path.join(root, 'assets/products/taba');
  for (const archivo of fs.readdirSync(carpeta)) {
    const svg = fs.readFileSync(path.join(carpeta, archivo), 'utf8');
    // Los ids de gradiente derivan del SKU, así que dos piezas idénticas de
    // dibujo igual difieren en el texto. Se compara el DIBUJO: sin los ids.
    const dibujo = svg.replace(/l[a-z0-9]{7}/g, 'ID');
    const previo = porContenido.get(dibujo);
    assert.equal(previo, undefined, `${archivo} y ${previo} dibujan exactamente lo mismo`);
    porContenido.set(dibujo, archivo);
  }
});
