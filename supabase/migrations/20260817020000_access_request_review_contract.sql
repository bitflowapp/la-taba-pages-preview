-- TABA2 · Alta por solicitud: la decision.
--
-- Aprobar es UN acto, no dos. El error que esta migracion existe para hacer
-- imposible es el que se comete solo: que el cliente inserte la membresia y
-- despues marque la solicitud como aprobada. Con dos viajes, la mitad de las
-- veces que falla el segundo queda alguien con acceso y una solicitud que sigue
-- diciendo "pendiente"; y la mitad de las veces que falla el primero queda una
-- solicitud aprobada sin membresia. Aca las dos escrituras estan en la misma
-- funcion y por lo tanto en la misma transaccion: o pasan las dos, o ninguna.
--
-- Las tres reglas que sostienen "nadie se da permisos a si mismo":
--
--   1. La autoridad se pregunta al servidor, con identity_require_permission
--      sobre el comercio de la solicitud. No hay parametro de rol del que
--      fiarse, ni claim, ni user_metadata.
--   2. Nadie decide sobre su propia solicitud. Ni un owner. Es la unica regla
--      que no tiene excepcion por rango.
--   3. 'owner' no es un rol otorgable por esta via. Un admin ademas no puede
--      otorgar 'admin': para eso hace falta identity.roles.write, que solo
--      tiene el owner.
--
-- Aplicar despues de 20260817010000_business_access_requests.sql.

-- ===========================================================================
-- 1. La bandeja
-- ===========================================================================
-- El correo entero SI se muestra: quien decide esta habilitando a alguien a
-- entrar a su propio comercio y necesita reconocerlo. Es el mismo dato que ya
-- tipea a mano para invitar. Lo que no sale de aca es hacia afuera: la RPC
-- exige identity.members.read sobre ESE comercio.

create or replace function public.identity_list_access_requests(
  p_business_id uuid,
  p_status text default 'pending'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_status text := nullif(lower(btrim(coalesce(p_status, ''))), '');
begin
  perform public.identity_require_permission(p_business_id, 'identity.members.read');

  if v_status is not null and v_status not in ('pending', 'approved', 'rejected') then
    raise exception 'identity: estado de solicitud invalido' using errcode = '22023';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'request_id', r.id,
             'user_id', r.user_id,
             'email', lower(btrim(u.email)),
             'full_name', r.full_name,
             'contact_phone', r.contact_phone,
             'requested_access', r.requested_access,
             'status', r.status,
             'attempt_count', r.attempt_count,
             'requested_at', r.requested_at,
             'decided_at', r.decided_at,
             'granted_role', r.granted_role,
             'decision_reason', r.decision_reason,
             -- Una solicitud de alguien que ya entro por otra via (una
             -- invitacion canjeada mientras esperaba). No se puede aprobar
             -- porque no hay nada que otorgar; se rechaza para vaciarla.
             'is_member', exists (
               select 1 from public.business_members bm
                where bm.business_id = r.business_id and bm.user_id = r.user_id
             ),
             'roles_grantable', case
               when r.requested_access = 'rider' then jsonb_build_array('rider')
               when public.identity_has_permission(p_business_id, 'identity.roles.write')
                 then jsonb_build_array('staff', 'admin')
               else jsonb_build_array('staff')
             end
           ) order by r.requested_at desc, r.id)
      from public.business_access_requests r
      join auth.users u on u.id = r.user_id
     where r.business_id = p_business_id
       and (v_status is null or r.status = v_status)
  ), '[]'::jsonb);
end;
$$;

comment on function public.identity_list_access_requests(uuid, text) is
  'Bandeja de solicitudes de alta del comercio. Exige identity.members.read sobre ese comercio.';

-- ===========================================================================
-- 2. La decision
-- ===========================================================================

