import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STORY_EVENTS,
  STORY_METRICS_STORAGE_KEY,
  createImpressionGate,
  forgetStoryMetrics,
  readStoryMetrics,
  recordStoryEvent,
  storyMetricsFor,
  summarizeStoryMetrics,
} from '../js/core/story-analytics.js';

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}

const NOW = Date.parse('2026-08-07T12:00:00Z');

test('los seis eventos del canal, y ninguno más', () => {
  assert.deepEqual(STORY_EVENTS, [
    'impression', 'open', 'advance', 'cta', 'product_open', 'add_to_cart',
  ]);
  // Deliberadamente NO existe "purchase" ni "conversion": el pedido lo cierra
  // el backend y no vuelve marcado con la historia que lo originó.
  assert.ok(!STORY_EVENTS.includes('purchase'));
  assert.ok(!STORY_EVENTS.includes('conversion'));
});

test('un evento suma uno y sólo uno', () => {
  const storage = memoryStorage();
  recordStoryEvent('story-a', 'open', { storage, now: NOW });
  recordStoryEvent('story-a', 'open', { storage, now: NOW });
  recordStoryEvent('story-a', 'cta', { storage, now: NOW });

  const counters = storyMetricsFor('story-a', storage);
  assert.equal(counters.open, 2);
  assert.equal(counters.cta, 1);
  assert.equal(counters.impression, 0, 'las seis claves existen siempre');
});

test('un evento desconocido o un id vacío no ensucian el almacén', () => {
  const storage = memoryStorage();
  assert.equal(recordStoryEvent('story-a', 'purchase', { storage, now: NOW }), false);
  assert.equal(recordStoryEvent('', 'open', { storage, now: NOW }), false);
  assert.equal(recordStoryEvent('   ', 'open', { storage, now: NOW }), false);
  assert.equal(storage.getItem(STORY_METRICS_STORAGE_KEY), null);
});

test('lo que se guarda no puede identificar a nadie', () => {
  const storage = memoryStorage();
  recordStoryEvent('story-a', 'impression', { storage, now: NOW });
  recordStoryEvent('story-a', 'add_to_cart', { storage, now: NOW });

  const persisted = JSON.parse(storage.getItem(STORY_METRICS_STORAGE_KEY));
  assert.deepEqual(Object.keys(persisted).sort(), ['since', 'stories', 'version']);
  assert.deepEqual(Object.keys(persisted.stories), ['story-a']);
  assert.deepEqual(Object.keys(persisted.stories['story-a']).sort(), [...STORY_EVENTS].sort());
  // El único dato temporal es el DÍA de la colección: sin hora, sin zona y sin
  // una marca por evento con la que reconstruir un recorrido.
  assert.equal(persisted.since, '2026-08-07');
  assert.match(persisted.since, /^\d{4}-\d{2}-\d{2}$/);

  const serialized = storage.getItem(STORY_METRICS_STORAGE_KEY);
  for (const forbidden of ['session', 'user', 'device', 'ip', 'agent', 'lat', 'phone', 'email']) {
    assert.ok(!serialized.toLowerCase().includes(forbidden), `no se guarda "${forbidden}"`);
  }
});

test('el día de inicio se fija una sola vez', () => {
  const storage = memoryStorage();
  recordStoryEvent('story-a', 'open', { storage, now: NOW });
  recordStoryEvent('story-a', 'open', { storage, now: Date.parse('2026-09-01T00:00:00Z') });
  assert.equal(readStoryMetrics(storage).since, '2026-08-07');
});

test('un almacén roto no rompe el Panel', () => {
  const broken = { getItem: () => '{{{', setItem: () => { throw new Error('quota'); } };
  assert.deepEqual(readStoryMetrics(broken).stories, {});
  assert.doesNotThrow(() => recordStoryEvent('story-a', 'open', { storage: broken, now: NOW }));

  const wrongShape = memoryStorage();
  wrongShape.setItem(STORY_METRICS_STORAGE_KEY, JSON.stringify({ stories: 'no-es-objeto' }));
  assert.deepEqual(readStoryMetrics(wrongShape).stories, {});

  const negative = memoryStorage();
  negative.setItem(STORY_METRICS_STORAGE_KEY, JSON.stringify({ stories: { a: { open: -5, cta: 'x' } } }));
  assert.equal(storyMetricsFor('a', negative).open, 0, 'un contador negativo se lee como cero');
  assert.equal(storyMetricsFor('a', negative).cta, 0);
});

test('el resumen suma el canal y no infla el denominador', () => {
  const storage = memoryStorage();
  recordStoryEvent('a', 'impression', { storage, now: NOW });
  recordStoryEvent('a', 'cta', { storage, now: NOW });
  recordStoryEvent('b', 'impression', { storage, now: NOW });

  const summary = summarizeStoryMetrics(storage);
  assert.equal(summary.impression, 2);
  assert.equal(summary.cta, 1);
  assert.equal(summary.stories, 2, 'sólo cuentan las que registraron actividad');
  assert.equal(summary.since, '2026-08-07');
});

test('el almacén está acotado y descarta lo que menos actividad tiene', () => {
  const storage = memoryStorage();
  // Una historia con actividad real, cargada ANTES de que el almacén se llene.
  for (let hit = 0; hit < 20; hit += 1) recordStoryEvent('la-que-importa', 'impression', { storage, now: NOW });
  // Y 320 historias con un solo evento cada una, que empujan el corte.
  for (let index = 0; index < 320; index += 1) {
    recordStoryEvent(`s-${index}`, 'impression', { storage, now: NOW });
  }

  const metrics = readStoryMetrics(storage);
  assert.equal(Object.keys(metrics.stories).length, 300, 'el almacén no crece sin límite');
  assert.ok(metrics.stories['la-que-importa'], 'la que se está midiendo sobrevive al corte');
  assert.equal(metrics.stories['la-que-importa'].impression, 20);
});

test('eliminar una historia se lleva sus contadores', () => {
  const storage = memoryStorage();
  recordStoryEvent('a', 'open', { storage, now: NOW });
  recordStoryEvent('b', 'open', { storage, now: NOW });

  assert.equal(forgetStoryMetrics('a', storage), true);
  assert.equal(forgetStoryMetrics('a', storage), false, 'borrar dos veces no falla');
  assert.deepEqual(Object.keys(readStoryMetrics(storage).stories), ['b']);
});

test('la impresión se cuenta una vez por apertura, no por repintado', () => {
  const gate = createImpressionGate();
  assert.equal(gate.shouldCount('a'), true);
  assert.equal(gate.shouldCount('a'), false, 'el mismo repintado no vuelve a contar');
  assert.equal(gate.shouldCount('b'), true);
  assert.equal(gate.shouldCount(''), false);

  gate.reset();
  assert.equal(gate.shouldCount('a'), true, 'una apertura nueva vuelve a contar');
});
