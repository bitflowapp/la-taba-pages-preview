import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STORY_CTA_TYPES,
  STORY_MEDIA_TYPES,
  markStorySeen,
  normalizeStory,
  publishedStories,
  readSeenStoryIds,
  readStoriesSource,
  storyEntryState,
} from '../js/core/stories.js';

const BASE = Object.freeze({
  id: 'story-1',
  business_id: 'la-taba-2',
  title: 'Combo de la semana',
  media_type: 'image',
  media_url: 'assets/products/beverage-placeholder.svg',
  thumbnail_url: 'assets/products/beverage-placeholder.svg',
  starts_at: null,
  expires_at: null,
  priority: 5,
  cta_type: 'category',
  cta_target: 'cervezas',
  is_highlight: false,
  published: true,
});

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}

test('una historia sin publicar no existe para la interfaz', () => {
  assert.equal(normalizeStory({ ...BASE, published: false }), null);
  assert.equal(normalizeStory({ ...BASE, published: 'true' }), null, 'published debe ser booleano estricto');
  assert.equal(normalizeStory(null), null);
  assert.equal(normalizeStory('historia'), null);
});

test('una historia sin medio válido se descarta', () => {
  assert.equal(normalizeStory({ ...BASE, media_url: '' }), null);
  assert.equal(normalizeStory({ ...BASE, id: '  ' }), null);
  assert.equal(normalizeStory({ ...BASE, media_type: 'gif' }), null);
  for (const mediaType of STORY_MEDIA_TYPES) {
    assert.ok(normalizeStory({ ...BASE, media_type: mediaType }), `${mediaType} es un medio admitido`);
  }
});

test('un medio con esquema peligroso nunca llega al DOM', () => {
  assert.equal(normalizeStory({ ...BASE, media_url: 'javascript:alert(1)' }), null);
  assert.equal(normalizeStory({ ...BASE, media_url: '  DATA:text/html;base64,x' }), null);
  const story = normalizeStory({ ...BASE, cta_target: 'javascript:alert(1)' });
  assert.ok(story, 'la historia se conserva');
  assert.equal(story.cta, null, 'pero la CTA peligrosa no');
});

test('una CTA sin tipo conocido o sin destino no se convierte en botón', () => {
  assert.equal(normalizeStory({ ...BASE, cta_type: 'enviar_mensaje' }).cta, null);
  assert.equal(normalizeStory({ ...BASE, cta_type: 'category', cta_target: '' }).cta, null);
  for (const type of Object.keys(STORY_CTA_TYPES)) {
    const story = normalizeStory({ ...BASE, cta_type: type, cta_target: 'destino' });
    assert.equal(story.cta.type, type);
    assert.equal(story.cta.label, STORY_CTA_TYPES[type].label);
  }
});

test('la ventana de vigencia se respeta en los dos extremos', () => {
  const now = Date.parse('2026-08-03T12:00:00Z');
  const vencida = { ...BASE, id: 'vencida', expires_at: '2026-08-03T11:59:00Z' };
  const futura = { ...BASE, id: 'futura', starts_at: '2026-08-03T12:01:00Z' };
  const vigente = { ...BASE, id: 'vigente', starts_at: '2026-08-03T11:00:00Z', expires_at: '2026-08-03T13:00:00Z' };

  const visible = publishedStories([vencida, futura, vigente], { now });
  assert.deepEqual(visible.map((story) => story.id), ['vigente']);
});

test('el orden es destacadas, luego prioridad, luego antigüedad', () => {
  const now = Date.parse('2026-08-03T12:00:00Z');
  const list = publishedStories([
    { ...BASE, id: 'baja', priority: 1 },
    { ...BASE, id: 'destacada', priority: 0, is_highlight: true },
    { ...BASE, id: 'alta', priority: 9 },
  ], { now });
  assert.deepEqual(list.map((story) => story.id), ['destacada', 'alta', 'baja']);
});

test('sin historias no hay entrada: el logo no es un botón', () => {
  const entry = storyEntryState([], []);
  assert.equal(entry.available, false);
  assert.equal(entry.state, 'empty');
  assert.equal(entry.total, 0);
  assert.equal(entry.unseen, 0);
});

test('el estado distingue no visto de visto', () => {
  const stories = publishedStories([
    { ...BASE, id: 'a', priority: 2 },
    { ...BASE, id: 'b', priority: 1 },
  ]);
  const fresh = storyEntryState(stories, []);
  assert.equal(fresh.state, 'unseen');
  assert.equal(fresh.unseen, 2);
  assert.equal(fresh.firstId, 'a');

  const partial = storyEntryState(stories, ['a']);
  assert.equal(partial.state, 'unseen');
  assert.equal(partial.unseen, 1);
  assert.equal(partial.firstId, 'b', 'la entrada apunta a la primera no vista');

  const seen = storyEntryState(stories, ['a', 'b']);
  assert.equal(seen.state, 'seen');
  assert.equal(seen.unseen, 0);
  assert.equal(seen.available, true, 'vistas: siguen accesibles, con el aro atenuado');
});

test('el registro de vistas persiste, tolera almacenamiento roto y está acotado', () => {
  const storage = memoryStorage();
  markStorySeen('a', storage);
  markStorySeen('b', storage);
  assert.deepEqual([...readSeenStoryIds(storage)], ['a', 'b']);

  markStorySeen('a', storage);
  assert.equal(readSeenStoryIds(storage).size, 2, 'no duplica');

  markStorySeen('', storage);
  assert.equal(readSeenStoryIds(storage).size, 2, 'un id vacío no se registra');

  const broken = { getItem: () => '{{{', setItem: () => { throw new Error('quota'); } };
  assert.equal(readSeenStoryIds(broken).size, 0, 'JSON inválido no rompe la home');
  assert.doesNotThrow(() => markStorySeen('c', broken), 'una cuota agotada no rompe la home');

  const many = memoryStorage();
  for (let index = 0; index < 260; index += 1) markStorySeen(`s-${index}`, many);
  assert.equal(readSeenStoryIds(many).size, 200, 'el registro está acotado');
});

test('el origen es fail-closed: sin global y sin preview no hay historias', () => {
  const fixtures = [BASE];
  assert.deepEqual(readStoriesSource({ scope: {}, showcase: false, fixtures }), []);
  assert.deepEqual(readStoriesSource({ scope: {}, showcase: false }), []);
  assert.deepEqual(
    readStoriesSource({ scope: {}, showcase: true, fixtures }),
    fixtures,
    'los fixtures sólo viven en el modo preview explícito',
  );
  assert.deepEqual(
    readStoriesSource({ scope: { TABA2_STORIES: [BASE] }, showcase: false }),
    [BASE],
    'el global publicado por el backend es la fuente productiva',
  );
  assert.deepEqual(
    readStoriesSource({ scope: { TABA2_STORIES: 'no-es-lista' }, showcase: false, fixtures }),
    [],
    'un global con forma inválida no habilita fixtures en producción',
  );
});
