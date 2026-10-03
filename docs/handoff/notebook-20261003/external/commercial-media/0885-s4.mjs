/* ESCENA 4 — EL CLIENTE SIGUE SU PEDIDO. Mapa y estados reales del tracking. */
import { openScene, addToCart, unlockPanel, mark, sleep, shot, APP, frameOf, waitApp, assertPintado } from './lib.mjs';

const s = await openScene('s4');
const { vfx, phone } = s;
const ID = 'LT-0002';

/* Cada paso de la puesta en escena se confirma: el panel y la vista del rider
   se re-renderizan por intervalo y un click al aire deja la escena a medias. */
async function press(selector, label) {
  const el = phone.locator(selector).first();
  for (let i = 0; i < 10; i += 1) {
    const there = await el.waitFor({ state: 'attached', timeout: 3500 }).then(() => true).catch(() => false);
    if (there) {
      await el.dispatchEvent('click', {}, { timeout: 3000 }).catch(() => {});
      await sleep(800);
      console.log('  ok ·', label);
      return true;
    }
    await sleep(600);
  }
  throw new Error(`no se pudo: ${label} (${selector})`);
}

/* Cada tramo se carga de nuevo con una query distinta: cambiar sólo el hash del
   iframe deja viva la instancia anterior del mapa y la siguiente monta rota. */
let paso = 0;
async function ir(hash) {
  paso += 1;
  await vfx.phone({ src: `${APP}/?demo=1&p=${paso}${hash}` });
  await sleep(2400);
}

await vfx.black(true);
await vfx.brand(true);
await vfx.foot('Seguimiento real de TABA2 · datos de demostración');
await vfx.chips([{ text: 'Modo demostración' }]);
await vfx.phone({ show: false, src: `${APP}/?reset=1&demo=1` });

// ── puesta en escena, a negro ────────────────────────────────────────────
await waitApp(s, 'phone', '[data-add-product="heineken-original-lata-473ml"]');
await addToCart(s, 'phone', 'heineken-original-lata-473ml');
await addToCart(s, 'phone', 'red-bull-original-lata-250ml');
const checkout = await (await frameOf(s, 'phone')).evaluate(async () => {
  const orders = await import(new URL('js/orders.js', location.href).href);
  // El domicilio del cliente es un punto público rotulado como demo, nunca la
  // casa de nadie. Antes decía «Avenida Argentina 450», que además de ser un
  // domicilio verosímil caía junto a Parque Central.
  const r = orders.createOrderFromCheckout({
    customerName: 'Cliente Demo', customerPhone: '299 000 0001',
    streetLine: 'Plaza de la Vida · destino demo 1', neighborhood: 'Neuquén Capital',
    reference: 'Punto de demostración, no es un domicilio', deliveryMode: 'delivery',
    paymentMethod: 'transfer', ageConfirmed: true,
  });
  return { ok: r.ok, msg: r.message || null };
});
console.log('pedido:', JSON.stringify(checkout));
if (!checkout.ok) throw new Error('sin pedido para seguir');

await ir('#business');
await unlockPanel(s, 'phone');
await press(`[data-order-advance="${ID}"]`, 'negocio acepta');
await press(`[data-order-advance="${ID}"]`, 'negocio prepara');

await ir('#rider');
await press(`[data-rider-accept="${ID}"]`, 'rider toma el pedido');
await press(`[data-delivery-leave="${ID}"]`, 'rider sale del local');
await press('[data-sim-start]', 'arranca el recorrido');
await sleep(1200);

/* El seguimiento se carga hasta que el mapa quede listo Y la pantalla pinte de
   verdad. Una corrida devolvió el DOM completo y el iframe en negro.

   El teléfono se enciende ANTES de verificar: `assertPintado` mira quién está
   arriba en ese punto, y con el dispositivo en opacidad 0 lo que contesta es la
   viñeta del escenario (`.vig`), no el marco. La escena sigue fundida a negro
   hasta `vfx.black(false)`, así que esto no cambia un solo fotograma. */
await vfx.phone({ show: true });
let mapStatus = 'sin mapa';
let pintado = 0;
for (let intento = 1; intento <= 3; intento += 1) {
  await ir('#tracking');
  await phone.locator('[data-tracking-panel] .track-layout').waitFor({ timeout: 30000 }).catch(() => {});
  for (let i = 0; i < 24; i += 1) {
    const frame = await frameOf(s, 'phone');
    mapStatus = await frame.evaluate(() => document.querySelector('[data-tracking-panel] [data-real-map]')?.dataset?.mapStatus || 'sin mapa').catch(() => 'sin mapa');
    if (mapStatus === 'ready' || mapStatus === 'unavailable') break;
    await sleep(900);
  }
  await sleep(1400);
  pintado = await assertPintado(s, 'phone').catch((e) => { console.log('  aviso:', e.message.slice(0, 90)); return 0; });
  console.log(`intento ${intento}: mapa=${mapStatus} · pintado=${pintado} caracteres`);
  if (pintado && mapStatus === 'ready') break;
}
if (!pintado) throw new Error('el seguimiento no llegó a pintarse');
if (mapStatus !== 'ready') throw new Error(`el mapa quedó en "${mapStatus}"`);

// ── en cuadro ────────────────────────────────────────────────────────────
await vfx.copy({
  num: 'Escena 4 · El cliente',
  title: 'Sabe <em>dónde está</em> su pedido.',
  sub: 'El mismo pedido, visto desde el teléfono del cliente: estado, mapa y última posición del repartidor.',
});
await vfx.phone({ show: true });
await sleep(300);
console.log('CUT=' + s.marcarCorte());
await vfx.black(false);
await sleep(1500);
await vfx.say('El cliente sigue su pedido sin llamar al local.');
await sleep(2600);
await shot(s, '13-tracking-en-camino');

await mark(s, phone.locator('[data-tracking-panel] [data-real-map]').first(),
  'Última posición<br>del repartidor', { side: 'rtl', id: 'mapa', gap: 26, ring: false });
await sleep(2500);
await vfx.clearMarks();

await vfx.say('Y ve el estado que el negocio marcó, sin preguntar nada.');
await sleep(2600);
await shot(s, '14-tracking-detalle');

await vfx.copy({
  num: 'Escena 4 · El cliente',
  title: 'Menos llamadas <em>al mostrador</em>.',
  sub: 'Si el repartidor deja de reportar, el sistema lo dice. Nunca inventa una posición.',
});
await sleep(3200);

await vfx.black(true);
await sleep(600);
const out = await s.close();
console.log('problemas:', s.problems.length ? s.problems : 'ninguno');
console.log('video ->', out);
