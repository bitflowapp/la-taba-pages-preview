import { chromium } from '@playwright/test';
const b = await chromium.launch();
const c = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true,
 userAgent:'Mozilla/5.0 (Linux; Android 14; moto g15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'});
const p = await c.newPage();
const payloads=[];
p.on('response', async res=>{ const u=res.url();
  if(/rest\/v1\/|catalog|products/i.test(u) && res.request().method()!=='OPTIONS'){
    try{ const j=await res.json(); payloads.push({u:u.slice(0,140), n:Array.isArray(j)?j.length:'obj'}); if(Array.isArray(j)&&j.length&&j[0]&&(j[0].sku||j[0].name)) globalThis.__cat=j; }catch{}
  }});
await p.goto('https://la-taba.pages.dev', {waitUntil:'networkidle', timeout:90000});
await p.waitForTimeout(6000);
console.log('RESPUESTAS:', JSON.stringify(payloads,null,1));
const cat = globalThis.__cat||[];
console.log('FILAS CATALOGO:', cat.length);
if(cat.length){
  console.log('CLAVES:', Object.keys(cat[0]).join(','));
  const rows = cat.map(r=>({ sku:r.sku, brand:r.brand, name:r.name, variant:r.variant, cat:r.category_id||r.categoryId,
    price:r.price, stock:r.stock, avail:r.available, sort:r.sort_order??r.sortOrder, tags:(r.tags||[]).join('|'),
    img: (r.image_thumbnail||r.imageThumbnail||r.image||'')?'SI':'NO' }));
  const rec = rows.filter(r=>/recomendado-/.test(r.tags)).sort((a,b)=>Number(/recomendado-(\d+)/.exec(a.tags)[1])-Number(/recomendado-(\d+)/.exec(b.tags)[1]));
  console.log('\n== RECOMENDADOS (por tag) ==');
  rec.forEach(r=>console.log(/recomendado-(\d+)/.exec(r.tags)[1], '|', r.brand, r.name, '|', r.variant, '| $', r.price, '| stock', r.stock, '| img', r.img, '| sort', r.sort, '|', r.cat));
  console.log('\n== POPULAR heredado ==', rows.filter(r=>/popular|mas vendido|más vendido/i.test(r.tags)).length);
  console.log('\n== TODAS LAS FILAS ==');
  rows.forEach(r=>console.log([r.cat,r.brand,r.name,r.variant,'$'+r.price,'stk'+r.stock,'av:'+r.avail,'so:'+r.sort,'img:'+r.img,r.tags].join(' | ')));
  const conImg = rows.filter(r=>r.img==='SI').length;
  console.log('\nCON IMAGEN:', conImg, '/', rows.length);
}
await b.close();
