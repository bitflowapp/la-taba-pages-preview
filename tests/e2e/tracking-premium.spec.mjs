import {test,expect} from '@playwright/test';
import {openPremiumTracking,changeTracking,touchPan,TRACKING_MAP,START} from './tracking-premium-fixture.mjs';
const camera=page=>page.evaluate(()=>{const map=window.__qaMaps.at(-1);return{center:map.getCenter().toArray(),zoom:map.getZoom(),bearing:map.getBearing()};});
const settle=async page=>{
  await expect.poll(()=>page.evaluate(()=>window.__qaMaps.at(-1)?.isMoving()),{timeout:12000}).toBe(false);
  await page.waitForTimeout(120);
};

test('rider auto focus, manual override, recenter and new fixes keep one connected map',async({page,isMobile})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await openPremiumTracking(page,{status:'preparing'});
  await page.evaluate(selector=>{
    window.__originalShell=document.querySelector(selector);window.__originalCanvas=window.__originalShell.querySelector('canvas');window.__mapRemovals=0;
    new MutationObserver(rs=>rs.forEach(r=>r.removedNodes.forEach(n=>{
      if(n===window.__originalShell||n.contains?.(window.__originalShell)||n===window.__originalCanvas||n.contains?.(window.__originalCanvas))window.__mapRemovals++;
    }))).observe(document.querySelector('[data-tracking-panel]'),{childList:true,subtree:true});
  },TRACKING_MAP);
  await changeTracking(page,{status:'on_the_way'});await settle(page);
  const map=page.locator(TRACKING_MAP);await expect(map).toHaveAttribute('data-map-camera','follow');
  const points=await page.evaluate(()=>{
    const m=window.__qaMaps.at(-1),size=m.getContainer().getBoundingClientRect();
    return [...m.getContainer().querySelectorAll('.lt-rider-marker,.is-destination')].map(n=>({r:n.getBoundingClientRect().toJSON(),size:size.toJSON()}));
  });
  expect(points.length).toBeGreaterThanOrEqual(2);
  for(const p of points){expect(p.r.left).toBeGreaterThan(p.size.left-5);expect(p.r.right).toBeLessThan(p.size.right+5);}
  const box=await map.locator('canvas').boundingBox();
  await page.mouse.move(box.x+box.width*.6,box.y+box.height*.5);await page.mouse.down();
  await page.mouse.move(box.x+box.width*.3,box.y+box.height*.5,{steps:12});await page.mouse.up();
  await expect(map).toHaveAttribute('data-map-camera','explore');await settle(page);const manual=await camera(page);
  await changeTracking(page,{lat:START.lat+.0005,lng:START.lng+.0005});await settle(page);
  expect((await camera(page)).center).toEqual(manual.center);
  const follow=page.locator('[data-map-follow-cta]');await expect(follow).toBeVisible();
  if(isMobile)await follow.tap();else await follow.click();
  await expect(map).toHaveAttribute('data-map-camera','follow');await settle(page);
  expect((await camera(page)).center).not.toEqual(manual.center);expect((await camera(page)).bearing).toBe(0);
  const result=await page.evaluate(selector=>({same:document.querySelector(selector)===window.__originalShell,
    canvas:document.querySelector(selector).querySelector('canvas')===window.__originalCanvas,removals:window.__mapRemovals}),TRACKING_MAP);
  expect(result).toEqual({same:true,canvas:true,removals:0});expect(errors).toEqual([]);
  const forever=await map.evaluate(n=>n.getAnimations({subtree:true}).filter(a=>a.playState==='running'&&a.effect?.getTiming().iterations===Infinity).length);
  expect(forever).toBe(0);
});

test('native one finger pan and vertical intent scroll the page without ghost selection',async({page,browserName,isMobile})=>{
  test.skip(browserName!=='chromium'||!isMobile,'Native touch injection available in Chromium; WebKit synthetic gestures tested separately.');
  await openPremiumTracking(page,{status:'on_the_way'});
  const map=page.locator(TRACKING_MAP),box=await map.locator('canvas').boundingBox(),before=await camera(page);
  await touchPan(page,{from:{x:box.x+box.width*.75,y:box.y+box.height*.5},to:{x:box.x+box.width*.25,y:box.y+box.height*.5}});
  await expect(map).toHaveAttribute('data-map-camera','explore');expect((await camera(page)).center).not.toEqual(before.center);await settle(page);
  const scroll=await page.evaluate(()=>scrollY);
  const available=await page.evaluate(()=>document.documentElement.scrollHeight-innerHeight-scrollY);
  await touchPan(page,{from:{x:box.x+box.width*.5,y:box.y+box.height*.75},to:{x:box.x+box.width*.5,y:box.y+box.height*.25},steps:42,delay:20});
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(scroll+Math.min(35,available*.7));
  await expect(page.locator('[data-tracking-status]')).toHaveAttribute('data-tracking-status','on_the_way');
});

