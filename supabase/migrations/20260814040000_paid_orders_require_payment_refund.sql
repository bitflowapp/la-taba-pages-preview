-- A Mercado Pago order exists only after an approved payment has been
-- finalized. Generic order cancellation must never be a substitute for the
-- payment refund workflow. This is enforced at the RPC boundary so alternate
-- clients cannot bypass the panel guard.

create or replace function public.order_payment_is_financially_reversed(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
  select
    exists (
      select 1
        from public.payment_intents pi
       where pi.order_id = p_order_id
         and (
           pi.internal_status = 'charged_back'
           or (
             pi.internal_status = 'refunded'
             and coalesce(pi.refunded_amount, 0) >= coalesce(pi.paid_amount, pi.expected_amount)
           )
         )
         and coalesce(pi.paid_amount, pi.expected_amount) > 0
    )
    and not exists (
      select 1
        from public.payment_intents pi
       where pi.order_id = p_order_id
         and (
           pi.internal_status not in ('refunded', 'charged_back', 'rejected', 'cancelled', 'expired', 'failed')
           or (
             pi.internal_status = 'refunded'
             and coalesce(pi.refunded_amount, 0) < coalesce(pi.paid_amount, pi.expected_amount)
           )
         )
    );
$$;

create or replace function public.prevent_paid_order_generic_cancellation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
begin
  if public.order_payment_is_financially_reversed(old.id)
     and public.normalize_order_status_vocabulary(old.status) not in ('cancelled', 'rejected', 'delivered')
     and public.normalize_order_status_vocabulary(new.status) not in ('cancelled', 'rejected') then
    raise exception 'pago revertido: el pedido solo admite cierre operativo'
      using errcode = '55000';
  end if;

  if public.normalize_order_status_vocabulary(new.status) in ('cancelled', 'rejected')
     and public.normalize_order_status_vocabulary(old.status) not in ('cancelled', 'rejected')
     and (
       lower(btrim(coalesce(old.payment_method, ''))) = 'mercadopago'
       or exists (select 1 from public.payment_intents pi where pi.order_id = old.id)
     )
     and not public.order_payment_is_financially_reversed(old.id) then
    raise exception 'pedido cobrado por Mercado Pago: gestionar reembolso desde Pagos'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_prevent_paid_generic_cancellation on public.orders;
create trigger orders_prevent_paid_generic_cancellation
before update of status on public.orders
for each row execute function public.prevent_paid_order_generic_cancellation();

create or replace function public.cancel_order(
  p_order_id uuid,
  p_expected_revision bigint,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $cancel$
declare
  v_order public.orders%rowtype;
  v_existing public.business_command_receipts%rowtype;
  v_hash text;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 300 then raise exception 'motivo de cancelacion requerido' using errcode = '22023'; end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9:_-]{8,128}$' then raise exception 'idempotency_key invalida' using errcode = '22023'; end if;

  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'pedido inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_order.business_id, array['owner', 'admin', 'staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;

  if lower(btrim(coalesce(v_order.payment_method, ''))) = 'mercadopago'
     or exists (
       select 1 from public.payment_intents pi
        where pi.order_id = v_order.id
          and pi.internal_status in (
            'approved', 'approved_order_pending', 'completed',
            'partially_refunded', 'refunded', 'security_review_required'
          )
     ) then
    if not public.order_payment_is_financially_reversed(v_order.id) then
    raise exception 'pedido cobrado por Mercado Pago: gestionar reembolso antes de cancelar'
      using errcode = '55000';
    end if;
  end if;

  v_hash := public.business_command_request_hash('cancel_order', p_order_id, jsonb_build_object('expected_revision', p_expected_revision, 'reason', btrim(p_reason)));
  select r.* into v_existing from public.business_command_receipts r where r.business_id = v_order.business_id and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505'; end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;

  v_result := public.transition_order(p_order_id, p_expected_revision, 'canceled');
  insert into public.order_events(order_id, business_id, actor_user_id, actor_role, event_type, type, message, metadata)
  values (p_order_id, v_order.business_id, auth.uid(), 'business', 'business_cancel_reason', 'business_cancel_reason', 'Cancelacion registrada.', jsonb_build_object('reason', btrim(p_reason)));
  insert into public.business_command_receipts(business_id, order_id, actor_user_id, command_type, idempotency_key, request_hash, result)
  values (v_order.business_id, p_order_id, auth.uid(), 'cancel_order', p_idempotency_key, v_hash, v_result);
  return v_result || jsonb_build_object('idempotent_replay', false);
end;
$cancel$;

revoke execute on function public.cancel_order(uuid, bigint, text, text) from public, anon;
grant execute on function public.cancel_order(uuid, bigint, text, text) to authenticated;

-- These lower-level signatures were superseded by the idempotent command RPC.
-- Keeping them callable would allow a client to choose a different function
-- name. The 4-argument transition remains the app surface and is covered by
-- the trigger for any canceled/cancelled spelling.
revoke execute on function public.change_order_status(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.transition_order(uuid, bigint, text) from public, anon, authenticated;
revoke execute on function public.order_payment_is_financially_reversed(uuid) from public, anon, authenticated;
revoke execute on function public.prevent_paid_order_generic_cancellation() from public, anon, authenticated;

select pg_notify('pgrst', 'reload schema');
