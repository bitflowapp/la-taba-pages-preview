/* ESCENA 5B — OPERACIÓN. Ventas, ticket promedio y stock, sobre un día de demostración. */
import { openScene, tap, sleep, shot, scrollBy, APP, frameOf, waitApp, unlockPanel, addToCart, assertPintado } from './lib.mjs';

const s = await openScene('s5b');
const { vfx, win } = s;

await vfx.black(true);
await vfx.brand(true);
await vfx.foot('Panel real de TABA2 · jornada de demostración');
await vfx.chips([{ text: 'Modo demostración' }]);
await vfx.win({ show: true, src: `${APP}/?reset=1&demo=1`, url: 'taba2 · panel del negocio · métricas' });
await waitApp(s, 'win', '[data-add-product="heineken-original-lata-473ml"]');

/* Una jornada creíble: seis pedidos con distinta composición, la mayoría ya
   entregados. Se crean con la misma función del producto que usa el checkout;
   ninguna cifra se escribe a mano. */
const CESTAS = [
  ['heineken-original-lata-473ml', 'red-bull-original-lata-250ml'],
  ['corona-extra-botella-330ml', 'imperial-apa-lata-473ml'],
  ['schneider-rubia-lata-710ml', 'speed-original-lata-473ml'],
  ['heineken-original-lata-473ml', 'corona-extra-botella-330ml'],
  ['monster-mango-loco-lata-473ml', 'imperial-cream-stout-lata-473ml'],
  ['red-bull-original-lata-250ml', 'speed-zero-lata-473ml'],
];
const creados = [];
for (const cesta of CESTAS) {
  for (const id of cesta) await addToCart(s, 'win', id);
  const r = await (await frameOf(s, 'win')).evaluate(async () => {
    const orders = await import(new URL('js/orders.js', location.href).href);
    const res = orders.createOrderFromCheckout({
      customerName: 'Cliente Demo', customerPhone: '299 000 0001',
      streetLine: 'Avenida Argentina 450', neighborhood: 'Neuquén Capital',
      reference: 'Portón negro', deliveryMode: 'delivery',
      paymentMethod: 'transfer', ageConfirmed: true,
    });
    const { getActiveOrder } = orders;
    return { ok: res.ok, msg: res.message || null, id: getActiveOrder?.()?.id || null };
  });
  creados.push(r);
  await sleep(250);
}
console.log('pedidos creados:', JSON.stringify(creados.map((r) => `${r.id || '-'}:${r.ok}`)));

// Cuatro de esos pedidos se cierran entregados; el resto queda en curso.
const cerrados = await (await frameOf(s, 'win')).evaluate(async () => {
  const orders = await import(new URL('js/orders.js', location.href).href);
  const state = await import(new URL('js/state.js', location.href).href);
  const ids = state.getState().orders.filter((o) => o.status !== 'delivered').map((o) => o.id);
  const done = [];
  for (const id of ids.slice(0, 4)) {
    for (const status of ['preparing', 'ready', 'on_the_way', 'arrived', 'delivered']) {
      orders.updateOrderStatus?.(id, status);
    }
    done.push(id);
  }
  return done;
});
console.log('cerrados como entregados:', JSON.stringify(cerrados));

await vfx.win({ show: true, src: `${APP}/?demo=1&v=1#business` });
await sleep(2600);
await unlockPanel(s, 'win');
await sleep(700);

await tap(s, win.locator('[data-business-view="metrics"]').first(), { settle: 300, after: 1800 });
await vfx.cursorOff();
await sleep(800);

console.log('pintado:', await assertPintado(s, 'win'), 'caracteres');
console.log('CUT=' + s.marcarCorte());
await vfx.black(false);
await sleep(1200);
await vfx.say('Cuánto vendió, cuánto es el ticket promedio y qué se vendió más.');
await sleep(3000);
await shot(s, '20-operacion-metricas');
const metricas = await (await frameOf(s, 'win')).evaluate(() => document.querySelector('main')?.innerText?.replace(/\s+/g, ' ').slice(0, 400));
console.log('métricas:', metricas);

await scrollBy(s, 'win', 300, { ms: 1000 });
await sleep(2200);
await shot(s, '21-operacion-mas-vendidos');

await tap(s, win.locator('[data-business-view="catalog"]').first(), { settle: 500, after: 2000 });
await vfx.cursorOff();
await vfx.say('Y el stock, editable por el mismo negocio, sin llamar a nadie.');
await sleep(3000);
await shot(s, '22-operacion-stock');
await scrollBy(s, 'win', 260, { ms: 1000 });
await sleep(2400);

await vfx.black(true);
await sleep(600);
const out = await s.close();
console.log('problemas:', s.problems.length ? s.problems : 'ninguno');
console.log('video ->', out);
