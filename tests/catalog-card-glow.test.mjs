/*
 * El brillo rojo de la góndola, fijado donde no se ve mirando la pantalla.
 *
 * Es un adorno, y los adornos son justo lo que nadie vuelve a revisar. Lo que
 * se protege acá no es "que se vea lindo" —eso se juzga con capturas— sino las
 * cuatro propiedades que lo vuelven seguro de mantener:
 *
 *  1. `box-shadow` NO es aditivo: para agregar una capa hay que volver a
 *     declarar todas. Las dos primeras capas de la regla del catálogo son una
 *     copia de la sombra de tarjeta compartida, y si esa cambia y la copia no,
 *     las tarjetas del catálogo quedan con una sombra distinta al resto sin que
 *     nadie lo note.
 *  2. El alfa se calcula con `calc(var(--card-glow) * N%)`. Si el token
 *     desaparece, `calc()` queda inválido y el `box-shadow` ENTERO se cae: la
 *     tarjeta perdería también su hairline. El respaldo del `var()` es lo que
 *     evita que un adorno se lleve puesta la superficie.
 *  3. El valor por defecto del token es lo que se ve SIN JavaScript. Si alguien
 *     lo pone en cero, la degradación deja de ser "el brillo no responde al
 *     scroll" y pasa a ser "no hay brillo".
 *  4. El módulo de movimiento no puede agregar listeners nuevos ni escribir sin
 *     cuantizar: escribir una propiedad heredada en cada cuadro invalida el
 *     estilo del subárbol sesenta veces por segundo para mover un alfa que
 *     nadie distingue.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const leer = (relativo) => readFileSync(path.join(RAIZ, relativo), 'utf8');
const BRAND = leer('styles/brand-home.css');
const TOKENS = leer('styles/tokens.css');
const MOTION = leer('js/motion.js');

const SELECTOR_GLOW = 'body[data-active-view="catalog"] .app-view[data-view="catalog"] [data-product-grid] .product-card';

function declaracion(css, selector) {
  const inicio = css.indexOf(`${selector} {`);
  assert.notEqual(inicio, -1, `no existe la regla para ${selector}`);
  const fin = css.indexOf('}', inicio);
  return css.slice(inicio, fin);
}

function capas(bloque) {
  const sombra = /box-shadow:([\s\S]*?);/.exec(bloque);
  assert.ok(sombra, 'la regla no declara box-shadow');
  // Se corta por comas que no estén dentro de paréntesis: `rgb(… / calc(…))`
  // tiene comas propias que no separan capas.
  const partes = [];
  let nivel = 0;
  let actual = '';
  for (const caracter of sombra[1]) {
    if (caracter === '(') nivel += 1;
    if (caracter === ')') nivel -= 1;
    if (caracter === ',' && nivel === 0) { partes.push(actual.trim()); actual = ''; continue; }
    actual += caracter;
  }
  partes.push(actual.trim());
  return partes.map((p) => p.replace(/\s+/g, ' ')).filter(Boolean);
}

test('las capas base del brillo son las mismas que la sombra de tarjeta compartida', () => {
  // La regla compartida: la que pinta TODAS las superficies de la góndola.
  const compartida = /box-shadow: (var\(--shadow-shelf-flat\), inset 0 0 0 1px var\(--shelf-line\));/.exec(BRAND);
  assert.ok(compartida, 'cambió la sombra de tarjeta compartida: revisar la regla del catálogo');
  const base = compartida[1].split(',').map((p) => p.trim().replace(/\s+/g, ' '));

  const delCatalogo = capas(declaracion(BRAND, SELECTOR_GLOW));
  assert.deepEqual(
    delCatalogo.slice(0, base.length),
    base,
    'la regla del catálogo dejó de repetir la sombra compartida: las tarjetas del '
    + 'catálogo van a tener una sombra distinta a las del resto de la aplicación',
  );
  assert.equal(delCatalogo.length, base.length + 2, 'el brillo son exactamente dos capas rojas');
});

test('cada capa roja tiene respaldo: un token ausente no puede tumbar la sombra entera', () => {
  const rojas = capas(declaracion(BRAND, SELECTOR_GLOW)).slice(2);
  assert.equal(rojas.length, 2);
  for (const capa of rojas) {
    assert.match(capa, /var\(--card-glow, 0\)/, `la capa "${capa}" usa el token sin respaldo`);
    assert.match(capa, /rgb\(208 0 13 \//, `la capa "${capa}" dejó de usar el rojo de marca`);
    // Spread negativo: el brillo abraza la tarjeta en vez de derramarse sobre la
    // vecina, que es lo que convierte un acento en un neón.
    assert.match(capa, /-\d+px rgb/, `la capa "${capa}" perdió su spread negativo`);
  }
});

test('el brillo nunca sube tanto como para competir con el rojo de la acción', () => {
  const porcentajes = [...BRAND.matchAll(/var\(--card-glow, 0\) \* (\d+)%/g)].map((m) => Number(m[1]));
  assert.ok(porcentajes.length >= 4, 'faltan capas de brillo (reposo y estado activo)');
  for (const valor of porcentajes) {
    assert.ok(valor <= 40, `un alfa de ${valor}% deja de ser un acento y pasa a ser un glow`);
  }
});

test('sin JavaScript el token conserva un brillo fijo y discreto', () => {
  const declarado = /--card-glow:\s*([0-9.]+);/.exec(TOKENS);
  assert.ok(declarado, 'el token --card-glow dejó de tener valor por defecto');
  const valor = Number(declarado[1]);
  assert.ok(valor > 0, 'con el token en cero, la degradación sin JS es "no hay brillo"');
  assert.ok(valor < 1, 'el valor por defecto no puede ser el máximo: sin JS quedaría siempre encendido al tope');
});

test('lo agotado no brilla', () => {
  assert.match(
    BRAND,
    new RegExp(`${SELECTOR_GLOW.replace(/[[\]().*+?^$|\\{}]/g, '\\$&')}\\.out-of-stock \\{\\s*--card-glow: 0;`),
    'un producto que no se puede comprar volvió a llevar brillo',
  );
});

test('el brillo no agrega listeners y escribe cuantizado', () => {
  // El módulo tenía exactamente estos oyentes antes del brillo. Si aparece uno
  // más, el adorno dejó de ser gratis.
  // El `?\.` importa: `windowRef?.addEventListener?.('scroll', …)` y el de la
  // media query se registran con encadenamiento opcional, y un patrón sin él
  // los daba por inexistentes.
  const oyentes = [...MOTION.matchAll(/addEventListener\??\.?\('([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(oyentes)].sort(),
    ['change', 'keydown', 'keyup', 'pointercancel', 'pointerdown', 'pointerup', 'scroll'],
    'el brillo agregó un oyente nuevo en vez de colgarse del scroll que ya existía',
  );

  assert.match(MOTION, /GLOW_STEPS/, 'desapareció la cuantización del brillo');
  assert.match(
    MOTION,
    /if \(quantized === lastGlow\) return;/,
    'el brillo volvió a escribir en el DOM aunque el valor no haya cambiado',
  );
  assert.match(
    MOTION,
    /const applyCatalogGlow = \(\) => \{\s*if \([^)]*preference\.reduced\) return;/,
    'el brillo dejó de respetar la preferencia de movimiento reducido',
  );

  // Leer geometría dentro del callback de un MutationObserver fuerza un layout
  // sincrónico, y la góndola muta EN LOTE: ochenta tarjetas al filtrar o
  // buscar. El camino de las mutaciones tiene que aplazarse al próximo cuadro;
  // el del scroll ya corre dentro de uno.
  const desde = MOTION.indexOf('const collect = ');
  assert.notEqual(desde, -1, 'no se encontró `collect` en el módulo de movimiento');
  const cuerpoCollect = MOTION.slice(desde, MOTION.indexOf('};', desde));
  assert.match(
    cuerpoCollect,
    /scheduleCatalogGlow\(\);/,
    'la ruta de mutaciones volvió a calcular el brillo de forma sincrónica',
  );
  assert.doesNotMatch(
    cuerpoCollect,
    /[^e]applyCatalogGlow\(\);/,
    'la ruta de mutaciones lee geometría sin aplazar: eso fuerza un layout por lote',
  );
});
