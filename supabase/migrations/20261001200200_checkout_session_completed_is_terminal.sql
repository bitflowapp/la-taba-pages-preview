-- Una sesión de checkout completada no vuelve atrás.
--
-- QUÉ SE MIDIÓ (2026-10-01, base limpia con las 159 migraciones anteriores)
--
--   1. `public.checkout_sessions` no tenía ninguna guarda de transición. Sobre una
--      sesión `completed`, con su pedido creado, un UPDATE directo a
--      `manual_review_required`, `payment_pending`, `ready_for_payment`, `cancelled`
--      o `expired` se aceptaba en todos los casos. `payment_intents` sí la tiene
--      (`prevent_payment_intent_status_regression`).
--      Era la puerta por la que un snapshot inválido posterior al pedido dejaba la
--      sesión en `manual_review_required` (cerrada en 20261001200000); el trigger
--      es el resguardo para cualquier otro escritor, presente o futuro.
--   2. `checkout_pipeline_state(text, timestamptz)` estaba declarada IMMUTABLE y
--      llama a `clock_timestamp()`: con argumentos constantes el planificador puede
--      plegar la llamada y congelar «vencido / pendiente» en el plan.
--
-- QUÉ CAMBIA
--
--   · Trigger BEFORE UPDATE `checkout_sessions_guard_completed_terminal`: rechaza
--     sacar una sesión de `completed` y rechaza cambiar o borrar
--     `completed_order_id` una vez escrito. Sólo evalúa filas que ya estaban
--     completadas o ya tenían pedido.
--   · `checkout_pipeline_state` pasa a STABLE. No se copia el cuerpo: ALTER FUNCTION
--     conserva definición, dueño, `search_path` y permisos.
--
-- QUÉ NO CAMBIA
--
--   Entrar a `completed` (la finalización, y la reparación de una sesión con pedido
--   que hubiera quedado en `manual_review_required`) sigue permitido. Los demás
--   estados no tienen regla nueva: `manual_review_required -> payment_approved ->
--   finalizing_order -> completed` (recuperación) y `cancelled/expired ->
--   ready_for_payment` (reintento) son transiciones legítimas hacia atrás en el
--   rango, por eso NO se usa `checkout_session_status_rank`.
--   Excepciones legítimas para salir de `completed`: no se encontró ninguna. Los
--   nueve escritores de `checkout_sessions` o no tocan una sesión completada o la
--   excluyen explícitamente.
--   No toca filas. Una sesión que el defecto anterior ya hubiera sacado de
--   `completed` (queda `manual_review_required` con `completed_order_id` escrito)
--   NO se repara acá: su pedido queda congelado y su estado se puede corregir a
--   mano hacia `completed`; decidir cada caso necesita mirar el pago.
--
-- ORDEN: tiene que aplicarse DESPUÉS de 20261001200000. Con el snapshot anterior, un
-- snapshot inválido sobre una sesión completada chocaría contra este trigger y el
-- trabajo del webhook fallaría en lugar de registrar el evento.
--
-- Forward-only. Reversión:
--   docs/migrations/rollback/20261001200200_checkout_session_completed_is_terminal.rollback.sql

create or replace function public.guard_checkout_session_completed_terminal()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if old.status = 'completed' and new.status is distinct from 'completed' then
    raise exception 'checkout session transition not allowed: completed -> %', new.status
      using errcode = 'PT409',
            detail = 'una sesion completada ya tiene su pedido; el estado es terminal';
  end if;
  if old.completed_order_id is not null and new.completed_order_id is distinct from old.completed_order_id then
    raise exception 'checkout session completed_order_id is immutable once set'
      using errcode = 'PT409',
            detail = 'el pedido de una sesion completada no se cambia ni se desvincula';
  end if;
  return new;
end;
$function$;

-- Función de trigger: ningún rol de cliente (misma regla que 20260816122000 · C).
-- Disparar un trigger no exige EXECUTE: revocarlo no la desconecta.
revoke all on function public.guard_checkout_session_completed_terminal() from public, anon, authenticated;

-- BEFORE UPDATE a secas, no «OF status»: una lista de columnas sólo dispara cuando
-- la columna figura en el SET, y el resguardo tiene que valer también si otro
-- trigger llegara a cambiarla. El WHEN deja afuera todo lo que no terminó.
-- El nombre ordena antes que `checkout_sessions_set_updated_at` y
-- `checkout_sessions_zz_bump_revision`: una transición rechazada no llega a ellos.
drop trigger if exists checkout_sessions_guard_completed_terminal on public.checkout_sessions;
create trigger checkout_sessions_guard_completed_terminal
  before update on public.checkout_sessions
  for each row
  when (old.status = 'completed' or old.completed_order_id is not null)
  execute function public.guard_checkout_session_completed_terminal();

alter function public.checkout_pipeline_state(text, timestamptz) stable;
