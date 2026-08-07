import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  FISCAL_DOCUMENT_STATES,
  FISCAL_PUBLIC_STATES,
  FISCAL_PUBLIC_STATE_LABELS,
  fiscalPublicState,
} from '../js/core/fiscal-domain.js';
import { presentFiscalStatus } from '../js/pos/fiscal-status-presenter.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = join(root, 'supabase', 'migrations', '20260807110000_arca_fiscal_automation_contract.sql');
const VALID_CAE = '75123456789012';

// ─── La UI dice exactamente cinco cosas ────────────────────────────────────

test('las cinco palabras son las pedidas y no hay una sexta', () => {
  assert.deepEqual([...FISCAL_PUBLIC_STATES].sort(), ['attention', 'authorized', 'pending', 'processing', 'rejected']);
  assert.deepEqual(
    FISCAL_PUBLIC_STATES.map((state) => FISCAL_PUBLIC_STATE_LABELS[state]).sort(),
    ['Autorizado', 'Pendiente', 'Procesando', 'Rechazado', 'Requiere atención'].sort(),
  );
});

test('ningún estado real del backend queda fuera de las cinco palabras', () => {
  for (const state of FISCAL_DOCUMENT_STATES) {
    assert.ok(
      FISCAL_PUBLIC_STATES.includes(fiscalPublicState(state, VALID_CAE)),
      `con CAE, "${state}" tiene que caer en una de las cinco`,
    );
    assert.ok(
      FISCAL_PUBLIC_STATES.includes(fiscalPublicState(state, '')),
      `sin CAE, "${state}" tiene que caer en una de las cinco`,
    );
  }
  // Un estado que la base todavía no tiene se trata como problema, no como éxito.
  assert.equal(fiscalPublicState('un_estado_que_no_existe', VALID_CAE), 'attention');
});

test('nunca se dice autorizado —ni emitido— sin un CAE de catorce dígitos', () => {
  for (const state of ['authorized', 'credited', 'observed']) {
    assert.equal(fiscalPublicState(state, ''), 'attention');
    assert.equal(fiscalPublicState(state, '123'), 'attention');
    assert.equal(fiscalPublicState(state, '7512345678901'), 'attention', 'trece dígitos no son un CAE');
    assert.equal(fiscalPublicState(state, `${VALID_CAE}9`), 'attention', 'quince dígitos tampoco');
    assert.equal(fiscalPublicState(state, VALID_CAE), 'authorized');
  }
});

test('ninguna etiqueta ni detalle del presentador promete una emisión', () => {
  const forbidden = /emitid|factura autorizada|comprobante emitido/i;
  for (const state of [...FISCAL_DOCUMENT_STATES, 'not_requested', 'inventado']) {
    for (const cae of ['', '123', VALID_CAE]) {
      const presented = presentFiscalStatus({ state, cae });
      assert.doesNotMatch(presented.label, forbidden, `la etiqueta de "${state}" no puede prometer una emisión`);
      assert.doesNotMatch(presented.detail, forbidden, `el detalle de "${state}" no puede prometer una emisión`);
      assert.equal(presented.label, FISCAL_PUBLIC_STATE_LABELS[presented.publicState]);
      if (presented.canPrintFiscal) {
        assert.match(cae, /^\d{14}$/, `"${state}" no puede habilitar impresión fiscal sin CAE`);
      }
    }
  }
});

test('sin solicitud fiscal la UI dice pendiente en tono neutro y no imprime', () => {
  const presented = presentFiscalStatus({});
  assert.equal(presented.publicState, 'pending');
  assert.equal(presented.tone, 'neutral');
  assert.equal(presented.canPrintFiscal, false);
});

// ─── El Panel muestra la palabra, no el estado crudo del backend ───────────

test('la tarjeta fiscal del Panel no imprime el estado interno del backend', () => {
  const source = readFileSync(join(root, 'js', 'business', 'business-operations-center.js'), 'utf8');
  const start = source.indexOf('function renderFiscalDocument(');
  assert.ok(start > 0, 'la tarjeta fiscal sigue existiendo');
  const card = source.slice(start, source.indexOf('\nfunction ', start + 10));
  assert.ok(card.includes('escapeHtml(status.label)'), 'el chip muestra una de las cinco palabras');
  assert.ok(
    !/business-status \$\{status\.tone\}">\$\{escapeHtml\(document\.state/.test(card),
    'el chip no puede volver a mostrar document.state crudo',
  );
});

// ─── Servidor y pantalla no pueden discrepar ───────────────────────────────

// Evalúa la proyección tal como está escrita en la migración. Si alguien cambia
// una rama del SQL sin tocar el JS (o al revés), esta prueba lo encuentra.
function sqlPublicState(functionBody, state, cae) {
  const branches = [...functionBody.matchAll(/when\s+([\s\S]*?)\s+then\s+'([a-z_]+)'/g)];
  assert.ok(branches.length >= 5, 'la función SQL sigue teniendo ramas reconocibles');
  for (const [, condition, result] of branches) {
    const states = [...condition.matchAll(/'([a-z_]+)'/g)]
      .map((match) => match[1])
      .filter((value) => !/^\^/.test(value));
    const requiresCae = /p_cae/.test(condition) && !/not/.test(condition);
    if (!states.includes(state)) continue;
    if (requiresCae && !/^\d{14}$/.test(cae)) continue;
    return result;
  }
  return 'attention';
}

test('la proyección de la base y la del navegador coinciden estado por estado', () => {
  const migration = readFileSync(MIGRATION, 'utf8');
  const start = migration.indexOf('$fiscal_public_state$');
  const body = migration.slice(start, migration.indexOf('$fiscal_public_state$', start + 10));
  assert.ok(body.includes('case'), 'la función SQL se pudo aislar');
  for (const state of FISCAL_DOCUMENT_STATES) {
    for (const cae of ['', VALID_CAE]) {
      assert.equal(
        fiscalPublicState(state, cae),
        sqlPublicState(body, state, cae),
        `"${state}" con CAE "${cae || 'vacío'}" tiene que verse igual en la base y en la pantalla`,
      );
    }
  }
});

test('la migración declara la proyección y el estado manual_review', () => {
  const migration = readFileSync(MIGRATION, 'utf8');
  assert.match(migration, /create or replace function public\.fiscal_public_state/);
  assert.match(migration, /'manual_review'/);
  for (const state of FISCAL_DOCUMENT_STATES) {
    assert.ok(migration.includes(`'${state}'`), `la migración conoce el estado "${state}"`);
  }
});
