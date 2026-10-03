import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { openRuntimeCatalog, instrumentCatalog, readProbe, clickCatalogCategory, GRID } from './catalog-runtime-fixture.mjs';
import { useQaCampaigns } from './campaigns-fixture.mjs';

const searchSelector='[data-view="catalog"] [data-search-input]';
const initialSource=JSON.parse(fs.readFileSync(new URL('../fixtures/discovery-baseline.json',import.meta.url)));
test('filters absent, spaces preserved, deterministic typo/alias discovery and helpful empty state',async({page})=>{
  await openRuntimeCatalog(page);
  await expect(page.locator('[data-catalog-filters]')).toBeHidden();
  const search=page.locator(searchSelector);
  await expect(search).toHaveAttribute('placeholder','Buscar bebidas, marcas o tamaños');
  await search.pressSequentially('coca zero',{delay:35});
  await expect(search).toHaveValue('coca zero');
  await expect(page.locator(`${GRID} .product-card`)).toHaveCount(1);
  for(const [query,word]of [['cocazero','Sin Azúcar'],['coca sero','Sin Azúcar'],['heinekenn','Heineken'],['monter mango','Mango Loco'],['birra lata','Lata'],['energizante','473 ml'],['agua sin gas','Sin Gas']]){
    await search.fill(query);
    await expect(page.locator(GRID)).toContainText(word);
    await expect(page.locator(`${GRID} .product-card`).first()).toBeVisible();
  }
  await search.fill('bebida-no-existe-xyz');
  await expect(page.locator(`${GRID} .empty-state`)).toContainText('Revisá la búsqueda');
  await page.locator(`${GRID} [data-clear-catalog-filters]`).click();
  await expect(search).toHaveValue('');
  await expect(page.locator(`${GRID} .product-card`)).toHaveCount(46);
});

test('image, name and free card area open detail; keyboard focus returns; controls do not open it',async({page})=>{
  await openRuntimeCatalog(page);
  await page.locator(searchSelector).fill('heineken');
  const card=page.locator(`${GRID} .product-card`);
  for(const target of [card.locator('.product-media'),card.locator('.product-name-link'),card.locator('.product-body > p')]){
    await target.click();
    await expect(page.locator('[data-product-modal]')).toBeVisible();
    await page.locator('[data-product-modal] [data-close-modal]').click();
  }
  await card.locator('.product-name-link').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-product-modal]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card.locator('.product-name-link')).toBeFocused();
  await card.locator('[data-favorite-toggle]').click();
  await expect(page.locator('[data-product-modal]')).toBeHidden();
});

for(const count of [1,2,5,20])test(`${count} rapid taps preserve quantity without opening detail`,async({page})=>{
  await openRuntimeCatalog(page,{mapRow:row=>({...row,stock:100})});
  await page.locator(searchSelector).fill('monster mango');
  const card=page.locator(`${GRID} .product-card`);
  const add=card.locator('[data-add-product]');
  await add.scrollIntoViewIfNeeded();
  await add.evaluate(node=>scrollBy({top:node.getBoundingClientRect().top-innerHeight*.45,behavior:'instant'}));
  const box=await add.boundingBox();
  if (test.info().project.use.hasTouch) {
    for (let tap=0;tap<count;tap++) await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
  } else await page.mouse.click(box.x+box.width/2,box.y+box.height/2,{clickCount:count,delay:15});
  await expect(card.locator('.qty-stepper strong')).toHaveText(String(count));
  await expect(page.locator('[data-product-modal]')).toBeHidden();
  if (count === 1) await expect(card.locator('[data-added-flash]')).toBeAttached();
  await card.locator('.qty-stepper-remove').click();
  if (count === 1) await expect(card.locator('[data-add-product]')).toBeVisible();
  else await expect(card.locator('.qty-stepper strong')).toHaveText(String(count - 1));
});

test('lab uses approved real Heineken; wrong vessel rejects; reduced motion stays static',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/scripts/campaign-lab/index.html?only=beer_pour');
  const images=page.locator('[data-campaign-image]');
  await expect(images).toHaveCount(1);
  await expect(page.locator('.cmp-cta')).toContainText('Ver Heineken');
  for(const image of await images.all()) {
    await expect(image).toHaveAttribute('src',/campaign-heineken-710ml-thumbnail/);
    expect(await image.evaluate(node=>node.complete&&node.naturalWidth>0)).toBe(true);
    expect(await image.evaluate(node=>getComputedStyle(node).objectFit)).toBe('contain');
  }
  expect(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
  await page.goto('/scripts/campaign-lab/index.html?only=cold_can&vessel=bottle');
  await expect(page.locator('[data-campaign]')).toHaveCount(0);
});

