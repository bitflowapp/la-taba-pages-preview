/* ESCENA 2 — EL NEGOCIO. El pedido de la escena 1 entrando al Panel. */
import { openScene, tap, mark, sleep, shot, APP, textOf, frameOf, waitApp, unlockPanel, addToCart } from './lib.mjs';

const s = await openScene('s2');
const { vfx, win } = s;

await vfx.black(true);
await vfx.brand(true);
await vfx.foot('Panel real de TABA2 · datos de demostración');
await vfx.chips([{ text: 'Modo demostración' }]);

// El pedido del cliente se crea fuera de cuadro: es el mismo de la escena 1.
await vfx.win({ show: false, src: `${APP}/?reset=1&demo=1`, url: 'taba2 · panel del negocio' });
await waitApp(s, 'win', '[data-add-product="heineken-original-lata-473ml"]');
await sleep(500);
await addToCart(s, 'win', 'heineken-original-lata-473ml');
await addToCart(s, 'win', 'red-bull-original-lata-250ml');
const checkout = await (await frameOf(s, 'win')).evaluate(async () => {
  const orders = await import(new URL('js/orders.js', location.href).href);
  const r = orders.createOrderFromCheckout({
    customerName: 'Cliente Demo', customerPhone: '299 000 0001',
    streetLine: 'Avenida Argentina 450', neighborhood: 'Neuquén Capital',
    reference: 'Portón negro, timbre 2', deliveryMode: 'delivery',
    paymentMethod: 'transfer', ageConfirmed: true,
  });
  return { ok: r.ok, msg: r.message || null };
});
console.log('pedido del cliente:', JSON.stringify(checkout));
if (!checkout.ok) throw new Error('no se pudo crear el pedido de la escena 2');
await sleep(600);

// Panel, con el PIN ya resuelto fuera de cuadro.
await vfx.win({ src: `${APP}/?demo=1#business` });
await sleep(2600);
const unlocked = await unlockPanel(s, 'win');
console.log('panel operable:', unlocked);
await win.locator('[data-inbox-order="LT-0002"]').waitFor({ timeout: 20000 });
await sleep(600);

await vfx.copy({
  num: 'Escena 2 · El negocio',
  title: 'El pedido <em>entra solo</em>.',
  sub: 'Nadie lo transcribe. Llega con cliente, dirección, productos y total, listo para trabajar.',
});
console.log('CUT=' + s.marcarCorte());
await vfx.black(false);
await sleep(300);
await vfx.win({ show: true });
await sleep(1300);
await vfx.say('El pedido aparece en el Panel del negocio, sin que nadie lo cargue.');
await sleep(2400);
await shot(s, '07-negocio-bandeja');

const card = win.locator('[data-inbox-order="LT-0002"]');
console.log('tarjeta del pedido:', await textOf(card));
await mark(s, card, 'Cliente, dirección,<br>productos y <b>total</b>', { side: 'rtl', id: 'ped', gap: 30 });
await sleep(2600);
await vfx.clearMarks();

await vfx.copy({
  num: 'Escena 2 · El negocio',
  title: 'Y se trabaja <em>en tres pasos</em>.',
  sub: 'Aceptar, preparar, listo. El cliente ve cada paso sin preguntar nada.',
});
const diag = await (await frameOf(s, 'win')).evaluate(() => ({
  activeView: document.body.dataset.activeView,
  pin: !!document.querySelector('[data-open-pin][data-admin-target="business"]'),
  pinVisible: (() => { const n = document.querySelector('[data-open-pin][data-admin-target="business"]'); return n ? n.offsetParent !== null : null; })(),
  advance: [...document.querySelectorAll('[data-order-advance]')].map((n) => n.dataset.orderAdvance),
  inbox: [...document.querySelectorAll('[data-inbox-order]')].map((n) => n.dataset.inboxOrder),
  botones: [...document.querySelectorAll('[data-inbox-order] button')].map((n) => n.textContent.replace(/\s+/g, ' ').trim().slice(0, 24)),
}));
console.log('DIAG panel:', JSON.stringify(diag));
await vfx.say('El negocio lo acepta.');
await sleep(1000);
await tap(s, win.locator('[data-order-advance="LT-0002"]'), { settle: 620, after: 1500 });
await shot(s, '08-negocio-aceptado');
console.log('tras aceptar:', await textOf(card));

await vfx.say('Lo marca en preparación.');
await sleep(1000);
await tap(s, win.locator('[data-order-advance="LT-0002"]'), { settle: 560, after: 1700 });
console.log('tras preparar:', await textOf(card));
await vfx.cursorOff();
await sleep(500);
await vfx.say('Y queda listo para el reparto.');
await mark(s, card, 'Listo para retirar', { side: 'rtl', id: 'listo', gap: 30 });
await sleep(2300);
await vfx.clearMarks();
await shot(s, '09-negocio-listo');

await vfx.say('Todo el pedido vive en un solo lugar, con su estado a la vista.');
await sleep(2400);

await vfx.black(true);
await sleep(600);
const out = await s.close();
console.log('problemas:', s.problems.length ? s.problems : 'ninguno');
console.log('video ->', out);
