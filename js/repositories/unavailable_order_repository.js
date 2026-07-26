import { repositoryResult } from './order_repository.js';

const DEFAULT_MESSAGE = 'Los pedidos online no están disponibles por un problema de configuración.';

export function createUnavailableOrderRepository({ message = DEFAULT_MESSAGE } = {}) {
  const unavailable = () => repositoryResult(false, {
    code: 'ORDERING_UNAVAILABLE',
    message,
  });

  return {
    mode: 'unavailable',
    createOrder: unavailable,
    getActiveOrder() {
      return null;
    },
    listOrders() {
      return [];
    },
    updateOrderStatus: unavailable,
    assignRider: unavailable,
    listActiveRiders() {
      return repositoryResult(false, { riders: [], message });
    },
    listAvailableRiderOrders() {
      return repositoryResult(false, { orders: [], message });
    },
    claimRiderOrder: unavailable,
    reassignRider: unavailable,
    confirmDelivery: unavailable,
    updateRiderLocation: unavailable,
    subscribeToOrder(_orderId, callback) {
      if (typeof callback === 'function') callback(null);
      return () => {};
    },
    subscribeToBusinessOrders(callback) {
      if (typeof callback === 'function') callback([]);
      return () => {};
    },
  };
}
