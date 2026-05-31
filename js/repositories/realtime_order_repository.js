import { getRealtimeStatus } from '../realtime.js';

export function createRealtimeOrderRepository(baseRepository) {
  return {
    ...baseRepository,
    mode: 'demo-realtime',
    getTransportStatus() {
      return getRealtimeStatus();
    },
  };
}
