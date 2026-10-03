import {query} from './la-taba-mp-cutover-db.mjs';
import fs from 'node:fs';
const business='00000000-0000-4000-8000-000000000001';
const attempts=await query(`select id,business_id,environment,external_reference,preference_id,provider_payment_id,provider_merchant_order_id,provider_status,provider_status_detail,internal_status,currency,expected_amount,paid_amount,live_mode,preference_created_at,approved_at,refunded_amount,provider_event_at,created_at,updated_at,security_review_reason from public.payment_intents where business_id='${business}' order by created_at,id`);
const events=await query(`select e.payment_intent_id,e.event_type,e.provider_status,e.provider_status_detail,e.provider_occurred_at,e.server_recorded_at,e.details from public.payment_events e join public.payment_intents i on i.id=e.payment_intent_id where i.business_id='${business}' order by e.server_recorded_at`);
const origin=await query(`select o.origin,o.origin_reason,count(*) from public.orders o where o.business_id='${business}' group by 1,2`);
fs.writeFileSync('C:/1212/la-taba-mp-cutover-audit.json',JSON.stringify({attempts,events,origin},null,2));
const counts={};for(const row of attempts){const k=JSON.stringify([row.environment,row.live_mode,row.internal_status,row.provider_status,!!row.provider_payment_id]);counts[k]=(counts[k]||0)+1;}
console.log(JSON.stringify({total:attempts.length,counts,paymentIds:[...new Set(attempts.map(r=>r.provider_payment_id).filter(Boolean))],preferences:attempts.filter(r=>r.preference_id).length,events:events.length,origins:origin,eventKeys:[...new Set(events.flatMap(e=>Object.keys(e.details||{})))]},null,2));
