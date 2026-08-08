import { products, seedOrders } from '../js/data.js';
import { getState, setState } from '../js/state.js';

// Un pedido de delivery necesita un punto de entrega que el cliente confirmó.
// No es un detalle de estas pruebas: es el contrato, y una prueba que crea un
// delivery sin punto estaría ejercitando un pedido que la aplicación real —y la
// base— rechazan. Las cuatro claves van juntas porque juntas son la
// confirmación: coordenadas, cómo se obtuvieron y cuándo se aceptaron.
export const CONFIRMED_DELIVERY_POINT = Object.freeze({
  deliveryLatitude: -38.9539,
  deliveryLongitude: -68.0596,
  deliveryGeolocationAccuracy: 12,
  deliveryLocationSource: 'gps',
  deliveryLocationConfirmedAt: '2026-08-08T18:00:00.000Z',
});

export function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function resetState(overrides = {}) {
  setState({
    activeCategory: 'all',
    searchQuery: '',
    cart: [],
    comboSelections: [],
    orders: clone(seedOrders),
    products: clone(products),
    lastOrderId: null,
    adminUnlocked: false,
    lastCheckoutDraft: null,
    pendingReorder: null,
    ...overrides,
  });
}

export function state() {
  return getState();
}

export function makeTarget(selectorToDataset) {
  return {
    closest(selector) {
      const dataset = selectorToDataset[selector];
      return dataset ? { dataset } : null;
    },
  };
}
