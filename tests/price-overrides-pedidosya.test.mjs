import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GONDOLA, precioDeVenta } from '../catalog/gondola-neuquen.mjs';
import {
  DECISION_COMERCIAL,
  ESTADO,
  OVERRIDES,
  overrideDeclarado,
  precioOverride,
} from '../catalog/price-overrides-pedidosya-20261010.mjs';

const POR_SKU = new Map(GONDOLA.map((p) => [p.sku, p]));

test('el override arranca pendiente: sin aprobación comercial no cambia ningún precio', () => {
  assert.equal(ESTADO, 'PENDIENTE_APROBACION_COMERCIAL');
  for (const o of OVERRIDES) {
    assert.equal(precioOverride(o.sku), null, o.sku);
  }
  for (const p of GONDOLA) {
    assert.equal(
      p.price,
      precioDeVenta({ costoMayorista: p.costoMayorista, unitsPerPack: p.unitsPerPack, soldAsPack: p.soldAsPack }),
      `${p.sku}: con el override pendiente el precio debe seguir siendo el de la fórmula`,
    );
  }
});

test('el alcance son exactamente los 7 SKU con equivalencia exacta, y todos existen en la góndola', () => {
  const skus = OVERRIDES.map((o) => o.sku).sort();
  assert.deepEqual(skus, [
    'andes-origen-rubia-lata-473ml',
    'budweiser-lata-473ml',
    'fernet-1882-750ml',
    'fernet-branca-1000ml',
    'gancia-lima-limon-lata-473ml',
    'quilmes-stout-lata-473ml',
    'stella-artois-lata-473ml',
  ]);
  for (const o of OVERRIDES) {
    assert.ok(POR_SKU.has(o.sku), `${o.sku} no está en la góndola`);
  }
});

test('el Corona Extra 330 ml (ambiguo) no tiene override', () => {
  assert.equal(overrideDeclarado('corona-extra-botella-330ml'), null);
  assert.equal(precioOverride('corona-extra-botella-330ml', 'APROBADO_COMERCIAL'), null);
});

test('aprobado, cada override aplica su precio de PedidosYa sin margen adicional y sólo a su SKU', () => {
  for (const o of OVERRIDES) {
    assert.equal(precioOverride(o.sku, 'APROBADO_COMERCIAL'), o.precio, o.sku);
    const costo = POR_SKU.get(o.sku).costoMayorista;
    assert.ok(o.precio > costo, `${o.sku}: el precio de referencia queda por debajo del costo`);
  }
  assert.equal(precioOverride('stones-maracuya-473ml', 'APROBADO_COMERCIAL'), null);
});

test('los precios de referencia coinciden con la planilla del 2026-10-10 (sin oferta)', () => {
  const esperado = {
    'andes-origen-rubia-lata-473ml': 3840,
    'budweiser-lata-473ml': 3345,
    'quilmes-stout-lata-473ml': 2999,
    'stella-artois-lata-473ml': 4635,
    'gancia-lima-limon-lata-473ml': 3239,
    'fernet-branca-1000ml': 27585,
    'fernet-1882-750ml': 11880,
  };
  for (const [sku, precio] of Object.entries(esperado)) {
    assert.equal(overrideDeclarado(sku).precio, precio, sku);
  }
});

test('la decisión del titular aprueba los 7 precios como objetivo y deja la aplicación productiva bloqueada', () => {
  assert.equal(DECISION_COMERCIAL.precios_objetivo, 'APROBADOS');
  assert.equal(DECISION_COMERCIAL.aplicacion_productiva, 'BLOQUEADA');
  assert.ok(DECISION_COMERCIAL.condiciones_para_desbloquear.length >= 3);
  assert.notEqual(ESTADO, 'APROBADO_COMERCIAL', 'no activar la aplicación productiva sin desbloquear');
  assert.equal(precioOverride(OVERRIDES[0].sku), null);
});

test('activar el override cambia EXACTAMENTE los 7 SKU y ningún otro precio de la góndola', () => {
  // Recalculo de control: aplica el override en modo aprobado y compara contra la fórmula.
  const cambiados = [];
  for (const p of GONDOLA) {
    const formula = precioDeVenta({ costoMayorista: p.costoMayorista, unitsPerPack: p.unitsPerPack, soldAsPack: p.soldAsPack });
    const conOverride = precioOverride(p.sku, 'APROBADO_COMERCIAL') ?? formula;
    if (conOverride !== formula) cambiados.push(p.sku);
  }
  assert.deepEqual(cambiados.sort(), OVERRIDES.map((o) => o.sku).sort());
});
