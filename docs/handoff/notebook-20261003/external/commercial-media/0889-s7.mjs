/*
 * ESCENA 7 — EL MISMO SISTEMA, POR WHATSAPP.
 *
 * El canal está construido y certificado en PRUEBAS
 * (`TABA2_WHATSAPP_COMMERCE_TEST_FLOW_CERTIFIED`, rama
 * feature/taba2-whatsapp-commerce): 75 tests y un E2E completo contra una base
 * propia. Todavía NO está conectado a un número oficial de WhatsApp Business.
 *
 * Por eso acá no se muestra una captura de WhatsApp —no existe— sino un
 * diagrama con los textos que el canal produce, rotulado como tal.
 */
import { openScene, sleep, shot } from './lib.mjs';

const s = await openScene('s7');
const { vfx } = s;

/*
 * Cada renglón sale del canal certificado: los precios son los del catálogo de
 * prueba del E2E (Fernet Branca $ 12.800 · Coca-Cola 1,5 L $ 3.200) y el pedido
 * de abajo es el que la certificación cerró: combo «Noche larga» + 2 Coca-Cola,
 * subtotal 20.000 − descuento 1.700 + envío 1.500 = 19.800, pedido LT-0101.
 */
const FILAS = [
  { who: 'cli', label: 'Cliente', text: 'Quiero un fernet con coca' },
  { who: 'sys', label: 'TABA2', text: 'Esto es lo que hay de cada uno:<br><b>Fernet Branca</b> · Botella 750 ml · $ 12.800<br><b>Coca-Cola Original</b> · Botella 1,5 L · $ 3.200' },
  { who: 'note', label: '', text: 'El precio, el stock y el descuento salen del catálogo del negocio. El bot entiende; el backend decide.' },
  { who: 'cli', label: 'Cliente', text: '📍 (manda su ubicación)' },
  { who: 'sys', label: 'TABA2', text: 'Carrito · subtotal $ 20.000<br>descuento del combo −$ 1.700 · envío $ 1.500<br><b>TOTAL $ 19.800</b> · Finalizar compra' },
  { who: 'sys', label: 'TABA2', text: 'Te paso el enlace de pago de Mercado Pago.' },
  { who: 'sys', label: 'TABA2', text: 'Mercado Pago confirmó tu pago ✅<br>Tu pedido es <b>LT-0101</b> por $ 19.800.' },
  { who: 'note', label: '', text: 'El mismo carrito comprado desde la web cobra lo mismo. El pedido entra al mismo Panel y a la misma cola del reparto.' },
];

const CABEZA = 'Canal de pedidos de TABA2 · flujo certificado en pruebas, con sus textos y sus importes<br>No es una captura de WhatsApp';

await vfx.black(true);
await vfx.brand(true);
await vfx.foot('Canal construido y probado en pruebas · sin número oficial conectado todavía');
await vfx.chips([{ text: 'Probado en pruebas', kind: 'test' }]);
await vfx.flow(CABEZA, FILAS);
await vfx.phone({ show: true, side: 'left', src: 'about:blank' });
await vfx.copy({
  num: 'Escena 7 · Lo que sigue',
  title: 'El mismo sistema, <em>por WhatsApp</em>.',
  sub: 'El bot entiende; el backend decide. Mismo catálogo, mismos precios, mismo stock, mismo pedido.',
});
await s.page.evaluate(() => { document.getElementById('copy').style.left = '820px'; });
await sleep(600);
console.log('CUT=' + s.marcarCorte());
await vfx.black(false);
await sleep(1500);

await vfx.say('El cliente escribe lo que quiere.');
for (let i = 0; i < FILAS.length; i += 1) {
  await vfx.flowStep(i);
  if (i === 1) await vfx.say('TABA2 contesta con lo que hay de verdad en el catálogo del negocio.');
  if (i === 3) await vfx.say('Manda su ubicación y el punto viaja hasta el pedido.');
  if (i === 4) await vfx.say('El carrito, el descuento y el envío los calcula el mismo motor que la web.');
  if (i === 6) await vfx.say('El pedido queda confirmado con su número.');
  if (i === 7) await vfx.say('Y entra al mismo Panel y a la misma cola del reparto.');
  await sleep(i === 2 || i === 7 ? 2600 : i >= 4 ? 2400 : 1800);
}
await shot(s, '28-whatsapp-flujo');
await sleep(700);

await vfx.say('');
await vfx.copy({
  num: 'Escena 7 · Lo que sigue',
  title: 'Falta <em>una sola cosa</em>.',
  sub: 'El canal está construido y probado. Para venderle a un cliente real falta conectar el número oficial de WhatsApp Business del negocio.',
});
await s.page.evaluate(() => { document.getElementById('copy').style.left = '820px'; });
await sleep(3600);

await vfx.black(true);
await sleep(600);
const out = await s.close();
console.log('problemas:', s.problems.length ? s.problems : 'ninguno');
console.log('video ->', out);
