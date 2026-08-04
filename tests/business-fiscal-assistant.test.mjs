import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ARCA_HOMOLOGATION_PHRASE,
  ARCA_PRODUCTION_PHRASE,
  ARCA_STEPS,
  buildStatusBoard,
  evaluateArcaActivation,
  sanitizeFiscalDetail,
  translateFiscalError,
  validateHomologationAuthorization,
  validateProductionAuthorization,
} from '../js/business/business-fiscal-assistant.js';
import { containsForbiddenVocabulary } from '../js/business/business-operation-language.js';

const YEAR_AHEAD = new Date(Date.now() + 365 * 86_400_000).toISOString();

const READY = Object.freeze({
  legal_name: 'La Taba SRL',
  cuit: '30712345678',
  cuit_valid: true,
  tax_condition: 'Responsable Inscripto',
  business_address: 'Roca 123, Neuquén',
  accountant_review_status: 'approved',
  certificate_loaded: true,
  certificate_expires_at: YEAR_AHEAD,
  certificate_cuit_mismatch: false,
  delegation_status: 'verified',
  point_of_sale: 4,
  connection_ok_at: '2026-08-04T09:00:00.000Z',
  homologated_invoices: 1,
  homologated_credit_notes: 1,
  artifact_verified_at: '2026-08-04T09:30:00.000Z',
  print_verified_at: '2026-08-04T09:35:00.000Z',
  environment: 'homologation',
  pending_documents: 0,
  stalled_documents: 0,
});

