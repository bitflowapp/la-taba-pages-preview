-- REVERSIÓN de 20261001192000_customer_cancels_own_unattended_order.sql
--
-- Retira `public.cancel_own_order`. La migración no cambió ninguna otra función.
--
-- Ojo con lo que vuelve: el cliente deja de tener cómo cancelar su pedido; la
-- regla de `change_order_status` que lo permite vuelve a quedar sin puerta. Antes
-- de revertir hay que retirar la llamada del cliente web, o va a recibir un 404
-- de PostgREST. Sólo usar para volver atrás un despliegue.
--
-- Se conserva todo lo ya escrito: los pedidos que cancelaron los clientes siguen
-- `cancelled` con su stock devuelto, y sus eventos `order.cancelled_by_customer`
-- quedan como historia.
--
-- No toca supabase_migrations.schema_migrations. Después:
--   supabase migration repair --status reverted 20261001192000
begin;

drop function public.cancel_own_order(uuid, text, text);

commit;
