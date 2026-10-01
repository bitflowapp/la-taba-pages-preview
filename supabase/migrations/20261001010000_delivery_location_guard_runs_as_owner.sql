-- El resguardo del punto de entrega no puede depender de quién confirma la transacción.
--
-- `enforce_confirmed_delivery_location()` respalda los dos triggers de restricción
-- DIFERIDOS de `orders` (20260808190000):
--
--   orders_require_confirmed_delivery_location   after insert
--   orders_keep_confirmed_delivery_location      after update, si ya había punto confirmado
--
-- Un trigger diferido no corre dentro de la sentencia: corre al COMMIT, con el rol
-- de la SESIÓN. Y la función era SECURITY INVOKER y relee la fila de `public.orders`.
-- Medido en Staging el 2026-10-01 y reproducido en una base limpia con las 157
-- migraciones anteriores:
--
--   1. No se podía dar de baja a un cliente con un pedido delivery. Auth borra el
--      usuario como `supabase_auth_admin`; la baja cae en cascada por
--      `customers` → `customer_addresses` → `orders.customer_address_id`
--      (ON DELETE SET NULL), que es un UPDATE del pedido. Al confirmar, el trigger
--      diferido relee `public.orders` con el rol de Auth, que no tiene privilegios
--      sobre esa tabla: «permission denied for table orders», la transacción entera
--      se deshace y Auth responde 500 «Database error deleting user». Un cliente con
--      sólo retiros sí se borraba: sus pedidos no tienen punto confirmado y el
--      trigger ni se dispara.
--   2. Con un rol que sí tiene el privilegio pero al que RLS le esconde la fila, la
--      relectura no encontraba nada y el resguardo se salteaba en silencio
--      (`if not found then return null`): la garantía dependía de quién miraba.
--
-- La función pasa a correr como su dueño, igual que su hermana
-- `assert_order_payment_modality()`. No se copia el cuerpo: ALTER FUNCTION conserva
-- definición, dueño y `search_path`, así que el contrato del punto confirmado es
-- exactamente el mismo; lo único que cambia es que ahora vale para todos.
--
-- Forward-only. No toca filas.
-- Reversión: `alter function public.enforce_confirmed_delivery_location() security invoker;`

alter function public.enforce_confirmed_delivery_location() security definer;

-- Función de trigger: ningún rol de cliente (misma regla que 20260816122000 · C).
-- Disparar un trigger no exige EXECUTE: revocarlo no la desconecta.
revoke all on function public.enforce_confirmed_delivery_location()
  from public, anon, authenticated;

-- Falla cerrada: ningún trigger diferido de las tablas de la aplicación puede
-- quedar atado a una función que corra con el rol de la sesión, ni a una
-- SECURITY DEFINER sin `search_path` fijado.
do $delivery_location_guard$
declare
  v_offenders text;
begin
  select string_agg(format('%s.%s -> %s', c.relname, t.tgname, p.oid::regprocedure), ', ' order by c.relname, t.tgname)
    into v_offenders
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
   where not t.tgisinternal
     and t.tgdeferrable
     and n.nspname in ('public', 'private')
     and (
       not p.prosecdef
       or not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')
     );
  if v_offenders is not null then
    raise exception 'deferred constraint triggers must run as their owner with a pinned search_path: %', v_offenders;
  end if;
end
$delivery_location_guard$;
