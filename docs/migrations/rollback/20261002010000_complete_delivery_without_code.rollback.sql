-- REVERSIÓN de 20261002010000_complete_delivery_without_code.sql
--
-- Quita `complete_delivery_without_code` y devuelve `prevent_unverified_delivery` a
-- su definición anterior (el cuerpo de abajo es el de `pg_get_functiondef` sobre la
-- base anterior a la migración, sin tocar).
--
-- Ojo con lo que vuelve a quedar abierto: un pedido con envío que ya salió y cuyo
-- código no aparece, o cuyo repartidor ya no puede actuar, vuelve a tener una sola
-- salida, que es cancelarlo.
--
-- El rastro NO se pierde. Si ninguna entrega se cerró sin código,
-- `order_delivery_overrides` se va (no hay nada que conservar y el esquema queda
-- como antes). Si tiene filas, la tabla QUEDA, sin permisos de escritura para nadie:
-- es el único registro de quién cerró cada entrega, por qué y cómo estaba el código
-- en ese momento. Por eso este archivo no necesita negarse a correr: no hay camino
-- en el que borre un dato durable. Los eventos `order.delivered_without_code` de
-- `order_events` y los recibos del comando en `business_command_receipts` (con la
-- nota del operador) tampoco se tocan.
--
-- Los pedidos ya cerrados sin código siguen entregados: el resguardo mira la
-- transición, no el pasado. Volver a aplicar la migración después conserva las
-- filas que hayan quedado.
--
-- No toca supabase_migrations.schema_migrations. Después:
--   supabase migration repair --status reverted 20261002010000
begin;


-- Se niega a correr si otra migración redefinió alguna de estas funciones después de
-- 20261002010000: su cuerpo vivo tiene que ser el que dejó esa migración o el anterior
-- (el anterior permite correr la reversión dos veces).
do $redefinition_guard$
declare
  v_row record;
  v_actual text;
begin
  for v_row in
    select * from (values
      ('public.prevent_unverified_delivery()', '269b6375af15863ee9567b66a90ea990', 'ef1794358c4d34fb997977fa58b05103')
    ) as t(signature, applied, previous)
  loop
    select md5(replace(p.prosrc, E'\r', '')) into v_actual
      from pg_proc p where p.oid = to_regprocedure(v_row.signature);
    if v_actual is null or v_actual not in (v_row.applied, v_row.previous) then
      raise exception 'ROLLBACK_BLOCKED: % no tiene el cuerpo de 20261002010000 ni el anterior; otra migracion la redefinio despues: revertir esa primero', v_row.signature
        using errcode = 'P0001';
    end if;
  end loop;
end
$redefinition_guard$;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('la-taba:rollback:20261002010000', 0)
);

-- Primero el comando: desde acá nadie puede dejar una marca nueva.
drop function if exists public.complete_delivery_without_code(uuid, bigint, text, text, text);

CREATE OR REPLACE FUNCTION public.prevent_unverified_delivery()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
begin
  if new.status = 'delivered'
    and old.status is distinct from 'delivered'
    and new.delivery_mode = 'delivery'
    and new.delivery_code_required
    and not exists (
      select 1
        from public.order_delivery_handoffs h
       where h.order_id = new.id
         and h.confirmed_at is not null
    ) then
    raise exception 'codigo de entrega no confirmado' using errcode = '55000';
  end if;
  return new;
end;
$function$;

revoke all on function public.prevent_unverified_delivery() from public, anon, authenticated, service_role;
-- Antes de 20261002010000 la función de disparador tenía EXECUTE para service_role (privilegios por
-- defecto del proyecto; así está en Staging y en CONTROLLED PRODUCTION, leído el 2026-10-03). La migración
-- se lo saca (un disparador no lo necesita); la reversión se lo devuelve para dejar el esquema idéntico.
grant execute on function public.prevent_unverified_delivery() to service_role;

-- La tabla de marcas: se va sólo si está vacía.
do $marks$
declare
  v_rows bigint := 0;
begin
  if to_regclass('public.order_delivery_overrides') is null then
    return;
  end if;
  -- Nadie puede estar escribiendo: el comando ya no existe en esta transacción.
  lock table public.order_delivery_overrides in access exclusive mode;
  execute 'select count(*) from public.order_delivery_overrides' into v_rows;
  if v_rows = 0 then
    execute 'drop table public.order_delivery_overrides';
  else
    raise notice 'order_delivery_overrides conserva % fila(s): la tabla queda como registro de las entregas cerradas sin codigo', v_rows;
  end if;
end
$marks$;

commit;
