-- Cerrar la propia sesión no escribe en la auditoría de un comercio ajeno, y aceptar
-- una invitación no pisa una membresía vigente ni deja a nadie a medio habilitar.
--
-- QUÉ ESTABA ABIERTO (medido el 2026-10-01 sobre las 159 migraciones anteriores)
--
--   1. `identity_close_own_session(p_business_id)` escribía un evento `session_closed`
--      en el comercio que el llamador NOMBRABA, hubiera o no una sesión que cerrar.
--      Lo ejecuta cualquier `authenticated`, y el cliente web entra con
--      `signInAnonymously`: una identidad anónima, sin membresía en ningún lado,
--      llamó cinco veces con el id de un comercio ajeno y dejó cinco filas en la
--      auditoría de ESE comercio (`actor_role` nulo). La tabla es de sólo agregado y
--      el Panel lee las últimas 500: unos cientos de llamadas sacan de la vista del
--      dueño los eventos que importan (cambios de rol, bajas).
--
--   2. `identity_accept_invitation` hacía `on conflict do update set role, is_active`
--      sin mirar qué había:
--        a. una persona dada de baja y vuelta a invitar aceptaba, recibía `ok` y
--           quedaba con `is_active = true` y `disabled_at` todavía puesto:
--           `identity_register_session` le respondía `not_authorized` para siempre;
--        b. el único dueño de un comercio, con una invitación vieja como empleado,
--           la aceptaba y se degradaba solo: el comercio quedaba con cero dueños.
--
-- QUÉ QUEDA
--
--   1. El evento se escribe sólo cuando una fila de `identity_sessions` cambió de
--      verdad, y el comercio sale DE ESA FILA, no del parámetro. Quien no tiene una
--      sesión de equipo registrada no escribe nada. Llamar dos veces escribe una.
--   2. Aceptar una invitación:
--        · con una membresía vigente responde `already_member` y no toca nada (la
--          invitación sigue pendiente: la retira quien la mandó, o vence);
--        · con una baja POSTERIOR a la invitación responde `account_disabled` y no
--          toca nada. Una invitación puede convivir con una membresía (la persona
--          entró por una solicitud de acceso) y la baja no la retira: sin esto,
--          limpiar la baja al aceptar dejaba que el despedido se rehabilitara solo
--          con el link viejo. Reactiva sólo una invitación emitida después de la
--          baja;
--        · la invitación de un encargado no reactiva a un dueño ni a otro
--          encargado dados de baja (`account_disabled`): es la misma regla de
--          `identity_assert_can_administer_member`, y antes de este cambio nadie
--          volvía por invitación;
--        · si la membresía que hay es la de dueño y no queda otro dueño vigente, no
--          se la degrada: `last_owner`, el mismo código que ya usan
--          `identity_set_member_role` e `identity_set_member_active`;
--        · al reactivar limpia `disabled_at` / `disabled_by` / `disabled_reason`,
--          igual que `identity_set_member_active(true)`, y deja un solo perfil: el
--          del rol nuevo (igual que `identity_set_member_role`). Sin eso, la próxima
--          baja de esa persona fallaba contra `identity_assert_profile_role`.
--
-- QUÉ NO CAMBIA
--
--   · Firmas, dueño, `search_path` y privilegios de las dos funciones.
--   · `identity_close_own_session` sigue respondiendo `{ok, code: closed}` a todo
--     llamador autenticado y sigue cerrando la sesión de Auth del propio llamador.
--   · `sessions_valid_from` no se mueve al reactivar: un token emitido antes de la
--     baja sigue sin valer, como con `identity_set_member_active(true)`.
--   · El alta nueva (sin membresía previa ni baja anotada) es exactamente la de antes.
--
-- Forward-only. No toca filas.
-- Reversión: docs/migrations/rollback/20261001223000_identity_session_close_and_invitation_guards.rollback.sql

