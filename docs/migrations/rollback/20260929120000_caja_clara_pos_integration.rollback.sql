-- Rollback de 20260929120000: desconecta Caja Clara de La Taba.
--
-- Qué hace: retira las cinco RPC pos_*, los helpers privados y el trigger de
-- retención; revoca las sesiones de Caja Clara (quedan como 'unknown' y
-- revocadas, así ninguna vuelve a autorizar nada) y restituye
-- identity_register_session y el CHECK de clientes a su versión anterior.
-- Desde ese momento Caja Clara recibe «function does not exist» y sigue
-- vendiendo en local: su outbox guarda los movimientos pendientes.
--
-- Qué NO hace: no borra pos_stock_receipts ni pos_stock_conflicts. Son
-- evidencia durable (qué movió la caja, con qué sesión y qué faltante se
-- detectó). Quedan sin grants para anon y authenticated. No toca
-- products.stock ni inventory_movements: los movimientos aplicados fueron
-- ventas y compras reales del local y siguen en el ledger inmutable.
--
-- ATENCIÓN: si queda un conflicto abierto, el producto está retenido (no se
-- vende online). Sin el trigger, la próxima publicación lo vuelve a ofrecer
-- con el stock que diga la base. Por eso el rollback se niega si hay
-- conflictos abiertos: primero contar el físico desde Caja Clara (o cerrar el
-- conflicto a mano con un conteo) y recién después revertir.
begin;

do $guard$
begin
  if exists (select 1 from public.pos_stock_conflicts where status = 'open') then
    raise exception 'ROLLBACK_BLOCKED: hay conflictos de stock abiertos; resolverlos con un conteo antes de revertir'
      using errcode = 'P0001';
  end if;
end;
$guard$;

drop trigger if exists products_pos_conflict_hold on public.products;

drop function if exists public.pos_get_catalog_state(uuid, text);
drop function if exists public.pos_apply_stock_movements(uuid, text, jsonb);
drop function if exists public.pos_apply_stock_count(uuid, text, uuid, text, integer, text, text);
drop function if exists public.pos_list_orders(uuid, text, timestamptz, integer);
drop function if exists public.pos_get_store_overview(uuid, text);

drop function if exists private.pos_hold_conflicted_product();
drop function if exists private.pos_product_row(public.products);
drop function if exists private.pos_require_terminal(uuid, text);
drop function if exists private.pos_reserved_quantity(uuid);
drop function if exists private.pos_holding_orders(uuid);
drop function if exists private.pos_try_reoffer(uuid);
drop function if exists private.pos_record_conflict(uuid, uuid, text, integer, integer, integer, integer);
drop function if exists private.pos_inventory_type(text, integer);

revoke all on table public.pos_stock_conflicts, public.pos_stock_receipts from public, anon, authenticated;

-- Las sesiones de Caja Clara no sobreviven al rollback.
update public.identity_sessions
   set revoked_at = coalesce(revoked_at, now()),
       revoked_reason = coalesce(revoked_reason, 'revoke_all'),
       client = 'unknown'
 where client = 'caja_clara_windows';

alter table public.identity_sessions drop constraint if exists identity_sessions_client_check;
alter table public.identity_sessions add constraint identity_sessions_client_check
  check (client in ('rider_android', 'panel_web', 'unknown'));

create or replace function public.identity_register_session(
  p_business_id uuid,
  p_client text default 'unknown',
  p_device_label text default null,
  p_device_key_hash text default null,
  p_app_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_session uuid := public.identity_session_id();
  v_client text := coalesce(nullif(btrim(p_client), ''), 'unknown');
  v_inserted boolean := false;
  v_valid_from timestamptz;
  v_disabled timestamptz;
  v_issued timestamptz;
begin
  if v_user is null or p_business_id is null or public.identity_is_anonymous() or v_session is null then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select bm.role into v_role
    from public.business_members bm
   where bm.business_id = p_business_id
     and bm.user_id = v_user
     and bm.is_active = true;
  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select s.sessions_valid_from, s.disabled_at
    into v_valid_from, v_disabled
    from public.identity_user_security s
   where s.business_id = p_business_id
     and s.user_id = v_user;
  if v_disabled is not null then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  v_valid_from := coalesce(v_valid_from, '-infinity'::timestamptz);
  if v_valid_from > '-infinity'::timestamptz then
    v_issued := public.identity_token_issued_at();
    if v_issued is null or v_issued < v_valid_from then
      return jsonb_build_object('ok', false, 'code', 'not_authorized');
    end if;
  end if;

  if v_client not in ('rider_android', 'panel_web', 'unknown') then
    v_client := 'unknown';
  end if;

  insert into public.identity_sessions as ise (
    session_id, user_id, business_id, role_at_login, client,
    device_label, device_key_hash, app_version
  ) values (
    v_session, v_user, p_business_id, v_role, v_client,
    nullif(btrim(p_device_label), ''),
    lower(nullif(btrim(p_device_key_hash), '')),
    nullif(btrim(p_app_version), '')
  )
  on conflict (session_id) do update
     set last_seen_at = now(),
         role_at_login = excluded.role_at_login,
         device_label = coalesce(excluded.device_label, ise.device_label),
         device_key_hash = coalesce(excluded.device_key_hash, ise.device_key_hash),
         app_version = coalesce(excluded.app_version, ise.app_version)
   where ise.user_id = excluded.user_id
     and ise.business_id = excluded.business_id
     and ise.revoked_at is null
  returning (xmax = 0) into v_inserted;

  if v_inserted is null then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  if v_inserted then
    perform public.identity_record_audit_event(
      p_event_type => 'session_opened',
      p_business_id => p_business_id,
      p_actor_user_id => v_user,
      p_actor_role => v_role,
      p_subject_user_id => v_user,
      p_session_id => v_session,
      p_metadata => jsonb_build_object('client', v_client, 'app_version', nullif(btrim(p_app_version), ''))
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'registered',
    'role', v_role,
    'session_id', v_session,
    'new_session', v_inserted
  );
end;
$$;

revoke execute on function public.identity_register_session(uuid, text, text, text, text) from public, anon;
grant execute on function public.identity_register_session(uuid, text, text, text, text) to authenticated;

select pg_notify('pgrst', 'reload schema');
commit;
