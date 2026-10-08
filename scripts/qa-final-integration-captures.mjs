import { chromium, webkit, devices, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { openRuntimeCatalog, clickCatalogCategory, GRID } from '../tests/e2e/catalog-runtime-fixture.mjs';
import { openPremiumTracking, changeTracking, TRACKING_MAP } from '../tests/e2e/tracking-premium-fixture.mjs';
import { seedCartAboveMinimum } from '../tests/e2e/helpers.mjs';

const phase = process.argv[2] || 'final';
const baseURL = process.env.TABA_FINAL_BASE_URL || `http://127.0.0.1:${phase === 'before' ? 18266 : 18265}`;
const root = path.resolve('artifacts/la-taba-final-integration-20261007');
const live = JSON.parse(fs.readFileSync('tests/fixtures/catalog-live.json', 'utf8'));
const sizes = phase === 'before' ? [[390,844],[1440,900]] : [[390,844],[430,932],[1366,768],[1440,900],[1920,1080]];
const records = [];
fs.mkdirSync(path.join(root, phase), { recursive: true });
const saveManifest = () => fs.writeFileSync(path.join(root, phase, 'manifest.json'), JSON.stringify(records, null, 2));
async function capture(page, engine, viewport, scene, errors) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => Promise.race([Promise.all([...document.images].filter(i=>{const r=i.getBoundingClientRect();return r.width>0&&r.top<innerHeight&&r.bottom>0;}).map(i=>i.decode().catch(()=>{}))),new Promise(r=>setTimeout(r,1500))]));
  await page.waitForTimeout(350);
  const file = `${engine}/${viewport.width}x${viewport.height}-${scene}.webp`;
  fs.mkdirSync(path.join(root, phase, engine), { recursive: true });
  await sharp(await page.screenshot()).webp({ quality: 88 }).toFile(path.join(root, phase, file));
  const metrics = await page.evaluate(() => {
    const marker=document.querySelector('[data-tracking-panel] .lt-rider-marker');
    const grid=document.querySelector('[data-view="catalog"] [data-product-grid]');
    const box=n=>{const r=n.getBoundingClientRect();return {width:r.width,height:r.height};};
    return {overflow:document.documentElement.scrollWidth>innerWidth,
      marker:marker?box(marker):null,helmetMarkers:document.querySelectorAll('[data-map-rider-helmet]').length,
      motorcycleMarkers:document.querySelectorAll('[data-map-rider-scooter]').length,
      columns:grid?getComputedStyle(grid).gridTemplateColumns.split(' ').length:null,
      gridWidth:grid?grid.getBoundingClientRect().width:null,
      ambient:document.querySelector('.app-shell')?getComputedStyle(document.querySelector('.app-shell')).backgroundImage:null,
      glass:window.TABA2_MOTION?.getDiagnostics?.().categoryGlass??null};
  });
  records.push({phase,engine,viewport,scene,file,bytes:fs.statSync(path.join(root,phase,file)).size,errors:[...errors],...metrics});
  saveManifest();
  expect(metrics.overflow,`${engine} ${viewport.width} ${scene} overflow`).toBe(false);
  expect(errors,`${engine} ${viewport.width} ${scene} JS errors`).toEqual([]);
  if(phase==='final'&&scene==='on-the-way') {
    expect(metrics.marker).toMatchObject({width:50,height:50});
    expect(metrics.helmetMarkers).toBe(1);expect(metrics.motorcycleMarkers).toBe(0);
  }
  console.log(`${phase} ${engine} ${viewport.width} ${scene}`);
}
for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]) {
  const browser=await type.launch();
  try {
    for(const [width,height] of sizes) {
      const viewport={width,height};
      const options={...(width<600?devices[engine==='webkit'?'iPhone 13':'Pixel 7']:{}),viewport,deviceScaleFactor:1,baseURL,serviceWorkers:'block'};
      let context=await browser.newContext(options),page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await openRuntimeCatalog(page,{catalogRows:live.products,waitForCatalog:false,view:'home'});
      await expect(page.locator('[data-view="home"] .home-best-card').first()).toBeVisible();
      await capture(page,engine,viewport,'home',errors);
      await page.locator('[data-nav-view="catalog"]:visible').first().click();
      await expect(page.locator(`${GRID} .product-card`).first()).toBeVisible();
      await capture(page,engine,viewport,'catalog',errors);
      await clickCatalogCategory(page,'gaseosas');
      await capture(page,engine,viewport,'categories',errors);
      await seedCartAboveMinimum(page);
      await page.locator('[data-nav-view="cart"]:visible').first().click();
      await page.evaluate(()=>scrollTo(0,0));
      await capture(page,engine,viewport,'cart',errors);
      await page.locator('.checkout-form').scrollIntoViewIfNeeded();
      await capture(page,engine,viewport,'checkout',errors);
      await context.close();
      context=await browser.newContext(options);page=await context.newPage();errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await openPremiumTracking(page,{status:phase==='before'?'on_the_way':'received',accuracy:12,capturePixels:true});
      const states=phase==='before'?[['on_the_way','on-the-way']]:[['received','confirmed'],['preparing','preparing'],['assigned','assigned'],['on_the_way','on-the-way'],['delivered','delivered']];
      for(const [status,scene] of states) {
        if(scene!=='confirmed'&&!(phase==='before'))await changeTracking(page,{status});
        await page.waitForFunction(()=>{const map=window.__qaMaps?.at(-1);return map&&!map.isMoving()&&map.areTilesLoaded();},null,{timeout:20000});
        await page.evaluate(()=>scrollTo(0,0));
        await capture(page,engine,viewport,scene,errors);
      }
      await context.close();
    }
  } finally { await browser.close(); }
}
console.log(`${records.length} native screenshots; ${records.reduce((n,r)=>n+r.bytes,0)} bytes`);
