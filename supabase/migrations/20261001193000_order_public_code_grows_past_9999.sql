-- El código público del pedido no se termina en LT-9999.
--
-- QUÉ ESTABA ABIERTO (medido el 2026-10-01 en una base PG17 local con las
-- migraciones anteriores)
--
--   `next_order_public_code()` armaba el código con
--   `lpad(nextval(...)::text, 4, '0')`. En PostgreSQL `lpad` no sólo rellena:
--   también RECORTA lo que no entra.
--
--     lpad('9999', 4, '0')   = '9999'
--     lpad('10000', 4, '0')  = '1000'
--     lpad('10001', 4, '0')  = '1000'
--
--   Con la secuencia en 10000, dos pedidos seguidos por la RPC pública salieron
--   como `LT-1000` y `LT-1001` (la secuencia quedó en 10010: el segundo pedido
--   gastó diez valores hasta encontrar un código libre). `orders.code` es único en
--   toda la base y los dos caminos que crean pedidos buscan un código libre en un
--   lazo sin tope. A partir del pedido 10.000:
--
--     · los códigos se repiten con los de los primeros meses, fuera de orden;
--     · cada alta gasta 10, 100, 1000… valores de secuencia para encontrar un
--       hueco, con los productos del pedido bloqueados mientras busca;
--     · cuando ya no quedan huecos entre LT-1000 y LT-9999 el lazo no termina:
--       no entra ningún pedido más, y un pago aprobado de Mercado Pago no puede
--       convertirse en pedido.
--
-- QUÉ CAMBIA
--
--   La función deja de recortar. Hasta 9999 devuelve exactamente lo mismo que
--   antes (`LT-0001` … `LT-9999`); desde ahí el código crece: `LT-10000`,
--   `LT-10001`, …
--
-- QUÉ NO CAMBIA
--
--   · La secuencia, su valor actual y los códigos ya emitidos.
--   · `create_order_with_items_core` y `finalize_paid_checkout_session`: sus lazos
--     siguen igual; con un generador que no repite, salen en la primera vuelta.
--   · SECURITY INVOKER, sin `search_path` propio y sin EXECUTE para ningún rol de
--     cliente, como estaba.
--
-- Antes de aplicar en un ambiente conviene mirar
-- `select last_value from public.order_public_code_seq`: si ya pasó de 9999 hay
-- códigos de cuatro dígitos repetidos fuera de orden en el historial. No hay
-- conflicto —el generador sigue desde el valor actual— pero conviene saberlo.
--
-- Forward-only. No toca filas.
-- Reversión: docs/migrations/rollback/20261001193000_order_public_code_grows_past_9999.rollback.sql

create or replace function public.next_order_public_code()
returns text
language sql
as $$
  select 'LT-' || case when n < 10000 then lpad(n::text, 4, '0') else n::text end
    from nextval('public.order_public_code_seq') as n
$$;

revoke all on function public.next_order_public_code() from public, anon, authenticated;
