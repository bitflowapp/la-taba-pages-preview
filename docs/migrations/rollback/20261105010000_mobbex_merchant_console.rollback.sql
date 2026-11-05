-- Rollback of supabase/migrations/20261105010000_mobbex_merchant_console.sql
--
-- Drops the two panel functions. They only read the ledger or enqueue a re-read, so this touches no money, no order and no
-- refund and has no refusal guard. Audit events already written (merchant.reconcile_requested) stay in mobbex_payment_events
-- as history. The panel then simply stops listing Mobbex payments; nothing else depends on these functions.

drop function if exists public.mobbex_request_business_reconcile(uuid);
drop function if exists public.mobbex_list_business_payments(uuid, integer);
