-- A1: one statement and one MVCC snapshot, used both before and after provider
-- verification. Only the server may read this encrypted credential material.
create or replace function public.get_mercadopago_payment_authority(
  p_business_id uuid, p_environment text, p_checkout_session_id uuid, p_customer_id uuid
)
returns jsonb language sql stable security invoker
set search_path = pg_catalog, public, extensions, pg_temp
as $$
  select jsonb_build_object(
    'business', jsonb_build_object('id', b.id, 'is_active', b.is_active, 'status', b.status,
      'ordering_enabled', b.ordering_enabled, 'ordering_verified', b.ordering_verified),
    'settings', to_jsonb(s),
    'seller', to_jsonb(c),
    'checkout', jsonb_build_object('id', cs.id, 'customer_id', cs.customer_id,
      'business_id', cs.business_id, 'payment_intent_id', pi.id, 'environment', pi.environment,
      'status', cs.status, 'expires_at', cs.expires_at,
      'business_open', public.business_is_open(b.id, cs.fulfillment_type, statement_timestamp()),
      'reservation_valid', exists(select 1 from public.inventory_reservations r
        where r.checkout_session_id=cs.id and r.status='active' and r.expires_at>statement_timestamp())),
    'authority_version', encode(extensions.digest(jsonb_build_array(
      to_jsonb(b), to_jsonb(s), to_jsonb(c), to_jsonb(cs), to_jsonb(pi)
    )::text, 'sha256'), 'hex')
  )
  from public.businesses b
  join public.checkout_sessions cs on cs.business_id=b.id and cs.id=p_checkout_session_id and cs.customer_id=p_customer_id
  join public.payment_intents pi on pi.checkout_session_id=cs.id and pi.business_id=b.id and pi.environment=p_environment
  left join public.business_payment_settings s on s.business_id=b.id and s.provider='mercadopago'
  left join public.mp_seller_connections c on c.business_id=b.id and c.environment=p_environment
  where b.id=p_business_id;
