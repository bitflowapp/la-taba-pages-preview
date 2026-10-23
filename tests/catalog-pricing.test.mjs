/*
 * PRECIOS, COSTOS Y MÁRGENES DEL PANEL (js/business/catalog-pricing.js).
 *
 * Los ejemplos trabajados son los que se le explican al dueño: margen sobre
 * venta y recargo sobre costo NO son lo mismo, y los dos se redondean a dos
 * decimales a partir de centavos enteros.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  centsToApiString, describePricing, formatMoney, formatPercent, grossMarginOnSale, markupOnCost,
  parseMoneyText, priceForMargin, priceForMarkup, PRICING_EXPLANATION, promoDiscount, roundMoney, toCents,
  toPercent, unitProfit,
} from '../js/business/catalog-pricing.js';
import { containsForbiddenVocabulary, humanizeFailure } from '../js/business/business-operation-language.js';

const spaces = (text) => String(text).replace(/\s/g, ' ');

test('costo 1000 y precio 1500: margen 33,33 %, recargo 50 %, ganancia $ 500', () => {
  assert.equal(unitProfit(1500, 1000), 500);
  assert.equal(toPercent(grossMarginOnSale(1500, 1000)), 33.33);
  assert.equal(toPercent(markupOnCost(1500, 1000)), 50);
  assert.equal(spaces(formatPercent(grossMarginOnSale(1500, 1000))), '33,33 %');
  assert.equal(spaces(formatPercent(markupOnCost(1500, 1000))), '50 %');
});

test('costo 800 y precio 1000: margen 20 %, recargo 25 %, ganancia $ 200', () => {
  assert.equal(unitProfit(1000, 800), 200);
  assert.equal(toPercent(grossMarginOnSale(1000, 800)), 20);
  assert.equal(toPercent(markupOnCost(1000, 800)), 25);
});

test('precio por debajo del costo: margen negativo y aviso explícito', () => {
  assert.equal(unitProfit(900, 1000), -100);
  assert.equal(toPercent(grossMarginOnSale(900, 1000)), -11.11);
  assert.equal(toPercent(markupOnCost(900, 1000)), -10);
  const described = describePricing({ price: 900, cost: 1000 });
  assert.equal(described.belowCost, true);
  assert.equal(described.tone, 'danger');
  assert.match(spaces(described.warnings[0]), /^Precio menor al costo: perdés \$ 100 por unidad\.$/);
  assert.match(spaces(described.labels.margin), /^-11,11 %$/);
});

test('costo cero: el recargo no se puede calcular; el margen es 100 %', () => {
  assert.equal(markupOnCost(1500, 0), null);
  assert.equal(toPercent(grossMarginOnSale(1500, 0)), 100);
  const described = describePricing({ price: 1500, cost: 0 });
  assert.equal(described.markup, null);
  assert.equal(described.hasCost, true);
  assert.equal(spaces(described.labels.markup), 'No se calcula con costo $ 0');
});

test('sin costo o sin precio nada se inventa: null, nunca cero', () => {
  for (const missing of [null, undefined, '', 'abc', Number.NaN, -1]) {
    assert.equal(unitProfit(1500, missing), null, String(missing));
    assert.equal(grossMarginOnSale(1500, missing), null, String(missing));
    assert.equal(markupOnCost(1500, missing), null, String(missing));
    assert.equal(grossMarginOnSale(missing, 1000), null, String(missing));
  }
  assert.equal(grossMarginOnSale(0, 1000), null, 'sin precio no hay margen sobre venta');
  const noCost = describePricing({ price: 1500, cost: null });
  assert.equal(noCost.labels.profit, 'Sin costo');
  assert.equal(noCost.labels.margin, 'Sin costo');
  assert.equal(noCost.labels.markup, 'Sin costo');
  assert.match(noCost.labels.summary, /^Sin costo/);
  const noPrice = describePricing({ price: 0, cost: 1000 });
  assert.equal(noPrice.labels.margin, 'Sin precio');
  assert.match(noPrice.labels.summary, /Falta el precio de venta/);
  assert.deepEqual(describePricing().warnings, []);
});

test('precio para un margen y para un recargo: las cuentas inversas cierran', () => {
  assert.equal(priceForMargin(1000, 1 / 3), 1500);
  assert.equal(priceForMargin(800, 0.2), 1000);
  assert.equal(priceForMarkup(1000, 0.5), 1500);
  assert.equal(priceForMarkup(800, 0.25), 1000);
  // Redondeo a centavos, mitad hacia arriba: 999 / 0.7 = 1427,1428…
  assert.equal(priceForMargin(999, 0.3), 1427.14);
  assert.equal(priceForMarkup(10.01, 0.5), 15.02, '15,015 se redondea hacia arriba');
  assert.equal(priceForMargin(1000, 1), null, 'un margen de 100 % no tiene precio');
  assert.equal(priceForMargin(1000, 1.2), null);
  assert.equal(priceForMargin(null, 0.2), null);
  assert.equal(priceForMarkup(1000, -1.5), null);
  assert.equal(priceForMarkup(1000, null), null);
});

test('promo: descuento = (antes − ahora) / antes, sólo si el regular supera al de venta', () => {
  assert.equal(toPercent(promoDiscount(1500, 2000)), 25);
  assert.equal(promoDiscount(1500, 1500), null);
  assert.equal(promoDiscount(1500, 1000), null);
  assert.equal(promoDiscount(1500, null), null);
  const promo = describePricing({ price: 1500, cost: 1000, compareAtPrice: 2000 });
  assert.equal(spaces(promo.labels.promo), 'Antes $ 2.000 · 25 % menos');
  assert.equal(promo.promoValid, true);
  const fake = describePricing({ price: 1500, compareAtPrice: 1500 });
  assert.equal(fake.promoValid, false);
  assert.equal(fake.labels.promo, '');
  assert.match(fake.warnings.join(' '), /precio regular \(antes\) tiene que ser mayor/);
});

test('centavos enteros: sin ruido de punto flotante', () => {
  assert.equal(toCents(1.005), 101);
  assert.equal(toCents('1500.50'), 150050);
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.equal(toCents('1.234,50'), null, 'toCents no adivina separadores: eso es parseMoneyText');
  assert.equal(roundMoney(1234.565), 1234.57);
  assert.equal(unitProfit(0.3, 0.1), 0.2);
  assert.equal(centsToApiString(150000), '1500');
  assert.equal(centsToApiString(150050), '1500.50');
  assert.equal(centsToApiString(5), '0.05');
  assert.equal(centsToApiString(-1), null);
});

test('importes escritos: punto o coma decimal, y lo ambiguo se rechaza', () => {
  const cents = (text) => parseMoneyText(text).cents;
  const error = (text) => parseMoneyText(text).error;
  assert.deepEqual(parseMoneyText(''), { empty: true });
  assert.deepEqual(parseMoneyText('   '), { empty: true });
  assert.equal(cents('1500'), 150000);
  assert.equal(cents('$ 1500'), 150000);
  assert.equal(cents('1500,5'), 150050);
  assert.equal(cents('1500.50'), 150050);
  assert.equal(cents('0,99'), 99);
  assert.equal(cents('1.234,50'), 123450, 'punto de miles y coma decimal');
  assert.equal(cents('1,234.50'), 123450, 'coma de miles y punto decimal');
  assert.equal(cents('1.234.567'), 123456700, 'varios puntos sólo pueden ser de miles');
  assert.equal(cents('1.234.567,8'), 123456780);
  assert.equal(error('1.234'), 'ambiguous', 'un separador y tres dígitos: ¿mil doscientos o uno coma dos?');
  assert.equal(error('1,234'), 'ambiguous');
  assert.equal(error('999.999'), 'ambiguous');
  assert.equal(error('1234.567'), 'decimals', 'con cuatro cifras enteras no puede ser de miles');
  assert.equal(error('0,125'), 'decimals');
  assert.equal(error('1.234,567'), 'decimals');
  assert.equal(error('12.34,5'), 'grouping');
  assert.equal(error('1,234,5'), 'grouping');
  assert.equal(error('-100'), 'negative');
  assert.equal(error('1e3'), 'format');
  assert.equal(error('1 500'), 'format');
  assert.equal(error(',50'), 'format');
  assert.equal(error('15.'), 'format');
  assert.equal(error('99999999999'), 'range');
  assert.equal(cents('0'), 0, 'el cero se lee; quien llama decide si vale');
});

test('formatos de mostrador', () => {
  assert.equal(spaces(formatMoney(1500)), '$ 1.500');
  assert.equal(spaces(formatMoney(1500.5)), '$ 1.500,50');
  assert.equal(formatMoney(null), '');
  assert.equal(formatPercent(null), '');
  assert.equal(spaces(formatPercent(-0.00001)), '0 %');
});

test('el texto para el operador no usa vocabulario técnico', () => {
  const samples = [
    PRICING_EXPLANATION,
    ...Object.values(describePricing({ price: 900, cost: 1000, compareAtPrice: 800 }).labels),
    ...describePricing({ price: 900, cost: 1000, compareAtPrice: 800 }).warnings,
    ...Object.values(describePricing({ price: 1500, cost: 0, compareAtPrice: 2000 }).labels),
    ...Object.values(describePricing({ price: null, cost: null }).labels),
  ].filter(Boolean);
  for (const sample of samples) {
    assert.deepEqual(containsForbiddenVocabulary(sample), [], sample);
    assert.equal(humanizeFailure(sample, 'FALLBACK'), sample.replace(/\s+/g, ' ').trim(), sample);
  }
  assert.equal(PRICING_EXPLANATION, 'Margen: cuánto de cada venta es ganancia. Recargo: cuánto le sumás al costo.');
});
