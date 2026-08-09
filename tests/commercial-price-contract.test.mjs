import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  PRICE_PENDING_TITLE,
  confirmedPrice,
  isCommerciallyPurchasable,
  isPricePending,
  isStockPending,
  knownStock,
} from '../js/core/pricing.js';
import { isProductOrderable } from '../js/core/catalog-store.js';
import { productPriceLabel, productPricePresentation } from '../js/ui.js';
import { resolveCombo } from '../js/core/combos.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const vendible = (extra = {}) => ({
  id: 'p', sku: 'p', name: 'Producto', price: 3900, priceStatus: 'confirmed',
  pricePending: false, stock: 5, available: true, ...extra,
});

// ─── El contrato: precio ─────────────────────────────────────────────────────

test('«sin precio» y «vale cero» son estados distintos y ninguno se vende', () => {
  assert.equal(isPricePending(vendible()), false);
  assert.equal(isPricePending(vendible({ pricePending: true })), true);
  assert.equal(isPricePending(vendible({ priceStatus: 'pending' })), true);
  assert.equal(isPricePending(vendible({ price_status: 'pending' })), true);
  assert.equal(isPricePending(vendible({ price: 0 })), true);
  assert.equal(isPricePending(vendible({ price: null })), true);
  assert.equal(isPricePending(vendible({ price: undefined })), true);
  assert.equal(isPricePending(vendible({ price: '' })), true);
  assert.equal(isPricePending(vendible({ price: -1 })), true);
  assert.equal(isPricePending(vendible({ price: NaN })), true);
  assert.equal(isPricePending(null), true);
});

test('una fila incoherente del backend falla cerrada, no abierta', () => {
  // `price_status = confirmed` con precio 0 es una fila que el servidor ya no
  // deja quedar disponible, pero si llegara igual, la tienda no la vende.
  const incoherente = vendible({ priceStatus: 'confirmed', pricePending: false, price: 0 });
  assert.equal(isPricePending(incoherente), true);
  assert.equal(isCommerciallyPurchasable(incoherente), false);
  assert.equal(isProductOrderable(incoherente), false);
});

test('confirmedPrice devuelve null por ausencia, nunca cero', () => {
  assert.equal(confirmedPrice(vendible()), 3900);
  assert.equal(confirmedPrice(vendible({ price: 0 })), null);
  assert.equal(confirmedPrice(vendible({ pricePending: true })), null);
  assert.equal(confirmedPrice(vendible({ price: null })), null);
});

// ─── El contrato: stock ──────────────────────────────────────────────────────

test('stock desconocido y stock cero son estados distintos', () => {
  assert.equal(isStockPending(vendible({ stock: null })), true);
  assert.equal(isStockPending(vendible({ stock: undefined })), true);
  assert.equal(isStockPending(vendible({ stock: '' })), true);
  assert.equal(isStockPending(vendible({ stock: 0 })), false, 'cero es un dato, no una ausencia');
  assert.equal(knownStock(vendible({ stock: null })), null);
  assert.equal(knownStock(vendible({ stock: 0 })), 0);
  assert.equal(knownStock(vendible({ stock: 7 })), 7);
});

test('ni el stock desconocido ni el cero se pueden comprar', () => {
  assert.equal(isCommerciallyPurchasable(vendible()), true);
  assert.equal(isCommerciallyPurchasable(vendible({ stock: null })), false);
  assert.equal(isCommerciallyPurchasable(vendible({ stock: 0 })), false);
  assert.equal(isCommerciallyPurchasable(vendible({ available: false })), false);
  assert.equal(isCommerciallyPurchasable(vendible({ archived: true })), false);
});

// ─── Ninguna superficie escribe «$ 0» ────────────────────────────────────────

test('la presentación del precio siempre declara si está pendiente', () => {
  assert.equal(productPricePresentation(vendible()).pricePending, false);
  assert.equal(productPricePresentation(vendible({ price: 0 })).pricePending, true);
  assert.equal(productPricePresentation(vendible({ pricePending: true })).pricePending, true);
});

test('la etiqueta del precio dice el estado, no un cero', () => {
  assert.match(productPriceLabel(vendible()), /3\.900/);
  assert.equal(productPriceLabel(vendible({ price: 0 })), PRICE_PENDING_TITLE);
  assert.equal(productPriceLabel(vendible({ pricePending: true })), PRICE_PENDING_TITLE);
  assert.equal(productPriceLabel(vendible({ priceStatus: 'pending' })), PRICE_PENDING_TITLE);
  for (const producto of [
    vendible({ price: 0 }),
    vendible({ price: null }),
    vendible({ pricePending: true }),
  ]) {
    assert.doesNotMatch(productPriceLabel(producto), /\$\s*0\b/, 'ninguna variante puede escribir $ 0');
  }
});

