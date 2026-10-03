// Local, isolated QA: every backend request uses the existing in-memory fixture.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium, webkit, devices } from '@playwright/test';
import { openRuntimeCatalog, GRID } from '../tests/e2e/catalog-runtime-fixture.mjs';

const phase = process.argv[2] || 'after';
const localImages=new Map();
for(const file of fs.readdirSync('assets/products')){
  const hash=file.match(/([a-f0-9]{64})\.webp$/)?.[1];
  if(hash)localImages.set(hash,path.resolve('assets/products',file));
}
const initial = '0b9e09ee4e8f2c157590e1ee741de5ba1b8bba6d';
const initialFiles = phase === 'before' ? [...execFileSync('git',['diff','--name-only','--diff-filter=M',initial,'--','js','styles','index.html','styles.css'],{encoding:'utf8'}).trim().split('\n'),'scripts/campaign-lab/lab.js'] : [];
const root = `artifacts/product-discovery-real-campaigns/${phase}`;
fs.mkdirSync(root, { recursive: true });
for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
  const browser = await launcher.launch();
  try {
    for (const [width, height] of [[390,844],[430,932],[360,800],[320,568],[1366,768]]) {
      const device=width<700?devices[engine==='webkit'?'iPhone 13':'Pixel 5']:{};
      const context = await browser.newContext({ ...device, screen:{width,height}, baseURL: 'http://127.0.0.1:8196', viewport: { width, height },
        serviceWorkers: 'block', reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await openRuntimeCatalog(page,{beforeGoto:async()=>{
        await page.route('**/storage/v1/object/public/catalog-images/**',route=>{
          const hash=route.request().url().match(/([a-f0-9]{64})\.webp$/)?.[1];
          const file=localImages.get(hash);
          return file?route.fulfill({path:file,contentType:'image/webp'}):route.fallback();
        });
        for(const file of initialFiles){
          const body=execFileSync('git',['show',`${initial}:${file}`]);
          const pattern=file==='index.html' ? url=>url.origin==='http://127.0.0.1:8196'&&['/','/index.html'].includes(url.pathname) : `**/${file}*`;
          await page.route(pattern,route=>route.fulfill({body,contentType:file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/javascript'}));
        }
      }});
      await page.screenshot({ path: `${root}/${engine}-${width}x${height}-catalog.png` });
      const search = page.locator('[data-view="catalog"] [data-search-input]');
      await search.fill('heineken');
      await page.screenshot({ path: `${root}/${engine}-${width}x${height}-search.png` });
      await page.locator(`${GRID} [data-product-detail]`).first().click();
      await page.screenshot({ path: `${root}/${engine}-${width}x${height}-detail.png` });
      await page.locator('[data-product-modal] [data-close-modal]').click();
      await search.fill('coca sero');
      await page.screenshot({ path: `${root}/${engine}-${width}x${height}-typo.png` });
      await page.goto('/scripts/campaign-lab/index.html?only=beer_pour&static=1&w=' + Math.min(width-32,1020));
      await page.locator('[data-campaign]').waitFor();
      await page.screenshot({ path: `${root}/${engine}-${width}x${height}-beer.png` });
      fs.writeFileSync(`${root}/${engine}-${width}x${height}.json`, JSON.stringify({ errors }, null, 2));
      console.log(`${phase}: ${engine} ${width}x${height} captured, ${errors.length} page errors`);
      await context.close();
    }
  } finally { await browser.close(); }
}
