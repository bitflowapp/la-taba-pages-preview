-- El rastro de los pedidos de pago se poda solo, y los webhooks rechazados tienen su propio cupo.
--
-- QUÉ ESTABA ROTO (leído sobre una base con todas las migraciones anteriores, 2026-10-02)
--
--   1. `payment_rate_limit_buckets` no se podaba nunca. `consume_payment_rate_limit`
--      inserta una fila por (operación, sujeto, ventana) y ninguna función ni tarea
--      borra nada: el worker y el webhook solos dejaban dos filas por minuto, y cada
--      cliente una por ventana. La tabla sólo crecía.
--   2. `payment_webhook_receipts` tampoco. El webhook es el único endpoint sin
--      autenticación previa y guardaba un recibo `rejected_signature` por cada
--      pedido sin firma válida: cualquiera podía hacerla crecer sin límite.
--   3. El cupo del webhook se gastaba ANTES de mirar la firma, así que los pedidos
--      rechazados y las notificaciones reales compartían cupo.
--
-- QUÉ CAMBIA
--
--   · `consume_payment_rate_limit` acepta la operación `webhook_rejected`. La Edge
--     Function `mercadopago-webhook` verifica primero la firma; un pedido rechazado
--     gasta ESE cupo y sólo deja recibo mientras haya lugar. Los topes los pone la
--     Edge Function y son dos, por hora: uno entre todas las direcciones y otro
--     por dirección (sus valores y el porqué están en su código). Es el único
--     cambio de la función: el resto del cuerpo es el de 20260802094000, letra
--     por letra.
--   · `purge_payment_request_traces(p_keep_days)` borra:
--       - los cupos de más de un día. Un cupo deja de contar cuando cierra su
--         ventana y la más larga es de una hora: el día es margen, no memoria;
--       - los recibos `rejected_signature` más viejos que `p_keep_days` (30 por
--         defecto, nunca menos de 2: la alerta de firmas rechazadas mira 24 horas y
--         la poda no puede sacarle lo que todavía está contando).
--     Nunca borra un recibo con firma válida, ni uno que un trabajo de la cola o un
--     evento de pago tengan referenciado.
--   · La tarea `taba-payment-traces-purge` la corre una vez por día.
--
-- QUÉ NO CAMBIA
--
--   Firma, SECURITY DEFINER, `search_path` y EXECUTE (sólo `service_role`) de
--   `consume_payment_rate_limit`; las operaciones que ya existían, sus límites y la
--   forma del resultado. Ningún recibo de una notificación válida. No toca filas:
--   la primera poda la hace la tarea.
--
-- ORDEN CON LAS EDGE FUNCTIONS
--
--   Esta migración va ANTES que el despliegue de `mercadopago-webhook`. Al revés
--   no rompe nada —la función vieja rechaza la operación desconocida, el webhook
--   lo toma como «sin lugar» y no guarda el recibo; la respuesta sigue siendo
--   401—, pero mientras tanto la alerta de firmas rechazadas se queda sin datos.
--
-- Forward-only. Reversión:
--   docs/migrations/rollback/20261001230000_payment_request_traces_purge_and_rejected_webhook_scope.rollback.sql

-- ── 1. La operación nueva ───────────────────────────────────────────────────
alter table public.payment_rate_limit_buckets drop constraint if exists payment_rate_limit_scope_check;
alter table public.payment_rate_limit_buckets add constraint payment_rate_limit_scope_check
  check (scope in ('checkout_session', 'preference', 'checkout_status', 'webhook', 'webhook_rejected', 'refund', 'cancellation', 'worker'));

create or replace function public.consume_payment_rate_limit(
  p_scope text,
  p_subject_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_bucket timestamptz;
  v_count integer;
begin
  if p_scope not in ('checkout_session', 'preference', 'checkout_status', 'webhook', 'webhook_rejected', 'refund', 'cancellation', 'worker')
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
$$;

revoke all on function public.consume_payment_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_payment_rate_limit(text, text, integer, integer) to service_role;

-- ── 2. La poda ──────────────────────────────────────────────────────────────
create or replace function public.purge_payment_request_traces(p_keep_days integer default 30)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_keep_days integer := greatest(2, least(coalesce(p_keep_days, 30), 365));
  v_buckets integer := 0;
  v_receipts integer := 0;
  v_receipts_skipped boolean := false;
begin
  delete from public.payment_rate_limit_buckets b
   where b.bucket_started_at < clock_timestamp() - interval '1 day';
  get diagnostics v_buckets = row_count;

  -- Los recibos están detrás del candado de entrega (`a1_a4_financial_interlock_v5`):
  -- con una entrega en pausa, cualquier escritura sobre la tabla se rechaza con
  -- TABA_RELEASE_QUIESCED, aunque no borre ninguna fila. Esa pausa es deliberada y
  -- dura poco: la poda de ese día se saltea y no deja la tarea en falla. Los cupos
  -- de arriba no están detrás del candado y se podan igual.
  begin
    delete from public.payment_webhook_receipts r
     where r.processing_status = 'rejected_signature'
       and r.signature_valid is false
       and r.received_at < clock_timestamp() - make_interval(days => v_keep_days)
       and not exists (select 1 from public.payment_outbox o where o.webhook_receipt_id = r.id)
       and not exists (select 1 from public.payment_events e where e.webhook_receipt_id = r.id);
    get diagnostics v_receipts = row_count;
  exception
    when sqlstate '55000' then
      if sqlerrm <> 'TABA_RELEASE_QUIESCED' then
        raise;
      end if;
      v_receipts_skipped := true;
  end;

  return jsonb_build_object(
    'rate_limit_buckets', v_buckets,
    'rejected_receipts', v_receipts,
    'rejected_receipts_skipped', v_receipts_skipped,
    'kept_days', v_keep_days
  );
end;
$$;

revoke all on function public.purge_payment_request_traces(integer) from public, anon, authenticated;
grant execute on function public.purge_payment_request_traces(integer) to service_role;

comment on function public.purge_payment_request_traces(integer) is
  'Poda los cupos vencidos de pagos y los recibos de webhook rechazados por firma; agendada una vez por dia por pg_cron.';

-- ── 3. La tarea ─────────────────────────────────────────────────────────────
create extension if not exists pg_cron with schema pg_catalog;
do $$
begin
  perform cron.schedule(
    'taba-payment-traces-purge',
    '23 4 * * *',
    'select public.purge_payment_request_traces(30);'
  );
end;
$$;

-- El inventario de tareas esperadas (20261001220000) es de otra entrega y puede
-- no estar aplicado: la tarea se anota sólo si la tabla existe. Sin esta fila la
-- salud del planificador no sabría que esta tarea tiene que existir.
do $$
begin
  if to_regclass('private.scheduler_expected_jobs') is not null then
    execute $inventory$
      insert into private.scheduler_expected_jobs (job_name, purpose)
      values ('taba-payment-traces-purge', 'poda los cupos de pagos vencidos y los recibos de webhook rechazados')
      on conflict (job_name) do nothing
    $inventory$;
  end if;
end;
$$;
