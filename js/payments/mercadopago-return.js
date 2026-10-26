import {
  clearCart,
  decrementCartItem,
  decrementComboItem,
  getCartItems,
} from '../cart.js';
import { paymentStatusPresentation } from './mercadopago-checkout.js';
import { getOrderRepository } from '../repositories/repository_factory.js';

const POLL_INTERVAL_MS = 3_000;
const POLL_MAX_ATTEMPTS = 20;

const REJECTED_DETAIL = 'No se confirmó el pago. Tu carrito sigue como lo dejaste: podés volver a intentarlo con otro medio de pago.';

let attempts = 0;
let timer = null;

async function start() {
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
  await verify(repository, recovery.checkoutSessionId, recovery.combos);
}

async function verify(repository, checkoutSessionId, combos = []) {
  clearTimer();
  show('Verificando el pago', 'verifying');
  if (navigator.onLine === false) {
    show('Sin conexión. Conservamos tu carrito y verificaremos el pago al volver a conectarte.', 'pending');
    return;
  }
  const result = await repository.getMercadoPagoCheckoutStatus(checkoutSessionId);
  if (!result?.ok || !result.checkout) {
    schedule(repository, checkoutSessionId, combos);
    return;
  }
  const presentation = paymentStatusPresentation(result.checkout);
  show(
    presentation.state === 'rejected' ? REJECTED_DETAIL : presentation.label,
    presentation.state,
    result.checkout,
  );
  if (presentation.clearCart) {
    removeCompletedCheckoutItems(result.checkout.items, combos);
    repository.clearMercadoPagoCheckoutRecovery?.();
    return;
  }
  if (!presentation.terminal) schedule(repository, checkoutSessionId, combos);
}

function schedule(repository, checkoutSessionId, combos) {
  if (attempts >= POLL_MAX_ATTEMPTS) {
    show('Seguimos verificando tu pago. Podés volver más tarde: no vamos a crear otro pedido.', 'pending');
    return;
  }
  attempts += 1;
  timer = window.setTimeout(() => verify(repository, checkoutSessionId, combos), POLL_INTERVAL_MS);
}

function removeCompletedCheckoutItems(items, combos = []) {
  // El servidor devuelve los combos ya expandidos a productos; los combos que
  // pagó esta sesión salen por identificador, con lo que el checkout guardó.
  for (const { comboId, quantity } of Array.isArray(combos) ? combos : []) {
    for (let index = 0; index < quantity; index += 1) decrementComboItem(comboId);
  }
  const purchased = new Map((Array.isArray(items) ? items : []).map((item) => [
    String(item?.product_id || ''),
    Math.max(0, Math.floor(Number(item?.quantity) || 0)),
  ]));
  const cart = getCartItems();
  const exactMatch = cart.length === purchased.size && cart.every((item) => (
    purchased.get(String(item.product.id)) === item.quantity
  ));
  if (exactMatch) {
    clearCart();
    return;
  }
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
