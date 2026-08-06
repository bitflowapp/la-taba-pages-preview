import { products, seedOrders } from '../js/data.js';
import { getState, setState } from '../js/state.js';

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
