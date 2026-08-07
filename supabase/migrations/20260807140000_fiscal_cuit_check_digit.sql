-- Un CUIT cuyo dígito verificador no cierra no es un CUIT: es un error de tipeo.
--
-- El perfil fiscal validaba once dígitos y nada más, así que '00000000000' se
-- guardaba como CUIT habilitado. El costo de no verificarlo no se paga acá: se
-- paga con un certificado ya emitido por ARCA para el CUIT equivocado, y ese
-- viaje a WSASS no se deshace.
--
-- No es una regla del manual WSFEv1 —ARCA valida el CUIT contra el padrón— pero
-- el dígito verificador es la definición de un CUIT bien formado.
--
-- Va como trigger y no como constraint de tabla a propósito: sólo alcanza a lo
-- que se escriba de ahora en más, y no invalida una fila que ya exista.

create or replace function public.fiscal_cuit_is_valid(p_cuit text)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $fiscal_cuit_is_valid$
declare
  v_weights constant integer[] := array[5,4,3,2,7,6,5,4,3,2];
  v_sum integer := 0;
  v_index integer;
  v_remainder integer;
  v_expected integer;
begin
  if p_cuit is null or p_cuit !~ '^[0-9]{11}$' then return false; end if;
  for v_index in 1..10 loop
    v_sum := v_sum + (substr(p_cuit, v_index, 1))::integer * v_weights[v_index];
  end loop;
  v_remainder := v_sum % 11;
  v_expected := case when v_remainder = 0 then 0 when v_remainder = 1 then 9 else 11 - v_remainder end;
  return v_expected = (substr(p_cuit, 11, 1))::integer;
end;
$fiscal_cuit_is_valid$;

comment on function public.fiscal_cuit_is_valid(text) is
  'Dígito verificador del CUIT (módulo 11). No reemplaza la validación de ARCA contra el padrón.';

revoke execute on function public.fiscal_cuit_is_valid(text) from public, anon, authenticated;
grant execute on function public.fiscal_cuit_is_valid(text) to authenticated, service_role;

create or replace function public.assert_fiscal_profile_cuit_is_valid()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $assert_fiscal_profile_cuit$
begin
  -- Un perfil deshabilitado puede estar a medio cargar; uno habilitado, no.
  if new.is_enabled and new.environment <> 'disabled' and not public.fiscal_cuit_is_valid(new.cuit) then
    raise exception 'fiscal_cuit_check_digit_invalid' using errcode = '22023';
  end if;
  return new;
end;
$assert_fiscal_profile_cuit$;

drop trigger if exists fiscal_profiles_validate_cuit on public.fiscal_profiles;
create trigger fiscal_profiles_validate_cuit
before insert or update of cuit, is_enabled, environment on public.fiscal_profiles
for each row execute function public.assert_fiscal_profile_cuit_is_valid();
