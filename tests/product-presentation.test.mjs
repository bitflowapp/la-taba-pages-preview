import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cardPresentationLine,
  cardTitle,
  formatCapacity,
  packagingLabel,
  productAccessibleName,
} from '../js/core/product-presentation.js';

/*
 * La línea de presentación de la tarjeta (hallazgo A2 de la auditoría de UX
 * del go-live): la góndola tiene que decir el litraje, y decirlo como lo lee
 * una persona. Estos casos son el contrato del helper; si alguien lo cambia,
 * que sea a propósito.
 */

test('formatCapacity: mililitros chicos quedan en ml, desde 1000 pasa a litros con coma', () => {
  assert.equal(formatCapacity(473, 'ml'), '473 ml');
  assert.equal(formatCapacity(500, 'ml'), '500 ml');
  assert.equal(formatCapacity(1000, 'ml'), '1 L');
  assert.equal(formatCapacity(1250, 'ml'), '1,25 L');
  assert.equal(formatCapacity(1500, 'ml'), '1,5 L');
  assert.equal(formatCapacity(2000, 'ml'), '2 L');
  assert.equal(formatCapacity(2250, 'ml'), '2,25 L');
});

test('formatCapacity: litros directos y unidades desconocidas no se rompen', () => {
  assert.equal(formatCapacity(1.5, 'l'), '1,5 L');
  assert.equal(formatCapacity(750, 'ml'), '750 ml');
  assert.equal(formatCapacity(1, 'unidad'), '1 unidad');
});

test('formatCapacity: sin capacidad válida devuelve vacío, nunca basura', () => {
  assert.equal(formatCapacity(0), '');
  assert.equal(formatCapacity(null), '');
  assert.equal(formatCapacity('no-numero'), '');
  assert.equal(formatCapacity(-100), '');
});

test('packagingLabel: los slugs de base no se filtran a la pantalla', () => {
  assert.equal(packagingLabel('botella-pet'), 'Botella PET');
  assert.equal(packagingLabel('lata'), 'Lata');
  assert.equal(packagingLabel('botella-vidrio'), 'Botella de vidrio');
  assert.equal(packagingLabel('sifon'), 'Sifón');
  assert.equal(packagingLabel(''), '');
  // Un slug nuevo desconocido se capitaliza sin guiones: legible, no perfecto.
  assert.equal(packagingLabel('caja-carton'), 'Caja carton');
});

test('unidad: capacidad primero, variante sólo si agrega información', () => {
  // El título ya dice «Zero»: repetir «Sin azúcar» debajo es decir dos veces lo
  // mismo y gastar el renglón que necesita la capacidad.
  assert.equal(
    cardPresentationLine({ name: 'Coca-Cola Zero', presentation: 'Sin azúcar', capacityValue: 1500, capacityUnit: 'ml', unitsPerPack: 1 }),
    '1,5 L',
  );
  // Pero si el nombre NO lo dice, la variante entra: es lo único que la
  // distingue de la versión con azúcar.
  assert.equal(
    cardPresentationLine({ name: 'Manaos Cola', presentation: 'Sin azúcar', capacityValue: 1500, capacityUnit: 'ml', unitsPerPack: 1 }),
    '1,5 L · Sin azúcar',
  );
  // «Naranja» ya está en el nombre: repetirla sería ruido.
  assert.equal(
    cardPresentationLine({ name: 'Fanta Naranja', presentation: 'Naranja', capacityValue: 2250, capacityUnit: 'ml', unitsPerPack: 1 }),
    '2,25 L',
  );
  // La redundancia se detecta sin acentos ni mayúsculas.
  assert.equal(
    cardPresentationLine({ name: 'Limonada clásica', presentation: 'CLÁSICA', capacityValue: 1500, capacityUnit: 'ml' }),
    '1,5 L',
  );
});

test('pack: se nombra el pack y la capacidad ES la de cada envase', () => {
  assert.equal(
    cardPresentationLine({ name: 'Brahma Chopp', presentation: 'Rubia', capacityValue: 473, capacityUnit: 'ml', unitsPerPack: 6 }),
    'Pack x6 · 473 ml',
  );
  assert.equal(
    cardPresentationLine({ name: 'Coca-Cola Original', presentation: 'Original', capacityValue: 500, capacityUnit: 'ml', unitsPerPack: 12 }),
    'Pack x12 · 500 ml',
  );
});