test('native pinch zoom retains north up',async({page,browserName,isMobile})=>{
  test.skip(browserName!=='chromium'||!isMobile,'WebKit synthetic pinch tested separately; physical iPhone NOT_RUN.');
  await openPremiumTracking(page,{status:'on_the_way'});
  const box=await page.locator(`${TRACKING_MAP} canvas`).boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
  const before=await camera(page),cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-20,y},{x:x+20,y}]});
  for(let i=1;i<=12;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-20-i*6,y},{x:x+20+i*6,y}]});await page.waitForTimeout(20);}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
  await expect.poll(async()=>(await camera(page)).zoom).toBeGreaterThan(before.zoom+.4);expect((await camera(page)).bearing).toBe(0);
});

test('background/foreground converges to current GPS without replay',async({page})=>{
  await openPremiumTracking(page,{status:'on_the_way'});
  await page.evaluate(()=>{window.__qaHidden=true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__qaHidden});document.dispatchEvent(new Event('visibilitychange'));});
  await changeTracking(page,{lat:START.lat+.0004,lng:START.lng+.0004});
  await page.evaluate(()=>{window.__qaHidden=false;document.dispatchEvent(new Event('visibilitychange'));});
  await changeTracking(page,{lat:START.lat+.0008,lng:START.lng+.0008});await page.waitForTimeout(100);
  const result=await page.evaluate(()=>{
    const m=window.__qaMaps.at(-1),p=m.project([-68.0546,-38.9464]),marker=m.getContainer().querySelector('.lt-rider-marker').getBoundingClientRect(),rect=m.getContainer().getBoundingClientRect();
    return{dx:Math.abs(marker.x+marker.width/2-rect.x-p.x),dy:Math.abs(marker.y+marker.height/2-rect.y-p.y)};
  });
  expect(result.dx).toBeLessThan(4);expect(result.dy).toBeLessThan(4);
});

test('all states keep accessible text, reduced motion and responsive geometry',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await openPremiumTracking(page);
  for(const status of ['preparing','ready','assigned','on_the_way','delivered']){
    await changeTracking(page,{status});await expect(page.locator('[data-tracking-title]')).not.toHaveText('');
    await expect(page.locator(TRACKING_MAP)).toHaveAttribute('data-map-status','ready');
    for(const width of [390,430,844,1440]){await page.setViewportSize({width,height:width===844?390:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);}
  }
  await expect(page.locator('[data-tracking-title]')).toHaveText('¡Llegó tu pedido!');
  expect(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getTiming().iterations===Infinity).length)).toBe(0);
});

test('TouchEvent pan and pinch exercise MapLibre handlers; vertical intent stays uncancelled',async({page})=>{
  await openPremiumTracking(page,{status:'on_the_way'});
  const result=await page.evaluate(async()=>{
    const map=window.__qaMaps.at(-1),canvas=map.getCanvas(),r=canvas.getBoundingClientRect();
    const x=r.x+r.width/2,y=r.y+r.height/2;
    const touch=(id,px,py)=>({identifier:id,target:canvas,clientX:px,clientY:py,pageX:px+scrollX,pageY:py+scrollY,screenX:px,screenY:py});
    const send=(type,points)=>{const event=new Event(type,{bubbles:true,cancelable:true});Object.defineProperties(event,{touches:{value:points},targetTouches:{value:points},changedTouches:{value:points}});canvas.dispatchEvent(event);return event.defaultPrevented;};
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const initial=map.getCenter().toArray();
    send('touchstart',[touch(0,x+60,y)]);
    for(let i=1;i<=8;i++){send('touchmove',[touch(0,x+60-i*15,y)]);await wait(25);}
    send('touchend',[]);await wait(300);
    const panned=map.getCenter().toArray();
    const zoom=map.getZoom();
    send('touchstart',[touch(0,x-20,y),touch(1,x+20,y)]);
    for(let i=1;i<=10;i++){send('touchmove',[touch(0,x-20-i*5,y),touch(1,x+20+i*5,y)]);await wait(25);}
    send('touchend',[]);await wait(300);
    const afterZoom=map.getZoom();
    send('touchstart',[touch(0,x,y)]);
    const cancelled=send('touchmove',[touch(0,x,y-40)]);send('touchend',[]);
    return{initial,panned,zoom,afterZoom,cancelled,bearing:map.getBearing(),cooperative:map.cooperativeGestures?.isEnabled?.()};
  });
  expect(result.panned).not.toEqual(result.initial);expect(result.afterZoom).toBeGreaterThan(result.zoom+.4);
  expect(result.cancelled).toBe(false);expect(result.bearing).toBe(0);expect(result.cooperative).toBe(false);
});

