import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { presentFiscalReasons, presentOrderFiscalState } from '../js/business/order-fiscal-presenter.js';

// WhatsApp contesta desde la base (private.whatsapp_reason_text / whatsapp_state_text); el Panel,
// desde js/business/order-fiscal-presenter.js. Tienen que decir LO MISMO: si alguien cambia un
// texto en un lado y no en el otro, esta prueba lo frena.

const ROOT = path.resolve(import.meta.dirname, '..');
const SQL = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20260927120000_whatsapp_fiscal_channel.sql'), 'utf8');

function functionBody(name) {
  const start = SQL.indexOf(`create or replace function private.${name}(`);
  assert.ok(start >= 0, `falta private.${name}`);
  const tag = /as (\$[a-z_]*\$)/.exec(SQL.slice(start))[1];
  const open = SQL.indexOf(tag, start) + tag.length;
  return SQL.slice(open, SQL.indexOf(tag, open));
}

function pairs(body, pattern) {
  return [...body.matchAll(pattern)].map((match) => [match[1], match[2]]);
}

test('cada razón dice en WhatsApp lo mismo que en el Panel', () => {
  const body = functionBody('whatsapp_reason_text');
  const reasons = pairs(body.slice(body.indexOf('v_text := case v_code')), /when '([A-Z_]+)' then '([^']+)'/g);
  assert.ok(reasons.length >= 16, `se leyeron ${reasons.length} razones`);
  for (const [code, text] of reasons) {
    assert.deepEqual(presentFiscalReasons([{ code }]), [text], code);
  }
  const moments = pairs(body.slice(body.indexOf("p_reason->>'billing_moment'"), body.indexOf("if v_code = 'PAYMENT_REQUIRED'")), /when '([a-z_]+)' then '([^']+)'/g);
  assert.equal(moments.length, 3);
  for (const [moment, text] of moments) {
    assert.deepEqual(presentFiscalReasons([{ code: 'ORDER_NOT_BILLABLE_YET', billing_moment: moment }]), [text], moment);
  }
  const payments = pairs(body.slice(body.indexOf("p_reason->>'payment_state'"), body.indexOf('v_text := case v_code')), /when '([a-z_]+)' then '([^']+)'/g);
  assert.equal(payments.length, 4);
  for (const [state, text] of payments) {
    assert.deepEqual(presentFiscalReasons([{ code: 'PAYMENT_REQUIRED', payment_state: state }]), [text], state);
  }
  // Un código desconocido tampoco se inventa en ninguno de los dos.
  assert.match(body, /else 'Revisión fiscal necesaria' end;/);
  assert.deepEqual(presentFiscalReasons([{ code: 'ALGO_NUEVO' }]), ['Revisión fiscal necesaria']);
});

test('cada estado del comprobante se nombra igual en WhatsApp y en el Panel', () => {
  const body = functionBody('whatsapp_state_text');
  const labels = body.slice(body.indexOf('v_label := case'), body.indexOf("else 'Requiere revisión' end;"));
  const mapping = [];
  for (const match of labels.matchAll(/when v_state (?:= '([a-z_]+)'|in \(([^)]+)\)) then '([^']+)'/g)) {
    const states = match[1] ? [match[1]] : match[2].split(',').map((value) => value.trim().replace(/'/g, ''));
    for (const state of states) mapping.push([state, match[3]]);
  }
  assert.ok(mapping.length >= 6, `se leyeron ${mapping.length} estados`);
  for (const [state, label] of mapping) {
    const document = { id: 'd', state, environment: 'homologation', document_type: 6, point_of_sale: 6, document_number: 1, cae: '74000000000001', artifact_id: null };
    const view = presentOrderFiscalState({ readiness: { status: 'ALREADY_REQUESTED', reasons: [] }, document, print: null });
    assert.equal(view.label, label, state);
  }
  assert.match(body, /'HOMOLOGACIÓN · sin validez fiscal'/, 'la marca de homologación es la misma');
  assert.match(body, /'CAE de homologación '/);
});
