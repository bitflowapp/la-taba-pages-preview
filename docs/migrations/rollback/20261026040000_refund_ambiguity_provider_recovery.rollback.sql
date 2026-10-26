-- Rollback of 20261026040000_refund_ambiguity_provider_recovery.sql
-- Removes the provider-evidence exit for ambiguous refunds. Refunds already settled by it stay `failed` with their
-- audit event; refunds still ambiguous go back to the state of 20261026030000 (no way out except adopting a provider
-- refund through resolve_ambiguous_refund with exact evidence).
drop function if exists public.request_refund_reverification(uuid);
drop function if exists public.settle_ambiguous_refund_from_provider(uuid, jsonb);
