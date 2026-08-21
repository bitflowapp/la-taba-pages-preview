import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cardPresentationLine,
  formatCapacity,
  packagingLabel,
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
  assert.equal(
    cardPresentationLine({ name: 'Coca-Cola Zero', presentation: 'Sin azúcar', capacityValue: 1500, capacityUnit: 'ml', unitsPerPack: 1 }),
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
