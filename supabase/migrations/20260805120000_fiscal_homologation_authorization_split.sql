-- Separa tres cosas que el gate anterior había fundido en una sola:
--   1. configurar un perfil fiscal para homologación,
--   2. autorizar explícitamente una operación de homologación,
--   3. ejecutar realmente una operación fiscal.
-- Guardar "Datos fiscales" o elegir homologación es configuración. No equivale a autorizar ARCA.

-- ===== 1. El gate anterior confundía configurar con autorizar =====
-- fiscal_profiles_homologation_gate exigía autorización registrada para que el perfil pudiera
-- siquiera quedar en 'homologation'. Pero configure_fiscal_profile escribe el perfil dejando las
-- columnas de autorización en null, y authorize_arca_homologation exige que los datos fiscales ya
-- estén guardados para poder autorizar. El resultado era una dependencia circular: nadie podía
-- configurar homologación y nadie podía autorizarla. La base debe admitir el estado intermedio
-- honesto: perfil configurado para homologación, todavía sin autorizar.

-- Una autorización a medias nunca fue una autorización: se descarta antes de endurecer el par.
-- No se inventa fecha ni actor; se borra el resto incompleto.
update public.fiscal_profiles
set homologation_authorized_at = null,
    homologation_authorized_by = null,
    updated_at = now()
where (homologation_authorized_at is null) <> (homologation_authorized_by is null);

alter table public.fiscal_profiles drop constraint if exists fiscal_profiles_homologation_gate;

-- La autorización viaja completa o no viaja: fecha y actor juntos, o ambos ausentes.
-- Se valida sobre los datos existentes; no se usa NOT VALID para esconder filas incompatibles.
alter table public.fiscal_profiles drop constraint if exists fiscal_profiles_homologation_authorization_pairing;
alter table public.fiscal_profiles add constraint fiscal_profiles_homologation_authorization_pairing check (
  (homologation_authorized_at is null and homologation_authorized_by is null)
  or (homologation_authorized_at is not null and homologation_authorized_by is not null)
);

comment on constraint fiscal_profiles_homologation_authorization_pairing on public.fiscal_profiles is
  'La autorización de homologación se registra completa (fecha y actor) o no se registra. Configurar el entorno de homologación no autoriza nada por sí solo.';

comment on column public.fiscal_profiles.homologation_authorized_at is
  'Momento en que una persona autorizó explícitamente las pruebas con ARCA. Null significa configurado pero no autorizado.';
comment on column public.fiscal_profiles.homologation_authorized_by is
  'Quién autorizó las pruebas con ARCA. Null significa configurado pero no autorizado.';

-- ===== 2. El guard se mueve a donde ocurre la operación real =====
-- Antes, la autorización quedaba garantizada sólo de forma implícita por el constraint del perfil.
-- Al admitir el estado intermedio, la exigencia pasa a la ruta que emite de verdad: todo
-- comprobante fiscal nace en public.fiscal_documents, así que ahí se verifica y ahí falla cerrado.
create or replace function public.assert_fiscal_execution_authorized()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $assert_fiscal_execution_authorized$
declare
  v_profile public.fiscal_profiles%rowtype;
begin
  select * into v_profile from public.fiscal_profiles where business_id = new.business_id for share;
  if not found then
    raise exception 'operacion fiscal no autorizada' using errcode = '42501';
  end if;

  if new.environment = 'homologation'
     and (v_profile.homologation_authorized_at is null or v_profile.homologation_authorized_by is null) then
    raise exception 'homologacion no autorizada' using errcode = '42501';
  end if;

  if new.environment = 'production'
     and (v_profile.accountant_review_status is distinct from 'approved'
          or v_profile.production_gate_status is distinct from 'approved') then
    raise exception 'produccion fiscal no autorizada' using errcode = '42501';
  end if;

  return new;
end;
$assert_fiscal_execution_authorized$;

comment on function public.assert_fiscal_execution_authorized() is
  'Exige autorización humana registrada antes de emitir un comprobante. Los mensajes son estables y saneados: no exponen constraints ni SQL.';

drop trigger if exists fiscal_documents_require_execution_authorization on public.fiscal_documents;
create trigger fiscal_documents_require_execution_authorization
  before insert on public.fiscal_documents
  for each row execute function public.assert_fiscal_execution_authorized();

-- ===== 3. Registrar la autorización era imposible =====
-- authorize_arca_homologation insertaba en public.fiscal_events (business_id, fiscal_document_id,
-- event_type, detail). Esa tabla no tiene business_id ni detail, y exige fiscal_document_id not null.
-- Autorizar una homologación no emite ningún comprobante, así que nunca hubo documento al que colgar
-- el evento: la función moría con 42703 y la autorización no podía registrarse jamás. Los eventos que
-- son del perfil, y no de un comprobante, viven en su propia tabla.

create table if not exists public.fiscal_profile_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  event_type text not null check (event_type in ('homologation_authorized')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists fiscal_profile_events_business_idx
  on public.fiscal_profile_events (business_id, created_at desc);

alter table public.fiscal_profile_events enable row level security;

grant select on table public.fiscal_profile_events to authenticated;

drop policy if exists "business reads fiscal profile events" on public.fiscal_profile_events;
create policy "business reads fiscal profile events" on public.fiscal_profile_events
for select to authenticated using (public.is_business_member(business_id));

-- Misma autorización explícita de siempre: la frase exacta, la revisión contable y el certificado.
-- Lo único que cambia es que ahora el rastro se puede escribir.
create or replace function public.authorize_arca_homologation(
  p_business_id uuid,
  p_authorization text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $authorize_arca_homologation$
declare
  v_profile public.fiscal_profiles%rowtype;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'autorizacion fiscal requiere owner o admin' using errcode = '42501';
  end if;
  if p_authorization is distinct from 'I_AUTHORIZE_ARCA_HOMOLOGATION' then
    raise exception 'autorizacion de homologacion ausente' using errcode = '22023';
  end if;

  select * into v_profile from public.fiscal_profiles where business_id = p_business_id for update;
  if not found then
    raise exception 'perfil fiscal inexistente' using errcode = 'P0002';
  end if;
  if v_profile.accountant_review_status <> 'approved' then
    raise exception 'falta la aprobacion contable' using errcode = 'P0001';
  end if;
  if coalesce(v_profile.cuit, '') !~ '^[0-9]{11}$'
     or coalesce(v_profile.point_of_sale, 0) < 1
     or coalesce(btrim(v_profile.legal_name), '') = ''
     or coalesce(btrim(v_profile.tax_condition), '') = '' then
    raise exception 'faltan datos fiscales obligatorios' using errcode = '22023';
  end if;
  if v_profile.certificate_fingerprint_sha256 is null then
    raise exception 'falta el certificado' using errcode = 'P0001';
  end if;
  if v_profile.certificate_expires_at is not null and v_profile.certificate_expires_at <= clock_timestamp() then
    raise exception 'certificado vencido' using errcode = 'P0001';
  end if;

  update public.fiscal_profiles set
    environment = 'homologation',
    is_enabled = true,
    homologation_authorized_at = clock_timestamp(),
    homologation_authorized_by = auth.uid(),
    updated_at = now()
  where business_id = p_business_id
  returning * into v_profile;

  insert into public.fiscal_profile_events (business_id, event_type, actor_id, detail)
  values (p_business_id, 'homologation_authorized', auth.uid(), jsonb_build_object('environment', v_profile.environment));

  return jsonb_build_object('ok', true, 'environment', v_profile.environment);
end;
$authorize_arca_homologation$;
