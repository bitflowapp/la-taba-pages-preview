import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { GRID, openRuntimeCatalog, clickCatalogCategory } from './catalog-runtime-fixture.mjs';
const live = JSON.parse(fs.readFileSync(new URL('../fixtures/catalog-live.json', import.meta.url), 'utf8'));
const RAIL = '[data-view="catalog"] [data-category-strip]';
const pills = page => page.locator(`${RAIL} [data-category-id]`);
const boot = page => openRuntimeCatalog(page, { catalogRows: live.products, waitForCatalog: false });
const rest = page => expect.poll(() => page.evaluate(() => window.TABA2_MOTION.getDiagnostics().categoryGlass.animating)).toBe(false);

test('mouse: slow/fast drag, release between pills and reverse never activate a category', async ({page,isMobile,browserName}) => {
  test.skip(isMobile && browserName==='webkit','Mobile WebKit mouse emulation throttles rAF; native touch taps are covered below and mouse dragging is covered in desktop WebKit.');
  await boot(page);
  await page.setViewportSize({width:390,height:844});
  const box = await page.locator(RAIL).boundingBox();
  const title = await page.locator('[data-catalog-title]').textContent();
  const x = box.x + box.width - 35;
  const y = box.y + box.height / 2;
  for (const steps of [24, 3, 14]) {
    await page.mouse.move(x,y);
    await page.mouse.down();
    await page.mouse.move(box.x+25,y,{steps});
    // WebKit paints this rAF-driven effect asynchronously. Read scale and
    // budget fallback together; a fixed delay plus separate reads can observe
    // an unpainted frame or two different animation states.
    let dragState;
    await expect.poll(async () => {
      dragState = await pills(page).evaluateAll(nodes => ({
        scale: Math.max(...nodes.map(n => new DOMMatrix(getComputedStyle(n).transform).a)),
        budgetSuppressed: window.TABA2_MOTION.getDiagnostics().categoryGlass.frameBudgetSuppressed,
      }));
      return dragState.budgetSuppressed || dragState.scale > 1.002;
    }).toBe(true);
    if (!dragState.budgetSuppressed) expect(dragState.scale).toBeGreaterThan(1.002);
    expect(dragState.scale).toBeLessThanOrEqual(1.051);
    await page.mouse.up();
    await rest(page);
    await expect(page.locator('[data-catalog-title]')).toHaveText(title);
    await expect(page.locator(RAIL)).not.toHaveAttribute('data-glass-dragging','true');
    await page.mouse.move(box.x+35,y);
    await page.mouse.down();
    await page.mouse.move(x,y,{steps:8});
    await page.mouse.up();
    await rest(page);
  }
  await expect(pills(page).first()).toHaveAttribute('aria-pressed','true');
  await pills(page).first().click();
  await expect(page.locator('[data-catalog-title]')).toHaveText('Todas');
});

test('native horizontal wheel works; vertical wheel beginning on pills scrolls the page', async ({page,isMobile,browserName}) => {
  test.skip(isMobile && browserName==='webkit','Playwright does not support mouse.wheel in mobile WebKit; desktop WebKit exercises native wheel.');
  await boot(page);
  await page.setViewportSize({width:390,height:844});
  const rail = page.locator(RAIL);
  const box = await rail.boundingBox();
  await page.mouse.move(box.x+box.width*.6, box.y+box.height*.5);
  await page.mouse.wheel(290,0);
  await expect.poll(() => rail.evaluate(n=>n.scrollLeft)).toBeGreaterThan(100);
  await page.mouse.wheel(-190,0);
  await page.waitForTimeout(350);
  await page.mouse.wheel(0,260);
  await expect.poll(() => page.evaluate(()=>scrollY)).toBeGreaterThan(80);
  await expect(page.locator('body')).not.toHaveClass(/modal-open/);
  await rest(page);
});

test('keyboard covers both extremes, preserves vertical position and selects immediately', async ({page}) => {
  await boot(page);
  await page.setViewportSize({width:430,height:932});
  const rail = page.locator(RAIL);
  await pills(page).first().focus();
  await page.keyboard.press('End');
  await expect(pills(page).last()).toBeFocused();
  await expect.poll(()=>rail.evaluate(n=>n.scrollLeft)).toBeGreaterThan(100);
  const vertical = await page.evaluate(()=>scrollY);
  await page.keyboard.press('Home');
  await expect(pills(page).first()).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(pills(page).nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-catalog-title]')).toHaveText('Favoritos');
  expect(await page.evaluate(()=>scrollY)).toBe(vertical);
});

