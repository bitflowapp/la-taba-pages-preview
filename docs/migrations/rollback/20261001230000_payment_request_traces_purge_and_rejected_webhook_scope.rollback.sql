-- REVERSIÓN de 20261001230000_payment_request_traces_purge_and_rejected_webhook_scope.sql
--
-- Quita la tarea `taba-payment-traces-purge` (y su fila del inventario de tareas
-- esperadas, si ese inventario existe), borra `purge_payment_request_traces` y
-- devuelve `consume_payment_rate_limit` y la restricción de operaciones de
-- `payment_rate_limit_buckets` a como estaban: sin `webhook_rejected`.
--
-- ANTES DE CORRERLA: volver a desplegar la versión anterior de
-- `mercadopago-webhook`. La versión nueva sigue respondiendo 401 a un pedido sin
-- firma válida aunque la base ya no acepte `webhook_rejected` (lo toma como «sin
-- lugar»), pero deja de guardar los recibos rechazados y la alerta
-- `list_webhook_signature_alerts` se queda sin datos.
--
-- Ojo con lo que vuelve a quedar abierto: los cupos y los recibos rechazados
-- vuelven a no podarse nunca.
--
-- Pierde, a propósito, los cupos de `webhook_rejected` que estén guardados: la
-- restricción anterior no los admite. Son contadores de una ventana de una hora,
-- sin valor después de ella. No borra ningún recibo.
--
-- El cuerpo de `consume_payment_rate_limit` de abajo es el de `pg_get_functiondef`
-- sobre la base anterior a la migración: no se reescribió a mano.
--
-- No toca supabase_migrations.schema_migrations. Después:
--   supabase migration repair --status reverted 20261001230000
begin;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'taba-payment-traces-purge') then
    perform cron.unschedule('taba-payment-traces-purge');
  end if;
  if to_regclass('private.scheduler_expected_jobs') is not null then
    execute $inventory$
      delete from private.scheduler_expected_jobs where job_name = 'taba-payment-traces-purge'
    $inventory$;
  end if;
end;
$$;

drop function if exists public.purge_payment_request_traces(integer);

delete from public.payment_rate_limit_buckets where scope = 'webhook_rejected';

alter table public.payment_rate_limit_buckets drop constraint if exists payment_rate_limit_scope_check;
alter table public.payment_rate_limit_buckets add constraint payment_rate_limit_scope_check
  check (scope in ('checkout_session', 'preference', 'checkout_status', 'webhook', 'refund', 'cancellation', 'worker'));

CREATE OR REPLACE FUNCTION public.consume_payment_rate_limit(p_scope text, p_subject_hash text, p_limit integer, p_window_seconds integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_bucket timestamptz;
  v_count integer;
begin
  if p_scope not in ('checkout_session', 'preference', 'checkout_status', 'webhook', 'refund', 'cancellation', 'worker')
    or p_subject_hash !~ '^[a-f0-9]{64}$'
    or p_limit not between 1 and 1000
    or p_window_seconds not between 10 and 3600 then
    raise exception 'rate limit invalido' using errcode = '22023';
  end if;
  v_bucket := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds);
  insert into public.payment_rate_limit_buckets (
    scope, subject_hash, bucket_started_at, request_count
  ) values (
    p_scope, p_subject_hash, v_bucket, 1
  ) on conflict (scope, subject_hash, bucket_started_at)
  do update set request_count = public.payment_rate_limit_buckets.request_count + 1
  returning request_count into v_count;
  return jsonb_build_object('allowed', v_count <= p_limit, 'count', v_count, 'limit', p_limit, 'bucket_started_at', v_bucket);
end;
$function$;

revoke all on function public.consume_payment_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_payment_rate_limit(text, text, integer, integer) to service_role;

commit;
