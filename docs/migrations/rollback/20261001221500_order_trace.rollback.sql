-- REVERSIÓN de 20261001221500_order_trace.sql
--
-- Retira la traza de pedidos: las dos puertas (`get_order_trace`,
-- `get_order_trace_service`), sus piezas privadas y los cuatro índices.
--
-- Ojo con lo que vuelve a quedar abierto: diagnosticar un pedido vuelve a pedir la
-- clave de servicio y unir a mano las tablas que tienen nombre, teléfono y
-- domicilio del cliente. Si el Panel ya llama a `get_order_trace`, esa pantalla
-- deja de responder: revertir primero el Panel.
--
-- No se pierde nada durable: la migración no crea tablas ni escribe filas. Los
-- índices se pueden volver a crear en cualquier momento.
--
-- No depende de las otras migraciones de la entrega ni ellas de ésta: se puede
-- revertir sola.
--
-- No toca supabase_migrations.schema_migrations. Después:
--   supabase migration repair --status reverted 20261001221500
begin;

drop function if exists public.get_order_trace(uuid, text);
drop function if exists public.get_order_trace_service(text, uuid);
drop function if exists private.order_trace_document(uuid, text);
drop function if exists private.order_trace_uuid(text);
drop function if exists private.order_trace_code(text);
drop function if exists private.order_trace_safe_details(jsonb, text[]);
drop function if exists private.order_trace_actor_ref(uuid, uuid);

drop index if exists public.inventory_movements_reference_idx;
drop index if exists public.payment_webhook_receipts_resource_idx;
drop index if exists public.payment_intents_order_idx;
drop index if exists public.checkout_sessions_completed_order_idx;

commit;
