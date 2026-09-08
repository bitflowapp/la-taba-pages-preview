create or replace function public.get_mercadopago_payment_authority_base_v2(
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
revoke all on function public.get_mercadopago_payment_authority_base_v2(uuid,text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.get_mercadopago_payment_authority_base_v2(uuid,text,uuid,uuid) to service_role;

-- EXPAND: additive authority and recorder contracts. No legacy RPC is removed.
alter table public.payment_attempts
 add column authority_revision bigint not null default 1,
 add column seller_generation uuid,
 add column seller_id text;
alter table public.payment_intents add column current_payment_attempt_id uuid;

create function public.bump_payment_attempt_authority_revision()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,public,pg_temp as $$
begin
 new.authority_revision := old.authority_revision + 1;
 return new;
end; $$;
revoke all on function public.bump_payment_attempt_authority_revision() from public,anon,authenticated;
create trigger payment_attempt_authority_revision before update on public.payment_attempts
 for each row execute function public.bump_payment_attempt_authority_revision();

create function public.get_mercadopago_payment_authority_v2(
 p_business_id uuid,p_environment text,p_checkout_session_id uuid,p_customer_id uuid,
 p_payment_attempt_id uuid
) returns jsonb language sql stable security invoker
set search_path=pg_catalog,public,extensions,pg_temp as $$
 select base.snapshot || jsonb_build_object(
   'attempt',to_jsonb(pa), 'intent',to_jsonb(pi),
   'attempt_version',encode(extensions.digest(to_jsonb(pa)::text,'sha256'),'hex'),
   'authority_version',encode(extensions.digest(jsonb_build_array(
       base.snapshot->>'authority_version',to_jsonb(pa)
     )::text,'sha256'),'hex'))
 from public.checkout_sessions cs
 join public.payment_intents pi on pi.checkout_session_id=cs.id and pi.business_id=p_business_id
 join lateral (
   select a.* from public.payment_attempts a
   where a.payment_intent_id=pi.id and a.attempt_type='preference'
   order by a.attempt_number desc limit 1
 ) pa on pa.id=p_payment_attempt_id
 cross join lateral (select public.get_mercadopago_payment_authority_base_v2(
   p_business_id,p_environment,p_checkout_session_id,p_customer_id) snapshot) base
 where cs.id=p_checkout_session_id and cs.customer_id=p_customer_id
   and pi.environment=p_environment and base.snapshot is not null;
$$;
revoke all on function public.get_mercadopago_payment_authority_v2(uuid,text,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_mercadopago_payment_authority_v2(uuid,text,uuid,uuid,uuid) to service_role;

-- The pre-provider snapshot is a CAS token, not a caller-selected new identity.
-- Checkout -> intent -> attempt is the same lock order as preparation/retry.
-- Never hold these locks over provider I/O. Return the post-write snapshot so
-- /users/me and the final read can bind the intentional persistence transition.
create function public.record_mercadopago_preference_created_v2(
 p_business_id uuid,p_environment text,p_checkout_session_id uuid,p_customer_id uuid,
 p_payment_attempt_id uuid,p_expected_authority text,
 p_preference_id text,p_init_point text,p_sandbox_init_point text,
 p_response_hash text,p_provider_request_id text
) returns jsonb language plpgsql security invoker
set search_path=pg_catalog,public,pg_temp as $$
declare
 v_snapshot jsonb; v_intent public.payment_intents%rowtype; v_attempt public.payment_attempts%rowtype;
begin
 if p_preference_id is null or length(p_preference_id) not between 1 and 200
   or p_init_point is null or length(p_init_point) not between 1 and 2048
   or p_init_point !~ '^https://(www[.])?mercadopago[.]com[.]ar/'
   or p_response_hash is null or p_response_hash !~ '^[a-f0-9]{64}$'
   or p_expected_authority is null or p_expected_authority !~ '^[a-f0-9]{64}$' then
   raise exception 'respuesta de preferencia invalida' using errcode='22023';
 end if;
 perform 1 from public.checkout_sessions where id=p_checkout_session_id and customer_id=p_customer_id for update;
 if not found then raise exception 'checkout no autorizado' using errcode='42501'; end if;
 select * into v_intent from public.payment_intents where checkout_session_id=p_checkout_session_id for update;
 select * into v_attempt from public.payment_attempts where id=p_payment_attempt_id for update;
 -- Freeze the non-written authority rows while crossing the intentional
 -- persistence transition. Otherwise a token rotation between CAS and the
 -- returned snapshot could silently become the new accepted credential.
 perform 1 from public.businesses where id=p_business_id for share;
 perform 1 from public.business_payment_settings where business_id=p_business_id and provider='mercadopago' for share;
 perform 1 from public.mp_seller_connections where business_id=p_business_id and environment=p_environment for share;
 v_snapshot := public.get_mercadopago_payment_authority_v2(
   p_business_id,p_environment,p_checkout_session_id,p_customer_id,p_payment_attempt_id);
 if v_snapshot is null or v_snapshot->>'authority_version' is distinct from p_expected_authority
   or v_attempt.status not in ('prepared','request_sent','ambiguous','created')
   or v_intent.internal_status not in ('created','preference_creating','preference_created','redirected','ambiguous')
   or v_snapshot#>>'{checkout,status}' not in ('ready_for_payment','redirected','payment_pending')
   or (v_snapshot#>>'{checkout,expires_at}')::timestamptz <= clock_timestamp()
   or v_snapshot#>>'{checkout,reservation_valid}' is distinct from 'true'
   or v_snapshot#>>'{checkout,business_open}' is distinct from 'true'
   or v_snapshot#>>'{settings,enabled}' is distinct from 'true'
   or v_snapshot#>>'{seller,status}' is distinct from 'connected'
   or (v_attempt.preference_id is not null and
     (v_attempt.preference_id is distinct from p_preference_id or v_attempt.init_point is distinct from p_init_point)) then
   raise exception 'autoridad del intento cambio' using errcode='55000';
 end if;
 update public.payment_attempts set preference_id=p_preference_id,init_point=p_init_point,
   sandbox_init_point=p_sandbox_init_point,response_hash=p_response_hash,provider_request_id=p_provider_request_id,
   seller_generation=(v_snapshot#>>'{seller,generation}')::uuid,seller_id=v_snapshot#>>'{seller,seller_id}',status='created'
 where id=p_payment_attempt_id;
 update public.payment_intents set preference_id=p_preference_id,current_payment_attempt_id=p_payment_attempt_id,
   preference_created_at=coalesce(preference_created_at,clock_timestamp()),raw_response_hash=p_response_hash,
   internal_status=case when internal_status in ('created','ambiguous','preference_creating') then 'preference_created' else internal_status end
 where id=v_intent.id;
 update public.checkout_sessions set status=case when status='ready_for_payment' then 'redirected' else status end
 where id=p_checkout_session_id;
 return public.get_mercadopago_payment_authority_v2(
   p_business_id,p_environment,p_checkout_session_id,p_customer_id,p_payment_attempt_id);
end; $$;
revoke all on function public.record_mercadopago_preference_created_v2(uuid,text,uuid,uuid,uuid,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_mercadopago_preference_created_v2(uuid,text,uuid,uuid,uuid,text,text,text,text,text,text) to service_role;

create or replace function public.prepare_mercadopago_preference_v2(
  p_checkout_session_id uuid,
  p_customer_id uuid,
  p_new_attempt boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_session public.checkout_sessions%rowtype;
  v_intent public.payment_intents%rowtype;
  v_settings public.business_payment_settings%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_number integer;
  v_items jsonb;
begin
  select * into v_session from public.checkout_sessions s where s.id = p_checkout_session_id for update;
  if not found or v_session.customer_id <> p_customer_id then
    raise exception 'checkout no autorizado' using errcode = '42501';
  end if;
  if v_session.expires_at <= clock_timestamp() then
    perform public.release_checkout_session_inventory(v_session.id, 'preference_expired', 'expired');
    raise exception 'checkout vencido' using errcode = '55000';
  end if;
  select * into v_intent from public.payment_intents pi where pi.checkout_session_id = v_session.id for update;
  if not found then raise exception 'payment intent inexistente' using errcode = 'P0002'; end if;
  select * into v_settings from public.business_payment_settings s
   where s.business_id = v_session.business_id and s.provider = 'mercadopago' for share;
  if not found or not v_settings.enabled or not v_settings.reserve_stock
    or v_settings.checkout_mode <> 'checkout_pro' or v_settings.currency <> 'ARS'
    or (v_settings.environment = 'production' and v_settings.production_review_status <> 'approved') then
    raise exception 'Mercado Pago no esta habilitado' using errcode = '55000';
  end if;
  if v_session.status in ('completed', 'payment_approved', 'finalizing_order', 'manual_review_required') then
    raise exception 'checkout no admite otra preferencia' using errcode = '55000';
  end if;
  -- Los items de la preferencia tienen que ser lo que se VENDE, no lo que se
  -- reserva. Un combo se reserva como sus componentes —el mostrador arma latas,
  -- no combos— pero se cobra como combo. Listar los componentes a precio de
  -- lista hacia que la suma de los items superara el total autoritativo, y el
  -- armador de la preferencia lanzaba
  -- `Preference items exceed the server-side checkout total`, que el Edge
  -- Function clasificaba como `network_or_timeout`. Ademas el comprador veria
  -- en Checkout Pro un total distinto del que su pedido cobra.
  select coalesce(jsonb_agg(lineas.linea order by lineas.linea ->> 'id'), '[]'::jsonb)
    into v_items
    from (
      select jsonb_build_object(
        'id', c.combo_id,
        'title', c.name,
        'description', 'Combo',
        'quantity', c.quantity,
        'currency_id', 'ARS',
        'unit_price', c.promotional_price
      ) as linea
        from public.checkout_session_combos c
       where c.checkout_session_id = v_session.id
      union all
      -- De cada producto queda lo que NO consume ningun combo: quien suma dos
      -- latas sueltas ademas del combo las paga aparte, a precio de lista.
      select jsonb_build_object(
        'id', i.product_id::text,
        'title', coalesce(i.product_snapshot ->> 'name', 'Producto TABA2'),
        'description', nullif(i.product_snapshot ->> 'presentation', ''),
        'quantity', suelto.quantity,
        'currency_id', 'ARS',
        'unit_price', i.unit_price
      )
        from public.checkout_session_items i
        cross join lateral (
          select i.quantity - coalesce((
            select sum(cc.quantity * c.quantity)
              from public.checkout_session_combos c
              join public.product_combo_components cc on cc.combo_id = c.combo_uuid
             where c.checkout_session_id = v_session.id
               and cc.product_id = i.product_id
          ), 0) as quantity
        ) as suelto
       where i.checkout_session_id = v_session.id
         and suelto.quantity > 0
    ) as lineas;
  select * into v_attempt from public.payment_attempts pa
   where pa.payment_intent_id = v_intent.id and pa.attempt_type = 'preference'
   order by pa.attempt_number desc limit 1 for update;
  if found and not p_new_attempt and v_attempt.status in ('prepared', 'request_sent', 'created', 'ambiguous') then
    return jsonb_build_object(
      'checkout_session_id', v_session.id, 'payment_intent_id', v_intent.id,
      'payment_attempt_id', v_attempt.id, 'attempt_status', v_attempt.status,
      'attempt_number', v_attempt.attempt_number, 'idempotency_key', v_attempt.idempotency_key,
      'preference_id', v_attempt.preference_id, 'init_point', v_attempt.init_point,
      'sandbox_init_point', v_attempt.sandbox_init_point, 'external_reference', v_intent.external_reference,
      'environment', v_intent.environment, 'currency', 'ARS', 'total', v_intent.expected_amount,
      'expires_at', v_session.expires_at, 'items', v_items,
      'allow_offline_payment_methods', v_settings.allow_offline_payment_methods,
      'installments_limit', v_settings.installments_limit
    );
  end if;
  if p_new_attempt then
    if v_intent.internal_status not in ('rejected', 'cancelled', 'expired', 'failed') then
      raise exception 'el pago actual no admite un nuevo intento controlado' using errcode = '55000';
    end if;
    if v_session.status in ('cancelled', 'expired', 'retrying') then
      perform public.reacquire_checkout_session_inventory(v_session.id, 'payment_retry');
      select * into v_session from public.checkout_sessions s where s.id = v_session.id for update;
    end if;
  elsif found and v_attempt.status in ('failed', 'cancelled') then
    raise exception 'solicita un nuevo intento de pago' using errcode = '55000';
  end if;
  if not exists (select 1 from public.inventory_reservations r where r.checkout_session_id = v_session.id and r.status = 'active' and r.expires_at > clock_timestamp()) then
    raise exception 'reserva de stock no valida' using errcode = '55000';
  end if;
  select coalesce(max(pa.attempt_number), 0) + 1 into v_number
    from public.payment_attempts pa where pa.payment_intent_id = v_intent.id and pa.attempt_type = 'preference';
  insert into public.payment_attempts (payment_intent_id, attempt_number, attempt_type, status)
  values (v_intent.id, v_number, 'preference', 'prepared') returning * into v_attempt;
  update public.payment_intents
     set current_payment_attempt_id=v_attempt.id,
         internal_status = case when p_new_attempt or internal_status in ('created', 'ambiguous', 'preference_creating', 'preference_created', 'redirected')
                                then 'preference_creating' else internal_status end
   where id = v_intent.id;
  return jsonb_build_object(
    'checkout_session_id', v_session.id, 'payment_intent_id', v_intent.id,
    'payment_attempt_id', v_attempt.id, 'attempt_status', v_attempt.status,
    'attempt_number', v_attempt.attempt_number, 'idempotency_key', v_attempt.idempotency_key,
    'preference_id', null, 'init_point', null, 'sandbox_init_point', null,
    'external_reference', v_intent.external_reference, 'environment', v_intent.environment,
    'currency', 'ARS', 'total', v_intent.expected_amount, 'expires_at', v_session.expires_at,
    'items', v_items, 'allow_offline_payment_methods', v_settings.allow_offline_payment_methods,
    'installments_limit', v_settings.installments_limit
  );
end;
$$;

revoke all on function public.prepare_mercadopago_preference_v2(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.prepare_mercadopago_preference_v2(uuid,uuid,boolean) to service_role;

-- Preserve the existing monotonic state machine, adding only a retry whose new
-- explicit pointer names a later prepared attempt of this same intent.
create or replace function public.prevent_payment_intent_status_regression()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,public,pg_temp as $$
begin
 new.revision := old.revision;
 if new is distinct from old then
   if public.payment_internal_status_rank(new.internal_status) < public.payment_internal_status_rank(old.internal_status)
     and not (old.internal_status='security_review_required' and
       new.internal_status in ('completed','approved_order_pending','refunded','partially_refunded','charged_back'))
     and not (old.internal_status in ('rejected','cancelled','expired','failed')
       and new.internal_status='preference_creating'
       and new.current_payment_attempt_id is distinct from old.current_payment_attempt_id
       and exists(select 1 from public.payment_attempts a
         where a.id=new.current_payment_attempt_id and a.payment_intent_id=new.id
           and a.attempt_type='preference' and a.status='prepared' and a.attempt_number>1
           and not exists(select 1 from public.payment_attempts later
             where later.payment_intent_id=new.id and later.attempt_type='preference' and later.attempt_number>a.attempt_number))) then
     raise exception 'payment intent status regression: % -> %',old.internal_status,new.internal_status using errcode='22023';
   end if;
   new.revision := old.revision+1;
 end if;
 return new;
end; $$;

create or replace function public.prepare_payment_refund_v2(
  p_payment_intent_id uuid, p_amount numeric, p_idempotency_key uuid, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_intent public.payment_intents%rowtype;
  v_refund public.payment_refunds%rowtype;
  v_remaining numeric(12, 2);
  v_amount numeric(12, 2);
  v_refundable_without_order boolean;
begin
  if v_actor is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  select * into v_intent
    from public.payment_intents pi
   where pi.id = p_payment_intent_id
   for update;
  if not found or not public.has_business_role(v_intent.business_id, array['owner', 'admin']) then
    raise exception 'reembolso no autorizado' using errcode = '42501';
  end if;
  v_refundable_without_order := v_intent.order_id is null
    and v_intent.internal_status = 'security_review_required'
    and v_intent.security_review_reason in ('approved_after_reservation_expired', 'finalization_without_active_reservation');
  if v_intent.provider_payment_id is null
    or (
      not v_refundable_without_order
      and (v_intent.order_id is null or v_intent.internal_status not in ('completed', 'partially_refunded'))
    )
    or (v_refundable_without_order is false and v_intent.internal_status not in ('completed', 'partially_refunded')) then
    raise exception 'pago no reembolsable en su estado actual' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.payment_disputes d
     where d.payment_intent_id = v_intent.id
       and d.dispute_type = 'chargeback'
       and d.resolved_at is null
  ) then
    raise exception 'reembolso bloqueado por contracargo abierto' using errcode = '55000';
  end if;
  select * into v_refund
    from public.payment_refunds r
   where r.idempotency_key = p_idempotency_key
   for update;
  if found then
    if v_refund.payment_intent_id <> v_intent.id then
      raise exception 'idempotency key pertenece a otro reembolso' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'refund_id', v_refund.id,
      'provider_payment_id', v_intent.provider_payment_id,
      'amount', v_refund.amount,
      'idempotency_key', v_refund.idempotency_key,
      'idempotent', true,
      'reconciliation_required', v_refund.status = 'ambiguous'
    );
  end if;
  -- Never replace an ambiguous outbound financial request with a new UUID.
  select * into v_refund
    from public.payment_refunds r
   where r.payment_intent_id = v_intent.id
     and r.status in ('requested', 'processing', 'ambiguous')
   order by r.requested_at asc
   limit 1
   for update;
  if found then
    return jsonb_build_object(
      'refund_id', v_refund.id,
      'provider_payment_id', v_intent.provider_payment_id,
      'amount', v_refund.amount,
      'idempotency_key', v_refund.idempotency_key,
      'idempotent', true,
      'reconciliation_required', true
    );
  end if;
  v_remaining := coalesce(v_intent.paid_amount, v_intent.expected_amount) - v_intent.refunded_amount;
  v_amount := coalesce(p_amount, v_remaining);
  if v_amount <= 0 or v_amount > v_remaining then
    raise exception 'importe de reembolso invalido' using errcode = '22023';
  end if;
  insert into public.payment_refunds (
    payment_intent_id, order_id, idempotency_key, amount, requested_by, reason
  ) values (
    v_intent.id, v_intent.order_id, p_idempotency_key, v_amount, v_actor,
    nullif(left(btrim(coalesce(p_reason, '')), 300), '')
  ) returning * into v_refund;
  return jsonb_build_object(
    'refund_id', v_refund.id,
    'provider_payment_id', v_intent.provider_payment_id,
    'amount', v_refund.amount,
    'idempotency_key', v_refund.idempotency_key,
    'full_refund', v_refund.amount = coalesce(v_intent.paid_amount, v_intent.expected_amount),
    'idempotent', false
  );
end;
$$;
revoke all on function public.prepare_payment_refund_v2(uuid,numeric,uuid,text) from public,anon;
grant execute on function public.prepare_payment_refund_v2(uuid,numeric,uuid,text) to authenticated;
create or replace function public.claim_payment_outbox_v2(
  p_owner text, p_limit integer default 20, p_lease_seconds integer default 90
)
returns setof public.payment_outbox
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if nullif(btrim(p_owner), '') is null then raise exception 'owner requerido' using errcode = '22023'; end if;
  return query
  with candidate as (
    select o.id
      from public.payment_outbox o
     where (
       (o.status in ('pending', 'retry_wait') and o.next_attempt_at <= clock_timestamp())
       or (o.status in ('claimed', 'processing') and coalesce(o.lease_expires_at, '-infinity'::timestamptz) < clock_timestamp())
     )
     order by o.next_attempt_at, o.created_at
     limit greatest(1, least(coalesce(p_limit, 20), 100))
     for update skip locked
  )
  update public.payment_outbox o
     set status = 'claimed', owner = left(btrim(p_owner), 200),
         lease_expires_at = clock_timestamp() + make_interval(secs => greatest(15, least(coalesce(p_lease_seconds, 90), 600))),
         attempts = o.attempts + 1
    from candidate c
   where o.id = c.id
  returning o.*;
end;
$$;
revoke all on function public.claim_payment_outbox_v2(text,integer,integer) from public,anon,authenticated;
grant execute on function public.claim_payment_outbox_v2(text,integer,integer) to service_role;
