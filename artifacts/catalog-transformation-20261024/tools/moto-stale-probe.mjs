import { connect, sleep, BASE } from './moto.mjs';
const { browser, page } = await connect();
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
await page.goto(`${BASE}/?demo=1&vitrina=neuquen20261024&n=${Date.now()}`, { waitUntil: 'load' });
const peek = () => page.evaluate(async () => {
  const st = JSON.parse(localStorage.getItem('la_taba_mvp_v4_state') || '{}');
  const dbs = (await indexedDB.databases?.().catch(() => [])) || [];
  return { nav: performance.getEntriesByType('navigation')[0]?.type, q: st.searchQuery, cat: st.activeCategory, input: document.querySelector('[data-view=catalog] input[type=search]')?.value, dbs: dbs.map((d) => d.name), hash: location.hash, hist: JSON.stringify(history.state), winName: window.name };
});
for (let i = 0; i < 5; i += 1) { console.log(`t+${i}s`, JSON.stringify(await peek())); await sleep(1500); }
await browser.close();
