import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFiscalActivationStatus } from '../js/pos/fiscal-activation-status.js';

test('la configuración fiscal muestra todos los gates sin exponer secretos', () => {
  const status = buildFiscalActivationStatus({ environment: 'homologation', cuit: '20-12345678-9', point_of_sale: 5, tax_condition: 'monotributo' }, { metrics: { fiscal_documents_pending: 2 } });
  assert.equal(status.environment, 'homologation');
  assert.equal(status.cuitConfigured, 'sí');
  assert.equal(status.outboxPending, 2);
  assert.equal(status.accountingPolicy, 'ACCOUNTANT_POLICY_APPROVAL_PENDING');
  assert.match(status.certificatePresent, /worker privado/);
  assert.equal(Object.keys(status).some((key) => /secret|token|privateKeyValue|certificatePem/i.test(key)), false);
});

test('los indicadores del worker son sanitizados y la producción no se habilita desde el panel', () => {
  const status = buildFiscalActivationStatus({ environment: 'production', cuit: '20123456789' }, {}, {
    certificatePresent: true, privateKeyPresent: true, pairMatches: true, expiresAt: '2027-01-01T00:00:00.000Z',
    wsaaRelation: 'verified', wsfeRelation: 'verified', arcaConnection: 'verified', expiringSoon: false,
  });
  assert.equal(status.certificatePresent, 'sí');
  assert.equal(status.wsfev1Relation, 'verified');
  assert.equal(status.accountingPolicy, 'ACCOUNTANT_POLICY_APPROVAL_PENDING');
});
