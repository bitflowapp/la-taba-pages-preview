import assert from 'node:assert/strict';
import test from 'node:test';
import { assertLaunchCostApproval, assertLaunchTarget, assertLaunchOrganization } from '../scripts/launch/target.mjs';
import { assertRecoveryTarget } from '../scripts/recovery/plan.mjs';

const approval = { purpose: 'la-taba-launch-verification', approved: true,
  organizationId: 'qdhfqytbvgpvhxbbcomv', monthlyComputeUSD: 10,
  invoiceRecipient: 'current_billing_holder_of_Luna_Systems', commercialCostResponsible: 'Walter',
  billingConfirmed: true, taxAndUsageAcknowledged: true, paidAddonsAuthorized: false,
  productionPublicationAuthorized: false, realPaymentsAuthorized: false,
  approvedAt: '2026-10-21T03:00:00.000Z' };
const target = { purpose: approval.purpose, costApproval: approval,
  projectName: 'la-taba-launch', organizationId: approval.organizationId, organizationPlan: 'pro',
  infrastructureBudgetUSD: 10, environment: 'test', commercialPaymentsEnabled: false,
  mercadoPagoApplicationId: '4861627125869370', region: 'sa-east-1',
  projectRef: 'abcdefghijklmnopqrst', createdAt: '2026-10-21T03:01:00.000Z',
  checkoutOrigin: 'https://recovery-20261020.taba2-staging.pages.dev' };

test('launch target cannot pass on a willingness to pay or an incomplete cost/billing receipt', () => {
  assert.throws(() => assertLaunchCostApproval(undefined));
  for (const patch of [{ approved: false }, { billingConfirmed: false }, { taxAndUsageAcknowledged: false },
    { commercialCostResponsible: '' }, { invoiceRecipient: '' }, { monthlyComputeUSD: 25 },
    { realPaymentsAuthorized: true }, { productionPublicationAuthorized: true }, { paidAddonsAuthorized: true }]) {
    assert.throws(() => assertLaunchCostApproval({ ...approval, ...patch }));
  }
});

test('approved cost authorizes only the new named test project inside the confirmed billing organization', () => {
  assertLaunchCostApproval(approval); assertLaunchTarget(target);
  assert.throws(() => assertRecoveryTarget(target), /isolated test recovery/);
  for (const patch of [{ projectName: 'bitflow-production' }, { environment: 'production' },
    { commercialPaymentsEnabled: true }, { mercadoPagoApplicationId: '7677852968049976' },
    { organizationId: 'hliypylbqsgkdqvyzbvz' }, { createdAt: '2026-10-21T02:59:59Z' }]) {
    assert.throws(() => assertLaunchTarget({ ...target, ...patch }));
  }
});

test('an approval for a new project never admits Bitflow, APEX, Estela or a historical La Taba project', () => {
  for (const projectRef of ['enznqfzhikpasjzpvjfd','zvmfdlynnutxquktrgyl','udftddjacdsinscehlke',
    'wwcpogltfgzgkrlilbcd','ucbtjcurawxjwjdvvcvj','tkanbadcglszlcyfjvpv']) {
    assert.throws(() => assertRecoveryTarget({ ...target, projectRef }));
  }
});

test('the original Free receipt cannot acquire a paid budget by changing an environment field', () => {
  assert.throws(() => assertRecoveryTarget({ ...target, purpose: 'la-taba-recovery-test' }));
  assert.throws(() => assertRecoveryTarget({ ...target, costApproval: { ...approval, approved: false } }));
});

test('live organization mismatch blocks launch execution', () => {
  assertLaunchOrganization(target, { id: approval.organizationId, name: 'Luna Systems', plan: 'pro' });
  assert.throws(() => assertLaunchOrganization(target, { id: approval.organizationId, name: 'Luna Systems', plan: 'free' }));
  assert.throws(() => assertLaunchOrganization(target, { id: 'other', name: 'Luna Systems', plan: 'pro' }));
});
