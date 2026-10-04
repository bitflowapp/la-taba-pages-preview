-- REVERSIÓN de 20261001193000_order_public_code_grows_past_9999.sql
--
-- Devuelve `next_order_public_code()` al cuerpo anterior (el de 20260601205707),
-- tal como lo imprime pg_get_functiondef.
--
-- Ojo con lo que vuelve: el generador vuelve a RECORTAR a cuatro dígitos. Mientras
-- la secuencia esté por debajo de 9999 no se nota. Desde el pedido 10.000 repite
-- códigos y el alta de pedidos —y la conversión de un pago aprobado en pedido—
-- deja de poder encontrar un código libre.
--
-- Por eso se niega a correr si la secuencia ya llegó a 9999 o si ya existe un
-- pedido con un código de más de cuatro dígitos: con el generador viejo, esos
-- ambientes dejan de tomar pedidos.
--
-- No toca filas ni la secuencia.
-- No toca supabase_migrations.schema_migrations. Después:
--   supabase migration repair --status reverted 20261001193000
begin;

do $guard$
declare
  v_last bigint;
  v_long integer;
begin
  select last_value into v_last from public.order_public_code_seq;
  if v_last >= 9999 then
    raise exception 'ROLLBACK_BLOCKED: la secuencia de codigos esta en %; el generador anterior recorta desde 10000 y el alta de pedidos dejaria de funcionar', v_last;
  end if;
  select count(*) into v_long from public.orders o where o.code ~ '^LT-[0-9]{5,}$';
  if v_long > 0 then
    raise exception 'ROLLBACK_BLOCKED: % pedido(s) ya tienen codigo de mas de cuatro digitos', v_long;
  end if;
end
$guard$;

CREATE OR REPLACE FUNCTION public.next_order_public_code()
 RETURNS text
 LANGUAGE sql
AS $function$
  select 'LT-' || lpad(nextval('public.order_public_code_seq')::text, 4, '0')
$function$;

revoke all on function public.next_order_public_code() from public, anon, authenticated;

commit;
