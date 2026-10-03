/* ESCENA 5A — OPERACIÓN. Centro de operación y revisión de apertura, con datos de prueba. */
import { openScene, tap, mark, sleep, shot, scrollBy, APP } from './lib.mjs';
import { installPanelFixtures } from './fixtures.mjs';

const s = await openScene('s5a', { onContext: installPanelFixtures });
const { vfx, win } = s;

await vfx.black(true);
await vfx.brand(true);
await vfx.foot('Panel del negocio · datos de prueba, ningún dato real de clientes');
await vfx.chips([{ text: 'Datos de prueba', kind: 'test' }]);
await vfx.win({ show: true, hero: true, src: `${APP}/#business`, url: 'taba2 · panel del negocio · centro de operación' });

await win.locator('[data-production-workspace="business"]').waitFor({ timeout: 45000 });
await sleep(2600);
await win.locator('[data-business-ops-center="operation-center"]').waitFor({ timeout: 20000 }).catch(() => {});
await sleep(1200);

console.log('CUT=' + s.marcarCorte());
await vfx.black(false);
await sleep(1300);
await vfx.say('El Panel no sólo toma pedidos: dice qué está pasando en el negocio.');
await sleep(2800);
await shot(s, '15-operacion-centro');

await mark(s, win.locator('[data-business-ops-view="orders"]').nth(1), 'Pedidos demorados', { side: 'ltr', id: 'dem', gap: 26 });
await sleep(2400);
await vfx.clearMarks();

await scrollBy(s, 'win', 380, { ms: 1100 });
await sleep(1500);
await vfx.say('Pagos a revisar, preparaciones abiertas, envíos en la calle, comprobantes pendientes.');
await sleep(3000);
await shot(s, '16-operacion-tiles');

await scrollBy(s, 'win', 420, { ms: 1100 });
await sleep(1600);
await vfx.say('Y las alertas que hay que frenar y resolver antes de seguir cobrando.');
await sleep(3000);
await shot(s, '17-operacion-alertas');

// ── revisión de apertura ─────────────────────────────────────────────────
await scrollBy(s, 'win', -900, { ms: 900 });
await sleep(700);
await tap(s, win.locator('[data-business-ops-view="day-open"]').first(), { settle: 600, after: 2000 });
await vfx.cursorOff();
await vfx.say('Antes de abrir, el sistema se revisa a sí mismo.');
await sleep(2600);
await shot(s, '18-operacion-apertura');
await scrollBy(s, 'win', 340, { ms: 1000 });
await sleep(1400);
await vfx.say('Internet, cobros, facturación, repartidores y colas: cada uno con su estado.');
await sleep(3000);
await shot(s, '19-operacion-salud');

await vfx.black(true);
await sleep(600);
const out = await s.close();
console.log('problemas:', s.problems.length ? s.problems : 'ninguno');
console.log('video ->', out);
