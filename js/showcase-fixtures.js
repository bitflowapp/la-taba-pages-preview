import { addToCart, clearCart } from './cart.js';
import { getBusinessConfig } from './core/business-config-store.js';
import { isProductOrderable } from './core/catalog-store.js';
import { getState } from './state.js';
import { pauseSimulation, startSimulation } from './simulation.js';
import { isShowcaseMode } from './core/showcase-mode.js';
import {
  getOrderRepository,
  isSandboxOrderRepository,
} from './repositories/repository_factory.js';
import { DEMO_CUSTOMER_DESTINATION } from './core/business-location.js';

// Producto que el recorrido guiado usa para mostrar el estado "precio
// pendiente". Antes era el pack x4 de Red Bull; desde la publicación minorista
// ese pack abastece al local y no está en góndola, así que el ejemplo pasa a
// ser una unidad real esperando precio — que es el caso que hoy más importa.
export const SHOWCASE_PENDING_PRODUCT_ID = 'coca-cola-original-pet-1500ml';

export const SHOWCASE_SYNTHETIC_CUSTOMER = Object.freeze({
  name: 'Cliente de demostración',
  phone: '2990000000',
  streetAddress: 'Calle Ficticia 100',
  neighborhood: 'Ciudad Demo',
  reference: 'Referencia de demostración',
  // Un pedido de delivery necesita punto confirmado, también en la
  // demostración. Se usa el destino demo del contrato de ubicación —una plaza,
  // un espacio público— para que la demo nunca muestre dónde vive nadie.
  latitude: DEMO_CUSTOMER_DESTINATION.lat,
  longitude: DEMO_CUSTOMER_DESTINATION.lng,
  locationSource: 'map_pin',
  locationConfirmedAt: '2026-08-08T18:00:00.000Z',
});

const ORDER_SCENARIOS = Object.freeze({
  'business-new': 'received',
  'business-manage': 'preparing',
  rider: 'ready',
  'tracking-map': 'on_the_way',
  delivered: 'delivered',
  recovery: 'preparing',
});

export async function prepareShowcaseScenario(scenarioId, {
  repository = getOrderRepository(),
} = {}) {
  if (!isShowcaseMode()) {
    return failure('SHOWCASE_DISABLED', 'El recorrido local no está activado.');
  }
  if (!isSandboxOrderRepository(repository)) {
    return failure('SHOWCASE_REPOSITORY_INVALID', 'El recorrido requiere el repositorio local aislado.');
  }

  if (['cart', 'checkout', 'delivery-options'].includes(scenarioId)) {
    const cartResult = prepareSyntheticCart();
    if (!cartResult.ok) return cartResult;
    const persisted = await persistShowcaseState(repository);
    return persisted.ok
      ? { ...cartResult, scenarioId }
      : persisted;
  }

  const targetStatus = ORDER_SCENARIOS[scenarioId];
  if (!targetStatus) {
    return { ok: true, scenarioId, message: 'Vista local preparada.' };
  }

  const orderResult = await createSyntheticOrder(repository);
  if (!orderResult.ok) return orderResult;
  const orderId = orderResult.order.id;

  const transitions = targetTransitions(targetStatus);
  for (const transition of transitions) {
    const result = await applyTransition(repository, orderId, transition);
    if (!result?.ok) {
      return failure(
        'SHOWCASE_TRANSITION_FAILED',
        result?.message || `No se pudo preparar el estado ${transition}.`,
      );
    }
  }

  if (targetStatus === 'on_the_way') {
    const simulation = startSimulation();
    if (!simulation.ok) return failure('SHOWCASE_ROUTE_FAILED', simulation.message);
  }

  const order = getState().orders.find((candidate) => candidate.id === orderId);
  if (!order || order.status !== targetStatus) {
    return failure('SHOWCASE_STATE_MISMATCH', 'El escenario local no quedó en el estado esperado.');
  }

  const persisted = await persistShowcaseState(repository);
  if (!persisted.ok) return persisted;

  return {
    ok: true,
    scenarioId,
    orderId,
    status: order.status,
    message: scenarioMessage(scenarioId),
  };
}

export function isShowcaseFixtureOrder(order) {
  return Boolean(
    order
      && order.customerName === SHOWCASE_SYNTHETIC_CUSTOMER.name
      && order.customerPhone === SHOWCASE_SYNTHETIC_CUSTOMER.phone,
  );
}

