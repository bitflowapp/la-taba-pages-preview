-- ============================================================================
-- DOS INVARIANTES QUE NO RESISTÍAN UN NULL
-- ============================================================================
--
-- Los encontró la certificación en vivo de la preparación de la apertura
-- (scripts/controlled-production/opening-cert.mjs) sobre el tenant QA de CP.
--
-- 1 · UNA CUENTA QUE ACEPTÓ UNA INVITACIÓN NO SE PODÍA BORRAR
-- ------------------------------------------------------------
-- `identity_invitations.accepted_user_id` declara `on delete set null` y el
-- CHECK `identity_invitations_acceptance_is_complete` exigía
-- `(accepted_at is null) = (accepted_user_id is null)`. Borrar la cuenta ponía
-- el usuario en NULL con `accepted_at` cargado: el CHECK fallaba y GoTrue
-- contestaba 500 «Database error deleting user». Cualquier persona que entró
-- al equipo por invitación (encargado, empleado, repartidor, el dueño) quedaba
-- sin baja posible por Auth, que es la vía del tablero de Supabase y la de un
-- pedido de supresión de datos personales. Es el mismo tipo de defecto que
-- corrigió 20260817040000 para las membresías.
--
-- Ahora: un usuario sin aceptación sigue prohibido; una aceptación cuyo usuario
-- se borró queda como constancia (`accepted_at`) sin a quién apuntar. La
-- invitación sigue sin estar «viva» (el índice único mira `accepted_at`), así
-- que el mismo correo se puede volver a invitar.
--
-- 2 · LA POLÍTICA DE ALCOHOL SE PODÍA ENCENDER SIN EDAD MÍNIMA
-- --------------------------------------------------------------
-- `businesses_alcohol_policy_complete` decía `alcohol_minimum_age between 18
-- and 99`. Con la edad en NULL esa expresión es NULL, y un CHECK que da NULL
-- PASA. Encender la venta con la edad vacía era aceptado. `create_order` y el
-- checkout ya rechazan alcohol con la edad vacía, pero la planilla y el Panel
-- miran sólo el interruptor para publicar: un producto con alcohol podía
-- aparecer en la tienda sin poder venderse. Ahora el interruptor encendido
-- exige la política completa, de verdad.
--
-- Antes de aplicar se comprobó en CP (sólo lectura): 0 comercios con alcohol
-- encendido, 0 invitaciones con usuario y sin aceptación. Las dos
-- restricciones nuevas validan sobre las filas existentes.
--
-- REVERSIÓN: docs/migrations/rollback/20260928170000_identity_and_alcohol_invariants_null_safe.rollback.sql
-- ============================================================================

alter table public.identity_invitations
  drop constraint identity_invitations_acceptance_is_complete,
  add constraint identity_invitations_acceptance_is_complete
    check (accepted_user_id is null or accepted_at is not null);

comment on constraint identity_invitations_acceptance_is_complete on public.identity_invitations is
  'Un usuario aceptante exige la fecha de aceptación. La aceptación sobrevive al borrado de la cuenta (accepted_user_id pasa a NULL por la FK) como constancia.';

alter table public.businesses
  drop constraint businesses_alcohol_policy_complete,
  add constraint businesses_alcohol_policy_complete check (
    not alcohol_sales_enabled
    or (
      alcohol_minimum_age is not null
      and alcohol_minimum_age between 18 and 99
      and alcohol_sales_start is not null
      and alcohol_sales_end is not null
      and alcohol_timezone is not null
      and btrim(alcohol_timezone) <> ''
    )
  );

comment on constraint businesses_alcohol_policy_complete on public.businesses is
  'La venta de alcohol encendida exige edad mínima (18 a 99, nunca vacía), franja y huso horario.';
