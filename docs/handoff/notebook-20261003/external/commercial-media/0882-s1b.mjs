/*
 * ESCENA 1B — LA PRUEBA. No es una maqueta.
 *
 * Capturas de una compra real hecha contra el entorno de PRUEBAS de TABA2, con
 * Mercado Pago en modo TEST. No hubo dinero real. Se muestran sin retocar.
 */
import { openScene, sleep, shot } from './lib.mjs';

const s = await openScene('s1b');
const { vfx } = s;

const PASOS = [
  ['mp-1-checkout.png',   'La misma compra, contra el entorno de pruebas: paga con Mercado Pago.'],
  ['mp-2-confirmado.png', 'El pago vuelve aprobado y el pedido queda confirmado con su número.'],
  ['mp-3-panel.png',      'Y el Panel del negocio muestra los pedidos de esa misma corrida.'],
];

await vfx.black(true);
await vfx.brand(true);
await vfx.foot('Compra real contra el entorno de pruebas · sin dinero real');
await vfx.chips([{ text: 'Mercado Pago · modo prueba', kind: 'test' }]);
await vfx.stills('win', PASOS.map(([f]) => `/__demo/stills/${f}`));
await vfx.win({ show: true, src: 'about:blank', url: 'taba2 · compra de prueba certificada' });
await vfx.still('win', 0, false);
await sleep(1400);

await vfx.copy({
  num: 'La prueba',
  title: 'Esto <em>ya pasó</em>.',
  sub: 'No es una maqueta: es una compra hecha de punta a punta contra el entorno de pruebas.',
});
console.log('CUT=' + s.marcarCorte());
await vfx.black(false);
await sleep(1600);

for (let i = 0; i < PASOS.length; i += 1) {
  await vfx.still('win', i, false);
  await vfx.say(PASOS[i][1]);
  await sleep(3200);
  await shot(s, `06b-prueba-${i + 1}`);
}

await vfx.say('');
await vfx.copy({
  num: 'La prueba',
  title: 'Cobro, pedido y panel, <em>funcionando juntos</em>.',
  sub: 'Todo verificado en pruebas antes de tocar un peso real.',
});
await sleep(3000);

await vfx.black(true);
await sleep(600);
const out = await s.close();
console.log('problemas:', s.problems.length ? s.problems : 'ninguno');
console.log('video ->', out);
