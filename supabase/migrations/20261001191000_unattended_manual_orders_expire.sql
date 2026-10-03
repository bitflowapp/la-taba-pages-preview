-- Un pedido en efectivo que nadie atiende deja de retener stock para siempre.
--
-- QUÉ ESTABA ABIERTO (medido el 2026-10-01 en una base PG17 local con las
-- migraciones anteriores)
--
--   El pedido en efectivo / a coordinar descuenta stock al nacer. Si el comercio no
--   lo atiende —Panel cerrado, pedido olvidado, pedido falso— nada lo cierra:
--
--     · un pedido `received` de 3 días, con `abandoned_order_minutes = 30` cargado
--       en el negocio, sigue `received` y sus 2 unidades siguen fuera del stock;
--     · `cron.job` no tiene ningún job que toque `orders`;
--     · `release_expired_stock_reservations` existe desde 20260725060000 pero nadie
--       la llama, y filtra por `orders.reservation_expires_at`, una columna que
--       ningún camino de alta escribe: devuelve 0 siempre;
--     · `businesses.abandoned_order_minutes` no lo leía ninguna función.
--
--   Y si alguien agendara esa función vieja tal como está, haría daño: escribe el
--   estado `canceled` (el alias viejo; todo lo demás escribe `cancelled`), no bloquea
--   los productos en orden y un solo pedido que no se pueda cancelar —uno con el
--   cobro manual ya confirmado— aborta el lote entero, en cada corrida.
--
-- QUÉ QUEDA
--
--   `public.expire_unattended_manual_orders(p_limit)`, agendada cada minuto
--   (`taba-unattended-order-expiry`). Cancela un pedido sólo si cumple TODO esto:
--
--     · estado `received` o `submitted`;
--     · pago `cash` o `coordinate`, con `manual_payment_status = 'pending'`;
--     · sin acuse del comercio (`acknowledged_at is null`);
--     · sin ningún intento de pago de Mercado Pago atado al pedido;
--     · más viejo que `businesses.abandoned_order_minutes`.
--
--   `abandoned_order_minutes` en NULL significa que el negocio NO activó el
--   vencimiento: no vence nada. Cuánto esperar antes de soltar un pedido es una
--   decisión del dueño (la columna ya era suya, entre 5 y 10080 minutos); acá no se
--   inventa un valor por defecto.
--
--   Lo que hace con cada pedido vencido:
--     · devuelve el stock por `private.release_order_inventory` —la misma función
--       que usa la cancelación del comercio—, así que vuelve a ofrecer lo que el
--       comercio no ocultó y nunca devuelve dos veces;
--     · lo deja en `cancelled` (nunca `canceled`) con un UPDATE común: corren todos
--       los triggers de `orders`. Sin sesión, `log_order_status_event` anota el
--       cambio con actor `system`, y los resguardos de cobro confirmado y de pedido
--       pagado siguen valiendo tal cual: no se tocó ninguno;
--     · agrega un evento propio `order.expired_unattended` con el umbral en minutos.
--       Sin datos del cliente.
--
--   Cómo se comporta el lote:
--     · `for update skip locked`: si un operador tiene el pedido tomado en ese
--       instante, el barrido lo saltea y no espera;
--     · cada pedido va en su propio bloque: si uno falla se anota un WARNING y los
--       demás siguen;
--     · correrlo dos veces no hace nada la segunda vez.
--
--   Un pedido que no se puede cerrar no les quita el turno a los demás. Medido con
--   el tope de la corrida en 2 y tres pedidos imposibles de cancelar más viejos que
--   dos sanos: sin memoria, cada corrida gastaba su tope en los mismos tres y los
--   dos sanos no vencían nunca. Por eso el barrido recuerda sus fallos en
--   `private.unattended_order_expiry_failures` (una fila por pedido):
--     · los pedidos que nunca fallaron van primero; los reintentos, al final;
--     · el reintento espera 2, 4, 8, 16, 32 y después 60 minutos: un pedido que no
--       se puede cerrar deja de ocupar la corrida de cada minuto;
--     · la fila guarda cuántas veces falló, desde cuándo, el SQLSTATE y el mensaje
--       del error. No guarda datos del cliente;
--     · se borra sola cuando el pedido por fin vence o deja de ser candidato (el
--       comercio lo tomó, lo cobró o lo canceló).
--   `public.list_unattended_order_expiry_failures()` (sólo servicio) lista lo que el
--   barrido no pudo cerrar: una fila ahí es un pedido que retiene stock y que una
--   persona tiene que mirar. Un fallo de la corrida entera ya lo ve el vigía del
--   planificador, que sigue a todos los jobs `taba-*`.
--
--   `release_expired_stock_reservations` no se borra (figura en el contrato de
--   compatibilidad y en documentación operativa): conserva firma y permisos y pasa
--   a delegar en la función nueva. Deja de existir el camino que escribía `canceled`.
--
-- QUÉ NO CAMBIA
--
--   · Un negocio sin `abandoned_order_minutes` se comporta exactamente como antes.
--   · Un pedido con acuse, aceptado, con cobro confirmado o de Mercado Pago no vence.
--   · `orders.reservation_expires_at` y `businesses.stock_reservation_minutes` siguen
--     sin uso en el pedido manual.
--
-- ANTES DE DESPLEGAR
--
--   La migración no toca filas, pero el job corre dentro del minuto siguiente y, en
--   los negocios que YA tienen `abandoned_order_minutes` cargado, vence todo el
--   atraso que cumpla las condiciones (hasta 100 pedidos por corrida), devuelve su
--   stock y vuelve a ofrecer sus productos. Para ver qué va a vencer:
--
--     select b.name, b.abandoned_order_minutes, count(*) as pedidos
--       from public.orders o
--       join public.businesses b on b.id = o.business_id
--      where o.status in ('received', 'submitted')
--        and o.payment_method in ('cash', 'coordinate')
--        and o.manual_payment_status = 'pending'
--        and o.acknowledged_at is null
--        and b.abandoned_order_minutes is not null
--        and o.created_at < now() - make_interval(mins => b.abandoned_order_minutes)
--        and not exists (select 1 from public.payment_intents pi where pi.order_id = o.id)
--      group by 1, 2;
--
--   Si ese atraso no debe vencer, el dueño deja `abandoned_order_minutes` en NULL
--   antes de aplicar y lo vuelve a cargar cuando quiera activar el vencimiento.
--
-- Forward-only.
-- Reversión: docs/migrations/rollback/20261001191000_unattended_manual_orders_expire.rollback.sql

