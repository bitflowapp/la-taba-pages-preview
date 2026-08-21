/*
 * Lectura de la config comercial que el cliente ya tiene en memoria:
 * fee de envío, mínimo, retiro habilitado. Solo getState()/módulos, sin tocar UI.
 */
import { chromium } from 'playwright';

const HOST = 'https://la-taba.pages.dev';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(`${HOST}/#home`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(async () => {
  const { getState } = await import('/js/state.js');
  return getState().products.length > 0;
}, null, { timeout: 30000 });
await page.waitForTimeout(2000);

const config = await page.evaluate(async () => {
  const { getState } = await import('/js/state.js');
  const c = getState().config || {};
  const keys = Object.keys(c);
  const pick = {};
  for (const k of keys) {
    if (/fee|minimum|minimo|pickup|delivery|zone|envio|shipping|schedule|horario|order/i.test(k)) {
      const v = c[k];
      pick[k] = (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
    }
  }
  let cartInfo = null;
  try {
    const cart = await import('/js/cart.js');
    cartInfo = {
      feeDelivery: cart.getDeliveryFee ? cart.getDeliveryFee('delivery') : null,
      feePickup: cart.getDeliveryFee ? cart.getDeliveryFee('pickup') : null,
      minimoProgress: cart.getDeliveryMinimumProgress ? cart.getDeliveryMinimumProgress(0) : null,
    };
  } catch (e) { cartInfo = { error: String(e.message) }; }
  return { keys, pick, cartInfo };
});
console.log(JSON.stringify(config, null, 2));
await browser.close();
