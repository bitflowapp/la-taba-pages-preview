import assert from 'node:assert/strict';
import test from 'node:test';
import { STORY_STATUS, normalizeStoryCollection, storyStatus } from '../js/core/stories.js';
import {
  createStoryDraft,
  moveStory,
  removeStory,
  resequenceStories,
  setStoryEnabled,
  storyFromForm,
  toStoredRecord,
  upsertStory,
  validateStoryForActivation,
} from '../js/core/story-store.js';

const HEINEKEN = Object.freeze({
  id: 'heineken-lata', name: 'Heineken Original', categoryId: 'cervezas',
  price: 3900, stock: 20, available: true, pricePending: false, alcoholic: true,
  image: 'assets/products/heineken.webp',
});
const CATALOG = Object.freeze({
  products: [HEINEKEN],
  combos: [{ comboId: 'combo-heineken-x6', name: 'Heineken x6', available: true, ageRestricted: true }],
  categories: [{ id: 'cervezas', name: 'Cervezas' }],
});

function raw(id, extra = {}) {
  return {
    id,
    title: `Historia ${id}`,
    media_type: 'image',
    media_url: `assets/promos/${id}.webp`,
    enabled: true,
    ...extra,
  };
}

test('el alta entra al final y no mueve a las que ya estaban', () => {
  let list = upsertStory([], raw('a'));
  list = upsertStory(list, raw('b'));
  list = upsertStory(list, raw('c'));
  assert.deepEqual(list.map((story) => story.id), ['a', 'b', 'c']);
  assert.deepEqual(list.map((story) => story.sortOrder), [1, 2, 3]);
});

test('editar conserva la posición: cambiar el título no reordena la vidriera', () => {
  let list = [raw('a'), raw('b'), raw('c')].reduce(upsertStory, []);
  list = upsertStory(list, raw('a', { title: 'Otro título' }));
  assert.deepEqual(list.map((story) => story.id), ['a', 'b', 'c']);
  assert.equal(list[0].title, 'Otro título');
});

test('mover respeta los extremos y renumera sin huecos', () => {
  const list = [raw('a'), raw('b'), raw('c')].reduce(upsertStory, []);

  assert.deepEqual(moveStory(list, 'c', -1).map((story) => story.id), ['a', 'c', 'b']);
  assert.deepEqual(moveStory(list, 'a', 1).map((story) => story.id), ['b', 'a', 'c']);
  assert.deepEqual(moveStory(list, 'a', -1).map((story) => story.id), ['a', 'b', 'c'], 'la primera no sube');
  assert.deepEqual(moveStory(list, 'c', 1).map((story) => story.id), ['a', 'b', 'c'], 'la última no baja');
  assert.deepEqual(moveStory(list, 'no-existe', 1).map((story) => story.id), ['a', 'b', 'c']);
  assert.deepEqual(moveStory(list, 'a', 2).map((story) => story.sortOrder), [1, 2, 3], 'siempre 1..n');
});

// Cada operación del almacén re-normaliza la lista entera. Si esa vuelta pierde
// algo, se pierde en silencio: la historia sigue ahí y el botón desaparece.
test('reordenar, apagar y borrar no le sacan la CTA a las que quedan', () => {
  const list = [
    raw('a', { cta_type: 'product', cta_target: 'heineken-lata' }),
    raw('b', { cta_type: 'combo', cta_target: 'combo-heineken-x6' }),
    raw('c', { cta_type: 'category', cta_target: 'cervezas' }),
  ].reduce(upsertStory, []);
  assert.deepEqual(list.map((story) => story.cta?.type), ['product', 'combo', 'category']);

  const movida = moveStory(list, 'c', -1);
  assert.deepEqual(movida.map((story) => story.cta?.target), ['heineken-lata', 'cervezas', 'combo-heineken-x6']);

  const apagada = setStoryEnabled(movida, 'a', false);
  assert.equal(apagada.find((story) => story.id === 'a').cta.target, 'heineken-lata');

  const borrada = removeStory(apagada, 'b');
  assert.deepEqual(borrada.map((story) => story.cta?.target), ['heineken-lata', 'cervezas']);

  // Y el registro persistido conserva las columnas de la CTA.
  assert.deepEqual(borrada.map(toStoredRecord).map((row) => row.cta_type), ['product', 'category']);
});

test('eliminar renumera lo que queda', () => {
  const list = [raw('a'), raw('b'), raw('c')].reduce(upsertStory, []);
  const next = removeStory(list, 'b');
  assert.deepEqual(next.map((story) => story.id), ['a', 'c']);
  assert.deepEqual(next.map((story) => story.sortOrder), [1, 2]);
  assert.deepEqual(removeStory(list, 'no-existe').map((story) => story.id), ['a', 'b', 'c']);
});

test('activar y desactivar sólo tocan el interruptor', () => {
  const list = [raw('a')].reduce(upsertStory, []);
  const off = setStoryEnabled(list, 'a', false);
  assert.equal(off[0].enabled, false);
  assert.equal(storyStatus(off[0]), STORY_STATUS.draft);
  assert.equal(off[0].sortOrder, 1, 'el orden no se toca');

  const on = setStoryEnabled(off, 'a', true);
  assert.equal(on[0].enabled, true);
  assert.equal(storyStatus(on[0]), STORY_STATUS.active);
});

