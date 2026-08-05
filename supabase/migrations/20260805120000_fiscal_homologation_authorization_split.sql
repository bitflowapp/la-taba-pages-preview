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