test('local search script p50/p95 under 6x CPU with one, five, ten, typo and alias queries',async({page,browserName},info)=>{
  test.setTimeout(300000);
  await page.setViewportSize({width:390,height:844});
  await openRuntimeCatalog(page);
  if(browserName==='chromium'){
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:6});
  }
  // Measure the synchronous script work of the last input event. Native
  // keyboard/spacing behavior is verified separately; driver/actionability
  // delays must not contaminate this CPU metric, especially on Windows WebKit.
  const sampleQuery=async query=>{
    await page.bringToFront();
    const inject=value=>page.evaluate(text=>{
      const input=document.querySelector('[data-view="catalog"] [data-search-input]');
      const start=performance.now();input.value=text;
      input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text.slice(-1)}));
      return performance.now()-start;
    },value);
    for(let i=0;i<3;i++){await inject(query.slice(0,-1));await inject(query);}
    const times=[];
    for(let i=0;i<25;i++){await inject(query.slice(0,-1));await page.waitForTimeout(20);times.push(await inject(query));await page.waitForTimeout(20);}
    times.sort((a,b)=>a-b);
    return {p50:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)],samples:times.length};
  };
  const report={};
  for(const query of ['c','heine','heineken l','coca sero','birra lata']){
    report[query]=await sampleQuery(query);
  }
  const out='artifacts/product-discovery-real-campaigns';fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(`${out}/search-${info.project.name}.json`,JSON.stringify({method:'Synchronous last input event; 25 warm samples; 20 ms between events; IPC/paint excluded',cpu:browserName==='chromium'?6:1,report},null,2));
  // Compare the same host and CPU setting against initial HEAD, not historical hardware.
  const oldFiles=['js/app.js','js/ui.js','js/core/catalog-search.js','styles/catalog.css'];
  for(const file of oldFiles) {
    const body=gunzipSync(Buffer.from(initialSource.files[file].gzipBase64,'base64'));
    expect(createHash('sha256').update(body).digest('hex')).toBe(initialSource.files[file].sha256);
    await page.route(`**/${file}*`,route=>route.fulfill({body,contentType:file.endsWith('.css')?'text/css':'application/javascript'}));
  }
  await page.reload();
  await expect(page.locator(`${GRID} .product-card`)).toHaveCount(46);
  const baseline={};
  for(const query of Object.keys(report)){
    baseline[query]=await sampleQuery(query);
  }
  fs.writeFileSync(`${out}/search-${info.project.name}.json`,JSON.stringify({method:'Synchronous last input event; 25 warm samples; 20 ms between events; IPC/paint excluded',cpu:browserName==='chromium'?6:1,report,baseline},null,2));
  for(const query of Object.keys(report))expect(report[query].p95,`${query}: current vs same-host initial HEAD`).toBeLessThanOrEqual(Math.max(53,baseline[query].p95*1.05));
});

test('five minute discovery session preserves DOM/images and identical-data rendering',async({page},info)=>{
  test.setTimeout(420000);
  await useQaCampaigns(page);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const requests=[];page.on('request',r=>{if(r.url().includes('/storage/'))requests.push(r.url());});
  const backend=await openRuntimeCatalog(page,{mapRow:row=>({...row,stock:100})});
  await instrumentCatalog(page);
  const preview=await page.context().newPage();
  await preview.goto('/scripts/campaign-lab/index.html?only=beer_pour');
  const start=Date.now();let cycles=0,unexpectedRenderCycles=0;
  while(Date.now()-start<300000){
    await page.bringToFront();
    await page.locator(searchSelector).fill(cycles%2?'coca sero':'monster mango');
    await expect(page.locator(`${GRID} .product-card`).first()).toBeVisible();
    // Routing disables browser HTTP cache. Keep the detail asset identity
    // fixed for the no-redownload contract; alternating discovery queries
    // and category/card identity are still exercised in every cycle.
    await page.locator(searchSelector).fill('monster mango');
    await page.locator(`${GRID} .product-media`).first().click();
    await page.locator('[data-product-modal] [data-close-modal]').click();
    const card=page.locator(`${GRID} .product-card`).first();
    const add=card.locator('[data-add-product]');
    if(await add.count())await add.click();else await card.locator('.qty-stepper-action').last().click();
    await card.locator('.qty-stepper-remove').click();
    await page.locator(searchSelector).fill('');
    await clickCatalogCategory(page,['cervezas','aguas','energizantes'][cycles%3]);
    await page.evaluate(()=>scrollBy({top:600,behavior:'instant'}));
    await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
    await clickCatalogCategory(page,'all');
    await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
    await page.waitForTimeout(700);
    await page.evaluate(selector=>{
      window.__identicalWrites=0;window.__identicalObserver=new MutationObserver(records=>window.__identicalWrites+=records.length);
      window.__identicalObserver.observe(document.querySelector(selector),{childList:true,subtree:true,attributes:true,characterData:true});
    },GRID);
    backend.emit();await page.waitForTimeout(500);
    unexpectedRenderCycles+=await page.evaluate(()=>{window.__identicalObserver.disconnect();return window.__identicalWrites;});
    await preview.bringToFront();await preview.evaluate(()=>window.LAB.replay());
    await page.waitForTimeout(500);cycles++;
  }
  await page.locator(searchSelector).fill('');await clickCatalogCategory(page,'all');
  const probe=await readProbe(page);
  const redownloads=requests.length-new Set(requests).size;
  const report={durationMs:Date.now()-start,cycles,cardReplacements:probe.cardReplacements,imageReplacements:probe.imageReplacements,
    imageRedownloads:redownloads,unexpectedRenderCycles,consoleErrors:errors};
  fs.writeFileSync(`artifacts/product-discovery-real-campaigns/stress-${info.project.name}.json`,JSON.stringify(report,null,2));
  expect(report.cardReplacements).toBe(0);expect(report.imageReplacements).toBe(0);
  expect(redownloads).toBe(0);expect(unexpectedRenderCycles).toBe(0);expect(errors).toEqual([]);
  await preview.close();
});
