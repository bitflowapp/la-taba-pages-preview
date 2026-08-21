export const ORDER_REPOSITORY_METHODS = Object.freeze([
  'createOrder',
  'getActiveOrder',
  'listOrders',
  'updateOrderStatus',
  'assignRider',
  'listActiveRiders',
  'listAvailableRiderOrders',
  'claimRiderOrder',
  'reassignRider',
  'confirmDelivery',
  'updateRiderLocation',
  'subscribeToOrder',
  'subscribeToBusinessOrders',
]);

export function assertOrderRepository(repository) {
  const missing = ORDER_REPOSITORY_METHODS.filter((method) => typeof repository?.[method] !== 'function');
  if (missing.length) {
    throw new Error(`Order repository incompleto: ${missing.join(', ')}`);
  }
  return repository;
}

export function repositoryResult(ok, payload = {}) {
  return {
    ok: Boolean(ok),
    ...payload,
  };
}