create extension if not exists pg_cron with schema pg_catalog;

-- Memoria del barrido: qué pedidos no pudo cerrar y cuándo volver a intentarlo.
-- No es historia del pedido (esa vive en `order_events`): es estado de trabajo, y
-- se vacía sola. Sin políticas y sin permisos: sólo la leen y escriben las
-- funciones de esta migración.
create table if not exists private.unattended_order_expiry_failures (
  order_id uuid primary key references public.orders(id) on delete cascade,
  attempts integer not null default 1,
  first_failed_at timestamptz not null default clock_timestamp(),
  last_failed_at timestamptz not null default clock_timestamp(),
  retry_after timestamptz not null,
  last_sqlstate text not null,
  last_error text not null,
  constraint unattended_order_expiry_failures_attempts_positive check (attempts > 0),
  constraint unattended_order_expiry_failures_sqlstate_shape check (last_sqlstate ~ '^[0-9A-Z]{5}$'),
  constraint unattended_order_expiry_failures_error_size check (char_length(last_error) <= 300)
);
alter table private.unattended_order_expiry_failures enable row level security;
revoke all on table private.unattended_order_expiry_failures from public, anon, authenticated;

comment on table private.unattended_order_expiry_failures is
  'Pedidos que el barrido de pedidos sin atender no pudo cancelar: intentos, ultimo error y proximo reintento. Estado de trabajo; se vacia solo cuando el pedido vence o deja de ser candidato.';

create or replace function public.expire_unattended_manual_orders(p_limit integer default 100)
returns integer
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
  v_candidate record;
  v_released integer;
  v_expired integer := 0;
  v_failed integer := 0;
  v_sqlstate text;
  v_error text;
  v_now timestamptz;