test('location picker shares one-finger gestures and a tap selects a real point',async({page})=>{
  await openPremiumTracking(page,{status:'preparing'});
  await page.evaluate(async()=>{
    const {createLocationPickerMap}=await import('/js/map/location_picker_map.js');
    const host=document.createElement('div');host.className='location-step-map';host.dataset.locationMap='';
    Object.assign(host.style,{position:'fixed',inset:'120px 20px auto',height:'320px',zIndex:'9999'});document.body.append(host);
    window.__qaPicked=null;
    window.__qaPicker=createLocationPickerMap();
    window.__qaPicker.mount({container:host,point:{latitude:-38.9472,longitude:-68.0554},onPick:p=>window.__qaPicked=p});
  });
  await expect(page.locator('[data-location-map]')).toHaveAttribute('data-location-map-ready','true',{timeout:20000});
  const box=await page.locator('[data-location-map] canvas').boundingBox();
  await page.mouse.click(box.x+box.width*.75,box.y+box.height*.5);
  await expect.poll(()=>page.evaluate(()=>window.__qaPicked!==null)).toBe(true);
  const config=await page.evaluate(()=>({touchAction:getComputedStyle(window.__qaMaps.at(-1).getCanvas()).touchAction,
    cooperative:window.__qaMaps.at(-1).cooperativeGestures.isEnabled(),bearing:window.__qaMaps.at(-1).getBearing()}));
  expect(config).toEqual({touchAction:'pan-y',cooperative:false,bearing:0});
  await page.evaluate(()=>window.__qaPicker.destroy());
});

test('keyboard map navigation pauses follow and retains focus through a GPS render',async({page})=>{
  await openPremiumTracking(page,{status:'on_the_way'});
  const map=page.locator(TRACKING_MAP),canvas=map.locator('canvas');
  await canvas.focus();await page.keyboard.press('ArrowRight');
  await expect(map).toHaveAttribute('data-map-camera','explore');
  await changeTracking(page,{lat:START.lat+.0003,lng:START.lng+.0003});
  await expect(canvas).toBeFocused();
  await page.locator('[data-map-follow-cta]').focus();await page.keyboard.press('Enter');
  await expect(map).toHaveAttribute('data-map-camera','follow');
});

test('background resume preserves explore; rejected history and metre jitter never move the camera',async({page})=>{
  await openPremiumTracking(page,{status:'on_the_way'});
  const map=page.locator(TRACKING_MAP),box=await map.locator('canvas').boundingBox();
  await page.mouse.move(box.x+box.width*.7,box.y+box.height*.55);await page.mouse.down();
  await page.mouse.move(box.x+box.width*.4,box.y+box.height*.55,{steps:10});await page.mouse.up();await settle(page);
  const before=await camera(page);
  await page.evaluate(()=>{window.__qaHidden=true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__qaHidden});document.dispatchEvent(new Event('visibilitychange'));});
  await changeTracking(page,{lat:START.lat+.0003,lng:START.lng+.0003});
  await page.evaluate(()=>{window.__qaHidden=false;document.dispatchEvent(new Event('visibilitychange'));});
  await changeTracking(page,{lat:START.lat+.0006,lng:START.lng+.0006});await settle(page);
  await expect(map).toHaveAttribute('data-map-camera','explore');expect((await camera(page)).center).toEqual(before.center);
  await page.locator('[data-map-follow-cta]').click();await settle(page);
  const followed=await camera(page);
  await changeTracking(page,{lat:START.lat+.00061,lng:START.lng+.0006});await page.waitForTimeout(1000);
  expect((await camera(page)).center).toEqual(followed.center);
  await changeTracking(page,{lat:START.lat,lng:START.lng,age:20000});await page.waitForTimeout(500);
  expect((await camera(page)).center).toEqual(followed.center);
  await expect(map.locator('.lt-rider-marker')).toBeVisible();
  await expect(map.locator('[data-map-meta-text]')).toContainText(/hace|Última|Actualizado/);
});