test('al hidratar, el orden guardado manda sobre el orden de llegada', () => {
  // Es el camino real de lectura del almacén: la lista puede llegar en
  // cualquier orden y `sort_order` la vuelve a poner en su sitio, con la
  // numeración compactada a 1..n.
  const stored = normalizeStoryCollection([
    { ...raw('c'), sort_order: 30 },
    { ...raw('a'), sort_order: 10 },
    { ...raw('b'), sort_order: 20 },
  ]);
  assert.deepEqual(stored.map((story) => story.id), ['a', 'b', 'c']);
  assert.deepEqual(resequenceStories(stored).map((story) => story.sortOrder), [1, 2, 3]);
});

test('un alta nueva ignora el sort_order que traiga: entra al final', () => {
  // El número lo decide el almacén, no quien crea la historia. Si no fuera así,
  // una historia nueva con `sort_order: 0` se colaría arriba de todo.
  const list = upsertStory([raw('a'), raw('b')].reduce(upsertStory, []), { ...raw('c'), sort_order: -99 });
  assert.deepEqual(list.map((story) => story.id), ['a', 'b', 'c']);
  assert.deepEqual(list.map((story) => story.sortOrder), [1, 2, 3]);
});

test('un borrador nace apagado y no se puede activar vacío', () => {
  const draft = createStoryDraft({ businessId: 'la-taba-2', now: Date.parse('2026-08-07T12:00:00Z') });
  assert.equal(draft.enabled, false);
  assert.equal(storyStatus(draft), STORY_STATUS.draft);
  assert.equal(draft.businessId, 'la-taba-2');

  const validation = validateStoryForActivation(draft, CATALOG);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((error) => error.includes('imagen o el video')), 'el marcador de posición no alcanza');
  assert.ok(validation.errors.some((error) => error.includes('título')));
});

test('la validación de activación cubre ventana y destino', () => {
  const conVentanaInvertida = upsertStory([], raw('a', {
    starts_at: '2026-08-08T12:00:00Z',
    expires_at: '2026-08-07T12:00:00Z',
  }))[0];
  assert.ok(validateStoryForActivation(conVentanaInvertida, CATALOG).errors
    .some((error) => error.includes('posterior al inicio')));

  const destinoMuerto = upsertStory([], raw('b', { cta_type: 'product', cta_target: 'no-existe' }))[0];
  assert.ok(validateStoryForActivation(destinoMuerto, CATALOG).errors
    .some((error) => error.includes('no está en el catálogo')));

  const buena = upsertStory([], raw('c', { cta_type: 'product', cta_target: 'heineken-lata' }))[0];
  assert.deepEqual(validateStoryForActivation(buena, CATALOG), { ok: true, errors: [] });
});

test('el formulario traduce al contrato sin dejar pasar una CTA a medias', () => {
  const now = Date.parse('2026-08-07T12:00:00Z');
  const sinDestino = storyFromForm({
    id: 'x', title: 'T', mediaType: 'image', mediaUrl: 'assets/promos/x.webp',
    ctaType: 'product', ctaTarget: '', enabled: 'on',
  }, { now });
  assert.equal(sinDestino.cta, null, 'una CTA sin destino no se convierte en botón muerto');
  assert.equal(sinDestino.enabled, true, 'la casilla marcada llega como true');

  const sinAccion = storyFromForm({
    id: 'y', title: 'T', mediaType: 'image', mediaUrl: 'assets/promos/y.webp',
    ctaType: '', ctaTarget: 'heineken-lata',
  }, { now });
  assert.equal(sinAccion.cta, null, 'sin acción no hay destino que valga');
  assert.equal(sinAccion.enabled, false, 'la casilla sin marcar llega como false');
});

test('el formulario acepta fechas locales de datetime-local', () => {
  const story = storyFromForm({
    id: 'z', title: 'T', mediaType: 'image', mediaUrl: 'assets/promos/z.webp',
    startsAt: '2026-08-07T20:00', expiresAt: '2026-08-08T02:00',
  }, { now: Date.parse('2026-08-07T12:00:00Z') });
  assert.equal(story.startsAt, new Date('2026-08-07T20:00').getTime());
  assert.equal(story.expiresAt, new Date('2026-08-08T02:00').getTime());
  assert.ok(story.expiresAt > story.startsAt);
});

test('el registro persistido habla el idioma de la tabla', () => {
  const story = upsertStory([], raw('a', {
    body: 'Texto breve',
    cta_type: 'combo',
    cta_target: 'combo-heineken-x6',
    age_restricted: true,
    starts_at: '2026-08-07T12:00:00Z',
  }))[0];
  const stored = toStoredRecord(story);
  assert.deepEqual(Object.keys(stored).sort(), [
    'age_restricted', 'body', 'business_id', 'created_at', 'cta_target', 'cta_type',
    'enabled', 'expires_at', 'id', 'media_type', 'media_url', 'sort_order',
    'starts_at', 'thumbnail_url', 'title',
  ]);
  assert.equal(stored.cta_type, 'combo');
  assert.equal(stored.cta_target, 'combo-heineken-x6');
  assert.equal(stored.age_restricted, true);
  assert.equal(stored.starts_at, '2026-08-07T12:00:00.000Z');
  assert.equal(stored.expires_at, null);
});
