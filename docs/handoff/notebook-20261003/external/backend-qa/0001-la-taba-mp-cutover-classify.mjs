import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {query} from './la-taba-mp-cutover-db.mjs';
const audit=JSON.parse(fs.readFileSync('C:/1212/la-taba-mp-cutover-audit.json'));
const provider=JSON.parse(fs.readFileSync('C:/1212/la-taba-mp-cutover-provider.json'));
const orders=await query("select i.id,o.origin,o.origin_reason from public.payment_intents i left join public.orders o on o.id=i.order_id where i.business_id='00000000-0000-4000-8000-000000000001'");
const testSeller=String(provider.seller.id);
if(!provider.seller.tags.includes('test_user'))throw Error('Unverified test seller');
const rows=audit.attempts.map(row=>{
 const p=provider.items.find(p=>p.intent_id===row.id),order=orders.find(o=>o.id===row.id);
 const payment=p.payment?.http===200?p.payment:(p.search.payments||[]).find(v=>v.external_reference===row.external_reference);
 const preference=p.preference?.http===200?p.preference:null;
 const verifiedCollector=payment?.collector_id??preference?.collector_id;
 let classification='UNKNOWN',reason='Historical seller not independently verified',seller=null;
 if(verifiedCollector&&String(verifiedCollector)===testSeller&&(payment||preference).external_reference===row.external_reference){classification='TEST';reason='Provider resource links this reference to authenticated test_user seller';seller=testSeller;}
 else if(!row.preference_id&&!row.provider_payment_id&&row.environment==='test'&&row.live_mode===false&&row.paid_amount===null&&p.search.http===200&&p.search.total===0){classification='TEST';reason='Unpaid local test intent; no provider resource or payment found; no seller assigned';}
 else if(!row.preference_id&&row.environment==='test'&&row.live_mode===false&&order?.origin==='qa'&&order?.origin_reason==='qa_fixture_product'&&p.search.http===200&&p.search.total===0){classification='TEST';reason='Persistent QA fixture classification, no provider payment, test/non-live snapshot';}
 else if(p.preference?.http===404)reason='Preference 404; no payment or merchant order found to verify historical collector';
 else if(row.provider_payment_id&&order?.origin==='production')reason='Non-provider payment ID and test/non-live snapshot conflict with production order classification; synthetic audit missing';
 return {...row,classification,classification_reason:reason,historical_seller_verified:seller,credential_type: seller?'MCP automatic test-user APP_USR credential':'NOT RECOVERABLE PER INTENT',provider_payment_found:payment?.id??null,provider_collector_verified:verifiedCollector??null,provider_live_mode:payment?.live_mode??null,provider_money_release_status:payment?.money_release_status??null,provider_net_received_amount:payment?.net_received_amount??null,provider_money_release_date:payment?.money_release_date??null,preference_http:p.preference?.http??null,provider_search_http:p.search.http,provider_search_total:p.search.total,order_origin:order?.origin??null,order_origin_reason:order?.origin_reason??null};
});
const current=await query("select id,business_id,environment,external_reference,preference_id,provider_payment_id,provider_merchant_order_id,provider_status,provider_status_detail,internal_status,currency,expected_amount,paid_amount,live_mode,preference_created_at,approved_at,refunded_amount,provider_event_at,created_at,updated_at,security_review_reason from public.payment_intents where business_id='00000000-0000-4000-8000-000000000001' order by created_at,id");
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
if(hash(current)!==hash(audit.attempts))throw Error('Historical snapshot changed during read-only audit');
const counts={TEST:0,PRODUCTION:0,UNKNOWN:0};for(const r of rows)counts[r.classification]++;
const summary={observed_at:new Date().toISOString(),project_ref:'ukxqbgswjlibmnjemrzd',counts,historical_data_preserved:true,snapshot_hash:hash(current),cutover_permitted:counts.UNKNOWN===0&&counts.PRODUCTION===0,provider_payment_count:new Set(provider.items.flatMap(p=>p.search.payments||[]).map(p=>p.id)).size};
fs.writeFileSync('C:/1212/la-taba-mp-cutover-classification.json',JSON.stringify({summary,rows},null,2));
const fields=Object.keys(rows[0]),cell=v=>'"'+String(v??'').replaceAll('"','""')+'"';
fs.writeFileSync('C:/1212/la-taba-mp-cutover-classification.csv',[fields.map(cell).join(','),...rows.map(r=>fields.map(f=>cell(r[f])).join(','))].join('\r\n'));
console.log(JSON.stringify(summary,null,2));
