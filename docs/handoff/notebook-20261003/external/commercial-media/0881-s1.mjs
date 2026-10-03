/* ESCENA 1 — CLIENTE. La app real, en modo demo, manejada desde el compositor. */
import { openScene, tap, scrollTo, scrollBy, mark, sleep, shot, APP } from './lib.mjs';

const s = await openScene('s1');
const { vfx, phone } = s;

await vfx.black(true);
await vfx.brand(true);
await vfx.foot('Interfaz real de TABA2 · catálogo y datos de demostración');
await vfx.chips([{ text: 'Modo demostración' }]);
await vfx.phone({ show: false, src: `${APP}/?reset=1&demo=1` });

await phone.locator('[data-view="home"] .home-best-card').first().waitFor({ timeout: 45000 });
await sleep(700);

await vfx.copy({
  num: 'Escena 1 · El cliente',
  title: 'Compra <em>desde el teléfono</em>.',
  sub: 'Elige, arma el pedido y confirma sin llamar, sin esperar y sin que nadie anote nada a mano.',
});
console.log('CUT=' + s.marcarCorte());
await vfx.black(false);
await sleep(400);
await vfx.phone({ show: true });
await sleep(1100);
await vfx.say('El cliente entra a la tienda del negocio desde el teléfono.');
await sleep(1700);
await shot(s, '01-cliente-home');

// ── la vidriera ───────────────────────────────────────────────────────────
await vfx.say('Ve el catálogo con precio y disponibilidad reales.');
await scrollBy(s, 'phone', 640, { ms: 1200 });
await sleep(900);
await scrollTo(s, 'phone', '.home-combos-section', { ms: 1000, offset: -110 });
await sleep(600);
await vfx.say('Y los combos que arma el negocio.');
await sleep(1300);
await shot(s, '02-cliente-combos');

await tap(s, phone.locator('[data-combo-detail="combo-heineken-x6"]'), { settle: 620, after: 1100 });
await vfx.say('Cada combo dice qué trae, cuánto sale y cuánto se ahorra.');
await sleep(2200);
await shot(s, '03-cliente-combo-detalle');
await tap(s, phone.locator('dialog[open] [data-close-combo-modal]'), { settle: 420, after: 800 });

// ── el pedido ─────────────────────────────────────────────────────────────
await scrollTo(s, 'phone', '.home-best-section', { ms: 800, offset: -110 });
await sleep(400);
await vfx.say('Arma el pedido con dos toques.');
await tap(s, phone.locator('[data-add-product="heineken-original-lata-473ml"]'), { settle: 440, after: 750 });
await tap(s, phone.locator('[data-add-product="red-bull-original-lata-250ml"]'), { settle: 440, after: 850 });

await tap(s, phone.locator('.mobile-nav [data-nav-view="cart"]'), { settle: 440, after: 950 });
await phone.locator('[data-view="cart"]').waitFor({ timeout: 20000 });
await sleep(900);

await vfx.copy({
  num: 'Escena 1 · El cliente',
  title: 'El pedido se arma <em>solo</em>.',
  sub: 'Productos, dirección guardada, forma de pago y total. Sin idas y vueltas por teléfono.',
});
await vfx.say('El carrito ya trae su dirección guardada y el total con envío.');
await sleep(1700);
await shot(s, '04-cliente-carrito');

await scrollTo(s, 'phone', '[name="savedCustomerAddress"]', { ms: 1000, offset: -200 });
await sleep(600);
await mark(s, phone.locator('[name="savedCustomerAddress"]').first().locator('xpath=ancestor::label[1]'),
  'Dirección guardada', { side: 'rtl', id: 'dir' });
await sleep(1700);
await vfx.clearMarks();

// forma de pago: el negocio decide cuáles ofrece
await scrollTo(s, 'phone', '[name="paymentMethod"]', { ms: 900, offset: -300 });
await sleep(600);
await phone.locator('[name="paymentMethod"]').selectOption('transfer').catch(() => {});
await sleep(500);
await mark(s, phone.locator('[name="paymentMethod"]'), 'Las formas de pago<br>las define el negocio', { side: 'rtl', id: 'pay' });
await vfx.say('La forma de pago la define el negocio, no el repartidor.');
await sleep(1900);
await vfx.clearMarks();

// mayoría de edad
await scrollTo(s, 'phone', '[name="ageConfirmed"]', { ms: 800, offset: -300 });
await sleep(500);
await tap(s, phone.locator('[name="ageConfirmed"]'), { settle: 480, after: 700 });
await vfx.say('El control de mayoría de edad lo hace el sistema.');
await sleep(1500);

await scrollTo(s, 'phone', '[data-checkout-submit]', { ms: 850, offset: -430 });
await sleep(500);
await shot(s, '05-cliente-resumen');
await vfx.say('Y confirma.');
await sleep(1000);
await tap(s, phone.locator('[data-checkout-submit]'), { settle: 700, after: 2200 });
await sleep(1500);

await vfx.cursorOff();
const orders = await s.page.frames().find((f) => f.url().includes('demo=1'))
  ?.evaluate(() => { try { return JSON.parse(localStorage.getItem('la_taba_mvp_v4_state') || '{}').orders?.map((o) => `${o.id}:${o.status}:${o.total}`); } catch (_) { return null; } });
console.log('pedidos en el estado del cliente:', orders);

await vfx.copy({
  num: 'Escena 1 · El cliente',
  title: 'Listo. <em>El pedido ya existe.</em>',
  sub: 'Desde ese toque, el pedido es un dato del negocio: con número, con total y con estado.',
});
await vfx.say('Listo: el pedido ya tiene número, total y estado.');
await sleep(2300);
await shot(s, '06-cliente-confirmado');

await vfx.black(true);
await sleep(600);

const out = await s.close();
console.log('problemas:', s.problems.length ? s.problems : 'ninguno');
console.log('video ->', out);
