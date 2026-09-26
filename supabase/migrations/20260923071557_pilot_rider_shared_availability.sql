-- Presencia Rider autoritativa, opt-in por comercio para no romper APKs históricas.
alter table public.businesses add column if not exists rider_presence_required boolean not null default false;

create table public.rider_availability (
  business_id uuid not null references public.businesses(id) on delete cascade,
  rider_user_id uuid not null references auth.users(id) on delete cascade,
  available boolean not null default false,
  version bigint not null default 0 check (version >= 0),
  last_seen_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (business_id,rider_user_id)
);
alter table public.rider_availability enable row level security;
revoke all on public.rider_availability from public, anon, authenticated;

create table public.rider_availability_operations (
  business_id uuid not null,
  rider_user_id uuid not null,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9:_-]{8,128}$'),
  expected_version bigint not null,
  requested_available boolean not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (business_id,rider_user_id,idempotency_key),
  foreign key (business_id,rider_user_id)
    references public.rider_availability(business_id,rider_user_id) on delete cascade
);
alter table public.rider_availability_operations enable row level security;
revoke all on public.rider_availability_operations from public, anon, authenticated;

create or replace function public.rider_availability_effective(p_business_id uuid,p_rider_user_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce((select ra.available and ra.last_seen_at >= now() - interval '90 seconds'
    from public.rider_availability ra
    where ra.business_id = p_business_id and ra.rider_user_id = p_rider_user_id),false);
$$;
revoke all on function public.rider_availability_effective(uuid,uuid) from public, anon, authenticated;

create or replace function public.set_rider_availability(
  p_business_id uuid,p_available boolean,p_expected_version bigint,p_idempotency_key text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.rider_availability%rowtype;
  v_previous public.rider_availability_operations%rowtype;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
begin
  if auth.uid() is null or p_business_id is null then
    raise exception 'Identidad Rider requerida' using errcode='42501';
  end if;
  if p_available is null or p_expected_version is null or p_expected_version < 0
     or btrim(coalesce(p_idempotency_key,'')) !~ '^[A-Za-z0-9:_-]{8,128}$' then
    raise exception 'Cambio de disponibilidad inválido' using errcode='22023';
  end if;
  perform public.rider_require_active_membership(p_business_id);
  perform public.lock_rider_capacity(auth.uid());
  insert into public.rider_availability(business_id,rider_user_id)
  values(p_business_id,auth.uid()) on conflict do nothing;
  select * into v_row from public.rider_availability
    where business_id=p_business_id and rider_user_id=auth.uid() for update;
  select * into v_previous from public.rider_availability_operations
    where business_id=p_business_id and rider_user_id=auth.uid()
      and idempotency_key=p_idempotency_key;
  if found then
    if v_previous.expected_version <> p_expected_version
       or v_previous.requested_available is distinct from p_available then
      raise exception 'Clave de idempotencia reutilizada' using errcode='23505';
    end if;
    return v_previous.result || jsonb_build_object('idempotent_replay',true,
      'available',public.rider_availability_effective(p_business_id,auth.uid()),
      'version',v_row.version);
  end if;
  if v_row.version <> p_expected_version then
    return jsonb_build_object('ok',false,'code','stale_availability','version',v_row.version,
      'available',public.rider_availability_effective(p_business_id,auth.uid()));
  end if;
  if v_row.available is not distinct from p_available
     and (not p_available or public.rider_availability_effective(p_business_id,auth.uid())) then
    return jsonb_build_object('ok',true,'code','unchanged','idempotent_no_op',true,
      'version',v_row.version,'available',p_available);
  end if;
  update public.rider_availability set available=p_available,version=version+1,
    last_seen_at=case when p_available then v_now else null end,updated_at=v_now
  where business_id=p_business_id and rider_user_id=auth.uid() returning * into v_row;
  v_result := jsonb_build_object('ok',true,'code','updated','version',v_row.version,
    'available',v_row.available,'idempotent_no_op',false);
  insert into public.rider_availability_operations
    (business_id,rider_user_id,idempotency_key,expected_version,requested_available,result)
  values(p_business_id,auth.uid(),p_idempotency_key,p_expected_version,p_available,v_result);
  return v_result;
end;
$$;

create or replace function public.heartbeat_rider_availability(p_business_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare v_row public.rider_availability%rowtype;
begin
  if auth.uid() is null then raise exception 'Identidad Rider requerida' using errcode='42501'; end if;
  perform public.rider_require_active_membership(p_business_id);
  update public.rider_availability set last_seen_at=clock_timestamp()
  where business_id=p_business_id and rider_user_id=auth.uid() and available=true
  returning * into v_row;
  return jsonb_build_object('ok',found,'available',found,'version',coalesce(v_row.version,0));
end;
$$;

create or replace function public.list_business_rider_availability(p_business_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare v_rows jsonb;
begin
  if auth.uid() is null or p_business_id is null
     or not public.has_business_role(p_business_id,array['owner','admin','staff']) then
    raise exception 'Rol de negocio requerido' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('rider_user_id',bm.user_id,
    'available',case when b.rider_presence_required then
      public.rider_availability_effective(p_business_id,bm.user_id) else true end,
    'version',coalesce(ra.version,0),'last_seen_at',ra.last_seen_at)
    order by bm.user_id),'[]'::jsonb) into v_rows
  from public.business_members bm
  join public.businesses b on b.id=bm.business_id
  left join public.rider_availability ra
    on ra.business_id=bm.business_id and ra.rider_user_id=bm.user_id
  where bm.business_id=p_business_id and bm.role='rider' and bm.is_active=true;
  return jsonb_build_object('required',(select rider_presence_required from public.businesses where id=p_business_id),
    'riders',v_rows);
end;
$$;

create or replace function public.set_business_rider_presence_policy(p_business_id uuid,p_required boolean)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare v_old boolean;
begin
  if auth.uid() is null or p_business_id is null or p_required is null
     or not public.has_business_role(p_business_id,array['owner','admin']) then
    raise exception 'Dueño o administrador requerido' using errcode='42501';
  end if;
  select rider_presence_required into v_old from public.businesses where id=p_business_id for update;
  if not found then raise exception 'Negocio inexistente' using errcode='P0002'; end if;
  if v_old is distinct from p_required then
    update public.businesses set rider_presence_required=p_required where id=p_business_id;
  end if;
  return jsonb_build_object('ok',true,'required',p_required,'changed',v_old is distinct from p_required);
end;
$$;

-- Conserva la implementación auditada; los wrappers sólo añaden el gate.
alter function public.get_rider_delivery_board() rename to get_rider_delivery_board_pre_presence;
revoke all on function public.get_rider_delivery_board_pre_presence() from public, anon, authenticated;
create function public.get_rider_delivery_board()
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare v_board jsonb;v_business_id uuid;v_required boolean;v_version bigint;
begin
  v_board := public.get_rider_delivery_board_pre_presence();
  select bm.business_id into v_business_id from public.business_members bm
    where bm.user_id=auth.uid() and bm.role='rider' and bm.is_active=true
    order by bm.created_at limit 1;
  select b.rider_presence_required into v_required from public.businesses b where b.id=v_business_id;
  select coalesce(ra.version,0) into v_version from public.rider_availability ra
    where ra.business_id=v_business_id and ra.rider_user_id=auth.uid();
  return v_board || jsonb_build_object('available',public.rider_availability_effective(v_business_id,auth.uid()),
    'availability_version',coalesce(v_version,0),'availability_required',coalesce(v_required,false));
end;
$$;

alter function public.offer_order_to_rider(uuid,text,uuid,uuid) rename to offer_order_to_rider_pre_presence;
revoke all on function public.offer_order_to_rider_pre_presence(uuid,text,uuid,uuid) from public, anon, authenticated;
create function public.offer_order_to_rider(p_order_id uuid,p_expected_status text,
  p_expected_rider_user_id uuid,p_new_rider_user_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare v_business_id uuid;v_required boolean;
begin
  if auth.uid() is null then raise exception 'Autenticación requerida' using errcode='42501'; end if;
  select o.business_id,b.rider_presence_required into v_business_id,v_required
    from public.orders o join public.businesses b on b.id=o.business_id where o.id=p_order_id;
  if v_business_id is null then raise exception 'Pedido inexistente' using errcode='P0002'; end if;
  if not public.has_business_role(v_business_id,array['owner','admin','staff']) then
    raise exception 'Rol de negocio requerido' using errcode='42501';
  end if;
  if p_new_rider_user_id is null then
    return public.offer_order_to_rider_pre_presence(p_order_id,p_expected_status,
      p_expected_rider_user_id,p_new_rider_user_id);
  end if;
  if v_required then
    perform public.lock_rider_capacity(p_new_rider_user_id);
    if not public.rider_availability_effective(v_business_id,p_new_rider_user_id) then
      return jsonb_build_object('ok',false,'code','rider_unavailable');
    end if;
  end if;
  return public.offer_order_to_rider_pre_presence(p_order_id,p_expected_status,
    p_expected_rider_user_id,p_new_rider_user_id);
end;
$$;

alter function public.accept_rider_order_offer(uuid,bigint,text) rename to accept_rider_order_offer_pre_presence;
revoke all on function public.accept_rider_order_offer_pre_presence(uuid,bigint,text) from public, anon, authenticated;
create function public.accept_rider_order_offer(p_offer_id uuid,p_expected_version bigint,p_idempotency_key text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare v_offer public.rider_order_offers%rowtype;v_prior jsonb;
begin
  if auth.uid() is null then raise exception 'Autenticación requerida' using errcode='42501'; end if;
  perform public.lock_rider_capacity(auth.uid());
  select * into v_offer from public.rider_order_offers
   where id=p_offer_id and rider_user_id=auth.uid();
  if not found then return public.accept_rider_order_offer_pre_presence(p_offer_id,p_expected_version,p_idempotency_key); end if;
  perform public.rider_require_active_membership(v_offer.business_id);
  if (select b.rider_presence_required from public.businesses b where b.id=v_offer.business_id)
     and not public.rider_availability_effective(v_offer.business_id,auth.uid()) then
    select result into v_prior from public.rider_delivery_operations
    where order_id=v_offer.order_id and rider_user_id=auth.uid()
      and operation='accept_offer' and idempotency_key=p_idempotency_key;
    if found or v_offer.status <> 'pending' then
      return public.accept_rider_order_offer_pre_presence(p_offer_id,p_expected_version,p_idempotency_key);
    end if;
    return jsonb_build_object('ok',false,'code','rider_unavailable');
  end if;
  return public.accept_rider_order_offer_pre_presence(p_offer_id,p_expected_version,p_idempotency_key);
end;
$$;

revoke all on function public.set_rider_availability(uuid,boolean,bigint,text) from public, anon;
revoke all on function public.heartbeat_rider_availability(uuid) from public, anon;
revoke all on function public.list_business_rider_availability(uuid) from public, anon;
revoke all on function public.set_business_rider_presence_policy(uuid,boolean) from public, anon;
revoke all on function public.get_rider_delivery_board() from public, anon;
revoke all on function public.offer_order_to_rider(uuid,text,uuid,uuid) from public, anon;
revoke all on function public.accept_rider_order_offer(uuid,bigint,text) from public, anon;
grant execute on function public.set_rider_availability(uuid,boolean,bigint,text) to authenticated;
grant execute on function public.heartbeat_rider_availability(uuid) to authenticated;
grant execute on function public.list_business_rider_availability(uuid) to authenticated;
grant execute on function public.set_business_rider_presence_policy(uuid,boolean) to authenticated;
grant execute on function public.get_rider_delivery_board() to authenticated;
grant execute on function public.offer_order_to_rider(uuid,text,uuid,uuid) to authenticated;
grant execute on function public.accept_rider_order_offer(uuid,bigint,text) to authenticated;