test('nadie imprime el precio salteándose la presentación', () => {
  const ui = read('js/ui.js');
  // El atajo que había: formatear el resultado de la presentación en el mismo
  // renglón, sin mirar si estaba pendiente.
  assert.doesNotMatch(ui, /money\(\s*productPricePresentation\(/,
    'usá productPriceLabel: sabe distinguir pendiente de cero');
});

test('las cuatro superficies que escriben un número lo hacen detrás de una guarda', () => {
  const ui = read('js/ui.js');
  // `priceBlock` corta temprano.
  assert.match(ui, /function priceBlock\(product\) \{\s*\n\s*if \(isPricePending\(product\)\) \{/);
  // La tarjeta de la vidriera y el detalle eligen por rama.
  assert.match(ui, /const price = isPricePending\(product\)\s*\n\s*\? `<span class="home-price-pending">/);
  assert.match(ui, /\$\{isPricePending\(product\)\s*\n\s*\? `<div data-price-pending-message>/);
  // Y la guarda de compra pregunta por el contrato completo.
  assert.match(ui, /const outOfStock = !isCommerciallyPurchasable\(product\);/);
});

// ─── Combos y promociones ────────────────────────────────────────────────────

test('un combo con un componente sin precio no anuncia ningún número', () => {
  for (const roto of [
    { id: 'a', sku: 'a', price: 0, stock: 5, available: true, name: 'A' },
    { id: 'a', sku: 'a', price: null, stock: 5, available: true, name: 'A' },
    { id: 'a', sku: 'a', price: 1000, pricePending: true, stock: 5, available: true, name: 'A' },
  ]) {
    const combo = resolveCombo(
      { comboId: 'c', discountPercentage: 10, components: [{ sku: 'a', quantity: 2 }] },
      [roto],
    );
    assert.equal(combo.individualPrice, null);
    assert.equal(combo.promotionalPrice, null);
    assert.equal(combo.savings, null);
    assert.equal(combo.hasRealSaving, false);
    assert.equal(combo.available, false);
    assert.equal(combo.chargeable, false);
  }
});

// ─── El contrato del lado del servidor ───────────────────────────────────────

test('la tabla exige precio confirmado y mayor a cero para estar disponible', () => {
  const contrato = read('supabase/migrations/20260809060000_commercial_price_and_stock_contract.sql');
  assert.match(contrato, /add constraint products_available_requires_verification check/);
  assert.match(contrato, /and price_status = 'confirmed'/);
  assert.match(contrato, /and price > 0/);
  assert.match(contrato, /and stock is not null/);
  assert.match(contrato, /and stock > 0/);
});

test('la migración mide y remedia antes de endurecer', () => {
  const contrato = read('supabase/migrations/20260809060000_commercial_price_and_stock_contract.sql');
  // El insert de auditoría va ANTES del update que apaga, y los dos antes de
  // la restricción: si se endureciera primero, el ALTER fallaría y nadie sabría
  // cuántas filas estaban mal.
  const auditoria = contrato.indexOf('insert into public.commercial_contract_remediation');
  const apagado = contrato.indexOf('update public.products p\n   set available = false');
  const restriccion = contrato.indexOf('add constraint products_available_requires_verification');
  assert.ok(auditoria > 0 && apagado > auditoria && restriccion > apagado,
    `orden inesperado: auditoría=${auditoria} apagado=${apagado} restricción=${restriccion}`);
});

test('cargar un precio lo confirma, y marcarlo pendiente apaga la venta', () => {
  const batch = read('supabase/migrations/20260809070000_commercial_batch_price_status.sql');
  assert.match(batch, /when v_price is not null then 'confirmed'/);
  assert.match(batch, /when coalesce\(v_price_pending, false\) then 'pending'/);
  assert.match(batch, /else v_product\.price_status/, 'omitido preserva el estado');
  assert.match(batch, /Refusing to publish sku % without a confirmed price state/);
  // Y la disponibilidad que escribe nunca puede contradecir al contrato.
  assert.match(batch, /and v_next_price_status = 'confirmed'/);
});

test('el estado comercial se nombra en un solo lugar', () => {
  const contrato = read('supabase/migrations/20260809060000_commercial_price_and_stock_contract.sql');
  for (const estado of [
    'precio_pendiente', 'stock_pendiente', 'agotado',
    'no_publicado', 'publicable_no_publicado', 'comprable',
  ]) {
    assert.match(contrato, new RegExp(`'${estado}'`), `falta el estado ${estado}`);
  }
});

test('no se convirtió price en nullable sin demostrarlo', () => {
  const contrato = read('supabase/migrations/20260809060000_commercial_price_and_stock_contract.sql');
  assert.doesNotMatch(contrato, /alter column price drop not null/,
    'una migración a nullable exige medir impacto sobre las RPC que la leen');
  assert.match(contrato, /No convierte `price` en nullable/, 'y la decisión tiene que estar escrita');
});
