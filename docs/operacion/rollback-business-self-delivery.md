# Rollback 20260919120000

Este procedimiento revierte el contrato de reparto propio y “finalizados hoy”.
No modifica conexiones de Mercado Pago, eventos históricos ni el ledger de
migraciones.

## Preflight

1. Detener el rollout web y registrar los SHAs desplegados de web, DB y Edge.
2. Poner el panel en mantenimiento y evitar comandos nuevos durante el cambio.
3. Generar un backup verificable de la base y registrar el hash del archivo.
4. Confirmar que no haya repartos propios activos:

   ```sql
   select id, public_code
   from public.orders
   where delivery_mode = 'delivery'
     and assigned_rider_user_id is null
     and public.normalize_order_status_vocabulary(status) = 'on_the_way';
   ```

   Terminar cada pedido con el código del cliente o cancelarlo por el flujo
   operativo. El SQL de rollback también verifica esta condición y aborta.

5. Contar y guardar checksums de `order_events`, `order_delivery_handoffs`,
   `delivery_confirmation_attempts`, `business_command_receipts` y
   `mp_seller_connections`.

## Ejecución

1. Revertir primero la web al SHA anterior. La web anterior funciona con la DB
   nueva para retiro, pero no conoce la RPC de reparto propio.
2. Ejecutar en una única transacción
   `docs/migrations/rollback/20260919120000_business_self_delivery_and_finished_today.rollback.sql`.
3. Confirmar la transacción sólo si desaparecieron las cuatro firmas nuevas,
   los dos triggers nuevos y `change_order_status(uuid,text,text)` coincide con
   la definición previa cuyo SHA-256 es
   `16547d986eebd2a056da6ab4f5de6918c52ba4a262d0014b107eaa7448f8894a`.
4. Verificar que `anon` y `authenticated` no ejecuten `change_order_status` y
   que `service_role` sí pueda hacerlo.

## Historial y datos

No borrar ni alterar `supabase_migrations.schema_migrations`. El rollback es una
migración compensatoria: se crea con una versión posterior, se revisa y se
aplica por el canal normal. La versión forward continúa registrada como hecho
histórico y la compensatoria registra la reversión.

Las filas de eventos, handoffs, intentos, recibos de comando y conexiones OAuth
se preservan. Los pedidos que comenzaron durante el release deben completarse o
cancelarse antes del rollback; el guard impide retirar el contrato en medio de
una entrega.

Las Edge Functions de Mercado Pago no forman parte de este release. No se
redepliegan ni se revierten. Después del rollback se validan login, panel,
pedidos activos, retiro y Mercado Pago “No conectado”.

## Drill

`scripts/run-release-v5-db.mjs` ejecuta el forward en PostgreSQL aislado,
demuestra que el guard bloquea con un reparto propio en curso y luego ejecuta el
rollback limpio. Verifica la definición previa, privilegios, conservación de
datos y ledger, y finalmente revierte la transacción para continuar el drill de
backup/restore.
