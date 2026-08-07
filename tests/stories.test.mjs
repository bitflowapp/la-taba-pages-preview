import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STORY_CTA_TYPES,
  STORY_MEDIA_TYPES,
  STORY_STATUS,
  compareStories,
  isStoryLive,
  markStorySeen,
  normalizeCtaType,
  normalizeStoryCollection,
  normalizeStoryRecord,
  publishedStories,
  readSeenStoryIds,
  readStoriesSource,
  storyEntryState,
  storyStatus,
  storyVideoPreload,
  summarizeStories,
} from '../js/core/stories.js';

const BASE = Object.freeze({
  id: 'story-1',
  business_id: 'la-taba-2',
  title: 'Combo de la semana',
  body: 'Lo que armó el local para el finde.',
  media_type: 'image',
  media_url: 'assets/products/beverage-placeholder.svg',
  thumbnail_url: 'assets/products/beverage-placeholder.svg',
  starts_at: null,
  expires_at: null,
  sort_order: 1,
  cta_type: 'category',
  cta_target: 'cervezas',
  enabled: true,
});

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}

test('una historia apagada existe para el Panel pero no para la vidriera', () => {
  const draft = normalizeStoryRecord({ ...BASE, enabled: false });
  assert.ok(draft, 'el Panel tiene que poder verla y editarla');
  assert.equal(storyStatus(draft), STORY_STATUS.draft);
  assert.equal(isStoryLive(draft), false);
  assert.deepEqual(publishedStories([{ ...BASE, enabled: false }]), []);
});

test('el interruptor es booleano estricto: una cadena no publica nada', () => {
  assert.equal(normalizeStoryRecord({ ...BASE, enabled: 'true' }).enabled, false);
  assert.deepEqual(publishedStories([{ ...BASE, enabled: 'true' }]), [], 'enabled debe ser booleano estricto');
  assert.equal(
    publishedStories([{ ...BASE, published: true, enabled: undefined }])[0]?.id,
    'story-1',
    'published sigue valiendo',
  );
  assert.equal(normalizeStoryRecord(null), null);
  assert.equal(normalizeStoryRecord('historia'), null);
});

test('una historia sin medio válido no existe ni como borrador', () => {
  assert.equal(normalizeStoryRecord({ ...BASE, media_url: '' }), null);
  assert.equal(normalizeStoryRecord({ ...BASE, id: '  ' }), null);
  assert.equal(normalizeStoryRecord({ ...BASE, media_type: 'gif' }), null);
  for (const mediaType of STORY_MEDIA_TYPES) {
    assert.ok(normalizeStoryRecord({ ...BASE, media_type: mediaType }), `${mediaType} es un medio admitido`);
  }
});

test('un medio con esquema peligroso nunca llega al DOM', () => {
  assert.equal(normalizeStoryRecord({ ...BASE, media_url: 'javascript:alert(1)' }), null);
  assert.equal(normalizeStoryRecord({ ...BASE, media_url: '  DATA:text/html;base64,x' }), null);
});

test('el destino es un identificador del catálogo, no una URL', () => {
  // Por construcción: el alfabeto admitido no puede formar un esquema ni una
  // ruta, así que no hay lista negra que mantener.
  for (const target of ['javascript:alert(1)', 'https://otro.sitio/x', '../../etc/passwd', 'a b', '']) {
    assert.equal(normalizeStoryRecord({ ...BASE, cta_target: target }).cta, null, `rechaza ${target || '(vacío)'}`);
  }
  assert.equal(normalizeStoryRecord({ ...BASE, cta_target: 'cervezas' }).cta.target, 'cervezas');
  assert.equal(
    normalizeStoryRecord({ ...BASE, cta_type: 'product', cta_target: '882c6108-4b1e-4c0a-9f2d-000000000001' }).cta.target,
    '882c6108-4b1e-4c0a-9f2d-000000000001',
    'un uuid de producto es un destino válido',
  );
});

test('las cuatro CTA del contrato comercial, y ninguna más', () => {
  assert.deepEqual(
    Object.values(STORY_CTA_TYPES).map((definition) => definition.code),
    ['VER PRODUCTO', 'VER COMBO', 'COMPRAR', 'VER CATEGORÍA'],
  );
  for (const type of Object.keys(STORY_CTA_TYPES)) {
    const story = normalizeStoryRecord({ ...BASE, cta_type: type, cta_target: 'destino' });
    assert.equal(story.cta.type, type);
    assert.equal(story.cta.label, STORY_CTA_TYPES[type].label);
    assert.equal(story.cta.code, STORY_CTA_TYPES[type].code);
  }
  assert.equal(normalizeStoryRecord({ ...BASE, cta_type: 'enviar_mensaje' }).cta, null);
  assert.equal(normalizeStoryRecord({ ...BASE, cta_type: 'category', cta_target: '' }).cta, null);
});

