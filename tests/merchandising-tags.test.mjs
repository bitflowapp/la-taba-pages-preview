/*
 * El canal de merchandising que SÍ llega a producción.
 *
 * El motor de promociones está cableado a `isDemoMode()`: en la tienda real la
 * lista de promociones está vacía y no hay fuente que la llene. Las etiquetas,
 * en cambio, viajan de `products.tags` a la tarjeta y no tocan el precio. Este
 * archivo fija el vocabulario, que es cerrado a propósito.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ETIQUETAS_RECONOCIDAS,
  isFeaturedByMerchant,
  merchandisingBadge,
  tagSetOf,
} from '../js/core/merchandising-tags.js';

test('cada etiqueta del vocabulario dibuja su pastilla', () => {
  assert.equal(merchandisingBadge({ tags: ['lanzamiento'] }), 'Lanzamiento');
  assert.equal(merchandisingBadge({ tags: ['oferta-finde'] }), 'Oferta del finde');
  assert.equal(merchandisingBadge({ tags: ['promo'] }), 'Promo');
  assert.equal(merchandisingBadge({ tags: ['promoción'] }), 'Promo');
  assert.equal(merchandisingBadge({ tags: ['combo'] }), 'Combo');
  assert.equal(merchandisingBadge({ tags: ['destacado'] }), 'Destacado');
});

test('«popular» dice Recomendado, no «Más pedido»: no hay ranking que lo respalde', () => {
  // La tienda abrió hace días y el único pedido real no se entregó. Un rótulo
  // de más vendido sería una afirmación sobre datos que no existen.
  assert.equal(merchandisingBadge({ tags: ['popular'] }), 'Recomendado');
  assert.equal(merchandisingBadge({ tags: ['más vendido'] }), 'Recomendado');
  assert.equal(merchandisingBadge({ tags: ['mas vendido'] }), 'Recomendado');
});

test('el vocabulario es CERRADO: una etiqueta inventada no promete nada', () => {
  // Es lo que evita que el día que alguien escriba «2x1» la góndola prometa un
  // descuento que el checkout no va a cobrar.
  assert.equal(merchandisingBadge({ tags: ['2x1'] }), '');
  assert.equal(merchandisingBadge({ tags: ['oferta!!!'] }), '');
  assert.equal(merchandisingBadge({ tags: ['50% off'] }), '');
  assert.equal(merchandisingBadge({ tags: ['cola', 'gaseosa', 'sin-azucar'] }), '');
});

test('gana la primera del vocabulario, y el orden es el comercial', () => {
  assert.equal(merchandisingBadge({ tags: ['destacado', 'lanzamiento'] }), 'Lanzamiento');
  assert.equal(merchandisingBadge({ tags: ['popular', 'oferta-finde'] }), 'Oferta del finde');
});

test('mayúsculas, espacios y valores basura no rompen la lectura', () => {
  assert.equal(merchandisingBadge({ tags: ['  LANZAMIENTO '] }), 'Lanzamiento');
  assert.equal(merchandisingBadge({ tags: [null, '', 42, 'promo'] }), 'Promo');
  assert.equal(merchandisingBadge({ tags: 'promo' }), '', 'una cadena no es una lista de etiquetas');
  assert.equal(merchandisingBadge({}), '');
  assert.equal(merchandisingBadge(), '');
});

test('destacar es una decisión del comercio, y se puede preguntar', () => {
  assert.equal(isFeaturedByMerchant({ tags: ['destacado'] }), true);
  assert.equal(isFeaturedByMerchant({ tags: ['lanzamiento'] }), true);
  assert.equal(isFeaturedByMerchant({ tags: ['oferta-finde'] }), true);
  // Recomendado NO es lo mismo que destacado: la vidriera curada tiene su
  // propio mecanismo posicional (`recomendado-01..12`).
  assert.equal(isFeaturedByMerchant({ tags: ['popular'] }), false);
  assert.equal(isFeaturedByMerchant({ tags: ['gaseosa'] }), false);
});

test('tagSetOf normaliza y no repite', () => {
  assert.deepEqual([...tagSetOf({ tags: ['Promo', 'promo', ' PROMO '] })], ['promo']);
  assert.deepEqual([...tagSetOf({})], []);
});

test('las etiquetas reconocidas están documentadas y no se solapan con la vidriera curada', () => {
  assert.ok(ETIQUETAS_RECONOCIDAS.includes('lanzamiento'));
  assert.ok(ETIQUETAS_RECONOCIDAS.includes('oferta-finde'));
  // `recomendado-01..12` es OTRO canal —el orden del rail de la home— y no
  // puede dibujar una pastilla: si lo hiciera, los doce productos de la
  // vidriera aparecerían etiquetados como si fueran una oferta.
  for (const tag of ETIQUETAS_RECONOCIDAS) {
    assert.doesNotMatch(tag, /^recomendado-\d+$/);
  }
  assert.equal(merchandisingBadge({ tags: ['recomendado-01'] }), '');
});
