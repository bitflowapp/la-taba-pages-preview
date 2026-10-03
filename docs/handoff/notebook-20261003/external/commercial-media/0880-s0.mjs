/* APERTURA. */
import { openScene, sleep, shot } from './lib.mjs';

const s = await openScene('s0');
const { vfx } = s;

await vfx.black(true);
await sleep(300);
await vfx.card({
  kicker: 'Para Walter · La Taba 2 · Neuquén',
  big: 'Un cliente compra.<br>El negocio entrega.<br><em>El sistema hace el resto.</em>',
  small: 'TABA2 en cuatro minutos: qué hace hoy, qué está probado y qué falta.',
  meta: 'Interfaces reales · datos de demostración',
});
console.log('CUT=' + s.marcarCorte());
await vfx.black(false);
await sleep(7000);
await shot(s, '00-apertura');
await vfx.black(true);
await sleep(700);

const out = await s.close();
console.log('problemas:', s.problems.length ? s.problems : 'ninguno');
console.log('video ->', out);