$$;
revoke all on function public.get_mercadopago_payment_authority(uuid,text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.get_mercadopago_payment_authority(uuid,text,uuid,uuid) to service_role;

-- A4: an ID may only be captured from the provider response to the persisted
-- outbound request. This RPC records identity, never approval. No browser grant.
create or replace function public.record_payment_refund_identity(
  p_refund_id uuid, p_payment_intent_id uuid, p_provider_payment_id text,
  p_idempotency_key uuid, p_provider_refund_id text
)
returns boolean language plpgsql security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare v_refund public.payment_refunds%rowtype; v_intent public.payment_intents%rowtype;
begin
  if p_provider_refund_id is null or p_provider_refund_id !~ '^[1-9][0-9]{0,31}$' then
    raise exception 'identidad de reembolso invalida' using errcode='22023';
  end if;
  -- Same lock order as prepare_payment_refund: intent, then refund.
  select * into v_intent from public.payment_intents where id=p_payment_intent_id for update;
  if not found or v_intent.provider_payment_id is distinct from p_provider_payment_id then
    raise exception 'pago del reembolso no coincide' using errcode='22023';
  end if;
  select * into v_refund from public.payment_refunds where id=p_refund_id for update;
  if not found or v_refund.payment_intent_id is distinct from p_payment_intent_id
    or v_refund.idempotency_key is distinct from p_idempotency_key then
    raise exception 'solicitud de reembolso no coincide' using errcode='22023';
  end if;
  if v_refund.provider_refund_id is not null then
    if v_refund.provider_refund_id<>p_provider_refund_id then
      raise exception 'identidad de reembolso no coincide' using errcode='23505';
    end if;
    return true;
  end if;
  if v_refund.status not in ('requested','processing','ambiguous') then
    raise exception 'reembolso ya resuelto' using errcode='55000';
  end if;
  update public.payment_refunds set provider_refund_id=p_provider_refund_id where id=p_refund_id;
  return true;
end;
$$;
revoke all on function public.record_payment_refund_identity(uuid,uuid,text,uuid,text) from public, anon, authenticated;
grant execute on function public.record_payment_refund_identity(uuid,uuid,text,uuid,text) to service_role;

-- An association chosen from amount/time must not become financial authority.
-- Only the previously bound provider ID can be approved. Terminal outcomes and
-- financial events remain unchanged on repeat, including changed response hashes.
create or replace function public.record_payment_refund_response_v2(
  p_refund_id uuid, p_provider_refund_id text, p_status text, p_amount numeric, p_response_hash text
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_refund public.payment_refunds%rowtype;
  v_intent public.payment_intents%rowtype;
  v_intent_id uuid;
  v_total numeric(12,2);
  v_provider_id text := nullif(btrim(coalesce(p_provider_refund_id,'')),'');
begin
  if p_response_hash is null or p_response_hash !~ '^[a-f0-9]{64}$'
    or p_status is null or p_status not in ('approved','rejected','ambiguous','failed')
    or p_amount is null or p_amount<=0 then
    raise exception 'respuesta de reembolso invalida' using errcode='22023';
  end if;
  select payment_intent_id into v_intent_id from public.payment_refunds where id=p_refund_id;
  if not found then raise exception 'reembolso inexistente' using errcode='P0002'; end if;
  select * into v_intent from public.payment_intents where id=v_intent_id for update;
  select * into v_refund from public.payment_refunds where id=p_refund_id for update;
  if not found or v_refund.payment_intent_id is distinct from v_intent_id then
    raise exception 'solicitud de reembolso cambio' using errcode='22023';
  end if;
  if p_amount is distinct from v_refund.amount then
    raise exception 'importe de reembolso no coincide' using errcode='22023';
  end if;
  if v_provider_id is distinct from v_refund.provider_refund_id
    or (p_status='approved' and v_provider_id is null) then
    raise exception 'identidad de reembolso no confirmada' using errcode='23505';
  end if;
  if v_refund.status in ('approved','rejected') then
    if v_refund.status<>p_status then
      raise exception 'resultado de reembolso ya confirmado' using errcode='55000';
    end if;
    return jsonb_build_object('ok',true,'payment_intent_id',v_intent_id,'idempotent',true);
  end if;
  if v_refund.status=p_status and v_refund.raw_response_hash=p_response_hash then
    return jsonb_build_object('ok',true,'payment_intent_id',v_intent_id,'idempotent',true);
  end if;
  update public.payment_refunds set status=p_status, raw_response_hash=p_response_hash,
    completed_at=case when p_status in ('approved','rejected') then clock_timestamp() else completed_at end
    where id=p_refund_id;
  if p_status='approved' then
    select coalesce(sum(amount),0) into v_total from public.payment_refunds
      where payment_intent_id=v_intent_id and status='approved';
    if v_intent.internal_status='security_review_required' then
      update public.payment_intents set refunded_amount=v_total where id=v_intent_id;
    else
      update public.payment_intents set refunded_amount=v_total,
        internal_status=case when v_total>=coalesce(paid_amount,expected_amount) then 'refunded' else 'partially_refunded' end
        where id=v_intent_id;
    end if;
  end if;
  insert into public.payment_events(payment_intent_id,event_type,details,raw_response_hash)
    values(v_intent_id,'payment.refund_'||p_status,jsonb_build_object('refund_id',p_refund_id,'amount',p_amount),p_response_hash);
  return jsonb_build_object('ok',true,'payment_intent_id',v_intent_id,'idempotent',false);
end;
$$;
revoke all on function public.record_payment_refund_response_v2(uuid,text,text,numeric,text) from public, anon, authenticated;
grant execute on function public.record_payment_refund_response_v2(uuid,text,text,numeric,text) to service_role;

-- A late network failure must not downgrade an already recorded outcome. Keep
-- one outstanding reconciliation job while preserving a known refund identity.
create or replace function public.mark_payment_refund_ambiguous(
  p_refund_id uuid, p_request_hash text, p_error_code text
)
returns boolean language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare v_refund public.payment_refunds%rowtype; v_intent_id uuid;
begin
  if p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'hash invalido' using errcode='22023';
  end if;
  select payment_intent_id into v_intent_id from public.payment_refunds where id=p_refund_id;
  if not found then raise exception 'reembolso inexistente' using errcode='P0002'; end if;
  perform 1 from public.payment_intents where id=v_intent_id for update;
  select * into v_refund from public.payment_refunds where id=p_refund_id for update;
  if not found or v_refund.payment_intent_id is distinct from v_intent_id then
    raise exception 'solicitud de reembolso cambio' using errcode='22023';
  end if;
  if v_refund.status in ('approved','rejected') then return true; end if;
  update public.payment_refunds set status='ambiguous',raw_response_hash=p_request_hash where id=p_refund_id;
  if not exists(select 1 from public.payment_outbox where refund_id=p_refund_id and topic='refund_reconcile'
    and status in ('pending','claimed','processing','retry_wait')) then
    insert into public.payment_outbox(payment_intent_id,refund_id,topic,resource_id,last_error)
      values(v_intent_id,p_refund_id,'refund_reconcile',null,left(coalesce(p_error_code,'network_or_timeout'),160));
  end if;
  return true;
end;
$$;
revoke all on function public.mark_payment_refund_ambiguous(uuid,text,text) from public, anon, authenticated;
grant execute on function public.mark_payment_refund_ambiguous(uuid,text,text) to service_role;
