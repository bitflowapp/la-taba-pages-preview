// A separate paid-launch receipt is required. The Free recovery contract stays
// intact, and this path authorizes only a new project running test payments.
export const LAUNCH_ORGANIZATION_ID = 'qdhfqytbvgpvhxbbcomv';
export const LAUNCH_PURPOSE = 'la-taba-launch-verification';

export function assertLaunchCostApproval(approval) {
  if (approval?.purpose !== LAUNCH_PURPOSE || approval.approved !== true ||
    approval.organizationId !== LAUNCH_ORGANIZATION_ID || approval.monthlyComputeUSD !== 10 ||
    approval.invoiceRecipient !== 'current_billing_holder_of_Luna_Systems' ||
    approval.commercialCostResponsible !== 'Walter' || approval.billingConfirmed !== true ||
    approval.taxAndUsageAcknowledged !== true || approval.paidAddonsAuthorized !== false ||
    approval.productionPublicationAuthorized !== false || approval.realPaymentsAuthorized !== false ||
    !Number.isFinite(Date.parse(approval.approvedAt))) {
    throw new Error('Explicit compute cost, billing and limited-scope approval required');
  }
}

export function assertLaunchTarget(target) {
  assertLaunchCostApproval(target.costApproval);
  if (target.projectName !== 'la-taba-launch' || target.organizationId !== LAUNCH_ORGANIZATION_ID ||
    target.organizationPlan !== 'pro' || target.infrastructureBudgetUSD !== 10 ||
    target.environment !== 'test' || target.commercialPaymentsEnabled !== false ||
    target.mercadoPagoApplicationId !== '2691240967769590' || target.region !== 'sa-east-1' ||
    !Number.isFinite(Date.parse(target.createdAt)) ||
    Date.parse(target.createdAt) < Date.parse(target.costApproval.approvedAt)) {
    throw new Error('New paid verification target must match the approved launch receipt');
  }
}

export function assertLaunchOrganization(target, organization) {
  assertLaunchTarget(target);
  if (organization.id !== LAUNCH_ORGANIZATION_ID || organization.name !== 'Luna Systems' || organization.plan !== 'pro') {
    throw new Error('Launch organization does not match the approved billing destination');
  }
}
