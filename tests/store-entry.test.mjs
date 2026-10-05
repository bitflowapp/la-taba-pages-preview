import assert from 'node:assert/strict';
import test from 'node:test';

import { STORE_ENTRY_KIND, describeStoreEntry, nextOpeningLabel } from '../js/core/store-entry.js';

const NOW = new Date(2026, 8, 25, 14, 0, 0);
const JERGA = /verificad|bloquead|despliegue|configuración productiva|backend|catálogo verificado/i;

function todas() {
  return [
    describeStoreEntry({ mode: 'public' }),
    describeStoreEntry({ mode: 'unavailable' }),
    describeStoreEntry({ mode: 'production', catalogState: 'loading' }),
    describeStoreEntry({ mode: 'production', catalogState: 'error' }),
    describeStoreEntry({ mode: 'production', catalogState: 'empty', orderingVerified: true }),
    describeStoreEntry({ mode: 'production', catalogState: 'blocked' }),
    describeStoreEntry({
      mode: 'production',
      catalogState: 'blocked',
      availability: { known: true, isOpen: false, nextOpenAt: new Date(2026, 8, 25, 19, 0).toISOString() },
      now: NOW,
    }),
  ];
}

test('la entrada de la tienda nunca habla en jerga de sistema', () => {
  for (const entry of todas()) {
    assert.ok(entry.title, `sin título: ${entry.kind}`);
    assert.ok(entry.message, `sin mensaje: ${entry.kind}`);
    assert.doesNotMatch(`${entry.title} ${entry.message}`, JERGA, entry.kind);
  }
});

test('CONTROLLED_PRODUCTION hoy: cerrado, sin horario ni productos, sin inventar un motivo', () => {
  // Lo que contesta el backend real (2026-09-25): negocio cerrado, sin
  // `next_open_at`, catálogo vacío y pedidos sin verificar.
  const entry = describeStoreEntry({
    mode: 'production',
    catalogState: 'empty',
    orderingVerified: false,
    availability: { known: true, isOpen: false, nextOpenAt: null },
    now: NOW,
  });
  assert.equal(entry.kind, STORE_ENTRY_KIND.NOT_TAKING_ORDERS);
  assert.equal(entry.title, 'Por ahora no estamos tomando pedidos online');
  assert.equal(entry.retry, false);
  assert.equal(entry.tracking, true);
});

test('con una próxima apertura publicada, la dice; sin ella, no la inventa', () => {
  const abre = describeStoreEntry({
    mode: 'production',
    catalogState: 'blocked',
    availability: { known: true, isOpen: false, nextOpenAt: new Date(2026, 8, 25, 19, 0).toISOString() },
    now: NOW,
  });
  assert.equal(abre.kind, STORE_ENTRY_KIND.CLOSED_UNTIL);
  assert.equal(abre.message, 'Abrimos hoy a las 19:00.');

  const sinHorario = describeStoreEntry({
    mode: 'production',
    catalogState: 'blocked',
    availability: { known: true, isOpen: false, nextOpenAt: null },
    now: NOW,
  });
  assert.equal(sinHorario.kind, STORE_ENTRY_KIND.NOT_TAKING_ORDERS);
  assert.doesNotMatch(sinHorario.message, /\d{1,2}:\d{2}/);
});

test('una apertura vencida o ilegible no se muestra', () => {
  assert.equal(nextOpeningLabel({ nextOpenAt: new Date(2026, 8, 25, 9, 0).toISOString() }, NOW), '');
  assert.equal(nextOpeningLabel({ nextOpenAt: 'mañana temprano' }, NOW), '');
  assert.equal(nextOpeningLabel(null, NOW), '');
  assert.equal(nextOpeningLabel({ nextOpenAt: new Date(2026, 8, 26, 10, 30).toISOString() }, NOW), 'Abrimos mañana a las 10:30');
  assert.match(nextOpeningLabel({ nextOpenAt: new Date(2026, 8, 28, 10, 0).toISOString() }, NOW), /^Abrimos el \S+ a las 10:00$/);
});

test('el error de arranque ofrece reintentar; cargar no', () => {
  assert.equal(describeStoreEntry({ mode: 'production', catalogState: 'error' }).retry, true);
  assert.equal(describeStoreEntry({ mode: 'production', catalogState: 'idle' }).kind, STORE_ENTRY_KIND.LOADING);
  assert.equal(describeStoreEntry({ mode: 'production', catalogState: 'loading' }).retry, false);
  assert.equal(describeStoreEntry({ mode: 'unavailable' }).retry, true);
});

test('un catálogo que tarda demasiado lo dice y ofrece reintentar, sin llamarlo error', () => {
  for (const catalogState of ['idle', 'loading']) {
    const lento = describeStoreEntry({ mode: 'production', catalogState, slow: true });
    assert.equal(lento.kind, STORE_ENTRY_KIND.LOADING, 'sigue cargando: puede llegar todavía');
    assert.equal(lento.retry, true);
    assert.match(lento.title, /tardando más de lo normal/i);
    assert.doesNotMatch(`${lento.title} ${lento.message}`, /no pudimos|error|timeout|\d{3}/i);
    assert.equal(lento.tracking, true, 'un pedido en curso se sigue pudiendo seguir');
  }
});

test('«lento» sólo describe la espera: no pisa un resultado que ya llegó', () => {
  const error = describeStoreEntry({ mode: 'production', catalogState: 'error', slow: true });
  assert.equal(error.kind, STORE_ENTRY_KIND.ERROR);
  assert.equal(error.title, describeStoreEntry({ mode: 'production', catalogState: 'error' }).title);
  const vacio = describeStoreEntry({ mode: 'production', catalogState: 'empty', orderingVerified: true, slow: true, now: NOW });
  assert.equal(vacio.kind, STORE_ENTRY_KIND.CATALOG_EMPTY);
  assert.equal(describeStoreEntry({ mode: 'public', slow: true }).kind, STORE_ENTRY_KIND.UNCONFIGURED);
});

test('sin backend configurado no se ofrece seguir un pedido que no puede existir', () => {
  assert.equal(describeStoreEntry({ mode: 'public' }).tracking, false);
  assert.equal(describeStoreEntry({ mode: 'unavailable' }).tracking, false);
  assert.equal(describeStoreEntry({ mode: 'production', catalogState: 'empty' }).tracking, true);
});

test('un catálogo vacío con pedidos habilitados es una actualización, no un cierre', () => {
  const entry = describeStoreEntry({ mode: 'production', catalogState: 'empty', orderingVerified: true, now: NOW });
  assert.equal(entry.kind, STORE_ENTRY_KIND.CATALOG_EMPTY);
});
