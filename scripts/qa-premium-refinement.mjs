import { chromium, webkit, devices, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { openRuntimeCatalog, clickCatalogCategory, GRID } from '../tests/e2e/catalog-runtime-fixture.mjs';

const phase = process.argv[2] || 'before';
const baseURL = process.env.TABA_PREMIUM_BASE || `http://127.0.0.1:${phase === 'before' ? 18240 : 18241}`;
const root = path.resolve('artifacts/frontend-premium-20261007');
const live = JSON.parse(fs.readFileSync('tests/fixtures/catalog-live.json', 'utf8'));
const viewports = [[390,844], [430,932], [1366,768], [1440,900], [1536,864], [1920,1080], [2560,1440]];
fs.mkdirSync(path.join(root, phase), { recursive: true });
const reports = [];
const captureOnly = process.env.TABA_PREMIUM_CAPTURE_ONLY === '1';
const previous = captureOnly && fs.existsSync(path.join(root, phase, 'metrics.json'))
  ? JSON.parse(fs.readFileSync(path.join(root, phase, 'metrics.json'), 'utf8')) : [];

for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]) {
  console.log(`Launching ${engine}`);
  const browser = await type.launch();
  try {
    for (const [width, height] of viewports) {
      const mobile = width < 600;
      const context = await browser.newContext({
        ...(mobile ? devices[engine === 'webkit' ? 'iPhone 13' : 'Pixel 7'] : {}),
        viewport: { width, height }, deviceScaleFactor: 1, baseURL, serviceWorkers: 'block',
      });
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      page.setDefaultNavigationTimeout(20000);
      console.log(`Opening ${engine} ${width}x${height}`);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        window.__premiumMetrics = { shifts: 0, longTasks: [] };
        try { new PerformanceObserver(list => list.getEntries().forEach(entry => {
          if (!entry.hadRecentInput) window.__premiumMetrics.shifts += entry.value;
        })).observe({ type: 'layout-shift', buffered: true }); } catch {}
        try { new PerformanceObserver(list => list.getEntries().forEach(entry => {
          window.__premiumMetrics.longTasks.push(entry.duration);
        })).observe({ type: 'longtask', buffered: true }); } catch {}
      });
      const started = Date.now();
      await openRuntimeCatalog(page, { catalogRows: live.products, waitForCatalog: false, view: 'home' });
      console.log('Home ready');
      await expect(page.locator('[data-view="home"] .home-best-card').first()).toBeVisible();
      const directory = path.join(root, phase, engine);
      fs.mkdirSync(directory, { recursive: true });
      const capture = async (name) => {
        await page.evaluate(() => Promise.race([Promise.all([...document.images].filter(i => {const r=i.getBoundingClientRect(); return r.width>0 && r.top<innerHeight && r.bottom>0;}).map(i => i.decode().catch(() => {}))), new Promise(r=>setTimeout(r,1500))]));
        await page.waitForTimeout(400);
        // Campaigns enter when visible. Freeze only their finite scene motions
        // so the comparison uses the same complete composition in both trees.
        await page.locator('[data-campaign]').evaluateAll(roots => {
          for (const root of roots) for (const a of root.getAnimations({subtree:true})) {
            if (a.effect?.getTiming().iterations !== Infinity) { try { a.finish(); } catch {} }
          }
        });
        await page.screenshot({ path: path.join(directory, `${width}x${height}-${name}.png`), type: 'png' });
      };
      await capture('home');
      await page.locator('[data-nav-view="catalog"]:visible').first().click();
      await expect(page.locator(`${GRID} .product-card`).first()).toBeVisible();
      await capture('todas');
      const geometry = await page.locator(GRID).evaluate(grid => {
        const card = grid.querySelector('.product-card');
        return { gridWidth: grid.getBoundingClientRect().width,
          columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
          cardWidth: card.getBoundingClientRect().width, cardHeight: card.getBoundingClientRect().height,
          overflow: document.documentElement.scrollWidth > innerWidth };
      });
      const performance = captureOnly ? previous.find(r=>r.engine===engine && r.width===width)?.performance
        : await page.evaluate(async () => {
        const metrics = window.__premiumMetrics;
        metrics.shifts = 0;
        metrics.longTasks = [];
        const frames = [];
        let last;
        await new Promise(resolve => {
          const start = performance.now();
          function tick(now) {
            if (last) frames.push(now-last);
            last = now;
            const elapsed = now-start;
            scrollTo(0, Math.sin(elapsed/1400*Math.PI)**2 * Math.min(1600, document.documentElement.scrollHeight-innerHeight));
            if (elapsed < 1400) requestAnimationFrame(tick); else resolve();
          }
          requestAnimationFrame(tick);
        });
        scrollTo(0,0);
        frames.sort((a,b)=>a-b);
        return { p95FrameMs: frames[Math.floor(frames.length*.95)], maxFrameMs: frames.at(-1),
          frames: frames.length, framesOver50: frames.filter(n=>n>50).length,
          cls: metrics.shifts, longTasks: metrics.longTasks };
      });
      for (const [id, name] of [['gaseosas','gaseosas'], ['energizantes','energizantes'], ['cervezas','cervezas'], ['isotonicas','isotonicas']]) {
        await clickCatalogCategory(page, id);
        await capture(name);
      }
      await clickCatalogCategory(page, 'energizantes');
      await page.locator(`${GRID} [data-add-product]:not(:disabled)`).first().click();
      await page.locator('[data-nav-view="cart"]:visible').first().click();
      await expect(page.locator('[data-view="cart"]:visible')).toBeVisible();
      await capture('carrito');
      reports.push({ engine, width, height, source: live.source, geometry, performance, errors, elapsedMs: Date.now()-started });
      fs.writeFileSync(path.join(root, phase, 'metrics.json'), JSON.stringify(reports, null, 2));
      console.log(`${phase} ${engine} ${width}x${height}: ${geometry.columns} columns, ${Math.round(geometry.cardWidth)}px card; p95 ${performance.p95FrameMs?.toFixed(1)}ms`);
      await context.close();
    }
  } finally { await browser.close(); }
}
