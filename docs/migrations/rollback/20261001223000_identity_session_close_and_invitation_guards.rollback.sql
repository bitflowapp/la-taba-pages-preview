-- Rollback de 20261001223000: devuelve `identity_close_own_session` e
-- `identity_accept_invitation` a su definición anterior, capturada del arnés con las
-- 159 migraciones previas aplicadas (pg_get_functiondef).
--
-- Qué vuelve a quedar abierto:
--   · cerrar la propia sesión vuelve a escribir `session_closed` en el comercio que
--     el llamador nombre, tenga o no una sesión de equipo ahí;
--   · aceptar una invitación vuelve a pisar una membresía vigente y a dejar puesta la
--     baja (`disabled_at`) de quien se reactiva.
--
-- Qué NO se abre: con la definición anterior la baja no se limpia al aceptar, así que
-- una invitación emitida antes de una baja tampoco rehabilita a nadie (quien la acepta
-- queda con la membresía activa y la baja puesta: sin acceso).
--
-- Qué NO hace:
--   · no toca filas: las membresías reactivadas, las bajas limpiadas y los eventos de
--     auditoría escritos con la versión nueva quedan como están (la auditoría es de
--     sólo agregado);
--   · no cambia privilegios: las dos funciones siguen siendo sólo de `authenticated`.
begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('la-taba:rollback:20261001223000', 0)
);

CREATE OR REPLACE FUNCTION public.identity_close_own_session(p_business_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_user uuid := auth.uid();
  v_session uuid := public.identity_session_id();
  v_role text;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select bm.role into v_role
    from public.business_members bm
   where bm.business_id = p_business_id
     and bm.user_id = v_user;

  if v_session is not null then
    update public.identity_sessions
       set revoked_at = now(),
           revoked_by = v_user,
           revoked_reason = 'self_logout'
     where session_id = v_session
       and user_id = v_user
       and revoked_at is null;

    perform public.identity_kill_auth_session(v_session);

    perform public.identity_record_audit_event(
      p_event_type => 'session_closed',
      p_business_id => p_business_id,
      p_actor_user_id => v_user,
      p_actor_role => v_role,
      p_subject_user_id => v_user,
      p_session_id => v_session
    );
  end if;

  return jsonb_build_object('ok', true, 'code', 'closed');
end;
$function$;

revoke all on function public.identity_close_own_session(uuid) from public, anon, authenticated;
grant execute on function public.identity_close_own_session(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.identity_accept_invitation(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_user uuid := auth.uid();
  v_email text := lower(btrim(coalesce(public.identity_jwt_claims() ->> 'email', '')));
  v_hash text;
  v_inv public.identity_invitations%rowtype;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;
  if public.identity_is_anonymous() then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;
  if coalesce(btrim(p_token), '') = '' then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  if v_email = '' then
    select lower(btrim(u.email)) into v_email from auth.users u where u.id = v_user;
  end if;

  v_hash := encode(digest(btrim(p_token), 'sha256'), 'hex');

  select * into v_inv
    from public.identity_invitations i
   where i.token_hash = v_hash
   for update;

  if not found
     or v_inv.accepted_at is not null
     or v_inv.revoked_at is not null
     or v_inv.expires_at <= now() then
    -- Un solo codigo para inexistente, usada, retirada y vencida.
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  if v_email is null or v_email <> v_inv.invited_email then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  perform set_config('taba.identity_write', 'on', true);

  insert into public.business_members (business_id, user_id, role, is_active)
  values (v_inv.business_id, v_user, v_inv.invited_role, true)
  on conflict (business_id, user_id) do update
     set role = excluded.role,
         is_active = true;

  insert into public.identity_user_security (business_id, user_id)
  values (v_inv.business_id, v_user)
  on conflict (business_id, user_id) do nothing;

  if v_inv.invited_role = 'rider' then
    insert into public.rider_profiles (business_id, user_id, full_name, created_by)
    values (v_inv.business_id, v_user, v_inv.full_name, v_inv.invited_by)
    on conflict (business_id, user_id) do update
       set full_name = excluded.full_name, status = 'active';
  else
    insert into public.staff_profiles (business_id, user_id, full_name, created_by)
    values (v_inv.business_id, v_user, v_inv.full_name, v_inv.invited_by)
    on conflict (business_id, user_id) do update
       set full_name = excluded.full_name, status = 'active';
  end if;

  update public.identity_invitations
     set accepted_at = now(), accepted_user_id = v_user
   where id = v_inv.id;

  perform set_config('taba.identity_write', 'off', true);

  perform public.identity_record_audit_event(
    p_event_type => 'invitation_accepted',
    p_business_id => v_inv.business_id,
    p_actor_user_id => v_user,
    p_actor_role => v_inv.invited_role,
    p_subject_user_id => v_user,
    p_session_id => public.identity_session_id(),
    p_metadata => jsonb_build_object('invitation_id', v_inv.id, 'role', v_inv.invited_role)
  );

  return jsonb_build_object(
    'ok', true,
    'business_id', v_inv.business_id,
    'role', v_inv.invited_role
  );
end;
$function$;

revoke all on function public.identity_accept_invitation(text) from public, anon, authenticated;
grant execute on function public.identity_accept_invitation(text) to authenticated;

commit;
