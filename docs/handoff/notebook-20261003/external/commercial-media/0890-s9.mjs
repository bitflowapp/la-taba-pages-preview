/* CIERRE. */
import { openScene, sleep, shot } from './lib.mjs';

const s = await openScene('s9');
const { vfx } = s;

await vfx.black(true);
await sleep(300);
await vfx.card({
  kicker: 'Quién lo hizo',
  big: 'TABA2 fue diseñada, integrada<br>y operada por <em>Marco Luna</em>.',
  small: 'Tienda, panel del negocio, app de reparto, seguimiento, cobros y facturación: un solo sistema, sostenido por una sola persona.',
  meta: '',
});
console.log('CUT=' + s.marcarCorte());
await vfx.black(false);
await sleep(6200);
await shot(s, '29-cierre-marco');

await vfx.cardOut();
await sleep(900);
await vfx.card({
  kicker: 'Lo que sigue haciendo falta',
  big: 'Desarrollo · automatización<br>mantenimiento · integraciones<br><em>soporte operativo</em>',
  small: 'Un sistema que vende, cobra, reparte y factura no se termina: se opera, se corrige y se amplía.',
  meta: '',
});
await sleep(6200);
await shot(s, '30-cierre-servicios');

await vfx.cardOut();
await sleep(900);
await vfx.card({
  kicker: '',
  big: 'TABA2 no es el final.<br><em>Es la base para seguir<br>digitalizando el negocio.</em>',
  small: '',
  meta: 'La Taba 2 · TABA2',
});
await sleep(6600);
await shot(s, '31-cierre-final');
await vfx.black(true);
await sleep(900);

const out = await s.close();
console.log('problemas:', s.problems.length ? s.problems : 'ninguno');
console.log('video ->', out);
