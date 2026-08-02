import { addPosItem, createPosCart, pricePosCart } from '../core/pos-domain.js';

export function createPosCartStore(context) {
  let cart = createPosCart(context);
  const listeners = new Set();
  const publish = () => { for (const listener of listeners) listener(getSnapshot()); };
  const getSnapshot = () => JSON.parse(JSON.stringify(cart));
  return Object.freeze({
    getSnapshot,
    add(product, barcode, quantity = 1) { addPosItem(cart, product, barcode, quantity); publish(); return getSnapshot(); },
    remove(productId) { cart.items = cart.items.filter((item) => item.productId !== String(productId)); publish(); return getSnapshot(); },
    clear() { cart.items = []; cart.state = 'draft'; publish(); return getSnapshot(); },
    price(promotions = []) { return pricePosCart(cart, promotions); },
    setState(state) { cart.state = state; publish(); return getSnapshot(); },
    subscribe(listener) { listeners.add(listener); listener(getSnapshot()); return () => listeners.delete(listener); },
  });
}