// Regresión medida: el almacén re-normaliza sus propias listas en cada alta,
// baja y reordenamiento. Cuando `normalizeStoryRecord` no sabía leer su propia
// salida, cada una de esas operaciones dejaba la vidriera sin un solo botón, y
// nada fallaba: se guardaba una historia editorial donde había una CTA.
test('normalizar dos veces no pierde nada: la función es idempotente', () => {
  const once = normalizeStoryRecord({
    ...BASE,
    cta_type: 'buy',
    cta_target: 'heineken-lata',
    age_restricted: true,
    starts_at: '2026-08-07T12:00:00Z',
    expires_at: '2026-08-08T12:00:00Z',
  });
  const twice = normalizeStoryRecord(once);
  assert.deepEqual(twice, once);
  assert.equal(twice.cta.type, 'buy');
  assert.equal(twice.cta.target, 'heineken-lata');

  // Y la colección entera, que es el camino real del almacén.
  const collection = normalizeStoryCollection([once]);
  assert.deepEqual(normalizeStoryCollection(collection), collection);
  assert.equal(normalizeStoryCollection(collection)[0].cta.target, 'heineken-lata');
});

test('los nombres viejos del contrato se traducen, no se rompen', () => {
  assert.equal(normalizeCtaType('offer'), 'product');
  assert.equal(normalizeCtaType('add_to_cart'), 'buy');
  assert.equal(normalizeCtaType('add'), 'buy');
  assert.equal(normalizeCtaType('CATEGORY'), 'category');
  assert.equal(normalizeCtaType('inventada'), '');
});

test('los cuatro estados se derivan del reloj, no se guardan', () => {
  const now = Date.parse('2026-08-07T12:00:00Z');
  const record = (extra) => normalizeStoryRecord({ ...BASE, ...extra });

  assert.equal(storyStatus(record({ enabled: false }), { now }), STORY_STATUS.draft);
  assert.equal(
    storyStatus(record({ starts_at: '2026-08-07T13:00:00Z' }), { now }),
    STORY_STATUS.scheduled,
  );
  assert.equal(storyStatus(record({}), { now }), STORY_STATUS.active);
  assert.equal(
    storyStatus(record({ expires_at: '2026-08-07T11:59:00Z' }), { now }),
    STORY_STATUS.finished,
  );

  // Una apagada que además venció sigue siendo BORRADOR: nunca salió, así que
  // decir que "terminó" sería contar una vida que no tuvo.
  assert.equal(
    storyStatus(record({ enabled: false, expires_at: '2026-08-07T11:00:00Z' }), { now }),
    STORY_STATUS.draft,
  );
});

test('la historia vencida desaparece sola: sólo cambia el reloj', () => {
  const source = [{ ...BASE, expires_at: '2026-08-07T12:00:00Z' }];
  assert.equal(publishedStories(source, { now: Date.parse('2026-08-07T11:59:59Z') }).length, 1);
  assert.equal(publishedStories(source, { now: Date.parse('2026-08-07T12:00:00Z') }).length, 0);
  assert.equal(publishedStories(source, { now: Date.parse('2026-08-07T12:00:01Z') }).length, 0);
});

test('la ventana de vigencia se respeta en los dos extremos', () => {
  const now = Date.parse('2026-08-03T12:00:00Z');
  const vencida = { ...BASE, id: 'vencida', expires_at: '2026-08-03T11:59:00Z' };
  const futura = { ...BASE, id: 'futura', starts_at: '2026-08-03T12:01:00Z' };
  const vigente = { ...BASE, id: 'vigente', starts_at: '2026-08-03T11:00:00Z', expires_at: '2026-08-03T13:00:00Z' };

  const visible = publishedStories([vencida, futura, vigente], { now });
  assert.deepEqual(visible.map((story) => story.id), ['vigente']);
});

test('el orden lo manda sort_order, de menor a mayor', () => {
  const list = publishedStories([
    { ...BASE, id: 'tercera', sort_order: 3 },
    { ...BASE, id: 'primera', sort_order: 1 },
    { ...BASE, id: 'segunda', sort_order: 2 },
  ]);
  assert.deepEqual(list.map((story) => story.id), ['primera', 'segunda', 'tercera']);
});

test('los registros viejos conservan su intención: destacada primero, luego prioridad', () => {
  // Sin `sort_order`, el orden se deriva de `is_highlight` + `priority`, que es
  // exactamente el orden que tenían antes del cambio de contrato.
  const list = publishedStories([
    { ...BASE, id: 'baja', priority: 1, sort_order: undefined, published: true },
    { ...BASE, id: 'destacada', priority: 0, is_highlight: true, sort_order: undefined, published: true },
    { ...BASE, id: 'alta', priority: 9, sort_order: undefined, published: true },
  ]);
  assert.deepEqual(list.map((story) => story.id), ['destacada', 'alta', 'baja']);
});

test('el orden es TOTAL: dos historias con el mismo número no bailan', () => {
  const a = normalizeStoryRecord({ ...BASE, id: 'a', sort_order: 1 });
  const b = normalizeStoryRecord({ ...BASE, id: 'b', sort_order: 1 });
  assert.ok(compareStories(a, b) < 0);
  assert.ok(compareStories(b, a) > 0);
  assert.equal(compareStories(a, a), 0);
});

