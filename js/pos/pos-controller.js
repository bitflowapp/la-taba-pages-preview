export function createPosController({ cartStore, checkoutService, scanner } = {}) {
  if (!cartStore || !checkoutService) throw new Error('El controlador POS requiere carrito y checkout.');
  let lastResult = null;
  return Object.freeze({
    startScanner() { scanner?.start?.('pos_sale'); },
    stopScanner() { scanner?.stop?.(); },
    addProduct(product, barcode, quantity = 1) { return cartStore.add(product, barcode, quantity); },
    async confirm(options) {
      lastResult = await checkoutService.checkout(cartStore.getSnapshot(), options);
      if (lastResult.ok) cartStore.setState('confirmed');
      return lastResult;
    },
    getSnapshot() { return { cart: cartStore.getSnapshot(), lastResult }; },
  });
}
