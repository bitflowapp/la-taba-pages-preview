-- REVERSIÓN de 20260928170000_identity_and_alcohol_invariants_null_safe.sql
--
-- Devuelve las dos restricciones a su definición anterior. No toca filas.
--
-- Se NIEGA si ya hay una invitación aceptada cuya cuenta se borró: la
-- restricción anterior no la admite y habría que inventar un usuario para
-- volver atrás. En ese caso la reversión no es posible sin decidir qué hacer
-- con esa constancia (ROLLBACK_BLOCKED).
--
-- Ojo: con la definición anterior, una cuenta que aceptó una invitación vuelve
-- a no poder borrarse por Auth y la venta de alcohol vuelve a poder encenderse
-- con la edad vacía.
begin;

do $rollback_guard$
begin
  if exists (select 1 from public.identity_invitations where accepted_at is not null and accepted_user_id is null) then
    raise exception 'ROLLBACK_BLOCKED: hay invitaciones aceptadas cuya cuenta ya se borró'
      using errcode = '55000';
  end if;
end;
$rollback_guard$;

alter table public.identity_invitations
  drop constraint identity_invitations_acceptance_is_complete,
  add constraint identity_invitations_acceptance_is_complete
    check ((accepted_at is null) = (accepted_user_id is null));

comment on constraint identity_invitations_acceptance_is_complete on public.identity_invitations is null;

alter table public.businesses
  drop constraint businesses_alcohol_policy_complete,
  add constraint businesses_alcohol_policy_complete check (
    not alcohol_sales_enabled
    or (
      alcohol_minimum_age between 18 and 99
      and alcohol_sales_start is not null
      and alcohol_sales_end is not null
      and alcohol_timezone is not null
      and btrim(alcohol_timezone) <> ''
    )
  );

comment on constraint businesses_alcohol_policy_complete on public.businesses is null;

commit;
