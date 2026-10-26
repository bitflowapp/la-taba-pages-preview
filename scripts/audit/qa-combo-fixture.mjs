// Synthetic combo fixture confined to the reserved QA tenant. Never creates users or credentials.
// Retiring preserves its paid order and inventory history.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import {leerSecreto} from '../e2e-production-sale/secretos-windows.mjs';
const ref='ixewllzzuzpqrkxzmfzx', business='7d1f0c52-3b1e-4c8a-9a67-2f5d0e6b1a01';
const target=JSON.parse(fs.readFileSync('deploy/recovery-free-hosted.json','utf8'));
assert.equal(target.projectRef,ref); assert.equal(target.environment,'test'); assert.equal(target.commercialPaymentsEnabled,false);
assert.ok(['prepare','retire'].includes(process.argv[2]));
const cred=leerSecreto('RECOVERY SUPABASE SERVICE KEY'); assert.equal(cred.usuario,ref);
const db=createClient(`https://${ref}.supabase.co`,cred.secreto,{auth:{persistSession:false,autoRefreshToken:false}});
async function read(query){const {data,error}=await query; assert.ok(!error,`QA fixture ${error?.code||''}`);return data;}
const b=await read(db.from('businesses').select('qa_fixture,qa_window_until,ordering_verified_by').eq('id',business).single());
assert.equal(b.qa_fixture,true);
const productId='e5cd2610-0001-4000-8000-000000000001';
const comboId='e5cd2610-0002-4000-8000-000000000001';
const prior=await read(db.from('products').select('id,description').eq('business_id',business).eq('sku','heineken-original-lata-473ml').maybeSingle());
if(prior) assert.equal(prior.id,productId,'refuse to overwrite another fixture');
if(process.argv[2]==='prepare') {
  assert.ok(Date.parse(b.qa_window_until)>Date.now(),'exclusive QA window must be open');
  if(prior) await read(db.from('products').update({is_active:true,available:true,merchant_available:true}).eq('id',productId).eq('business_id',business));
  if(!prior) await read(db.from('products').insert({id:productId,business_id:business,sku:'heineken-original-lata-473ml',
    external_id:'CODEX-QA-COMBO-20261026',name:'QA Componente sintético combo Codex',brand:'QA',category:'Almacén',subcategory:'QA',
    price:100,stock:12,is_alcoholic:false,minimum_age:null,variant:'unidad QA',presentation:'unidad QA',capacity_value:1,
    capacity_unit:'unidad',capacity:'1 unidad',packaging_type:'unidad',units_per_pack:1,sort_order:4,
    description:'Fixture sintético exclusivo de auditoría Codex 20261026; no es un producto comercial',
    is_active:true,available:true,merchant_available:true,is_verified:true,verified_at:new Date().toISOString(),verified_by:b.ordering_verified_by,
    catalog_origin:'commercial',price_status:'confirmed'}));
  const combo=await read(db.from('product_combos').select('id').eq('business_id',business).eq('combo_id','combo-heineken-x6').maybeSingle());
  if(combo) {
    assert.equal(combo.id,comboId,'refuse to overwrite another combo');
    await read(db.from('product_combos').update({is_active:true}).eq('id',comboId).eq('business_id',business));
  }
  else {
    await read(db.from('product_combos').insert({id:comboId,business_id:business,combo_id:'combo-heineken-x6',
      name:'QA Combo Codex seis unidades',discount_percentage:10,price_rounding:100,approval_status:'APROBADO_COMERCIAL',
      approved_at:new Date().toISOString(),approved_by:b.ordering_verified_by,approval_note:'Auditoría QA con dinero ficticio; no publicar',is_active:true}));
    await read(db.from('product_combo_components').insert({combo_id:comboId,product_id:productId,quantity:6}));
  }
} else {
  await read(db.from('product_combos').update({is_active:false}).eq('id',comboId).eq('business_id',business));
  await read(db.from('products').update({is_active:false,available:false,merchant_available:false}).eq('id',productId).eq('business_id',business));
}
console.log(JSON.stringify({ref,action:process.argv[2],product:await read(db.from('products').select('id,sku,price,stock,is_active').eq('id',productId).eq('business_id',business).single()),combo_id:comboId}));
