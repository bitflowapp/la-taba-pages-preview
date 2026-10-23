import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ORDER_TIMELINE_STEPS,
  PUBLIC_ORDER_TIMELINE_STEPS,
  PUBLIC_PICKUP_TIMELINE_STEPS,
  orderTimelineIndex,
  publicOrderTimelineIndex,
  publicPickupTimelineIndex,
  renderOrderTimeline,
  renderPublicOrderTimeline,
} from '../js/core/order-timeline.js';

test('conserva la timeline operativa de cinco pasos', () => {
  assert.deepEqual(
    ORDER_TIMELINE_STEPS.map((step) => step.label),
    ['Recibido', 'En preparación', 'Listo', 'En reparto', 'Entregado'],
  );
  assert.equal(orderTimelineIndex('received'), 0);
  assert.equal(orderTimelineIndex('preparing'), 1);
  assert.equal(orderTimelineIndex('ready'), 2);
  assert.equal(orderTimelineIndex('on_the_way'), 3);
  assert.equal(orderTimelineIndex('delivered'), 4);
  const operationalHtml = renderOrderTimeline('ready');
  assert.equal((operationalHtml.match(/track-step /g) || []).length, 5);
  assert.match(operationalHtml, /track-steps operational/);
  assert.match(operationalHtml, /track-step current[^>]*aria-current="step"[\s\S]*Listo/);
});

test('la timeline pública agrupa el flujo en cuatro pasos comerciales', () => {
  assert.deepEqual(
    PUBLIC_ORDER_TIMELINE_STEPS.map((step) => step.label),
    ['Confirmado', 'Preparando', 'En camino', 'Entregado'],
  );

  for (const status of ['draft', 'submitted', 'received']) {
    assert.equal(publicOrderTimelineIndex(status), 0, status);
  }
  for (const status of ['accepted', 'preparing', 'ready', 'assigned']) {
    assert.equal(publicOrderTimelineIndex(status), 1, status);
  }
  for (const status of ['picked_up', 'on_the_way', 'arrived', 'arriving']) {
    assert.equal(publicOrderTimelineIndex(status), 2, status);
  }
  assert.equal(publicOrderTimelineIndex('delivered'), 3);

  const html = renderPublicOrderTimeline('on_the_way', { className: 'customer-progress' });
  assert.equal((html.match(/track-step /g) || []).length, 4);
  assert.match(html, /track-steps customer-progress/);
  assert.match(html, /track-steps customer-progress public/);
  assert.match(html, /track-step current[^>]*aria-current="step"[\s\S]*En camino/);
  assert.doesNotMatch(html, />Listo</);
  assert.doesNotMatch(html, />En reparto</);
  const arrivedHtml = renderPublicOrderTimeline('arriving', { className: 'customer-progress' });
  assert.match(arrivedHtml, /track-step current[^>]*aria-current="step"[\s\S]*Llegó/);
  assert.doesNotMatch(arrivedHtml, /track-step current[^>]*aria-current="step"[\s\S]*En camino/);
  assert.doesNotMatch(renderPublicOrderTimeline('canceled'), /track-step current/);
});

/*
 * RETIRO EN LOCAL. Medido en la vista previa a 390 × 844: después de un pedido
 * de retiro en efectivo, el seguimiento mostraba «Confirmado · Preparando · En
 * camino · Entregado». En un retiro no hay reparto: «En camino» no ocurre nunca
 * y «Entregado» no es lo que pasa en el mostrador.
 */
test('un retiro se lee con sus propios pasos y nunca dice «En camino»', () => {
  assert.deepEqual(
    PUBLIC_PICKUP_TIMELINE_STEPS.map((step) => step.label),
    ['Confirmado', 'Preparando', 'Listo para retirar', 'Retirado'],
  );

  for (const status of ['draft', 'submitted', 'received']) {
    assert.equal(publicPickupTimelineIndex(status), 0, status);
  }
  for (const status of ['accepted', 'preparing']) {
    assert.equal(publicPickupTimelineIndex(status), 1, status);
  }
  // En un retiro `ready` es una etapa propia: es cuando hay que salir al local.
  assert.equal(publicPickupTimelineIndex('ready'), 2);
  assert.equal(publicPickupTimelineIndex('delivered'), 3);

  const listo = renderPublicOrderTimeline('ready', { className: 'customer-progress', deliveryMode: 'pickup' });
  assert.equal((listo.match(/track-step /g) || []).length, 4);
  assert.match(listo, /track-steps customer-progress public/);
  assert.match(listo, /track-step current[^>]*aria-current="step"[\s\S]*Listo para retirar/);
  assert.doesNotMatch(listo, /En camino|Entregado|Llegó/);

  const retirado = renderPublicOrderTimeline('delivered', { deliveryMode: 'pickup' });
  assert.match(retirado, /track-step current[^>]*aria-current="step"[\s\S]*Retirado/);
  assert.doesNotMatch(renderPublicOrderTimeline('cancelled', { deliveryMode: 'pickup' }), /track-step current/);
});

test('un estado de reparto en un retiro no adelanta la línea hasta «Retirado»', () => {
  for (const status of ['picked_up', 'on_the_way', 'arrived', 'arriving']) {
    assert.equal(publicPickupTimelineIndex(status), 2, status);
  }
  // Y el envío conserva exactamente su línea de siempre.
  assert.equal(
    renderPublicOrderTimeline('preparing', { className: 'customer-progress', deliveryMode: 'delivery' }),
    renderPublicOrderTimeline('preparing', { className: 'customer-progress' }),
  );
});
