-- TABA2 · Alta por solicitud: el modelo.
--
-- Hasta aca el unico camino de alta era la invitacion (20260812050000): alguien
-- con autoridad emite un token y la persona lo canjea. Es un modelo de EMPUJE y
-- sigue vigente. Lo que falta es el modelo inverso, de PEDIDO: una persona crea
-- su cuenta, pide entrar, y queda esperando. Las dos rutas terminan en el mismo
-- lugar —public.business_members— y ninguna de las dos deja que el interesado
-- se otorgue nada a si mismo.
--
-- Decisiones de modelo, y por que:
--
--   * UNA sola tabla para Panel y para Rider. Los dos casos son la misma frase
--     ("una persona le pide a un comercio un rol, y alguien con autoridad
--     decide"), y business_members ya impone `unique (business_id, user_id)`:
--     nadie puede ser a la vez Rider y encargado del mismo comercio. Dos tablas
--     serian dos maquinas de estado que se desincronizan.
--
--   * UNA sola fila por (comercio, persona), con `unique`, no un indice parcial
--     sobre 'pending'. Un indice parcial deja que cada rechazo habilite una fila
--     nueva; a los seis meses la tabla es el historial de intentos de quien
--     insista mas. Aca la fila se REUSA: volver a pedir actualiza la misma fila
--     y suma `attempt_count`. El historial de decisiones vive en
--     identity_audit_events, que es append-only de verdad.
--
--   * Tres estados: pending, approved, rejected. No hay 'cancelled' porque el
--     producto no tiene ninguna pantalla donde retirar una solicitud, ni
--     'revoked' porque quitar el acceso ya es identity_set_member_active(false)
--     sobre la membresia, no sobre este papel.
--
--   * `granted_role` no admite 'owner'. La conduccion de un comercio no se
--     reparte respondiendo un formulario: se transfiere con
--     identity_set_member_role, que exige identity.roles.write, o se arranca con
--     la herramienta de bootstrap. Esta tabla no es una via hacia owner.
--
-- Aplicar despues de 20260816122000_security_definer_anon_least_privilege.sql.

-- ===========================================================================
-- 1. Vocabulario de auditoria
-- ===========================================================================
-- identity_audit_events tiene un CHECK con la lista cerrada de eventos. Agregar
-- un tipo nuevo es cambiar ese CHECK; no se puede insertar y ya.

alter table public.identity_audit_events
  drop constraint if exists identity_audit_events_event_type_check;

alter table public.identity_audit_events
  add constraint identity_audit_events_event_type_check
  check (event_type in (
    'session_opened',
    'session_closed',
    'session_revoked',
    'sessions_revoked_all',
    'session_rejected',
    'member_invited',
    'invitation_accepted',
    'invitation_revoked',
    'member_activated',
    'member_disabled',
    'member_role_changed',
    'profile_updated',
    'authorization_denied',
    'access_requested',
    'access_request_approved',
    'access_request_rejected'
  ));

-- ===========================================================================
-- 2. La tabla
-- ===========================================================================

create table if not exists public.business_access_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  -- Si la identidad desaparece, la solicitud no significa nada: no queda un
  -- pendiente huerfano esperando que alguien lo apruebe hacia la nada. El
  -- rastro de que existio queda en identity_audit_events, cuyo actor pasa a
  -- null en vez de borrarse.
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_access text not null check (requested_access in ('panel', 'rider')),
  full_name text not null check (length(btrim(full_name)) between 2 and 120),
  contact_phone text check (contact_phone is null or contact_phone ~ '^[0-9+][0-9 +().-]{5,29}$'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  -- Cuantas veces esta persona pidio entrar a este comercio. No crea filas: es
  -- el contador que deja ver, desde la bandeja, a quien esta insistiendo.
  attempt_count integer not null default 1 check (attempt_count >= 1),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  granted_role text check (granted_role is null or granted_role in ('admin', 'staff', 'rider')),
  decision_reason text check (decision_reason is null or length(btrim(decision_reason)) between 3 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Una persona, un comercio, una fila. Para siempre.
  constraint business_access_requests_one_per_person unique (business_id, user_id),

  -- Pendiente es exactamente "sin decidir". No hay forma de dejar un aprobado
  -- sin fecha ni un pendiente con revisor.
  constraint business_access_requests_decision_is_complete
    check ((status = 'pending') = (decided_at is null)),
  constraint business_access_requests_reviewer_follows_decision
    check ((decided_at is null) = (decided_by is null)),

  -- Aprobado es exactamente "con rol otorgado". Un aprobado sin rol seria una
  -- membresia que nadie sabe cual es.
  constraint business_access_requests_role_follows_approval
    check ((status = 'approved') = (granted_role is not null)),

  -- Pedir Rider y que te aprueben como encargado no es aprobar: es otra cosa.
  constraint business_access_requests_role_matches_request
    check (
      granted_role is null
      or (requested_access = 'rider' and granted_role = 'rider')
      or (requested_access = 'panel' and granted_role in ('admin', 'staff'))
    )
);

create index if not exists business_access_requests_inbox_idx
  on public.business_access_requests(business_id, status, requested_at desc);

create index if not exists business_access_requests_user_idx
  on public.business_access_requests(user_id);

drop trigger if exists business_access_requests_set_updated_at on public.business_access_requests;
create trigger business_access_requests_set_updated_at
before update on public.business_access_requests
for each row execute function public.set_updated_at();

comment on table public.business_access_requests is
  'Solicitudes de alta autogestionadas: identidad propia pidiendo un rol. No otorga ninguna autoridad por si misma; la membresia nace recien en identity_review_access_request.';
comment on column public.business_access_requests.attempt_count is
  'Cuantas veces se pidio entrar con esta misma fila. Volver a pedir no crea filas nuevas.';
comment on column public.business_access_requests.granted_role is
  'Rol efectivamente otorgado al aprobar. Nunca owner: la conduccion no se reparte por formulario.';

-- ===========================================================================
-- 3. Cuanto hay que esperar para volver a pedir
-- ===========================================================================
-- Un rechazo puede ser un error de quien decide, asi que volver a pedir tiene
-- que ser posible. Pero volver a pedir cinco veces por minuto es ruido dirigido
-- al comercio. La espera es server-side y no depende de que el cliente la
-- respete.

create or replace function public.business_access_request_retry_delay()
returns interval
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select interval '24 hours'
$$;

-- ===========================================================================
-- 4. Pedir acceso
-- ===========================================================================
-- Deriva la identidad de auth.uid(). No acepta user_id del cliente, no acepta
-- rol elegido por el cliente, y no escribe una sola fila en business_members.

create or replace function public.request_business_access(
  p_business_id uuid,
  p_access text,
  p_full_name text,
  p_contact_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_access text := lower(btrim(coalesce(p_access, '')));
  v_name text := btrim(coalesce(p_full_name, ''));
  v_phone text := nullif(btrim(coalesce(p_contact_phone, '')), '');
  v_email text;
  v_existing public.business_access_requests%rowtype;
  v_retry_at timestamptz;
  v_row public.business_access_requests%rowtype;
begin
  -- La sesion anonima es la del cliente que compra. Nunca es candidata a
  -- equipo, ni siquiera para pedirlo.
  if v_user is null or public.identity_is_anonymous() then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;

  select lower(btrim(u.email)) into v_email from auth.users u where u.id = v_user;
  if coalesce(v_email, '') = '' then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;

  if v_access not in ('panel', 'rider') then
    return jsonb_build_object('ok', false, 'code', 'invalid_access');
  end if;
  if length(v_name) < 2 or length(v_name) > 120 then
    return jsonb_build_object('ok', false, 'code', 'invalid_name');
  end if;
  if v_phone is not null and v_phone !~ '^[0-9+][0-9 +().-]{5,29}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_phone');
  end if;
  -- Al Rider hay que poder llamarlo. Al Panel se le escribe por el correo con
  -- el que entra.
  if v_access = 'rider' and v_phone is null then
    return jsonb_build_object('ok', false, 'code', 'phone_required');
  end if;

  -- Un comercio inexistente y un comercio dado de baja responden lo mismo, para
  -- que esta RPC no sea un oraculo de que identificadores existen.
  if not exists (
    select 1 from public.businesses b where b.id = p_business_id and b.is_active
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;

  -- Ya es del equipo: no hay nada que pedir. Incluye a quien esta dado de baja
  -- con is_active = false, porque volver a habilitarlo es un acto del comercio
  -- (identity_set_member_active), no un formulario que llena el interesado.
  if exists (
    select 1 from public.business_members bm
     where bm.business_id = p_business_id and bm.user_id = v_user
  ) then
    return jsonb_build_object('ok', true, 'code', 'already_member', 'status', 'approved');
  end if;

  select * into v_existing
    from public.business_access_requests r
   where r.business_id = p_business_id and r.user_id = v_user
   for update;

  if found then
    -- Reintentar sobre un pendiente devuelve el pendiente. No suma intento, no
    -- crea fila, no avisa dos veces.
    if v_existing.status = 'pending' then
      return jsonb_build_object(
        'ok', true,
        'code', 'already_pending',
        'request_id', v_existing.id,
        'status', 'pending',
        'requested_access', v_existing.requested_access,
        'requested_at', v_existing.requested_at
      );
    end if;

    if v_existing.status = 'approved' then
      -- Aprobada pero sin membresia viva: la membresia se elimino despues. Eso
      -- lo resuelve el comercio, no un pedido nuevo.
      return jsonb_build_object('ok', false, 'code', 'contact_business', 'status', 'approved');
    end if;

    v_retry_at := v_existing.decided_at + public.business_access_request_retry_delay();
    if now() < v_retry_at then
      return jsonb_build_object(
        'ok', false,
        'code', 'retry_later',
        'status', 'rejected',
        'retry_at', v_retry_at
      );
    end if;

    update public.business_access_requests
       set requested_access = v_access,
           full_name = v_name,
           contact_phone = v_phone,
           status = 'pending',
           attempt_count = v_existing.attempt_count + 1,
           requested_at = now(),
           decided_at = null,
           decided_by = null,
           granted_role = null,
           decision_reason = null
     where id = v_existing.id
     returning * into v_row;
  else
    -- Dos pedidos simultaneos de la misma persona llegan aca los dos: el
    -- `for update` de arriba no puede bloquear una fila que todavia no existe.
    -- El unique es el que decide, y el que pierde devuelve el pendiente que
    -- acaba de crear el que gano, en vez de un 23505 en la cara.
    begin
      insert into public.business_access_requests (
        business_id, user_id, requested_access, full_name, contact_phone
      ) values (
        p_business_id, v_user, v_access, v_name, v_phone
      )
      returning * into v_row;
    exception
      when unique_violation then
        select * into v_row
          from public.business_access_requests r
         where r.business_id = p_business_id and r.user_id = v_user;
        return jsonb_build_object(
          'ok', true,
          'code', 'already_pending',
          'request_id', v_row.id,
          'status', v_row.status,
          'requested_access', v_row.requested_access,
          'requested_at', v_row.requested_at
        );
    end;
  end if;

  perform public.identity_record_audit_event(
    p_event_type => 'access_requested',
    p_business_id => p_business_id,
    p_actor_user_id => v_user,
    p_subject_user_id => v_user,
    p_session_id => public.identity_session_id(),
    p_metadata => jsonb_build_object(
      'request_id', v_row.id,
      'requested_access', v_access,
      'attempt', v_row.attempt_count,
      -- Igual que en las invitaciones: el correo entero no entra a la
      -- auditoria; el dominio alcanza para reconocer de que alta se habla.
      'email_domain', split_part(v_email, '@', 2)
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'pending',
    'request_id', v_row.id,
    'status', 'pending',
    'requested_access', v_row.requested_access,
    'requested_at', v_row.requested_at
  );
end;
$$;

comment on function public.request_business_access(uuid, text, text, text) is
  'Alta autogestionada: crea o reactiva UNA solicitud propia. Nunca escribe business_members ni acepta un user_id del cliente.';

-- ===========================================================================
-- 5. Ver el estado propio
-- ===========================================================================
-- Lo consulta quien todavia no es del equipo, asi que no puede pasar por
-- identity_require_permission: a esta persona la compuerta le contesta que no,
-- y tiene razon. La unica llave es auth.uid() = user_id.

create or replace function public.get_my_business_access_request(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_row public.business_access_requests%rowtype;
  v_member_role text;
begin
  if v_user is null or public.identity_is_anonymous() then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;

  select bm.role into v_member_role
    from public.business_members bm
   where bm.business_id = p_business_id
     and bm.user_id = v_user
     and bm.is_active;

  select * into v_row
    from public.business_access_requests r
   where r.business_id = p_business_id and r.user_id = v_user;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'code', 'none',
      'status', null,
      'is_member', v_member_role is not null
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', v_row.status,
    'request_id', v_row.id,
    'status', v_row.status,
    'requested_access', v_row.requested_access,
    'full_name', v_row.full_name,
    'contact_phone', v_row.contact_phone,
    'requested_at', v_row.requested_at,
    'decided_at', v_row.decided_at,
    'granted_role', v_row.granted_role,
    -- Quien decidio y por que NO se devuelven: al interesado le corresponde
    -- saber el resultado, no el expediente interno del comercio.
    'retry_at', case
                  when v_row.status = 'rejected'
                  then v_row.decided_at + public.business_access_request_retry_delay()
                end,
    'is_member', v_member_role is not null
  );
end;
$$;

comment on function public.get_my_business_access_request(uuid) is
  'Estado de la solicitud propia. Unica lectura disponible para quien todavia no es del equipo.';

-- ===========================================================================
-- 6. Superficie
-- ===========================================================================
-- La tabla no se lee ni se escribe directamente desde ningun cliente. RLS
-- activa y sin politicas: con cero grants la tabla ya es inalcanzable, y la RLS
-- deja escrito que ninguna via futura la abra por descuido.

alter table public.business_access_requests enable row level security;

revoke all privileges on table public.business_access_requests from public, anon, authenticated;

revoke execute on function public.business_access_request_retry_delay() from public, anon, authenticated;
revoke execute on function public.request_business_access(uuid, text, text, text) from public, anon;
revoke execute on function public.get_my_business_access_request(uuid) from public, anon;

grant execute on function public.request_business_access(uuid, text, text, text) to authenticated;
grant execute on function public.get_my_business_access_request(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema');
