import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ORDER_TIMELINE_STEPS,
  PUBLIC_ORDER_TIMELINE_STEPS,
  orderTimelineIndex,
  publicOrderTimelineIndex,
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
  assert.equal((renderOrderTimeline('ready').match(/track-step /g) || []).length, 5);
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
  assert.match(html, /track-step current[\s\S]*En camino/);
  assert.doesNotMatch(html, />Listo</);
  assert.doesNotMatch(html, />En reparto</);
  assert.doesNotMatch(renderPublicOrderTimeline('canceled'), /track-step current/);
});
