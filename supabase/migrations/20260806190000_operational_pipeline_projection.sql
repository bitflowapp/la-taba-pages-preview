-- Un solo vocabulario para todo el circuito, del checkout a la entrega.
--
-- Hasta acá el estado vivía repartido en tres tablas con tres vocabularios:
-- `checkout_sessions.status` (created/validating/ready_for_payment/redirected/
-- payment_pending/payment_approved/finalizing_order/completed/
-- manual_review_required/expired), `payment_intents.internal_status` y
-- `orders.status`. Consecuencia medida: `pending`, `paid` y `expired` no eran
-- observables desde la operación. Un pago aprobado cuya finalización todavía no
-- corrió (webhook tardío, reintento del worker) no aparecía en ningún lado: el
-- negocio ya tenía la plata y en pantalla no había nada.
--
-- Esta proyección no reemplaza ningún estado ni cambia una sola transición:
-- traduce. Los estados operativos siguen siendo los de `orders.status` y los
-- guardas siguen siendo `change_order_status` / `transition_order`.
--
-- Vocabulario canónico (14):
--   pending, paid                      -- checkout todavía sin pedido
--   received, accepted, preparing, ready, assigned, picked_up, on_the_way,
--   arrived, delivered                 -- pedido en curso
--   cancelled, rejected, expired       -- cierres

create or replace function public.order_pipeline_state(p_order_status text)
returns text
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select case public.normalize_order_status_vocabulary(p_order_status)
    when 'draft' then 'received'
    when 'submitted' then 'received'
    when 'accepted' then 'accepted'
    when 'preparing' then 'preparing'
    when 'ready' then 'ready'
    when 'assigned' then 'assigned'
    when 'picked_up' then 'picked_up'
    when 'on_the_way' then 'on_the_way'
    when 'arrived' then 'arrived'
    when 'delivered' then 'delivered'
    when 'cancelled' then 'cancelled'
    when 'rejected' then 'rejected'
    else null
  end;
$$;

create or replace function public.checkout_pipeline_state(
  p_session_status text,
  p_expires_at timestamptz
)
returns text
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select case lower(btrim(coalesce(p_session_status, '')))
    when 'expired' then 'expired'
    when 'cancelled' then 'cancelled'
    when 'payment_approved' then 'paid'
    when 'finalizing_order' then 'paid'
    when 'completed' then 'received'
    else case
      -- Un checkout vencido es `expired` desde el instante en que vence, no
      -- desde que el barrido lo alcanza. La verdad no espera al cron.
      when p_expires_at is not null and p_expires_at <= clock_timestamp() then 'expired'
      else 'pending'
    end
  end;
$$;

-- ===== Lectura operativa unificada =====
-- Devuelve, en un solo vocabulario, los checkouts que todavía no son pedido y
-- los pedidos existentes. Por defecto excluye QA: la operación real es la que
-- se mira todos los días.
create or replace function public.list_operational_pipeline(
  p_business_id uuid,
  p_include_qa boolean default false
)
returns table (
  kind text,
  reference_id uuid,
  public_code text,
  pipeline_state text,
  origin text,
  payment_method text,
  delivery_mode text,
  total numeric,
  customer_name text,
  needs_manual_review boolean,
  revision bigint,
  occurred_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  -- La unión va envuelta: `order by` no puede resolver los nombres de los
  -- parámetros de salida de una función `returns table`.
  select
    pipeline.kind,
    pipeline.reference_id,
    pipeline.public_code,
    pipeline.pipeline_state,
    pipeline.origin,
    pipeline.payment_method,
    pipeline.delivery_mode,
    pipeline.total,
    pipeline.customer_name,
    pipeline.needs_manual_review,
    pipeline.revision,
    pipeline.occurred_at
  from (
    select
      'order'::text as kind,
      o.id as reference_id,
      o.public_code::text as public_code,
      public.order_pipeline_state(o.status) as pipeline_state,
      o.origin::text as origin,
      o.payment_method::text as payment_method,
      o.delivery_mode::text as delivery_mode,
      o.total as total,
      o.customer_name::text as customer_name,
      false as needs_manual_review,
      o.revision as revision,
      o.created_at as occurred_at
    from public.orders o
    where o.business_id = p_business_id
      and public.has_business_role(p_business_id, array['owner', 'admin', 'staff'])
      and (coalesce(p_include_qa, false) or o.origin = 'production')

    union all

    select
      'checkout'::text,
      s.id,
      null::text,
      public.checkout_pipeline_state(s.status, s.expires_at),
      s.origin::text,
      'mercadopago'::text,
      s.fulfillment_type::text,
      s.total,
      nullif(btrim(coalesce(s.contact_snapshot ->> 'name', '')), '')::text,
      s.status = 'manual_review_required',
      s.revision,
      s.created_at
    from public.checkout_sessions s
    where s.business_id = p_business_id
      and public.has_business_role(p_business_id, array['owner', 'admin', 'staff'])
      and s.completed_order_id is null
      and (coalesce(p_include_qa, false) or s.origin = 'production')
  ) as pipeline
  order by pipeline.occurred_at desc
  limit 200;
$$;

-- ===== Cierre coherente: un checkout pago nunca queda sin pedido en silencio =====
-- Si un checkout quedó `paid` sin materializar el pedido más allá del margen de
-- reintento del worker, es dinero cobrado sin operación. Tiene que gritar.
create or replace function public.list_unfinalized_paid_checkouts()
returns table (
  severity text,
  checkout_session_id uuid,
  pipeline_state text,
  total numeric,
  stalled_for interval,
  action text
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select
    case when s.updated_at < clock_timestamp() - interval '15 minutes' then 'critical' else 'high' end,
    s.id,
    public.checkout_pipeline_state(s.status, s.expires_at),
    s.total,
    clock_timestamp() - s.updated_at,
    'run_finalize_paid_checkout_session_or_inspect_payment_outbox'
  from public.checkout_sessions s
  where s.completed_order_id is null
    and (
      s.status in ('payment_approved', 'finalizing_order')
      or exists (
        select 1
          from public.payment_intents pi
         where pi.checkout_session_id = s.id
           and pi.provider_status = 'approved'
           and pi.internal_status in ('approved_order_pending', 'approved')
      )
    )
    and s.updated_at < clock_timestamp() - interval '3 minutes'
  order by s.updated_at;
$$;

revoke all on function public.list_operational_pipeline(uuid, boolean) from public, anon;
grant execute on function public.list_operational_pipeline(uuid, boolean) to authenticated, service_role;
revoke all on function public.list_unfinalized_paid_checkouts() from public, anon, authenticated;
grant execute on function public.list_unfinalized_paid_checkouts() to service_role;

comment on function public.order_pipeline_state(text) is
  'Traduce orders.status al vocabulario canónico del circuito; total sobre orders_status_check.';
comment on function public.checkout_pipeline_state(text, timestamptz) is
  'Traduce un checkout sin pedido a pending/paid/expired/cancelled/received.';
comment on function public.list_operational_pipeline(uuid, boolean) is
  'Circuito completo en un vocabulario: checkouts sin pedido y pedidos. Excluye QA salvo pedido explícito.';
comment on function public.list_unfinalized_paid_checkouts() is
  'Pagos verificados que no llegaron a pedido: dinero cobrado sin operación.';
