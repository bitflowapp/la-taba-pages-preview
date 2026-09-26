import assert from 'node:assert/strict';
import test from 'node:test';
import { renderPaymentsSetupSurface, renderPaymentsSurface } from '../js/business/business-panel-render.js';
import { onlinePaymentsEnabled } from '../js/core/runtime-config.js';

const pilot = { repository: { deploymentEnvironment: 'pilot' } };

test('CONTROLLED_PRODUCTION (pilot) never offers to connect Mercado Pago', () => {
  assert.equal(onlinePaymentsEnabled(pilot), false);
  assert.equal(onlinePaymentsEnabled({ repository: { deploymentEnvironment: 'staging' } }), true);
  assert.equal(onlinePaymentsEnabled(null), true);
  const payments = renderPaymentsSurface({ payments: [], status: { phase: 'ready' }, manualPayments: [],
    manualStatus: { phase: 'ready' }, role: 'owner', onlinePayments: false });
  assert.doesNotMatch(payments, /data-mp-connection-action/);
  assert.doesNotMatch(payments, /Conectá tu cuenta/);
  assert.match(payments, /data-online-payments="disabled"/);
  assert.match(payments, /efectivo o por transferencia/);
  const setup = renderPaymentsSetupSurface({ role: 'owner', onlinePayments: false });
  assert.doesNotMatch(setup, /data-mp-connection-action|Conectar Mercado Pago/);
  // Default keeps the existing Staging/Production behaviour.
  assert.match(renderPaymentsSetupSurface({ role: 'owner' }), /data-mp-connection-action="connect"/);
});

test('CONTROLLED_PRODUCTION offers to connect Mercado Pago only when the deployment declares it', () => {
  assert.equal(onlinePaymentsEnabled({ ...pilot, payments: { online: true } }), true);
  for (const payments of [null, {}, { online: 'true' }, { online: 1 }, { online: false }, 'online']) {
    assert.equal(onlinePaymentsEnabled({ ...pilot, payments }), false, JSON.stringify(payments));
  }
  // Other environments are unchanged by the pilot switch.
  assert.equal(onlinePaymentsEnabled({ repository: { deploymentEnvironment: 'production' }, payments: { online: false } }), true);
});
