-- A rejected delivery is evidence of an attack or transport error, not an
-- authoritative claim on the provider event identity. A later valid delivery
-- atomically promotes the row and enters the durable outbox exactly once.
create or replace function public.record_mercadopago_webhook_receipt(
  p_environment text,
  p_webhook_event_id text,
  p_event_type text,
  p_resource_id text,
  p_signature_valid boolean,
  p_request_id text,
  p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
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
$$;

-- Recording a provider refund is an identity-bearing operation. Serialize on
-- the local refund, reject cross-refund provider IDs, and make retries no-op.
create or replace function public.record_payment_refund_response(
  p_refund_id uuid, p_provider_refund_id text, p_status text, p_amount numeric, p_response_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_refund public.payment_refunds%rowtype;
  v_intent public.payment_intents%rowtype;
  v_total numeric(12, 2);
  v_provider_refund_id text := nullif(left(btrim(coalesce(p_provider_refund_id, '')), 200), '');
begin
  if p_response_hash !~ '^[a-f0-9]{64}$'
    or p_status not in ('approved', 'rejected', 'ambiguous', 'failed')
    or p_amount is null or p_amount <= 0 then
    raise exception 'respuesta de reembolso invalida' using errcode = '22023';
  end if;
  select * into v_refund from public.payment_refunds r where r.id = p_refund_id for update;
  if not found then raise exception 'reembolso inexistente' using errcode = 'P0002'; end if;
  select * into v_intent from public.payment_intents pi where pi.id = v_refund.payment_intent_id for update;
  if p_amount <> v_refund.amount then
    update public.payment_intents
       set internal_status = 'security_review_required', security_review_reason = 'refund_amount_mismatch'
     where id = v_intent.id;
    raise exception 'importe de reembolso no coincide' using errcode = '22023';
  end if;
  if v_refund.provider_refund_id is not null
    and v_refund.provider_refund_id is distinct from v_provider_refund_id then
    raise exception 'identidad de reembolso no coincide' using errcode = '23505';
  end if;
  if v_provider_refund_id is not null and exists (
    select 1 from public.payment_refunds r
     where r.provider_refund_id = v_provider_refund_id and r.id <> v_refund.id
  ) then
    raise exception 'reembolso del proveedor ya asociado' using errcode = '23505';
  end if;
  if v_refund.provider_refund_id = v_provider_refund_id
    and v_refund.status = p_status
    and v_refund.raw_response_hash = p_response_hash then
    return jsonb_build_object('ok', true, 'payment_intent_id', v_intent.id, 'idempotent', true);
  end if;

  update public.payment_refunds
     set provider_refund_id = v_provider_refund_id,
         status = p_status,
         raw_response_hash = p_response_hash,
         completed_at = case when p_status in ('approved', 'rejected') then clock_timestamp() else completed_at end
   where id = v_refund.id;
  if p_status = 'approved' then
    select coalesce(sum(r.amount), 0) into v_total
      from public.payment_refunds r
     where r.payment_intent_id = v_intent.id and r.status = 'approved';
    if v_intent.internal_status = 'security_review_required' then
      update public.payment_intents set refunded_amount = v_total where id = v_intent.id;
    else
      update public.payment_intents
         set refunded_amount = v_total,
             internal_status = case
               when v_total >= coalesce(v_intent.paid_amount, v_intent.expected_amount) then 'refunded'
               else 'partially_refunded'
             end
       where id = v_intent.id;
    end if;
  end if;
  insert into public.payment_events (payment_intent_id, event_type, details, raw_response_hash)
  values (v_intent.id, 'payment.refund_' || p_status, jsonb_build_object('refund_id', v_refund.id, 'amount', p_amount), p_response_hash);
  return jsonb_build_object('ok', true, 'payment_intent_id', v_intent.id, 'idempotent', false);
end;
$$;

revoke all on function public.record_mercadopago_webhook_receipt(text,text,text,text,boolean,text,text) from public, anon, authenticated;
revoke all on function public.record_payment_refund_response(uuid,text,text,numeric,text) from public, anon, authenticated;
grant execute on function public.record_mercadopago_webhook_receipt(text,text,text,text,boolean,text,text) to service_role;
grant execute on function public.record_payment_refund_response(uuid,text,text,numeric,text) to service_role;
