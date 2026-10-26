import {
  decrementCartItem,
  decrementComboItem,
} from '../cart.js';
import { paymentStatusPresentation } from './mercadopago-checkout.js';
import { getOrderRepository } from '../repositories/repository_factory.js';

const POLL_INTERVAL_MS = 3_000;
const POLL_MAX_ATTEMPTS = 20;

const REJECTED_DETAIL = 'No se confirmó el pago. Tu carrito sigue como lo dejaste: podés volver a intentarlo con otro medio de pago.';

let attempts = 0;
let timer = null;
let completedCheckoutId = null;

async function start() {
  if (completedCheckoutId) return;
  const repository = getOrderRepository();
  if (typeof repository?.getMercadoPagoCheckoutRecovery !== 'function') {
    show('No podemos verificar este pago desde acá. Volvé a La Taba para revisar tu carrito.', 'manual_review');
    return;
  }
  const recovery = repository.getMercadoPagoCheckoutRecovery();
  if (!recovery?.checkoutSessionId) {
    show('No encontramos una sesión de pago en este navegador. Volvé a La Taba para revisar tu carrito.', 'manual_review');
    return;
  }
  await verify(repository, recovery.checkoutSessionId, recovery.combos, recovery.items);
}

async function verify(repository, checkoutSessionId, combos = [], originalItems = null) {
  if (completedCheckoutId === checkoutSessionId) return;
  clearTimer();
  show('Verificando el pago', 'verifying');
  if (navigator.onLine === false) {
    show('Sin conexión. Conservamos tu carrito y verificaremos el pago al volver a conectarte.', 'pending');
    return;
  }
  const result = await repository.getMercadoPagoCheckoutStatus(checkoutSessionId);
  if (completedCheckoutId === checkoutSessionId) return;
  if (!result?.ok || !result.checkout) {
    schedule(repository, checkoutSessionId, combos, originalItems);
    return;
  }
  const presentation = paymentStatusPresentation(result.checkout);
  show(
    presentation.state === 'rejected' ? REJECTED_DETAIL : presentation.label,
    presentation.state,
    result.checkout,
  );
  if (presentation.clearCart) {
    completedCheckoutId = checkoutSessionId;
    // The cart and the checkout record are shared by every tab; this tab's memory is not. Only the tab that takes the
    // record removes the paid units, so a second tab verifying the same payment cannot remove them again.
    if (await takeCompletedCheckoutRecord(repository, checkoutSessionId)) {
      removeCompletedCheckoutItems(result.checkout.items, combos, originalItems);
    }
    return;
  }
  if (!presentation.terminal) schedule(repository, checkoutSessionId, combos, originalItems);
}

async function takeCompletedCheckoutRecord(repository, checkoutSessionId) {
  const take = () => {
    const current = repository.getMercadoPagoCheckoutRecovery?.();
    if (!current || current.checkoutSessionId !== checkoutSessionId) return false;
    repository.clearMercadoPagoCheckoutRecovery?.();
    return true;
  };
  const locks = typeof navigator !== 'undefined' ? navigator.locks : null;
  if (locks && typeof locks.request === 'function') {
    try { return await locks.request('taba-mp-return-' + checkoutSessionId, take); } catch (_) { /* no lock: take it plainly */ }
  }
  return take();
}

function schedule(repository, checkoutSessionId, combos, originalItems) {
  if (attempts >= POLL_MAX_ATTEMPTS) {
    show('Seguimos verificando tu pago. Podés volver más tarde: no vamos a crear otro pedido.', 'pending');
    return;
  }
  attempts += 1;
  timer = window.setTimeout(() => verify(repository, checkoutSessionId, combos, originalItems), POLL_INTERVAL_MS);
}

function removeCompletedCheckoutItems(items, combos = [], originalItems = null) {
  // El servidor devuelve los combos ya expandidos a productos; los combos que
  // pagó esta sesión salen por identificador, con lo que el checkout guardó.
  for (const { comboId, quantity } of Array.isArray(combos) ? combos : []) {
    for (let index = 0; index < quantity; index += 1) decrementComboItem(comboId);
  }
  // Expanded server lines combine loose units and combo components. Only the
  // original loose selection can identify what to remove from the loose cart.
  // Old combo recoveries lack that selection: preserve loose units rather than
  // erase an unpaid addition. Old product-only recoveries retain their behavior.
  const loose = Array.isArray(originalItems) ? originalItems : combos.length ? [] : items;
  const purchased = new Map((Array.isArray(loose) ? loose : []).map((item) => [
    String(item?.productId || item?.product_id || ''),
    Math.max(0, Math.floor(Number(item?.quantity) || 0)),
  ]));
  // A second tab might have added something after checkout began. Remove only
  // the verified purchased quantities and preserve anything newer.
  for (const [productId, quantity] of purchased) {
    for (let index = 0; index < quantity; index += 1) decrementCartItem(productId);
  }
}

function show(message, state, checkout = null) {
  const title = document.querySelector('[data-payment-return-title]');
  const detail = document.querySelector('[data-payment-return-detail]');
  const status = document.querySelector('[data-payment-return-status]');
  const action = document.querySelector('[data-payment-return-action]');
  if (title) {
    title.textContent = state === 'completed'
      ? 'Pedido confirmado'
      : state === 'finalizing'
        ? 'Confirmando tu pedido'
        : state === 'pending'
          ? 'Pago pendiente'
          : state === 'manual_review'
            ? 'Necesitamos revisar este pago'
            : state === 'rejected'
              ? 'Pago rechazado'
              : 'Verificando el pago';
  }
  if (detail) detail.textContent = message;
  if (status) {
    status.dataset.state = state;
    status.textContent = state === 'completed' && checkout?.order_public_code
      ? `Pedido ${checkout.order_public_code}`
      : state === 'pending'
        ? 'Seguiremos escuchando la confirmación de Mercado Pago.'
        : state === 'manual_review'
          ? 'El negocio revisará el pago antes de preparar cualquier pedido.'
          : '';
  }
  if (action) {
    const completed = state === 'completed';
    action.textContent = completed ? 'Ver seguimiento' : 'Volver al carrito';
    action.href = completed ? '../../#tracking' : '../../#cart';
  }
}

function clearTimer() {
  if (timer) window.clearTimeout(timer);
  timer = null;
}

window.addEventListener('online', () => {
  attempts = 0;
  start();
});
window.addEventListener('pagehide', clearTimer);

start();
