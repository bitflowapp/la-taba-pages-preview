-- Read-only supporting evidence. This cannot prove hosted runtime termination.
-- Never infer drain from an expired lease or an empty query alone.
select clock_timestamp() as observed_at;
select status,
 count(*) as jobs,
 count(*) filter(where owner like 'edge:v2:%') as v2_owned,
 count(*) filter(where owner not like 'edge:v2:%' or owner is null) as legacy_or_unknown,
 min(lease_expires_at) as earliest_lease_expiry,
 max(lease_expires_at) as latest_lease_expiry
from public.payment_outbox
where status in ('claimed','processing','pending','retry_wait','dead_letter')
group by status order by status;

select status,count(*) as refunds,
 count(*) filter(where provider_refund_id is null) as identity_unknown
from public.payment_refunds
where status in ('requested','processing','ambiguous')
group by status order by status;

select jobname,active,schedule from cron.job
where jobname='taba-payment-outbox-worker';
select count(*) as queued_worker_dispatches from net.http_request_queue
where url like '%/functions/v1/mercadopago-payment-worker';

select count(distinct a.pid) as other_transactions_holding_payment_locks
from pg_stat_activity a join pg_locks l on l.pid=a.pid
join pg_class c on c.oid=l.relation join pg_namespace n on n.oid=c.relnamespace
where a.pid<>pg_backend_pid() and a.xact_start is not null
 and n.nspname='public' and c.relname in
 ('payment_intents','payment_attempts','payment_refunds','payment_outbox','checkout_sessions');
