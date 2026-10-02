-- REVERSIÓN de 20261001200300_mercadopago_orders_age_confirmation_backfill.sql
--
-- No hay nada que deshacer. La migración no cambió esquema ni funciones: copió a cada
-- pedido de Mercado Pago con alcohol la confirmación de edad que su propia sesión de
-- checkout ya tenía registrada. Ese par es un hecho, vale igual con la finalización
-- anterior, y ningún código depende de que esté en NULL.
--
-- Volver esas columnas a NULL borraría la constancia de la confirmación de edad en el
-- pedido y le quitaría al rider la instrucción de verificarla: es pérdida de dato
-- durable, y además subiría otra vez la revisión de cada pedido. Por eso este archivo
-- no escribe nada.
--
-- No toca supabase_migrations.schema_migrations. Después:
--   supabase migration repair --status reverted 20261001200300
begin;

do $noop$
begin
  raise notice 'age confirmation backfill: nothing to revert, the copied values stay on the orders';
end
$noop$;

commit;
