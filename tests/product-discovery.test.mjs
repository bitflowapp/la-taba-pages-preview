import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { searchProducts, buildSearchIndex } from '../js/core/catalog-search.js';
import { normalizeCampaign, campaignMarkup, selectCampaigns } from '../js/campaigns/campaign-engine.js';
import { resolveCampaignProductAsset } from '../js/campaigns/campaign-product.js';
// Datos de prueba del motor (snapshot CP), no las campañas publicadas.
import { CAMPAIGNS } from './fixtures/campaign-config-cp46.js';

const raw = JSON.parse(fs.readFileSync(new URL('./fixtures/catalog-cp-46.json', import.meta.url))).products;
const rows = raw.map(p => ({ id:p.id,sku:p.sku,name:p.name,brand:p.brand,variant:p.variant,
  capacityValue:p.capacity_value,capacityUnit:p.capacity_unit,capacity:p.capacity,packagingType:p.packaging_type,
  unitsPerPack:p.units_per_pack,categoryId:p.category.toLowerCase().replace(/ /g,'-'),categoryName:p.category,
  subcategory:p.subcategory,presentation:p.presentation }));
const lab = JSON.parse(fs.readFileSync(new URL('../scripts/campaign-lab/approved-products.json', import.meta.url)));
const beer = normalizeCampaign(CAMPAIGNS[0]);

test('real packshots are exact authorized bytes; responsive markup preserves the product', () => {
  for (const product of lab) {
    for (const [file,expected] of [[product.image,product.imageSha256],[product.imageThumbnail,product.imageThumbnailSha256]]) {
      const bytes=fs.readFileSync(new URL('..'+file,import.meta.url));
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),expected);
    }
  }
  const product=lab.find(p=>p.sku==='heineken-710ml');
  const asset=resolveCampaignProductAsset(beer,product);
  assert.equal(asset.official,true);
  const html=campaignMarkup({campaign:beer,product},'home-hero',{title:product.name});
  assert.ok(html.includes(product.imageThumbnail));
  assert.ok(html.includes(product.image));
  assert.match(html,/data-campaign-image/);
  assert.doesNotMatch(html,/cmp-vessel-art/);
});

test('wrong container, volume, brand and variant are rejected; product ID never falls through to SKU', () => {
  const product=lab.find(p=>p.sku==='heineken-710ml');
  for(const wrong of [{packageType:'Botella'},{capacityValue:473},{brand:'Otra'},{variant:'0.0'}])
    assert.equal(resolveCampaignProductAsset(beer,{...product,...wrong}),null);
  const can=normalizeCampaign({...CAMPAIGNS[1],enabled:true,target:{productId:'missing',skus:['red-bull-energy-drink-355ml']}});
  assert.equal(selectCampaigns({campaigns:[{...CAMPAIGNS[1],enabled:true,approval:{status:'APROBADA',reference:'QA'},target:{productId:can.productId,skus:can.skus}}],products:lab,isOrderable:()=>true})['home-inline'],null);
});

test('missing/unapproved photo uses the same neutral catalog fallback; cold_can rejects bottles', () => {
  const product=lab.find(p=>p.sku==='heineken-710ml');
  for(const missing of [{image:''},{imageSha256:''},{rightsStatus:'pending_review'},{imageShowsMultipack:true}]) {
    const asset=resolveCampaignProductAsset(beer,{...product,...missing});
    assert.equal(asset.official,false);
    assert.equal(asset.src,'assets/products/beverage-placeholder.svg');
  }
  assert.equal(resolveCampaignProductAsset(normalizeCampaign(CAMPAIGNS[1]),{...product,packageType:'Botella'}),null);
  const mutable={...product};
  assert.equal(resolveCampaignProductAsset(beer,mutable).official,true);
  mutable.rightsStatus='pending_review';
  assert.equal(resolveCampaignProductAsset(beer,mutable).official,false,'URL caching must never cache publication rights');
});

test('all requested queries are constrained to the real catalog, with sizes and packaging exact', () => {
  const queries=['coca','coca zero','cocazero','coca sero','coca grande','coca 2 litros','coca retornable',
    'heineken','heineken lata','cerveza lata','birra','birra lata','monster','monster mango','energizante','energetica',
    'agua','agua sin gas','agua con gas','jugo naranja','cepita','vino','vino tinto','retornable','lata','botella','710','473','2 litros','2l','2.25'];
  for(const query of queries)for(const product of searchProducts(rows,query).products)assert.ok(rows.includes(product),query);
  for(const query of ['coca zero','cocazero','coca sero'])assert.deepEqual(searchProducts(rows,query).products.map(p=>p.sku),['coca-cola-sin-azucar-2250ml-local']);
  for(const query of ['heinekenn','heineken lata'])assert.deepEqual(searchProducts(rows,query).products.map(p=>p.sku),['heineken-710ml']);
  assert.deepEqual(searchProducts(rows,'monter mango').products.map(p=>p.sku),['monster-mango-loco-473ml']);
  assert.ok(searchProducts(rows,'agua sin gas').products.every(p=>/sin gas/i.test(p.name)));
  assert.deepEqual(searchProducts(rows,'coca 2 litros').products,[]); // Only 2.25 L exists.
  assert.deepEqual(searchProducts(rows,'coca retornable').products,[]);
  assert.ok(searchProducts(rows,'710').products.every(p=>p.capacityValue===710));
  assert.deepEqual(searchProducts(rows,'vodka').products,[]);
});

test('ranking is exact name, exact brand, prefix, tokens, aliases with stable ties', () => {
  const products=[{name:'Bebida especial',brand:'Otra',searchAliases:['coca']},
    {name:'Coca especial',brand:'Otra'}, {name:'Especial',brand:'Coca'}, {name:'Coca',brand:'Otra'}];
  assert.deepEqual(searchProducts(products,'coca').products.map(p=>p.name),['Coca','Especial','Coca especial','Bebida especial']);
  const first=buildSearchIndex(rows);
  assert.equal(buildSearchIndex(rows.slice())[0],first[0]);
  const replacement={...rows[0],name:'Nuevo nombre'};
  assert.notEqual(buildSearchIndex([replacement])[0],first[0]);
  const clone={...rows[1],price:0,stock:0,pricePending:true};
  const oldEntry=buildSearchIndex([rows[1]])[0];
  const cloneEntry=buildSearchIndex([clone])[0];
  assert.equal(cloneEntry.words,oldEntry.words,'identical polling data must not rebuild normalized tokens');
  assert.equal(cloneEntry.product,clone,'results must retain CURRENT commercial fields');
});

test('warm local search performance stays below 5 ms p95 for 46 products', () => {
  buildSearchIndex(rows);
  for(const query of ['c','heine','coca zero','coca sero','birra lata']) {
    const samples=[];
    for(let i=0;i<100;i++){const start=performance.now();searchProducts(rows,query);samples.push(performance.now()-start);}
    samples.sort((a,b)=>a-b);
    assert.ok(samples[95]<5,`${query}: p95 ${samples[95]} ms`);
  }
});
