import test from 'node:test';
import assert from 'node:assert/strict';

import {
  presentOrderFiscalStatus,
  sanitizeFiscalErrorMessage,
} from '../js/pos/fiscal-status-presenter.js';

test('presentOrderFiscalStatus: unbilled order allows billing and shows "Sin facturar"', () => {
  const presented = presentOrderFiscalStatus();
  assert.equal(presented.label, 'Sin facturar');
  assert.equal(presented.canBill, true);
  assert.equal(presented.canPrint, false);
});

test('presentOrderFiscalStatus: queued state shows "Emitiendo…"', () => {
  const presented = presentOrderFiscalStatus({
    document: { state: 'queued' },
  });
  assert.equal(presented.label, 'Emitiendo…');
  assert.equal(presented.canBill, false);
  assert.equal(presented.tone, 'info');
});

test('presentOrderFiscalStatus: worker in-flight states show "Verificando con ARCA…"', () => {
  for (const state of ['leased', 'claiming', 'authenticating', 'authorizing', 'retry_wait', 'ambiguous']) {
    const presented = presentOrderFiscalStatus({
      document: { state },
    });
    assert.equal(presented.label, 'Verificando con ARCA…', `state ${state} should display "Verificando con ARCA…"`);
    assert.equal(presented.canBill, false);
    assert.equal(presented.tone, 'warning');
  }
});

test('presentOrderFiscalStatus: authorized invoice shows "Factura emitida." with CAE and reprint capability', () => {
  const presented = presentOrderFiscalStatus({
    document: {
      state: 'authorized',
      cae: '74291849102847',
      document_number: 1842,
    },
  });
  assert.equal(presented.label, 'Factura emitida.');
  assert.equal(presented.cae, '74291849102847');
  assert.equal(presented.documentNumber, 1842);
  assert.equal(presented.canBill, false);
  assert.equal(presented.canReprint, true);
  assert.equal(presented.tone, 'success');
});

test('presentOrderFiscalStatus: printing states respect PC connectivity and spooling lifecycle', () => {
  const doc = { state: 'authorized', cae: '74291849102847', document_number: 1842 };

  // 1. Pending print with active agent
  const pendingOnline = presentOrderFiscalStatus({
    document: doc,
    printJob: { status: 'queued' },
    agentOnline: true,
  });
  assert.equal(pendingOnline.label, 'Impresión pendiente.');
  assert.equal(pendingOnline.tone, 'info');

  // 2. Pending print with disconnected PC
  const pendingOffline = presentOrderFiscalStatus({
    document: doc,
    printJob: { status: 'queued' },
    agentOnline: false,
  });
  assert.equal(pendingOffline.label, 'PC desconectada.');
  assert.equal(pendingOffline.tone, 'warning');

  // 3. Sent to printer / printing
  const sent = presentOrderFiscalStatus({
    document: doc,
    printJob: { status: 'printing' },
    agentOnline: true,
  });
  assert.equal(sent.label, 'Enviado a impresora.');
  assert.equal(sent.tone, 'success');

  // 4. Printed
  const printed = presentOrderFiscalStatus({
    document: doc,
    printJob: { status: 'printed' },
    agentOnline: true,
  });
  assert.equal(printed.label, 'Enviado a impresora.');
});

test('presentOrderFiscalStatus: errors and reviews show "Requiere revisión." without exposing raw SOAP/XML', () => {
  for (const state of ['rejected', 'failed', 'manual_review', 'dead_letter', 'blocked']) {
    const presented = presentOrderFiscalStatus({
      document: {
        state,
        errors: '<soap:Fault><faultcode>soap:Server</faultcode><faultstring>Internal Error</faultstring></soap:Fault>',
      },
    });
    assert.equal(presented.label, 'Requiere revisión.');
    assert.equal(presented.canBill, false);
    assert.doesNotMatch(presented.description, /<soap|<fault/i, 'No raw XML or SOAP should be visible to user');
  }
});

test('sanitizeFiscalErrorMessage strips XML, SOAP, and network stacks cleanly', () => {
  const xml = '<xml><error>10016: CUIT invalido</error></xml>';
  assert.equal(sanitizeFiscalErrorMessage(xml), 'ARCA devolvió un error que requiere revisión de configuración.');

  const net = 'connect ECONNREFUSED 127.0.0.1:8080';
  assert.equal(sanitizeFiscalErrorMessage(net), 'Sin conexión con el servicio fiscal. Se reintentará automáticamente.');

  const clean = 'Punto de venta no configurado para el comercio.';
  assert.equal(sanitizeFiscalErrorMessage(clean), 'Punto de venta no configurado para el comercio.');
});
