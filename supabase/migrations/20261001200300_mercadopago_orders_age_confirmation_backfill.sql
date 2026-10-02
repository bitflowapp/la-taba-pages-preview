-- Relleno: los pedidos de Mercado Pago ya creados reciben la confirmación de edad que
-- su sesión de checkout guardó.
--
-- POR QUÉ
--
--   Hasta 20261001200100 la finalización no copiaba `age_confirmed_at` ni
--   `age_confirmation_policy` al pedido. Los pedidos con alcohol pagados por Mercado
--   Pago quedaron sin el par, y el rider no ve «Verificar mayoría de edad al
--   entregar». El dato está en `checkout_sessions`, unido por `completed_order_id`.
--
-- QUÉ DISPARA ESTE UPDATE (analizado trigger por trigger sobre `public.orders`)
--
--   Sólo se escriben dos columnas y `status` no cambia, así que:
--     · NO corre ningún trigger `UPDATE OF status` (impresión, guardas de
--       cancelación, código de entrega, autoentrega, purga de ubicaciones) ni los
--       de INSERT (notificación de pedido nuevo, vigía del scheduler).
--     · `orders_log_status_event` corre y no escribe: sólo anota cambios de estado.
--     · `orders_set_status_timestamps` y `orders_enforce_rider_active_order_capacity`
--       corren y no hacen nada: ni el estado ni el rider cambian.
--     · `orders_set_operational_defaults` sólo completa campos vacíos que el INSERT
--       ya había completado.
--     · `orders_set_updated_at` y `orders_zz_bump_revision` SÍ actúan:
--       `updated_at` pasa a ahora y `revision` sube en 1. Es lo correcto -la fila
--       cambió y lo que ve el rider cambia-, pero tiene una consecuencia: una
--       acción del Panel o del rider que tenga la revisión anterior recibe una vez
--       el conflicto de revisión y relee, y una sesión de armado o una oferta a
--       rider atadas a esa revisión quedan viejas. Por eso conviene aplicarla con
--       el local cerrado.
--     · `orders_keep_confirmed_delivery_location` (diferido) relee la fila al
--       confirmar y exige el punto de entrega completo. Para que una fila heredada
--       no pueda abortar la migración, se dejan AFUERA los pedidos que no cumplen
--       las dos restricciones NOT VALID de la tabla (punto confirmado incompleto,
--       etiqueta de dirección fuera de largo): esas filas hay que repararlas a mano.
--
-- QUÉ TOCA
--
--   Pedidos `mercadopago` cuya sesión tiene alcohol y el par completo y en rango, y
--   que hoy tienen las dos columnas en NULL. Nada más. Es idempotente: una segunda
--   corrida no encuentra filas. Si una fila falla por cualquier otro motivo, se
--   saltea, se avisa su id y la migración sigue.
--   Con la venta de alcohol apagada (el estado de producción al 2026-08-26, detrás
--   de la licencia) no existen sesiones con alcohol: el relleno no encuentra nada.
--
-- Forward-only. Reversión:
--   docs/migrations/rollback/20261001200300_mercadopago_orders_age_confirmation_backfill.rollback.sql

do $backfill$
declare
  v_row record;
  v_done integer := 0;
  v_skipped integer := 0;
  v_legacy integer := 0;
begin
  select count(*) into v_legacy
    from public.orders o
    join public.checkout_sessions s on s.completed_order_id = o.id
   where o.payment_method = 'mercadopago'
     and s.contains_alcohol
     and o.age_confirmed_at is null
     and o.age_confirmation_policy is null
     and (
       (o.delivery_location_confirmed_at is not null
         and (o.delivery_location_source is null or o.delivery_latitude is null or o.delivery_longitude is null))
       or (o.delivery_address_label is not null
         and char_length(btrim(o.delivery_address_label)) not between 1 and 60)
     );

  for v_row in
    select o.id, s.age_confirmed_at, s.age_confirmation_policy
      from public.orders o
      join public.checkout_sessions s on s.completed_order_id = o.id
     where o.payment_method = 'mercadopago'
       and s.contains_alcohol
       and s.age_confirmed_at is not null
       and s.age_confirmation_policy between 18 and 99
       and o.age_confirmed_at is null
       and o.age_confirmation_policy is null
       and not (o.delivery_location_confirmed_at is not null
         and (o.delivery_location_source is null or o.delivery_latitude is null or o.delivery_longitude is null))
       and not (o.delivery_address_label is not null
         and char_length(btrim(o.delivery_address_label)) not between 1 and 60)
     order by o.created_at, o.id
  loop
    begin
      update public.orders o
         set age_confirmed_at = v_row.age_confirmed_at,
             age_confirmation_policy = v_row.age_confirmation_policy
       where o.id = v_row.id
         and o.age_confirmed_at is null
         and o.age_confirmation_policy is null;
      v_done := v_done + 1;
    exception when others then
      v_skipped := v_skipped + 1;
      raise warning 'age confirmation backfill skipped order % (%)', v_row.id, sqlstate;
    end;
  end loop;

  raise notice 'age confirmation backfill: % order(s) updated, % skipped by error, % left out for legacy constraint violations',
    v_done, v_skipped, v_legacy;
end
$backfill$;