async function createSyntheticOrder(repository) {
  pauseSimulation();
  const reset = await repository.resetSandbox();
  if (!reset?.ok) return failure('SHOWCASE_RESET_FAILED', reset?.message || 'No se pudo reiniciar la demostración.');

  const cart = prepareSyntheticCart();
  if (!cart.ok) return cart;

  const created = await repository.createOrder({
    customerName: SHOWCASE_SYNTHETIC_CUSTOMER.name,
    customerPhone: SHOWCASE_SYNTHETIC_CUSTOMER.phone,
    customerAddress: `${SHOWCASE_SYNTHETIC_CUSTOMER.streetAddress}, ${SHOWCASE_SYNTHETIC_CUSTOMER.neighborhood}`,
    customerStreetAddress: SHOWCASE_SYNTHETIC_CUSTOMER.streetAddress,
    customerNeighborhood: SHOWCASE_SYNTHETIC_CUSTOMER.neighborhood,
    customerReference: SHOWCASE_SYNTHETIC_CUSTOMER.reference,
    deliveryLatitude: SHOWCASE_SYNTHETIC_CUSTOMER.latitude,
    deliveryLongitude: SHOWCASE_SYNTHETIC_CUSTOMER.longitude,
    deliveryLocationSource: SHOWCASE_SYNTHETIC_CUSTOMER.locationSource,
    deliveryLocationConfirmedAt: SHOWCASE_SYNTHETIC_CUSTOMER.locationConfirmedAt,
    deliveryMode: 'delivery',
    paymentMethod: 'coordinate',
    customerNotes: 'Pedido sintético del modo demostración local',
    ageConfirmed: true,
    previewOnly: false,
  });

  const order = created?.order || getState().orders.find((candidate) => !candidate.internalSeed);
  if (!created?.ok || !order) {
    return failure('SHOWCASE_ORDER_FAILED', created?.message || 'No se pudo crear el pedido sintético.');
  }
  return { ok: true, order };
}

function prepareSyntheticCart() {
  clearCart();
  // La elegibilidad sale del contrato del carrito (`isProductOrderable`), no de
  // una lista propia: repetirla acá hacía que el recorrido eligiera un pack de
  // abastecimiento —que existe en el catálogo interno pero no se vende— y el
  // paso fallara al agregarlo.
  const product = getState().products.find((candidate) => (
    isProductOrderable(candidate) && candidate.alcoholic !== true
  ));
  if (!product) return failure('SHOWCASE_PRODUCT_MISSING', 'No hay un producto demo disponible.');
  // Cantidad, no precio: el recorrido tiene que llegar al checkout, y con una
  // sola unidad del producto más accesible el carrito queda bajo el mínimo de
  // delivery. Antes alcanzaba con una porque el primer elegible era un pack de
  // proveedor; hoy la góndola es de unidades.
  const minimum = Number(getBusinessConfig().minDeliveryOrder) || 0;
  const unitPrice = Number(product.price) || 0;
  const needed = minimum > 0 && unitPrice > 0 ? Math.ceil(minimum / unitPrice) : 1;
  const quantity = Math.max(1, Math.min(needed, Number(product.stock) || 1));
  const result = addToCart(product.id, quantity);
  if (!result.ok) return failure('SHOWCASE_CART_FAILED', result.message);
  return {
    ok: true,
    productId: product.id,
    quantity,
    message: 'Carrito sintético preparado.',
  };
}

function targetTransitions(status) {
  if (status === 'received') return [];
  if (status === 'preparing') return ['preparing'];
  if (status === 'ready') return ['preparing', 'ready'];
  if (status === 'on_the_way') return ['preparing', 'ready', 'claim', 'on_the_way'];
  if (status === 'delivered') {
    return ['preparing', 'ready', 'claim', 'on_the_way', 'arriving', 'verify', 'delivered'];
  }
  return [];
}

async function applyTransition(repository, orderId, transition) {
  if (transition === 'claim') {
    return repository.claimRiderOrder(orderId, { riderId: repository.getRiderId?.() });
  }
  if (transition === 'verify') {
    const order = getState().orders.find((candidate) => candidate.id === orderId);
    return repository.verifyDeliveryCode?.(orderId, order?.deliveryCode?.code)
      || failure('SHOWCASE_CODE_MISSING', 'No se pudo validar el código sintético.');
  }
  return repository.updateOrderStatus(orderId, transition);
}

function scenarioMessage(scenarioId) {
  const messages = {
    'business-new': 'Pedido nuevo sintético preparado.',
    'business-manage': 'Pedido sintético en preparación.',
    rider: 'Pedido sintético listo para asignar.',
    'tracking-map': 'Recorrido de muestra local iniciado.',
    delivered: 'Pedido sintético entregado.',
    recovery: 'Pedido sintético persistido para comprobar la recuperación.',
  };
  return messages[scenarioId] || 'Escenario local preparado.';
}

async function persistShowcaseState(repository) {
  if (typeof repository.exportSandboxState !== 'function'
    || typeof repository.importSandboxState !== 'function') {
    return failure('SHOWCASE_PERSISTENCE_MISSING', 'La persistencia local del recorrido no está disponible.');
  }
  try {
    const snapshot = await repository.exportSandboxState();
    const result = await repository.importSandboxState(snapshot);
    return result?.ok
      ? { ok: true }
      : failure('SHOWCASE_PERSISTENCE_FAILED', result?.message || 'No se pudo guardar el escenario local.');
  } catch (_) {
    return failure('SHOWCASE_PERSISTENCE_FAILED', 'No se pudo guardar el escenario local.');
  }
}

function failure(code, message) {
  return { ok: false, code, message };
}