create or replace function public.identity_review_access_request(
  p_request_id uuid,
  p_decision text,
  p_role text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_role text := nullif(lower(btrim(coalesce(p_role, ''))), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_req public.business_access_requests%rowtype;
  v_actor_role text;
  v_granted text;
begin
  if v_decision not in ('approve', 'reject') then
    return jsonb_build_object('ok', false, 'code', 'invalid_decision');
  end if;
  if v_reason is not null and length(v_reason) > 200 then
    return jsonb_build_object('ok', false, 'code', 'invalid_reason');
  end if;

  -- El lock es lo que hace que dos aprobaciones simultaneas no creen dos
  -- membresias ni dos eventos: la segunda espera, relee la fila ya decidida y
  -- sale por 'already_decided'.
  select * into v_req
    from public.business_access_requests r
   where r.id = p_request_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  -- Levanta insufficient_privilege si quien llama no tiene autoridad en ESE
  -- comercio. Una solicitud de otro comercio se comporta igual que una ajena.
  v_actor_role := public.identity_require_permission(v_req.business_id, 'identity.members.write');

  -- La regla sin excepciones. Un owner con una solicitud propia tampoco.
  if v_req.user_id = v_actor then
    return jsonb_build_object('ok', false, 'code', 'self_review');
  end if;

  if v_req.status <> 'pending' then
    return jsonb_build_object(
      'ok', true,
      'code', 'already_decided',
      'status', v_req.status,
      'granted_role', v_req.granted_role
    );
  end if;

  -- Rechazar no toca ninguna membresia, asi que es seguro incluso sobre una
  -- solicitud de alguien que ya es del equipo: sirve para vaciar la bandeja.
  if v_decision = 'reject' then
    update public.business_access_requests
       set status = 'rejected',
           decided_at = now(),
           decided_by = v_actor,
           decision_reason = v_reason
     where id = v_req.id;

    perform public.identity_record_audit_event(
      p_event_type => 'access_request_rejected',
      p_business_id => v_req.business_id,
      p_actor_user_id => v_actor,
      p_actor_role => v_actor_role,
      p_subject_user_id => v_req.user_id,
      p_session_id => public.identity_session_id(),
      p_metadata => jsonb_build_object(
        'request_id', v_req.id,
        'requested_access', v_req.requested_access,
        'attempt', v_req.attempt_count
      )
    );

    return jsonb_build_object('ok', true, 'code', 'rejected', 'status', 'rejected');
  end if;

  -- Aprobar sobre alguien que ya tiene membresia pisaria un rol que otra via
  -- ya decidio; en el peor caso degradaria a un owner. No se hace: la fila se
  -- vacia rechazandola.
  if exists (
    select 1 from public.business_members bm
     where bm.business_id = v_req.business_id and bm.user_id = v_req.user_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'already_member');
  end if;

  if v_req.requested_access = 'rider' then
    -- Quien pidio repartir no se convierte en encargado por como se responda.
    if v_role is not null and v_role <> 'rider' then
      return jsonb_build_object('ok', false, 'code', 'invalid_role');
    end if;
    v_granted := 'rider';
  else
    v_granted := coalesce(v_role, 'staff');
    if v_granted not in ('admin', 'staff') then
      return jsonb_build_object('ok', false, 'code', 'invalid_role');
    end if;
    -- Un admin opera; no arma la conduccion. Crear otro admin exige
    -- identity.roles.write, que en el catalogo solo tiene el owner.
    if v_granted = 'admin'
       and not public.identity_has_permission(v_req.business_id, 'identity.roles.write') then
      return jsonb_build_object('ok', false, 'code', 'role_above_actor');
    end if;
  end if;

  -- A partir de aca, un solo acto. El guard de membresias exige esta marca:
  -- fuera de una RPC de identidad, business_members no se escribe.
  perform set_config('taba.identity_write', 'on', true);

  insert into public.business_members (business_id, user_id, role, is_active)
  values (v_req.business_id, v_req.user_id, v_granted, true);

  insert into public.identity_user_security (business_id, user_id)
  values (v_req.business_id, v_req.user_id)
  on conflict (business_id, user_id) do nothing;

  -- Sin ON CONFLICT a proposito. Los perfiles cuelgan de la membresia por FK
  -- compuesta con ON DELETE CASCADE, y recien comprobamos que no habia
  -- membresia: aca no puede haber un perfil que pisar. Si algun dia lo hubiera,
  -- es un invariante roto y tiene que fallar a la vista, no absorberse.
  if v_granted = 'rider' then
    insert into public.rider_profiles (business_id, user_id, full_name, contact_phone, created_by)
    values (v_req.business_id, v_req.user_id, v_req.full_name, v_req.contact_phone, v_actor);
  else
    insert into public.staff_profiles (business_id, user_id, full_name, contact_phone, created_by)
    values (v_req.business_id, v_req.user_id, v_req.full_name, v_req.contact_phone, v_actor);
  end if;

  perform set_config('taba.identity_write', 'off', true);

  update public.business_access_requests
     set status = 'approved',
         decided_at = now(),
         decided_by = v_actor,
         granted_role = v_granted,
         decision_reason = v_reason
   where id = v_req.id;

  perform public.identity_record_audit_event(
    p_event_type => 'access_request_approved',
    p_business_id => v_req.business_id,
    p_actor_user_id => v_actor,
    p_actor_role => v_actor_role,
    p_subject_user_id => v_req.user_id,
    p_session_id => public.identity_session_id(),
    p_metadata => jsonb_build_object(
      'request_id', v_req.id,
      'requested_access', v_req.requested_access,
      'granted_role', v_granted,
      'attempt', v_req.attempt_count
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'approved',
    'status', 'approved',
    'granted_role', v_granted,
    'user_id', v_req.user_id
  );
end;
$$;

comment on function public.identity_review_access_request(uuid, text, text, text) is
  'Decision atomica sobre una solicitud de alta: membresia, seguridad y perfil nacen en la misma transaccion que el sello de aprobada. Nadie decide sobre si mismo y nadie otorga owner por esta via.';

-- ===========================================================================
-- 3. Superficie
-- ===========================================================================

revoke execute on function public.identity_list_access_requests(uuid, text) from public, anon;
revoke execute on function public.identity_review_access_request(uuid, text, text, text) from public, anon;

grant execute on function public.identity_list_access_requests(uuid, text) to authenticated;
grant execute on function public.identity_review_access_request(uuid, text, text, text) to authenticated;

select pg_notify('pgrst', 'reload schema');