test('sin capacidad conocida cae a la variante sola: nunca peor que antes', () => {
  assert.equal(
    cardPresentationLine({ name: 'Coca-Cola', presentation: 'Sin azúcar' }),
    'Sin azúcar',
  );
  assert.equal(cardPresentationLine({ name: 'Coca-Cola Zero', presentation: 'Zero' }), '');
  assert.equal(cardPresentationLine({}), '');
});

test('la capacidad no se dice dos veces cuando la variante ES la capacidad', () => {
  // Las 4 unidades minoristas del 2026-08-19 llevan variant='500 ml' / '1,5 L'.
  assert.equal(
    cardPresentationLine({ name: 'Coca-Cola Original', presentation: '500 ml', capacityValue: 500, capacityUnit: 'ml', unitsPerPack: 1 }),
    '500 ml',
  );
  assert.equal(
    cardPresentationLine({ name: 'Fanta Naranja', presentation: '1,5 L', capacityValue: 1500, capacityUnit: 'ml', unitsPerPack: 1 }),
    '1,5 L',
  );
  // También cuando la variante trae la forma cruda de la base.
  assert.equal(
    cardPresentationLine({ name: 'Sprite', presentation: '1500 ml', capacityValue: 1500, capacityUnit: 'ml', unitsPerPack: 1 }),
    '1,5 L',
  );
  // Y sin capacidad conocida se dice una vez, no ninguna.
  assert.equal(cardPresentationLine({ name: 'Sprite', presentation: '500 ml' }), '500 ml');
});

test('una UNIDAD tampoco arrastra la ficha técnica cruda de la base', () => {
  /*
   * Había regla para el pack y ninguna para la unidad, así que el catálogo
   * importado imprimía «1,5 L · Botella PET · 1,5 L · Unidad»: el litraje dos
   * veces, el envase que la góndola no nombra, y la palabra «Unidad», que no
   * informa nada. Ninguna prueba lo veía porque afirmaban «contiene 1,5 L» y
   * «contiene Botella PET», y las dos son ciertas sobre la línea rota.
   */
  assert.equal(
    cardPresentationLine({
      name: 'Coca-Cola Original',
      variant: 'Botella PET · 1,5 L · Unidad',
      capacityValue: 1500,
      capacityUnit: 'ml',
      unitsPerPack: 1,
      packageType: 'botella-pet',
    }),
    '1,5 L',
  );
  // Una variante DE VERDAD es una palabra, no una lista, y esa sí entra.
  assert.equal(
    cardPresentationLine({
      name: 'Villavicencio', variant: 'Con gas', capacityValue: 500, capacityUnit: 'ml', unitsPerPack: 1,
    }),
    '500 ml · Con gas',
  );
});

test('el pack no arrastra la ficha técnica cruda de la base', () => {
  // Los 4 packs previos traen variant/presentation con todo pegado.
  assert.equal(
    cardPresentationLine({
      name: 'Coca-Cola Original',
      presentation: 'Botella PET · 500 ml · Pack x12',
      capacityValue: 500,
      capacityUnit: 'ml',
      unitsPerPack: 12,
    }),
    'Pack x12 · 500 ml',
  );
});

test('catálogos sin campos estructurados caen a la etiqueta de unidad de siempre', () => {
  assert.equal(cardPresentationLine({ name: 'Demo pack', unitLabel: 'Pack x12' }), 'Pack x12');
  assert.equal(cardPresentationLine({ name: 'Demo suelto', unitLabel: 'Unidad' }), '');
});

test('la variante «Unidad» no es información y no se imprime', () => {
  assert.equal(
    cardPresentationLine({ name: 'Agua', presentation: 'Unidad', capacityValue: 2250, capacityUnit: 'ml' }),
    '2,25 L',
  );
});

test('los 12 SKU de la góndola final salen legibles', async () => {
  const { PRODUCTOS_PROPUESTOS } = await import('../catalog/gondola-retail-final-proposal.mjs');
  for (const p of PRODUCTOS_PROPUESTOS) {
    const linea = cardPresentationLine({
      name: p.name,
      presentation: p.variant,
      capacityValue: p.capacityValue,
      capacityUnit: p.capacityUnit,
      unitsPerPack: p.unitsPerPack,
    });
    assert.ok(linea.length > 0, `${p.externalId} quedó sin línea de presentación`);
    assert.ok(!/pet|-/.test(linea.toLowerCase().replace('coca-cola', '')), `${p.externalId} filtra un slug: «${linea}»`);
    if (p.soldAsPack) assert.match(linea, /^Pack x6 · 473 ml/);
    else assert.match(linea, /L\b/);
  }
});