begin
  for v_candidate in
    select o.id, o.business_id, o.status, b.abandoned_order_minutes,
           (f.order_id is not null) as failed_before
      from public.orders o
      join public.businesses b on b.id = o.business_id
      left join private.unattended_order_expiry_failures f on f.order_id = o.id
     where o.status in ('received', 'submitted')
       and o.payment_method in ('cash', 'coordinate')
       and o.manual_payment_status = 'pending'
       and o.acknowledged_at is null
       and b.abandoned_order_minutes is not null
       and o.created_at < clock_timestamp() - make_interval(mins => b.abandoned_order_minutes)
       -- Un pedido con un intento de pago no es «sin cobrar»: su cancelación pasa
       -- por el flujo de reembolso, y el trigger de pedidos pagados lo frenaría acá
       -- en cada corrida.
       and not exists (select 1 from public.payment_intents pi where pi.order_id = o.id)
       and (f.order_id is null or f.retry_after <= clock_timestamp())
     -- Primero lo que nunca falló, del más viejo al más nuevo; los reintentos van
     -- al final. Así el tope de fallos de una corrida nunca se gasta en los mismos
     -- pedidos mientras hay otros esperando.
     order by (f.order_id is not null), o.created_at, o.id
     for update of o skip locked
  loop
    -- Dos topes separados: cuántos vencen y cuántos fallos se toleran por corrida.
    exit when v_expired >= v_limit or v_failed >= v_limit;
    begin
      v_released := private.release_order_inventory(v_candidate.id);

      -- La marca de stock devuelto va en el mismo UPDATE que el estado: la revisión
      -- avanza una vez y el evento de estado dice `inventory_released: true`.
      update public.orders
         set status = 'cancelled',
             inventory_released_at = coalesce(inventory_released_at, clock_timestamp())
       where id = v_candidate.id;

      insert into public.order_events (
        order_id, business_id, actor_user_id, actor_role, actor_type,
        event_type, type, message, metadata, payload
      ) values (
        v_candidate.id, v_candidate.business_id, null, 'system', 'system',
        'order.expired_unattended', 'order.expired_unattended',
        'Pedido cancelado automaticamente: el comercio no lo atendio a tiempo.',
        jsonb_build_object(
          'reason', 'unattended_timeout',
          'abandoned_order_minutes', v_candidate.abandoned_order_minutes,
          'previous_status', v_candidate.status,
          'products_released', v_released
        ),
        jsonb_build_object(
          'reason', 'unattended_timeout',
          'abandoned_order_minutes', v_candidate.abandoned_order_minutes,
          'previous_status', v_candidate.status,
          'products_released', v_released
        )
      );

      if v_candidate.failed_before then
        delete from private.unattended_order_expiry_failures where order_id = v_candidate.id;
      end if;

      v_expired := v_expired + 1;
    exception
      when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_error = message_text;
        v_failed := v_failed + 1;
        raise warning 'el pedido % no pudo vencer y sigue como estaba: % (%)',
          v_candidate.id, v_error, v_sqlstate;
        -- Anotar el fallo es accesorio: si esto falla, el lote sigue igual.
        begin
          v_now := clock_timestamp();
          insert into private.unattended_order_expiry_failures as f (
            order_id, attempts, first_failed_at, last_failed_at, retry_after, last_sqlstate, last_error
          ) values (
            v_candidate.id, 1, v_now, v_now, v_now + interval '2 minutes', v_sqlstate, left(v_error, 300)
          )
          on conflict (order_id) do update
             set attempts = f.attempts + 1,
                 last_failed_at = v_now,
                 retry_after = v_now + make_interval(mins => least(60, (2 ^ least(f.attempts + 1, 6))::integer)),
                 last_sqlstate = excluded.last_sqlstate,
                 last_error = excluded.last_error;
        exception
          when others then
            raise warning 'no se pudo anotar el fallo del pedido %: % (%)', v_candidate.id, sqlerrm, sqlstate;
        end;
    end;
  end loop;

  -- Lo que ya no es candidato —el comercio lo tomó, lo cobró o lo cerró— deja de
  -- figurar como fallo pendiente.
  delete from private.unattended_order_expiry_failures f
   where not exists (
     select 1
       from public.orders o
      where o.id = f.order_id
        and o.status in ('received', 'submitted')
        and o.manual_payment_status = 'pending'
        and o.acknowledged_at is null
   );

  return v_expired;
end;
$$;

revoke all on function public.expire_unattended_manual_orders(integer) from public, anon, authenticated;
grant execute on function public.expire_unattended_manual_orders(integer) to service_role;

comment on function public.expire_unattended_manual_orders(integer) is
  'Cancela los pedidos manuales sin atender mas viejos que businesses.abandoned_order_minutes y devuelve su stock; agendada cada minuto por pg_cron. No hace nada en negocios sin ese valor. Lo que no puede cerrar lo anota y lo reintenta con espera creciente.';

-- Lo que el barrido no pudo cerrar. Es la señal para una persona: cada fila es un
-- pedido que sigue reteniendo stock.
create or replace function public.list_unattended_order_expiry_failures()
returns table (
  order_id uuid,
  business_id uuid,
  order_status text,
  order_created_at timestamptz,
  attempts integer,
  first_failed_at timestamptz,
  last_failed_at timestamptz,
  retry_after timestamptz,
  last_sqlstate text,
  last_error text
)
language sql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
  select f.order_id, o.business_id, o.status, o.created_at, f.attempts,
         f.first_failed_at, f.last_failed_at, f.retry_after, f.last_sqlstate, f.last_error
    from private.unattended_order_expiry_failures f
    join public.orders o on o.id = f.order_id
   order by f.first_failed_at, f.order_id;
$$;

revoke all on function public.list_unattended_order_expiry_failures() from public, anon, authenticated;
grant execute on function public.list_unattended_order_expiry_failures() to service_role;

comment on function public.list_unattended_order_expiry_failures() is
  'Pedidos sin atender que el barrido no pudo cancelar: intentos, ultimo error y proximo reintento. Cada fila es stock retenido que necesita una persona.';

-- La función vieja queda como un alias: misma firma, mismos permisos, un solo
-- comportamiento.
create or replace function public.release_expired_stock_reservations(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
begin
  return public.expire_unattended_manual_orders(p_limit);
end;
$$;

revoke all on function public.release_expired_stock_reservations(integer) from public, anon, authenticated;

comment on function public.release_expired_stock_reservations(integer) is
  'Alias historico de expire_unattended_manual_orders: conserva firma y permisos, delega todo.';

do $$
begin
  perform cron.schedule(
    'taba-unattended-order-expiry',
    '* * * * *',
    'select public.expire_unattended_manual_orders(100);'
  );
end;
$$;
