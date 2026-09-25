-- Registro explícito de cobros manuales para pedidos online del piloto.
-- No crea payment_intents ni simula un evento de Mercado Pago.
alter table public.orders add column if not exists manual_payment_status text;
alter table public.orders add column if not exists manual_payment_method text;
alter table public.orders add column if not exists manual_payment_confirmed_at timestamptz;
alter table public.orders add column if not exists manual_payment_confirmed_by uuid references auth.users(id) on delete set null;
alter table public.orders add column if not exists manual_payment_reversed_at timestamptz;
alter table public.orders add column if not exists manual_payment_reversed_by uuid references auth.users(id) on delete set null;
alter table public.orders add column if not exists manual_payment_reversal_reason text;

alter table public.orders add constraint orders_manual_payment_consistent check (
  (manual_payment_status is null or (payment_method in ('cash', 'coordinate')
    and manual_payment_status in ('pending', 'confirmed', 'reversed')))
  and (manual_payment_status not in ('confirmed', 'reversed') or
    (manual_payment_method in ('cash', 'transfer') and manual_payment_confirmed_at is not null))
  and (manual_payment_status is distinct from 'reversed' or
    (manual_payment_reversed_at is not null and manual_payment_reversal_reason is not null))
  and (manual_payment_reversed_at is null or manual_payment_status = 'reversed')
);

create or replace function public.set_initial_manual_order_payment()
returns trigger language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.payment_method in ('cash', 'coordinate') then
    new.manual_payment_status := 'pending';
  else
    new.manual_payment_status := null;
  end if;
  return new;
end;
$$;
create trigger orders_initial_manual_payment
before insert on public.orders for each row
execute function public.set_initial_manual_order_payment();

create or replace function public.prevent_cancellation_of_collected_manual_payment()
returns trigger language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.status in ('canceled', 'cancelled', 'rejected')
     and old.status is distinct from new.status
     and old.manual_payment_status = 'confirmed' then
    raise exception 'Devolvé y registrá el cobro manual antes de cancelar el pedido'
      using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger orders_block_paid_manual_cancellation
before update of status on public.orders for each row
execute function public.prevent_cancellation_of_collected_manual_payment();

create or replace function public.confirm_manual_order_payment(
  p_order_id uuid, p_expected_revision bigint, p_actual_method text, p_idempotency_key text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_receipt public.business_command_receipts%rowtype;
  v_hash text;
  v_result jsonb;
  v_method text := lower(btrim(coalesce(p_actual_method, '')));
  v_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null then raise exception 'Autenticación requerida' using errcode = '42501'; end if;
  if p_order_id is null or p_expected_revision is null or p_expected_revision < 1
     or btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9:_-]{8,128}$' then
    raise exception 'Comando de cobro inválido' using errcode = '22023';
  end if;
  if v_method not in ('cash', 'transfer') then
    raise exception 'Medio de cobro manual inválido' using errcode = '22023';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Pedido inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_order.business_id, array['owner','admin','staff']) then
    raise exception 'Operador no autorizado' using errcode = '42501';
  end if;
  if v_order.payment_method not in ('cash','coordinate')
     or (v_order.payment_method = 'cash' and v_method <> 'cash') then
    raise exception 'El pedido no admite este cobro manual' using errcode = '22023';
  end if;
  v_hash := public.business_command_request_hash('confirm_manual_order_payment', p_order_id,
    jsonb_build_object('expected_revision',p_expected_revision,'actual_method',v_method));
  select * into v_receipt from public.business_command_receipts
   where business_id = v_order.business_id and idempotency_key = p_idempotency_key;
  if found then
    if v_receipt.request_hash <> v_hash then
      raise exception 'Clave de idempotencia reutilizada con otro comando' using errcode = '23505';
    end if;
    return v_receipt.result || jsonb_build_object('idempotent_replay',true,
      'manual_payment_status',v_order.manual_payment_status,'revision',v_order.revision);
  end if;
  if v_order.manual_payment_status = 'reversed' then
    raise exception 'El cobro fue devuelto y no puede confirmarse otra vez' using errcode = '55000';
  end if;
  if v_order.manual_payment_status = 'confirmed' then
    return jsonb_build_object('ok',true,'code','already_confirmed','idempotent_no_op',true,
      'manual_payment_status','confirmed','revision',v_order.revision);
  end if;
  if v_order.status in ('canceled','cancelled','rejected') then
    raise exception 'Pedido terminal sin cobro permitido' using errcode = '55000';
  end if;
  if v_order.revision <> p_expected_revision then
    raise exception 'Revisión de pedido obsoleta' using errcode = '40001';
  end if;
  if v_order.total is null or v_order.total <= 0 then
    raise exception 'Monto del pedido inválido' using errcode = '22023';
  end if;
  update public.orders set manual_payment_status = 'confirmed', manual_payment_method = v_method,
    manual_payment_confirmed_at = v_now, manual_payment_confirmed_by = auth.uid()
   where id = p_order_id returning * into v_order;
  insert into public.order_events(order_id,business_id,actor_user_id,actor_role,
    event_type,type,message,metadata)
  values(p_order_id,v_order.business_id,auth.uid(),'business','order.manual_payment_confirmed',
    'order.manual_payment_confirmed','Cobro manual confirmado por el negocio',
    jsonb_build_object('actual_method',v_method,'amount',v_order.total));
  v_result := jsonb_build_object('ok',true,'code','confirmed','manual_payment_status','confirmed',
    'revision',v_order.revision,'amount',v_order.total,'actual_method',v_method);
  insert into public.business_command_receipts(business_id,order_id,actor_user_id,
    command_type,idempotency_key,request_hash,result)
  values(v_order.business_id,p_order_id,auth.uid(),'confirm_manual_order_payment',
    p_idempotency_key,v_hash,v_result);
  return v_result;
