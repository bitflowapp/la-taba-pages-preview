import { decrementCartItem } from '../cart.js';
import { mobbexStatusPresentation } from './mobbex-checkout.js';
import { getOrderRepository } from '../repositories/repository_factory.js';

/*
 * Retorno de Mobbex. Volver del checkout alojado NO prueba nada: esta página sólo le pregunta al servidor el estado
 * de la sesión que ESTE navegador mandó a pagar (el servidor lo confirma leyendo la operación en Mobbex) y lo muestra.
 * Nunca marca pagado, nunca crea un pedido y nunca limpia el carrito antes de que el servidor diga «completed».
 */

const POLL_INTERVAL_MS = 3_000;
const POLL_MAX_ATTEMPTS = 20;
const REJECTED_DETAIL = 'No se confirmó el pago. Tu carrito sigue como lo dejaste: podés volver a intentarlo con otro medio de pago.';

let attempts = 0;
let timer = null;
let completedCheckoutId = null;

async function start() {
  if (completedCheckoutId) return;
  const repository = getOrderRepository();
  if (typeof repository?.getMobbexCheckoutRecovery !== 'function') {
    show('No podemos verificar este pago desde acá. Volvé a La Taba para revisar tu carrito.', 'manual_review');
    return;
  }
  const recovery = repository.getMobbexCheckoutRecovery();
  if (!recovery?.checkoutSessionId) {
    show('No encontramos una sesión de pago en este navegador. Volvé a La Taba para revisar tu carrito.', 'manual_review');
    return;
  }
  await verify(repository, recovery.checkoutSessionId, recovery.items);
}

async function verify(repository, checkoutSessionId, items) {
  if (completedCheckoutId === checkoutSessionId) return;
  clearTimer();
  show('Verificando el pago', 'verifying');
  if (navigator.onLine === false) {
    show('Sin conexión. Conservamos tu carrito y verificaremos el pago al volver a conectarte.', 'pending');
    return;
  }
  const result = await repository.getMobbexCheckoutStatus(checkoutSessionId);
  if (completedCheckoutId === checkoutSessionId) return;
  if (!result?.ok || !result.checkout) {
    schedule(repository, checkoutSessionId, items);
    return;
  }
  const presentation = mobbexStatusPresentation(result.checkout);
  show(presentation.state === 'rejected' ? REJECTED_DETAIL : presentation.label, presentation.state, result.checkout);
  if (presentation.clearCart) {
    completedCheckoutId = checkoutSessionId;
    // El carrito y el registro los comparten todas las pestañas: sólo la que toma el registro descuenta lo pagado.
    if (take(repository, checkoutSessionId)) removeCompletedItems(items);
    return;
  }
  if (!presentation.terminal) schedule(repository, checkoutSessionId, items);
}

function take(repository, checkoutSessionId) {
  const current = repository.getMobbexCheckoutRecovery?.();
  if (!current || current.checkoutSessionId !== checkoutSessionId) return false;
  repository.clearMobbexCheckoutRecovery?.();
  return true;
}

function schedule(repository, checkoutSessionId, items) {
  if (attempts >= POLL_MAX_ATTEMPTS) {
    show('Seguimos verificando tu pago. Podés volver más tarde: no vamos a crear otro pedido.', 'pending');
    return;
  }
  attempts += 1;
  timer = window.setTimeout(() => verify(repository, checkoutSessionId, items), POLL_INTERVAL_MS);
}

function removeCompletedItems(items = []) {
  // Sólo se descuentan las unidades verificadas que se mandaron a pagar; lo agregado después en otra pestaña se conserva.
  for (const item of Array.isArray(items) ? items : []) {
    const productId = String(item?.productId || item?.product_id || '');
    const quantity = Math.max(0, Math.floor(Number(item?.quantity) || 0));
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
        ? 'Seguiremos escuchando la confirmación de Mobbex.'
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
