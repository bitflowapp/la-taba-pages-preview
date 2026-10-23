# Operación de QA y preparación de la ronda auténtica

Sólo Supabase `ixewllzzuzpqrkxzmfzx`, aplicación MP `2691240967769590`, ambiente `test`.
Este documento prepara operaciones; no autoriza pagos, devoluciones, OAuth ni cambios comerciales.
No usar una cuenta de Walter en QA. Nunca copiar claves al chat o al repositorio.

## Simulacros sin fixtures permanentes

Los runners requieren un recibo nuevo **fuera del repositorio**. Guardarlo hasta terminar la limpieza.
Los dos crean Auth, negocio, producto, preferencia y compra propios; IDs derivados de un UUID aleatorio.
El negocio lleva nombre/slug QA, `qa_fixture=true` y una ventana máxima de 15 minutos. No se crea vendedor OAuth.
Cada ejecución verifica resultados con aserciones y limpia en `finally`, también cuando una aserción falla.
Una interrupción dura se recupera con el mismo recibo y `--cleanup-only`.

En PowerShell, con PostgreSQL local ya iniciado sólo en loopback:

```powershell
$env:TABA_PG_BIN = '<directorio con psql, pg_dump y pg_restore>'
$env:TABA_LOCAL_PG_PORT = '<puerto del cluster aislado>'
node scripts/local-db/bootstrap.mjs taba_local_base
$env:TABA_LOCAL_DB = 'taba_local_base'
node scripts/recovery/qa-drill-recovery.mjs --local --run-file '<directorio privado>/recovery-run.json'
node scripts/recovery/qa-drill-late-changes.mjs --local --run-file '<directorio privado>/late-run.json'
# Recuperación tras una interrupción (idempotente):
node scripts/recovery/qa-drill-recovery.mjs --local --cleanup-only --run-file '<directorio privado>/recovery-run.json'
```

`--local` clona la plantilla en una base `taba_local_drill_*` con una marca de propiedad.
Sólo elimina esa base; rechaza una base sin la marca del recibo. No admite nombres `taba_restore_*`.
La plantilla queda intacta. El scheduler se invoca explícitamente y el proveedor está simulado;
esto **no prueba** pg_cron/Vault/Edge alojados. El simulacro de recuperación espera el umbral real de 45 segundos.

Para probar el cron alojado, una vez restablecido el acceso autorizado, omitir `--local`:

```text
node scripts/recovery/qa-drill-recovery.mjs --run-file <directorio-privado>/hosted-recovery.json
node scripts/recovery/qa-drill-late-changes.mjs --run-file <directorio-privado>/hosted-late.json
node scripts/recovery/qa-drill-recovery.mjs --cleanup-only --run-file <directorio-privado>/hosted-recovery.json
```

La limpieza alojada valida negocio, usuario, ambiente y collector; rechaza cualquier conexión OAuth o cambio
de identidad. Borra sólo registros del run en una transacción, sin deshabilitar restricciones ni auditorías.
Una dependencia inesperada revierte todo: conservar el recibo y revisar antes de reintentar.
Los logs globales del scheduler conservan su historial operativo. No se borran registros de ejecuciones antiguas
sin un recibo válido; no se elimina `taba_restore_20261022_ad3d29a2`.

## Aplicación de la migración, pendiente en QA

1. Confirmar proyecto y organización con una conexión autorizada; comprobar respaldo cifrado reciente,
   clave recuperable y ensayo de restauración. Inventariar dependencias y el nombre real de la FK:

```sql
select conname, convalidated, pg_get_constraintdef(oid)
from pg_constraint
where conrelid='public.businesses'::regclass
  and conname in ('businesses_ordering_verified_by_fkey',
    'businesses_ordering_verified_configuration','businesses_ordering_enabled_requires_verification');
select count(*) as invalid_configuration from public.businesses
where ordering_verified and (ordering_verified_by is null or ordering_verified_at is null);
select conname, convalidated, pg_get_constraintdef(oid) from pg_constraint
where conrelid='public.products'::regclass
  and conname in ('products_verified_by_fkey','products_verified_master_data');
```