-- ── 1. Cerrar la propia sesión ──────────────────────────────────────────────
create or replace function public.identity_close_own_session(p_business_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_session uuid := public.identity_session_id();
  v_role text;
  v_closed_business uuid;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  if v_session is not null then
    update public.identity_sessions
       set revoked_at = now(),
           revoked_by = v_user,
           revoked_reason = 'self_logout'
     where session_id = v_session
       and user_id = v_user
       and revoked_at is null
    returning business_id into v_closed_business;

    perform public.identity_kill_auth_session(v_session);

    -- La auditoría cuenta lo que pasó, no lo que el llamador dice: sin una sesión
    -- de equipo que se haya cerrado recién no hay evento, y el comercio es el de
    -- la sesión. `p_business_id` se conserva por contrato y ya no decide nada.
    if v_closed_business is not null then
      select bm.role into v_role
        from public.business_members bm
       where bm.business_id = v_closed_business
         and bm.user_id = v_user;

      perform public.identity_record_audit_event(
        p_event_type => 'session_closed',
        p_business_id => v_closed_business,
        p_actor_user_id => v_user,
        p_actor_role => v_role,
        p_subject_user_id => v_user,
        p_session_id => v_session
      );
    end if;
  end if;

  return jsonb_build_object('ok', true, 'code', 'closed');
end;
$$;

revoke all on function public.identity_close_own_session(uuid) from public, anon, authenticated;
grant execute on function public.identity_close_own_session(uuid) to authenticated;

-- ── 2. Aceptar una invitación ───────────────────────────────────────────────
create or replace function public.identity_accept_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_email text := lower(btrim(coalesce(public.identity_jwt_claims() ->> 'email', '')));
  v_hash text;
  v_inv public.identity_invitations%rowtype;
  v_member_found boolean := false;
  v_member_role text;
  v_member_active boolean;
  v_disabled timestamptz;
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

  -- Lo que ya hay decide. La fila se toma con su candado para que un cambio de rol
  -- o una baja simultáneos no se crucen con esta aceptación.
  select bm.role, bm.is_active into v_member_role, v_member_active
    from public.business_members bm
   where bm.business_id = v_inv.business_id
     and bm.user_id = v_user
   for update;
  v_member_found := found;

  -- La baja se lee DESPUÉS de tomar el candado de la membresía (una baja simultánea
  -- ya terminó o todavía no empezó) y haya o no membresía: la ficha de seguridad
  -- no cuelga de `business_members` y puede sobrevivirla.
  select us.disabled_at into v_disabled
    from public.identity_user_security us
   where us.business_id = v_inv.business_id
     and us.user_id = v_user;

  -- Una baja deja sin efecto las invitaciones que ya estaban emitidas. Una
  -- invitación puede convivir con una membresía (la persona entró por una solicitud
  -- de acceso) y `identity_set_member_active(false)` no la retira: sin esta
  -- comparación, quien fue dado de baja se rehabilitaba solo con el link viejo.
  -- Reactiva sólo una invitación emitida después de la baja, que es un acto nuevo
  -- de alguien con autoridad. No se consume: la retira quien la mandó, o vence.
  if v_disabled is not null and v_inv.created_at < v_disabled then
    return jsonb_build_object('ok', false, 'code', 'account_disabled');
  end if;

  if v_member_found then
    -- Vigente es lo mismo que mira `identity_member_role`: activa y sin baja. Una
    -- invitación no es la vía para cambiarle el rol a alguien que ya está adentro.
    if v_member_active and v_disabled is null then
      return jsonb_build_object('ok', false, 'code', 'already_member');
    end if;

    -- Un encargado no administra a un dueño ni a otro encargado
    -- (`identity_assert_can_administer_member`): su invitación tampoco los
    -- reactiva, ni siquiera con un rol menor. Los vuelve a habilitar un dueño.
    if v_inv.invited_by_role = 'admin' and v_member_role in ('owner', 'admin') then
      return jsonb_build_object('ok', false, 'code', 'account_disabled');
    end if;

    -- Reactivar al dueño con un rol menor, cuando no queda otro dueño vigente,
    -- borraría el único registro de quién es el dueño: después nadie podría
    -- volver a otorgar ese rol.
    if v_member_role = 'owner'
       and v_inv.invited_role <> 'owner'
       and public.identity_count_active_owners(v_inv.business_id) < 1 then
      return jsonb_build_object('ok', false, 'code', 'last_owner');
    end if;
  end if;

  perform set_config('taba.identity_write', 'on', true);

  -- Sólo se pisa la fila que se miró recién. Si la membresía apareció entre la
  -- lectura y esta escritura (otra vía de alta, a la vez), no se la toca.
  insert into public.business_members (business_id, user_id, role, is_active)
  values (v_inv.business_id, v_user, v_inv.invited_role, true)
  on conflict (business_id, user_id) do update
     set role = excluded.role,
         is_active = true
   where v_member_found;
  if not found then
    perform set_config('taba.identity_write', 'off', true);
    return jsonb_build_object('ok', false, 'code', 'already_member');
  end if;

  insert into public.identity_user_security (business_id, user_id)
  values (v_inv.business_id, v_user)
  on conflict (business_id, user_id) do update
     set disabled_at = null,
         disabled_by = null,
         disabled_reason = null;

  -- El perfil sigue al rol: una persona reactivada con otro rol no conserva la
  -- ficha del anterior.
  if v_inv.invited_role = 'rider' then
    delete from public.staff_profiles
     where business_id = v_inv.business_id and user_id = v_user;
    insert into public.rider_profiles (business_id, user_id, full_name, created_by)
    values (v_inv.business_id, v_user, v_inv.full_name, v_inv.invited_by)
    on conflict (business_id, user_id) do update
       set full_name = excluded.full_name, status = 'active';
  else
    delete from public.rider_profiles
     where business_id = v_inv.business_id and user_id = v_user;
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
      || case
           when v_member_found
             then jsonb_build_object('reactivated', true, 'previous_role', v_member_role)
           else '{}'::jsonb
         end
  );

  return jsonb_build_object(
    'ok', true,
    'business_id', v_inv.business_id,
    'role', v_inv.invited_role
  );
end;
$$;

revoke all on function public.identity_accept_invitation(text) from public, anon, authenticated;
grant execute on function public.identity_accept_invitation(text) to authenticated;
