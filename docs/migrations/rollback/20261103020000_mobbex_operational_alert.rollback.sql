-- Rollback of supabase/migrations/20261103020000_mobbex_operational_alert.sql
--
-- Disconnects the Mobbex alerts from reconcile_operational_alerts_for_business (restoring the previous definition
-- byte for byte), drops the lister and the switch, and removes the column. It touches no money and no order, so it has
-- no refusal guard: alerts already raised for Mobbex stay in operational_alerts as history and the existing
-- reconciliation resolves them on its next pass (their condition is no longer evaluated).
--
-- Switching the alert off for a business does NOT need this script: select public.set_mobbex_health_alert(<business>, false).

do $unwire$
declare
  v_def text;
  v_old text;
  v_snippet constant text := E'union all select * from public.list_mobbex_operational_alerts(p_business_id)\n    ';
begin
  v_def := pg_get_functiondef('public.reconcile_operational_alerts_for_business(uuid)'::regprocedure);
  if strpos(v_def, v_snippet) > 0 then
    v_old := replace(v_def, v_snippet, '');
    if strpos(v_old, 'list_mobbex_operational_alerts') > 0 then raise exception 'MOBBEX_ALERT_UNWIRE_RESIDUE'; end if;
    execute v_old;
  end if;
end $unwire$;

drop function if exists public.list_mobbex_operational_alerts(uuid);
drop function if exists public.set_mobbex_health_alert(uuid, boolean);
alter table public.mobbex_business_settings drop column if exists health_alert_enabled;
