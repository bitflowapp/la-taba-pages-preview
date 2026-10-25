import { connect, sleep, BASE } from './moto.mjs';
const { browser, page } = await connect();
const peek = () => page.evaluate(() => {
  const st = JSON.parse(localStorage.getItem('la_taba_mvp_v4_state') || '{}');
  return { url: location.search, searchQuery: st.searchQuery, activeCategory: st.activeCategory, input: document.querySelector('[data-view=catalog] input[type=search]')?.value, cartItems: (st.cart||[]).length };
});
console.log('antes   ', JSON.stringify(await peek()));
await page.goto(`${BASE}/?reset=1&demo=1&vitrina=neuquen20261024`, { waitUntil: 'load' });
for (let i = 0; i < 6; i += 1) { await sleep(1000); console.log(`t+${i + 1}s `, JSON.stringify(await peek().catch((e) => String(e)))); }
await browser.close();
