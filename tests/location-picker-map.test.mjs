import assert from 'node:assert/strict';
import test from 'node:test';

import { createLocationPickerMap } from '../js/map/location_picker_map.js';

test('un error de estilo avisa al consumidor para reemplazar el canvas', () => {
  let mapInstance;
  const unavailable = [];
  class MapStub {
    constructor() {
      this.handlers = new Map();
      mapInstance = this;
    }
    addControl() {}
    on(name, handler) { this.handlers.set(name, handler); }
    remove() {}
  }
  class MarkerStub {
    setLngLat() { return this; }
    addTo() { return this; }
    on() { return this; }
    remove() {}
  }
  const picker = createLocationPickerMap({
    root: { maplibregl: { Map: MapStub, Marker: MarkerStub } },
    documentRef: {
      createElement() {
        return { setAttribute() {}, className: '', innerHTML: '' };
      },
    },
  });
  const container = { dataset: {} };
  assert.equal(picker.mount({
    container,
    point: { latitude: -38.946, longitude: -68.053 },
    onUnavailable: (reason) => unavailable.push(reason),
  }), true);

  mapInstance.handlers.get('error')?.({ error: new Error('style failed') });
  assert.deepEqual(unavailable, ['style']);
  assert.equal(container.dataset.locationMapError, 'true');
  picker.destroy();
});