end;
$$;

create or replace function public.reverse_manual_order_payment(
  p_order_id uuid, p_expected_revision bigint, p_reason text, p_idempotency_key text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_receipt public.business_command_receipts%rowtype;
  v_hash text;
  v_result jsonb;
  v_reason text := btrim(coalesce(p_reason,''));
  v_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null then raise exception 'Autenticación requerida' using errcode = '42501'; end if;
  if p_order_id is null or p_expected_revision is null or p_expected_revision < 1
     or char_length(v_reason) not between 8 and 200
     or btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9:_-]{8,128}$' then
    raise exception 'Comando de devolución inválido' using errcode = '22023';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Pedido inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_order.business_id, array['owner','admin']) then
    raise exception 'Sólo dueño o administrador puede registrar una devolución manual'
      using errcode = '42501';
  end if;
  v_hash := public.business_command_request_hash('reverse_manual_order_payment',p_order_id,
    jsonb_build_object('expected_revision',p_expected_revision,'reason',v_reason));
  select * into v_receipt from public.business_command_receipts
   where business_id = v_order.business_id and idempotency_key = p_idempotency_key;
  if found then
    if v_receipt.request_hash <> v_hash then
      raise exception 'Clave de idempotencia reutilizada con otro comando' using errcode = '23505';
    end if;
    return v_receipt.result || jsonb_build_object('idempotent_replay',true,
      'manual_payment_status',v_order.manual_payment_status,'revision',v_order.revision);
  end if;
  if v_order.payment_method not in ('cash','coordinate') then
    raise exception 'El pedido no tiene cobro manual' using errcode = '22023';
  end if;
  if v_order.manual_payment_status = 'reversed' then
    return jsonb_build_object('ok',true,'code','already_reversed','idempotent_no_op',true,
      'manual_payment_status','reversed','revision',v_order.revision);
  end if;
  if v_order.manual_payment_status is distinct from 'confirmed' then
    raise exception 'No existe un cobro manual confirmado para devolver' using errcode = '55000';
  end if;
  if v_order.revision <> p_expected_revision then
    raise exception 'Revisión de pedido obsoleta' using errcode = '40001';
  end if;
  update public.orders set manual_payment_status = 'reversed',
    manual_payment_reversed_at = v_now, manual_payment_reversed_by = auth.uid(),
    manual_payment_reversal_reason = v_reason
   where id = p_order_id returning * into v_order;
  insert into public.order_events(order_id,business_id,actor_user_id,actor_role,
    event_type,type,message,metadata)
  values(p_order_id,v_order.business_id,auth.uid(),'business','order.manual_payment_reversed',
    'order.manual_payment_reversed','Devolución manual registrada por el negocio',
    jsonb_build_object('actual_method',v_order.manual_payment_method,'amount',v_order.total));
  v_result := jsonb_build_object('ok',true,'code','reversed','manual_payment_status','reversed',
    'revision',v_order.revision,'amount',v_order.total);
  insert into public.business_command_receipts(business_id,order_id,actor_user_id,
    command_type,idempotency_key,request_hash,result)
  values(v_order.business_id,p_order_id,auth.uid(),'reverse_manual_order_payment',
    p_idempotency_key,v_hash,v_result);
  return v_result;
end;
$$;

revoke all on function public.set_initial_manual_order_payment() from public, anon, authenticated;
revoke all on function public.prevent_cancellation_of_collected_manual_payment() from public, anon, authenticated;
revoke all on function public.confirm_manual_order_payment(uuid,bigint,text,text) from public, anon;
revoke all on function public.reverse_manual_order_payment(uuid,bigint,text,text) from public, anon;
grant execute on function public.confirm_manual_order_payment(uuid,bigint,text,text) to authenticated;
grant execute on function public.reverse_manual_order_payment(uuid,bigint,text,text) to authenticated;
