-- TABA2 · Capa de identidad, parte 5: alta por invitacion.
--
-- Nadie se da de alta solo. El alta tiene dos actos separados y auditados:
--   1. Autorizacion: un owner (o un admin, con menos alcance) emite una
--      invitacion para un correo y un rol. Esto NO crea todavia ninguna
--      membresia, asi que una invitacion olvidada no deja permisos vivos.
--   2. Toma de posesion: la persona, ya autenticada con su propia cuenta,
--      canjea el token. Recien ahi nace la membresia y su perfil.
--
-- El token se devuelve una sola vez, en la llamada que lo crea. En la base
-- queda solo su sha256: si alguien lee la tabla entera no puede canjear nada.
--
-- Aplicar despues de 20260812040000_identity_session_lifecycle.sql.

create table if not exists public.identity_invitations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  invited_email text not null check (invited_email = lower(btrim(invited_email)) and invited_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  invited_role text not null check (invited_role in ('owner', 'admin', 'staff', 'rider')),
  full_name text not null check (length(btrim(full_name)) between 2 and 120),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid references auth.users(id) on delete set null,
  invited_by_role text check (invited_by_role is null or invited_by_role in ('owner', 'admin')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_user_id uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  constraint identity_invitations_expiry_is_future check (expires_at > created_at),
  constraint identity_invitations_acceptance_is_complete
    check ((accepted_at is null) = (accepted_user_id is null)),
  constraint identity_invitations_not_both_accepted_and_revoked
    check (accepted_at is null or revoked_at is null)
);

-- Una sola invitacion viva por correo y comercio.
create unique index if not exists identity_invitations_one_live_per_email
  on public.identity_invitations(business_id, invited_email)
  where accepted_at is null and revoked_at is null;

create index if not exists identity_invitations_business_idx
  on public.identity_invitations(business_id, created_at desc);

alter table public.identity_invitations enable row level security;
revoke all privileges on table public.identity_invitations from public, anon, authenticated;

-- ===========================================================================
-- Emision
-- ===========================================================================

create or replace function public.identity_create_invitation(
  p_business_id uuid,
  p_email text,
  p_role text,
  p_full_name text,
  p_valid_for interval default interval '7 days'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text := public.identity_require_permission(p_business_id, 'identity.invite');
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_role text := lower(btrim(coalesce(p_role, '')));
  v_name text := btrim(coalesce(p_full_name, ''));
  v_token text;
  v_hash text;
  v_id uuid;
  v_valid interval := greatest(interval '1 hour', least(coalesce(p_valid_for, interval '7 days'), interval '30 days'));
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_email');
  end if;
  if v_role not in ('owner', 'admin', 'staff', 'rider') then
    return jsonb_build_object('ok', false, 'code', 'invalid_role');
  end if;
  if length(v_name) < 2 or length(v_name) > 120 then
    return jsonb_build_object('ok', false, 'code', 'invalid_name');
  end if;

  -- Un admin opera, no arma la conduccion: solo puede invitar staff y riders.
  -- Crear otro owner o otro admin es un acto del owner.
  if v_actor_role = 'admin' and v_role not in ('staff', 'rider') then
    return jsonb_build_object('ok', false, 'code', 'role_above_actor');
  end if;

  if exists (
    select 1
      from public.business_members bm
      join auth.users u on u.id = bm.user_id
     where bm.business_id = p_business_id
       and lower(btrim(u.email)) = v_email
       and bm.is_active = true
  ) then
    return jsonb_build_object('ok', false, 'code', 'already_member');
  end if;

  if exists (
    select 1
      from public.identity_invitations i
     where i.business_id = p_business_id
       and i.invited_email = v_email
       and i.accepted_at is null
       and i.revoked_at is null
       and i.expires_at > now()
  ) then
    return jsonb_build_object('ok', false, 'code', 'invitation_pending');
  end if;

  -- Las invitaciones vencidas del mismo correo no bloquean: se retiran.
  update public.identity_invitations
     set revoked_at = now(), revoked_by = v_actor
   where business_id = p_business_id
     and invited_email = v_email
     and accepted_at is null
     and revoked_at is null;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_hash := encode(digest(v_token, 'sha256'), 'hex');

  insert into public.identity_invitations (
    business_id, invited_email, invited_role, full_name, token_hash,
    invited_by, invited_by_role, expires_at
  ) values (
    p_business_id, v_email, v_role, v_name, v_hash,
    v_actor, v_actor_role, now() + v_valid
  )
  returning id into v_id;

  perform public.identity_record_audit_event(
    p_event_type => 'member_invited',
    p_business_id => p_business_id,
    p_actor_user_id => v_actor,
    p_actor_role => v_actor_role,
    p_session_id => public.identity_session_id(),
    p_metadata => jsonb_build_object(
      'invitation_id', v_id,
      'invited_role', v_role,
      -- El correo no se guarda entero en la auditoria: alcanza el dominio para
      -- reconocer de que alta se trata.
      'email_domain', split_part(v_email, '@', 2)
    )
  );

  -- Unica vez que el token existe en claro. Quien llama lo entrega por el
  -- canal que corresponda; la base ya no lo tiene.
  return jsonb_build_object(
    'ok', true,
    'invitation_id', v_id,
    'token', v_token,
    'expires_at', now() + v_valid,
    'invited_role', v_role
  );
end;
$$;

-- ===========================================================================
-- Canje
-- ===========================================================================
-- Lo llama la propia persona invitada, ya autenticada con su cuenta. El correo
-- del token de la sesion tiene que coincidir con el correo invitado: una
-- invitacion filtrada no sirve en manos de otro.

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
$$;

create or replace function public.identity_revoke_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_inv public.identity_invitations%rowtype;
  v_actor_role text;
begin
  select * into v_inv from public.identity_invitations where id = p_invitation_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  v_actor_role := public.identity_require_permission(v_inv.business_id, 'identity.invite');

  if v_inv.accepted_at is not null then
    return jsonb_build_object('ok', false, 'code', 'already_accepted');
  end if;
  if v_actor_role = 'admin' and v_inv.invited_role not in ('staff', 'rider') then
    return jsonb_build_object('ok', false, 'code', 'role_above_actor');
  end if;

  update public.identity_invitations
     set revoked_at = coalesce(revoked_at, now()), revoked_by = coalesce(revoked_by, v_actor)
   where id = p_invitation_id;

  perform public.identity_record_audit_event(
    p_event_type => 'invitation_revoked',
    p_business_id => v_inv.business_id,
    p_actor_user_id => v_actor,
    p_actor_role => v_actor_role,
    p_session_id => public.identity_session_id(),
    p_metadata => jsonb_build_object('invitation_id', v_inv.id, 'invited_role', v_inv.invited_role)
  );

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.identity_list_invitations(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.identity_require_permission(p_business_id, 'identity.members.read');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'invitation_id', i.id,
             'invited_email', i.invited_email,
             'invited_role', i.invited_role,
             'full_name', i.full_name,
             'created_at', i.created_at,
             'expires_at', i.expires_at,
             'status', case
                         when i.accepted_at is not null then 'accepted'
                         when i.revoked_at is not null then 'revoked'
                         when i.expires_at <= now() then 'expired'
                         else 'pending'
                       end
           ) order by i.created_at desc)
      from public.identity_invitations i
     where i.business_id = p_business_id
  ), '[]'::jsonb);
end;
$$;

-- ===========================================================================
-- Superficie
-- ===========================================================================

revoke execute on function public.identity_create_invitation(uuid, text, text, text, interval) from public, anon;
revoke execute on function public.identity_accept_invitation(text) from public, anon;
revoke execute on function public.identity_revoke_invitation(uuid) from public, anon;
revoke execute on function public.identity_list_invitations(uuid) from public, anon;

grant execute on function public.identity_create_invitation(uuid, text, text, text, interval) to authenticated;
grant execute on function public.identity_accept_invitation(text) to authenticated;
grant execute on function public.identity_revoke_invitation(uuid) to authenticated;
grant execute on function public.identity_list_invitations(uuid) to authenticated;
