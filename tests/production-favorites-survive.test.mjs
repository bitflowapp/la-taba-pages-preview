// Los favoritos del cliente sobreviven a recargar la página (F11).
//
// POR QUÉ EXISTE ESTE ARCHIVO
// ---------------------------
// `loadState()` es efecto de módulo: corre al importar `state.js`, o sea en CADA
// carga. Su rama de producción llamaba a `resetIncompatiblePersistence()` SIN
// ninguna condición —comparar con la rama demo, donde el mismo reset sólo corre
// si el estado guardado es incompatible— y ese reset borra
// `STORAGE_KEYS.customerFavorites`.
//
// Y los favoritos SÍ se escriben en producción: `persistFavorites` los guarda en
// esa misma clave. Se guardaban y se borraban en el arranque siguiente, así que
// la funcionalidad existía y no funcionaba nunca.
//
// La función mezclaba dos cosas distintas: «no cachear datos personales en
// producción», que es obligatorio y se mantiene, y «tirar restos de un esquema
// incompatible», que en la rama productiva no aplica porque ahí no se hidrata
// estado. Los favoritos son ids de producto elegidos por la persona, no PII.
import assert from 'node:assert/strict';
import test from 'node:test';

import { STORAGE_KEYS } from '../js/config.js';

const CLAVE = STORAGE_KEYS.customerFavorites;

function almacenamiento(inicial = {}) {
  const datos = new Map(Object.entries(inicial));
  return {
    getItem: (k) => (datos.has(k) ? datos.get(k) : null),
    setItem: (k, v) => datos.set(k, String(v)),
    removeItem: (k) => datos.delete(k),
    get size() { return datos.size; },
    claves: () => [...datos.keys()],
  };
}

/** Arranca `state.js` en modo producción con un localStorage sembrado. */
async function arrancarEnProduccion(local) {
  Object.defineProperty(globalThis, 'location', {
    value: { search: '', href: 'https://tienda.example/', origin: 'https://tienda.example' },
    configurable: true,
  });
  globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
    mode: 'production',
    repository: {
      provider: 'supabase',
      supabaseUrl: 'https://project.supabase.co',
      publishableKey: 'sb_publishable_favoritos',
      businessId: '11111111-1111-4111-8111-111111111111',
    },
  };
  globalThis.localStorage = local;
  globalThis.sessionStorage = almacenamiento();
  // Import fresco: `loadState()` corre al evaluar el módulo.
  await import(`../js/state.js?favoritos=${Math.random().toString(36).slice(2)}`);
}

test('un arranque productivo no borra los favoritos guardados', async () => {
  const local = almacenamiento({ [CLAVE]: JSON.stringify(['sku-1', 'sku-2']) });
  await arrancarEnProduccion(local);
  assert.equal(
    local.getItem(CLAVE),
    JSON.stringify(['sku-1', 'sku-2']),
    'los favoritos se borraban en cada carga de página',
  );
});

test('y lo que sí es dato personal se sigue sin cachear', async () => {
  // El contrato productivo no cambia: pedidos, perfil e historial siguen sin
  // sobrevivir al arranque. Bajar esta parte sería cambiar un defecto por una
  // filtración.
  const local = almacenamiento({
    [CLAVE]: JSON.stringify(['sku-1']),
    [STORAGE_KEYS.customerProfile]: JSON.stringify({ name: 'Cliente real', phone: '2995550000' }),
    [STORAGE_KEYS.customerHistory]: JSON.stringify([{ id: 'LT-1' }]),
    [STORAGE_KEYS.state]: JSON.stringify({ orders: [{ id: 'LT-1' }] }),
  });
  await arrancarEnProduccion(local);

  assert.equal(local.getItem(STORAGE_KEYS.customerProfile), null, 'el perfil no puede quedar en disco');
  assert.equal(local.getItem(STORAGE_KEYS.customerHistory), null, 'el historial tampoco');
  assert.equal(local.getItem(STORAGE_KEYS.state), null, 'ni el estado con pedidos');
  assert.equal(local.getItem(CLAVE), JSON.stringify(['sku-1']), 'los favoritos sí');
});