test('el asistente tiene los diez pasos en el orden pedido', () => {
  assert.equal(ARCA_STEPS.length, 10);
  assert.deepEqual([...ARCA_STEPS], [
    'tax-data', 'accountant', 'certificate', 'delegation', 'point-of-sale',
    'connection', 'invoice-test', 'credit-note-test', 'print-test', 'production-lock',
  ]);
  const { steps } = evaluateArcaActivation(READY);
  assert.deepEqual(steps.map((step) => step.index), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('con todo verificado en pruebas, el décimo paso confirma que la facturación real sigue apagada', () => {
  const result = evaluateArcaActivation(READY);
  assert.equal(result.homologationComplete, true);
  assert.equal(result.productionEnabled, false);
  const lock = result.steps.find((step) => step.id === 'production-lock');
  assert.equal(lock.state, 'done');
  assert.match(lock.detail, /sigue apagada/i);
});

test('si la facturación real quedó encendida, el último paso pasa a bloqueado', () => {
  const result = evaluateArcaActivation({ ...READY, environment: 'production' });
  assert.equal(result.productionEnabled, true);
  assert.equal(result.steps.find((step) => step.id === 'production-lock').state, 'blocked');
  assert.equal(result.headline, 'La facturación real está habilitada');
});

test('un certificado vencido bloquea y se explica sin códigos', () => {
  const expired = new Date(Date.now() - 86_400_000).toISOString();
  const result = evaluateArcaActivation({ ...READY, certificate_expires_at: expired });
  assert.equal(result.steps.find((step) => step.id === 'certificate').state, 'current');
  assert.ok(result.blockers.some((blocker) => /vencido/i.test(blocker)));
  const board = result.board.find((row) => row.key === 'certificate');
  assert.equal(board.value, 'Vencido');
  assert.equal(board.tone, 'danger');
});

test('un certificado de otro CUIT no se deja pasar', () => {
  const result = evaluateArcaActivation({ ...READY, certificate_cuit_mismatch: true });
  assert.ok(result.blockers.some((blocker) => /otro CUIT/i.test(blocker)));
  assert.equal(result.board.find((row) => row.key === 'cuit').tone, 'danger');
});

test('el tablero muestra todo lo que el operador necesita ver de un vistazo', () => {
  const board = buildStatusBoard(READY);
  assert.deepEqual(board.map((row) => row.key), [
    'certificate', 'cuit', 'point-of-sale', 'delegation', 'last-document', 'queue', 'last-error', 'environment',
  ]);
  assert.equal(board.find((row) => row.key === 'cuit').value, '30-71234567-8');
  assert.equal(board.find((row) => row.key === 'point-of-sale').value, '4');
  assert.equal(board.find((row) => row.key === 'delegation').value, 'Verificado');
  assert.equal(board.find((row) => row.key === 'environment').value, 'Pruebas');
  for (const row of board) {
    assert.deepEqual(containsForbiddenVocabulary(`${row.label} ${row.value} ${row.detail}`), []);
  }
});

test('el tablero cuenta los comprobantes en espera sin nombrar la cola interna', () => {
  const board = buildStatusBoard({ ...READY, pending_documents: 3, stalled_documents: 2 });
  const queue = board.find((row) => row.key === 'queue');
  assert.equal(queue.label, 'Comprobantes en espera');
  assert.equal(queue.value, '3');
  assert.equal(queue.tone, 'danger');
  assert.deepEqual(containsForbiddenVocabulary(queue.detail), []);
});

test('las pruebas con ARCA exigen la frase exacta de autorización', () => {
  assert.equal(validateHomologationAuthorization('').ok, false);
  assert.equal(validateHomologationAuthorization('i_authorize_arca_homologation').ok, false);
  assert.equal(validateHomologationAuthorization(ARCA_HOMOLOGATION_PHRASE).ok, true);
  assert.match(validateHomologationAuthorization('si').message, /I_AUTHORIZE_ARCA_HOMOLOGATION/);
});

test('la facturación real exige una autorización distinta de la de pruebas', () => {
  assert.notEqual(ARCA_PRODUCTION_PHRASE, ARCA_HOMOLOGATION_PHRASE);
  assert.equal(validateProductionAuthorization(ARCA_HOMOLOGATION_PHRASE).ok, false);
  assert.equal(validateProductionAuthorization(ARCA_PRODUCTION_PHRASE).ok, true);
});

test('los errores de ARCA se traducen a algo accionable', () => {
  assert.match(translateFiscalError('CERTIFICATE_EXPIRED'), /venció/i);
  assert.match(translateFiscalError('DELEGATION_MISSING'), /autorizar el servicio/i);
  assert.match(translateFiscalError('ALGO_NUEVO'), /soporte/i);
  for (const code of ['CERTIFICATE_EXPIRED', 'SERVICE_UNAVAILABLE', 'ALGO_NUEVO']) {
    assert.deepEqual(containsForbiddenVocabulary(translateFiscalError(code)), []);
  }
});

test('nunca se filtra la clave privada, el ticket de acceso ni el intercambio técnico', () => {
  // Los marcadores se arman en tiempo de ejecución para no dejar material sensible literal en el repo.
  const pemHeader = `${'-'.repeat(5)}BEGIN ${['PRIVATE', 'KEY'].join(' ')}${'-'.repeat(5)}`;
  assert.equal(sanitizeFiscalDetail('<soap:Envelope><FECAESolicitar/></soap:Envelope>'), '');
  assert.equal(sanitizeFiscalDetail(`${pemHeader}abc`), '');
  assert.equal(sanitizeFiscalDetail('Bearer eyJhbGciOi'), '');
  assert.equal(sanitizeFiscalDetail('token=abc123'), '');
  assert.equal(sanitizeFiscalDetail('El punto de venta no está habilitado.'), 'El punto de venta no está habilitado.');
});

test('todos los pasos hablan en castellano llano', () => {
  for (const snapshot of [READY, {}, { ...READY, environment: 'production' }]) {
    for (const step of evaluateArcaActivation(snapshot).steps) {
      assert.deepEqual(
        containsForbiddenVocabulary(`${step.title} ${step.why} ${step.todo} ${step.detail}`),
        [],
        `paso ${step.id}`,
      );
    }
  }
});

test('un negocio sin configurar no puede empezar a probar', () => {
  const result = evaluateArcaActivation({});
  assert.equal(result.readyToHomologate, false);
  assert.equal(result.currentStep, 'tax-data');
  assert.equal(result.headline, 'Falta configurar la facturación');
});