2. Ejecutar las pruebas del verificador en una copia aislada. Con el esquema anterior, la primera prueba
   debe fallar por CHECK `23514`; con la migración, la eliminación debe producir FK `23503` sin cambiar el negocio.
3. Usar el runner de recuperación para preservar ambos ledgers y sus hashes:

```text
node scripts/recovery/sync-hosted.mjs --migrations --target deploy/recovery-free-hosted.json
# Sólo tras los controles anteriores, agregar --apply y --evidence <archivo privado>.
```

El runner pausa cron al aplicar migraciones. Registrar las tareas activas antes, revisar el resultado y reactivar
exactamente esas tareas después de verificar esquema y funciones. La migración no cambia cuerpos de funciones,
pero este cierre también corrige `catalog-image-manager`: desplegar sólo esa Edge Function, verificar su control
de acceso y repetir `npm run check:edge` antes de la ronda de imágenes.
Verificar ambos ledgers, la FK `ON DELETE RESTRICT`, los dos CHECK originales y el índice nuevo.
Verificar también `products_verified_by_fkey` restrictiva, su índice y el CHECK de datos maestros sin relajar.
Ejecutar asesores de seguridad y pruebas transaccionales de QA; no afirmar que aprobaron sin ejecutarlas.
Ante lock timeout, la migración revierte atómicamente; investigar sesiones bloqueantes antes de repetir.

Para eliminar legítimamente un verificador, usar el flujo existente `platform_revoke_business_ordering`
con actor confirmado, slug exacto y motivo, o una reasignación explícita y auditada. Nunca borrar el CHECK.
Revertir a `SET NULL` reintroduce el defecto; mantener la FK restrictiva hasta una decisión revisada.
Para un producto comercial, despublicar y retirar su verificación o reasignarla explícitamente antes de retirar
al verificador; conservar la auditoría correspondiente.

## Ronda auténtica MP, con autorización adicional

Antes de ejecutarla: acceso QA restablecido; vendedor/comprador **de prueba** distintos; firma del webhook;
aplicación y credenciales de prueba comprobadas en el panel oficial, sin deducir el ambiente sólo del prefijo del token.
El titular realiza login, consentimiento y MFA en su navegador. Las cuentas A/B de QA se verifican/provisionan con
las herramientas existentes; no son los negocios efímeros de los simulacros.

1. El titular configura `https://ixewllzzuzpqrkxzmfzx.supabase.co/functions/v1/mercadopago-webhook`
   y copia la firma desde el panel oficial. Con autorización para escribir secretos en QA:
   `node scripts/recovery/store-webhook-secret-from-clipboard.mjs`.
2. `node scripts/recovery/qa-mp-e2e.mjs forged-webhooks`: todos los casos deben dar 401 y exit 0.
   Un 503 por firma ausente falla la prueba; no cuenta como autenticidad validada.
3. `node scripts/recovery/qa-panel-connect.mjs`: crea el enlace de autorización; el vendedor de prueba lo abre,
   autoriza y completa MFA. `qa-mp-e2e.mjs status` debe confirmar el vendedor y ambiente correctos.
4. Abrir ventana QA con `qa-mp-e2e.mjs window-open --minutes 30`. Comprar desde el preview protegido.
   Verificar que el cliente pueda elegir efectivo o Mercado Pago cuando MP esté disponible.
5. Por caso, guardar sesión/intent/pago y evidencia **fuera del repositorio**, ejecutar
   `qa-mp-e2e.mjs inspect --session <uuid>` y comparar con GET del recurso en MP usando su cuenta autorizada.
   El inspector incluye todos los pagos, reembolsos, hallazgos, reservas, stock y posición del ledger;
   aborta si alguna lectura financiera falla. No incluye tokens ni datos de tarjeta.

