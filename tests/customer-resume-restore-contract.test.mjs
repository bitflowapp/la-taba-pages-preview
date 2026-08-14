import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

/*
 * EL DEFECTO QUE ESTAS PRUEBAS IMPIDEN QUE VUELVA
 *
 * `bindEvents()` apagaba el seguimiento del cliente dentro del listener de
 * `pagehide` —`syncCustomerTrackingWithView('')`, que NO pausa: destruye la
 * sesión y desarma los propios listeners de reanudación del controlador— y lo
 * volvía a armar únicamente con `pageshow`.
 *
 * Esa asimetría es todo el defecto. Un navegador que emite la señal de
 * suspensión pero no la de restauración —porque no vuelve desde la caché de
 * retroceso, sino que sigue con la misma página viva— quedaba con el
 * seguimiento apagado y sin nada que lo encendiera: lo apagado era justamente
 * lo que traía novedades, así que tampoco había un cambio de estado que
 * redibujara.
 *
 * El contrato es de FORMA, no de navegador: nada puede volver a apagar el
 * seguimiento del cliente en un evento de suspensión, y la restauración se
 * escucha con todas las señales de vuelta, no con una.
 */

test('pagehide no apaga el seguimiento del cliente', () => {
  const app = read('js/app.js');
  const pagehide = app.match(/window\.addEventListener\('pagehide',[\s\S]*?\n {2}\}\);/);
  assert.ok(pagehide, 'debería existir el listener de pagehide');
  assert.doesNotMatch(
    pagehide[0],
    /syncCustomerTrackingWithView/,
    'apagar el seguimiento al suspenderse sólo es reversible si TODOS los navegadores '
    + 'emiten la señal de vuelta, y no lo hacen',
  );
  // Lo que sí tiene que seguir cortándose en pagehide: el GPS del rider.
  assert.match(pagehide[0], /disableGpsTracking\(\{ silent: true, preserveLastFix: true \}\)/);
  assert.match(pagehide[0], /handleProductionOperationsPageHide\(\)/);
});

test('la restauración del seguimiento escucha todas las señales de vuelta', () => {
  const app = read('js/app.js');
  assert.match(app, /import \{ onBrowserResume \} from '\.\/core\/browser-resume\.js';/);
  assert.match(
    app,
    /onBrowserResume\(\(\) => syncCustomerTrackingWithView\(activeView\)\)/,
    'la vuelta tiene que rearmar el seguimiento por cualquiera de las señales',
  );
  assert.doesNotMatch(
    app,
    /window\.addEventListener\('pageshow', \(\) => syncCustomerTrackingWithView/,
    'pageshow suelto era exactamente la única señal que fallaba',
  );
});

test('la reconciliación autoritativa no depende de la salud del canal realtime', () => {
  const repository = read('js/repositories/supabase_order_repository.js');
  assert.match(repository, /import \{ onBrowserResume \} from '\.\.\/core\/browser-resume\.js';/);

  const watch = repository.match(/function createRealtimeWatch\(\{[\s\S]*?\n\}\n/);
  assert.ok(watch, 'debería existir createRealtimeWatch');

  // Volver del segundo plano consulta al servidor, pase lo que pase con el socket.
  assert.match(watch[0], /onBrowserResume\(\(\) => catchUp\(\)/);
  // Reconectar no alcanza: postgres_changes no reproduce lo que pasó en el hueco.
  assert.match(watch[0], /if \(hasBeenDisconnected\) \{[\s\S]*?catchUp\(\)/);
  // Y perder el canal consulta ya, no un intervalo después.
  assert.match(watch[0], /const startFallback = \(\) => \{[\s\S]*?void catchUp\(\);/);
  // Desmontar tiene que desarmar también esos listeners.
  assert.match(watch[0], /stopResumeWatch\(\)/);
});

/*
 * Los tres disparadores de puesta al día —arranque, caída del canal y vuelta
 * del navegador— llegan juntos en el arranque. Sin single-flight, cada uno abre
 * su propia consulta, y sobre un pedido ENTREGADO eso duplica una revalidación
 * terminal que es deliberadamente única. Lo detectó tracking-terminal-expiry.
 */
test('las puestas al día concurrentes se cuelgan de la que ya está en vuelo', () => {
  const repository = read('js/repositories/supabase_order_repository.js');
  const watch = repository.match(/function createRealtimeWatch\(\{[\s\S]*?\n\}\n/);
  assert.match(watch[0], /if \(catchUpInFlight\) return catchUpInFlight;/);
  assert.match(watch[0], /catchUpInFlight = Promise\.resolve\(safeTask\(task\)\)/);
  assert.match(watch[0], /\.finally\(\(\) => \{ catchUpInFlight = null; \}\)/);
  // El arranque también entra por ahí, en vez de ser una llamada suelta.
  assert.match(watch[0], /if \(initialTask\) void catchUp\(initialTask\);/);
  assert.match(repository, /fallbackTask: refresh,[\s\S]{0,300}?initialTask: refresh,/);
});

/*
 * Y un solo dueño por pedido: mientras el controlador tokenizado tiene la
 * sesión, el sync global no vuelve a preguntar por ese mismo pedido.
 */
test('el sync global no compite con el controlador de seguimiento por el mismo pedido', () => {
  const repository = read('js/repositories/supabase_order_repository.js');
  assert.match(
    repository,
    /const pollOwnsTracking = \(trackingPollState\.active \|\| trackingPollState\.terminal\)\s*\n\s*&& trackingPollState\.orderId === trackedId;/,
  );
  assert.match(repository, /&& !pollOwnsTracking\n/);
});

test('el controlador de polling conserva sus propias señales de reanudación', () => {
  const poll = read('js/tracking/customer_tracking_poll.js');
  for (const type of ['visibilitychange', 'focus', 'pageshow', 'online']) {
    assert.match(
      poll,
      new RegExp(`addEventListener\\?\\.\\('${type}'`),
      `el controlador debe seguir escuchando '${type}'`,
    );
  }
});

test('browser-resume viaja en el precache del service worker', () => {
  assert.match(read('sw.js'), /'\.\/js\/core\/browser-resume\.js'/);
});
