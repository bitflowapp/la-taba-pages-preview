import test from 'node:test';
import assert from 'node:assert/strict';

import { BUSINESS_OPERATION_VIEWS, allowedBusinessOperationViews } from '../js/business/business-operations-center.js';
import { BUSINESS_VIEW_ORDER, splitBusinessMobileNavigation } from '../js/production-operations.js';

/*
 * Dos listas tienen que decir lo mismo y nada las ataba.
 *
 * `BUSINESS_OPERATION_VIEWS` dice qué pantallas EXISTEN: cada una con su
 * etiqueta, su permiso y su despacho. `BUSINESS_VIEW_ORDER` dice cuáles se
 * DIBUJAN, y es la única que la persona ve.
 *
 * Se separaron sin que nadie lo notara: `team-access` —la bandeja donde el dueño
 * aprueba a quien pide entrar— y `operations-config` se agregaron a la primera y
 * no a la segunda. Quedaron en producción sin ningún botón que llevara a ellas.
 * El dueño no podía aprobar a un repartidor que estaba esperando, y no había
 * forma de darse cuenta desde la aplicación: la pantalla no estaba escondida,
 * no estaba.
 *
 * Las pruebas que ya existían no lo veían porque llaman a las funciones de
 * render directamente. Una pantalla se prueba sola; llegar a ella, no.
 */

test('toda superficie que existe tiene un destino que la dibuja', () => {
  const invisibles = BUSINESS_OPERATION_VIEWS.filter((view) => !BUSINESS_VIEW_ORDER.includes(view));

  assert.deepEqual(
    invisibles,
    [],
    `estas pantallas existen y no hay ningún botón que lleve a ellas: ${invisibles.join(', ')}. `
    + 'Agregalas a BUSINESS_VIEW_ORDER, en la posición que les corresponda.',
  );
});

test('todo destino que se dibuja corresponde a una superficie real', () => {
  const fantasmas = BUSINESS_VIEW_ORDER.filter((view) => !BUSINESS_OPERATION_VIEWS.includes(view));

  assert.deepEqual(
    fantasmas,
    [],
    `estos destinos se dibujan y no abren nada: ${fantasmas.join(', ')}.`,
  );
});

test('el dueño llega a la bandeja de solicitudes desde el teléfono', () => {
  // El camino que tiene que existir: los cuatro destinos de abajo, o la hoja de
  // «Más». En un teléfono no hay una tercera puerta.
  const permitidas = allowedBusinessOperationViews('owner');
  assert.ok(permitidas.includes('team-access'), 'el dueño tiene que poder abrir la bandeja');

  const { primary, rest } = splitBusinessMobileNavigation(permitidas);
  assert.equal(primary.length, 4, 'la barra inferior lleva cuatro destinos');
  assert.ok(
    primary.includes('team-access') || rest.includes('team-access'),
    'la bandeja tiene que estar en la barra o en la hoja de «Más»: si no, no hay camino',
  );
});

test('un repartidor no ve la bandeja ni ningún destino del negocio', () => {
  const permitidas = allowedBusinessOperationViews('rider');
  assert.ok(!permitidas.includes('team-access'));
  const { primary, rest } = splitBusinessMobileNavigation(permitidas);
  assert.deepEqual([...primary, ...rest], [], 'el Panel no le ofrece nada a un rol ajeno');
});

test('un empleado no puede llegar a decidir quién entra al comercio', () => {
  const permitidas = allowedBusinessOperationViews('staff');
  assert.ok(!permitidas.includes('team-access'), 'decidir quién entra es del dueño o el encargado');
  const { primary, rest } = splitBusinessMobileNavigation(permitidas);
  assert.ok(![...primary, ...rest].includes('team-access'));
});

test('«Alta» ya no nombra a la creación de un producto', () => {
  // El Panel da de alta productos y también personas. Una etiqueta que diga
  // sólo «Alta» es ambigua justo donde la confusión cuesta caro.
  const { rest } = splitBusinessMobileNavigation(allowedBusinessOperationViews('owner'));
  assert.ok(rest.includes('product-create'));
});
