-- TABA2 · La aritmética del pedido tiene que admitir el descuento.
--
-- `20260806250000` agregó `orders.discount_total` y relajó
-- `orders_total_not_below_subtotal`, pero se le pasó la OTRA invariante de
-- dinero del pedido, declarada inline en la primera migración de pedidos
-- (`20260531030000`):
--
--   constraint orders_total_matches_parts check (total = subtotal + delivery_fee)
--
-- Medido sobre staging con un pago real aprobado: el pago de $ 10.650 quedó
-- verificado, la sesión en `payment_approved`, y `finalize_paid_checkout_session`
-- levantaba `23514` en cada intento porque
-- `11700 + 150 <> 10650`. El comprador veía "Confirmando tu pedido" para
-- siempre. La finalización es idempotente y no crea nada a medias, así que el
-- pago quedó verificado y sin pedido duplicado —exactamente lo que la
-- invariante de "un pago, un pedido" promete— pero sin pedido.
--
-- La invariante no se afloja: se completa. El total sigue siendo exactamente la
-- suma de sus partes; lo que cambia es que ahora el descuento es una de ellas.

alter table public.orders drop constraint if exists orders_total_matches_parts;
alter table public.orders
  add constraint orders_total_matches_parts
  check (total = subtotal - discount_total + delivery_fee);

comment on constraint orders_total_matches_parts on public.orders is
  'El total es exactamente subtotal - descuento + envio. El descuento lo decide el backend.';
