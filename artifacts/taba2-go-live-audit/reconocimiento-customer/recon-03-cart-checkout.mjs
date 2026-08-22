// READ-ONLY recon: carrito + checkout + GATE. NUNCA se toca [data-checkout-submit].
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const BASE = 'https://la-taba.pages.dev';
const log = [];
const say = (...a) => { const s = a.join(' '); log.push(s); console.log(s); };
const dump = () => fs.writeFileSync(`${OUT}/recon-03-cart-checkout.txt`, log.join('\n'), 'utf8');

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', locale: 'es-AR' });
await ctx.addInitScript(() => {
  try { localStorage.setItem('TABA_INSTALL_PROMPT_V1', JSON.stringify({ dismissedAt: Date.now(), choice: 'later' })); } catch (e) {}
});
const page = await ctx.newPage();

try {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);

  // buscar y agregar 2 productos distintos
  const search = page.locator('[data-search-input]:visible').first();
  await search.fill('Coca-Cola');
  await page.waitForTimeout(2200);
  const buyables = page.locator('[data-product-grid] .product-card').filter({ has: page.locator('[data-add-product]:not([disabled])') });
  const n = await buyables.count();
  say('tarjetas comprables en "Coca-Cola":', n);
  const id0 = await buyables.nth(0).locator('[data-add-product]').getAttribute('data-add-product');
  const id1 = n > 1 ? await buyables.nth(1).locator('[data-add-product]').getAttribute('data-add-product') : null;
  say('ids:', id0, id1);
  // OJO: el mismo id existe en los carruseles del home (.home-add-button, ocultos).
  // Hay que acotar SIEMPRE a [data-product-grid].
  say('duplicados de id0 en la pagina:', await page.locator(`[data-add-product="${id0}"]`).count());
  await page.locator(`[data-product-grid] [data-add-product="${id0}"]`).click();
  await page.waitForTimeout(1200);
  if (id1) { await page.locator(`[data-product-grid] [data-add-product="${id1}"]`).click(); await page.waitForTimeout(1200); }
  await page.locator(`[data-product-grid] [data-cart-inc="${id0}"]`).click();
  await page.waitForTimeout(1200);

  // ---------- PASO 4: CARRITO ----------
  say('\n########## PASO 4 — CARRITO ##########');
  await page.locator('[data-nav-view="cart"]:visible, [data-open-cart]:visible').first().click();
  await page.waitForTimeout(2500);
  say('view activa:', await page.evaluate(() => document.querySelector('.app-view.is-active')?.getAttribute('data-view')));
  await page.screenshot({ path: `${OUT}/04-carrito.png`, fullPage: true });

  say('=== [data-cart-list] outerHTML ===\n' + await page.evaluate(() => document.querySelector('[data-cart-list]')?.outerHTML || 'NO EXISTE'));

  say('\n=== LINEAS PARSEADAS ===\n' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[data-cart-list] .cart-item, [data-cart-list] > *')].map((it) => ({
    tag: it.tagName, cls: it.className,
    data: Object.entries(it.dataset || {}).map(([k, v]) => `${k}=${v}`),
    text: (it.innerText || '').replace(/\s+/g, ' ').slice(0, 160),
  }))), null, 1));

  say('\n=== VISTA CART COMPLETA (innerText) ===\n' + await page.evaluate(() => document.querySelector('[data-view="cart"]')?.innerText));

  say('\n=== DATA ATTRS EN VISTA CART ===\n' + JSON.stringify(await page.evaluate(() => {
    const root = document.querySelector('[data-view="cart"]');
    const m = new Map();
    root.querySelectorAll('*').forEach((x) => { for (const k of Object.keys(x.dataset || {})) m.set(k, (m.get(k) || 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  })));

  // ---------- PASO 5: CHECKOUT ----------
  say('\n########## PASO 5 — CHECKOUT ##########');
  say('=== [data-checkout-phase] ===', await page.evaluate(() => document.querySelector('[data-checkout-phase]')?.getAttribute('data-checkout-phase')));
  say('=== [data-order-summary] ===\n' + await page.evaluate(() => document.querySelector('[data-order-summary]')?.outerHTML || 'NO EXISTE'));

  say('\n=== FORMA DE PAGO ===\n' + await page.evaluate(() => {
    const sel = document.querySelector('select[name="paymentMethod"]');
    if (!sel) return 'NO EXISTE select[name=paymentMethod]';
    return JSON.stringify({
      outer: sel.outerHTML,
      visible: !!(sel.offsetParent || sel.getClientRects().length),
      value: sel.value,
      options: [...sel.options].map((o) => ({ value: o.value, text: o.textContent.trim(), disabled: o.disabled, selected: o.selected })),
      wrapper: sel.closest('label, .field, [data-payment], fieldset')?.outerHTML?.slice(0, 600),
    }, null, 1);
  }));

  say('\n=== MODO DE ENTREGA (deliveryMode / fulfillment) ===\n' + await page.evaluate(() => JSON.stringify({
    radios: [...document.querySelectorAll('input[name="deliveryMode"]')].map((r) => ({ value: r.value, checked: r.checked, visible: !!(r.offsetParent || r.getClientRects().length), label: r.closest('label')?.innerText?.replace(/\s+/g, ' ').trim() })),
    fulfillment: [...document.querySelectorAll('[data-fulfillment-option]')].map((f) => ({ v: f.getAttribute('data-fulfillment-option'), text: f.innerText?.replace(/\s+/g, ' ').trim().slice(0, 80), cls: f.className })),
  }, null, 1)));

  say('\n=== BLOQUES PERFIL / DIRECCION ===\n' + await page.evaluate(() => JSON.stringify({
    profileCheckout: document.querySelector('[data-profile-checkout]')?.outerHTML?.slice(0, 3000),
    profileBlocks: [...document.querySelectorAll('[data-profile-block]')].map((b) => ({ v: b.getAttribute('data-profile-block'), text: b.innerText?.replace(/\s+/g, ' ').slice(0, 200) })),
    profileCheckoutActions: [...document.querySelectorAll('[data-profile-checkout-action]')].map((b) => ({ v: b.getAttribute('data-profile-checkout-action'), text: b.innerText?.trim(), outer: b.outerHTML })),
    customerAddresses: document.querySelector('[data-customer-addresses]')?.outerHTML?.slice(0, 1500),
    addressField: [...document.querySelectorAll('[data-address-field]')].map((f) => f.getAttribute('data-address-field')),
  }, null, 1)));

  // ---------- PASO 6: EL GATE ----------
  say('\n########## PASO 6 — EL GATE ##########');
  say('=== [data-checkout-submit] ===\n' + await page.evaluate(() => {
    const b = document.querySelector('[data-checkout-submit]');
    return b ? JSON.stringify({ outer: b.outerHTML, text: b.innerText.trim(), disabled: b.disabled, ariaDisabled: b.getAttribute('aria-disabled'), visible: !!(b.offsetParent || b.getClientRects().length), type: b.type, form: b.form?.getAttribute('data-checkout-form') ?? '(sin form)' }, null, 1) : 'NO EXISTE';
  }));
  say('\n=== [data-checkout-warning] ===\n' + await page.evaluate(() => document.querySelector('[data-checkout-warning]')?.outerHTML || 'NO EXISTE'));
  say('\n=== [data-cart-notice] ===\n' + await page.evaluate(() => document.querySelector('[data-cart-notice]')?.outerHTML || 'NO EXISTE'));
  say('\n=== [data-checkout-mode-note] ===\n' + await page.evaluate(() => document.querySelector('[data-checkout-mode-note]')?.outerHTML || 'NO EXISTE'));
  say('\n=== confirmacion de edad ===\n' + await page.evaluate(() => document.querySelector('[data-age-confirmation]')?.outerHTML?.slice(0, 1200) || 'NO EXISTE'));

  say('\n=== TODOS LOS BOTONES VISIBLES EN CART ===\n' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[data-view="cart"] button, [data-view="cart"] a')]
    .filter((b) => b.offsetParent || b.getClientRects().length)
    .map((b) => ({ text: (b.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60), cls: typeof b.className === 'string' ? b.className.slice(0, 60) : '', data: Object.entries(b.dataset || {}).map(([k, v]) => `${k}=${v}`), disabled: b.disabled }))), null, 1));

  await page.screenshot({ path: `${OUT}/05-checkout-gate.png`, fullPage: true });

  // scroll al fondo del carrito para captura del boton final
  await page.evaluate(() => document.querySelector('[data-checkout-submit]')?.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/06-boton-confirmar.png` });

  // ---------- PASO 7: TRACKING SIN PEDIDO ----------
  say('\n########## PASO 7 — SEGUIR (sin pedido) ##########');
  await page.locator('[data-nav-view="tracking"]:visible').first().click();
  await page.waitForTimeout(3000);
  say('view activa:', await page.evaluate(() => document.querySelector('.app-view.is-active')?.getAttribute('data-view')));
  say('=== innerText tracking ===\n' + await page.evaluate(() => document.querySelector('[data-view="tracking"]')?.innerText));
  say('\n=== [data-tracking-idle-card] ===\n' + await page.evaluate(() => document.querySelector('[data-tracking-idle-card]')?.outerHTML?.slice(0, 2000) || 'NO EXISTE'));
  say('\n=== [data-tracking-panel] (recorte) ===\n' + await page.evaluate(() => document.querySelector('[data-tracking-panel]')?.outerHTML?.slice(0, 2500) || 'NO EXISTE'));
  say('\n=== [data-tracking-status] ===\n' + await page.evaluate(() => document.querySelector('[data-tracking-status]')?.outerHTML?.slice(0, 1200) || 'NO EXISTE'));
  say('\n=== DATA ATTRS EN TRACKING ===\n' + JSON.stringify(await page.evaluate(() => {
    const root = document.querySelector('[data-view="tracking"]');
    const m = new Map();
    root.querySelectorAll('*').forEach((x) => { for (const k of Object.keys(x.dataset || {})) m.set(k, (m.get(k) || 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  })));
  await page.screenshot({ path: `${OUT}/07-seguir-sin-pedido.png`, fullPage: true });

  // ---------- PERFIL ----------
  say('\n########## PERFIL (anonimo) ##########');
  await page.locator('[data-nav-view="profile"]:visible').first().click();
  await page.waitForTimeout(2500);
  say('=== innerText perfil (recorte) ===\n' + (await page.evaluate(() => document.querySelector('[data-view="profile"]')?.innerText))?.slice(0, 2500));
  say('\n=== [data-customer-profile-state] ===', await page.evaluate(() => document.querySelector('[data-customer-profile-state]')?.getAttribute('data-customer-profile-state')));
  await page.screenshot({ path: `${OUT}/08-perfil-anonimo.png`, fullPage: true });
} catch (err) {
  say('\n!!! ERROR:', err.message);
} finally {
  dump();
  await browser.close();
}
