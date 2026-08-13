-- TABA2 · Capa de identidad, parte 2: sesiones logicas y auditoria.
--
-- La clave de todo el diseno de revocacion es un hecho del emisor de tokens,
-- medido contra GoTrue v2.193 antes de escribir esto: el access token lleva un
-- claim `session_id` y ese identificador NO cambia cuando el cliente renueva
-- con el refresh token; lo que rota es el refresh token, no la sesion. Por eso
-- alcanza con marcar una sesion como revocada para que ningun token derivado de
-- ella siga sirviendo, sin depender de que expire nada.
--
-- La revocacion es de dos capas y las dos hacen falta:
--   1. Se borra la fila de auth.sessions. GoTrue responde al refresh siguiente
--      con refresh_token_not_found, asi que la cadena muere. Pero el access
--      token ya emitido sigue siendo criptograficamente valido hasta su exp
--      (una hora por configuracion), y eso es demasiado.
--   2. Se marca revoked_at aca y la compuerta de autorizacion (migracion
--      030000) rechaza ese session_id de inmediato. El token sigue firmado,
--      pero no abre ninguna puerta.
--
-- Aplicar despues de 20260812010000_identity_core_model.sql.

-- ===========================================================================
-- 1. Sesiones logicas
-- ===========================================================================
-- La PK es el session_id de GoTrue. No se guarda ningun token, ni access ni
-- refresh, ni su hash: el servidor no necesita el secreto para revocar.

create table if not exists public.identity_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  role_at_login text not null check (role_at_login in ('owner', 'admin', 'staff', 'rider')),
  client text not null check (client in ('rider_android', 'panel_web', 'unknown')),
  -- Etiqueta legible que el duenio reconoce en la lista ("Moto G15 · Android 15").
  -- No se guarda el user agent crudo: alcanza para reconocer el aparato y no
  -- sirve para perfilar a nadie.
  device_label text check (device_label is null or length(btrim(device_label)) between 2 and 80),
  -- sha256 de un identificador de instalacion generado por el cliente. Agrupa
  -- las sesiones de un mismo aparato sin que el servidor guarde un rastreador
  -- estable en claro.
  device_key_hash text check (device_key_hash is null or device_key_hash ~ '^[0-9a-f]{64}$'),
  app_version text check (app_version is null or length(btrim(app_version)) between 1 and 40),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_reason text check (
    revoked_reason is null
    or revoked_reason in ('owner_revoked', 'revoke_all', 'member_disabled', 'role_changed', 'self_logout')
  ),
  constraint identity_sessions_revocation_is_complete
    check ((revoked_at is null) = (revoked_reason is null))
);

create index if not exists identity_sessions_user_idx
  on public.identity_sessions(user_id, last_seen_at desc);
create index if not exists identity_sessions_business_active_idx
  on public.identity_sessions(business_id, revoked_at, last_seen_at desc);
create index if not exists identity_sessions_device_idx
  on public.identity_sessions(business_id, device_key_hash)
  where device_key_hash is not null;

-- ===========================================================================
-- 2. Auditoria de identidad
-- ===========================================================================
-- Append-only por construccion: nadie tiene update ni delete, ni siquiera las
-- RPC definer. El vocabulario de eventos es cerrado para que la tabla no se
-- convierta en un vertedero de texto libre.

create table if not exists public.identity_audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  business_id uuid references public.businesses(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_role text check (actor_role is null or actor_role in ('owner', 'admin', 'staff', 'rider', 'system')),
  subject_user_id uuid references auth.users(id) on delete set null,
  session_id uuid,
  event_type text not null check (event_type in (
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
    'authorization_denied'
  )),
  -- Metadatos acotados: nunca tokens, contrasenas, correos completos ni
  -- coordenadas. Lo que entra aca lo arma una funcion definer, no el cliente.
  metadata jsonb not null default '{}'::jsonb,
  constraint identity_audit_events_metadata_is_object
    check (jsonb_typeof(metadata) = 'object'),
  constraint identity_audit_events_metadata_is_small
    check (length(metadata::text) <= 2000)
);

create index if not exists identity_audit_events_business_time_idx
  on public.identity_audit_events(business_id, occurred_at desc);
create index if not exists identity_audit_events_subject_time_idx
  on public.identity_audit_events(subject_user_id, occurred_at desc);
create index if not exists identity_audit_events_type_time_idx
  on public.identity_audit_events(event_type, occurred_at desc);

-- La auditoria no se reescribe ni se borra. Se prohibe con trigger ademas de
-- con grants, porque un grant se puede volver a otorgar por descuido y un
-- trigger se nota.
create or replace function public.identity_audit_is_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'identity: la auditoria es solo de agregado (% no permitido)', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists identity_audit_events_append_only on public.identity_audit_events;
create trigger identity_audit_events_append_only
before update or delete on public.identity_audit_events
for each row execute function public.identity_audit_is_append_only();

-- Escritor unico de la auditoria. Definer, para que la tabla no necesite
-- ningun grant de insert hacia authenticated.
create or replace function public.identity_record_audit_event(
  p_event_type text,
  p_business_id uuid default null,
  p_actor_user_id uuid default null,
  p_actor_role text default null,
  p_subject_user_id uuid default null,
  p_session_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  insert into public.identity_audit_events (
    business_id, actor_user_id, actor_role, subject_user_id, session_id, event_type, metadata
  ) values (
    p_business_id,
    p_actor_user_id,
    p_actor_role,
    p_subject_user_id,
    p_session_id,
    p_event_type,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

-- ===========================================================================
-- 3. Superficie
-- ===========================================================================

alter table public.identity_sessions enable row level security;
alter table public.identity_audit_events enable row level security;

revoke all privileges on table public.identity_sessions from public, anon, authenticated;
revoke all privileges on table public.identity_audit_events from public, anon, authenticated;

-- Ni siquiera lectura directa: la lista de sesiones y la auditoria salen por
-- RPC, que ademas filtran por permiso y no devuelven columnas internas.

revoke execute on function public.identity_record_audit_event(text, uuid, uuid, text, uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke execute on function public.identity_audit_is_append_only() from public, anon, authenticated;
