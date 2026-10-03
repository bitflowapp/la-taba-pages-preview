import fs from 'node:fs';
import {call} from './la-taba-mp-mcp-client.mjs';
const credentials=await call('get_credentials',{});
const text=credentials.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
const access=text.split('## Test (Sandbox)')[1]?.match(/(?:APP_USR|TEST)-[A-Za-z0-9_-]+/)?.[0];
if(!access)throw Error('Test credential missing');
const audit=JSON.parse(fs.readFileSync('C:/1212/la-taba-mp-cutover-audit.json','utf8'));
async function get(path){const r=await fetch('https://api.mercadopago.com'+path,{headers:{Authorization:`Bearer ${access}`},signal:AbortSignal.timeout(25000)});return {http:r.status,body:await r.json().catch(()=>({}))};}
const me=await get('/users/me');
if(me.http!==200||!me.body.tags?.includes('test_user')||String(me.body.id)!=='3594962708')throw Error('Unexpected seller identity');
const selectPayment=p=>({id:p.id,collector_id:p.collector_id,payer_id:p.payer?.id,live_mode:p.live_mode,status:p.status,status_detail:p.status_detail,transaction_amount:p.transaction_amount,transaction_amount_refunded:p.transaction_amount_refunded,currency_id:p.currency_id,external_reference:p.external_reference,date_created:p.date_created,date_approved:p.date_approved,money_release_date:p.money_release_date,money_release_status:p.money_release_status,net_received_amount:p.transaction_details?.net_received_amount});
const items=[];let cursor=0;
await Promise.all(Array.from({length:4},async()=>{while(cursor<audit.attempts.length){const row=audit.attempts[cursor++];const result={intent_id:row.id};
 if(/^\d+$/.test(row.provider_payment_id||'')){const p=await get(`/v1/payments/${row.provider_payment_id}`);result.payment={http:p.http,...selectPayment(p.body)};}
 if(row.preference_id){const p=await get(`/checkout/preferences/${encodeURIComponent(row.preference_id)}`);result.preference={http:p.http,id:p.body.id,collector_id:p.body.collector_id,external_reference:p.body.external_reference,date_created:p.body.date_created};}
 const searched=await get(`/v1/payments/search?external_reference=${encodeURIComponent(row.external_reference)}&limit=100`);
 result.search={http:searched.http,total:searched.body.paging?.total,payments:searched.body.results?.map(selectPayment)};
 items.push(result);
}}));
const buyers=[];for(const id of new Set(items.flatMap(i=>[i.payment?.payer_id,...(i.search.payments||[]).map(p=>p.payer_id)]).filter(Boolean))){const r=await get(`/users/${id}`);buyers.push({id,http:r.http,tags:r.body.tags,site_id:r.body.site_id});}
const evidence={seller:{id:me.body.id,tags:me.body.tags,site_id:me.body.site_id,credential_prefix:access.startsWith('APP_USR-')?'APP_USR':'TEST',credential_type:'MCP automatic test user'},buyers,items};
fs.writeFileSync('C:/1212/la-taba-mp-cutover-provider.json',JSON.stringify(evidence,null,2));
console.log(JSON.stringify({seller:evidence.seller,buyers,rows:items.length,failed:items.flatMap(i=>['payment','preference','search'].filter(k=>i[k]&&i[k].http!==200).map(k=>({intent_id:i.intent_id,kind:k,http:i[k].http}))),payments:items.filter(i=>i.payment).map(i=>i.payment),searchTotal:items.reduce((n,i)=>n+(i.search.total||0),0)},null,2));
