/*
 * ESCENA 3 — EL RIDER.
 *
 * Acá no hay demo: son capturas del teléfono real (Moto G15, Android 15),
 * tomadas de una sola corrida sobre el build `commercialReview`, que se instala
 * al lado de staging, no lleva configuración de backend y se alimenta de
 * fixtures locales. Se muestran sin retocar; el único proceso es el recorte y
 * la bajada de escala al encuadre del marco (`capturar-rider.ps1`).
 *
 * Antes venían de dos sesiones distintas y las dos habían quedado obsoletas:
 * unas mostraban «Tercera Docena — Diag. España 115» con el pin junto a Parque
 * Central, y otras decían «no hay coordenadas autorizadas», que dejó de ser
 * cierto cuando la app adoptó el contrato central de ubicación.
 */
import { openScene, sleep, shot } from './lib.mjs';

const s = await openScene('s3');
const { vfx } = s;

/* La línea del mapa NO dice «su posición real»: estas capturas no llevan un fix
   de GPS, y el que llevaban antes era la posición real de quien sostenía el
   teléfono ese día. Lo que sí muestran, y es lo que esta corrección arregló, es
   que el retiro cae donde está el local. */
const PASOS = [
  ['rider-1-buscando.png',   'El repartidor abre la app y espera pedidos.'],
  ['rider-2-nuevo.png',      'Le entra el pedido con el retiro y la entrega, y lo toma.'],
  ['rider-3-retiro.png',     'Va al local a retirarlo.'],
  ['rider-4-retirado.png',   'Confirma el retiro: el negocio ya sabe que salió.'],
  ['rider-5-mapa.png',       'Sale a la calle con el mapa, y el retiro cae en Mendoza 827.'],
  ['rider-6-llegaste.png',   'Avisa que llegó al domicilio.'],
  ['rider-7-codigo.png',     'El cliente le dicta el código de la entrega.'],
  ['rider-8-entregado.png',  'Y la entrega queda registrada una sola vez.'],
  ['rider-9-sin-conexion.png', 'Si se queda sin señal, la app encola y no se pierde nada.'],
];

await vfx.black(true);
await vfx.brand(true);
// El rótulo dice las dos cosas, porque las dos son ciertas: el aparato y la app
// son reales, y el pedido que se ve es de prueba.
await vfx.foot('Capturas del dispositivo real · Moto G15 · Android 15 · pedido de prueba');
await vfx.chips([{ text: 'App Android real', kind: 'real' }, { text: 'Datos de prueba' }]);
await vfx.stills('phone', PASOS.map(([f]) => `/__demo/stills/${f}`));
await vfx.phone({ show: true, side: 'left', src: 'about:blank' });
await vfx.still('phone', 0, false);
await sleep(1500);

await vfx.copy({
  num: 'Escena 3 · El reparto',
  title: 'El reparto también <em>es parte del sistema</em>.',
  sub: 'Una app propia en el teléfono del repartidor: la misma cadena del pedido, hasta la puerta del cliente.',
});
// La columna de texto vive a la derecha en esta escena: el teléfono va a la izquierda.
await s.page.evaluate(() => { document.getElementById('copy').style.left = '820px'; });
console.log('CUT=' + s.marcarCorte());
await vfx.black(false);
await sleep(1800);

for (let i = 0; i < PASOS.length; i += 1) {
  await vfx.still('phone', i, true);
  await vfx.say(PASOS[i][1]);
  await sleep(i === 0 ? 2400 : 2700);
  if (i === 1) await shot(s, '10-rider-nuevo-pedido');
  if (i === 4) await shot(s, '11-rider-mapa');
  if (i === 7) await shot(s, '12-rider-entregado');
}

await vfx.say('');
await vfx.copy({
  num: 'Escena 3 · El reparto',
  title: 'Sin planillas <em>ni llamadas</em>.',
  sub: 'Cada estado que marca el repartidor es el mismo que ve el negocio y el mismo que ve el cliente.',
});
await s.page.evaluate(() => { document.getElementById('copy').style.left = '820px'; });
await sleep(3000);

await vfx.black(true);
await sleep(600);
const out = await s.close();
console.log('problemas:', s.problems.length ? s.problems : 'ninguno');
console.log('video ->', out);