test('un id repetido no entra dos veces', () => {
  const list = normalizeStoryCollection([
    { ...BASE, id: 'repetida', title: 'primera' },
    { ...BASE, id: 'repetida', title: 'segunda' },
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'primera', 'gana la que declaró la fuente primero');
});

test('el resumen por estado cuenta las cuatro cajas', () => {
  const now = Date.parse('2026-08-07T12:00:00Z');
  const summary = summarizeStories(normalizeStoryCollection([
    { ...BASE, id: 'activa' },
    { ...BASE, id: 'programada', starts_at: '2026-08-07T18:00:00Z' },
    { ...BASE, id: 'borrador', enabled: false },
    { ...BASE, id: 'finalizada', expires_at: '2026-08-06T18:00:00Z' },
  ]), { now });
  assert.equal(summary[STORY_STATUS.active], 1);
  assert.equal(summary[STORY_STATUS.scheduled], 1);
  assert.equal(summary[STORY_STATUS.draft], 1);
  assert.equal(summary[STORY_STATUS.finished], 1);
  assert.equal(summary.total, 4);
});

test('el texto breve se conserva y se recorta, nunca se inventa', () => {
  assert.equal(normalizeStoryRecord({ ...BASE, body: '  hola   mundo ' }).body, 'hola mundo');
  assert.equal(normalizeStoryRecord({ ...BASE, body: undefined }).body, '');
  assert.equal(normalizeStoryRecord({ ...BASE, body: 'x'.repeat(400) }).body.length, 220);
});

test('en conexión lenta el video no se precarga', () => {
  assert.equal(storyVideoPreload(undefined), 'metadata', 'sin API de conexión no se castiga a nadie');
  assert.equal(storyVideoPreload({ effectiveType: '4g' }), 'metadata');
  assert.equal(storyVideoPreload({ effectiveType: '3g' }), 'metadata');
  assert.equal(storyVideoPreload({ effectiveType: '2g' }), 'none');
  assert.equal(storyVideoPreload({ effectiveType: 'slow-2g' }), 'none');
  assert.equal(storyVideoPreload({ saveData: true, effectiveType: '4g' }), 'none', 'el ahorro de datos manda');
});

test('sin historias no hay entrada: el logo no es un botón', () => {
  const entry = storyEntryState([], []);
  assert.equal(entry.available, false);
  assert.equal(entry.state, 'empty');
  assert.equal(entry.total, 0);
  assert.equal(entry.unseen, 0);
  assert.equal(entry.firstIndex, 0);
});

test('el estado distingue no visto de visto y apunta a dónde abrir', () => {
  const stories = publishedStories([
    { ...BASE, id: 'a', sort_order: 1 },
    { ...BASE, id: 'b', sort_order: 2 },
  ]);
  const fresh = storyEntryState(stories, []);
  assert.equal(fresh.state, 'unseen');
  assert.equal(fresh.unseen, 2);
  assert.equal(fresh.firstId, 'a');
  assert.equal(fresh.firstIndex, 0);

  const partial = storyEntryState(stories, ['a']);
  assert.equal(partial.state, 'unseen');
  assert.equal(partial.unseen, 1);
  assert.equal(partial.firstId, 'b', 'la entrada apunta a la primera no vista');
  assert.equal(partial.firstIndex, 1, 'y el visor abre en esa posición');

  const seen = storyEntryState(stories, ['a', 'b']);
  assert.equal(seen.state, 'seen');
  assert.equal(seen.unseen, 0);
  assert.equal(seen.available, true, 'vistas: siguen accesibles, con el aro atenuado');
  assert.equal(seen.firstIndex, 0);
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

test('el origen es fail-closed y respeta la autoridad del backend', () => {
  const fixtures = [BASE];
  const local = [{ ...BASE, id: 'del-panel' }];

  assert.deepEqual(readStoriesSource({ scope: {}, showcase: false, fixtures }), []);
  assert.deepEqual(readStoriesSource({ scope: {}, showcase: false }), []);
  assert.deepEqual(
    readStoriesSource({ scope: {}, showcase: true, fixtures }),
    fixtures,
    'los fixtures sólo viven en el modo preview explícito',
  );
  assert.deepEqual(
    readStoriesSource({ scope: { TABA2_STORIES: [BASE] }, showcase: true, local, fixtures }),
    [BASE],
    'el global del backend gana sobre el Panel y sobre los fixtures',
  );
  assert.deepEqual(
    readStoriesSource({ scope: {}, showcase: true, local, fixtures }),
    local,
    'lo administrado en el Panel gana sobre los fixtures',
  );
  assert.deepEqual(
    readStoriesSource({ scope: {}, showcase: true, local: [], fixtures }),
    [],
    'un Panel vaciado a propósito NO resucita los fixtures',
  );
  assert.deepEqual(
    readStoriesSource({ scope: { TABA2_STORIES: 'no-es-lista' }, showcase: false, fixtures }),
    [],
    'un global con forma inválida no habilita fixtures en producción',
  );
});
