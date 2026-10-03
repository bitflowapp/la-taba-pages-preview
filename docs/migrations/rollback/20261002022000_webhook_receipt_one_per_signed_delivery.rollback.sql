-- REVERSIÓN de 20261002022000_webhook_receipt_one_per_signed_delivery.sql
--
-- Devuelve `record_mercadopago_webhook_receipt` a su cuerpo anterior, exacto (el de
-- `pg_get_functiondef` sobre la base previa a la migración: no se reescribió a
-- mano).
--
-- Qué vuelve a quedar abierto: una entrega firmada repetida con otro id en el
-- cuerpo vuelve a dejar un recibo y un trabajo por repetición, mientras la firma
-- valga y hasta el cupo de su dirección.
--
-- No frena por datos: no hay nada que se pierda. Los trabajos que la migración
-- volvió a poner en la cola siguen su curso normal. No toca filas ni
-- supabase_migrations.schema_migrations. Después:
--   supabase migration repair --status reverted 20261002022000
begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('la-taba:rollback:20261002022000', 0)
);

-- Se niega a correr si otra migración redefinió alguna de estas funciones después de
-- 20261002022000: su cuerpo vivo tiene que ser el que dejó esa migración o el anterior
-- (el anterior permite correr la reversión dos veces).
do $redefinition_guard$
declare
  v_row record;
  v_actual text;
begin
  for v_row in
    select * from (values
      ('public.record_mercadopago_webhook_receipt(text,text,text,text,boolean,text,text)', '14c4761aea9f7170ba9b6f2fec973678', '88c60be24b28d32db57ec4493fcd31d2')
    ) as t(signature, applied, previous)
  loop
    select md5(replace(p.prosrc, E'\r', '')) into v_actual
      from pg_proc p where p.oid = to_regprocedure(v_row.signature);
    if v_actual is null or v_actual not in (v_row.applied, v_row.previous) then
      raise exception 'ROLLBACK_BLOCKED: % no tiene el cuerpo de 20261002022000 ni el anterior; otra migracion la redefinio despues: revertir esa primero', v_row.signature
        using errcode = 'P0001';
    end if;
  end loop;
end
$redefinition_guard$;

CREATE OR REPLACE FUNCTION public.record_mercadopago_webhook_receipt(p_environment text, p_webhook_event_id text, p_event_type text, p_resource_id text, p_signature_valid boolean, p_request_id text, p_payload_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_receipt public.payment_webhook_receipts%rowtype;
  v_topic text;
  v_job_id uuid;
  v_inserted boolean := false;
begin
  if lower(btrim(coalesce(p_environment, ''))) not in ('test', 'production')
    or nullif(btrim(p_webhook_event_id), '') is null
    or nullif(btrim(p_event_type), '') is null
    or nullif(btrim(p_resource_id), '') is null
    or p_payload_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'receipt de webhook invalido' using errcode = '22023';
  end if;

  insert into public.payment_webhook_receipts (
    environment, webhook_event_id, event_type, resource_id, signature_valid,
    request_id, payload_hash, processing_status
  ) values (
    lower(btrim(p_environment)), left(btrim(p_webhook_event_id), 200),
    left(lower(btrim(p_event_type)), 120), left(btrim(p_resource_id), 200),
    p_signature_valid, nullif(left(btrim(coalesce(p_request_id, '')), 200), ''), p_payload_hash,
    case when p_signature_valid then 'received' else 'rejected_signature' end
  ) on conflict (provider, environment, webhook_event_id, event_type, resource_id) do nothing
  returning * into v_receipt;
  v_inserted := found;

  if not v_inserted then
    select * into v_receipt
      from public.payment_webhook_receipts r
     where r.provider = 'mercadopago'
       and r.environment = lower(btrim(p_environment))
       and r.webhook_event_id = left(btrim(p_webhook_event_id), 200)
       and r.event_type = left(lower(btrim(p_event_type)), 120)
       and r.resource_id = left(btrim(p_resource_id), 200)
     for update;
    if not found then raise exception 'receipt de webhook no disponible'; end if;

    if v_receipt.signature_valid or not p_signature_valid then
      update public.payment_webhook_receipts
         set attempt_count = attempt_count + 1
       where id = v_receipt.id;
      return jsonb_build_object(
        'receipt_id', v_receipt.id,
        'duplicate', true,
        'queued', false,
        'signature_valid', v_receipt.signature_valid
      );
    end if;

    update public.payment_webhook_receipts
       set signature_valid = true,
           request_id = nullif(left(btrim(coalesce(p_request_id, '')), 200), ''),
           payload_hash = p_payload_hash,
           processing_status = 'received',
           attempt_count = attempt_count + 1
     where id = v_receipt.id
     returning * into v_receipt;
  end if;

  if not p_signature_valid then
    return jsonb_build_object('receipt_id', v_receipt.id, 'duplicate', false, 'queued', false);
  end if;

  v_topic := case
    when lower(p_event_type) like '%chargeback%' then 'chargeback'
    when lower(p_event_type) like '%claim%' then 'claim'
    when lower(p_event_type) like '%payment%' then 'payment'
    else null
  end;
  if v_topic is null then
    update public.payment_webhook_receipts
       set processing_status = 'completed', processed_at = clock_timestamp()
     where id = v_receipt.id;
    return jsonb_build_object('receipt_id', v_receipt.id, 'duplicate', not v_inserted, 'queued', false);
  end if;

  insert into public.payment_outbox (webhook_receipt_id, topic, resource_id)
  values (v_receipt.id, v_topic, left(btrim(p_resource_id), 200))
  on conflict (webhook_receipt_id) where webhook_receipt_id is not null do nothing
  returning id into v_job_id;
  update public.payment_webhook_receipts set processing_status = 'queued' where id = v_receipt.id;
  return jsonb_build_object(
    'receipt_id', v_receipt.id,
    'duplicate', not v_inserted,
    'queued', v_job_id is not null,
    'promoted', not v_inserted
  );
end;
$function$;

revoke all on function public.record_mercadopago_webhook_receipt(text, text, text, text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.record_mercadopago_webhook_receipt(text, text, text, text, boolean, text, text) to service_role;

commit;