test('el título no repite un atributo del envase que la presentación ya dice', () => {
  // El catálogo entrega el nombre de Villavicencio como «Villavicencio Sin gas»
  // y el de Benedictino como «Benedictino», los dos con variant «Sin gas». Dos
  // aguas del mismo estante, con el mismo dato, escritas distinto.
  const villavicencio = {
    name: 'Villavicencio Sin gas', variant: 'Sin gas',
    capacityValue: 1500, capacityUnit: 'ml', unitsPerPack: 1, packageType: 'botella-pet',
  };
  assert.equal(cardTitle(villavicencio), 'Villavicencio');
  assert.equal(cardPresentationLine(villavicencio), '1,5 L · Sin gas');

  const benedictino = {
    name: 'Benedictino', variant: 'Sin gas',
    capacityValue: 2250, capacityUnit: 'ml', unitsPerPack: 1, packageType: 'botella-pet',
  };
  assert.equal(cardTitle(benedictino), 'Benedictino');
  assert.equal(cardPresentationLine(benedictino), '2,25 L · Sin gas');
});

test('un SABOR es el producto y NO se recorta del título', () => {
  // «Aquarius Manzana» no es un Aquarius con un atributo: es el producto.
  // Recortarlo arruinaría el reconocimiento, que es lo que la tarjeta da en un
  // segundo.
  const aquarius = {
    name: 'Aquarius Manzana', variant: 'Manzana',
    capacityValue: 1500, capacityUnit: 'ml', unitsPerPack: 1, packageType: 'botella-pet',
  };
  assert.equal(cardTitle(aquarius), 'Aquarius Manzana');
  assert.equal(cardPresentationLine(aquarius), '1,5 L');
});

test('«Original» sale del título: lo que distingue es que NO diga Zero', () => {
  assert.equal(cardTitle({ name: 'Coca-Cola Original' }), 'Coca-Cola');
  assert.equal(cardTitle({ name: 'Coca-Cola' }), 'Coca-Cola');
  assert.equal(cardTitle({ name: 'Coca-Cola Zero' }), 'Coca-Cola Zero');
  // Un nombre que ES el atributo no se queda vacío.
  assert.equal(cardTitle({ name: 'Original' }), 'Original');
  assert.equal(cardTitle({ name: '' }), '');
  assert.equal(cardTitle({}), '');
});

test('el envase entra en la presentación sólo cuando cambia lo que llega', () => {
  const lata = { name: 'Sprite', variant: 'Original', capacityValue: 354, capacityUnit: 'ml', unitsPerPack: 1, packageType: 'lata' };
  assert.equal(cardPresentationLine(lata), '354 ml · Lata');
  // La botella PET es la convención de la góndola: decirla en veinte tarjetas
  // de veintitrés sería gastar el renglón en la constante.
  const pet = { name: 'Sprite', variant: 'Original', capacityValue: 2250, capacityUnit: 'ml', unitsPerPack: 1, packageType: 'botella-pet' };
  assert.equal(cardPresentationLine(pet), '2,25 L');
  const sifon = { name: 'Soda Manaos', variant: 'Soda', capacityValue: 2000, capacityUnit: 'ml', unitsPerPack: 1, packageType: 'sifon' };
  assert.equal(cardPresentationLine(sifon), '2 L · Sifón');
});

test('el nombre accesible distingue variantes: dos «Agregar Coca-Cola» no alcanzan', () => {
  const familiar = { name: 'Coca-Cola', variant: 'Original', capacityValue: 2250, capacityUnit: 'ml', unitsPerPack: 1, packageType: 'botella-pet' };
  const litro = { name: 'Coca-Cola Original', variant: 'Original', capacityValue: 1500, capacityUnit: 'ml', unitsPerPack: 1, packageType: 'botella-pet' };
  assert.equal(productAccessibleName(familiar), 'Coca-Cola 2,25 L');
  assert.equal(productAccessibleName(litro), 'Coca-Cola 1,5 L');
  assert.notEqual(productAccessibleName(familiar), productAccessibleName(litro));
});
