/*
 * ESCENA 6 — FACTURACIÓN.
 *
 * Escenario SINTÉTICO en ambiente de HOMOLOGACIÓN. No se emitió ningún
 * comprobante, no se tocaron credenciales de ARCA y producción sigue bloqueada.
 * El comprobante que se muestra lo generó la misma herramienta del producto
 * (`npm run fiscal:sample`) y viene rotulado por el propio generador.
 */
import { openScene, tap, mark, sleep, shot, scrollBy, ARCA } from './lib.mjs';
import { installPanelFixtures } from './fixtures.mjs';

const s = await openScene('s6', { base: ARCA, onContext: installPanelFixtures });
const { vfx, win } = s;

await vfx.black(true);
await vfx.brand(true);
await vfx.foot('Escenario sintético · ambiente de homologación · ningún comprobante emitido');
await vfx.chips([{ text: 'Sintético · homologación', kind: 'warn' }]);
await vfx.banner('Demostración sintética · homologación — no es producción');
await vfx.win({ show: true, hero: false, src: `${ARCA}/#business`, url: 'taba2 · panel del negocio · facturación' });

await win.locator('[data-production-workspace="business"]').waitFor({ timeout: 45000 });
await sleep(2600);
await tap(s, win.locator('[data-business-ops-view="fiscal-setup"]').first(), { settle: 300, after: 2200 });
await vfx.cursorOff();
await sleep(900);

console.log('CUT=' + s.marcarCorte());
await vfx.black(false);
await sleep(1400);

await vfx.copy({
  num: 'Escena 6 · La facturación',
  title: 'Se configura <em>una vez</em>.',
  sub: '',
});
await s.page.evaluate(() => {
  const c = document.getElementById('copy');
  c.style.left = '96px'; c.style.top = '50%'; c.style.transform = 'translateY(-50%)'; c.style.width = '600px';
});
await vfx.say('El objetivo: que el negocio cargue sus datos fiscales una sola vez.');
await sleep(3000);
await shot(s, '23-arca-tablero');

await vfx.copyOut();
await vfx.say('Y que después cada venta cobrada se facture sola.');
await sleep(2900);

await mark(s, win.locator('[data-business-ops-center] :text("Facturadas solas")').first(),
  'Se facturan solas', { side: 'ltr', id: 'auto', gap: 22, ring: false });
await sleep(2500);
await vfx.clearMarks();

await vfx.say('El operador sólo mira la pantalla cuando algo necesita atención.');
await scrollBy(s, 'win', 300, { ms: 1100 });
await sleep(2900);
await shot(s, '24-arca-excepciones');

await vfx.say('Ahí queda la excepción, en castellano y con qué hacer.');
await sleep(2800);

await scrollBy(s, 'win', 420, { ms: 1100 });
await vfx.say('Los seis pasos de configuración, con su estado y su explicación.');
await sleep(3200);
await shot(s, '25-arca-seis-pasos');

// ── el comprobante ───────────────────────────────────────────────────────
await vfx.stills('win', ['/__demo/stills/arca-comp-1.png', '/__demo/stills/arca-comp-2.png']);
await vfx.still('win', 0, false);
await vfx.win({ url: 'comprobante generado por TABA2 · muestra sintética' });
await sleep(900);
await vfx.copy({
  num: 'Escena 6 · La facturación',
  title: 'Y sale <em>el comprobante</em>.',
  sub: '',
});
await s.page.evaluate(() => {
  const c = document.getElementById('copy');
  c.style.left = '96px'; c.style.top = '50%'; c.style.transform = 'translateY(-50%)'; c.style.width = '600px';
});
await vfx.say('Este comprobante lo generó TABA2 con el mismo generador que usa el sistema.');
await sleep(3200);
await shot(s, '26-arca-comprobante');
await vfx.say('El propio archivo avisa que es sintético y que no lo emitió ARCA.');
await sleep(2900);
await vfx.still('win', 1, false);
await sleep(700);
await vfx.say('Con su código de autorización y su QR, en el formato que se entrega al cliente.');
await sleep(3200);
await shot(s, '27-arca-cae');

await vfx.copyOut();
await vfx.say('');
await vfx.copy({
  num: 'Escena 6 · La facturación',
  title: 'Lo que <em>falta</em> se dice.',
  sub: 'El circuito está construido y probado punta a punta. Para facturar de verdad falta el certificado de ARCA, que lo tramita una persona con clave fiscal. Producción sigue bloqueada a propósito.',
});
await s.page.evaluate(() => {
  const c = document.getElementById('copy');
  c.style.left = '96px'; c.style.top = '50%'; c.style.transform = 'translateY(-50%)'; c.style.width = '660px';
});
await sleep(4200);

await vfx.black(true);
await sleep(600);
const out = await s.close();
console.log('problemas:', s.problems.length ? s.problems : 'ninguno');
console.log('video ->', out);
