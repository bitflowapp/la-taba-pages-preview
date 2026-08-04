import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyPrinterProbe,
  classifyPrintSubmission,
  classifyQrCheck,
  classifyScannerCheck,
  classifySpoolerCheck,
  describeDeviceState,
  DEVICE_CHECKS,
  DEVICE_STATES,
  summarizeDeviceChecks,
} from '../js/business/business-device-check.js';
import { containsForbiddenVocabulary } from '../js/business/business-operation-language.js';

test('los cinco dispositivos pedidos están cubiertos', () => {
  assert.deepEqual(DEVICE_CHECKS.map((check) => check.id), ['scanner', 'thermal', 'a4', 'qr', 'spooler']);
});

test('los estados son exactamente los seis honestos más "sin probar"', () => {
  assert.deepEqual([...DEVICE_STATES], [
    'connected', 'no-response', 'no-paper', 'job-sent', 'not-verifiable', 'error', 'untested',
  ]);
  assert.equal(describeDeviceState('connected').label, 'Conectado');
  assert.equal(describeDeviceState('no-response').label, 'Sin respuesta');
  assert.equal(describeDeviceState('no-paper').label, 'Sin papel');
  assert.equal(describeDeviceState('job-sent').label, 'Trabajo enviado');
  assert.equal(describeDeviceState('not-verifiable').label, 'Impresión no verificable');
  assert.equal(describeDeviceState('error').label, 'Error');
});

test('un trabajo aceptado por Windows nunca se declara impreso', () => {
  const spooled = classifyPrintSubmission({ status: 'sent_to_spooler' });
  assert.equal(spooled.state, 'job-sent');
  assert.match(spooled.detail, /Mirá la impresora/i);
  assert.notEqual(describeDeviceState(spooled.state).label, 'Conectado');

  assert.equal(classifyPrintSubmission({ status: 'queued' }).state, 'job-sent');
  assert.equal(classifyPrintSubmission({ status: 'unknown' }).state, 'not-verifiable');
  assert.equal(classifyPrintSubmission({ status: 'failed' }).state, 'error');
  assert.equal(classifyPrintSubmission({}).state, 'not-verifiable');
});

test('sólo una confirmación real de la impresora cuenta como impresión verificada', () => {
  assert.equal(classifyPrintSubmission({ status: 'completed_when_verifiable' }).state, 'connected');
});

test('el estado de la impresora se traduce sin inventar lo que Windows no dice', () => {
  assert.equal(classifyPrinterProbe({ reachable: true, outOfPaper: false, error: false, queuedJobs: 0 }).state, 'connected');
  assert.equal(classifyPrinterProbe({ reachable: true, outOfPaper: true }).state, 'no-paper');
  assert.equal(classifyPrinterProbe({ reachable: false }).state, 'no-response');
  assert.equal(classifyPrinterProbe({ reachable: true, error: true }).state, 'error');
  assert.equal(classifyPrinterProbe({}).state, 'not-verifiable');
  assert.equal(classifyPrinterProbe(null).state, 'no-response');
});

test('el lector se declara conectado sólo cuando entrega una lectura completa', () => {
  assert.equal(classifyScannerCheck({ isValid: true, format: 'EAN-13', normalizedValue: '7790895000997' }).state, 'connected');
  assert.equal(classifyScannerCheck({ isValid: false, reason: 'INVALID_CHECK_DIGIT' }).state, 'error');
  assert.equal(classifyScannerCheck({ isValid: false, reason: 'DUPLICATE_SCAN' }).state, 'connected');
  assert.equal(classifyScannerCheck(null).state, 'untested');
  assert.match(classifyScannerCheck({ isValid: false, reason: 'NON_NUMERIC_GTIN' }).detail, /configuración del lector/i);
});

test('la cola de impresión distingue no responder de no tener impresoras', () => {
  assert.equal(classifySpoolerCheck(null).state, 'no-response');
  assert.equal(classifySpoolerCheck([]).state, 'error');
  const ok = classifySpoolerCheck([{ name: 'EPSON TM-T20' }, { name: 'HP LaserJet' }]);
  assert.equal(ok.state, 'connected');
  assert.deepEqual(ok.printers, ['EPSON TM-T20', 'HP LaserJet']);
});

test('el QR probado no se da por leído: se pide confirmarlo con el celular', () => {
  const rendered = classifyQrCheck(true);
  assert.equal(rendered.state, 'connected');
  assert.match(rendered.detail, /celular/i);
  assert.equal(classifyQrCheck(false).state, 'error');
  assert.equal(classifyQrCheck(undefined).state, 'untested');
});

test('el resumen prioriza lo que no funciona y habla en castellano llano', () => {
  const blocked = summarizeDeviceChecks({ thermal: { state: 'no-response' }, scanner: { state: 'connected' } });
  assert.equal(blocked.tone, 'critical');
  assert.match(blocked.headline, /no están funcionando/i);

  const warned = summarizeDeviceChecks({ thermal: { state: 'no-paper' } });
  assert.equal(warned.tone, 'attention');

  const untested = summarizeDeviceChecks({});
  assert.equal(untested.tone, 'calm');
  assert.match(untested.headline, /Todavía no probaste/i);

  for (const row of blocked.rows) {
    assert.deepEqual(containsForbiddenVocabulary(`${row.label} ${row.proves} ${row.howTo} ${row.meaning}`), []);
  }
});
