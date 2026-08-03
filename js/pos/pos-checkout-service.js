import { buildPosCheckoutIntent, presentPosCompletion } from '../core/pos-domain.js';

export function createPosCheckoutService({ repository, isOnline = () => globalThis.navigator?.onLine !== false } = {}) {
  if (!repository?.checkout) throw new Error('POS requiere un repositorio de checkout autorizado.');
  return Object.freeze({
    async checkout(cart, options = {}) {
      const intent = buildPosCheckoutIntent(cart, options);
      if (!isOnline()) {
        return {
          ok: false,
          pending: true,
          intent,
          message: 'Borrador guardado. La venta no está confirmada hasta sincronizar.',
        };
      }
      const result = await repository.checkout(intent);
      return {
        ...result,
        completionLabel: presentPosCompletion({
          saleConfirmed: result?.ok,
          fiscalStatus: result?.data?.fiscal_status,
          cae: result?.data?.cae,
        }),
      };
    },
  });
}