test('selection and repeated taps retain pill geometry, nodes and selected state without flicker', async ({page}) => {
  await boot(page);
  await page.evaluate(selector => {
    const rail=document.querySelector(selector);
    window.__pillRefs=[...rail.children];
    window.__pillBoxes=window.__pillRefs.map(n=>({left:n.offsetLeft,width:n.offsetWidth,height:n.offsetHeight}));
    window.__pillMutations={removed:0,hidden:0};
    new MutationObserver(records=>records.forEach(r=>{
      window.__pillMutations.removed+=r.removedNodes.length;
      if(r.type==='attributes' && r.target.classList?.contains('category-button') && getComputedStyle(r.target).opacity==='0') window.__pillMutations.hidden++;
    })).observe(rail,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  }, RAIL);
  for(const id of ['gaseosas','energizantes','isotonicas','all','energizantes','gaseosas','all']) {
    await clickCatalogCategory(page,id);
    await expect(page.locator(`${RAIL} [data-category-id="${id}"]`)).toHaveAttribute('aria-pressed','true');
  }
  await rest(page);
  const report=await page.evaluate(()=>({
    sameNodes:window.__pillRefs.every(n=>n.isConnected),
    sameBoxes:window.__pillRefs.every((n,i)=>n.offsetLeft===window.__pillBoxes[i].left && n.offsetWidth===window.__pillBoxes[i].width && n.offsetHeight===window.__pillBoxes[i].height),
    ...window.__pillMutations,
    overflow:document.documentElement.scrollWidth>innerWidth,
  }));
  expect(report).toEqual({sameNodes:true,sameBoxes:true,removed:0,hidden:0,overflow:false});
  for(const width of [430,844,390,1440,1920,390]) {
    await page.setViewportSize({width,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  }
});

test('reduced motion can change live: no magnetic transforms, spring or idle animation', async ({page}) => {
  await boot(page);
  await page.setViewportSize({width:390,height:844});
  await page.locator(RAIL).evaluate(n=>n.scrollLeft=190);
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect.poll(()=>page.evaluate(()=>window.TABA2_MOTION.getDiagnostics().categoryGlass.reduced)).toBe(true);
  await clickCatalogCategory(page,'energizantes');
  await page.locator(`${GRID} [data-add-product]:not(:disabled)`).first().click();
  await expect.poll(()=>pills(page).evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).transform==='none'))).toBe(true);
  const report=await page.evaluate(()=>({
    animating:window.TABA2_MOTION.getDiagnostics().categoryGlass.animating,
    reduced:window.TABA2_MOTION.getDiagnostics().reducedMotion,
    infinite:document.getAnimations().filter(a=>a.playState==='running' && a.effect?.getTiming().iterations===Infinity).length,
  }));
  expect(report).toEqual({animating:false,reduced:true,infinite:0});
});

test('native touch pan: horizontal motion has no ghost click, vertical pan has no lock', async ({page,browserName,isMobile}) => {
  test.skip(!isMobile || browserName!=='chromium','Native touch injection uses the Chromium protocol; WebKit touch taps are tested separately.');
  await boot(page);
  const box=await page.locator(RAIL).boundingBox();
  const cdp=await page.context().newCDPSession(page);
  const gesture=async (from,to,steps=12)=>{
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:from.x,y:from.y}]});
    for(let i=1;i<=steps;i++) {
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*i/steps,y:from.y+(to.y-from.y)*i/steps}]});
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  };
  const from={x:box.x+box.width-30,y:box.y+box.height/2};
  await gesture(from,{x:box.x+30,y:from.y});
  await expect.poll(()=>page.locator(RAIL).evaluate(n=>n.scrollLeft)).toBeGreaterThan(90);
  await expect(page.locator('[data-catalog-title]')).toHaveText('Todas');
  await rest(page);
  await gesture({x:box.x+100,y:from.y},{x:box.x+100,y:Math.max(2,from.y-150)});
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(60);
  await expect(page.locator('[data-catalog-title]')).toHaveText('Todas');
  await cdp.detach();
});

test('touch taps, cart feedback, sorting, favorite and account remain operable', async ({page,isMobile}) => {
  await boot(page);
  await clickCatalogCategory(page,'energizantes');
  const action=page.locator(`${GRID} [data-add-product]:not(:disabled)`).first();
  if(isMobile) await action.tap(); else await action.click();
  await expect(page.locator('[data-cart-count]').first()).toHaveText('1');
  const favorite=page.locator(`${GRID} [data-favorite-toggle]`).first();
  if(isMobile) await favorite.tap(); else await favorite.click();
  await expect(favorite).toHaveAttribute('aria-pressed','true');
  await page.locator('[data-sort-select]').selectOption('price_asc');
  const values=await page.locator(`${GRID} .price strong`).allTextContents();
  const prices=values.map(s=>Number(s.replace(/\D/g,'')));
  expect(prices).toEqual([...prices].sort((a,b)=>a-b));
  await page.locator('[data-nav-view="cart"]:visible').first().click();
  await expect(page.locator('[data-view="cart"]:visible')).toBeVisible();
  await page.locator('[data-nav-view="profile"]:visible').first().click();
  await expect(page.locator('[data-view="profile"]:visible')).toBeVisible();
});

test('desktop column budget keeps cards readable, mobile and tablet retain their layout', async ({page}) => {
  await boot(page);
  for(const [width,columns] of [[390,2],[430,2],[768,3],[1366,4],[1440,4],[1536,5],[1920,5],[2560,5]]) {
    await page.setViewportSize({width,height:width===1366?768:width===1536?864:900});
    const report=await page.locator(GRID).evaluate(n=>({
      columns:getComputedStyle(n).gridTemplateColumns.split(' ').length,
      width:n.querySelector('.product-card').getBoundingClientRect().width,
      bottom:n.querySelector('.product-card').getBoundingClientRect().bottom,
      viewportHeight:innerHeight,
      overflow:document.documentElement.scrollWidth>innerWidth,
    }));
    expect(report.columns,`${width}px`).toBe(columns);
    if(width>=1366) expect(report.width).toBeGreaterThanOrEqual(250);
    if(width>=1366) expect(report.bottom,`first Add button below the fold at ${width}px`).toBeLessThanOrEqual(report.viewportHeight);
    expect(report.overflow).toBe(false);
  }
});