| Caso | Evidencia y criterio de aceptación |
|---|---|
| Aprobado | Estado confirmado por API del proveedor; un pedido; una reserva convertida; stock descontado una vez |
| Rechazado y reintentado | Dos IDs de pago en la misma preferencia; sólo el aprobado financia; un pedido y un descuento de stock |
| Pendiente | Sin pedido entregable antes de aprobarse; seguimiento programado; expiración libera la reserva una vez |
| Aprobación tardía | Tras expirar, recuperación segura con stock suficiente; si falta, hallazgo visible y sin inventar stock |
| Parcial / total | Cada refund conserva ID, importe e idempotency key; suma exacta sin duplicación; total impide entrega |
| Cancelación | Cancelación confirmada por proveedor; stock liberado una vez; cancelar un pago aprobado usa el circuito de devolución |
| Webhook repetido o adulterado | Repetición sin doble efecto; firma inválida rechazada; nunca confiar en el retorno del navegador |
| Conciliación independiente | Cambio efectuado en panel MP sin depender del webhook; ledger por `date_last_updated` lo incorpora una vez |
| Worker interrumpido | Arrendamiento vencido vuelve a espera; backoff; recuperación sin doble pedido ni doble devolución |
| Pagos múltiples | Todas las identidades visibles; un financiador; dinero extra en discrepancias, sin desaparecer del ledger |
| Efectivo | Confirmación manual del comercio; sin intent MP; cobro y estado del pedido independientes; reversión explícita antes de cancelar un cobrado |

No enviar los comandos `refund`, `cancel`, `disconnect`, `worker`, `checkout` ni OAuth en esta sesión sin la
autorización correspondiente. Reusar idempotency key cuando se reintenta la misma operación; no generar otra
para una respuesta perdida. Los escenarios que MP no permita producir con sus herramientas de prueba deben quedar
como no verificados auténticamente y con evidencia de la limitación, aun cuando pasen simulaciones.

Cerrar la ventana con `qa-mp-e2e.mjs window-close`. Conservar el historial auténtico de prueba separado de negocios
comerciales; nunca ejecutar la limpieza efímera sobre un vendedor conectado.

Referencias oficiales consultadas: [compras de prueba con preferencias](https://www.mercadopago.com.ar/developers/en/docs/checkout-pro-preferences/integration-test/test-purchases),
[firma de webhooks](https://www.mercadopago.com.ar/developers/en/docs/zero-dollar-auth/additional-content/your-integrations/notifications/webhooks).

## Respaldo externo sin servicios nuevos

```text
node scripts/recovery/prepare-offsite-backup.mjs --snapshot <snapshot-privado> --out <carpeta-nueva-fuera-del-repo>
node scripts/recovery/prepare-offsite-backup.mjs --verify --out <carpeta-nueva-fuera-del-repo>
```

El paquete contiene sólo dump y roles **cifrados**, y un manifiesto sin rutas locales ni configuración Auth.
No copia claves, no sube nada ni activa gastos; no convierte una prueba de cifrado en prueba de restauración.
Trasladarlo a una carpeta privada del almacenamiento externo ya disponible del titular; verificar allí los hashes
y documentar su recibo. Guardar la clave de recuperación por un canal separado con un custodio acordado.
La clave del Administrador de credenciales de esta PC por sí sola no resuelve la pérdida de la PC.

Propuesta a acordar, no SLA implementado: RPO de 24 h, respaldo diario y previo a migraciones;
7 copias diarias/4 semanales en capacidad ya contratada; RTO objetivo de 4 h sujeto a un ensayo integral.
Si la exposición de ventas hace insuficiente ese RPO, revisarlo antes del lanzamiento. Programar sólo después
de acordar destino y custodia. `backup-freshness.mjs --require-restore-test` debe alertar si no hay certificado real.
Restaurar trimestralmente y antes de cambios financieros relevantes. Los backups PostgreSQL no incluyen los bytes
de Storage; ver [cobertura oficial de respaldos](https://supabase.com/docs/guides/platform/backups).
