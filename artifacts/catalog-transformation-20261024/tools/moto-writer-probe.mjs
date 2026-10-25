// ¿Quién reescribe el estado después de ?reset=1? Engancha setItem/removeItem con la pila.
import { connect, sleep, BASE } from './moto.mjs';
const { browser, page } = await connect();
await page.addInitScript(() => {
  const KEY = 'la_taba_mvp_v4_state';
  const log = (op, value, stack) => {
    let q = null; try { q = JSON.parse(value || '{}').searchQuery; } catch (_) {}
    const prev = JSON.parse(sessionStorage.getItem('__w') || '[]');
    prev.push({ t: Math.round(performance.now()), op, q, stack: stack.split('\n').slice(2, 5).map((l) => l.trim().slice(0, 110)) });
    sessionStorage.setItem('__w', JSON.stringify(prev.slice(-14)));
  };
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { if (k === KEY) log('set', v, new Error().stack); return set.apply(this, arguments); };
  const rem = Storage.prototype.removeItem;
  Storage.prototype.removeItem = function (k) { if (k === KEY) log('remove', '', new Error().stack); return rem.apply(this, arguments); };
});
await page.goto(`${BASE}/?reset=1&demo=1&vitrina=neuquen20261024`, { waitUntil: 'load' });
await sleep(7000);
console.log(await page.evaluate(() => sessionStorage.getItem('__w')));
await browser.close();
