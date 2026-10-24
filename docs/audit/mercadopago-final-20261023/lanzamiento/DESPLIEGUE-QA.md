# Despliegue en QA de la revisión 2 (migración `20261023210000` + worker)

23/10/2026. Proyecto `la-taba-recovery-test` (`ixewllzzuzpqrkxzmfzx`, plan Free, entorno de pruebas). **No se tocó ninguna base de producción, no se hizo merge y no se movió dinero real.** Evidencia en [`../despliegue-qa-20261023/`](../despliegue-qa-20261023/resumen-verificacion.json).

## Resultado

**Aplicada y verificada.** Libro de migraciones 170 → 171 (en ambos libros), `mercadopago-payment-worker` v14 `ACTIVE`, los cinco jobs de cron que estaban activos están activos de nuevo. Ningún control financiero falló por la migración; las fallas observadas durante la verificación tuvieron causa ajena y están explicadas abajo.

## Orden seguido

1. **Conexión**: sólo el proyecto QA, organización Free, marca de identidad de la base igual a la del recibo (`la_taba_recovery_target`).
2. **Respaldo cifrado previo**: `pg_dump` custom + roles sin contraseñas, AES-256-GCM, TLS `verify-full`; ida y vuelta de cifrado verificada; 4,1 MB. Hashes en el resumen. Los archivos están en la carpeta de respaldos de la PC de operación, instantánea `qa-pre-210000` (fuera de Git); la clave está en el Administrador de credenciales de Windows.
3. **Recuperación comprobada**: restauración del archivo en una base aislada (`taba_restore_20261023_e9ba39c2`) y comparación contra el archivo: tablas (154), RLS, políticas (74), ACL, funciones (503) y publicación **coinciden**. Contra el origen vivo sólo difieren `operational_sweep_runs` (+3 filas) y `operational_alerts`, porque el cron siguió corriendo entre la copia y la comparación. No certifica la restauración de la plataforma administrada (Auth/Storage/Realtime/cron/Vault), como ya decía el informe del 21/10.
4. **Ensayo**: `rehearse-migration.mjs` → `passed_and_rolled_back` (incluye el reemplazo exacto de texto de la función grande, que falla cerrado si la definición desplegada no es la esperada).
5. **Aplicación** con `sync-hosted.mjs --migrations --functions mercadopago-payment-worker --apply` (sha256 `060a3877…09df2`). La migración pausa por diseño todos los jobs `taba-*`; se registró cuáles estaban activos antes y se reactivaron **exactamente esos cinco** tras desplegar el worker y comprobar sus puertas de firma (pausa de ~15 min). `taba-security-retention-sweep` estaba inactivo antes y sigue inactivo.

## Verificación de invariantes en QA

| Invariante | Cómo | Resultado |
|---|---|---|
| Aislamiento entre comercios | `verify-tenant-isolation.mjs` con sesiones reales (dueño A, dueño B, comprador, anónimo) | **28/28** |
| Disputas (`in_mediation`), barrido de 48 h, id de reembolso, búsqueda por referencia con comercio | los 11 casos de `tests/db/review-fixes.test.mjs`, sin modificar, ejecutados en QA dentro de transacciones que siempre hacen rollback | **11/11** |
| Reembolsos, stock, idempotencia, conciliación | `forensic-26` 26/26, `p0-money-safety` 19/19, `p1-reconciliation` 25/25, `cash-commercial-circuit` 2/2 (mismo método) | **72/72** (83 con los de revisión 2) |
| Worker real + cron + Vault/HMAC | simulacro de recuperación: una compra aprobada sin finalizar pasa a **un** pedido por el barrido; stock 10 → 8 **una vez**; reserva convertida; job fallido reintenta con espera | **pasa**, datos sintéticos eliminados |
| Cambios tardíos | simulacro: pago pendiente con calendario propio; pago ilegible = **un** hallazgo + alerta crítica, sin lecturas encoladas sin vendedor; job de worker muerto recuperado con espera | **pasa**, datos sintéticos eliminados |
| Puertas del worker | sin firma y con firma errónea | 401 y 401; 13 funciones `ACTIVE` |
| Suites pgTAP alojadas de Mercado Pago | `verify-hosted-sql.mjs` | 5/5 sin ajustes y `operator_switch` 16/16 (ver abajo) |
| Conciliación del estado real | consulta de sólo lectura | 7 pedidos (igual que antes), 0 pedidos repetidos por pago, 0 stock negativo, 0 reembolsos sobre lo pagado, 0 cobrados sin pedido, 0 dead letters, 0 restos sintéticos |

### Fallas observadas y su causa (ninguna fue de la migración)

- **`mercadopago_operator_switch.local.sql` falla tal cual está**: usa el `seller_id` fijo `3594962708`, y ese vendedor de prueba ahora **está conectado** en QA (23505 en `mp_finish_oauth`). Pasaba el 21/10, antes de esa conexión. Corrida dentro de su propia transacción con rollback, apartando esa fila, da **16/16** y la fila real queda intacta. Deuda de la suite: debería usar un id propio.
- **Nueve casos (sondeos F08 y barrido del libro mayor) fallaban en QA** por contaminación del entorno: esas funciones son globales y encolaban 4 sondeos y una ventana del libro de **comercios reales de QA**. Con ese trabajo ajeno drenado dentro de la misma transacción (que se revierte) pasan. El caso 21 pasa sólo sin ese drenaje (los sondeos extra se encolan delante del job del escenario). Es un límite del método de verificación en una base poblada, no del sistema.
- **`p2-worker-dispatch-and-health`**: no aplica en QA (supone una base sin Vault y sin vendedores conectados). Lo que prueba lo cubren los dos simulacros con el worker real.
- **Alertas abiertas** `CHECKOUT_PROVIDER_UNVERIFIED` ×4 (críticas, desde las 17:53 UTC) y `ORDER_NOT_ACCEPTED` ×1: **idénticas en la copia previa a la migración**, de las pruebas del día; no las causó el despliegue.

## Reversa

`docs/migrations/rollback/20261023210000_financial_core_review_fixes.rollback.sql` restaura los cuerpos anteriores (las tablas nuevas quedan inertes); el archivo cifrado de arriba cubre el resto. No hizo falta.

## Limpieza local (sólo bases desechables, verificadas)

Clúster PostgreSQL local de pruebas (puerto 55440, `pgdata` del clon `la-taba-fix-20261022`): 15 bases `taba_local_*`, sin conexiones, con sólo comercios «QA drill» y correos `@example.invalid`. `clone.mjs` crea cada clon con `template taba_local_base`, así que **se conservaron** `taba_local_base` (plantilla) y `taba_local_work` (referenciada por nombre en el repo) y se eliminaron por nombre exacto, sin `force`, las 13 restantes (`clean`, `final`, `fix2`, `fix3`, `head`, `rf0`–`rf7`), regenerables con `clone.mjs`. No se borraron archivos, respaldos ni directorios. La base `taba_restore_20261023_e9ba39c2` de este ensayo queda en QA como prueba de recuperación hasta que se autorice su limpieza con recibo (matriz C5).
