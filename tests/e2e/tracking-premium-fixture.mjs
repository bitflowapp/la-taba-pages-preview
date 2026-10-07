import { expect } from '@playwright/test';
import { skipInstallInvitation } from './helpers.mjs';

export const TRACKING_MAP='[data-tracking-panel] [data-real-map]';
export const START={lat:-38.9472,lng:-68.0554};
export const DESTINATION={lat:-38.9430,lng:-68.0470};

// Demo order and GPS values are QA-only, isolated in the browser. The renderer,
// MapLibre, public basemap and real tracking adapter remain the shipped app.
export async function openPremiumTracking(page,{status='received',captureMap=true,capturePixels=false}={}) {
  await skipInstallInvitation(page);
  if(captureMap) await page.addInitScript(capturePixels => {
    window.__qaMaps=[];window.__qaCameraCalls=[];
    window.addEventListener('taba:maplibre-ready',()=>{
      const OriginalMap=window.maplibregl.Map;
      window.maplibregl.Map=class extends OriginalMap {
        constructor(options){super(capturePixels?{...options,canvasContextAttributes:{...options.canvasContextAttributes,preserveDrawingBuffer:true}}:options);window.__qaMaps.push(this);}
        easeTo(options,...rest){window.__qaCameraCalls.push({type:'easeTo',at:performance.now(),options});return super.easeTo(options,...rest);}
        jumpTo(options,...rest){window.__qaCameraCalls.push({type:'jumpTo',at:performance.now(),options});return super.jumpTo(options,...rest);}
      };
    });
  },capturePixels);
  await page.goto('/?demo=1#tracking',{waitUntil:'domcontentloaded'});
  await expect(page.locator('html')).toHaveAttribute('data-taba-startup','ready',{timeout:30000});
  await page.evaluate(async ({status,start,destination})=>{
    const {getState,setState}=await import('/js/state.js');
    const state=getState();
    const now=new Date().toISOString();
    const seed=state.orders[0]||{};
    const order={...seed,id:'LT-QA-PREMIUM',status,createdAt:now,updatedAt:now,
      deliveryMode:'delivery',customerName:'Cliente QA',customerPhone:'2995550000',
      address:'Entrega QA · Neuquén',addressDetails:{street:'Roca 222',city:'Neuquén',latitude:destination.lat,longitude:destination.lng,
        locationConfirmed:true,locationSource:'map_pin',locationConfirmedAt:now},
      assignedRiderId:['assigned','ready','picked_up','on_the_way','delivered'].includes(status)?'qa-rider':null,
      delivery:{...(seed.delivery||{}),driverName:'',estimatedMinutes:0,estimatedPreparationMinutes:0},
      statusHistory:[{status:'received',at:now},{status,at:now}],
      items:[{productId:state.products[0].id,name:state.products[0].name,quantity:2,unitPrice:state.products[0].price,unit:state.products[0].unit}],
      subtotal:5600,total:5600,paymentMethod:'Efectivo',paymentMethodCode:'cash',
      tracking:{lastLocation:{...start,source:'gps',accuracy:100,quality:'valid',gpsStatus:'active',lastFixAt:now,timestamp:Date.now()},updatedAt:now},
    };
    window.__trackingQaTimestamp=Date.now();
    setState({orders:[order],lastOrderId:order.id,activeOrderId:order.id,simulation:null});
    const {renderTracking}=await import('/js/ui.js');renderTracking();
    const {renderMapViews}=await import('/js/map/map_view.js');renderMapViews();
  },{status,start:START,destination:DESTINATION});
  await expect(page.locator('[data-tracking-status]')).toHaveAttribute('data-tracking-status',status);
  await expect(page.locator(TRACKING_MAP)).toHaveAttribute('data-map-status','ready',{timeout:30000});
  await page.evaluate(()=>document.fonts.ready);
  await page.bringToFront();
  await page.waitForTimeout(500);
}

export async function changeTracking(page,{status,lat,lng,age=0}={}) {
  await page.evaluate(async update=>{
    const {updateState}=await import('/js/state.js');
    updateState(draft=>{
      const order=draft.orders[0];
      if(update.status){order.status=update.status;order.assignedRiderId=['assigned','ready','picked_up','on_the_way','delivered'].includes(update.status)?'qa-rider':null;order.statusHistory.push({status:update.status,at:new Date().toISOString()});}
      if(update.lat!=null){
        const time=update.age?Date.now()-update.age:Math.max(Date.now(),(window.__trackingQaTimestamp||0)+1800);
        window.__trackingQaTimestamp=time;
        order.tracking.lastLocation={...order.tracking.lastLocation,lat:update.lat,lng:update.lng,timestamp:time,lastFixAt:new Date(time).toISOString()};
      }
      order.updatedAt=new Date().toISOString();
    });
    const {renderTracking}=await import('/js/ui.js');renderTracking();
    const {renderMapViews}=await import('/js/map/map_view.js');renderMapViews();
  },{status,lat,lng,age});
}

export async function touchPan(page,{from,to,steps=12,delay=16}) {
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});
  for(let i=1;i<=steps;i++){
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*i/steps,y:from.y+(to.y-from.y)*i/steps}]});
    await page.waitForTimeout(delay);
  }
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await cdp.detach();
}
